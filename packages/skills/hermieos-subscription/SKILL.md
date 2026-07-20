---
name: hermieos-subscription
description: Handle a subscription run — review recent activity, dedupe, filter, update or create objects as warranted. Load this skill when the dispatch envelope has `event: subscription`.
version: 1.0.0
author: HermieOS
---

# HermieOS — Subscription Run

A subscription fired. The scheduler pre-collected the relevant context.
Your job: figure out whether anything has changed in a way the user would
want to know about, and record it via the MCP tools.

## What the context contains

- `subscription` — the row from the `subscriptions` table. Has the
  `instruction` (what the user wants), the `target` (the source the
  subscription watches), and the cadence.
- `related_objects` — up to 10 objects the scheduler thinks are related:
  same target, same type, recently updated. Most recent first.
- `recent_feedback` — feedback signals on the related objects in the
  last 7 days. Each row has `kind` (like/save/ignore/suggest), `payload`
  (with the user's note for `suggest`), and the `object` it was on.
- `recent_activity` — feed events the user has already seen for the
  related objects in the last 7 days. Skip anything already here.

## The workflow

1. Read the `subscription.instruction` and `subscription.target` together.
   The instruction is the *intent*; the target is the *source*.

2. **Dedupe the recent_activity against related_objects.** The
   scheduler joined these loosely. If an object is in both, prefer the
   related_objects entry (it's newer). If a feed event refers to a
   related object that has since been updated, the update is what
   matters.

3. **Decide whether anything has changed.** Three signals count:
   - The related_objects have new content the user hasn't seen yet
     (compare against `recent_activity`).
   - The user gave new feedback on a related object that warrants an
     update.
   - The instruction asks you to *look for* something specific, and
     the pre-collected context doesn't have it.

4. **If nothing has changed, write nothing.** An empty summary is fine:
   "Watched `target`. No new findings." The user is happy not to be
   notified.

5. **If something has changed, write it.** For each meaningful finding:
   - If a `related_object` covers it, `mcp_hermieos_update_object` with
     the new content. Don't create a new object when an existing one
     fits.
   - If it's a brand-new finding (no related object), one
     `mcp_hermieos_create_object` is justified.
   - Link new objects to the most relevant existing object with
     `mcp_hermieos_link_objects`.

6. **If the user has been ignoring the related objects for a while**
   (`recent_feedback` is mostly `ignore` or `archive`), consider whether
   the subscription is still worth running. Don't archive unilaterally,
   but a one-line note in your summary is appropriate.

## Filtering noisy sources

Some sources are noisy by nature (GitHub releases, arXiv, HN front page).
Apply a filter before deciding each item is worth recording:

- **GitHub repos**: skip archived, forks, and repos with no activity in
  the last 6 months. Default to language/stars thresholds only if the
  subscription's `target` string implies them.
- **arXiv papers**: skip papers that don't match the subscription's
  intent. Look at title and abstract, not just metadata.
- **HN front page**: skip "Show HN" projects with no comments and
  stories with score < 50 unless the subscription's intent is
  breadth-of-coverage.

When in doubt about whether to record, prefer one high-signal object
over five low-signal ones. Quality over quantity.

## When to notify

The orchestrator's default is no notification. Override it only when
the user would otherwise miss something actionable — for example, a
subscription that has been quietly finding nothing for 6 weeks
suddenly finds a major release. Most runs do not notify.

## Output format

Your text summary is at most two sentences. Format:

> Watched `<target>`. Found N worth recording: <one-line gist>.

If nothing was recorded:

> Watched `<target>`. No new findings.
