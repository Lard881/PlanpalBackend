import express from 'express';
import {
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema,
  validate,
} from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// GET /projects - List projects
// ============================================================================

router.get('/', validate(projectQuerySchema), async (req, res, next) => {
  try {
    const { workspace_id, is_archived, search, sort, page, limit } = req.query;
    const workspaceId = workspace_id || req.workspaceId;
    const offset = (page - 1) * limit;

    // Build query
    let query = req.supabase
      .from('projects')
      .select('*, task_count:tasks(count)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null);

    // Filters
    if (is_archived !== undefined) {
      query = query.eq('is_archived', is_archived);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Sorting
    switch (sort) {
      case 'name_asc':
        query = query.order('name', { ascending: true });
        break;
      case 'name_desc':
        query = query.order('name', { ascending: false });
        break;
      case 'created_asc':
        query = query.order('created_at', { ascending: true });
        break;
      case 'created_desc':
        query = query.order('created_at', { ascending: false });
        break;
      case 'position':
        query = query.order('position', { ascending: true, nullsFirst: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: projects, error, count } = await query;

    if (error) throw error;

    // Format task counts
    const formattedProjects = (projects || []).map(project => ({
      ...project,
      task_count: project.task_count?.[0]?.count || 0,
    }));

    res.json({
      projects: formattedProjects,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /projects - Create a new project
// ============================================================================

router.post('/', validate(createProjectSchema), async (req, res, next) => {
  try {
    const projectData = {
      ...req.body,
      workspace_id: req.body.workspace_id || req.workspaceId,
      created_by: req.userId,
    };

    // If client provided ID, check for conflict (idempotency)
    if (projectData.id) {
      const { data: existing } = await req.supabase
        .from('projects')
        .select('*')
        .eq('id', projectData.id)
        .single();

      if (existing) {
        logger.info(`Project ${projectData.id} already exists, returning existing`);
        return res.status(200).json({ project: existing });
      }
    }

    // Create project
    const { data: project, error } = await req.supabase
      .from('projects')
      .insert(projectData)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Project created: ${project.id} in workspace ${projectData.workspace_id}`);

    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /projects/:id - Get project details
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: project, error } = await req.supabase
      .from('projects')
      .select(`
        *,
        tasks:tasks(id,title,status,priority,due_date,assignee_id,completed_at)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Project not found', 404);
      }
      throw error;
    }

    // Filter out deleted tasks
    project.tasks = (project.tasks || []).filter(t => !t.deleted_at);

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /projects/:id - Update a project
// ============================================================================

router.patch('/:id', validate(updateProjectSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if project exists
    const { data: existing } = await req.supabase
      .from('projects')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Project not found', 404);
    }

    // Update project
    const { data: project, error } = await req.supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Project updated: ${id}`);

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /projects/:id - Soft delete a project
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if project has tasks
    const { count } = await req.supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
      .is('deleted_at', null);

    if (count > 0) {
      throw new AppError(
        'PROJECT_HAS_TASKS',
        `Cannot delete project with ${count} tasks. Move or delete tasks first.`,
        400
      );
    }

    // Soft delete
    const { error } = await req.supabase
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;

    logger.info(`Project deleted: ${id}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /projects/:id/archive - Archive/unarchive a project
// ============================================================================

router.post('/:id/archive', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const { data: project, error } = await req.supabase
      .from('projects')
      .update({ is_archived: is_archived ?? true })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Project not found', 404);
      }
      throw error;
    }

    logger.info(`Project ${id} ${project.is_archived ? 'archived' : 'unarchived'}`);

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

export default router;
