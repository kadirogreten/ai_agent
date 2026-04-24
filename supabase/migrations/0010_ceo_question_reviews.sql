create table if not exists ceo_question_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  job_id uuid not null references run_requests(id) on delete cascade,
  position integer not null,
  question text not null,
  suggested_answer text,
  user_answer text,
  status text not null default 'suggested' check (status in ('suggested','edited','approved')),
  confidence double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_ceo_question_reviews_job_position
on ceo_question_reviews(job_id, position);

create index if not exists idx_ceo_question_reviews_owner
on ceo_question_reviews(owner_user_id, updated_at desc);

alter table ceo_question_reviews enable row level security;

drop policy if exists ceo_question_reviews_select_own on ceo_question_reviews;
create policy ceo_question_reviews_select_own on ceo_question_reviews
  for select to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists ceo_question_reviews_insert_own on ceo_question_reviews;
create policy ceo_question_reviews_insert_own on ceo_question_reviews
  for insert to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists ceo_question_reviews_update_own on ceo_question_reviews;
create policy ceo_question_reviews_update_own on ceo_question_reviews
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

