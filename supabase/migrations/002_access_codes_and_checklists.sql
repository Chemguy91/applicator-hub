-- Code sign-in and checklist results.
-- The codes themselves are NOT in this file: they are inserted directly into
-- private.access_codes as bcrypt hashes (see README).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- One row per code. account_email is the shared Supabase account that code signs in as.
create table private.access_codes (
  role text primary key check (role in ('applicator', 'admin')),
  code_hash text not null,
  account_email text not null unique
);

-- Every code attempt, for lockouts.
create table private.login_attempts (
  id bigint primary key generated always as identity,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_at_idx on private.login_attempts (at);
create index login_attempts_ip_at_idx on private.login_attempts (ip, at);

-- Checks a code. Locks an IP out after 8 wrong codes in 15 minutes, and everyone
-- out after 60 wrong codes in 15 minutes (stops guessing from many addresses).
-- Called only by the code-login edge function (service role).
create or replace function public.check_access_code(p_code text, p_ip text)
returns table (role text, account_email text, locked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip_fails int;
  all_fails int;
  hit record;
begin
  delete from private.login_attempts where at < now() - interval '1 day';

  select count(*) into ip_fails from private.login_attempts a
    where a.ip = p_ip and not a.ok and a.at > now() - interval '15 minutes';
  select count(*) into all_fails from private.login_attempts a
    where not a.ok and a.at > now() - interval '15 minutes';
  if ip_fails >= 8 or all_fails >= 60 then
    return query select null::text, null::text, true;
    return;
  end if;

  select c.role, c.account_email into hit from private.access_codes c
    where c.code_hash = extensions.crypt(p_code, c.code_hash)
    limit 1;

  insert into private.login_attempts (ip, ok) values (p_ip, hit.role is not null);
  return query select hit.role, hit.account_email, false;
end;
$$;
revoke execute on function public.check_access_code(text, text) from public, anon, authenticated;
grant execute on function public.check_access_code(text, text) to service_role;

-- Submitted checklists. Anyone signed in with a code can submit; only admin can read or delete.
create table public.checklist_submissions (
  id bigint primary key generated always as identity,
  submitted_at timestamptz not null default now(),
  submitted_by uuid default auth.uid() references auth.users (id) on delete set null,
  customer text not null check (length(customer) between 1 and 200),
  storage text not null check (length(storage) between 1 and 200),
  applicator text not null check (length(applicator) between 1 and 200),
  job_date date,
  fields jsonb not null default '{}'::jsonb check (length(fields::text) < 20000),
  setup_done int[] not null default '{}',
  post_done int[] not null default '{}',
  setup_total int not null,
  post_total int not null
);
alter table public.checklist_submissions enable row level security;
create index checklist_submissions_at_idx on public.checklist_submissions (submitted_at desc);
create index checklist_submissions_by_idx on public.checklist_submissions (submitted_by);

create policy "members submit checklists" on public.checklist_submissions
  for insert to authenticated with check ((select public.is_member()) and submitted_by = (select auth.uid()));
create policy "admin reads checklists" on public.checklist_submissions
  for select to authenticated using ((select public.is_admin()));
create policy "admin deletes checklists" on public.checklist_submissions
  for delete to authenticated using ((select public.is_admin()));
