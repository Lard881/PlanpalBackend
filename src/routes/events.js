import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true });
// Item-level routes: the URL has no workspace id (RLS enforces access)
const itemRouter = express.Router();

const eventsQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
}).refine(data => {
  const from = new Date(data.from);
  const to = new Date(data.to);
  const diffDays = (to - from) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 62;
}, { message: 'Date range cannot exceed 62 days' });

const createEventSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  allDay: z.boolean().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().max(2000).optional(),
  attendeeIds: z.array(z.string().uuid()).optional(),
  reminderMinutesBefore: z.number().int().min(0).optional(),
}).refine(
  data => new Date(data.endsAt) > new Date(data.startsAt),
  { message: 'Event end must be after its start', path: ['endsAt'] },
);

const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().max(2000).optional().nullable(),
  attendeeIds: z.array(z.string().uuid()).optional(),
  reminderMinutesBefore: z.number().int().min(0).optional().nullable(),
});

/**
 * GET /workspaces/:workspaceId/events?from=&to=
 * List events in date range
 */
router.get(
  '/',
  loadWorkspace,
  validate(eventsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { from, to } = req.query;
      const supabase = userClient(req.jwt);

      const [eventsResult, dueTasksResult] = await Promise.all([
        supabase
          .from('events')
          .select('*, event_attendees(user_id, profiles(full_name, avatar_url))')
          .eq('workspace_id', req.params.workspaceId)
          .gte('starts_at', from)
          .lte('starts_at', to)
          .is('deleted_at', null),
        supabase
          .from('tasks')
          .select('id, title, due_at, status, priority')
          .eq('workspace_id', req.params.workspaceId)
          .gte('due_at', from)
          .lte('due_at', to)
          .is('deleted_at', null),
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (dueTasksResult.error) throw dueTasksResult.error;

      res.json({
        events: eventsResult.data || [],
        dueTasks: dueTasksResult.data || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /workspaces/:workspaceId/events
 * Create an event
 */
router.post(
  '/',
  loadWorkspace,
  validate(createEventSchema),
  async (req, res, next) => {
    try {
      const { attendeeIds, ...eventData } = req.body;
      const supabase = userClient(req.jwt);
      const eventValues = {
        ...(eventData.id ? { id: eventData.id } : {}),
        workspace_id: req.params.workspaceId,
        title: eventData.title,
        description: eventData.description ?? '',
        starts_at: eventData.startsAt,
        ends_at: eventData.endsAt,
        all_day: eventData.allDay ?? false,
        color: eventData.color ?? '#3B82F6',
        reminder_minutes_before: eventData.reminderMinutesBefore ?? 15,
        created_by: req.user.id,
      };

      let event;
      if (eventData.id) {
        const { data: existing, error: lookupError } = await supabase
          .from('events')
          .select()
          .eq('id', eventData.id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          const matchesRequest = [
            'workspace_id',
            'title',
            'description',
            'all_day',
            'color',
            'reminder_minutes_before',
            'created_by',
          ].every(key => existing[key] === eventValues[key]) &&
            new Date(existing.starts_at).getTime() ===
              new Date(eventValues.starts_at).getTime() &&
            new Date(existing.ends_at).getTime() ===
              new Date(eventValues.ends_at).getTime();
          if (!matchesRequest) {
            throw new AppError(
              ErrorCodes.CONFLICT,
              'This event ID is already used by another operation',
              409,
            );
          }
          event = existing;
        }
      }

      if (!event) {
        const { data: createdEvent, error } = await supabase
          .from('events')
          .insert(eventValues)
          .select()
          .single();
        if (error) throw error;
        event = createdEvent;
      }

      if (attendeeIds && attendeeIds.length > 0) {
        const { data: members, error: membersError } = await supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', req.params.workspaceId)
          .in('user_id', attendeeIds);
        if (membersError) throw membersError;
        const memberIds = new Set((members || []).map(member => member.user_id));
        if (attendeeIds.some(userId => !memberIds.has(userId))) {
          throw new AppError(
            ErrorCodes.FORBIDDEN,
            'Attendees must be workspace members',
            400,
          );
        }

        const attendees = attendeeIds.map(userId => ({
          event_id: event.id,
          user_id: userId,
        }));
        const { error: attendeeError } = await supabase
          .from('event_attendees')
          .upsert(attendees, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
        if (attendeeError) throw attendeeError;
      }

      res.status(201).json({ event });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /events/:eventId
 * Update an event
 */
itemRouter.patch('/events/:eventId', validate(updateEventSchema), async (req, res, next) => {
  try {
    const {
      attendeeIds,
      startsAt,
      endsAt,
      allDay,
      reminderMinutesBefore,
      ...updates
    } = req.body;
    if (startsAt !== undefined) updates.starts_at = startsAt;
    if (endsAt !== undefined) updates.ends_at = endsAt;
    if (allDay !== undefined) updates.all_day = allDay;
    if (reminderMinutesBefore !== undefined) {
      updates.reminder_minutes_before = reminderMinutesBefore;
    }
    const supabase = userClient(req.jwt);

    let event;
    if (Object.keys(updates).length > 0) {
      const { data, error } = await supabase
        .from('events')
        .update(updates)
        .eq('id', req.params.eventId)
        .select()
        .single();

      if (error) throw error;
      event = data;
    } else {
      const { data, error } = await supabase
        .from('events')
        .select()
        .eq('id', req.params.eventId)
        .single();

      if (error) throw error;
      event = data;
    }

    if (attendeeIds !== undefined) {
      const { data: members, error: membersError } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', event.workspace_id)
        .in('user_id', attendeeIds);
      if (membersError) throw membersError;
      const memberIds = new Set((members || []).map(member => member.user_id));
      if (attendeeIds.some(userId => !memberIds.has(userId))) {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Attendees must be workspace members',
          400,
        );
      }

      const { error: deleteError } = await supabase
        .from('event_attendees')
        .delete()
        .eq('event_id', req.params.eventId);
      if (deleteError) throw deleteError;

      if (attendeeIds.length > 0) {
        const attendees = attendeeIds.map(userId => ({
          event_id: event.id,
          user_id: userId,
        }));
        const { error: insertError } = await supabase
          .from('event_attendees')
          .insert(attendees);
        if (insertError) throw insertError;
      }
    }

    res.json({ event });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /events/:eventId
 * Soft delete an event
 */
itemRouter.delete('/events/:eventId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.eventId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { itemRouter as eventItemRouter };
export default router;
