-- Checklists can be saved part-way (before treatment) and finished later (after treatment),
-- from any phone signed in to the same location.

alter table public.checklist_submissions
  add column status text not null default 'submitted' check (status in ('in_progress', 'submitted')),
  add column saved_at timestamptz;
create index checklist_submissions_status_idx on public.checklist_submissions (location, status);

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
    new.saved_at := case when new.status = 'in_progress' then now() else null end;
    new.edited_at := null;
    new.edited_by := null;
    if new.location is null then
      raise exception 'No location for this sign-in';
    end if;
  else
    new.location := old.location;
    new.submitted_by := old.submitted_by;
    if old.status = 'submitted' then
      -- A finished checklist stays finished; any change to it is an admin edit.
      new.status := 'submitted';
      new.submitted_at := old.submitted_at;
      new.saved_at := old.saved_at;
      new.edited_at := now();
      new.edited_by := (select auth.uid());
    else
      -- Still in progress: saving again, or finishing it.
      new.submitted_at := case when new.status = 'submitted' then now() else old.submitted_at end;
      new.saved_at := now();
      new.edited_at := old.edited_at;
      new.edited_by := old.edited_by;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.checklist_submission_guard() from public, anon, authenticated;

-- Anyone at the location can keep working on (and finish) an in-progress checklist.
-- Finished checklists can still only be changed by that location's admin.
create policy "location members continue checklists" on public.checklist_submissions
  for update to authenticated
  using ((select public.is_member()) and location = (select public.current_location()) and status = 'in_progress')
  with check ((select public.is_member()) and location = (select public.current_location()));
