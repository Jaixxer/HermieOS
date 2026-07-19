CREATE TYPE "public"."actor" AS ENUM('user', 'hermes', 'system');--> statement-breakpoint
CREATE TYPE "public"."feed_event_kind" AS ENUM('research_completed', 'opportunity_discovered', 'recommendation_changed', 'project_updated', 'decision_requested', 'subscription_update', 'task_finished', 'notification', 'object_created', 'object_archived', 'decision_resolved');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('like', 'save', 'ignore', 'archive', 'suggest');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."object_event_kind" AS ENUM('created', 'updated', 'completed', 'decision_added', 'decision_resolved', 'discovery_linked', 'archived', 'restarted', 'note_added', 'priority_changed', 'reverted_to_revision');--> statement-breakpoint
CREATE TYPE "public"."object_status" AS ENUM('active', 'in_progress', 'completed', 'open', 'resolved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."object_type" AS ENUM('project', 'research', 'discovery', 'decision', 'opportunity', 'learning_path', 'note', 'collection');--> statement-breakpoint
CREATE TYPE "public"."relationship_kind" AS ENUM('related_to', 'derived_from', 'blocks', 'cites', 'part_of');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('subscription', 'feedback_review', 'ad_hoc', 'system_notify');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('dispatched', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "feed_event_kind" NOT NULL,
	"object_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_user_object_kind_unique" UNIQUE("user_id","object_id","kind")
);
--> statement-breakpoint
CREATE TABLE "hermes_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "run_kind" NOT NULL,
	"subscription_id" uuid,
	"prompt" text NOT NULL,
	"hermes_run_id" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "run_status" DEFAULT 'dispatched' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid,
	"feed_event_id" uuid,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"priority" "notification_priority" NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "object_event_kind" NOT NULL,
	"actor" "actor" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" "relationship_kind" NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_relationships_unique" UNIQUE("from_id","to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "object_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"body" jsonb NOT NULL,
	"summary" text,
	"title" text NOT NULL,
	"status" "object_status" NOT NULL,
	"actor" "actor" NOT NULL,
	"hermes_run_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_revisions_object_revision_unique" UNIQUE("object_id","revision")
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "object_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "object_status" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" "actor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"instruction" text NOT NULL,
	"cadence" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"next_retry_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"mcp_token" text NOT NULL,
	"scheduler_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_mcp_token_unique" UNIQUE("mcp_token")
);
--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hermes_runs" ADD CONSTRAINT "hermes_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hermes_runs" ADD CONSTRAINT "hermes_runs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_feed_event_id_feed_events_id_fk" FOREIGN KEY ("feed_event_id") REFERENCES "public"."feed_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_events" ADD CONSTRAINT "object_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_from_id_objects_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_to_id_objects_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_revisions" ADD CONSTRAINT "object_revisions_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_revisions" ADD CONSTRAINT "object_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_events_user_created_idx" ON "feed_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feed_events_user_unread_idx" ON "feed_events" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "feed_events_object_idx" ON "feed_events" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "feedback_user_created_idx" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hermes_runs_user_created_idx" ON "hermes_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hermes_runs_user_status_idx" ON "hermes_runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "hermes_runs_subscription_idx" ON "hermes_runs" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "object_events_object_id_created_idx" ON "object_events" USING btree ("object_id","created_at");--> statement-breakpoint
CREATE INDEX "object_events_user_id_created_idx" ON "object_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "object_relationships_from_idx" ON "object_relationships" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "object_relationships_to_idx" ON "object_relationships" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "object_revisions_object_id_idx" ON "object_revisions" USING btree ("object_id","created_at");--> statement-breakpoint
CREATE INDEX "objects_user_type_status_updated_idx" ON "objects" USING btree ("user_id","type","status","updated_at");--> statement-breakpoint
CREATE INDEX "objects_user_archived_idx" ON "objects" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_next_idx" ON "subscriptions" USING btree ("user_id","status","next_run_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_retry_idx" ON "subscriptions" USING btree ("user_id","next_retry_at");--> statement-breakpoint
CREATE INDEX "users_archived_at_idx" ON "users" USING btree ("archived_at");