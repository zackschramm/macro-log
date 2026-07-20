create table proactive_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  type text not null,
  sent_at timestamptz default now(),
  title text,
  body text
);
alter table proactive_notifications enable row level security;
create policy "Users own their notifications" on proactive_notifications
  for all using (auth.uid() = user_id);
create index on proactive_notifications(user_id, sent_at desc);
