# MCP tool reference

The HermieOS MCP server exposes these tools. The orchestrator's
`SKILL.md` calls them by their `mcp_hermieos_*` prefix; this file is
loaded only when you need details.

## Object lifecycle

- `mcp_hermieos_create_object` — write a new `object` row plus its
  first `object_revisions` row. Returns `{ object, revision }`.
  Required: `type`, `title`. Optional: `summary`, `body`, `status`,
  `tags`.
- `mcp_hermieos_update_object` — write a new revision of an existing
  object. Returns the new revision. Optional: `title`, `summary`,
  `body`, `status`, `tags`, `priority`. **Priority changes do not
  create a revision** — they're metadata.
- `mcp_hermieos_get_object` — read a single object with its
  lightweight related summary. Use this only when the context bundle
  is missing the object you need.
- `mcp_hermieos_list_objects` — list objects, filterable by `type`,
  `status`, `tag`. Paginated.

## Search and discovery

- `mcp_hermieos_search_objects` — FTS over title + summary + body.
  Filter by `type`. Returns ranked hits with snippets. Use this for
  research, not for routine context — the scheduler pre-collected
  the relevant objects.
- `mcp_hermieos_get_recent_activity` — feed events for the user,
  paginated. The scheduler pre-loaded recent activity for the
  subscription; only use this for ad-hoc chat research.
- `mcp_hermieos_get_object_timeline` — paginated event log for one
  object. Use this when you need to see how an object changed over
  time.
- `mcp_hermieos_list_object_revisions` — paginated revisions,
  newest first. Use this when you need to see the history of an
  object.

## Relations and feedback

- `mcp_hermieos_link_objects` — upsert an edge between two objects.
  Required: `from_id`, `to_id`, `kind`. Optional: `confidence` (0-1),
  `reason`. Use this to express "discovery X is related to project Y."
- `mcp_hermieos_unlink_objects` — remove an edge.
- `mcp_hermieos_record_feedback` — write a `feedback` row on behalf
  of the user. The agent should **not** call this; the user records
  feedback directly through the UI.

## Notifications

- `mcp_hermieos_notify_user` — write a `notifications` row. The
  rate limit is 5/day. **Default to not calling this.** Reserve it
  for genuinely surprising findings, failed runs the user would
  want to know about, or research answers that complete after the
  user has moved on.

## Scouting (subscriptions)

These are the "scout" agents that run on a cadence. The user
manages them in the Scouting page, but **you are allowed to adjust
them** — the user expects you to retune a scout when the evidence
warrants it.

- `mcp_hermieos_create_subscription` — create a recurring scout.
  Required: `name`, `target` (the source, e.g. `arxiv:cs.AI` or
  `github:owner/repo`), `instruction` (what the user wants), and
  `cadence` (`hourly` | `every_6_hours` | `every_12_hours` |
  `daily` | `weekly`). Provide `categoryName` (snake_case) or
  `categoryId` for a scouting bucket.
- `mcp_hermieos_update_subscription` — modify an existing scout:
  rename it, change the `target`, rewrite the `instruction`
  (tighten scope, change what to look for), change the `cadence`,
  or flip `status` to `paused`/`active`. **This is the tool to use
  when the user's feedback says a scout is off-track.** Pass
  `categoryId: null` to demote it out of the Scouting inbox.
- `mcp_hermieos_list_subscriptions` — list the user's scouts,
  optionally filtered by `status`.
- `mcp_hermieos_get_subscription` — fetch one scout by id (read it
  before deciding what to change).
- `mcp_hermieos_archive_subscription` — archive a scout. It stops
  running. Reversible via `update_subscription`.
- `mcp_hermieos_run_subscription_now` — force a scout to run on
  the next scheduler tick. Use when the user asked for an update
  and the scout isn't due yet.

Scouting categories (the buckets in the Scouting inbox):
`mcp_hermieos_create_category`, `mcp_hermieos_update_category`,
`mcp_hermieos_archive_category`, `mcp_hermieos_list_categories`.

## Task board and progress

The user's task board is shared state: they write to it in the app, you
write to it through these tools. The progress log is the hand-off
channel for delegated work.

- `mcp_hermieos_create_task` — add a task. Required: `title`.
  Optional: `notes` (put the real specifics here, not a restatement of
  the title), `category` (`work` | `learning` | `research` | `health` |
  `admin` | `personal` | `other`), `status`, `priority`, `scheduledFor`
  (calendar day `YYYY-MM-DD` — the day it sits on the board), `dueAt`
  (hard deadline, strict UTC `Z`), `delegateNote` (standing brief for
  you), `objectId`, `batchId`.
- `mcp_hermieos_update_task` — change any of the above by `id`, plus
  `status`. Pass `scheduledFor: null` to unassign the day, `dueAt: null`
  to clear the deadline.
- `mcp_hermieos_add_task_progress` — append one entry to a task's shared
  progress log. Required: `id`, `body`. Optional: `percent` (0-100;
  1-99 promotes a `todo` task to `in_progress`, 100 does not complete
  it), `kind` (`progress` | `blocker` | `handoff` | `note` | `status`).
  The user sees every entry in the app; on a delegated task their
  entries come back to you the same way.
- `mcp_hermieos_list_task_progress` — read a task's log, newest first
  (`id`, optional `limit`, default 20). Catch up on delegated work
  before continuing it.
- `mcp_hermieos_get_task` — one task plus its full progress log.
- `mcp_hermieos_list_tasks` — filter by `status`, `category`,
  `batchId`, `scheduledFor` (one day), `dueFrom`/`dueTo` (deadline
  window), `delegated` (true = only tasks handed to you), `since`/
  `until` (creation range), `limit`.
- `mcp_hermieos_get_dashboard` — `tasks.today` is the live board
  (assigned today, due today, or in progress) with deadlines,
  delegation state, `progressPercent` and `latestUpdate`; `tasks.overdue`
  is the separate overdue bucket.
- `mcp_hermieos_send_tasks_to_hermes` — records that a batch was handed
  over. The delegation itself is the app's job; this only stamps the
  dispatch time so the UI can show it.

## When the context bundle is wrong

If a tool returns a 404 or an object_id you expected to exist is
missing, do not retry with a different id. Mention the issue in
your summary and move on. The scheduler will see the empty run in
the next cycle.
