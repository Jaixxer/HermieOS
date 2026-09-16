-- 0011: task scheduling, delegation, and the shared progress log.
--
-- Three things land here:
--   * scheduled_for  — the calendar day a task belongs to (the mission
--                      board buckets by this, not by created_at).
--   * delegate_note / delegated_at — the standing brief the user writes
--                      for Hermes and when it was handed over.
--   * task_updates   — the progress log. Both the user (app) and Hermes
--                      (add_task_progress MCP tool) append rows here;
--                      tasks.progress_percent caches the newest claim.
--
-- Idempotent on purpose: safe to re-run against a partially migrated DB.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_update_kind') THEN
    CREATE TYPE "public"."task_update_kind" AS ENUM('progress', 'blocker', 'handoff', 'note', 'status');
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "scheduled_for" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "delegate_note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "delegated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tasks_user_scheduled_idx" ON "tasks" ("user_id","scheduled_for");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor" "actor" NOT NULL,
	"kind" "task_update_kind" DEFAULT 'progress' NOT NULL,
	"body" text NOT NULL,
	"percent" integer,
	"shared_with_hermes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_updates_task_id_tasks_id_fk') THEN
    ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_updates_user_id_users_id_fk') THEN
    ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "task_updates_task_created_idx" ON "task_updates" ("task_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_updates_user_created_idx" ON "task_updates" ("user_id","created_at");
