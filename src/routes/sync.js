import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true });

// Validation schema
const syncQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

/**
 * GET /workspaces/:workspaceId/sync?since=<ISO time>
 * Sync all changes since a given timestamp
 */
router.get(
  '/',
  loadWorkspace,
  validate(syncQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      const workspaceId = req.params.workspaceId;
      const since = req.query.since || new Date(0).toISOString(); // Beginning of time if not provided
      const maxRows = 1000;
      
      // Fetch all entity types in parallel
      const [
        { data: tasks },
        { data: subtasks },
        { data: taskComments },
        { data: taskAttachments },
        { data: labels },
        { data: events },
        { data: eventAttendees },
        { data: channels },
        { data: documents },
        { data: folders },
        { data: members },
      ] = await Promise.all([
        // Tasks (including deleted)
        supabase
          .from('tasks')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Subtasks (join through tasks)
        supabase
          .from('subtasks')
          .select('*, tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Task comments (join through tasks)
        supabase
          .from('task_comments')
          .select('*, tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Task attachments (join through tasks)
        supabase
          .from('task_attachments')
          .select('*, tasks!inner(workspace_id)')
          .eq('tasks.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Labels
        supabase
          .from('labels')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Events
        supabase
          .from('events')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Event attendees (join through events)
        supabase
          .from('event_attendees')
          .select('*, events!inner(workspace_id)')
          .eq('events.workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Channels
        supabase
          .from('channels')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Documents
        supabase
          .from('documents')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Folders
        supabase
          .from('folders')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
        
        // Workspace members
        supabase
          .from('workspace_members')
          .select('*')
          .eq('workspace_id', workspaceId)
          .gte('updated_at', since)
          .order('updated_at', { ascending: true }),
      ]);
      
      // Calculate total rows
      const totalRows = [
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
      ].reduce((sum, arr) => sum + (arr?.length || 0), 0);
      
      // Check if we need to paginate
      const hasMore = totalRows > maxRows;
      
      // If too many rows, we need to find a cutoff timestamp
      let cutoffTime = null;
      if (hasMore) {
        // Collect all timestamps
        const allTimestamps = [];
        [tasks, subtasks, taskComments, taskAttachments, labels, events, eventAttendees, channels, documents, folders, members].forEach(arr => {
          if (arr) {
            arr.forEach(item => {
              if (item.updated_at) {
                allTimestamps.push(new Date(item.updated_at).getTime());
              }
            });
          }
        });
        
        // Sort and find the timestamp at position maxRows
        allTimestamps.sort((a, b) => a - b);
        cutoffTime = new Date(allTimestamps[Math.min(maxRows - 1, allTimestamps.length - 1)]).toISOString();
        
        // Filter all arrays to only include items up to cutoff
        const filterByCutoff = (arr) => arr?.filter(item => item.updated_at <= cutoffTime) || [];
        
        Object.assign({
          tasks: filterByCutoff(tasks),
          subtasks: filterByCutoff(subtasks),
          taskComments: filterByCutoff(taskComments),
          taskAttachments: filterByCutoff(taskAttachments),
          labels: filterByCutoff(labels),
          events: filterByCutoff(events),
          eventAttendees: filterByCutoff(eventAttendees),
          channels: filterByCutoff(channels),
          documents: filterByCutoff(documents),
          folders: filterByCutoff(folders),
          members: filterByCutoff(members),
        });
      }
      
      const serverTime = new Date().toISOString();
      
      res.json({
        serverTime,
        tasks: tasks || [],
        subtasks: subtasks || [],
        taskComments: taskComments || [],
        taskAttachments: taskAttachments || [],
        labels: labels || [],
        events: events || [],
        eventAttendees: eventAttendees || [],
        channels: channels || [],
        documents: documents || [],
        folders: folders || [],
        members: members || [],
        hasMore,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
