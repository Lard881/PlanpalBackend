-- ============================================================================
-- Migration 0001: PostgreSQL Extensions and Custom Types
-- ============================================================================
-- Description: Sets up required PostgreSQL extensions and creates custom enum
--              types used throughout the database schema.
-- Run this in Supabase SQL Editor or via CLI: supabase db push
-- ============================================================================

-- Enable required PostgreSQL extensions
create extension if not exists "pgcrypto";      -- For gen_random_uuid()
create extension if not exists "pg_trgm";       -- For fuzzy text search (similarity)
create extension if not exists "pg_cron";       -- For scheduled jobs (reminders)

-- Workspace Types: personal (one per user) or team (collaborative)
create type workspace_type as enum ('personal', 'team');

-- Member Roles: admin (full control), member (standard access), guest (limited)
create type member_role as enum ('admin', 'member', 'guest');

-- Task Status: workflow states
create type task_status as enum ('todo', 'in_progress', 'completed');

-- Task Priority: importance levels
create type task_priority as enum ('high', 'medium', 'low');

-- Channel Kind: regular channel or direct message
create type channel_kind as enum ('channel', 'dm');

-- Document Kind: uploaded file or written document (Quill editor)
create type document_kind as enum ('file', 'written');

-- Notification Types: all possible notification categories
create type notification_type as enum (
  'task_assigned',          -- Task assigned to you
  'task_updated',           -- Task you're involved with changed
  'task_comment',           -- New comment on your task
  'mention',                -- Someone @mentioned you
  'deadline_approaching',   -- Task due within 24 hours
  'task_overdue',           -- Task past due date
  'event_reminder',         -- Calendar event starting soon
  'chat_message',           -- New chat message
  'member_joined',          -- New member joined workspace
  'system'                  -- System notifications
);

-- Note: Overdue status is NOT stored in the database.
-- A task is overdue when: status <> 'completed' AND due_at < now()
