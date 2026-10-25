-- Held messages are visible only to their sender, including through the Data API.
drop policy if exists "messages members read" on public.community_messages;
create policy "messages members read" on public.community_messages
  for select to authenticated
  using (
    (status = 'active' or (status = 'held' and sender_id = (select auth.uid())))
    and exists (
      select 1 from public.community_conversation_members m
      where m.conversation_id = community_messages.conversation_id
        and m.user_id = (select auth.uid())
    )
  );

create table if not exists public.community_message_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_count integer not null check (request_count >= 0),
  reset_at timestamptz not null
);
alter table public.community_message_rate_limits enable row level security;
revoke all on public.community_message_rate_limits from anon, authenticated;
grant select, insert, update on public.community_message_rate_limits to service_role;

create or replace function public.oc_reserve_message_send(p_user uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_reset_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  insert into public.community_message_rate_limits as limits (user_id, request_count, reset_at)
  values (p_user, 1, v_now + interval '10 minutes')
  on conflict (user_id) do update
    set request_count = case
      when limits.reset_at <= v_now then 1
      else least(limits.request_count + 1, 21)
    end,
    reset_at = case
      when limits.reset_at <= v_now then v_now + interval '10 minutes'
      else limits.reset_at
    end
  returning request_count, reset_at into v_count, v_reset_at;

  if v_count > 20 then
    return greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
  end if;
  return 0;
end;
$$;

revoke all on function public.oc_reserve_message_send(uuid) from public, anon, authenticated;
grant execute on function public.oc_reserve_message_send(uuid) to service_role;
