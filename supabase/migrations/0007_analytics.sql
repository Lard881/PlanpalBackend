-- ============================================================================
-- Migration 0007: Analytics Functions
-- ============================================================================
-- All functions are security invoker (RLS applies).
-- Analytics are per workspace.
-- ============================================================================

-- Summary cards on the Analytics page and Home "Overview"
create or replace function analytics_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (
  completed int, in_progress int, overdue int,
  avg_completion_days numeric, completed_prev int,
  on_time_rate numeric
) language sql stable security invoker set search_path = public as $$
  with cur as (
    select * from tasks where workspace_id = p_workspace and deleted_at is null),
  prev as (
    select count(*)::int c from cur
     where status = 'completed'
       and completed_at >= p_from - (p_to - p_from) and completed_at < p_from)
  select
    count(*) filter (where status = 'completed' and completed_at between p_from and p_to)::int,
    count(*) filter (where status = 'in_progress')::int,
    count(*) filter (where status <> 'completed' and due_at < now())::int,
    round(avg(extract(epoch from (completed_at - created_at)) / 86400.0)
      filter (where status = 'completed' and completed_at between p_from and p_to)::numeric, 1),
    (select c from prev),
    round(100.0 * count(*) filter (where status = 'completed'
        and completed_at between p_from and p_to and (due_at is null or completed_at <= due_at))
      / nullif(count(*) filter (where status = 'completed'
        and completed_at between p_from and p_to), 0), 0)
  from cur;
$$;

-- Weekly Task Output bars: completed tasks per weekday
create or replace function analytics_weekly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (weekday int, completed int)
language sql stable security invoker set search_path = public as $$
  select d.dow, count(t.id)::int
    from generate_series(1, 7) as d(dow)
    left join tasks t
      on extract(isodow from t.completed_at) = d.dow
     and t.workspace_id = p_workspace and t.deleted_at is null
     and t.status = 'completed' and t.completed_at between p_from and p_to
   group by d.dow order by d.dow;
$$;

-- Category Mix donut: completed-or-open tasks by label
create or replace function analytics_categories(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (label text, color text, total int)
language sql stable security invoker set search_path = public as $$
  select coalesce(l.name, 'No label'), coalesce(l.color, '#94A3B8'), count(*)::int
    from tasks t left join labels l on l.id = t.label_id
   where t.workspace_id = p_workspace and t.deleted_at is null
     and t.created_at between p_from and p_to
   group by 1, 2 order by 3 desc;
$$;

-- Home "Overview" line chart: tasks completed per day
create or replace function analytics_daily(p_workspace uuid, p_from date, p_to date)
returns table (day date, completed int)
language sql stable security invoker set search_path = public as $$
  select g::date, count(t.id)::int
    from generate_series(p_from, p_to, interval '1 day') g
    left join tasks t on t.completed_at::date = g::date
     and t.workspace_id = p_workspace and t.deleted_at is null and t.status = 'completed'
   group by 1 order by 1;
$$;

-- Productive streak: consecutive days, ending today or yesterday, with at least one completed task
create or replace function analytics_streak(p_workspace uuid) returns int
language sql stable security invoker set search_path = public as $$
  with days as (
    select distinct completed_at::date d from tasks
     where workspace_id = p_workspace and deleted_at is null and status = 'completed'),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp from days)
  select coalesce((select count(*)::int from islands
          where grp = (select grp from islands order by d desc limit 1)
            and (select max(d) from islands) >= current_date - 1), 0);
$$;
