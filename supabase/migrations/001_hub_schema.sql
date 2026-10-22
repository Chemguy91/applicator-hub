-- Applicator Hub schema
-- Roles: pending (signed up, waiting for approval), applicator (search/read), admin (upload/manage)

create extension if not exists vector with schema extensions;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending' check (role in ('pending', 'applicator', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false);
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role in ('applicator', 'admin') from public.profiles where id = (select auth.uid())), false);
$$;

create policy "read own profile or admin reads all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "admin updates profiles" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "admin deletes profiles" on public.profiles
  for delete to authenticated
  using ((select public.is_admin()) and id <> (select auth.uid()));

-- ---------- documents ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'General',
  description text,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint,
  page_count int,
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  error text,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;
create index documents_category_idx on public.documents (category);
create index documents_uploaded_by_idx on public.documents (uploaded_by);

create policy "members read documents" on public.documents
  for select to authenticated using ((select public.is_member()));
create policy "admins insert documents" on public.documents
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update documents" on public.documents
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete documents" on public.documents
  for delete to authenticated using ((select public.is_admin()));

-- ---------- chunks (searchable passages) ----------
create table public.chunks (
  id bigint primary key generated always as identity,
  document_id uuid not null references public.documents (id) on delete cascade,
  page int,
  chunk_index int not null,
  content text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  embedding extensions.vector(384)
);
alter table public.chunks enable row level security;
create index chunks_document_idx on public.chunks (document_id);
create index chunks_fts_idx on public.chunks using gin (fts);
create index chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_ip_ops);

create policy "members read chunks" on public.chunks
  for select to authenticated using ((select public.is_member()));
create policy "admins delete chunks" on public.chunks
  for delete to authenticated using ((select public.is_admin()));
-- inserts happen only through the ingest function (service role)

-- ---------- question log ----------
create table public.questions (
  id bigint primary key generated always as identity,
  user_id uuid references public.profiles (id) on delete set null default auth.uid(),
  question text not null,
  answer text,
  found boolean,
  helpful boolean,
  created_at timestamptz not null default now()
);
alter table public.questions enable row level security;
create index questions_user_idx on public.questions (user_id);

create policy "read own questions or admin reads all" on public.questions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "rate own answers" on public.questions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- hybrid search (keyword + meaning) ----------
create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(384),
  match_count int default 8,
  full_text_weight float default 1,
  semantic_weight float default 1,
  rrf_k int default 50
)
returns table (
  chunk_id bigint,
  document_id uuid,
  title text,
  category text,
  page int,
  content text,
  score float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
with full_text as (
  select c.id,
         row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
  from public.chunks c
  where c.fts @@ websearch_to_tsquery('english', query_text)
  order by rank_ix
  limit least(match_count, 30) * 2
),
loose_text as (
  -- OR-matching so one missing word doesn't hide a passage
  select c.id,
         row_number() over (order by ts_rank_cd(c.fts, q) desc) as rank_ix
  from public.chunks c,
       replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ')::tsquery q
  where numnode(q) > 0 and c.fts @@ q
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select c.id,
         row_number() over (order by c.embedding <#> query_embedding) as rank_ix
  from public.chunks c
  where c.embedding is not null
  order by rank_ix
  limit least(match_count, 30) * 2
),
fused as (
  select coalesce(f.id, l.id, s.id) as id,
         coalesce(1.0 / (rrf_k + f.rank_ix), 0.0) * full_text_weight
       + coalesce(1.0 / (rrf_k + l.rank_ix), 0.0) * full_text_weight * 0.5
       + coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight as score
  from full_text f
  full outer join loose_text l on f.id = l.id
  full outer join semantic s on coalesce(f.id, l.id) = s.id
)
select c.id, d.id, d.title, d.category, c.page, c.content, fu.score
from fused fu
join public.chunks c on c.id = fu.id
join public.documents d on d.id = c.document_id
where d.status = 'ready'
order by fu.score desc
limit least(match_count, 30);
$$;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

create policy "members read files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select public.is_member()));
create policy "admins upload files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select public.is_admin()));
create policy "admins update files" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()));
create policy "admins delete files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()));
