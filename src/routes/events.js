import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true });

const eventsQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
}).refine(data => {
  const from = new Date(data.from);
  const to = new Date(data.to);
  const diffDays = (to - from) / (1000 * 60 * 60 * 24);
  return diffDays <= 62;
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
});

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

      const [{ data: events }, { data: dueTasks }] = await Promise.all([
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

      res.json({ events: events || [], dueTasks: dueTasks || [] });
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

      const { data: event, error } = await supabase
        .from('events')
        .insert({
          ...eventData,
          workspace_id: req.params.workspaceId,
          created_by: req.user.id,
        })
        .select()
        .single();

      if (error) throw error;

      if (attendeeIds && attendeeIds.length > 0) {
        const attendees = attendeeIds.map(userId => ({
          event_id: event.id,
          user_id: userId,
        }));
        await supabase.from('event_attendees').insert(attendees);
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
router.patch('/:eventId', validate(updateEventSchema), async (req, res, next) => {
  try {
    const { attendeeIds, ...updates } = req.body;
    const supabase = userClient(req.jwt);

    const { data: event, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', req.params.eventId)
      .select()
      .single();

    if (error) throw error;

    if (attendeeIds !== undefined) {
      await supabase.from('event_attendees').delete().eq('event_id', req.params.eventId);
      if (attendeeIds.length > 0) {
        const attendees = attendeeIds.map(userId => ({
          event_id: event.id,
          user_id: userId,
        }));
        await supabase.from('event_attendees').insert(attendees);
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
router.delete('/:eventId', async (req, res, next) => {
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

export default router;
