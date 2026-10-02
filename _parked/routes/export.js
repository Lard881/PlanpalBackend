import express from 'express';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Convert array of objects to CSV format
 */
function arrayToCSV(data, columns) {
    if (!data || data.length === 0) {
        return '';
    }

    // CSV header
    const header = columns.join(',');
    
    // CSV rows
    const rows = data.map(row => {
        return columns.map(col => {
            let value = row[col];
            
            // Handle null/undefined
            if (value === null || value === undefined) {
                return '';
            }
            
            // Handle arrays
            if (Array.isArray(value)) {
                value = value.join(';');
            }
            
            // Handle objects
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }
            
            // Convert to string and escape
            value = String(value);
            
            // Escape quotes and wrap in quotes if contains comma, newline, or quote
            if (value.includes(',') || value.includes('\n') || value.includes('"')) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            
            return value;
        }).join(',');
    });
    
    return [header, ...rows].join('\n');
}

/**
 * Format task data for export
 */
function formatTaskForExport(task, format = 'csv') {
    const formatted = {
        id: task.id,
        title: task.title,
        description: task.description || '',
        status: task.status,
        priority: task.priority,
        project: task.project?.name || '',
        workspace: task.workspace?.name || '',
        assigned_to: task.assignee?.full_name || task.assignee?.email || '',
        created_by: task.creator?.full_name || task.creator?.email || '',
        due_date: task.due_date || '',
        completed_at: task.completed_at || '',
        estimated_hours: task.estimated_hours || '',
        labels: task.labels?.map(l => l.name).join(', ') || '',
        created_at: task.created_at,
        updated_at: task.updated_at
    };
    
    if (format === 'json') {
        // Include full nested objects for JSON
        formatted.project_details = task.project;
        formatted.assignee_details = task.assignee;
        formatted.creator_details = task.creator;
        formatted.labels_details = task.labels;
        formatted.comments_count = task.comments?.length || 0;
        formatted.attachments_count = task.attachments?.length || 0;
    }
    
    return formatted;
}

/**
 * Format project data for export
 */
function formatProjectForExport(project, format = 'csv') {
    const formatted = {
        id: project.id,
        name: project.name,
        description: project.description || '',
        status: project.status,
        workspace: project.workspace?.name || '',
        created_by: project.creator?.full_name || project.creator?.email || '',
        start_date: project.start_date || '',
        end_date: project.end_date || '',
        progress: project.progress || 0,
        task_count: project.task_count || 0,
        created_at: project.created_at,
        updated_at: project.updated_at
    };
    
    if (format === 'json') {
        formatted.workspace_details = project.workspace;
        formatted.creator_details = project.creator;
        formatted.members = project.members;
    }
    
    return formatted;
}

// =============================================
// EXPORT ENDPOINTS
// =============================================

/**
 * GET /export/tasks
 * Export tasks to CSV or JSON
 */
router.get('/tasks', async (req, res) => {
    try {
        const {
            workspace_id,
            project_id,
            status,
            priority,
            assigned_to,
            format = 'csv',
            include_subtasks = 'false',
            include_completed = 'true',
            date_from,
            date_to
        } = req.query;

        if (!workspace_id) {
            return res.status(400).json({
                success: false,
                error: 'workspace_id is required'
            });
        }

        // Verify user has access to workspace
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this workspace'
            });
        }

        // Build query
        let query = supabase
            .from('tasks')
            .select(`
                *,
                project:projects(id, name),
                workspace:workspaces(id, name),
                assignee:assigned_to(id, email, full_name),
                creator:created_by(id, email, full_name),
                labels:task_labels(label:labels(id, name, color))
            `)
            .eq('workspace_id', workspace_id);

        // Apply filters
        if (project_id) {
            query = query.eq('project_id', project_id);
        }
        if (status) {
            query = query.in('status', status.split(','));
        }
        if (priority) {
            query = query.in('priority', priority.split(','));
        }
        if (assigned_to) {
            query = query.eq('assigned_to', assigned_to);
        }
        if (include_subtasks === 'false') {
            query = query.is('parent_task_id', null);
        }
        if (include_completed === 'false') {
            query = query.neq('status', 'completed');
        }
        if (date_from) {
            query = query.gte('created_at', date_from);
        }
        if (date_to) {
            query = query.lte('created_at', date_to);
        }

        query = query.order('created_at', { ascending: false });

        const { data: tasks, error } = await query;

        if (error) throw error;

        // Format based on export format
        if (format === 'json') {
            const formatted = tasks.map(task => formatTaskForExport(task, 'json'));
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="tasks_${Date.now()}.json"`);
            res.json({
                success: true,
                exported_at: new Date().toISOString(),
                count: formatted.length,
                data: formatted
            });
        } else {
            // CSV format
            const formatted = tasks.map(task => formatTaskForExport(task, 'csv'));
            const columns = [
                'id', 'title', 'description', 'status', 'priority', 
                'project', 'workspace', 'assigned_to', 'created_by',
                'due_date', 'completed_at', 'estimated_hours', 'labels',
                'created_at', 'updated_at'
            ];
            
            const csv = arrayToCSV(formatted, columns);
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="tasks_${Date.now()}.csv"`);
            res.send(csv);
        }

        logger.info(`Tasks exported: ${tasks.length} tasks, format: ${format}, user: ${req.user.id}`);

    } catch (error) {
        logger.error('Error exporting tasks:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export tasks'
        });
    }
});

/**
 * GET /export/projects
 * Export projects to CSV or JSON
 */
router.get('/projects', async (req, res) => {
    try {
        const {
            workspace_id,
            status,
            format = 'csv',
            include_archived = 'false'
        } = req.query;

        if (!workspace_id) {
            return res.status(400).json({
                success: false,
                error: 'workspace_id is required'
            });
        }

        // Verify user has access to workspace
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this workspace'
            });
        }

        // Build query
        let query = supabase
            .from('projects')
            .select(`
                *,
                workspace:workspaces(id, name),
                creator:created_by(id, email, full_name),
                task_count:tasks(count)
            `)
            .eq('workspace_id', workspace_id);

        // Apply filters
        if (status) {
            query = query.in('status', status.split(','));
        }
        if (include_archived === 'false') {
            query = query.neq('status', 'archived');
        }

        query = query.order('created_at', { ascending: false });

        const { data: projects, error } = await query;

        if (error) throw error;

        // Format based on export format
        if (format === 'json') {
            const formatted = projects.map(project => formatProjectForExport(project, 'json'));
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="projects_${Date.now()}.json"`);
            res.json({
                success: true,
                exported_at: new Date().toISOString(),
                count: formatted.length,
                data: formatted
            });
        } else {
            // CSV format
            const formatted = projects.map(project => formatProjectForExport(project, 'csv'));
            const columns = [
                'id', 'name', 'description', 'status', 'workspace',
                'created_by', 'start_date', 'end_date', 'progress',
                'task_count', 'created_at', 'updated_at'
            ];
            
            const csv = arrayToCSV(formatted, columns);
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="projects_${Date.now()}.csv"`);
            res.send(csv);
        }

        logger.info(`Projects exported: ${projects.length} projects, format: ${format}, user: ${req.user.id}`);

    } catch (error) {
        logger.error('Error exporting projects:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export projects'
        });
    }
});

/**
 * GET /export/time-entries
 * Export time tracking entries to CSV or JSON
 */
router.get('/time-entries', async (req, res) => {
    try {
        const {
            workspace_id,
            user_id,
            project_id,
            start_date,
            end_date,
            format = 'csv',
            billable_only = 'false'
        } = req.query;

        if (!workspace_id) {
            return res.status(400).json({
                success: false,
                error: 'workspace_id is required'
            });
        }

        // Verify user has access to workspace
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this workspace'
            });
        }

        // Build query
        let query = supabase
            .from('time_entries_detailed')
            .select('*')
            .eq('workspace_id', workspace_id);

        // Apply filters
        if (user_id) {
            query = query.eq('user_id', user_id);
        }
        if (project_id) {
            query = query.eq('project_id', project_id);
        }
        if (start_date) {
            query = query.gte('start_time', start_date);
        }
        if (end_date) {
            query = query.lte('start_time', end_date);
        }
        if (billable_only === 'true') {
            query = query.eq('is_billable', true);
        }

        query = query.order('start_time', { ascending: false });

        const { data: entries, error } = await query;

        if (error) throw error;

        // Format based on export format
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="time_entries_${Date.now()}.json"`);
            res.json({
                success: true,
                exported_at: new Date().toISOString(),
                count: entries.length,
                data: entries
            });
        } else {
            // CSV format
            const columns = [
                'id', 'task_id', 'task_title', 'project_name', 'user_name',
                'start_time', 'end_time', 'duration_hours', 'entry_type',
                'is_billable', 'hourly_rate', 'billable_amount', 'description'
            ];
            
            const csv = arrayToCSV(entries, columns);
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="time_entries_${Date.now()}.csv"`);
            res.send(csv);
        }

        logger.info(`Time entries exported: ${entries.length} entries, format: ${format}, user: ${req.user.id}`);

    } catch (error) {
        logger.error('Error exporting time entries:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export time entries'
        });
    }
});

/**
 * POST /export/custom
 * Export custom data based on saved view
 */
router.post('/custom', async (req, res) => {
    try {
        const {
            view_id,
            format = 'csv'
        } = req.body;

        if (!view_id) {
            return res.status(400).json({
                success: false,
                error: 'view_id is required'
            });
        }

        // Get saved view
        const { data: view, error: viewError } = await supabase
            .from('saved_views')
            .select('*')
            .eq('id', view_id)
            .single();

        if (viewError) throw viewError;

        if (!view) {
            return res.status(404).json({
                success: false,
                error: 'View not found'
            });
        }

        // Verify user has access to view
        if (view.created_by !== req.user.id && !view.is_public) {
            const { data: share } = await supabase
                .from('view_shares')
                .select('*')
                .eq('view_id', view_id)
                .eq('shared_with_user_id', req.user.id)
                .single();

            if (!share) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied to this view'
                });
            }
        }

        // Build query based on view filters
        // This is a simplified implementation - in production, you'd parse
        // the filters JSON and build the appropriate query
        let query = supabase
            .from(view.entity_type === 'tasks' ? 'tasks' : 'projects')
            .select('*')
            .eq('workspace_id', view.workspace_id);

        // Apply view filters (simplified)
        if (view.filters && Object.keys(view.filters).length > 0) {
            // In production, parse filters and apply them
            // For now, just get all data
        }

        // Apply sorting
        if (view.sort_by) {
            query = query.order(view.sort_by, { 
                ascending: view.sort_order === 'asc' 
            });
        }

        const { data, error } = await query;

        if (error) throw error;

        // Export based on format
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${view.name}_${Date.now()}.json"`);
            res.json({
                success: true,
                view_name: view.name,
                exported_at: new Date().toISOString(),
                count: data.length,
                data: data
            });
        } else {
            // CSV - use visible_columns from view if available
            const columns = view.visible_columns || Object.keys(data[0] || {});
            const csv = arrayToCSV(data, columns);
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${view.name}_${Date.now()}.csv"`);
            res.send(csv);
        }

        logger.info(`Custom export from view ${view_id}: ${data.length} items, format: ${format}, user: ${req.user.id}`);

    } catch (error) {
        logger.error('Error performing custom export:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform custom export'
        });
    }
});

/**
 * GET /export/workspace
 * Export entire workspace data (bulk export)
 */
router.get('/workspace/:workspaceId', async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { format = 'json' } = req.query;

        // Verify user is workspace admin/owner
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspaceId)
            .eq('user_id', req.user.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({
                success: false,
                error: 'Only workspace owners and admins can export entire workspace'
            });
        }

        // Fetch all workspace data
        const [
            { data: workspace },
            { data: projects },
            { data: tasks },
            { data: labels },
            { data: members },
            { data: customFields }
        ] = await Promise.all([
            supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
            supabase.from('projects').select('*').eq('workspace_id', workspaceId),
            supabase.from('tasks').select('*').eq('workspace_id', workspaceId),
            supabase.from('labels').select('*').eq('workspace_id', workspaceId),
            supabase.from('workspace_members').select('*, user:user_id(email, full_name)').eq('workspace_id', workspaceId),
            supabase.from('custom_fields').select('*').eq('workspace_id', workspaceId)
        ]);

        const exportData = {
            exported_at: new Date().toISOString(),
            workspace: workspace,
            statistics: {
                projects_count: projects?.length || 0,
                tasks_count: tasks?.length || 0,
                labels_count: labels?.length || 0,
                members_count: members?.length || 0,
                custom_fields_count: customFields?.length || 0
            },
            data: {
                projects: projects || [],
                tasks: tasks || [],
                labels: labels || [],
                members: members || [],
                custom_fields: customFields || []
            }
        };

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="workspace_${workspaceId}_${Date.now()}.json"`);
            res.json(exportData);
        } else {
            // For CSV, create a zip with multiple CSV files
            // This would require a zip library - for now, return JSON with message
            return res.status(400).json({
                success: false,
                error: 'CSV format not supported for workspace export. Use JSON format.'
            });
        }

        logger.info(`Workspace exported: ${workspaceId}, format: ${format}, user: ${req.user.id}`);

    } catch (error) {
        logger.error('Error exporting workspace:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export workspace'
        });
    }
});

export default router;
