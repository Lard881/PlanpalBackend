-- ============================================================================
-- Migration 0006: Global Search
-- ============================================================================
-- Searches tasks, documents, and people. RLS applies (security invoker).
-- ============================================================================

create or replace function search_all(p_query text, p_workspace uuid default null, p_limit int default 20)
returns table (kind text, id uuid, workspace_id uuid, title text, subtitle text, score real, at timestamptz)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('simple', p_query) as tsq, p_query as raw)
  select 'task', t.id, t.workspace_id, t.title, t.priority::text,
         (ts_rank(t.search, q.tsq) + similarity(t.title, q.raw))::real, t.due_at
    from tasks t, q
   where t.deleted_at is null
     and (p_workspace is null or t.workspace_id = p_workspace)
     and (t.search @@ q.tsq or t.title % q.raw or t.title ilike '%' || q.raw || '%')
  union all
  select 'document', d.id, d.workspace_id, d.title, d.kind::text,
         (ts_rank(d.search, q.tsq) + similarity(d.title, q.raw))::real, d.updated_at
    from documents d, q
   where d.deleted_at is null
     and (p_workspace is null or d.workspace_id = p_workspace)
     and (d.search @@ q.tsq or d.title % q.raw or d.title ilike '%' || q.raw || '%')
  union all
  select 'person', p.id, wm.workspace_id, p.full_name, p.email,
         similarity(p.full_name, q.raw)::real, null
    from profiles p
    join workspace_members wm on wm.user_id = p.id, q
   where p.deleted_at is null
     and (p_workspace is null or wm.workspace_id = p_workspace)
     and (p.full_name ilike '%' || q.raw || '%' or p.email ilike '%' || q.raw || '%')
  order by 6 desc
  limit p_limit;
$$;
