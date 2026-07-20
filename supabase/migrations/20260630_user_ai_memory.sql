-- Per-user AI memory store for the in-app coach

create table public.user_ai_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('preference', 'pattern', 'goal', 'feedback', 'context')),
  content text not null,
  importance integer default 5 check (importance between 1 and 10),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_used_at timestamptz default now(),
  use_count integer default 0,
  is_active boolean default true
);

-- Index for fast per-user lookups
create index user_ai_memory_user_id_idx on public.user_ai_memory(user_id, is_active, importance desc);

-- RLS
alter table public.user_ai_memory enable row level security;
create policy "Users can manage own memories" on public.user_ai_memory
  for all using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_user_ai_memory_updated_at
  before update on public.user_ai_memory
  for each row execute function public.update_updated_at_column();
