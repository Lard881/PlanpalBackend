-- Migration: Create task_attachments and task_links tables
-- Description: Add support for file attachments and link attachments on tasks
-- Author: PlanPal Team
-- Date: 2026-10-01

-- ============================================================================
-- TASK ATTACHMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- File Information
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL, -- Size in bytes
    mime_type TEXT NOT NULL,
    
    -- Storage Paths (Supabase Storage)
    storage_path TEXT NOT NULL UNIQUE, -- Path in storage bucket
    thumbnail_path TEXT, -- Thumbnail for images/PDFs
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT file_size_positive CHECK (file_size > 0),
    CONSTRAINT file_name_not_empty CHECK (LENGTH(TRIM(file_name)) > 0)
);

-- Indexes for task_attachments
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_workspace_id ON task_attachments(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_task_attachments_created_at ON task_attachments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_attachments_deleted_at ON task_attachments(deleted_at) WHERE deleted_at IS NOT NULL;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_task_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_attachments_updated_at
    BEFORE UPDATE ON task_attachments
    FOR EACH ROW
    EXECUTE FUNCTION update_task_attachments_updated_at();

-- ============================================================================
-- TASK LINKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Link Information
    url TEXT NOT NULL,
    title TEXT, -- Fetched from URL metadata
    description TEXT, -- Fetched from URL metadata
    favicon_url TEXT, -- Fetched favicon or site icon
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT url_not_empty CHECK (LENGTH(TRIM(url)) > 0),
    CONSTRAINT url_format CHECK (url ~* '^https?://.*')
);

-- Indexes for task_links
CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_links_workspace_id ON task_links(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_links_added_by ON task_links(added_by);
CREATE INDEX IF NOT EXISTS idx_task_links_created_at ON task_links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_links_deleted_at ON task_links(deleted_at) WHERE deleted_at IS NOT NULL;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_task_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_links_updated_at
    BEFORE UPDATE ON task_links
    FOR EACH ROW
    EXECUTE FUNCTION update_task_links_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: task_attachments
-- ============================================================================

-- Policy: Users can view attachments in their workspaces
CREATE POLICY task_attachments_select_policy ON task_attachments
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
    );

-- Policy: Users can create attachments in their workspaces
CREATE POLICY task_attachments_insert_policy ON task_attachments
    FOR INSERT
    WITH CHECK (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
        AND uploaded_by = auth.uid()
    );

-- Policy: Users can update their own attachments (soft delete)
CREATE POLICY task_attachments_update_policy ON task_attachments
    FOR UPDATE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
    );

-- Policy: Users can delete their own attachments
CREATE POLICY task_attachments_delete_policy ON task_attachments
    FOR DELETE
    USING (
        uploaded_by = auth.uid()
        OR workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin')
            AND deleted_at IS NULL
        )
    );

-- ============================================================================
-- RLS POLICIES: task_links
-- ============================================================================

-- Policy: Users can view links in their workspaces
CREATE POLICY task_links_select_policy ON task_links
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
    );

-- Policy: Users can create links in their workspaces
CREATE POLICY task_links_insert_policy ON task_links
    FOR INSERT
    WITH CHECK (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
        AND added_by = auth.uid()
    );

-- Policy: Users can update links in their workspaces
CREATE POLICY task_links_update_policy ON task_links
    FOR UPDATE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND deleted_at IS NULL
        )
    );

-- Policy: Users can delete their own links
CREATE POLICY task_links_delete_policy ON task_links
    FOR DELETE
    USING (
        added_by = auth.uid()
        OR workspace_id IN (
            SELECT workspace_id 
            FROM workspace_members 
            WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin')
            AND deleted_at IS NULL
        )
    );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Get attachment count for a task
CREATE OR REPLACE FUNCTION get_task_attachment_count(p_task_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM task_attachments
        WHERE task_id = p_task_id
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get link count for a task
CREATE OR REPLACE FUNCTION get_task_link_count(p_task_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM task_links
        WHERE task_id = p_task_id
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get total storage used by workspace
CREATE OR REPLACE FUNCTION get_workspace_storage_used(p_workspace_id UUID)
RETURNS BIGINT AS $$
BEGIN
    RETURN (
        SELECT COALESCE(SUM(file_size), 0)
        FROM task_attachments
        WHERE workspace_id = p_workspace_id
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE task_attachments IS 'Stores file attachments for tasks with cloud storage references';
COMMENT ON TABLE task_links IS 'Stores URL/link attachments for tasks with metadata';

COMMENT ON COLUMN task_attachments.storage_path IS 'Path in Supabase Storage bucket (e.g., workspace-123/task-456/file.pdf)';
COMMENT ON COLUMN task_attachments.thumbnail_path IS 'Path to thumbnail image for previews (null if not applicable)';
COMMENT ON COLUMN task_attachments.file_size IS 'File size in bytes (max 50MB = 52428800 bytes)';

COMMENT ON COLUMN task_links.url IS 'Full URL including protocol (http:// or https://)';
COMMENT ON COLUMN task_links.title IS 'Page title fetched from URL metadata or user-provided';
COMMENT ON COLUMN task_links.favicon_url IS 'URL to favicon or site icon for display';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Note: Remember to run this migration in Supabase SQL Editor or via CLI
-- Note: Configure Supabase Storage bucket 'task-attachments' separately
-- Note: Set up storage policies to match RLS policies above
