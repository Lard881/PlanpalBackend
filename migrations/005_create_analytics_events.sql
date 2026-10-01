-- Migration: Create Analytics Events Table
-- Description: Track user behavior and workspace metrics
-- Version: 005
-- Date: 2024-01-15

-- Create analytics_events table
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for efficient querying
  CONSTRAINT valid_event_type CHECK (event_type IN (
    'task_created',
    'task_completed',
    'task_updated',
    'task_deleted',
    'search_performed',
    'attachment_uploaded',
    'comment_added',
    'label_applied',
    'project_created',
    'workspace_joined',
    'reminder_set',
    'filter_applied',
    'export_performed',
    'notification_clicked',
    'page_viewed'
  ))
);

-- Create indexes for performance
CREATE INDEX idx_analytics_events_user_id ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_workspace_id ON analytics_events(workspace_id);
CREATE INDEX idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX idx_analytics_events_user_workspace ON analytics_events(user_id, workspace_id);

-- Create composite index for common queries (user + date range)
CREATE INDEX idx_analytics_events_user_date ON analytics_events(user_id, created_at DESC);

-- Create GIN index for JSONB queries
CREATE INDEX idx_analytics_events_event_data ON analytics_events USING GIN (event_data);

-- Enable Row Level Security
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only insert their own events
CREATE POLICY analytics_events_insert_own ON analytics_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can view their own events
CREATE POLICY analytics_events_select_own ON analytics_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Workspace admins can view workspace events
CREATE POLICY analytics_events_select_workspace_admin ON analytics_events
  FOR SELECT
  USING (
    workspace_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = analytics_events.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role IN ('admin', 'owner')
    )
  );

-- RLS Policy: No updates or deletes (immutable log)
-- Analytics events should not be modified after creation for data integrity

-- Create function to get task completion metrics
CREATE OR REPLACE FUNCTION get_task_completion_metrics(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  total_created INTEGER,
  total_completed INTEGER,
  completion_rate NUMERIC,
  avg_completion_time_hours NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH created_tasks AS (
    SELECT 
      COUNT(*)::INTEGER as created_count
    FROM analytics_events
    WHERE user_id = p_user_id
      AND event_type = 'task_created'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND created_at BETWEEN p_start_date AND p_end_date
  ),
  completed_tasks AS (
    SELECT 
      COUNT(*)::INTEGER as completed_count,
      AVG(
        EXTRACT(EPOCH FROM (
          created_at - 
          (event_data->>'created_at')::TIMESTAMP WITH TIME ZONE
        )) / 3600
      )::NUMERIC as avg_hours
    FROM analytics_events
    WHERE user_id = p_user_id
      AND event_type = 'task_completed'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND created_at BETWEEN p_start_date AND p_end_date
      AND event_data->>'created_at' IS NOT NULL
  )
  SELECT 
    COALESCE(c.created_count, 0),
    COALESCE(comp.completed_count, 0),
    CASE 
      WHEN COALESCE(c.created_count, 0) > 0 
      THEN ROUND((COALESCE(comp.completed_count, 0)::NUMERIC / c.created_count::NUMERIC) * 100, 2)
      ELSE 0
    END,
    ROUND(COALESCE(comp.avg_hours, 0), 2)
  FROM created_tasks c
  CROSS JOIN completed_tasks comp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get event counts by type
CREATE OR REPLACE FUNCTION get_event_counts_by_type(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  event_type VARCHAR,
  event_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ae.event_type,
    COUNT(*)::BIGINT as event_count
  FROM analytics_events ae
  WHERE ae.user_id = p_user_id
    AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
    AND ae.created_at BETWEEN p_start_date AND p_end_date
  GROUP BY ae.event_type
  ORDER BY event_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get daily activity
CREATE OR REPLACE FUNCTION get_daily_activity(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  activity_date DATE,
  event_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(ae.created_at) as activity_date,
    COUNT(*)::BIGINT as event_count
  FROM analytics_events ae
  WHERE ae.user_id = p_user_id
    AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
    AND ae.created_at BETWEEN p_start_date AND p_end_date
  GROUP BY DATE(ae.created_at)
  ORDER BY activity_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT SELECT, INSERT ON analytics_events TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_completion_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_counts_by_type TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_activity TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE analytics_events IS 'Stores user behavior events for analytics and insights';
COMMENT ON COLUMN analytics_events.event_type IS 'Type of event tracked (task_created, task_completed, etc.)';
COMMENT ON COLUMN analytics_events.event_data IS 'Additional event metadata stored as JSONB';
COMMENT ON FUNCTION get_task_completion_metrics IS 'Calculate task completion rate and average time to complete';
COMMENT ON FUNCTION get_event_counts_by_type IS 'Get event counts grouped by event type';
COMMENT ON FUNCTION get_daily_activity IS 'Get daily event counts for activity visualization';
