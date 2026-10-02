import express from 'express';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// =============================================
// CUSTOM FIELD DEFINITIONS
// =============================================

/**
 * GET /custom-fields/workspace/:workspaceId
 * Get all custom fields for a workspace
 */
router.get('/workspace/:workspaceId', async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { include_inactive } = req.query;

        let query = supabase
            .from('custom_fields')
            .select(`
                *,
                created_by_user:created_by(id, email, full_name)
            `)
            .eq('workspace_id', workspaceId)
            .order('display_order')
            .order('name');

        // Filter active by default
        if (include_inactive !== 'true') {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            data: data,
            count: data.length
        });
    } catch (error) {
        logger.error('Error fetching custom fields:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch custom fields'
        });
    }
});

/**
 * GET /custom-fields/:id
 * Get a specific custom field
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('custom_fields')
            .select(`
                *,
                created_by_user:created_by(id, email, full_name),
                value_count:custom_fields_summary!inner(
                    task_value_count,
                    project_value_count
                )
            `)
            .eq('id', id)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Custom field not found'
            });
        }

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        logger.error('Error fetching custom field:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch custom field'
        });
    }
});

/**
 * POST /custom-fields
 * Create a new custom field
 */
router.post('/', async (req, res) => {
    try {
        const {
            workspace_id,
            name,
            description,
            field_type,
            config,
            is_required,
            default_value,
            icon,
            color,
            display_order,
            applies_to_projects,
            applies_to_tasks
        } = req.body;

        // Validation
        if (!workspace_id || !name || !field_type) {
            return res.status(400).json({
                success: false,
                error: 'workspace_id, name, and field_type are required'
            });
        }

        const validFieldTypes = ['text', 'number', 'date', 'datetime', 'dropdown', 'checkbox', 'url', 'email', 'phone'];
        if (!validFieldTypes.includes(field_type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid field_type. Must be one of: ${validFieldTypes.join(', ')}`
            });
        }

        // Verify user has admin/owner role in workspace
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({
                success: false,
                error: 'Only workspace owners and admins can create custom fields'
            });
        }

        const { data, error } = await supabase
            .from('custom_fields')
            .insert({
                workspace_id,
                name,
                description,
                field_type,
                config: config || {},
                is_required: is_required || false,
                default_value,
                icon,
                color,
                display_order: display_order || 0,
                applies_to_projects: applies_to_projects !== false,
                applies_to_tasks: applies_to_tasks !== false,
                created_by: req.user.id
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                return res.status(409).json({
                    success: false,
                    error: 'A custom field with this name already exists in this workspace'
                });
            }
            throw error;
        }

        logger.info(`Custom field created: ${data.id} by user ${req.user.id}`);

        res.status(201).json({
            success: true,
            data: data
        });
    } catch (error) {
        logger.error('Error creating custom field:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create custom field'
        });
    }
});

/**
 * PUT /custom-fields/:id
 * Update a custom field
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            config,
            is_required,
            default_value,
            icon,
            color,
            display_order,
            applies_to_projects,
            applies_to_tasks,
            is_active
        } = req.body;

        // Get field to verify workspace
        const { data: field } = await supabase
            .from('custom_fields')
            .select('workspace_id')
            .eq('id', id)
            .single();

        if (!field) {
            return res.status(404).json({
                success: false,
                error: 'Custom field not found'
            });
        }

        // Verify user has admin/owner role
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', field.workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({
                success: false,
                error: 'Only workspace owners and admins can update custom fields'
            });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (config !== undefined) updates.config = config;
        if (is_required !== undefined) updates.is_required = is_required;
        if (default_value !== undefined) updates.default_value = default_value;
        if (icon !== undefined) updates.icon = icon;
        if (color !== undefined) updates.color = color;
        if (display_order !== undefined) updates.display_order = display_order;
        if (applies_to_projects !== undefined) updates.applies_to_projects = applies_to_projects;
        if (applies_to_tasks !== undefined) updates.applies_to_tasks = applies_to_tasks;
        if (is_active !== undefined) updates.is_active = is_active;

        const { data, error } = await supabase
            .from('custom_fields')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        logger.info(`Custom field updated: ${id} by user ${req.user.id}`);

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        logger.error('Error updating custom field:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update custom field'
        });
    }
});

/**
 * DELETE /custom-fields/:id
 * Soft delete a custom field (sets is_active = false)
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { hard_delete } = req.query;

        // Get field to verify workspace
        const { data: field } = await supabase
            .from('custom_fields')
            .select('workspace_id')
            .eq('id', id)
            .single();

        if (!field) {
            return res.status(404).json({
                success: false,
                error: 'Custom field not found'
            });
        }

        // Verify user has admin/owner role
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', field.workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({
                success: false,
                error: 'Only workspace owners and admins can delete custom fields'
            });
        }

        if (hard_delete === 'true') {
            // Hard delete (also deletes all values via CASCADE)
            const { error } = await supabase
                .from('custom_fields')
                .delete()
                .eq('id', id);

            if (error) throw error;

            logger.warn(`Custom field hard deleted: ${id} by user ${req.user.id}`);
        } else {
            // Soft delete
            const { error } = await supabase
                .from('custom_fields')
                .update({ is_active: false })
                .eq('id', id);

            if (error) throw error;

            logger.info(`Custom field soft deleted: ${id} by user ${req.user.id}`);
        }

        res.json({
            success: true,
            message: 'Custom field deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting custom field:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete custom field'
        });
    }
});

/**
 * POST /custom-fields/reorder
 * Reorder custom fields
 */
router.post('/reorder', async (req, res) => {
    try {
        const { workspace_id, field_order } = req.body;
        // field_order should be array of field IDs in desired order

        if (!workspace_id || !Array.isArray(field_order)) {
            return res.status(400).json({
                success: false,
                error: 'workspace_id and field_order array are required'
            });
        }

        // Verify user has admin/owner role
        const { data: membership } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspace_id)
            .eq('user_id', req.user.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({
                success: false,
                error: 'Only workspace owners and admins can reorder custom fields'
            });
        }

        // Update display_order for each field
        const updates = field_order.map((fieldId, index) => 
            supabase
                .from('custom_fields')
                .update({ display_order: index })
                .eq('id', fieldId)
                .eq('workspace_id', workspace_id)
        );

        await Promise.all(updates);

        logger.info(`Custom fields reordered for workspace ${workspace_id} by user ${req.user.id}`);

        res.json({
            success: true,
            message: 'Custom fields reordered successfully'
        });
    } catch (error) {
        logger.error('Error reordering custom fields:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reorder custom fields'
        });
    }
});

// =============================================
// CUSTOM FIELD VALUES
// =============================================

/**
 * GET /custom-fields/values/:entityType/:entityId
 * Get all custom field values for a task or project
 */
router.get('/values/:entityType/:entityId', async (req, res) => {
    try {
        const { entityType, entityId } = req.params;

        if (!['task', 'project'].includes(entityType)) {
            return res.status(400).json({
                success: false,
                error: 'entityType must be "task" or "project"'
            });
        }

        const { data, error } = await supabase.rpc('get_entity_custom_fields', {
            p_entity_type: entityType,
            p_entity_id: entityId
        });

        if (error) throw error;

        res.json({
            success: true,
            data: data,
            count: data.length
        });
    } catch (error) {
        logger.error('Error fetching custom field values:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch custom field values'
        });
    }
});

/**
 * POST /custom-fields/values
 * Set a custom field value
 */
router.post('/values', async (req, res) => {
    try {
        const {
            field_id,
            entity_type,
            entity_id,
            value
        } = req.body;

        if (!field_id || !entity_type || !entity_id) {
            return res.status(400).json({
                success: false,
                error: 'field_id, entity_type, and entity_id are required'
            });
        }

        if (!['task', 'project'].includes(entity_type)) {
            return res.status(400).json({
                success: false,
                error: 'entity_type must be "task" or "project"'
            });
        }

        // Get user IP and user agent for audit
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('user-agent');

        const { data, error } = await supabase.rpc('set_custom_field_value', {
            p_field_id: field_id,
            p_entity_type: entity_type,
            p_entity_id: entity_id,
            p_value: value,
            p_user_id: req.user.id,
            p_ip_address: ipAddress,
            p_user_agent: userAgent
        });

        if (error) {
            if (error.message.includes('Invalid value')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        logger.info(`Custom field value set: field ${field_id}, entity ${entity_type}/${entity_id} by user ${req.user.id}`);

        res.json({
            success: true,
            data: { value_id: data },
            message: 'Custom field value set successfully'
        });
    } catch (error) {
        logger.error('Error setting custom field value:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set custom field value'
        });
    }
});

/**
 * POST /custom-fields/values/bulk
 * Set multiple custom field values at once
 */
router.post('/values/bulk', async (req, res) => {
    try {
        const {
            entity_type,
            entity_id,
            field_values
        } = req.body;

        if (!entity_type || !entity_id || !field_values) {
            return res.status(400).json({
                success: false,
                error: 'entity_type, entity_id, and field_values are required'
            });
        }

        if (!['task', 'project'].includes(entity_type)) {
            return res.status(400).json({
                success: false,
                error: 'entity_type must be "task" or "project"'
            });
        }

        // Get user IP and user agent for audit
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('user-agent');

        const { data, error } = await supabase.rpc('bulk_set_custom_field_values', {
            p_entity_type: entity_type,
            p_entity_id: entity_id,
            p_field_values: field_values,
            p_user_id: req.user.id,
            p_ip_address: ipAddress,
            p_user_agent: userAgent
        });

        if (error) {
            if (error.message.includes('Invalid value')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        logger.info(`Bulk custom field values set: ${data} fields for entity ${entity_type}/${entity_id} by user ${req.user.id}`);

        res.json({
            success: true,
            data: { fields_updated: data },
            message: 'Custom field values set successfully'
        });
    } catch (error) {
        logger.error('Error setting bulk custom field values:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set custom field values'
        });
    }
});

/**
 * DELETE /custom-fields/values/:entityType/:entityId/:fieldId
 * Delete a custom field value
 */
router.delete('/values/:entityType/:entityId/:fieldId', async (req, res) => {
    try {
        const { entityType, entityId, fieldId } = req.params;

        if (!['task', 'project'].includes(entityType)) {
            return res.status(400).json({
                success: false,
                error: 'entityType must be "task" or "project"'
            });
        }

        const { error } = await supabase
            .from('custom_field_values')
            .delete()
            .eq('custom_field_id', fieldId)
            .eq('entity_type', entityType)
            .eq('entity_id', entityId);

        if (error) throw error;

        logger.info(`Custom field value deleted: field ${fieldId}, entity ${entityType}/${entityId} by user ${req.user.id}`);

        res.json({
            success: true,
            message: 'Custom field value deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting custom field value:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete custom field value'
        });
    }
});

/**
 * GET /custom-fields/history/:fieldId
 * Get value change history for a custom field
 */
router.get('/history/:fieldId', async (req, res) => {
    try {
        const { fieldId } = req.params;
        const { entity_type, entity_id, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('custom_field_value_history')
            .select(`
                *,
                changed_by_user:changed_by(id, email, full_name)
            `)
            .eq('custom_field_id', fieldId)
            .order('changed_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (entity_type) {
            query = query.eq('entity_type', entity_type);
        }
        if (entity_id) {
            query = query.eq('entity_id', entity_id);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        res.json({
            success: true,
            data: data,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        logger.error('Error fetching custom field history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch custom field history'
        });
    }
});

/**
 * POST /custom-fields/validate
 * Validate a custom field value without saving
 */
router.post('/validate', async (req, res) => {
    try {
        const { field_id, value } = req.body;

        if (!field_id) {
            return res.status(400).json({
                success: false,
                error: 'field_id is required'
            });
        }

        const { data, error } = await supabase.rpc('validate_custom_field_value', {
            p_field_id: field_id,
            p_value: value
        });

        if (error) throw error;

        res.json({
            success: true,
            valid: data
        });
    } catch (error) {
        logger.error('Error validating custom field value:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate custom field value'
        });
    }
});

export default router;
