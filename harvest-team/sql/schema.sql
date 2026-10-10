-- =====================================================================
-- HARVEST TEAM  -  Supabase schema, security policies, storage, realtime
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query
-- It is safe to re-run.
--
-- BEFORE RUNNING: edit the three admin e-mail addresses in the
-- "ADMIN BOOTSTRAP" section at the bottom (or run make_admin() later).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  display_name text not null,
  role         text not null default 'member' check (role in ('member','admin')),
  created_at   timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  constraint display_name_len check (char_length(display_name) between 1 and 40)
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- Pre-approved admins. Promotion needs BOTH username and e-mail to match,
-- so nobody can become admin just by registering a username.
create table if not exists public.admin_seed (
  username text primary key,
  email    text not null
);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  kind        text not null default 'page' check (kind in ('builtin','page')),
  title       text not null,
  description text not null default '',
  position    int  not null default 0,
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.section_items (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  image_url  text,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.showcase_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  category    text not null default '',
  image_url   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  cover_url   text,
  status      text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  priority    text not null default 'medium'  check (priority in ('low','medium','high','critical')),
  members     uuid[] not null default '{}',
  start_date  date,
  target_date date,
  progress    int not null default 0 check (progress between 0 and 100),
  notes       text not null default '',
  updates     jsonb not null default '[]',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.assembly_lines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  status      text not null default 'running' check (status in ('running','paused','stopped')),
  items       text not null default '',
  target      int not null default 0 check (target >= 0),
  current     int not null default 0 check (current >= 0),
  members     uuid[] not null default '{}',
  notes       text not null default '',
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.raids (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  objective    text not null default '',
  description  text not null default '',
  scheduled_at timestamptz not null,
  status       text not null default 'planned' check (status in ('planned','upcoming','active','completed','cancelled')),
  squad        text not null default '',
  members      uuid[] not null default '{}',
  briefing     text not null default '',
  checklist    jsonb not null default '[]',
  notes        text not null default '',
  attachments  jsonb not null default '[]',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  image_url   text,
  pinned      boolean not null default false,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  sender_name text not null default '',
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);

create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  kind       text not null,
  message    text not null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- New auth user -> profile row. Admin only if username AND e-mail are pre-approved.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text := coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1));
  dname text := left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''), uname), 40);
  r     text := 'member';
begin
  if exists (
    select 1 from public.admin_seed s
    where lower(s.username) = lower(uname) and lower(s.email) = lower(new.email)
  ) then
    r := 'admin';
  end if;
  insert into public.profiles (id, username, display_name, role) values (new.id, uname, dname, r);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users can never change their own role/username; the last admin can't be demoted.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role <> old.role or new.username <> old.username or new.id <> old.id then
      raise exception 'Only administrators can change roles or usernames';
    end if;
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You cannot remove the last administrator';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- Messages: sender identity always comes from the database, never from the browser.
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select display_name into new.sender_name from public.profiles where id = auth.uid();
  new.sender_name := coalesce(new.sender_name, 'Unknown');
  return new;
end $$;

drop trigger if exists messages_before_insert_trg on public.messages;
create trigger messages_before_insert_trg before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.announcements_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare dn text;
begin
  new.author_id := coalesce(new.author_id, auth.uid());
  select display_name into dn from public.profiles where id = new.author_id;
  new.author_name := coalesce(nullif(new.author_name, ''), dn, 'Admin');
  return new;
end $$;

drop trigger if exists announcements_before_insert_trg on public.announcements;
create trigger announcements_before_insert_trg before insert on public.announcements
  for each row execute function public.announcements_before_insert();

-- Activity feed (written by triggers, never by browsers)
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec   jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  label text  := coalesce(rec->>'name', rec->>'title', 'item');
  kindl text  := case tg_table_name
                   when 'projects' then 'Project'
                   when 'assembly_lines' then 'Assembly line'
                   when 'raids' then 'Operation'
                   when 'announcements' then 'Announcement'
                   when 'showcase_items' then 'Picture'
                   else 'Item' end;
  verb  text  := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  actor text;
begin
  select display_name into actor from public.profiles where id = auth.uid();
  insert into public.activity (kind, message, actor_name)
  values (tg_table_name, format('%s "%s" %s', kindl, label, verb), coalesce(actor, 'System'));
  delete from public.activity where id < (select max(id) - 200 from public.activity);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['section_items','showcase_items','projects','assembly_lines','raids','announcements'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['showcase_items','projects','assembly_lines','raids','announcements'] loop
    execute format('drop trigger if exists log_%1$s on public.%1$I', t);
    execute format('create trigger log_%1$s after insert or update or delete on public.%1$I for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- Signed-in users read everything. Only administrators write content.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sections','settings','section_items','showcase_items','projects','assembly_lines','raids','announcements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('create policy "read all" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "admin insert" on public.%I', t);
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('drop policy if exists "admin update" on public.%I', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('drop policy if exists "admin delete" on public.%I', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- profiles
alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- (no insert/delete policies: profiles are created by the signup trigger only)

-- messages
alter table public.messages enable row level security;
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated using (true);
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "messages delete" on public.messages;
create policy "messages delete" on public.messages for delete to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- activity (read only for browsers)
alter table public.activity enable row level security;
drop policy if exists "activity read" on public.activity;
create policy "activity read" on public.activity for select to authenticated using (true);

-- admin_seed: locked down completely (only SQL editor / service role)
alter table public.admin_seed enable row level security;
revoke all on public.admin_seed from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. STORAGE (uploaded pictures and attachments)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760,
        array['image/png','image/jpeg','image/gif','image/webp','application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects for select using (bucket_id = 'media');
drop policy if exists "media admin insert" on storage.objects;
create policy "media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
drop policy if exists "media admin update" on storage.objects;
create policy "media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin());
drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- ---------------------------------------------------------------------
-- 5. REALTIME
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','sections','settings','section_items','showcase_items','projects',
                           'assembly_lines','raids','announcements','messages','activity'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. SEED DATA (navigation sections + default settings)
-- No showcase items and no "Section 04" are created.
-- ---------------------------------------------------------------------
insert into public.sections (key, kind, title, description, position) values
  ('dashboard',     'builtin', 'Dashboard',       'Team overview and live status.',                        0),
  ('showcase',      'builtin', 'Showcase',        'Pictures and highlights from the team.',               10),
  ('projects',      'builtin', 'Projects',        'Active and planned team projects.',                    20),
  ('assembly',      'builtin', 'Assembly Lines',  'Production lines, targets and output.',                30),
  ('raids',         'builtin', 'Raid Planning',   'Operation briefings, squads and schedules.',           40),
  ('announcements', 'builtin', 'Announcements',   'Important updates for the whole team.',                50),
  ('messages',      'builtin', 'Team Chat',       'Talk with the rest of the team in real time.',         60)
on conflict (key) do nothing;

insert into public.settings (key, value) values
  ('site_name',       '"HARVEST TEAM"'),
  ('tagline',         '"Operations hub"'),
  ('welcome_message', '"Stay sharp. Check the latest briefings, projects and production status below."'),
  ('dash_count',      '4'),
  ('dash_widgets',    '{"announcements":true,"projects":true,"assembly":true,"raids":true,"messages":true,"activity":true,"links":true}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 7. ADMIN BOOTSTRAP
-- Initial administrators: JXELR, wattsomc, sp0tted_
-- >>> Replace each e-mail with the REAL e-mail that person will register with. <<<
-- When they sign up with that exact username + e-mail (and confirm the e-mail),
-- they automatically become admin. Anyone else using those usernames stays a member.
-- ---------------------------------------------------------------------
insert into public.admin_seed (username, email) values
  ('JXELR',    'joel.robinson@harveststudents.net'),
  ('wattsomc', 'joshua.watson@harveststudents.net'),
  ('sp0tted_', 'bailey.watson@harveststudents.net'),
  ('dzayyyyyyyyyyyyy', 'william.higgins@harveststudents.net')
on conflict (username) do update set email = excluded.email;

-- Promote an already-registered account by e-mail. Run from the SQL editor only:
--   select public.make_admin('someone@example.com');
create or replace function public.make_admin(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then return 'No user with that e-mail'; end if;
  update public.profiles set role = 'admin' where id = uid;
  return 'ok';
end $$;
revoke execute on function public.make_admin(text) from public, anon, authenticated;
