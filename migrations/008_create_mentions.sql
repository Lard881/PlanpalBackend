-- ============================================================================
-- MIGRATION 008: Mentions and User Tagging
-- ============================================================================
-- Creates tables and triggers for @mentions functionality
-- ============================================================================

-- Mentions table: tracks @mentions in comments and task descriptions
CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- What is being mentioned in
  entity_type VARCHAR(50) NOT NULL, -- 'task', 'comment'
  entity_id UUID NOT NULL,
  
  -- Who is mentioned
  mentioned_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Who created the mention
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Context
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mention_text TEXT, -- The actual @mention text (e.g., "@John Doe")
  context_snippet TEXT, -- Surrounding text for context
  
  -- State
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT mentions_entity_user_unique UNIQUE(entity_type, entity_id, mentioned_user_id)
);

-- Indexes for mentions
CREATE INDEX idx_mentions_mentioned_user ON mentions(mentioned_user_id, is_read);
CREATE INDEX idx_mentions_workspace ON mentions(workspace_id);
CREATE INDEX idx_mentions_entity ON mentions(entity_type, entity_id);
CREATE INDEX idx_mentions_created_at ON mentions(created_at DESC);
CREATE INDEX idx_mentions_created_by ON mentions(created_by);

-- Trigger for mentions updated_at
DROP TRIGGER IF EXISTS update_mentions_updated_at ON mentions;
CREATE TRIGGER update_mentions_updated_at
  BEFORE UPDATE ON mentions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS Policies for Mentions
-- ============================================================================

ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;

-- Users can view mentions where they are mentioned
CREATE POLICY "Users can view their mentions"
  ON mentions FOR SELECT
  USING (
    auth.uid() = mentioned_user_id
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = mentions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Users can create mentions in their workspaces
CREATE POLICY "Users can create mentions in their workspaces"
  ON mentions FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = mentions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Users can update their own mention read status
CREATE POLICY "Users can update their mention status"
  ON mentions FOR UPDATE
  USING (auth.uid() = mentioned_user_id)
  WITH CHECK (auth.uid() = mentioned_user_id);

-- Users can delete mentions they created
CREATE POLICY "Users can delete mentions they created"
  ON mentions FOR DELETE
  USING (auth.uid() = created_by);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to extract mentions from text
CREATE OR REPLACE FUNCTION extract_mentions_from_text(
  p_text TEXT,
  p_workspace_id UUID
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  mention_text TEXT
) AS $$
BEGIN
  -- Match @username or @"Full Name" patterns
  -- This is a simplified version - in production, you'd use a more robust parser
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    matches[1] as mention_text
  FROM 
    regexp_matches(p_text, '@([a-zA-Z0-9_]+)', 'g') as matches
  JOIN profiles p ON LOWER(p.name) = LOWER(matches[1])
  JOIN workspace_members wm ON wm.user_id = p.id
  WHERE wm.workspace_id = p_workspace_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create mentions from comment
CREATE OR REPLACE FUNCTION create_mentions_from_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_mention RECORD;
  v_workspace_id UUID;
BEGIN
  -- Get workspace_id from task
  SELECT t.workspace_id INTO v_workspace_id
  FROM tasks t
  WHERE t.id = NEW.task_id;
  
  -- Extract and create mentions
  FOR v_mention IN 
    SELECT * FROM extract_mentions_from_text(NEW.content, v_workspace_id)
  LOOP
    -- Insert mention if not already exists
    INSERT INTO mentions (
      entity_type,
      entity_id,
      mentioned_user_id,
      created_by,
      workspace_id,
      mention_text,
      context_snippet
    )
    VALUES (
      'comment',
      NEW.id,
      v_mention.user_id,
      NEW.user_id,
      v_workspace_id,
      v_mention.mention_text,
      substring(NEW.content, 1, 200)
    )
    ON CONFLICT (entity_type, entity_id, mentioned_user_id) DO NOTHING;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to create mentions from task description
CREATE OR REPLACE FUNCTION create_mentions_from_task()
RETURNS TRIGGER AS $$
DECLARE
  v_mention RECORD;
  v_text TEXT;
BEGIN
  -- Combine title and description for mention extraction
  v_text := COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, '');
  
  -- Extract and create mentions
  FOR v_mention IN 
    SELECT * FROM extract_mentions_from_text(v_text, NEW.workspace_id)
  LOOP
    -- Insert mention if not already exists
    INSERT INTO mentions (
      entity_type,
      entity_id,
      mentioned_user_id,
      created_by,
      workspace_id,
      mention_text,
      context_snippet
    )
    VALUES (
      'task',
      NEW.id,
      v_mention.user_id,
      NEW.created_by,
      NEW.workspace_id,
      v_mention.mention_text,
      substring(v_text, 1, 200)
    )
    ON CONFLICT (entity_type, entity_id, mentioned_user_id) DO NOTHING;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-create mentions
DROP TRIGGER IF EXISTS create_mentions_from_comment_trigger ON comments;
CREATE TRIGGER create_mentions_from_comment_trigger
  AFTER INSERT OR UPDATE OF content ON comments
  FOR EACH ROW
  EXECUTE FUNCTION create_mentions_from_comment();

DROP TRIGGER IF EXISTS create_mentions_from_task_trigger ON tasks;
CREATE TRIGGER create_mentions_from_task_trigger
  AFTER INSERT OR UPDATE OF title, description ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION create_mentions_from_task();

-- ============================================================================
-- Function to get unread mention count
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unread_mention_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM mentions
    WHERE mentioned_user_id = p_user_id
    AND is_read = FALSE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function to mark mention as read
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_mention_as_read(p_mention_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE mentions
  SET 
    is_read = TRUE,
    read_at = NOW()
  WHERE id = p_mention_id
  AND mentioned_user_id = p_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function to mark all mentions as read
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_all_mentions_as_read(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE mentions
  SET 
    is_read = TRUE,
    read_at = NOW()
  WHERE mentioned_user_id = p_user_id
  AND is_read = FALSE;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE mentions IS 'User mentions/tags in tasks and comments';
COMMENT ON COLUMN mentions.entity_type IS 'Type of entity containing the mention: task or comment';
COMMENT ON COLUMN mentions.entity_id IS 'ID of the task or comment containing the mention';
COMMENT ON COLUMN mentions.mentioned_user_id IS 'User who was mentioned';
COMMENT ON COLUMN mentions.context_snippet IS 'Surrounding text for context (up to 200 chars)';
COMMENT ON COLUMN mentions.is_read IS 'Whether the mentioned user has seen the mention';

COMMENT ON FUNCTION extract_mentions_from_text IS 'Extract @username mentions from text';
COMMENT ON FUNCTION create_mentions_from_comment IS 'Automatically create mention records from comment content';
COMMENT ON FUNCTION create_mentions_from_task IS 'Automatically create mention records from task title/description';
COMMENT ON FUNCTION get_unread_mention_count IS 'Get count of unread mentions for a user';
COMMENT ON FUNCTION mark_mention_as_read IS 'Mark a specific mention as read';
COMMENT ON FUNCTION mark_all_mentions_as_read IS 'Mark all mentions for a user as read';
