-- Migration: Time Tracking System
-- Description: Track time spent on tasks with start/stop timer and manual entries
-- Version: 013
-- Date: 2024

-- =============================================
-- TIME ENTRIES TABLE
-- =============================================
-- Stores time tracking entries for tasks

CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Task reference
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- User who tracked the time
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Time tracking
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER, -- Calculated from start/end or manually entered
    
    -- Entry type
    entry_type VARCHAR(20) NOT NULL DEFAULT 'timer' CHECK (entry_type IN ('timer', 'manual')),
    
    -- Billing
    is_billable BOOLEAN DEFAULT FALSE,
    hourly_rate NUMERIC(10, 2), -- Rate at time of entry
    
    -- Description
    description TEXT,
    
    -- Tags for categorization
    tags TEXT[],
    
    -- Status
    is_running BOOLEAN DEFAULT FALSE, -- True if timer is currently running
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_time_entries_task ON time_entries(task_id);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_workspace ON time_entries(workspace_id);
CREATE INDEX idx_time_entries_dates ON time_entries(start_time, end_time);
CREATE INDEX idx_time_entries_running ON time_entries(user_id, is_running) WHERE is_running = TRUE;
CREATE INDEX idx_time_entries_billable ON time_entries(workspace_id, is_billable) WHERE is_billable = TRUE;
CREATE INDEX idx_time_entries_tags ON time_entries USING GIN(tags);

-- Unique constraint: Only one running timer per user
CREATE UNIQUE INDEX idx_time_entries_one_running_per_user ON time_entries(user_id) WHERE is_running = TRUE;

-- =============================================
-- TIME ENTRY EDITS TABLE
-- =============================================
-- Audit trail for time entry modifications

CREATE TABLE IF NOT EXISTS time_entry_edits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    
    -- Changes made
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    
    -- Who made the change
    edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    edited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Reason
    edit_reason TEXT,
    
    ip_address INET,
    user_agent TEXT
);

-- Indexes
CREATE INDEX idx_time_entry_edits_entry ON time_entry_edits(time_entry_id);
CREATE INDEX idx_time_entry_edits_user ON time_entry_edits(edited_by);
CREATE INDEX idx_time_entry_edits_date ON time_entry_edits(edited_at DESC);

-- =============================================
-- WORKSPACE TIME SETTINGS TABLE
-- =============================================
-- Configure time tracking settings per workspace

CREATE TABLE IF NOT EXISTS workspace_time_settings (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- Time tracking settings
    allow_manual_entries BOOLEAN DEFAULT TRUE,
    require_description BOOLEAN DEFAULT FALSE,
    allow_billable BOOLEAN DEFAULT TRUE,
    default_hourly_rate NUMERIC(10, 2),
    
    -- Timer settings
    auto_stop_after_hours INTEGER DEFAULT 24, -- Auto-stop timers after X hours
    reminder_interval_minutes INTEGER, -- Remind users about running timers
    
    -- Rounding settings
    round_to_minutes INTEGER DEFAULT 1, -- Round time entries to nearest X minutes (1, 5, 15, etc.)
    
    -- Approval workflow
    require_approval BOOLEAN DEFAULT FALSE,
    approvers UUID[], -- User IDs who can approve time entries
    
    -- Restrictions
    allow_future_entries BOOLEAN DEFAULT FALSE,
    max_daily_hours NUMERIC(4, 2) DEFAULT 24.0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function: Start timer
CREATE OR REPLACE FUNCTION start_timer(
    p_task_id UUID,
    p_user_id UUID,
    p_description TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_workspace_id UUID;
    v_entry_id UUID;
    v_running_timer UUID;
BEGIN
    -- Get workspace from task
    SELECT workspace_id INTO v_workspace_id FROM tasks WHERE id = p_task_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;
    
    -- Check if user already has a running timer
    SELECT id INTO v_running_timer 
    FROM time_entries 
    WHERE user_id = p_user_id AND is_running = TRUE;
    
    IF v_running_timer IS NOT NULL THEN
        RAISE EXCEPTION 'User already has a running timer. Stop it first.';
    END IF;
    
    -- Create time entry
    INSERT INTO time_entries (
        task_id,
        workspace_id,
        user_id,
        start_time,
        entry_type,
        description,
        tags,
        is_running
    ) VALUES (
        p_task_id,
        v_workspace_id,
        p_user_id,
        NOW(),
        'timer',
        p_description,
        p_tags,
        TRUE
    ) RETURNING id INTO v_entry_id;
    
    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Stop timer
CREATE OR REPLACE FUNCTION stop_timer(
    p_entry_id UUID,
    p_user_id UUID
) RETURNS RECORD AS $$
DECLARE
    v_entry RECORD;
    v_duration INTEGER;
    v_round_to INTEGER;
BEGIN
    -- Get entry and verify ownership
    SELECT * INTO v_entry 
    FROM time_entries 
    WHERE id = p_entry_id AND user_id = p_user_id AND is_running = TRUE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timer not found or already stopped';
    END IF;
    
    -- Calculate duration
    v_duration := EXTRACT(EPOCH FROM (NOW() - v_entry.start_time))::INTEGER;
    
    -- Get rounding setting
    SELECT round_to_minutes INTO v_round_to
    FROM workspace_time_settings
    WHERE workspace_id = v_entry.workspace_id;
    
    v_round_to := COALESCE(v_round_to, 1);
    
    -- Round duration if needed
    IF v_round_to > 1 THEN
        v_duration := ROUND(v_duration::NUMERIC / (v_round_to * 60)) * (v_round_to * 60);
    END IF;
    
    -- Update entry
    UPDATE time_entries
    SET 
        end_time = NOW(),
        duration_seconds = v_duration,
        is_running = FALSE,
        updated_at = NOW()
    WHERE id = p_entry_id
    RETURNING * INTO v_entry;
    
    RETURN v_entry;
END;
$$ LANGUAGE plpgsql;

-- Function: Get running timer for user
CREATE OR REPLACE FUNCTION get_running_timer(p_user_id UUID)
RETURNS TABLE (
    entry_id UUID,
    task_id UUID,
    task_title VARCHAR(500),
    start_time TIMESTAMP WITH TIME ZONE,
    elapsed_seconds INTEGER,
    description TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        te.id,
        te.task_id,
        t.title,
        te.start_time,
        EXTRACT(EPOCH FROM (NOW() - te.start_time))::INTEGER,
        te.description
    FROM time_entries te
    JOIN tasks t ON te.task_id = t.id
    WHERE te.user_id = p_user_id AND te.is_running = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Add manual time entry
CREATE OR REPLACE FUNCTION add_manual_time_entry(
    p_task_id UUID,
    p_user_id UUID,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_description TEXT DEFAULT NULL,
    p_is_billable BOOLEAN DEFAULT FALSE,
    p_tags TEXT[] DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_workspace_id UUID;
    v_settings RECORD;
    v_duration INTEGER;
    v_entry_id UUID;
BEGIN
    -- Get workspace from task
    SELECT workspace_id INTO v_workspace_id FROM tasks WHERE id = p_task_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;
    
    -- Get workspace settings
    SELECT * INTO v_settings 
    FROM workspace_time_settings 
    WHERE workspace_id = v_workspace_id;
    
    -- Check if manual entries are allowed
    IF v_settings.allow_manual_entries = FALSE THEN
        RAISE EXCEPTION 'Manual time entries are not allowed in this workspace';
    END IF;
    
    -- Check if future entries are allowed
    IF v_settings.allow_future_entries = FALSE AND p_start_time > NOW() THEN
        RAISE EXCEPTION 'Future time entries are not allowed in this workspace';
    END IF;
    
    -- Validate time range
    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'End time must be after start time';
    END IF;
    
    -- Calculate duration
    v_duration := EXTRACT(EPOCH FROM (p_end_time - p_start_time))::INTEGER;
    
    -- Check max daily hours
    IF v_settings.max_daily_hours IS NOT NULL THEN
        IF (v_duration / 3600.0) > v_settings.max_daily_hours THEN
            RAISE EXCEPTION 'Time entry exceeds maximum daily hours';
        END IF;
    END IF;
    
    -- Check if description is required
    IF v_settings.require_description = TRUE AND (p_description IS NULL OR p_description = '') THEN
        RAISE EXCEPTION 'Description is required for time entries in this workspace';
    END IF;
    
    -- Create time entry
    INSERT INTO time_entries (
        task_id,
        workspace_id,
        user_id,
        start_time,
        end_time,
        duration_seconds,
        entry_type,
        description,
        is_billable,
        tags
    ) VALUES (
        p_task_id,
        v_workspace_id,
        p_user_id,
        p_start_time,
        p_end_time,
        v_duration,
        'manual',
        p_description,
        p_is_billable,
        p_tags
    ) RETURNING id INTO v_entry_id;
    
    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Update time entry with audit trail
CREATE OR REPLACE FUNCTION update_time_entry(
    p_entry_id UUID,
    p_user_id UUID,
    p_updates JSONB,
    p_edit_reason TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_entry RECORD;
    v_field TEXT;
    v_old_value TEXT;
    v_new_value TEXT;
BEGIN
    -- Get current entry
    SELECT * INTO v_entry FROM time_entries WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Time entry not found';
    END IF;
    
    -- Verify user owns the entry or is admin
    IF v_entry.user_id != p_user_id THEN
        -- Check if user is workspace admin
        IF NOT EXISTS (
            SELECT 1 FROM workspace_members 
            WHERE workspace_id = v_entry.workspace_id 
              AND user_id = p_user_id 
              AND role IN ('owner', 'admin')
        ) THEN
            RAISE EXCEPTION 'Not authorized to edit this time entry';
        END IF;
    END IF;
    
    -- Update fields and record changes
    FOR v_field IN SELECT jsonb_object_keys(p_updates)
    LOOP
        v_new_value := p_updates->>v_field;
        
        CASE v_field
            WHEN 'start_time' THEN
                v_old_value := v_entry.start_time::TEXT;
                UPDATE time_entries SET start_time = v_new_value::TIMESTAMP WITH TIME ZONE WHERE id = p_entry_id;
                
            WHEN 'end_time' THEN
                v_old_value := v_entry.end_time::TEXT;
                UPDATE time_entries SET end_time = v_new_value::TIMESTAMP WITH TIME ZONE WHERE id = p_entry_id;
                
            WHEN 'description' THEN
                v_old_value := v_entry.description;
                UPDATE time_entries SET description = v_new_value WHERE id = p_entry_id;
                
            WHEN 'is_billable' THEN
                v_old_value := v_entry.is_billable::TEXT;
                UPDATE time_entries SET is_billable = v_new_value::BOOLEAN WHERE id = p_entry_id;
                
            WHEN 'hourly_rate' THEN
                v_old_value := v_entry.hourly_rate::TEXT;
                UPDATE time_entries SET hourly_rate = v_new_value::NUMERIC WHERE id = p_entry_id;
                
            ELSE
                CONTINUE; -- Skip unknown fields
        END CASE;
        
        -- Record the edit
        INSERT INTO time_entry_edits (
            time_entry_id,
            field_name,
            old_value,
            new_value,
            edited_by,
            edit_reason,
            ip_address,
            user_agent
        ) VALUES (
            p_entry_id,
            v_field,
            v_old_value,
            v_new_value,
            p_user_id,
            p_edit_reason,
            p_ip_address,
            p_user_agent
        );
    END LOOP;
    
    -- Recalculate duration if times changed
    IF p_updates ? 'start_time' OR p_updates ? 'end_time' THEN
        UPDATE time_entries
        SET duration_seconds = EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER
        WHERE id = p_entry_id AND end_time IS NOT NULL;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Get time summary for task
CREATE OR REPLACE FUNCTION get_task_time_summary(p_task_id UUID)
RETURNS TABLE (
    total_seconds INTEGER,
    total_hours NUMERIC(10, 2),
    billable_seconds INTEGER,
    billable_hours NUMERIC(10, 2),
    entry_count INTEGER,
    last_entry_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(duration_seconds), 0)::INTEGER,
        COALESCE(SUM(duration_seconds) / 3600.0, 0)::NUMERIC(10, 2),
        COALESCE(SUM(duration_seconds) FILTER (WHERE is_billable = TRUE), 0)::INTEGER,
        COALESCE(SUM(duration_seconds) FILTER (WHERE is_billable = TRUE) / 3600.0, 0)::NUMERIC(10, 2),
        COUNT(*)::INTEGER,
        MAX(start_time)
    FROM time_entries
    WHERE task_id = p_task_id AND is_running = FALSE;
END;
$$ LANGUAGE plpgsql;

-- Function: Get time report for workspace
CREATE OR REPLACE FUNCTION get_workspace_time_report(
    p_workspace_id UUID,
    p_start_date TIMESTAMP WITH TIME ZONE,
    p_end_date TIMESTAMP WITH TIME ZONE,
    p_user_id UUID DEFAULT NULL,
    p_project_id UUID DEFAULT NULL
) RETURNS TABLE (
    user_id UUID,
    user_email VARCHAR,
    user_name VARCHAR,
    total_seconds INTEGER,
    total_hours NUMERIC(10, 2),
    billable_seconds INTEGER,
    billable_hours NUMERIC(10, 2),
    billable_amount NUMERIC(10, 2),
    entry_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        te.user_id,
        u.email,
        u.full_name,
        SUM(te.duration_seconds)::INTEGER,
        (SUM(te.duration_seconds) / 3600.0)::NUMERIC(10, 2),
        SUM(te.duration_seconds) FILTER (WHERE te.is_billable = TRUE)::INTEGER,
        (SUM(te.duration_seconds) FILTER (WHERE te.is_billable = TRUE) / 3600.0)::NUMERIC(10, 2),
        SUM((te.duration_seconds / 3600.0) * COALESCE(te.hourly_rate, 0))::NUMERIC(10, 2),
        COUNT(*)::INTEGER
    FROM time_entries te
    JOIN auth.users u ON te.user_id = u.id
    LEFT JOIN tasks t ON te.task_id = t.id
    WHERE te.workspace_id = p_workspace_id
      AND te.start_time >= p_start_date
      AND te.start_time < p_end_date
      AND te.is_running = FALSE
      AND (p_user_id IS NULL OR te.user_id = p_user_id)
      AND (p_project_id IS NULL OR t.project_id = p_project_id)
    GROUP BY te.user_id, u.email, u.full_name
    ORDER BY SUM(te.duration_seconds) DESC;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS
-- =============================================

-- View: Time entries with task and user details
CREATE OR REPLACE VIEW time_entries_detailed AS
SELECT 
    te.id,
    te.task_id,
    t.title as task_title,
    t.project_id,
    p.name as project_name,
    te.workspace_id,
    te.user_id,
    u.email as user_email,
    u.full_name as user_name,
    te.start_time,
    te.end_time,
    te.duration_seconds,
    (te.duration_seconds / 3600.0) as duration_hours,
    te.entry_type,
    te.is_billable,
    te.hourly_rate,
    ((te.duration_seconds / 3600.0) * COALESCE(te.hourly_rate, 0)) as billable_amount,
    te.description,
    te.tags,
    te.is_running,
    te.created_at,
    te.updated_at
FROM time_entries te
JOIN tasks t ON te.task_id = t.id
LEFT JOIN projects p ON t.project_id = p.id
JOIN auth.users u ON te.user_id = u.id;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_time_entry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_time_entries_updated
    BEFORE UPDATE ON time_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_time_entry_timestamp();

CREATE TRIGGER trigger_workspace_time_settings_updated
    BEFORE UPDATE ON workspace_time_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_time_entry_timestamp();

-- Trigger: Auto-stop old running timers (run periodically via cron)
CREATE OR REPLACE FUNCTION auto_stop_old_timers()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_entry RECORD;
BEGIN
    FOR v_entry IN 
        SELECT te.id, wts.auto_stop_after_hours
        FROM time_entries te
        JOIN workspace_time_settings wts ON te.workspace_id = wts.workspace_id
        WHERE te.is_running = TRUE
          AND wts.auto_stop_after_hours IS NOT NULL
          AND te.start_time < NOW() - (wts.auto_stop_after_hours || ' hours')::INTERVAL
    LOOP
        PERFORM stop_timer(v_entry.id, (SELECT user_id FROM time_entries WHERE id = v_entry.id));
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_time_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view time entries in their workspaces
CREATE POLICY time_entries_select_policy ON time_entries
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can create their own time entries
CREATE POLICY time_entries_insert_policy ON time_entries
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own time entries
CREATE POLICY time_entries_update_policy ON time_entries
    FOR UPDATE
    USING (
        user_id = auth.uid()
        OR workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

-- Policy: Users can delete their own time entries
CREATE POLICY time_entries_delete_policy ON time_entries
    FOR DELETE
    USING (
        user_id = auth.uid()
        OR workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

-- Policy: Users can view edit history for entries they can see
CREATE POLICY time_entry_edits_select_policy ON time_entry_edits
    FOR SELECT
    USING (
        time_entry_id IN (
            SELECT id FROM time_entries
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

-- Policy: Workspace admins can manage time settings
CREATE POLICY workspace_time_settings_select_policy ON workspace_time_settings
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY workspace_time_settings_all_policy ON workspace_time_settings
    FOR ALL
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE time_entries IS 'Time tracking entries for tasks';
COMMENT ON TABLE time_entry_edits IS 'Audit trail for time entry modifications';
COMMENT ON TABLE workspace_time_settings IS 'Time tracking configuration per workspace';

COMMENT ON COLUMN time_entries.duration_seconds IS 'Duration in seconds (calculated or manually entered)';
COMMENT ON COLUMN time_entries.is_running IS 'True if timer is currently active';
COMMENT ON COLUMN time_entries.is_billable IS 'Whether this time should be billed';
COMMENT ON COLUMN workspace_time_settings.round_to_minutes IS 'Round time entries to nearest X minutes';
COMMENT ON COLUMN workspace_time_settings.auto_stop_after_hours IS 'Auto-stop running timers after X hours';
