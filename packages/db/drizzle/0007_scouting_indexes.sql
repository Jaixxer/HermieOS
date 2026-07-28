-- Performance indexes for the dashboard + Scouting aggregations.
--
-- getDashboard: GROUP BY body->>'kind' on objects(type='opportunity')
-- is faster with a functional index on the jsonb key.
--
-- Scout top-sources: GROUP BY body->>'source' for objects where
-- body->>'subscriptionId' = $1. The functional index speeds the
-- GROUP BY key lookup.
--
-- Run history: filter hermes_runs by subscription_id + status, ordered
-- by created_at desc. The new index covers both the WHERE and the
-- ORDER BY, so the planner can do an index range scan.
--
-- Objects user_active_idx is a covering index for the common
-- "non-archived objects for a user, newest first" pattern used by
-- both the dashboard's recent-opportunities query and the graph
-- page's node list.
CREATE INDEX IF NOT EXISTS "objects_body_kind_idx"
  ON "objects" (("body"->>'kind'))
  WHERE "type" = 'opportunity' AND "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "objects_body_source_idx"
  ON "objects" (("body"->>'source'))
  WHERE "type" = 'opportunity' AND "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "objects_user_active_updated_idx"
  ON "objects" ("user_id", "updated_at" DESC)
  WHERE "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "hermes_runs_subscription_status_idx"
  ON "hermes_runs" ("subscription_id", "status", "created_at" DESC)
  WHERE "subscription_id" IS NOT NULL;
