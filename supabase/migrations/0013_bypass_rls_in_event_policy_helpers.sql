create or replace function event_workspace(p_event_id uuid) returns uuid
language sql stable security definer
set search_path = public
set row_security = off as $$
  select workspace_id
    from events
   where id = p_event_id
     and (
       is_full_member(workspace_id)
       or exists (
         select 1
           from event_attendees
          where event_id = p_event_id
            and user_id = auth.uid()
            and deleted_at is null
       )
     );
$$;

create or replace function is_event_attendee(p_event_id uuid) returns boolean
language sql stable security definer
set search_path = public
set row_security = off as $$
  select exists (
    select 1
      from event_attendees
     where event_id = p_event_id
       and user_id = auth.uid()
       and deleted_at is null
  );
$$;

revoke all on function event_workspace(uuid) from public, anon;
revoke all on function is_event_attendee(uuid) from public, anon;
grant execute on function event_workspace(uuid) to authenticated;
grant execute on function is_event_attendee(uuid) to authenticated;
