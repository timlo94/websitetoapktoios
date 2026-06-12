
do $$ begin
  if not exists (select 1 from pg_type where typname='app_role') then
    create type public.app_role as enum ('admin','user');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

drop policy if exists "view own roles" on public.user_roles;
create policy "view own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "admins view all roles" on public.user_roles;
create policy "admins view all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

drop policy if exists "admins manage roles" on public.user_roles
;
create policy "admins manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

insert into public.user_roles (user_id, role)
values ('91007822-c7fc-45f8-9e39-2ad2fa50b2f7','admin')
on conflict (user_id, role) do nothing;
