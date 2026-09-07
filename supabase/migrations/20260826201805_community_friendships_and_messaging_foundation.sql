-- OceanCore Community friendships and direct-message foundation.
-- Direct messages are intentionally restricted to accepted friends by the API.

create extension if not exists pgcrypto;

create table if not exists public.community_friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.community_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.community_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null default 'direct' check (conversation_type in ('direct', 'group')),
  created_by uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_conversation_members (
  conversation_id uuid not null references public.community_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.community_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'active' check (status in ('active', 'held', 'removed')),
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.community_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'reviewed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists community_friendships_pair_idx
  on public.community_friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists community_friendships_addressee_idx on public.community_friendships(addressee_id, status, created_at desc);
create index if not exists community_conversation_members_user_idx on public.community_conversation_members(user_id, conversation_id);
create index if not exists community_messages_conversation_idx on public.community_messages(conversation_id, created_at asc);
create index if not exists community_message_reports_status_idx on public.community_message_reports(status, created_at desc);

alter table public.community_friendships enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_conversations enable row level security;
alter table public.community_conversation_members enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_message_reports enable row level security;

drop policy if exists "friendships members read" on public.community_friendships;
create policy "friendships members read" on public.community_friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
drop policy if exists "friendships members update" on public.community_friendships;
drop policy if exists "friendships members delete" on public.community_friendships;
drop policy if exists "friendships requester create" on public.community_friendships;
-- Friendship transitions are enforced by the server API so a client cannot
-- approve its own outgoing request or change another member's relationship.

drop policy if exists "blocks own rows" on public.community_blocks;
create policy "blocks own rows" on public.community_blocks for all to authenticated
  using ((select auth.uid()) = blocker_id)
  with check ((select auth.uid()) = blocker_id);

drop policy if exists "conversation members read" on public.community_conversations;
create policy "conversation members read" on public.community_conversations for select to authenticated
  using (exists (select 1 from public.community_conversation_members m where m.conversation_id = id and m.user_id = (select auth.uid())));
drop policy if exists "conversation members read memberships" on public.community_conversation_members;
create policy "conversation members read memberships" on public.community_conversation_members for select to authenticated
  using (exists (select 1 from public.community_conversation_members me where me.conversation_id = community_conversation_members.conversation_id and me.user_id = (select auth.uid())));
drop policy if exists "messages members read" on public.community_messages;
create policy "messages members read" on public.community_messages for select to authenticated
  using (exists (select 1 from public.community_conversation_members m where m.conversation_id = community_messages.conversation_id and m.user_id = (select auth.uid())));
drop policy if exists "message reports reporter create" on public.community_message_reports;
create policy "message reports reporter create" on public.community_message_reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id);
