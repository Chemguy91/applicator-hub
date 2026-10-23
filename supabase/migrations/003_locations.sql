-- Applied to the live database on 2026-10-23 as a single transaction (via SQL) after the migration tool timed out.
-- Locations (WA / ID / CO). Each location has a general code and an admin code,
-- and sees only its own checklists. Codes are inserted separately as bcrypt hashes.

delete from public.checklist_submissions where customer = 'E2E TEST - delete me';

-- Codes: one row per (location, role).
drop table private.access_codes;
create table private.access_codes (
  id bigint primary key generated always as identity,
  location text not null check (location in ('WA', 'ID', 'CO')),
  role text not null check (role in ('applicator', 'admin')),
  code_hash text not null,
  account_email text not null unique,
  unique (location, role)
);

drop function public.check_access_code(text, text);
create or replace function public.check_access_code(p_code text, p_ip text)
returns table (role text, location text, account_email text, locked boolean)
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
    return query select null::text, null::text, null::text, true;
    return;
  end if;

  select c.role, c.location, c.account_email into hit from private.access_codes c
    where c.code_hash = extensions.crypt(p_code, c.code_hash)
    limit 1;

  insert into private.login_attempts (ip, ok) values (p_ip, hit.role is not null);
  return query select hit.role, hit.location, hit.account_email, false;
end;
$$;
revoke execute on function public.check_access_code(text, text) from public, anon, authenticated;
grant execute on function public.check_access_code(text, text) to service_role;

-- Which location a signed-in account belongs to.
alter table public.profiles add column location text check (location in ('WA', 'ID', 'CO'));

create or replace function public.current_location()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select location from public.profiles where id = (select auth.uid());
$$;
revoke execute on function public.current_location() from public, anon;
grant execute on function public.current_location() to authenticated;

-- Checklists belong to a location; edits are tracked.
alter table public.checklist_submissions
  add column location text not null check (location in ('WA', 'ID', 'CO')),
  add column edited_at timestamptz,
  add column edited_by uuid references auth.users (id) on delete set null;
create index checklist_submissions_location_idx on public.checklist_submissions (location, submitted_at desc);
create index checklist_submissions_edited_by_idx on public.checklist_submissions (edited_by);

-- The server decides the location (from who is signed in), never the browser.
create or replace function public.checklist_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.location := (select location from public.profiles where id = (select auth.uid()));
    new.submitted_by := (select auth.uid());
    new.submitted_at := now();
    new.edited_at := null;
    new.edited_by := null;
    if new.location is null then
      raise exception 'No location for this sign-in';
    end if;
  else
    new.location := old.location;
    new.submitted_by := old.submitted_by;
    new.submitted_at := old.submitted_at;
    new.edited_at := now();
    new.edited_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.checklist_submission_guard() from public, anon, authenticated;
create trigger checklist_submission_guard
  before insert or update on public.checklist_submissions
  for each row execute function public.checklist_submission_guard();

drop policy "members submit checklists" on public.checklist_submissions;
drop policy "admin reads checklists" on public.checklist_submissions;
drop policy "admin deletes checklists" on public.checklist_submissions;

create policy "location members read checklists" on public.checklist_submissions
  for select to authenticated
  using ((select public.is_member()) and location = (select public.current_location()));
create policy "location members submit checklists" on public.checklist_submissions
  for insert to authenticated
  with check ((select public.is_member()) and location = (select public.current_location()));
create policy "location admin edits checklists" on public.checklist_submissions
  for update to authenticated
  using ((select public.is_admin()) and location = (select public.current_location()))
  with check ((select public.is_admin()) and location = (select public.current_location()));
create policy "location admin deletes checklists" on public.checklist_submissions
  for delete to authenticated
  using ((select public.is_admin()) and location = (select public.current_location()));

-- Accounts are now managed only by the code-login function (service role).
-- Removing admin edit rights stops anyone moving their account to another location.
drop policy "admin updates profiles" on public.profiles;
drop policy "admin deletes profiles" on public.profiles;
drop policy "read own profile or admin reads all" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
