CREATE TABLE IF NOT EXISTS "google_oauth_tokens" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "scope" text NOT NULL DEFAULT '',
  "email" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "external_id" text NOT NULL,
  "calendar_id" text NOT NULL DEFAULT 'primary',
  "title" text NOT NULL,
  "description" text,
  "location" text,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "all_day" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'confirmed',
  "attendees" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "raw" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_user_external_unique" ON "calendar_events"("user_id","external_id");
CREATE INDEX IF NOT EXISTS "calendar_events_user_starts_at_idx" ON "calendar_events"("user_id","starts_at");
