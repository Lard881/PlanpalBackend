-- Migration: 009_enhance_activity_feed.sql
-- Description: Enhance activity feed system with aggregation, filtering, and user preferences
-- Dependencies: Assumes activities table exists from Supabase base schema

-- ============================================================================
-- 1. Activity Aggregation View
-- ============================================================================
-- Create a view that groups similar activities for cleaner feed display
CREATE OR REPLACE VIEW activity_feed_aggregated AS
SELECT
  a.workspace_id,
  a.entity_type,
  a.entity_id,
  a.action,
  a.user_id,
  DATE_TRUNC('hour', a.created_at) as activity_hour,
  MIN(a.created_at) as first_activity_at,
  MAX(a.created_at) as last_activity_at,
  COUNT(*) as activity_count,
  ARRAY_AGG(a.id ORDER BY a.created_at DESC) as activity_ids,
  ARRAY_AGG(DISTINCT a.user_id) as user_ids,
  jsonb_object_agg(a.id, a.metadata) FILTER (WHERE a.metadata IS NOT NULL) as all_metadata
FROM activities a
GROUP BY
  a.workspace_id,
  a.entity_type,
  a.entity_id,
  a.action,
  a.user_id,
  DATE_TRUNC('hour', a.created_at);

COMMENT ON VIEW activity_feed_aggregated IS 'Aggregated activity view grouping similar actions within the same hour';

-- ============================================================================
-- 2. Activity Preferences Table
-- ============================================================================
-- Store user preferences for activity notifications and feed filters
CREATE TABLE IF NOT EXISTS activity_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Email digest preferences
  email_digest_frequency VARCHAR(20) DEFAULT 'daily' CHECK (email_digest_frequency IN ('none', 'hourly', 'daily', 'weekly')),
  email_digest_enabled BOOLEAN DEFAULT TRUE,
  
  -- Feed filter preferences
  show_own_activities BOOLEAN DEFAULT FALSE,
  show_mentions BOOLEAN DEFAULT TRUE,
  show_assignments BOOLEAN DEFAULT TRUE,
  show_comments BOOLEAN DEFAULT TRUE,
  show_task_updates BOOLEAN DEFAULT TRUE,
  show_project_updates BOOLEAN DEFAULT TRUE,
  
  -- Activity types to exclude (JSON array of action strings)
  excluded_actions JSONB DEFAULT '[]'::jsonb,
  
  -- Projects to follow/unfollow
  followed_projects JSONB DEFAULT '[]'::jsonb,
  excluded_projects JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, workspace_id)
);

CREATE INDEX idx_activity_preferences_user ON activity_preferences(user_id);
CREATE INDEX idx_activity_preferences_workspace ON activity_preferences(workspace_id);

COMMENT ON TABLE activity_preferences IS 'User preferences for activity feed filtering and notifications';

-- ============================================================================
-- 3. Activity Read Tracking
-- ============================================================================
-- Track which activities have been seen by users
CREATE TABLE IF NOT EXISTS activity_read_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, activity_id)
);

CREATE INDEX idx_activity_read_status_user ON activity_read_status(user_id, read_at DESC);
CREATE INDEX idx_activity_read_status_activity ON activity_read_status(activity_id);

COMMENT ON TABLE activity_read_status IS 'Tracks which activities have been read by each user';

-- ============================================================================
-- 4. Activity Summary Materialized View
-- ============================================================================
-- Pre-computed summary for faster workspace activity statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS workspace_activity_summary AS
SELECT
  workspace_id,
  DATE_TRUNC('day', created_at) as activity_date,
  entity_type,
  action,
  COUNT(*) as activity_count,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT entity_id) as unique_entities
FROM activities
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY workspace_id, DATE_TRUNC('day', created_at), entity_type, action;

CREATE UNIQUE INDEX idx_workspace_activity_summary_unique 
  ON workspace_activity_summary(workspace_id, activity_date, entity_type, action);

CREATE INDEX idx_workspace_activity_summary_date 
  ON workspace_activity_summary(activity_date DESC);

COMMENT ON MATERIALIZED VIEW workspace_activity_summary IS 'Pre-computed daily activity statistics per workspace';

-- ============================================================================
-- 5. Helper Functions
-- ============================================================================

-- Function to get unread activity count for a user
CREATE OR REPLACE FUNCTION get_unread_activity_count(p_user_id UUID, p_workspace_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Get preferences
  SELECT COUNT(*)
  INTO v_count
  FROM activities a
  WHERE a.workspace_id = p_workspace_id
    AND a.user_id != p_user_id  -- Don't count own activities by default
    AND NOT EXISTS (
      SELECT 1 FROM activity_read_status ars
      WHERE ars.activity_id = a.id AND ars.user_id = p_user_id
    )
    AND a.created_at > NOW() - INTERVAL '30 days';  -- Only recent activities
    
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_unread_activity_count IS 'Returns count of unread activities for a user in a workspace';

-- Function to mark activities as read
CREATE OR REPLACE FUNCTION mark_activities_read(
  p_user_id UUID,
  p_activity_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO activity_read_status (user_id, activity_id)
  SELECT p_user_id, unnest(p_activity_ids)
  ON CONFLICT (user_id, activity_id) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION mark_activities_read IS 'Marks multiple activities as read for a user';

-- Function to get personalized activity feed
CREATE OR REPLACE FUNCTION get_personalized_activity_feed(
  p_user_id UUID,
  p_workspace_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  activity_id UUID,
  entity_type VARCHAR,
  entity_id UUID,
  action VARCHAR,
  user_id UUID,
  workspace_id UUID,
  changes JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  is_read BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id as activity_id,
    a.entity_type,
    a.entity_id,
    a.action,
    a.user_id,
    a.workspace_id,
    a.changes,
    a.metadata,
    a.created_at,
    (ars.id IS NOT NULL) as is_read
  FROM activities a
  LEFT JOIN activity_read_status ars ON ars.activity_id = a.id AND ars.user_id = p_user_id
  LEFT JOIN activity_preferences ap ON ap.user_id = p_user_id AND ap.workspace_id = p_workspace_id
  WHERE a.workspace_id = p_workspace_id
    -- Filter based on preferences
    AND (ap.show_own_activities = TRUE OR a.user_id != p_user_id)
    AND (ap.excluded_actions IS NULL OR NOT (a.action = ANY(SELECT jsonb_array_elements_text(ap.excluded_actions))))
    -- Only recent activities (90 days)
    AND a.created_at > NOW() - INTERVAL '90 days'
  ORDER BY a.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_personalized_activity_feed IS 'Returns personalized activity feed based on user preferences';

-- Function to refresh activity summary (call periodically via cron)
CREATE OR REPLACE FUNCTION refresh_activity_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY workspace_activity_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_activity_summary IS 'Refreshes the workspace activity summary materialized view';

-- ============================================================================
-- 6. Triggers
-- ============================================================================

-- Auto-update updated_at on activity_preferences
CREATE OR REPLACE FUNCTION update_activity_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_activity_preferences_updated_at
  BEFORE UPDATE ON activity_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_activity_preferences_updated_at();

-- ============================================================================
-- 7. Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE activity_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_read_status ENABLE ROW LEVEL SECURITY;

-- Activity Preferences Policies
CREATE POLICY activity_preferences_select_own
  ON activity_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY activity_preferences_insert_own
  ON activity_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_preferences_update_own
  ON activity_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_preferences_delete_own
  ON activity_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Activity Read Status Policies
CREATE POLICY activity_read_status_select_own
  ON activity_read_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY activity_read_status_insert_own
  ON activity_read_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_read_status_delete_own
  ON activity_read_status FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 8. Grants
-- ============================================================================

-- Grant access to authenticated users
GRANT SELECT ON activity_feed_aggregated TO authenticated;
GRANT SELECT ON workspace_activity_summary TO authenticated;

GRANT ALL ON activity_preferences TO authenticated;
GRANT ALL ON activity_read_status TO authenticated;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION get_unread_activity_count TO authenticated;
GRANT EXECUTE ON FUNCTION mark_activities_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_personalized_activity_feed TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_activity_summary TO authenticated;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Log migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 009: Activity feed enhancements completed successfully';
  RAISE NOTICE '- Created activity_feed_aggregated view';
  RAISE NOTICE '- Created activity_preferences table';
  RAISE NOTICE '- Created activity_read_status table';
  RAISE NOTICE '- Created workspace_activity_summary materialized view';
  RAISE NOTICE '- Created helper functions for activity management';
  RAISE NOTICE '- Enabled RLS policies';
END $$;
