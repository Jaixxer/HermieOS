CREATE TYPE "public"."opportunity_category" AS ENUM('job', 'startup', 'research_paper', 'saas_idea', 'iot', 'grant', 'competition', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_category" AS ENUM('work', 'learning', 'research', 'health', 'admin', 'personal', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upcoming_kind" AS ENUM('appointment', 'deadline', 'milestone', 'reminder', 'event');--> statement-breakpoint
-- NOTE: feed_event_kind 'priority_changed' is added in 0002 (IF NOT EXISTS);
-- do NOT re-add here — Postgres 42710 aborts the whole migration chain.
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"category" "opportunity_category" NOT NULL,
	"url" text,
	"source" text,
	"relevance_score" real,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" "actor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NOTE: push_subscriptions is created in 0003 (IF NOT EXISTS) with the same
-- columns + endpoint unique + user FK. Do NOT re-create here — 42P07 aborts
-- the whole migration chain. This migration only adds tasks/upcoming/etc.
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"category" "task_category" DEFAULT 'other' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" "actor" NOT NULL,
	"batch_id" uuid,
	"sent_to_hermes_at" timestamp with time zone,
	"object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upcoming" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"kind" "upcoming_kind" DEFAULT 'event' NOT NULL,
	"occurs_at" timestamp with time zone NOT NULL,
	"location" text,
	"notes" text,
	"created_by" "actor" NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- NOTE: push_subscriptions FK already exists via 0003's inline REFERENCES.
-- Do NOT re-add a named FK here.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upcoming" ADD CONSTRAINT "upcoming_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_user_category_idx" ON "opportunities" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_user_unread_idx" ON "opportunities" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_user_created_idx" ON "opportunities" USING btree ("user_id","created_at");--> statement-breakpoint
-- NOTE: push_subscriptions_user_idx already exists via 0003 (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS "tasks_user_status_due_idx" ON "tasks" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_user_batch_idx" ON "tasks" USING btree ("user_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_user_category_idx" ON "tasks" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_user_archived_idx" ON "tasks" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upcoming_user_occurs_idx" ON "upcoming" USING btree ("user_id","occurs_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upcoming_user_archived_idx" ON "upcoming" USING btree ("user_id","archived_at");