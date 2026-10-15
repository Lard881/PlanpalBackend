create or replace function event_workspace(p_event_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
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
language sql stable security definer set search_path = public as $$
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

drop policy events_select on events;
create policy events_select on events for select using (
  is_full_member(workspace_id) or is_event_attendee(id)
);

drop policy attendees_select on event_attendees;
create policy attendees_select on event_attendees for select using (
  user_id = auth.uid() or is_full_member(event_workspace(event_id))
);

drop policy attendees_write on event_attendees;
create policy attendees_write on event_attendees for all
  using (is_full_member(event_workspace(event_id)))
  with check (is_full_member(event_workspace(event_id)));
