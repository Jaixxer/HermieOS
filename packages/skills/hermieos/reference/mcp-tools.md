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

## When the context bundle is wrong

If a tool returns a 404 or an object_id you expected to exist is
missing, do not retry with a different id. Mention the issue in
your summary and move on. The scheduler will see the empty run in
the next cycle.
