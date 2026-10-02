-- Migration: Custom Fields System
-- Description: Allow workspaces to define custom fields and attach values to tasks
-- Version: 011
-- Date: 2024

-- =============================================
-- CUSTOM FIELD DEFINITIONS TABLE
-- =============================================
-- Stores field definitions at workspace level

CREATE TABLE IF NOT EXISTS custom_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    field_type VARCHAR(20) NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'datetime', 'dropdown', 'checkbox', 'url', 'email', 'phone')),
    
    -- Configuration for different field types
    config JSONB DEFAULT '{}'::jsonb,
    -- Examples:
    -- For dropdown: {"options": ["Option 1", "Option 2", "Option 3"], "allow_multiple": false}
    -- For number: {"min": 0, "max": 100, "decimal_places": 2, "prefix": "$", "suffix": "USD"}
    -- For text: {"max_length": 500, "multiline": true}
    -- For date: {"include_time": false, "min_date": "2024-01-01", "max_date": "2025-12-31"}
    
    -- Validation and behavior
    is_required BOOLEAN DEFAULT FALSE,
    default_value TEXT,
    
    -- Display options
    icon VARCHAR(50),
    color VARCHAR(7), -- Hex color code
    display_order INTEGER DEFAULT 0,
    
    -- Scope: which task types can use this field
    applies_to_projects BOOLEAN DEFAULT TRUE,
    applies_to_tasks BOOLEAN DEFAULT TRUE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_custom_fields_workspace ON custom_fields(workspace_id) WHERE is_active = TRUE;
CREATE INDEX idx_custom_fields_type ON custom_fields(field_type);
CREATE INDEX idx_custom_fields_order ON custom_fields(workspace_id, display_order);

-- Unique constraint: field name per workspace
CREATE UNIQUE INDEX idx_custom_fields_unique_name ON custom_fields(workspace_id, LOWER(name)) WHERE is_active = TRUE;

-- =============================================
-- CUSTOM FIELD VALUES TABLE
-- =============================================
-- Stores actual field values for tasks/projects

CREATE TABLE IF NOT EXISTS custom_field_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    
    -- Entity reference (task or project)
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('task', 'project')),
    entity_id UUID NOT NULL,
    
    -- Value storage (stored as text, converted based on field type)
    value TEXT,
    value_numeric NUMERIC(20, 6), -- For number fields
    value_date TIMESTAMP WITH TIME ZONE, -- For date/datetime fields
    value_boolean BOOLEAN, -- For checkbox fields
    value_array TEXT[], -- For multi-select dropdowns
    
    -- Metadata
    set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_custom_field_values_field ON custom_field_values(custom_field_id);
CREATE INDEX idx_custom_field_values_entity ON custom_field_values(entity_type, entity_id);
CREATE INDEX idx_custom_field_values_numeric ON custom_field_values(value_numeric) WHERE value_numeric IS NOT NULL;
CREATE INDEX idx_custom_field_values_date ON custom_field_values(value_date) WHERE value_date IS NOT NULL;

-- Unique constraint: one value per field per entity
CREATE UNIQUE INDEX idx_custom_field_values_unique ON custom_field_values(custom_field_id, entity_type, entity_id);

-- =============================================
-- CUSTOM FIELD HISTORY TABLE
-- =============================================
-- Track changes to custom field values

CREATE TABLE IF NOT EXISTS custom_field_value_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    entity_type VARCHAR(20) NOT NULL,
    entity_id UUID NOT NULL,
    
    old_value TEXT,
    new_value TEXT,
    
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    ip_address INET,
    user_agent TEXT
);

-- Indexes
CREATE INDEX idx_custom_field_history_field ON custom_field_value_history(custom_field_id);
CREATE INDEX idx_custom_field_history_entity ON custom_field_value_history(entity_type, entity_id);
CREATE INDEX idx_custom_field_history_date ON custom_field_value_history(changed_at DESC);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function: Validate custom field value
CREATE OR REPLACE FUNCTION validate_custom_field_value(
    p_field_id UUID,
    p_value TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_field RECORD;
    v_config JSONB;
    v_options TEXT[];
    v_numeric_value NUMERIC;
    v_min NUMERIC;
    v_max NUMERIC;
BEGIN
    -- Get field definition
    SELECT * INTO v_field FROM custom_fields WHERE id = p_field_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Custom field not found';
    END IF;
    
    -- Check if required but empty
    IF v_field.is_required AND (p_value IS NULL OR p_value = '') THEN
        RETURN FALSE;
    END IF;
    
    -- Allow empty for non-required fields
    IF p_value IS NULL OR p_value = '' THEN
        RETURN TRUE;
    END IF;
    
    v_config := v_field.config;
    
    -- Validate based on field type
    CASE v_field.field_type
        WHEN 'text' THEN
            -- Check max length
            IF v_config ? 'max_length' THEN
                IF LENGTH(p_value) > (v_config->>'max_length')::INTEGER THEN
                    RETURN FALSE;
                END IF;
            END IF;
            
        WHEN 'number' THEN
            -- Check if numeric
            BEGIN
                v_numeric_value := p_value::NUMERIC;
            EXCEPTION WHEN OTHERS THEN
                RETURN FALSE;
            END;
            
            -- Check min/max
            IF v_config ? 'min' THEN
                v_min := (v_config->>'min')::NUMERIC;
                IF v_numeric_value < v_min THEN
                    RETURN FALSE;
                END IF;
            END IF;
            
            IF v_config ? 'max' THEN
                v_max := (v_config->>'max')::NUMERIC;
                IF v_numeric_value > v_max THEN
                    RETURN FALSE;
                END IF;
            END IF;
            
        WHEN 'date', 'datetime' THEN
            -- Check if valid date
            BEGIN
                PERFORM p_value::TIMESTAMP WITH TIME ZONE;
            EXCEPTION WHEN OTHERS THEN
                RETURN FALSE;
            END;
            
        WHEN 'dropdown' THEN
            -- Check if value is in options
            IF v_config ? 'options' THEN
                v_options := ARRAY(SELECT jsonb_array_elements_text(v_config->'options'));
                IF NOT p_value = ANY(v_options) THEN
                    RETURN FALSE;
                END IF;
            END IF;
            
        WHEN 'checkbox' THEN
            -- Check if boolean
            IF p_value NOT IN ('true', 'false', 't', 'f', '1', '0', 'yes', 'no') THEN
                RETURN FALSE;
            END IF;
            
        WHEN 'email' THEN
            -- Basic email validation
            IF p_value !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
                RETURN FALSE;
            END IF;
            
        WHEN 'url' THEN
            -- Basic URL validation
            IF p_value !~ '^https?://.+' THEN
                RETURN FALSE;
            END IF;
            
        WHEN 'phone' THEN
            -- Remove common formatting characters
            IF REGEXP_REPLACE(p_value, '[^0-9+]', '', 'g') = '' THEN
                RETURN FALSE;
            END IF;
    END CASE;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Set custom field value with validation and history
CREATE OR REPLACE FUNCTION set_custom_field_value(
    p_field_id UUID,
    p_entity_type VARCHAR(20),
    p_entity_id UUID,
    p_value TEXT,
    p_user_id UUID,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_field RECORD;
    v_old_value TEXT;
    v_value_id UUID;
    v_numeric_value NUMERIC;
    v_date_value TIMESTAMP WITH TIME ZONE;
    v_boolean_value BOOLEAN;
BEGIN
    -- Get field definition
    SELECT * INTO v_field FROM custom_fields WHERE id = p_field_id AND is_active = TRUE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Custom field not found or inactive';
    END IF;
    
    -- Validate value
    IF NOT validate_custom_field_value(p_field_id, p_value) THEN
        RAISE EXCEPTION 'Invalid value for custom field';
    END IF;
    
    -- Get old value for history
    SELECT value INTO v_old_value 
    FROM custom_field_values 
    WHERE custom_field_id = p_field_id 
      AND entity_type = p_entity_type 
      AND entity_id = p_entity_id;
    
    -- Convert value based on field type
    CASE v_field.field_type
        WHEN 'number' THEN
            v_numeric_value := p_value::NUMERIC;
        WHEN 'date', 'datetime' THEN
            v_date_value := p_value::TIMESTAMP WITH TIME ZONE;
        WHEN 'checkbox' THEN
            v_boolean_value := p_value::BOOLEAN;
        ELSE
            NULL; -- Other types use text value
    END CASE;
    
    -- Insert or update value
    INSERT INTO custom_field_values (
        custom_field_id,
        entity_type,
        entity_id,
        value,
        value_numeric,
        value_date,
        value_boolean,
        set_by,
        updated_at
    ) VALUES (
        p_field_id,
        p_entity_type,
        p_entity_id,
        p_value,
        v_numeric_value,
        v_date_value,
        v_boolean_value,
        p_user_id,
        NOW()
    )
    ON CONFLICT (custom_field_id, entity_type, entity_id)
    DO UPDATE SET
        value = EXCLUDED.value,
        value_numeric = EXCLUDED.value_numeric,
        value_date = EXCLUDED.value_date,
        value_boolean = EXCLUDED.value_boolean,
        set_by = EXCLUDED.set_by,
        updated_at = NOW()
    RETURNING id INTO v_value_id;
    
    -- Record history (only if value changed)
    IF v_old_value IS DISTINCT FROM p_value THEN
        INSERT INTO custom_field_value_history (
            custom_field_id,
            entity_type,
            entity_id,
            old_value,
            new_value,
            changed_by,
            ip_address,
            user_agent
        ) VALUES (
            p_field_id,
            p_entity_type,
            p_entity_id,
            v_old_value,
            p_value,
            p_user_id,
            p_ip_address,
            p_user_agent
        );
    END IF;
    
    RETURN v_value_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get all custom field values for an entity
CREATE OR REPLACE FUNCTION get_entity_custom_fields(
    p_entity_type VARCHAR(20),
    p_entity_id UUID
) RETURNS TABLE (
    field_id UUID,
    field_name VARCHAR(100),
    field_type VARCHAR(20),
    value TEXT,
    value_numeric NUMERIC,
    value_date TIMESTAMP WITH TIME ZONE,
    value_boolean BOOLEAN,
    field_config JSONB,
    is_required BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cf.id,
        cf.name,
        cf.field_type,
        cfv.value,
        cfv.value_numeric,
        cfv.value_date,
        cfv.value_boolean,
        cf.config,
        cf.is_required
    FROM custom_fields cf
    LEFT JOIN custom_field_values cfv 
        ON cf.id = cfv.custom_field_id 
        AND cfv.entity_type = p_entity_type
        AND cfv.entity_id = p_entity_id
    WHERE cf.is_active = TRUE
    ORDER BY cf.display_order, cf.name;
END;
$$ LANGUAGE plpgsql;

-- Function: Bulk set custom field values
CREATE OR REPLACE FUNCTION bulk_set_custom_field_values(
    p_entity_type VARCHAR(20),
    p_entity_id UUID,
    p_field_values JSONB, -- Format: {"field_id": "value", ...}
    p_user_id UUID,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_field_id UUID;
    v_value TEXT;
    v_count INTEGER := 0;
BEGIN
    -- Iterate through field values
    FOR v_field_id, v_value IN 
        SELECT key::UUID, value::TEXT 
        FROM jsonb_each_text(p_field_values)
    LOOP
        PERFORM set_custom_field_value(
            v_field_id,
            p_entity_type,
            p_entity_id,
            v_value,
            p_user_id,
            p_ip_address,
            p_user_agent
        );
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS
-- =============================================

-- View: Custom fields with value counts
CREATE OR REPLACE VIEW custom_fields_summary AS
SELECT 
    cf.id,
    cf.workspace_id,
    cf.name,
    cf.field_type,
    cf.is_required,
    cf.is_active,
    cf.display_order,
    COUNT(DISTINCT cfv.id) FILTER (WHERE cfv.entity_type = 'task') as task_value_count,
    COUNT(DISTINCT cfv.id) FILTER (WHERE cfv.entity_type = 'project') as project_value_count,
    cf.created_at,
    cf.updated_at
FROM custom_fields cf
LEFT JOIN custom_field_values cfv ON cf.id = cfv.custom_field_id
GROUP BY cf.id;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_custom_field_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_custom_fields_updated
    BEFORE UPDATE ON custom_fields
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_field_timestamp();

CREATE TRIGGER trigger_custom_field_values_updated
    BEFORE UPDATE ON custom_field_values
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_field_timestamp();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS
ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_value_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view custom fields in their workspaces
CREATE POLICY custom_fields_select_policy ON custom_fields
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Workspace admins/owners can manage custom fields
CREATE POLICY custom_fields_insert_policy ON custom_fields
    FOR INSERT
    WITH CHECK (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY custom_fields_update_policy ON custom_fields
    FOR UPDATE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY custom_fields_delete_policy ON custom_fields
    FOR DELETE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
              AND role IN ('owner', 'admin')
        )
    );

-- Policy: Users can view field values in their workspaces
CREATE POLICY custom_field_values_select_policy ON custom_field_values
    FOR SELECT
    USING (
        custom_field_id IN (
            SELECT id FROM custom_fields
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

-- Policy: Users can set field values on entities they can access
CREATE POLICY custom_field_values_insert_policy ON custom_field_values
    FOR INSERT
    WITH CHECK (
        custom_field_id IN (
            SELECT id FROM custom_fields
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY custom_field_values_update_policy ON custom_field_values
    FOR UPDATE
    USING (
        custom_field_id IN (
            SELECT id FROM custom_fields
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY custom_field_values_delete_policy ON custom_field_values
    FOR DELETE
    USING (
        custom_field_id IN (
            SELECT id FROM custom_fields
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

-- Policy: Users can view history for fields they can access
CREATE POLICY custom_field_history_select_policy ON custom_field_value_history
    FOR SELECT
    USING (
        custom_field_id IN (
            SELECT id FROM custom_fields
            WHERE workspace_id IN (
                SELECT workspace_id 
                FROM workspace_members 
                WHERE user_id = auth.uid()
            )
        )
    );

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE custom_fields IS 'Workspace-level custom field definitions';
COMMENT ON TABLE custom_field_values IS 'Custom field values attached to tasks/projects';
COMMENT ON TABLE custom_field_value_history IS 'Audit trail for custom field value changes';

COMMENT ON COLUMN custom_fields.field_type IS 'Type: text, number, date, datetime, dropdown, checkbox, url, email, phone';
COMMENT ON COLUMN custom_fields.config IS 'JSON configuration for field behavior (options, validation rules, etc.)';
COMMENT ON COLUMN custom_field_values.value IS 'Primary value storage (text representation)';
COMMENT ON COLUMN custom_field_values.value_numeric IS 'Optimized storage for number fields';
COMMENT ON COLUMN custom_field_values.value_date IS 'Optimized storage for date/datetime fields';
COMMENT ON COLUMN custom_field_values.value_boolean IS 'Optimized storage for checkbox fields';
COMMENT ON COLUMN custom_field_values.value_array IS 'Storage for multi-select dropdown fields';
