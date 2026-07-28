create table google_oauth_apps (
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint google_oauth_apps_pkey primary key (user_id)
);