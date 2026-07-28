-- Drop the opportunities table and its category enum (added in 0005_mute_tigra.sql).
-- Opportunities are now represented as objects(type='opportunity') — the canonical
-- knowledge model. Read state uses objects.status ('open' = unread, 'archived' = dismissed).
DROP TABLE IF EXISTS "opportunities";--> statement-breakpoint
DROP TYPE IF EXISTS "opportunity_category";--> statement-breakpoint

-- Add a category column to subscriptions. NULL for non-scout subscriptions
-- (feedback_review, etc). Scout subscriptions set this to the inbox bucket
-- they feed: 'job' | 'startup' | 'research_paper' | 'saas_idea' | 'iot' | etc.
ALTER TABLE "subscriptions" ADD COLUMN "category" text;--> statement-breakpoint
CREATE INDEX "subscriptions_user_category_idx" ON "subscriptions" USING btree ("user_id","category") WHERE "category" IS NOT NULL;
