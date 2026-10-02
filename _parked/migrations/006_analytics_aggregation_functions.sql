-- Migration: Analytics Aggregation Functions
-- Description: Advanced queries for productivity insights and trends
-- Version: 006
-- Date: 2024-01-15

-- Function: Get productivity trends over time
CREATE OR REPLACE FUNCTION get_productivity_trends(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  week_start DATE,
  tasks_created INTEGER,
  tasks_completed INTEGER,
  completion_rate NUMERIC,
  total_events INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH weekly_data AS (
    SELECT 
      DATE_TRUNC('week', ae.created_at)::DATE as week_start,
      SUM(CASE WHEN ae.event_type = 'task_created' THEN 1 ELSE 0 END)::INTEGER as created,
      SUM(CASE WHEN ae.event_type = 'task_completed' THEN 1 ELSE 0 END)::INTEGER as completed,
      COUNT(*)::INTEGER as total
    FROM analytics_events ae
    WHERE ae.user_id = p_user_id
      AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
      AND ae.created_at BETWEEN p_start_date AND p_end_date
    GROUP BY DATE_TRUNC('week', ae.created_at)
  )
  SELECT 
    wd.week_start,
    wd.created,
    wd.completed,
    CASE 
      WHEN wd.created > 0 
      THEN ROUND((wd.completed::NUMERIC / wd.created::NUMERIC) * 100, 2)
      ELSE 0
    END as completion_rate,
    wd.total
  FROM weekly_data wd
  ORDER BY wd.week_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get task status distribution
CREATE OR REPLACE FUNCTION get_task_status_distribution(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  status VARCHAR,
  task_count INTEGER,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH status_counts AS (
    SELECT 
      t.status,
      COUNT(*)::INTEGER as count
    FROM tasks t
    WHERE t.created_by = p_user_id
      AND (p_workspace_id IS NULL OR t.workspace_id = p_workspace_id)
      AND t.deleted_at IS NULL
    GROUP BY t.status
  ),
  total_count AS (
    SELECT SUM(count)::INTEGER as total FROM status_counts
  )
  SELECT 
    sc.status,
    sc.count,
    ROUND((sc.count::NUMERIC / tc.total::NUMERIC) * 100, 2) as percentage
  FROM status_counts sc
  CROSS JOIN total_count tc
  ORDER BY sc.count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get task priority distribution
CREATE OR REPLACE FUNCTION get_task_priority_distribution(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  priority VARCHAR,
  task_count INTEGER,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH priority_counts AS (
    SELECT 
      COALESCE(t.priority, 'none') as priority,
      COUNT(*)::INTEGER as count
    FROM tasks t
    WHERE t.created_by = p_user_id
      AND (p_workspace_id IS NULL OR t.workspace_id = p_workspace_id)
      AND t.deleted_at IS NULL
    GROUP BY COALESCE(t.priority, 'none')
  ),
  total_count AS (
    SELECT SUM(count)::INTEGER as total FROM priority_counts
  )
  SELECT 
    pc.priority,
    pc.count,
    ROUND((pc.count::NUMERIC / tc.total::NUMERIC) * 100, 2) as percentage
  FROM priority_counts pc
  CROSS JOIN total_count tc
  ORDER BY 
    CASE pc.priority
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get most active hours
CREATE OR REPLACE FUNCTION get_most_active_hours(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  hour_of_day INTEGER,
  event_count BIGINT,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH hourly_counts AS (
    SELECT 
      EXTRACT(HOUR FROM ae.created_at)::INTEGER as hour,
      COUNT(*)::BIGINT as count
    FROM analytics_events ae
    WHERE ae.user_id = p_user_id
      AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
      AND ae.created_at BETWEEN p_start_date AND p_end_date
    GROUP BY EXTRACT(HOUR FROM ae.created_at)
  ),
  total_count AS (
    SELECT SUM(count)::BIGINT as total FROM hourly_counts
  )
  SELECT 
    hc.hour,
    hc.count,
    ROUND((hc.count::NUMERIC / tc.total::NUMERIC) * 100, 2) as percentage
  FROM hourly_counts hc
  CROSS JOIN total_count tc
  ORDER BY hc.count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get most active days of week
CREATE OR REPLACE FUNCTION get_most_active_days(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  day_of_week INTEGER,
  day_name TEXT,
  event_count BIGINT,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH daily_counts AS (
    SELECT 
      EXTRACT(DOW FROM ae.created_at)::INTEGER as dow,
      COUNT(*)::BIGINT as count
    FROM analytics_events ae
    WHERE ae.user_id = p_user_id
      AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
      AND ae.created_at BETWEEN p_start_date AND p_end_date
    GROUP BY EXTRACT(DOW FROM ae.created_at)
  ),
  total_count AS (
    SELECT SUM(count)::BIGINT as total FROM daily_counts
  )
  SELECT 
    dc.dow,
    CASE dc.dow
      WHEN 0 THEN 'Sunday'
      WHEN 1 THEN 'Monday'
      WHEN 2 THEN 'Tuesday'
      WHEN 3 THEN 'Wednesday'
      WHEN 4 THEN 'Thursday'
      WHEN 5 THEN 'Friday'
      WHEN 6 THEN 'Saturday'
    END as day_name,
    dc.count,
    ROUND((dc.count::NUMERIC / tc.total::NUMERIC) * 100, 2) as percentage
  FROM daily_counts dc
  CROSS JOIN total_count tc
  ORDER BY dc.dow;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get overdue tasks count
CREATE OR REPLACE FUNCTION get_overdue_tasks_count(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  overdue_count INTEGER,
  overdue_high_priority INTEGER,
  total_active_tasks INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE t.due_at < NOW())::INTEGER as overdue_count,
    COUNT(*) FILTER (WHERE t.due_at < NOW() AND t.priority = 'high')::INTEGER as overdue_high_priority,
    COUNT(*)::INTEGER as total_active_tasks
  FROM tasks t
  WHERE t.created_by = p_user_id
    AND (p_workspace_id IS NULL OR t.workspace_id = p_workspace_id)
    AND t.status NOT IN ('completed', 'cancelled')
    AND t.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get average tasks per day
CREATE OR REPLACE FUNCTION get_avg_tasks_per_day(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  avg_created_per_day NUMERIC,
  avg_completed_per_day NUMERIC,
  total_days INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT (p_end_date::DATE - p_start_date::DATE + 1) as days
  ),
  task_counts AS (
    SELECT 
      COUNT(*) FILTER (WHERE ae.event_type = 'task_created')::INTEGER as created,
      COUNT(*) FILTER (WHERE ae.event_type = 'task_completed')::INTEGER as completed
    FROM analytics_events ae
    WHERE ae.user_id = p_user_id
      AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
      AND ae.created_at BETWEEN p_start_date AND p_end_date
  )
  SELECT 
    ROUND(tc.created::NUMERIC / dr.days::NUMERIC, 2) as avg_created,
    ROUND(tc.completed::NUMERIC / dr.days::NUMERIC, 2) as avg_completed,
    dr.days::INTEGER as total_days
  FROM task_counts tc
  CROSS JOIN date_range dr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get completion streak (consecutive days with completions)
CREATE OR REPLACE FUNCTION get_completion_streak(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  current_streak INTEGER,
  longest_streak INTEGER,
  last_completion_date DATE
) AS $$
DECLARE
  v_current_streak INTEGER := 0;
  v_longest_streak INTEGER := 0;
  v_temp_streak INTEGER := 0;
  v_last_date DATE;
  v_prev_date DATE := NULL;
  v_completion_date DATE;
BEGIN
  -- Get all completion dates in descending order
  FOR v_completion_date IN
    SELECT DISTINCT DATE(ae.created_at) as completion_date
    FROM analytics_events ae
    WHERE ae.user_id = p_user_id
      AND (p_workspace_id IS NULL OR ae.workspace_id = p_workspace_id)
      AND ae.event_type = 'task_completed'
    ORDER BY completion_date DESC
  LOOP
    -- First iteration
    IF v_prev_date IS NULL THEN
      v_last_date := v_completion_date;
      v_temp_streak := 1;
      v_current_streak := 1;
    ELSE
      -- Check if consecutive
      IF v_prev_date - v_completion_date = 1 THEN
        v_temp_streak := v_temp_streak + 1;
        v_current_streak := v_temp_streak;
      ELSE
        -- Streak broken
        IF v_temp_streak > v_longest_streak THEN
          v_longest_streak := v_temp_streak;
        END IF;
        v_temp_streak := 1;
        -- Current streak only applies to most recent consecutive days
        v_current_streak := 0;
      END IF;
    END IF;
    
    v_prev_date := v_completion_date;
  END LOOP;
  
  -- Check final streak
  IF v_temp_streak > v_longest_streak THEN
    v_longest_streak := v_temp_streak;
  END IF;
  
  RETURN QUERY SELECT v_current_streak, v_longest_streak, v_last_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get workspace team activity summary
CREATE OR REPLACE FUNCTION get_workspace_team_activity(
  p_workspace_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  total_events INTEGER,
  tasks_created INTEGER,
  tasks_completed INTEGER,
  comments_added INTEGER,
  last_active TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ae.user_id,
    p.full_name,
    COUNT(*)::INTEGER as total_events,
    COUNT(*) FILTER (WHERE ae.event_type = 'task_created')::INTEGER as tasks_created,
    COUNT(*) FILTER (WHERE ae.event_type = 'task_completed')::INTEGER as tasks_completed,
    COUNT(*) FILTER (WHERE ae.event_type = 'comment_added')::INTEGER as comments_added,
    MAX(ae.created_at) as last_active
  FROM analytics_events ae
  JOIN profiles p ON p.id = ae.user_id
  WHERE ae.workspace_id = p_workspace_id
    AND ae.created_at BETWEEN p_start_date AND p_end_date
  GROUP BY ae.user_id, p.full_name
  ORDER BY total_events DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_productivity_trends TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_status_distribution TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_priority_distribution TO authenticated;
GRANT EXECUTE ON FUNCTION get_most_active_hours TO authenticated;
GRANT EXECUTE ON FUNCTION get_most_active_days TO authenticated;
GRANT EXECUTE ON FUNCTION get_overdue_tasks_count TO authenticated;
GRANT EXECUTE ON FUNCTION get_avg_tasks_per_day TO authenticated;
GRANT EXECUTE ON FUNCTION get_completion_streak TO authenticated;
GRANT EXECUTE ON FUNCTION get_workspace_team_activity TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION get_productivity_trends IS 'Get weekly productivity trends showing tasks created/completed';
COMMENT ON FUNCTION get_task_status_distribution IS 'Get distribution of tasks by status';
COMMENT ON FUNCTION get_task_priority_distribution IS 'Get distribution of tasks by priority';
COMMENT ON FUNCTION get_most_active_hours IS 'Get hours of day when user is most active';
COMMENT ON FUNCTION get_most_active_days IS 'Get days of week when user is most active';
COMMENT ON FUNCTION get_overdue_tasks_count IS 'Get count of overdue tasks';
COMMENT ON FUNCTION get_avg_tasks_per_day IS 'Get average tasks created/completed per day';
COMMENT ON FUNCTION get_completion_streak IS 'Get current and longest completion streaks';
COMMENT ON FUNCTION get_workspace_team_activity IS 'Get team activity summary for workspace';
