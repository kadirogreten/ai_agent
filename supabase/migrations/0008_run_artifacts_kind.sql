alter table run_artifacts drop constraint if exists run_artifacts_kind_check;
alter table run_artifacts add constraint run_artifacts_kind_check check (kind in ('image','file'));

