-- User-managed scouting categories.
--
-- The Scouting Inbox is now organized by user-created categories
-- (Jobs, Research, Startups, IoT, …) rather than a fixed enum. Each
-- user starts with the original 8 well-known categories seeded
-- automatically; Hermes never invents new top-level categories.
--
-- A scout (subscriptions row) links to one category via category_id.
-- Opportunities (objects.type='opportunity') link to the same category
-- via body.category_id, set by the agent when it records a finding.
-- Legacy rows that have a non-null `subscriptions.category` text value
-- are backfilled into the categories table; the text column is kept
-- for the transition window but no application code reads it.

-- 1. Enums for category appearance
CREATE TYPE "category_color" AS ENUM (
  'emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'
);

CREATE TYPE "category_icon" AS ENUM (
  'briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy',
  'graduation-cap', 'dollar-sign', 'cpu', 'layers', 'help-circle'
);

-- 2. categories table
CREATE TABLE "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" "category_color" NOT NULL DEFAULT 'slate',
  "icon" "category_icon" NOT NULL DEFAULT 'help-circle',
  "sort_order" integer NOT NULL DEFAULT 0,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Active categories per user must have a unique name (case-sensitive;
-- the server validates case-insensitively for friendlier UX).
CREATE UNIQUE INDEX "categories_user_name_unique"
  ON "categories" ("user_id", "name");

CREATE INDEX "categories_user_archived_idx"
  ON "categories" ("user_id", "archived_at");
CREATE INDEX "categories_user_sort_idx"
  ON "categories" ("user_id", "sort_order");

-- 3. subscriptions.category_id (FK to categories)
ALTER TABLE "subscriptions"
  ADD COLUMN "category_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL;

-- Replace the old free-form text index with one on the FK.
DROP INDEX IF EXISTS "subscriptions_user_category_idx";
CREATE INDEX "subscriptions_user_category_idx"
  ON "subscriptions" ("user_id", "category_id");

-- 4. Backfill: for every (user_id, distinct non-null category text)
-- create a categories row, then point subscriptions at it.
--
-- We pick a default color/icon from a small deterministic mapping so
-- the seeded categories look reasonable until the user customizes them.
DO $$
DECLARE
  rec RECORD;
  v_color "category_color";
  v_icon "category_icon";
BEGIN
  FOR rec IN
    SELECT DISTINCT user_id, category
    FROM subscriptions
    WHERE category IS NOT NULL
  LOOP
    -- Deterministic color/icon by category name
    v_color := CASE rec.category
      WHEN 'job'            THEN 'emerald'::"category_color"
      WHEN 'startup'        THEN 'purple'::"category_color"
      WHEN 'research_paper' THEN 'sky'::"category_color"
      WHEN 'saas_idea'      THEN 'amber'::"category_color"
      WHEN 'iot'            THEN 'teal'::"category_color"
      WHEN 'grant'          THEN 'rose'::"category_color"
      WHEN 'competition'    THEN 'indigo'::"category_color"
      ELSE 'slate'::"category_color"
    END;
    v_icon := CASE rec.category
      WHEN 'job'            THEN 'briefcase'::"category_icon"
      WHEN 'startup'        THEN 'trending-up'::"category_icon"
      WHEN 'research_paper' THEN 'file-text'::"category_icon"
      WHEN 'saas_idea'      THEN 'lightbulb'::"category_icon"
      WHEN 'iot'            THEN 'radar'::"category_icon"
      WHEN 'grant'          THEN 'dollar-sign'::"category_icon"
      WHEN 'competition'    THEN 'trophy'::"category_icon"
      ELSE 'help-circle'::"category_icon"
    END;

    INSERT INTO categories (user_id, name, color, icon)
    VALUES (rec.user_id, rec.category, v_color, v_icon)
    ON CONFLICT (user_id, name) DO NOTHING;

    UPDATE subscriptions
    SET category_id = categories.id
    FROM categories
    WHERE subscriptions.user_id = rec.user_id
      AND subscriptions.category = rec.category
      AND categories.user_id = rec.user_id
      AND categories.name = rec.category
      AND subscriptions.category_id IS NULL;
  END LOOP;
END $$;

-- 5. Seed the original 8 well-known categories for any user who has
-- at least one subscription (covers new signups that haven't created
-- scouts yet — those users get an "Other" default category on first
-- scout creation via the API).
--
-- This is a no-op for users who already have all 8 via subscriptions
-- backfill, because of the unique index.
INSERT INTO categories (user_id, name, color, icon, sort_order)
SELECT u.id, k.name, k.color::"category_color", k.icon::"category_icon", k.sort_order
FROM users u
CROSS JOIN (VALUES
  ('job',            'emerald',   'briefcase',     10),
  ('startup',        'purple',    'trending-up',   20),
  ('research_paper', 'sky',       'file-text',     30),
  ('saas_idea',      'amber',     'lightbulb',     40),
  ('iot',            'teal',      'radar',         50),
  ('grant',          'rose',      'dollar-sign',   60),
  ('competition',    'indigo',    'trophy',        70),
  ('other',          'slate',     'help-circle',   80)
) AS k(name, color, icon, sort_order)
ON CONFLICT (user_id, name) DO NOTHING;

-- 6. Backfill body.category_id on existing opportunity objects so the
-- dashboard can bucket by FK instead of the legacy text field.
UPDATE "objects" o
SET "body" = jsonb_set(
  o."body",
  '{category_id}',
  to_jsonb(s."category_id"::text)::jsonb
)
FROM "subscriptions" s
WHERE s.id = (o."body"->>'subscriptionId')::uuid
  AND s."category_id" IS NOT NULL
  AND o."body"->>'category_id' IS NULL
  AND o."type" = 'opportunity'
  AND o."archived_at" IS NULL;
