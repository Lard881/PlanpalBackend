import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { decodeSyncCursor, paginateSyncRows, prepareSyncQuery } from '../lib/sync-pagination.js';

const router = express.Router({ mergeParams: true });

const syncQuerySchema = z.object({
  since: z.string().datetime().optional(),
  cursor: z.string().max(4096).optional(),
});

/**
 * GET /workspaces/:workspaceId/sync?since=<ISO time>
 * Delta sync — returns changed rows, with a stable cursor for tie-safe paging.
 */
router.get(
  '/',
  loadWorkspace,
  validate(syncQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      const workspaceId = req.params.workspaceId;
      const cursor = decodeSyncCursor(req.query.cursor, workspaceId);
      if (req.query.cursor && !cursor) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, 'Invalid sync cursor', 400);
      }
      const since = cursor?.updatedAt || req.query.since || new Date(0).toISOString();
      const configuredMaxRows = Number.parseInt(process.env.SYNC_MAX_ROWS || '1000', 10);
      const maxRows = Number.isInteger(configuredMaxRows) && configuredMaxRows > 0
        ? Math.min(configuredMaxRows, 1000)
        : 1000;

      // 2F fix: capture serverTime BEFORE queries
      const serverTime = new Date().toISOString();

      // 2F fix: select only child columns (no inner join columns in response)
      const [
        tasksRes,
        subtasksRes,
        taskCommentsRes,
        taskAttachmentsRes,
        labelsRes,
        eventsRes,
        eventAttendeesRes,
        channelsRes,
        documentsRes,
        foldersRes,
        membersRes,
        filesRes,
      ] = await Promise.all([
        prepareSyncQuery(
          supabase
            .from('tasks')
            .select('id,workspace_id,title,description,status,priority,due_at,assignee_id,label_id,created_by,completed_at,reminder_minutes_before,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'tasks', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('subtasks')
            .select('id,task_id,title,is_done,position,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
            .eq('tasks.workspace_id', workspaceId),
          'subtasks', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('task_comments')
            .select('id,task_id,author_id,body,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
            .eq('tasks.workspace_id', workspaceId),
          'taskComments', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('task_attachments')
            .select('task_id,file_id,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
            .eq('tasks.workspace_id', workspaceId),
          'taskAttachments', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('labels')
            .select('id,workspace_id,name,color,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'labels', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('events')
            .select('id,workspace_id,title,description,starts_at,ends_at,all_day,color,task_id,reminder_minutes_before,created_by,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'events', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('event_attendees')
            .select('event_id,user_id,created_at,updated_at,deleted_at,events!inner(workspace_id)')
            .eq('events.workspace_id', workspaceId),
          'eventAttendees', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('channels')
            .select('id,workspace_id,kind,name,description,is_private,created_by,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'channels', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('documents')
            .select('id,workspace_id,folder_id,kind,title,file_id,content,content_text,created_by,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'documents', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('folders')
            .select('id,workspace_id,parent_id,name,created_by,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'folders', since, cursor, maxRows,
        ),

        prepareSyncQuery(
          supabase
            .from('workspace_members')
            .select('workspace_id,user_id,role,joined_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'members', since, cursor, maxRows,
        ),

        // 2F addition: files for offline display
        prepareSyncQuery(
          supabase
            .from('files')
            .select('id,workspace_id,name,mime_type,size_bytes,uploaded_by,storage_path,created_at,updated_at,deleted_at')
            .eq('workspace_id', workspaceId),
          'files', since, cursor, maxRows,
        ),
      ]);

      // 2F fix: check every query for errors
      const allResults = [
        tasksRes, subtasksRes, taskCommentsRes, taskAttachmentsRes,
        labelsRes, eventsRes, eventAttendeesRes, channelsRes,
        documentsRes, foldersRes, membersRes, filesRes,
      ];
      for (const result of allResults) {
        if (result.error) throw result.error;
      }

      // 2F addition: workspace member profiles for offline display
      const memberUserIds = (membersRes.data || []).map(m => m.user_id);
      let profiles = [];
      if (memberUserIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id,full_name,email,avatar_url')
          .in('id', memberUserIds);
        if (profileError) throw profileError;
        profiles = profileData || [];
      }

      // 2F fix: strip inner join parent objects from child rows
      const stripJoin = (arr, joinKey) =>
        (arr || []).map(row => {
          const clean = { ...row };
          delete clean[joinKey];
          return clean;
        });

      const rowSets = {
        tasks: tasksRes.data || [],
        subtasks: stripJoin(subtasksRes.data, 'tasks'),
        taskComments: stripJoin(taskCommentsRes.data, 'tasks'),
        taskAttachments: stripJoin(taskAttachmentsRes.data, 'tasks'),
        labels: labelsRes.data || [],
        events: eventsRes.data || [],
        eventAttendees: stripJoin(eventAttendeesRes.data, 'events'),
        channels: channelsRes.data || [],
        documents: documentsRes.data || [],
        folders: foldersRes.data || [],
        members: membersRes.data || [],
        files: filesRes.data || [],
      };
      const queryLimitReached = Object.values(rowSets).some(rows => rows.length >= maxRows);
      const page = paginateSyncRows(rowSets, maxRows, cursor, workspaceId, queryLimitReached);
      const {
        tasks, subtasks, taskComments, taskAttachments, labels, events,
        eventAttendees, channels, documents, folders, members, files,
      } = page.rows;

      res.json({
        serverTime: page.hasMore && page.lastUpdatedAt
          ? new Date(page.lastUpdatedAt).toISOString()
          : serverTime,
        tasks,
        subtasks,
        taskComments,
        taskAttachments,
        labels,
        events,
        eventAttendees,
        channels,
        documents,
        folders,
        members,
        profiles,
        files,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
