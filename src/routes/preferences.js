import express from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const updatePreferencesSchema = z.object({
  body: z.object({
    // Localization
    language: z.string().max(10).optional(),
    locale: z.string().max(10).optional(),
    timezone: z.string().max(50).optional(),
    date_format: z.string().max(20).optional(),
    time_format: z.enum(['12h', '24h']).optional(),
    first_day_of_week: z.number().int().min(0).max(6).optional(),
    
    // Theme
    theme: z.enum(['light', 'dark', 'system']).optional(),
    accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    
    // Notifications
    email_notifications_enabled: z.boolean().optional(),
    push_notifications_enabled: z.boolean().optional(),
    desktop_notifications_enabled: z.boolean().optional(),
    notify_task_assigned: z.boolean().optional(),
    notify_task_due_soon: z.boolean().optional(),
    notify_task_overdue: z.boolean().optional(),
    notify_task_completed: z.boolean().optional(),
    notify_task_commented: z.boolean().optional(),
    notify_mentioned: z.boolean().optional(),
    notify_workspace_invite: z.boolean().optional(),
    notify_project_updates: z.boolean().optional(),
    
    // Quiet Hours
    quiet_hours_enabled: z.boolean().optional(),
    quiet_hours_start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
    quiet_hours_end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
    
    // Email Digest
    email_digest_frequency: z.enum(['none', 'instant', 'hourly', 'daily', 'weekly']).optional(),
    email_digest_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
    
    // Task Display
    default_task_view: z.enum(['list', 'board', 'calendar', 'timeline']).optional(),
    default_task_sort: z.enum(['due_date', 'priority', 'created_at', 'title', 'status']).optional(),
    default_task_filter: z.enum(['all', 'active', 'completed', 'assigned_to_me']).optional(),
    show_completed_tasks: z.boolean().optional(),
    group_tasks_by: z.enum(['none', 'project', 'priority', 'due_date', 'assignee']).optional(),
    
    // Workspace
    default_workspace_id: z.string().uuid().nullable().optional(),
    auto_archive_completed_tasks: z.boolean().optional(),
    auto_archive_days: z.number().int().min(1).max(365).optional(),
    
    // Accessibility
    reduce_motion: z.boolean().optional(),
    high_contrast: z.boolean().optional(),
    font_size: z.enum(['small', 'medium', 'large', 'extra-large']).optional(),
    
    // Privacy
    show_online_status: z.boolean().optional(),
    show_profile_to_workspace_members: z.boolean().optional(),
    allow_mentions: z.boolean().optional(),
    
    // Advanced
    enable_shortcuts: z.boolean().optional(),
    enable_sounds: z.boolean().optional(),
    enable_animations: z.boolean().optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: 'At least one preference field must be provided',
  }),
});

const partialUpdateSchema = z.object({
  body: z.object({
    preference_key: z.string().min(1).max(50),
    preference_value: z.any(),
  }),
});

// ============================================================================
// GET /preferences - Get current user's preferences
// ============================================================================

router.get('/', async (req, res, next) => {
  try {
    // Get or create preferences
    const { data: preferences, error } = await req.supabase
      .rpc('get_or_create_user_preferences', {
        p_user_id: req.userId,
      });

    if (error) throw error;

    logger.info(`Retrieved preferences for user ${req.userId}`);

    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PUT /preferences - Update user preferences (full or partial)
// ============================================================================

router.put('/', validate(updatePreferencesSchema), async (req, res, next) => {
  try {
    const updates = req.body;

    // Ensure preferences exist
    await req.supabase.rpc('get_or_create_user_preferences', {
      p_user_id: req.userId,
    });

    // Validate default_workspace_id if provided
    if (updates.default_workspace_id) {
      const { data: member } = await req.supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', updates.default_workspace_id)
        .eq('user_id', req.userId)
        .single();

      if (!member) {
        throw new AppError('BAD_REQUEST', 'You are not a member of the specified workspace', 400);
      }
    }

    // Validate language if provided
    if (updates.language) {
      const { data: lang } = await req.supabase
        .from('supported_languages')
        .select('code, enabled')
        .eq('code', updates.language)
        .single();

      if (!lang) {
        throw new AppError('BAD_REQUEST', 'Language not supported', 400);
      }

      if (!lang.enabled) {
        throw new AppError('BAD_REQUEST', 'Language is not currently enabled', 400);
      }
    }

    // Update preferences
    const { data: preferences, error } = await req.supabase
      .from('user_preferences')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Updated preferences for user ${req.userId}`, { updates: Object.keys(updates) });

    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /preferences/:key - Update single preference
// ============================================================================

router.patch('/:key', validate(partialUpdateSchema), async (req, res, next) => {
  try {
    const { key } = req.params;
    const { preference_value } = req.body;

    // Validate key exists in user_preferences table
    const validKeys = [
      'language', 'locale', 'timezone', 'date_format', 'time_format', 'first_day_of_week',
      'theme', 'accent_color',
      'email_notifications_enabled', 'push_notifications_enabled', 'desktop_notifications_enabled',
      'notify_task_assigned', 'notify_task_due_soon', 'notify_task_overdue',
      'notify_task_completed', 'notify_task_commented', 'notify_mentioned',
      'notify_workspace_invite', 'notify_project_updates',
      'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
      'email_digest_frequency', 'email_digest_time',
      'default_task_view', 'default_task_sort', 'default_task_filter',
      'show_completed_tasks', 'group_tasks_by',
      'default_workspace_id', 'auto_archive_completed_tasks', 'auto_archive_days',
      'reduce_motion', 'high_contrast', 'font_size',
      'show_online_status', 'show_profile_to_workspace_members', 'allow_mentions',
      'enable_shortcuts', 'enable_sounds', 'enable_animations',
    ];

    if (!validKeys.includes(key)) {
      throw new AppError('BAD_REQUEST', 'Invalid preference key', 400);
    }

    // Use the database function for audit trail
    const { data: success, error } = await req.supabase
      .rpc('update_user_preference', {
        p_user_id: req.userId,
        p_key: key,
        p_value: String(preference_value),
        p_ip_address: req.ip,
        p_user_agent: req.get('user-agent'),
      });

    if (error) throw error;

    // Get updated preferences
    const { data: preferences } = await req.supabase
      .from('user_preferences')
      .select()
      .eq('user_id', req.userId)
      .single();

    logger.info(`Updated preference ${key} for user ${req.userId}`);

    res.json({ 
      preferences,
      updated_key: key,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /preferences/reset - Reset preferences to defaults
// ============================================================================

router.post('/reset', async (req, res, next) => {
  try {
    const { data: success, error } = await req.supabase
      .rpc('reset_user_preferences', {
        p_user_id: req.userId,
      });

    if (error) throw error;

    // Get new default preferences
    const { data: preferences } = await req.supabase
      .from('user_preferences')
      .select()
      .eq('user_id', req.userId)
      .single();

    logger.info(`Reset preferences to defaults for user ${req.userId}`);

    res.json({ 
      preferences,
      message: 'Preferences reset to defaults',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /preferences/history - Get preference change history
// ============================================================================

router.get('/history', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data: history, error, count } = await req.supabase
      .from('user_preference_history')
      .select('*', { count: 'exact' })
      .eq('user_id', req.userId)
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      history: history || [],
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: count || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /preferences/export - Export preferences as JSON
// ============================================================================

router.get('/export', async (req, res, next) => {
  try {
    const { data: preferences, error } = await req.supabase
      .from('user_preferences')
      .select()
      .eq('user_id', req.userId)
      .single();

    if (error) throw error;

    // Remove metadata fields
    const { id, user_id, created_at, updated_at, ...exportData } = preferences;

    res.json({
      version: '1.0',
      exported_at: new Date().toISOString(),
      preferences: exportData,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /preferences/import - Import preferences from JSON
// ============================================================================

router.post('/import', async (req, res, next) => {
  try {
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      throw new AppError('BAD_REQUEST', 'Invalid import data', 400);
    }

    // Remove any metadata that shouldn't be imported
    const { id, user_id, created_at, updated_at, ...cleanPreferences } = preferences;

    // Ensure preferences exist
    await req.supabase.rpc('get_or_create_user_preferences', {
      p_user_id: req.userId,
    });

    // Update with imported preferences
    const { data: updated, error } = await req.supabase
      .from('user_preferences')
      .update({
        ...cleanPreferences,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Imported preferences for user ${req.userId}`);

    res.json({
      preferences: updated,
      message: 'Preferences imported successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /languages - Get supported languages
// ============================================================================

router.get('/languages', async (req, res, next) => {
  try {
    const { enabled_only = 'true' } = req.query;

    let query = req.supabase
      .from('supported_languages')
      .select('*')
      .order('name', { ascending: true });

    if (enabled_only === 'true') {
      query = query.eq('enabled', true);
    }

    const { data: languages, error } = await query;

    if (error) throw error;

    res.json({
      languages: languages || [],
      count: languages?.length || 0,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /languages/:code - Get specific language details
// ============================================================================

router.get('/languages/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    const { data: language, error } = await req.supabase
      .from('supported_languages')
      .select('*')
      .eq('code', code)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Language not found', 404);
      }
      throw error;
    }

    res.json({ language });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /timezones - Get list of common timezones
// ============================================================================

router.get('/timezones', async (req, res, next) => {
  try {
    // Common timezones list
    const timezones = [
      { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: '+00:00' },
      { value: 'America/New_York', label: 'Eastern Time (US & Canada)', offset: '-05:00' },
      { value: 'America/Chicago', label: 'Central Time (US & Canada)', offset: '-06:00' },
      { value: 'America/Denver', label: 'Mountain Time (US & Canada)', offset: '-07:00' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', offset: '-08:00' },
      { value: 'America/Anchorage', label: 'Alaska Time', offset: '-09:00' },
      { value: 'Pacific/Honolulu', label: 'Hawaii Time', offset: '-10:00' },
      { value: 'Europe/London', label: 'London', offset: '+00:00' },
      { value: 'Europe/Paris', label: 'Paris, Berlin, Rome', offset: '+01:00' },
      { value: 'Europe/Athens', label: 'Athens, Istanbul', offset: '+02:00' },
      { value: 'Europe/Moscow', label: 'Moscow', offset: '+03:00' },
      { value: 'Asia/Dubai', label: 'Dubai', offset: '+04:00' },
      { value: 'Asia/Kolkata', label: 'India Standard Time', offset: '+05:30' },
      { value: 'Asia/Dhaka', label: 'Bangladesh', offset: '+06:00' },
      { value: 'Asia/Bangkok', label: 'Bangkok, Jakarta', offset: '+07:00' },
      { value: 'Asia/Singapore', label: 'Singapore, Hong Kong', offset: '+08:00' },
      { value: 'Asia/Tokyo', label: 'Tokyo, Seoul', offset: '+09:00' },
      { value: 'Australia/Sydney', label: 'Sydney, Melbourne', offset: '+10:00' },
      { value: 'Pacific/Auckland', label: 'New Zealand', offset: '+12:00' },
    ];

    res.json({ timezones });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /date-formats - Get list of available date formats
// ============================================================================

router.get('/date-formats', async (req, res, next) => {
  try {
    const dateFormats = [
      { value: 'MM/DD/YYYY', label: '12/31/2024 (US)', example: '12/31/2024' },
      { value: 'DD/MM/YYYY', label: '31/12/2024 (UK)', example: '31/12/2024' },
      { value: 'YYYY-MM-DD', label: '2024-12-31 (ISO)', example: '2024-12-31' },
      { value: 'DD.MM.YYYY', label: '31.12.2024 (DE)', example: '31.12.2024' },
      { value: 'DD-MMM-YYYY', label: '31-Dec-2024', example: '31-Dec-2024' },
      { value: 'MMM DD, YYYY', label: 'Dec 31, 2024', example: 'Dec 31, 2024' },
    ];

    res.json({ date_formats: dateFormats });
  } catch (error) {
    next(error);
  }
});

export default router;
