-- Contact form submissions. Every message is stored before it is emailed,
-- so a delivery failure never loses it, and the row doubles as the rate
-- limiter's record (ip_hash is a salted hash; the address itself is never
-- stored).

create table public.contact_messages (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  topic       text not null,
  message     text not null,
  ip_hash     text,
  user_agent  text,
  status      text not null default 'received' check (status in ('received','sent','failed')),
  resend_id   text,
  error       text
);

create index contact_messages_ip_idx on public.contact_messages (ip_hash, created_at desc);
create index contact_messages_created_idx on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
grant select, insert, update on public.contact_messages to service_role;
