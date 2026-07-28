-- Backfill + seed (idempotent). Run after the categories table exists
-- and subscriptions.category_id column exists.
--
-- This file is safe to run multiple times. ON CONFLICT clauses and
-- the WHERE category_id IS NULL guard make every step a no-op on the
-- second pass.

-- 1. For every (user_id, distinct non-null category text), create a
-- categories row and point subscriptions at it.
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

-- 2. Seed the original 8 well-known categories for any user who has
-- at least one subscription (covers new signups that haven't created
-- scouts yet — those users get an "Other" default category on first
-- scout creation via the API).
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

-- 3. Backfill body.category_id on existing opportunity objects so the
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
