import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true });

const syncQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

/**
 * GET /workspaces/:workspaceId/sync?since=<ISO time>
 * Delta sync — returns everything changed since a timestamp.
 * 2F fixes:
 *  - serverTime captured BEFORE queries (race-condition fix)
 *  - hasMore cutoff actually applied to response arrays
 *  - error checked on every query
 *  - inner join columns not included in response (select only child cols)
 *  - adds profiles and files to response
 */
router.get(
  '/',
  loadWorkspace,
  validate(syncQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      const workspaceId = req.params.workspaceId;
      const since = req.query.since || new Date(0).toISOString();
      const maxRows = 1000;

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
        supabase
          .from('tasks')
          .select('id,workspace_id,title,description,status,priority,due_at,assignee_id,label_id,created_by,completed_at,reminder_minutes_before,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('subtasks')
          .select('id,task_id,title,is_done,position,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('task_comments')
          .select('id,task_id,author_id,body,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('task_attachments')
          .select('task_id,file_id,created_at,updated_at,deleted_at,tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('labels')
          .select('id,workspace_id,name,color,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('events')
          .select('id,workspace_id,title,description,starts_at,ends_at,all_day,color,task_id,reminder_minutes_before,created_by,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('event_attendees')
          .select('event_id,user_id,created_at,updated_at,deleted_at,events!inner(workspace_id)')
          .eq('events.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('channels')
          .select('id,workspace_id,kind,name,description,is_private,created_by,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('documents')
          .select('id,workspace_id,folder_id,kind,title,file_id,content,content_text,created_by,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('folders')
          .select('id,workspace_id,parent_id,name,created_by,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        supabase
          .from('workspace_members')
          .select('workspace_id,user_id,role,joined_at,updated_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),

        // 2F addition: files for offline display
        supabase
          .from('files')
          .select('id,workspace_id,name,mime_type,size_bytes,uploaded_by,storage_path,created_at,updated_at,deleted_at')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
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

      let tasks = tasksRes.data || [];
      let subtasks = stripJoin(subtasksRes.data, 'tasks');
      let taskComments = stripJoin(taskCommentsRes.data, 'tasks');
      let taskAttachments = stripJoin(taskAttachmentsRes.data, 'tasks');
      let labels = labelsRes.data || [];
      let events = eventsRes.data || [];
      let eventAttendees = stripJoin(eventAttendeesRes.data, 'events');
      let channels = channelsRes.data || [];
      let documents = documentsRes.data || [];
      let folders = foldersRes.data || [];
      let members = membersRes.data || [];
      let files = filesRes.data || [];

      // Calculate total rows
      const allArrays = [
        tasks, subtasks, taskComments, taskAttachments, labels,
        events, eventAttendees, channels, documents, folders, members, files,
      ];
      const totalRows = allArrays.reduce((sum, arr) => sum + arr.length, 0);
      const hasMore = totalRows > maxRows;

      // 2F fix: actually apply the cutoff (was dead code before)
      if (hasMore) {
        const allTimestamps = allArrays.flatMap(arr =>
          arr.map(item => new Date(item.updated_at).getTime())
        ).sort((a, b) => a - b);

        const cutoffTs = allTimestamps[Math.min(maxRows - 1, allTimestamps.length - 1)];
        const cutoffTime = new Date(cutoffTs).toISOString();

        const filterByCutoff = (arr) =>
          arr.filter(item => item.updated_at <= cutoffTime);

        tasks = filterByCutoff(tasks);
        subtasks = filterByCutoff(subtasks);
        taskComments = filterByCutoff(taskComments);
        taskAttachments = filterByCutoff(taskAttachments);
        labels = filterByCutoff(labels);
        events = filterByCutoff(events);
        eventAttendees = filterByCutoff(eventAttendees);
        channels = filterByCutoff(channels);
        documents = filterByCutoff(documents);
        folders = filterByCutoff(folders);
        members = filterByCutoff(members);
        files = filterByCutoff(files);
      }

      res.json({
        serverTime,
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
        hasMore,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
