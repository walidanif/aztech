create table if not exists public.az_store (
    id integer primary key check (id = 1),
    data jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.az_store enable row level security;

create table if not exists public.az_sessions (
    token_hash text primary key,
    user_id uuid not null,
    expires_at timestamptz not null
);

create index if not exists az_sessions_user_id_idx on public.az_sessions (user_id);
create index if not exists az_sessions_expires_at_idx on public.az_sessions (expires_at);
alter table public.az_sessions enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-images',
    'product-images',
    true,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
