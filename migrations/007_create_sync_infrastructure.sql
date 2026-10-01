-- ============================================================================
-- MIGRATION 007: Sync Infrastructure
-- ============================================================================
-- Creates tables and functions to support offline mode and data synchronization
-- - sync_metadata: Tracks last sync timestamps per device/user
-- - conflict_resolution: Logs sync conflicts for debugging
-- - Modified columns: Adds updated_at triggers to all entities
-- ============================================================================

-- Add updated_at columns to existing tables (if not already present)
-- This allows us to track when records were last modified for sync purposes

DO $$ 
BEGIN
  -- Tasks
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='tasks' AND column_name='updated_at') THEN
    ALTER TABLE tasks ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Projects
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='projects' AND column_name='updated_at') THEN
    ALTER TABLE projects ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Labels
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='labels' AND column_name='updated_at') THEN
    ALTER TABLE labels ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Task Labels
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='task_labels' AND column_name='updated_at') THEN
    ALTER TABLE task_labels ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Comments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='comments' AND column_name='updated_at') THEN
    ALTER TABLE comments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Attachments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='attachments' AND column_name='updated_at') THEN
    ALTER TABLE attachments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Links
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='links' AND column_name='updated_at') THEN
    ALTER TABLE links ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at on all tables
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_labels_updated_at ON labels;
CREATE TRIGGER update_labels_updated_at
  BEFORE UPDATE ON labels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_labels_updated_at ON task_labels;
CREATE TRIGGER update_task_labels_updated_at
  BEFORE UPDATE ON task_labels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_comments_updated_at ON comments;
CREATE TRIGGER update_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_attachments_updated_at ON attachments;
CREATE TRIGGER update_attachments_updated_at
  BEFORE UPDATE ON attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_links_updated_at ON links;
CREATE TRIGGER update_links_updated_at
  BEFORE UPDATE ON links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Sync Metadata Table
-- ============================================================================
-- Tracks last sync timestamp per device for each user and workspace
-- Enables incremental sync (only fetch changes since last sync)

CREATE TABLE IF NOT EXISTS sync_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL, -- Client-generated unique device identifier
  entity_type VARCHAR(50) NOT NULL, -- 'tasks', 'projects', 'labels', etc.
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_version BIGINT DEFAULT 0, -- Optional version counter
  sync_status VARCHAR(20) DEFAULT 'success', -- 'success', 'partial', 'failed'
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional sync metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, workspace_id, device_id, entity_type)
);

-- Indexes for sync_metadata
CREATE INDEX idx_sync_metadata_user_workspace ON sync_metadata(user_id, workspace_id);
CREATE INDEX idx_sync_metadata_device ON sync_metadata(device_id);
CREATE INDEX idx_sync_metadata_entity ON sync_metadata(entity_type);
CREATE INDEX idx_sync_metadata_last_sync ON sync_metadata(last_sync_at);

-- Trigger for sync_metadata updated_at
DROP TRIGGER IF EXISTS update_sync_metadata_updated_at ON sync_metadata;
CREATE TRIGGER update_sync_metadata_updated_at
  BEFORE UPDATE ON sync_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Conflict Resolution Log Table
-- ============================================================================
-- Logs sync conflicts for debugging and audit purposes

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'task', 'project', 'label', etc.
  entity_id UUID NOT NULL, -- ID of the conflicting entity
  conflict_type VARCHAR(50) NOT NULL, -- 'update_conflict', 'delete_conflict', 'version_mismatch'
  resolution_strategy VARCHAR(50) NOT NULL, -- 'server_wins', 'client_wins', 'merge', 'manual'
  server_data JSONB, -- Server version of the data
  client_data JSONB, -- Client version of the data
  resolved_data JSONB, -- Final resolved data
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync_conflicts
CREATE INDEX idx_sync_conflicts_user_workspace ON sync_conflicts(user_id, workspace_id);
CREATE INDEX idx_sync_conflicts_device ON sync_conflicts(device_id);
CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX idx_sync_conflicts_created ON sync_conflicts(created_at);

-- ============================================================================
-- RLS Policies for Sync Tables
-- ============================================================================

-- Enable RLS
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;

-- sync_metadata policies
CREATE POLICY "Users can view their own sync metadata"
  ON sync_metadata FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync metadata"
  ON sync_metadata FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync metadata"
  ON sync_metadata FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sync metadata"
  ON sync_metadata FOR DELETE
  USING (auth.uid() = user_id);

-- sync_conflicts policies (read-only for users, useful for debugging)
CREATE POLICY "Users can view their own sync conflicts"
  ON sync_conflicts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert sync conflicts"
  ON sync_conflicts FOR INSERT
  WITH CHECK (true); -- Only backend can insert conflicts

-- ============================================================================
-- Sync Helper Functions
-- ============================================================================

-- Function to get changes since last sync
CREATE OR REPLACE FUNCTION get_entity_changes(
  p_entity_type TEXT,
  p_workspace_id UUID,
  p_last_sync_at TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  data JSONB,
  operation VARCHAR(10), -- 'insert', 'update', 'delete'
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  -- This is a template function - actual implementation will be in the API
  -- because each entity type has different columns and relationships
  
  -- Return format example:
  -- {
  --   "id": "uuid",
  --   "data": {...entity data...},
  --   "operation": "update",
  --   "updated_at": "timestamp"
  -- }
  
  RETURN QUERY SELECT NULL::UUID, NULL::JSONB, NULL::VARCHAR, NULL::TIMESTAMPTZ WHERE FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record sync metadata
CREATE OR REPLACE FUNCTION upsert_sync_metadata(
  p_user_id UUID,
  p_workspace_id UUID,
  p_device_id VARCHAR,
  p_entity_type VARCHAR,
  p_sync_status VARCHAR DEFAULT 'success',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS sync_metadata AS $$
DECLARE
  v_result sync_metadata;
BEGIN
  INSERT INTO sync_metadata (
    user_id,
    workspace_id,
    device_id,
    entity_type,
    last_sync_at,
    sync_status,
    metadata
  ) VALUES (
    p_user_id,
    p_workspace_id,
    p_device_id,
    p_entity_type,
    NOW(),
    p_sync_status,
    p_metadata
  )
  ON CONFLICT (user_id, workspace_id, device_id, entity_type)
  DO UPDATE SET
    last_sync_at = NOW(),
    sync_status = p_sync_status,
    metadata = p_metadata,
    last_sync_version = sync_metadata.last_sync_version + 1
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log sync conflict
CREATE OR REPLACE FUNCTION log_sync_conflict(
  p_user_id UUID,
  p_workspace_id UUID,
  p_device_id VARCHAR,
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_conflict_type VARCHAR,
  p_resolution_strategy VARCHAR,
  p_server_data JSONB,
  p_client_data JSONB,
  p_resolved_data JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_conflict_id UUID;
BEGIN
  INSERT INTO sync_conflicts (
    user_id,
    workspace_id,
    device_id,
    entity_type,
    entity_id,
    conflict_type,
    resolution_strategy,
    server_data,
    client_data,
    resolved_data,
    metadata
  ) VALUES (
    p_user_id,
    p_workspace_id,
    p_device_id,
    p_entity_type,
    p_entity_id,
    p_conflict_type,
    p_resolution_strategy,
    p_server_data,
    p_client_data,
    p_resolved_data,
    p_metadata
  )
  RETURNING id INTO v_conflict_id;
  
  RETURN v_conflict_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE sync_metadata IS 'Tracks synchronization state per device and entity type';
COMMENT ON TABLE sync_conflicts IS 'Logs sync conflicts for debugging and audit trail';
COMMENT ON COLUMN sync_metadata.device_id IS 'Client-generated unique device identifier (e.g., UUID)';
COMMENT ON COLUMN sync_metadata.entity_type IS 'Type of entity: tasks, projects, labels, comments, attachments, links';
COMMENT ON COLUMN sync_metadata.last_sync_version IS 'Optional monotonic version counter for optimistic locking';
COMMENT ON COLUMN sync_conflicts.resolution_strategy IS 'How conflict was resolved: server_wins, client_wins, merge, manual';
