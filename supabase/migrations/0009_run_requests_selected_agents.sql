alter table run_requests
add column if not exists selected_agents text[] null;

