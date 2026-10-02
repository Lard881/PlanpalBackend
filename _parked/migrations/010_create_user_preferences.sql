-- Migration: 010_create_user_preferences.sql
-- Description: User preferences for language, theme, notifications, and customization
-- Dependencies: Assumes users/profiles table exists

-- ============================================================================
-- 1. User Preferences Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Localization Preferences
  language VARCHAR(10) DEFAULT 'en' NOT NULL,
  locale VARCHAR(10) DEFAULT 'en-US',
  timezone VARCHAR(50) DEFAULT 'UTC',
  date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
  time_format VARCHAR(10) DEFAULT '12h' CHECK (time_format IN ('12h', '24h')),
  first_day_of_week INTEGER DEFAULT 0 CHECK (first_day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 1=Monday
  
  -- Theme Preferences
  theme VARCHAR(20) DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  accent_color VARCHAR(7), -- Hex color code, e.g., #FF5733
  
  -- Notification Preferences
  email_notifications_enabled BOOLEAN DEFAULT TRUE,
  push_notifications_enabled BOOLEAN DEFAULT TRUE,
  desktop_notifications_enabled BOOLEAN DEFAULT TRUE,
  
  -- Notification Types
  notify_task_assigned BOOLEAN DEFAULT TRUE,
  notify_task_due_soon BOOLEAN DEFAULT TRUE,
  notify_task_overdue BOOLEAN DEFAULT TRUE,
  notify_task_completed BOOLEAN DEFAULT TRUE,
  notify_task_commented BOOLEAN DEFAULT TRUE,
  notify_mentioned BOOLEAN DEFAULT TRUE,
  notify_workspace_invite BOOLEAN DEFAULT TRUE,
  notify_project_updates BOOLEAN DEFAULT FALSE,
  
  -- Notification Timing
  quiet_hours_enabled BOOLEAN DEFAULT FALSE,
  quiet_hours_start TIME, -- e.g., '22:00:00'
  quiet_hours_end TIME,   -- e.g., '08:00:00'
  
  -- Email Digest Preferences
  email_digest_frequency VARCHAR(20) DEFAULT 'daily' CHECK (email_digest_frequency IN ('none', 'instant', 'hourly', 'daily', 'weekly')),
  email_digest_time TIME DEFAULT '09:00:00',
  
  -- Task Display Preferences
  default_task_view VARCHAR(20) DEFAULT 'list' CHECK (default_task_view IN ('list', 'board', 'calendar', 'timeline')),
  default_task_sort VARCHAR(20) DEFAULT 'due_date' CHECK (default_task_sort IN ('due_date', 'priority', 'created_at', 'title', 'status')),
  default_task_filter VARCHAR(20) DEFAULT 'active' CHECK (default_task_filter IN ('all', 'active', 'completed', 'assigned_to_me')),
  show_completed_tasks BOOLEAN DEFAULT FALSE,
  group_tasks_by VARCHAR(20) DEFAULT 'none' CHECK (group_tasks_by IN ('none', 'project', 'priority', 'due_date', 'assignee')),
  
  -- Workspace Preferences
  default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  auto_archive_completed_tasks BOOLEAN DEFAULT FALSE,
  auto_archive_days INTEGER DEFAULT 30,
  
  -- Accessibility Preferences
  reduce_motion BOOLEAN DEFAULT FALSE,
  high_contrast BOOLEAN DEFAULT FALSE,
  font_size VARCHAR(10) DEFAULT 'medium' CHECK (font_size IN ('small', 'medium', 'large', 'extra-large')),
  
  -- Privacy Preferences
  show_online_status BOOLEAN DEFAULT TRUE,
  show_profile_to_workspace_members BOOLEAN DEFAULT TRUE,
  allow_mentions BOOLEAN DEFAULT TRUE,
  
  -- Advanced Preferences
  enable_shortcuts BOOLEAN DEFAULT TRUE,
  enable_sounds BOOLEAN DEFAULT TRUE,
  enable_animations BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id)
);

-- Indexes
CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX idx_user_preferences_language ON user_preferences(language);
CREATE INDEX idx_user_preferences_default_workspace ON user_preferences(default_workspace_id);

COMMENT ON TABLE user_preferences IS 'User-specific preferences for UI, notifications, and behavior customization';

-- ============================================================================
-- 2. Supported Languages Reference Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS supported_languages (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  native_name VARCHAR(100) NOT NULL,
  rtl BOOLEAN DEFAULT FALSE, -- Right-to-left languages
  enabled BOOLEAN DEFAULT TRUE,
  completion_percentage INTEGER DEFAULT 0, -- Translation completion %
  flag_emoji VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE supported_languages IS 'Languages supported by the application with metadata';

-- Insert supported languages
INSERT INTO supported_languages (code, name, native_name, rtl, enabled, completion_percentage, flag_emoji) VALUES
  ('en', 'English', 'English', FALSE, TRUE, 100, '🇺🇸'),
  ('es', 'Spanish', 'Español', FALSE, TRUE, 0, '🇪🇸'),
  ('fr', 'French', 'Français', FALSE, TRUE, 0, '🇫🇷'),
  ('de', 'German', 'Deutsch', FALSE, TRUE, 0, '🇩🇪'),
  ('it', 'Italian', 'Italiano', FALSE, TRUE, 0, '🇮🇹'),
  ('pt', 'Portuguese', 'Português', FALSE, TRUE, 0, '🇵🇹'),
  ('ja', 'Japanese', '日本語', FALSE, TRUE, 0, '🇯🇵'),
  ('ko', 'Korean', '한국어', FALSE, TRUE, 0, '🇰🇷'),
  ('zh', 'Chinese', '中文', FALSE, TRUE, 0, '🇨🇳'),
  ('ar', 'Arabic', 'العربية', TRUE, TRUE, 0, '🇸🇦'),
  ('hi', 'Hindi', 'हिन्दी', FALSE, TRUE, 0, '🇮🇳'),
  ('ru', 'Russian', 'Русский', FALSE, TRUE, 0, '🇷🇺'),
  ('nl', 'Dutch', 'Nederlands', FALSE, TRUE, 0, '🇳🇱'),
  ('pl', 'Polish', 'Polski', FALSE, TRUE, 0, '🇵🇱'),
  ('tr', 'Turkish', 'Türkçe', FALSE, TRUE, 0, '🇹🇷')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 3. User Preference History (Optional - for audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preference_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key VARCHAR(50) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_user_preference_history_user ON user_preference_history(user_id, changed_at DESC);

COMMENT ON TABLE user_preference_history IS 'Audit trail of preference changes';

-- ============================================================================
-- 4. Helper Functions
-- ============================================================================

-- Function to get or create user preferences
CREATE OR REPLACE FUNCTION get_or_create_user_preferences(p_user_id UUID)
RETURNS user_preferences AS $$
DECLARE
  v_preferences user_preferences;
BEGIN
  SELECT * INTO v_preferences
  FROM user_preferences
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    INSERT INTO user_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;
  
  RETURN v_preferences;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_or_create_user_preferences IS 'Get existing preferences or create with defaults';

-- Function to update preference and log history
CREATE OR REPLACE FUNCTION update_user_preference(
  p_user_id UUID,
  p_key VARCHAR(50),
  p_value TEXT,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_old_value TEXT;
  v_sql TEXT;
BEGIN
  -- Get old value
  v_sql := format('SELECT %I::TEXT FROM user_preferences WHERE user_id = $1', p_key);
  EXECUTE v_sql INTO v_old_value USING p_user_id;
  
  -- Update preference
  v_sql := format('UPDATE user_preferences SET %I = $1, updated_at = NOW() WHERE user_id = $2', p_key);
  EXECUTE v_sql USING p_value, p_user_id;
  
  -- Log history
  IF v_old_value IS DISTINCT FROM p_value THEN
    INSERT INTO user_preference_history (user_id, preference_key, old_value, new_value, ip_address, user_agent)
    VALUES (p_user_id, p_key, v_old_value, p_value, p_ip_address, p_user_agent);
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_user_preference IS 'Update a single preference and log to history';

-- Function to reset preferences to defaults
CREATE OR REPLACE FUNCTION reset_user_preferences(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM user_preferences WHERE user_id = p_user_id;
  INSERT INTO user_preferences (user_id) VALUES (p_user_id);
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reset_user_preferences IS 'Reset user preferences to system defaults';

-- ============================================================================
-- 5. Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_updated_at();

-- Auto-create preferences on user creation
CREATE OR REPLACE FUNCTION auto_create_user_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: This trigger should be added to auth.users table
-- If using Supabase, this might need to be done via Supabase dashboard
-- CREATE TRIGGER trigger_auto_create_user_preferences
--   AFTER INSERT ON auth.users
--   FOR EACH ROW
--   EXECUTE FUNCTION auto_create_user_preferences();

-- ============================================================================
-- 6. Row Level Security (RLS)
-- ============================================================================

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preference_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE supported_languages ENABLE ROW LEVEL SECURITY;

-- User Preferences Policies
CREATE POLICY user_preferences_select_own
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_preferences_insert_own
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_preferences_update_own
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_preferences_delete_own
  ON user_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Preference History Policies (read-only for users)
CREATE POLICY user_preference_history_select_own
  ON user_preference_history FOR SELECT
  USING (auth.uid() = user_id);

-- Supported Languages Policies (public read)
CREATE POLICY supported_languages_select_all
  ON supported_languages FOR SELECT
  USING (TRUE);

-- ============================================================================
-- 7. Grants
-- ============================================================================

GRANT ALL ON user_preferences TO authenticated;
GRANT SELECT ON user_preference_history TO authenticated;
GRANT SELECT ON supported_languages TO authenticated, anon;

GRANT EXECUTE ON FUNCTION get_or_create_user_preferences TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_preference TO authenticated;
GRANT EXECUTE ON FUNCTION reset_user_preferences TO authenticated;

-- ============================================================================
-- 8. Views for Common Queries
-- ============================================================================

-- View for preferences with user details
CREATE OR REPLACE VIEW user_preferences_with_details AS
SELECT
  up.*,
  p.name as user_name,
  p.email as user_email,
  sl.name as language_name,
  sl.native_name as language_native_name,
  sl.rtl as language_rtl
FROM user_preferences up
JOIN profiles p ON up.user_id = p.id
LEFT JOIN supported_languages sl ON up.language = sl.code;

GRANT SELECT ON user_preferences_with_details TO authenticated;

-- ============================================================================
-- Migration Complete
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 010: User preferences system completed successfully';
  RAISE NOTICE '- Created user_preferences table with 40+ preference fields';
  RAISE NOTICE '- Created supported_languages reference table';
  RAISE NOTICE '- Created user_preference_history for audit trail';
  RAISE NOTICE '- Created helper functions for preference management';
  RAISE NOTICE '- Enabled RLS policies';
  RAISE NOTICE '- Inserted 15 supported languages';
END $$;
