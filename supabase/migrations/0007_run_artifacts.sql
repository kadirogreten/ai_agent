create table if not exists run_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  run_id uuid not null,
  kind text not null check (kind in ('image')),
  file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_run_artifacts_run_file on run_artifacts(run_id, file_name);
create index if not exists idx_run_artifacts_owner on run_artifacts(owner_user_id);
create index if not exists idx_run_artifacts_run on run_artifacts(run_id);

alter table run_artifacts enable row level security;

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'run-artifacts'
  ) then
    insert into storage.buckets (id, name, public)
    values ('run-artifacts', 'run-artifacts', false);
  end if;
end $$;

drop policy if exists "run_artifacts_select_own" on run_artifacts;
create policy "run_artifacts_select_own"
on run_artifacts
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "run_artifacts_insert_own" on run_artifacts;
create policy "run_artifacts_insert_own"
on run_artifacts
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "run_artifacts_update_own" on run_artifacts;
create policy "run_artifacts_update_own"
on run_artifacts
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "run_artifacts_read_own_objects" on storage.objects;
create policy "run_artifacts_read_own_objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'run-artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

