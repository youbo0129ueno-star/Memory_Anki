create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users can read their data" on public.user_data
  for select using (auth.uid() = user_id);

create policy "Users can upsert their data" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "Users can update their data" on public.user_data
  for update using (auth.uid() = user_id);
