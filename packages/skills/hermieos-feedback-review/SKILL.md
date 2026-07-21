---
name: hermieos-feedback-review
description: Periodic review of accumulated user feedback. Update object priorities and surface ranking shifts. Load this skill when the dispatch envelope has `event: feedback_review`.
version: 1.0.0
author: HermieOS
---

# HermieOS — Feedback Review

The user has accumulated feedback since the last review. The scheduler
bundled the raw rows. Your job: figure out which objects deserve a
priority shift and apply small, conservative updates.

## What the context contains

- `since` — the timestamp of the last feedback review (or epoch if
  none). All feedback rows are strictly newer than this.
- `stats` — a small summary header for the context. Use this to
  spot trends without scanning 200 rows first. Specifically:
  - `stats.total` — number of feedback rows in this window.
  - `stats.by_kind` — per-kind counts. e.g. `{like: 12, ignore: 7, suggest: 2}`.
  - `stats.liked_or_saved_by_type` — per-type breakdown of the rows
    that were `like` or `save`. e.g. `{discovery: 8, project: 4}`. Use
    this to see which Object types the user is engaging with.
  - `stats.suggest_notes` — the user's free-form `suggest` notes
    (if any). Always read these — they're the highest-signal
    qualitative feedback.
- `feedback_rows` — the raw rows, not aggregated. Each row has:
  - `kind`: `like` | `save` | `ignore` | `archive` | `suggest`
  - `object_id` and the full `object` row
  - `payload` — for `suggest`, the user's text note
  - `created_at`

Do not re-fetch feedback. The context is the source of truth.

## Reading the signals

The kinds mean different things:

- `like` — the user found this useful. Bump `priority` by `+1`.
- `save` — stronger than like. The user wants to come back to it.
  Bump `priority` by `+2`.
- `ignore` — the user saw it and didn't want it. Drop `priority` by
  `-1`. If the object is already low and has multiple `ignore` signals
  in this window, consider archiving via `mcp_hermieos_update_object`
  with `status: 'archived'`. Do not auto-archive without at least 3
  `ignore` signals in this window.
- `archive` — the user explicitly archived it. Set
  `status: 'archived'`. The object is no longer surfaced in default
  feed views.
- `suggest` — the user wrote a note explaining what they want instead.
  **Always read `payload.note`.** If the note describes a research
  direction, find or create the appropriate object. If it's a
  clarification of an existing object, update it. A `suggest` row
  without a note is just metadata; skip it.

When `stats.liked_or_saved_by_type` shows a strong pattern
(e.g. 8 of 10 liked rows are `discovery`), that's a real signal
about what the user values. Use `mcp_hermieos_create_object` to
record that pattern as a Project or a Note, so future runs see it.

The kinds and notes carry more signal than a histogram would. The
`stats` block is a fast-read summary; the rows are the detail.

## Apply small shifts

The orchestrator's default is "don't change priority aggressively."

- A single `like` is `+1`, not `+5`.
- A `+10` should require strong consensus — many `like` and `save`
  signals across multiple users (rare in a single-user system; in MVP
  this means a flurry of activity in a short window).
- A `-1` on a single `ignore` is small enough to be noise. Only drop
  priority if the `ignore` cluster is recent (within 30 days) and
  consistent (no recent `like` or `save` on the same object).

If you are unsure, leave `priority` alone. A small shift is easier to
reverse than a large one.

## Don't notify

This is a review, not a run. The user does not need a Feed event
saying "I reviewed your feedback." The only output is a small text
summary describing what you changed.

## Output format

Your text summary is at most two sentences. Format:

> Reviewed N feedback rows. Bumped `<object title>` to <priority> based
> on <kind>. <if applicable: one more change>.

If nothing changed:

> Reviewed N feedback rows. No priority shifts warranted.
