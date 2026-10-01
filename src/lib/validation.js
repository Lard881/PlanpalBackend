import { z } from 'zod';

// ============================================================================
// Common schemas
// ============================================================================

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime();

// ============================================================================
// Task validation schemas
// ============================================================================

export const createTaskSchema = z.object({
  id: uuidSchema.optional(), // Client can provide ID for offline sync
  workspace_id: uuidSchema,
  project_id: uuidSchema.optional().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'completed']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().nullable(),
  due_date: timestampSchema.optional().nullable(),
  assignee_id: uuidSchema.optional().nullable(), // User ID
  parent_task_id: uuidSchema.optional().nullable(), // For subtasks
  position: z.number().int().min(0).optional().nullable(),
  labels: z.array(uuidSchema).optional().default([]),
  reminder_minutes_before: z.number().int().min(0).optional().nullable(),
  reminder_at: timestampSchema.optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().nullable(),
  due_date: timestampSchema.optional().nullable(),
  assignee_id: uuidSchema.optional().nullable(),
  project_id: uuidSchema.optional().nullable(),
  parent_task_id: uuidSchema.optional().nullable(),
  position: z.number().int().min(0).optional().nullable(),
  completed_at: timestampSchema.optional().nullable(),
  reminder_minutes_before: z.number().int().min(0).optional().nullable(),
  reminder_at: timestampSchema.optional().nullable(),
});

export const taskQuerySchema = z.object({
  workspace_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  assignee_id: uuidSchema.optional(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  labels: z.string().optional(), // Comma-separated label IDs
  search: z.string().max(200).optional(),
  view: z.enum(['all', 'today', 'week', 'overdue', 'completed']).optional().default('all'),
  sort: z.enum(['created_asc', 'created_desc', 'due_asc', 'due_desc', 'priority', 'title']).optional().default('created_desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const bulkTaskActionSchema = z.object({
  task_ids: z.array(uuidSchema).min(1).max(100),
  action: z.enum(['complete', 'delete']),
});

export const moveTaskSchema = z.object({
  target_workspace_id: uuidSchema,
  target_project_id: uuidSchema.optional().nullable(),
});

// ============================================================================
// Project validation schemas
// ============================================================================

export const createProjectSchema = z.object({
  id: uuidSchema.optional(),
  workspace_id: uuidSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  is_archived: z.boolean().optional().default(false),
  position: z.number().int().min(0).optional().nullable(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  is_archived: z.boolean().optional(),
  position: z.number().int().min(0).optional().nullable(),
});

export const projectQuerySchema = z.object({
  workspace_id: uuidSchema.optional(),
  is_archived: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'created_asc', 'created_desc', 'position']).optional().default('position'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ============================================================================
// Label validation schemas
// ============================================================================

export const createLabelSchema = z.object({
  id: uuidSchema.optional(),
  workspace_id: uuidSchema,
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const labelQuerySchema = z.object({
  workspace_id: uuidSchema.optional(),
  search: z.string().max(200).optional(),
});

// ============================================================================
// Comment validation schemas
// ============================================================================

export const createCommentSchema = z.object({
  id: uuidSchema.optional(),
  task_id: uuidSchema,
  content: z.string().min(1).max(5000),
  mentions: z.array(uuidSchema).optional().default([]),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000),
});

// ============================================================================
// Attachment validation schemas (for later stages)
// ============================================================================

export const attachmentQuerySchema = z.object({
  task_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ============================================================================
// Sync validation schemas
// ============================================================================

export const syncQuerySchema = z.object({
  since: timestampSchema.optional(),
  entities: z.string().optional(), // Comma-separated: tasks,projects,labels
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ============================================================================
// Helper: Validate request body or query
// ============================================================================

export function validate(schema) {
  return (req, res, next) => {
    try {
      // Determine source: query params or body
      const data = Object.keys(req.query).length > 0 ? req.query : req.body;
      const validated = schema.parse(data);
      
      // Replace req.body or req.query with validated data
      if (Object.keys(req.query).length > 0) {
        req.query = validated;
      } else {
        req.body = validated;
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: error.errors.map(err => ({
              field: err.path.join('.'),
              message: err.message,
            })),
          },
        });
      }
      next(error);
    }
  };
}
