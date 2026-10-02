-- Migration: Task Templates System
-- Description: Allow users to create reusable task templates with subtasks and checklists
-- Version: 012
-- Date: 2024

-- =============================================
-- TASK TEMPLATES TABLE
-- =============================================
-- Stores template definitions

CREATE TABLE IF NOT EXISTS task_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- Template metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Template content (matches task structure)
    title_template VARCHAR(500) NOT NULL,
    description_template TEXT,
    
    -- Default task settings
    priority VARCHAR(20) CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
    estimated_hours NUMERIC(8, 2),
    
    -- Associations
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    default_assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Labels (array of label IDs to apply)
    default_label_ids UUID[],
    
    -- Custom fields (JSON with field_id: value pairs)
    default_custom_fields JSONB DEFAULT '{}'::jsonb,
    
    -- Template organization
    category VARCHAR(100), -- e.g., "Bug Report", "Feature Request", "Meeting Notes"
    tags TEXT[], -- Searchable tags
    icon VARCHAR(50),
    color VARCHAR(7),
    
    -- Visibility and usage
    is_public BOOLEAN DEFAULT FALSE, -- Public within workspace
    is_active BOOLEAN DEFAULT TRUE,
    use_count INTEGER DEFAULT 0, -- Track popularity
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_task_templates_workspace ON task_templates(workspace_id) WHERE is_active = TRUE;
CREATE INDEX idx_task_templates_category ON task_templates(category);
CREATE INDEX idx_task_templates_tags ON task_templates USING GIN(tags);
CREATE INDEX idx_task_templates_popular ON task_templates(workspace_id, use_count DESC);
CREATE INDEX idx_task_templates_creator ON task_templates(created_by);

-- =============================================
-- TEMPLATE SUBTASKS TABLE
-- =============================================
-- Stores subtask templates that will be created with the parent task

CREATE TABLE IF NOT EXISTS template_subtasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    
    -- Subtask content
    title VARCHAR(500) NOT NULL,
    description TEXT,
    
    -- Order in the subtask list
    display_order INTEGER DEFAULT 0,
    
    -- Default settings for subtask
    priority VARCHAR(20) CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
    estimated_hours NUMERIC(8, 2),
    
    -- Time offset from parent (e.g., start 2 days after parent)
    due_date_offset_days INTEGER, -- Null means no due date
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_template_subtasks_template ON template_subtasks(template_id);
CREATE INDEX idx_template_subtasks_order ON template_subtasks(template_id, display_order);

-- =============================================
-- TEMPLATE CHECKLIST ITEMS TABLE
-- =============================================
-- Stores checklist items for templates

CREATE TABLE IF NOT EXISTS template_checklist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    
    -- Checklist content
    title VARCHAR(500) NOT NULL,
    description TEXT,
    
    -- Order in the checklist
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_template_checklist_template ON template_checklist_items(template_id);
CREATE INDEX idx_template_checklist_order ON template_checklist_items(template_id, display_order);

-- =============================================
-- TEMPLATE USAGE HISTORY TABLE
-- =============================================
-- Track when templates are used

CREATE TABLE IF NOT EXISTS template_usage_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    
    -- Created task
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- User who used the template
    used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Optional: track modifications made during instantiation
    modifications JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_template_usage_template ON template_usage_history(template_id);
CREATE INDEX idx_template_usage_task ON template_usage_history(task_id);
CREATE INDEX idx_template_usage_user ON template_usage_history(used_by);
CREATE INDEX idx_template_usage_date ON template_usage_history(used_at DESC);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function: Create task from template
CREATE OR REPLACE FUNCTION create_task_from_template(
    p_template_id UUID,
    p_user_id UUID,
    p_workspace_id UUID,
    p_project_id UUID DEFAULT NULL,
    p_assignee_id UUID DEFAULT NULL,
    p_due_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_overrides JSONB DEFAULT '{}'::jsonb -- Allow overriding template values
) RETURNS UUID AS $$
DECLARE
    v_template RECORD;
    v_task_id UUID;
    v_subtask RECORD;
    v_checklist RECORD;
    v_subtask_id UUID;
    v_title TEXT;
    v_description TEXT;
BEGIN
    -- Get template
    SELECT * INTO v_template 
    FROM task_templates 
    WHERE id = p_template_id AND is_active = TRUE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found or inactive';
    END IF;
    
    -- Use overrides if provided, otherwise use template defaults
    v_title := COALESCE(p_overrides->>'title', v_template.title_template);
    v_description := COALESCE(p_overrides->>'description', v_template.description_template);
    
    -- Create main task
    INSERT INTO tasks (
        workspace_id,
        project_id,
        title,
        description,
        priority,
        estimated_hours,
        assigned_to,
        due_date,
        created_by
    ) VALUES (
        p_workspace_id,
        COALESCE(p_project_id, v_template.project_id),
        v_title,
        v_description,
        COALESCE((p_overrides->>'priority')::VARCHAR, v_template.priority, 'medium'),
        COALESCE((p_overrides->>'estimated_hours')::NUMERIC, v_template.estimated_hours),
        COALESCE(p_assignee_id, v_template.default_assignee_id),
        p_due_date,
        p_user_id
    ) RETURNING id INTO v_task_id;
    
    -- Apply default labels
    IF v_template.default_label_ids IS NOT NULL THEN
        INSERT INTO task_labels (task_id, label_id)
        SELECT v_task_id, unnest(v_template.default_label_ids)
        ON CONFLICT DO NOTHING;
    END IF;
    
    -- Apply custom fields
    IF v_template.default_custom_fields IS NOT NULL AND v_template.default_custom_fields != '{}'::jsonb THEN
        PERFORM bulk_set_custom_field_values(
            'task',
            v_task_id,
            v_template.default_custom_fields,
            p_user_id
        );
    END IF;
    
    -- Create subtasks
    FOR v_subtask IN 
        SELECT * FROM template_subtasks 
        WHERE template_id = p_template_id 
        ORDER BY display_order
    LOOP
        INSERT INTO tasks (
            workspace_id,
            project_id,
            parent_task_id,
            title,
            description,
            priority,
            estimated_hours,
            due_date,
            created_by
        ) VALUES (
            p_workspace_id,
            COALESCE(p_project_id, v_template.project_id),
            v_task_id,
            v_subtask.title,
            v_subtask.description,
            COALESCE(v_subtask.priority, 'medium'),
            v_subtask.estimated_hours,
            CASE 
                WHEN p_due_date IS NOT NULL AND v_subtask.due_date_offset_days IS NOT NULL 
                THEN p_due_date + (v_subtask.due_date_offset_days || ' days')::INTERVAL
                ELSE NULL
            END,
            p_user_id
        ) RETURNING id INTO v_subtask_id;
    END LOOP;
    
    -- Create checklist items (assuming tasks table has a checklist JSONB column)
    -- If not, this can be modified to use a separate checklist table
    DECLARE
        v_checklist_array JSONB := '[]'::jsonb;
        v_checklist_item JSONB;
    BEGIN
        FOR v_checklist IN 
            SELECT * FROM template_checklist_items 
            WHERE template_id = p_template_id 
            ORDER BY display_order
        LOOP
            v_checklist_item := jsonb_build_object(
                'title', v_checklist.title,
                'description', v_checklist.description,
                'completed', false,
                'order', v_checklist.display_order
            );
            v_checklist_array := v_checklist_array || v_checklist_item;
        END LOOP;
        
        -- Update task with checklist (only if checklist exists)
        IF jsonb_array_length(v_checklist_array) > 0 THEN
            UPDATE tasks 
            SET notes = jsonb_set(COALESCE(notes, '{}'::jsonb), '{checklist}', v_checklist_array)
            WHERE id = v_task_id;
        END IF;
    END;
    
    -- Update template usage count
    UPDATE task_templates 
    SET use_count = use_count + 1 
    WHERE id = p_template_id;
    
    -- Record usage history
    INSERT INTO template_usage_history (
        template_id,
        task_id,
        used_by,
        modifications
    ) VALUES (
        p_template_id,
        v_task_id,
        p_user_id,
        p_overrides
    );
    
    RETURN v_task_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Save existing task as template
CREATE OR REPLACE FUNCTION save_task_as_template(
    p_task_id UUID,
    p_user_id UUID,
    p_template_name VARCHAR(255),
    p_template_description TEXT DEFAULT NULL,
    p_category VARCHAR(100) DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
    v_task RECORD;
    v_template_id UUID;
    v_subtask RECORD;
    v_label_ids UUID[];
BEGIN
    -- Get task details
    SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found';
    END IF;
    
    -- Get task labels
    SELECT ARRAY_AGG(label_id) INTO v_label_ids
    FROM task_labels
    WHERE task_id = p_task_id;
    
    -- Create template
    INSERT INTO task_templates (
        workspace_id,
        name,
        description,
        title_template,
        description_template,
        priority,
        estimated_hours,
        project_id,
        default_assignee_id,
        default_label_ids,
        category,
        is_public,
        created_by
    ) VALUES (
        v_task.workspace_id,
        p_template_name,
        p_template_description,
        v_task.title,
        v_task.description,
        v_task.priority,
        v_task.estimated_hours,
        v_task.project_id,
        v_task.assigned_to,
        v_label_ids,
        p_category,
        p_is_public,
        p_user_id
    ) RETURNING id INTO v_template_id;
    
    -- Copy subtasks
    FOR v_subtask IN 
        SELECT * FROM tasks 
        WHERE parent_task_id = p_task_id 
        ORDER BY created_at
    LOOP
        INSERT INTO template_subtasks (
            template_id,
            title,
            description,
            display_order,
            priority,
            estimated_hours
        ) VALUES (
            v_template_id,
            v_subtask.title,
            v_subtask.description,
            (SELECT COUNT(*) FROM template_subtasks WHERE template_id = v_template_id),
            v_subtask.priority,
            v_subtask.estimated_hours
        );
    END LOOP;
    
    -- Copy custom fields
    DECLARE
        v_custom_fields JSONB;
    BEGIN
        SELECT jsonb_object_agg(custom_field_id::TEXT, value)
        INTO v_custom_fields
        FROM custom_field_values
        WHERE entity_type = 'task' AND entity_id = p_task_id;
        
        IF v_custom_fields IS NOT NULL THEN
            UPDATE task_templates
            SET default_custom_fields = v_custom_fields
            WHERE id = v_template_id;
        END IF;
    END;
    
    RETURN v_template_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get template with all details
CREATE OR REPLACE FUNCTION get_template_details(p_template_id UUID)
RETURNS TABLE (
    template_id UUID,
    template_name VARCHAR(255),
    template_description TEXT,
    title_template VARCHAR(500),
    description_template TEXT,
    priority VARCHAR(20),
    estimated_hours NUMERIC,
    category VARCHAR(100),
    tags TEXT[],
    use_count INTEGER,
    subtasks JSONB,
    checklist_items JSONB,
    custom_fields JSONB,
    label_ids UUID[],
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        tt.id,
        tt.name,
        tt.description,
        tt.title_template,
        tt.description_template,
        tt.priority,
        tt.estimated_hours,
        tt.category,
        tt.tags,
        tt.use_count,
        (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', ts.id,
                    'title', ts.title,
                    'description', ts.description,
                    'priority', ts.priority,
                    'estimated_hours', ts.estimated_hours,
                    'due_date_offset_days', ts.due_date_offset_days,
                    'display_order', ts.display_order
                ) ORDER BY ts.display_order
            ), '[]'::jsonb)
            FROM template_subtasks ts
            WHERE ts.template_id = tt.id
        ) as subtasks,
        (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', tci.id,
                    'title', tci.title,
                    'description', tci.description,
                    'display_order', tci.display_order
                ) ORDER BY tci.display_order
            ), '[]'::jsonb)
            FROM template_checklist_items tci
            WHERE tci.template_id = tt.id
        ) as checklist_items,
        tt.default_custom_fields,
        tt.default_label_ids,
        tt.created_by,
        tt.created_at
    FROM task_templates tt
    WHERE tt.id = p_template_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Duplicate template
CREATE OR REPLACE FUNCTION duplicate_template(
    p_template_id UUID,
    p_user_id UUID,
    p_new_name VARCHAR(255)
) RETURNS UUID AS $$
DECLARE
    v_new_template_id UUID;
    v_template RECORD;
BEGIN
    -- Get original template
    SELECT * INTO v_template FROM task_templates WHERE id = p_template_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;
    
    -- Create duplicate template
    INSERT INTO task_templates (
        workspace_id,
        name,
        description,
        title_template,
        description_template,
        priority,
        estimated_hours,
        project_id,
        default_assignee_id,
        default_label_ids,
        default_custom_fields,
        category,
        tags,
        icon,
        color,
        is_public,
        created_by
    ) SELECT
        workspace_id,
        p_new_name,
        description,
        title_template,
        description_template,
        priority,
        estimated_hours,
        project_id,
        default_assignee_id,
        default_label_ids,
        default_custom_fields,
        category,
        tags,
        icon,
        color,
        is_public,
        p_user_id
    FROM task_templates
    WHERE id = p_template_id
    RETURNING id INTO v_new_template_id;
    
    -- Copy subtasks
    INSERT INTO template_subtasks (
        template_id,
        title,
        description,
        display_order,
        priority,
        estimated_hours,
        due_date_offset_days
    )
    SELECT
        v_new_template_id,
        title,
        description,
        display_order,
        priority,
        estimated_hours,
        due_date_offset_days
    FROM template_subtasks
    WHERE template_id = p_template_id;
    
    -- Copy checklist items
    INSERT INTO template_checklist_items (
        template_id,
        title,
        description,
        display_order
    )
    SELECT
        v_new_template_id,
        title,
        description,
        display_order
    FROM template_checklist_items
    WHERE template_id = p_template_id;
    
    RETURN v_new_template_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS
-- =============================================

-- View: Popular templates
CREATE OR REPLACE VIEW popular_templates AS
SELECT 
    tt.id,
    tt.workspace_id,
    tt.name,
    tt.description,
    tt.category,
    tt.use_count,
    tt.is_public,
    COUNT(DISTINCT tuh.id) as usage_last_30_days,
    tt.created_at
FROM task_templates tt
LEFT JOIN template_usage_history tuh 
    ON tt.id = tuh.template_id 
    AND tuh.used_at > NOW() - INTERVAL '30 days'
WHERE tt.is_active = TRUE
GROUP BY tt.id
ORDER BY tt.use_count DESC, usage_last_30_days DESC;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_task_templates_updated
    BEFORE UPDATE ON task_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_template_timestamp();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_usage_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view templates in their workspaces (public or owned)
CREATE POLICY task_templates_select_policy ON task_templates
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
        AND (is_public = TRUE OR created_by = auth.uid())
    );

-- Policy: Users can create templates in their workspaces
CREATE POLICY task_templates_insert_policy ON task_templates
    FOR INSERT
    WITH CHECK (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can update their own templates or public templates if admin
CREATE POLICY task_templates_update_policy ON task_templates
    FOR UPDATE
    USING (
        created_by = auth.uid()
        OR (
            is_public = TRUE 
            AND workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid() 
                  AND role IN ('owner', 'admin')
            )
        )
    );

-- Policy: Users can delete their own templates
CREATE POLICY task_templates_delete_policy ON task_templates
    FOR DELETE
    USING (
        created_by = auth.uid()
        OR workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

-- Policy: Users can view subtasks of templates they can see
CREATE POLICY template_subtasks_select_policy ON template_subtasks
    FOR SELECT
    USING (
        template_id IN (
            SELECT id FROM task_templates
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
            AND (is_public = TRUE OR created_by = auth.uid())
        )
    );

-- Policy: Users can manage subtasks of their templates
CREATE POLICY template_subtasks_all_policy ON template_subtasks
    FOR ALL
    USING (
        template_id IN (
            SELECT id FROM task_templates WHERE created_by = auth.uid()
        )
    );

-- Policy: Same for checklist items
CREATE POLICY template_checklist_select_policy ON template_checklist_items
    FOR SELECT
    USING (
        template_id IN (
            SELECT id FROM task_templates
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
            AND (is_public = TRUE OR created_by = auth.uid())
        )
    );

CREATE POLICY template_checklist_all_policy ON template_checklist_items
    FOR ALL
    USING (
        template_id IN (
            SELECT id FROM task_templates WHERE created_by = auth.uid()
        )
    );

-- Policy: Users can view usage history in their workspaces
CREATE POLICY template_usage_select_policy ON template_usage_history
    FOR SELECT
    USING (
        template_id IN (
            SELECT id FROM task_templates
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

-- Policy: System inserts usage history (via function)
CREATE POLICY template_usage_insert_policy ON template_usage_history
    FOR INSERT
    WITH CHECK (true); -- Function handles security

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE task_templates IS 'Reusable task templates with subtasks and checklists';
COMMENT ON TABLE template_subtasks IS 'Subtask definitions for task templates';
COMMENT ON TABLE template_checklist_items IS 'Checklist item definitions for task templates';
COMMENT ON TABLE template_usage_history IS 'Audit trail of template usage';

COMMENT ON COLUMN task_templates.title_template IS 'Template for task title (can include placeholders)';
COMMENT ON COLUMN task_templates.default_custom_fields IS 'JSON with field_id: value pairs for custom fields';
COMMENT ON COLUMN task_templates.is_public IS 'Whether template is visible to all workspace members';
COMMENT ON COLUMN template_subtasks.due_date_offset_days IS 'Days to offset subtask due date from parent task';
