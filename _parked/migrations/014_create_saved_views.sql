-- Migration: Saved Views/Filters System
-- Description: Allow users to save complex filter combinations and custom views
-- Version: 014
-- Date: 2024

-- =============================================
-- SAVED VIEWS TABLE
-- =============================================
-- Stores saved filter/view configurations

CREATE TABLE IF NOT EXISTS saved_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- View metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(7),
    
    -- View type
    view_type VARCHAR(50) NOT NULL DEFAULT 'list' CHECK (view_type IN ('list', 'board', 'calendar', 'timeline', 'table')),
    
    -- Entity type this view applies to
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('tasks', 'projects')),
    
    -- Filter configuration (JSON)
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Example filters:
    -- {
    --   "status": ["todo", "in_progress"],
    --   "priority": ["high", "urgent"],
    --   "assigned_to": ["user_id_1", "user_id_2"],
    --   "labels": ["label_id_1"],
    --   "project_id": "project_id",
    --   "due_date": {"from": "2024-01-01", "to": "2024-12-31"},
    --   "custom_fields": {
    --     "field_id_1": "value",
    --     "field_id_2": {"operator": ">=", "value": 100}
    --   },
    --   "search": "keyword",
    --   "has_attachments": true,
    --   "is_completed": false
    -- }
    
    -- Sort configuration
    sort_by VARCHAR(100) DEFAULT 'created_at',
    sort_order VARCHAR(10) DEFAULT 'desc' CHECK (sort_order IN ('asc', 'desc')),
    
    -- Grouping configuration
    group_by VARCHAR(100), -- e.g., "status", "assignee", "priority", "project", "label"
    
    -- Display columns (for table view)
    visible_columns TEXT[], -- Column IDs to show
    column_widths JSONB, -- Column width preferences
    
    -- Visibility and sharing
    is_public BOOLEAN DEFAULT FALSE, -- Public within workspace
    is_default BOOLEAN DEFAULT FALSE, -- Default view for user
    
    -- Owner
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Usage tracking
    use_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_saved_views_workspace ON saved_views(workspace_id);
CREATE INDEX idx_saved_views_creator ON saved_views(created_by);
CREATE INDEX idx_saved_views_type ON saved_views(entity_type, view_type);
CREATE INDEX idx_saved_views_public ON saved_views(workspace_id, is_public) WHERE is_public = TRUE;
CREATE INDEX idx_saved_views_default ON saved_views(created_by, entity_type) WHERE is_default = TRUE;
CREATE INDEX idx_saved_views_filters ON saved_views USING GIN(filters);

-- Unique constraint: One default view per user per entity type
CREATE UNIQUE INDEX idx_saved_views_one_default_per_user ON saved_views(created_by, entity_type) WHERE is_default = TRUE;

-- =============================================
-- VIEW SHARES TABLE
-- =============================================
-- Share views with specific users or teams

CREATE TABLE IF NOT EXISTS view_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    view_id UUID NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
    
    -- Share with user or entire workspace
    shared_with_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    shared_with_workspace BOOLEAN DEFAULT FALSE,
    
    -- Permissions
    can_edit BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shared_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_view_shares_view ON view_shares(view_id);
CREATE INDEX idx_view_shares_user ON view_shares(shared_with_user_id);
CREATE INDEX idx_view_shares_workspace ON view_shares(view_id) WHERE shared_with_workspace = TRUE;

-- Unique constraint: One share per view per user
CREATE UNIQUE INDEX idx_view_shares_unique ON view_shares(view_id, shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;

-- =============================================
-- VIEW FAVORITES TABLE
-- =============================================
-- Track user favorites for quick access

CREATE TABLE IF NOT EXISTS view_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    view_id UUID NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
    
    -- Display order in favorites list
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_view_favorites_user ON view_favorites(user_id);
CREATE INDEX idx_view_favorites_view ON view_favorites(view_id);
CREATE INDEX idx_view_favorites_order ON view_favorites(user_id, display_order);

-- Unique constraint: One favorite per user per view
CREATE UNIQUE INDEX idx_view_favorites_unique ON view_favorites(user_id, view_id);

-- =============================================
-- SAVED FILTERS TABLE (Simpler than full views)
-- =============================================
-- Quick filters that can be combined

CREATE TABLE IF NOT EXISTS saved_filters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- Filter metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Entity type
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('tasks', 'projects')),
    
    -- Single filter criterion
    filter_field VARCHAR(100) NOT NULL, -- e.g., "status", "priority", "assigned_to"
    filter_operator VARCHAR(20) NOT NULL, -- e.g., "equals", "contains", "greater_than", "in"
    filter_value JSONB NOT NULL, -- Value(s) to filter by
    
    -- Visibility
    is_public BOOLEAN DEFAULT FALSE,
    
    -- Owner
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_saved_filters_workspace ON saved_filters(workspace_id);
CREATE INDEX idx_saved_filters_creator ON saved_filters(created_by);
CREATE INDEX idx_saved_filters_type ON saved_filters(entity_type);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function: Set view as default
CREATE OR REPLACE FUNCTION set_default_view(
    p_view_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_view RECORD;
BEGIN
    -- Get view details
    SELECT * INTO v_view FROM saved_views WHERE id = p_view_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'View not found';
    END IF;
    
    -- Verify user owns the view or has access
    IF v_view.created_by != p_user_id THEN
        IF NOT EXISTS (
            SELECT 1 FROM view_shares 
            WHERE view_id = p_view_id 
              AND shared_with_user_id = p_user_id
        ) AND v_view.is_public = FALSE THEN
            RAISE EXCEPTION 'Not authorized to set this view as default';
        END IF;
    END IF;
    
    -- Unset current default for this entity type
    UPDATE saved_views
    SET is_default = FALSE
    WHERE created_by = p_user_id 
      AND entity_type = v_view.entity_type 
      AND is_default = TRUE;
    
    -- Set new default
    UPDATE saved_views
    SET is_default = TRUE
    WHERE id = p_view_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Duplicate view
CREATE OR REPLACE FUNCTION duplicate_view(
    p_view_id UUID,
    p_user_id UUID,
    p_new_name VARCHAR(255)
) RETURNS UUID AS $$
DECLARE
    v_new_view_id UUID;
BEGIN
    INSERT INTO saved_views (
        workspace_id,
        name,
        description,
        icon,
        color,
        view_type,
        entity_type,
        filters,
        sort_by,
        sort_order,
        group_by,
        visible_columns,
        column_widths,
        is_public,
        created_by
    )
    SELECT
        workspace_id,
        p_new_name,
        description,
        icon,
        color,
        view_type,
        entity_type,
        filters,
        sort_by,
        sort_order,
        group_by,
        visible_columns,
        column_widths,
        FALSE, -- New view is private by default
        p_user_id
    FROM saved_views
    WHERE id = p_view_id
    RETURNING id INTO v_new_view_id;
    
    RETURN v_new_view_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Track view usage
CREATE OR REPLACE FUNCTION track_view_usage(p_view_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE saved_views
    SET 
        use_count = use_count + 1,
        last_used_at = NOW()
    WHERE id = p_view_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get user's accessible views
CREATE OR REPLACE FUNCTION get_user_views(
    p_user_id UUID,
    p_workspace_id UUID,
    p_entity_type VARCHAR(20) DEFAULT NULL
) RETURNS TABLE (
    view_id UUID,
    view_name VARCHAR(255),
    view_description TEXT,
    view_type VARCHAR(50),
    entity_type VARCHAR(20),
    filters JSONB,
    sort_by VARCHAR(100),
    sort_order VARCHAR(10),
    group_by VARCHAR(100),
    is_public BOOLEAN,
    is_default BOOLEAN,
    is_favorite BOOLEAN,
    is_owner BOOLEAN,
    can_edit BOOLEAN,
    use_count INTEGER,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    creator_name VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sv.id,
        sv.name,
        sv.description,
        sv.view_type,
        sv.entity_type,
        sv.filters,
        sv.sort_by,
        sv.sort_order,
        sv.group_by,
        sv.is_public,
        sv.is_default,
        EXISTS(SELECT 1 FROM view_favorites WHERE view_id = sv.id AND user_id = p_user_id) as is_favorite,
        (sv.created_by = p_user_id) as is_owner,
        (
            sv.created_by = p_user_id 
            OR EXISTS(
                SELECT 1 FROM view_shares 
                WHERE view_id = sv.id 
                  AND shared_with_user_id = p_user_id 
                  AND can_edit = TRUE
            )
        ) as can_edit,
        sv.use_count,
        sv.last_used_at,
        sv.created_by,
        u.full_name,
        sv.created_at
    FROM saved_views sv
    JOIN auth.users u ON sv.created_by = u.id
    WHERE sv.workspace_id = p_workspace_id
      AND (p_entity_type IS NULL OR sv.entity_type = p_entity_type)
      AND (
          -- User owns the view
          sv.created_by = p_user_id
          -- Or view is public
          OR sv.is_public = TRUE
          -- Or view is shared with user
          OR EXISTS(
              SELECT 1 FROM view_shares 
              WHERE view_id = sv.id 
                AND shared_with_user_id = p_user_id
          )
          -- Or view is shared with workspace
          OR EXISTS(
              SELECT 1 FROM view_shares 
              WHERE view_id = sv.id 
                AND shared_with_workspace = TRUE
          )
      )
    ORDER BY 
        sv.is_default DESC, 
        is_favorite DESC, 
        sv.use_count DESC,
        sv.name;
END;
$$ LANGUAGE plpgsql;

-- Function: Apply filters to build WHERE clause (helper for API)
CREATE OR REPLACE FUNCTION build_filter_conditions(p_filters JSONB)
RETURNS TEXT AS $$
DECLARE
    v_conditions TEXT[] := ARRAY[]::TEXT[];
    v_key TEXT;
    v_value JSONB;
    v_condition TEXT;
BEGIN
    -- This function returns SQL conditions as text
    -- In practice, the API layer would parse the filters JSON
    -- and build the appropriate Supabase query
    
    -- Example implementation for documentation:
    FOR v_key, v_value IN SELECT * FROM jsonb_each(p_filters)
    LOOP
        CASE v_key
            WHEN 'status' THEN
                v_condition := format('status = ANY(%L)', v_value);
            WHEN 'priority' THEN
                v_condition := format('priority = ANY(%L)', v_value);
            WHEN 'assigned_to' THEN
                v_condition := format('assigned_to = ANY(%L)', v_value);
            -- Add more cases as needed
            ELSE
                CONTINUE;
        END CASE;
        
        v_conditions := array_append(v_conditions, v_condition);
    END LOOP;
    
    IF array_length(v_conditions, 1) > 0 THEN
        RETURN array_to_string(v_conditions, ' AND ');
    ELSE
        RETURN 'TRUE';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS
-- =============================================

-- View: Public views summary
CREATE OR REPLACE VIEW public_views_summary AS
SELECT 
    sv.id,
    sv.workspace_id,
    sv.name,
    sv.description,
    sv.view_type,
    sv.entity_type,
    sv.use_count,
    sv.created_by,
    u.full_name as creator_name,
    COUNT(DISTINCT vf.user_id) as favorite_count,
    sv.created_at
FROM saved_views sv
JOIN auth.users u ON sv.created_by = u.id
LEFT JOIN view_favorites vf ON sv.id = vf.view_id
WHERE sv.is_public = TRUE
GROUP BY sv.id, u.full_name
ORDER BY sv.use_count DESC, favorite_count DESC;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_saved_view_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_saved_views_updated
    BEFORE UPDATE ON saved_views
    FOR EACH ROW
    EXECUTE FUNCTION update_saved_view_timestamp();

-- Trigger: Prevent multiple defaults per user per entity type
CREATE OR REPLACE FUNCTION enforce_single_default_view()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = TRUE THEN
        UPDATE saved_views
        SET is_default = FALSE
        WHERE created_by = NEW.created_by
          AND entity_type = NEW.entity_type
          AND id != NEW.id
          AND is_default = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_single_default
    BEFORE INSERT OR UPDATE ON saved_views
    FOR EACH ROW
    WHEN (NEW.is_default = TRUE)
    EXECUTE FUNCTION enforce_single_default_view();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own views, public views, and shared views
CREATE POLICY saved_views_select_policy ON saved_views
    FOR SELECT
    USING (
        created_by = auth.uid()
        OR is_public = TRUE
        OR id IN (
            SELECT view_id FROM view_shares 
            WHERE shared_with_user_id = auth.uid()
        )
        OR id IN (
            SELECT vs.view_id FROM view_shares vs
            JOIN saved_views sv ON vs.view_id = sv.id
            WHERE vs.shared_with_workspace = TRUE
              AND sv.workspace_id IN (
                  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
              )
        )
    );

-- Policy: Users can create views in their workspaces
CREATE POLICY saved_views_insert_policy ON saved_views
    FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can update their own views or views they have edit permission on
CREATE POLICY saved_views_update_policy ON saved_views
    FOR UPDATE
    USING (
        created_by = auth.uid()
        OR id IN (
            SELECT view_id FROM view_shares 
            WHERE shared_with_user_id = auth.uid() 
              AND can_edit = TRUE
        )
    );

-- Policy: Users can delete their own views
CREATE POLICY saved_views_delete_policy ON saved_views
    FOR DELETE
    USING (created_by = auth.uid());

-- Policy: View shares
CREATE POLICY view_shares_select_policy ON view_shares
    FOR SELECT
    USING (
        shared_with_user_id = auth.uid()
        OR shared_by = auth.uid()
        OR view_id IN (SELECT id FROM saved_views WHERE created_by = auth.uid())
    );

CREATE POLICY view_shares_all_policy ON view_shares
    FOR ALL
    USING (
        view_id IN (SELECT id FROM saved_views WHERE created_by = auth.uid())
    );

-- Policy: View favorites
CREATE POLICY view_favorites_all_policy ON view_favorites
    FOR ALL
    USING (user_id = auth.uid());

-- Policy: Saved filters (similar to views)
CREATE POLICY saved_filters_select_policy ON saved_filters
    FOR SELECT
    USING (
        created_by = auth.uid()
        OR is_public = TRUE
    );

CREATE POLICY saved_filters_insert_policy ON saved_filters
    FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY saved_filters_update_policy ON saved_filters
    FOR UPDATE
    USING (created_by = auth.uid());

CREATE POLICY saved_filters_delete_policy ON saved_filters
    FOR DELETE
    USING (created_by = auth.uid());

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE saved_views IS 'Saved filter combinations and custom views for tasks/projects';
COMMENT ON TABLE view_shares IS 'Share views with specific users or entire workspace';
COMMENT ON TABLE view_favorites IS 'User favorites for quick access to views';
COMMENT ON TABLE saved_filters IS 'Quick filters that can be combined';

COMMENT ON COLUMN saved_views.filters IS 'JSON configuration of all filter criteria';
COMMENT ON COLUMN saved_views.group_by IS 'Field to group by (status, assignee, priority, etc.)';
COMMENT ON COLUMN saved_views.visible_columns IS 'Array of column IDs to display in table view';
COMMENT ON COLUMN saved_views.is_default IS 'Default view for user for this entity type';
