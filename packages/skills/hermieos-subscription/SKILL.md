---
name: hermieos-subscription
description: "Handle a subscription run — review recent activity, dedupe, filter, and record findings via the HermieOS MCP tools. Use when the dispatch envelope has `event: subscription`. The output is recorded as typed Objects (opportunity, discovery, research, etc.) tagged with the producing scout."
license: MIT
---

# HermieOS — Subscription Run

A subscription fired. The scheduler pre-collected the relevant context.
Your job: figure out whether anything has changed in a way the user
would want to know about, and record it via the MCP tools.

## What the context contains

- `subscription` — the row from the `subscriptions` table. Has the
  `id` (UUID), `name`, `instruction` (what the user wants), `target`
  (the source the subscription watches), and the cadence.
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

## REQUIRED: tag every recorded object with the scout

**The Scouting page groups objects under the scout that produced them.
Without these fields, the scout's "Findings" tab will be empty even
though Hermes ran successfully.** This is the most common bug in
scout runs — please follow the exact contract below.

On every `mcp_hermieos_create_object` AND every
`mcp_hermieos_update_object` call, the `body` parameter must include:

```json
{
  "subscriptionId": "<subscription.id from the dispatch envelope>",
  "source": "<subscription.target>",
  "target": "<subscription.target>",
  "category_id": "<subscription.category_id or null>"
}
```

If `subscription.category_id` is null (e.g. for non-scout subscriptions
or older rows), write `null` for `category_id` rather than omitting the
field. The dashboard bucketing query reads `body->>'category_id'`
directly and treats missing the same as null, but a present-but-null
value is more explicit and easier to backfill.

For top-level `tags` (the array on the object itself, NOT in body):
use it for the things the user would search for. Examples: `["ESP32",
"WiFi"]`, `["Rust", "Database"]`, `["YC", "Seed"]`. These drive the
filter chip on the Findings tab.

Concrete example — creating a new discovery for the "esphome" scout:

```json
mcp_hermieos_create_object({
  "type": "discovery",
  "title": "ESPectre — WiFi CSI Motion Detection (8.9k★)",
  "summary": "Crowd-counting + presence detection via WiFi CSI on ESP32-S3.",
  "source": "github:esphome",
  "tags": ["ESP32", "WiFi", "Motion Detection"],
  "body": {
    "subscriptionId": "9ad6e876-4def-4ec8-a194-3fe5d5d30dd9",
    "source": "github:esphome",
    "target": "github:esphome",
    "category_id": "397f668e-fed5-47f1-9a7e-1cc071fa2b89",
    "kind": "iot",
    "stars": 8900,
    "url": "https://github.com/ESP32Spectrum/ESPectre"
  }
})
```

Concrete example — updating an existing discovery with new stars:

```json
mcp_hermieos_update_object({
  "id": "a481afe8-8cbc-46b5-ac93-3c2992d55f46",
  "body": {
    "subscriptionId": "<subscription.id>",
    "source": "github:esphome",
    "target": "github:esphome",
    "category_id": "<subscription.category_id>",
    "stars": 9200
  }
})
```

`mcp_hermieos_update_object` merges the supplied `body` fields into the
existing body — it does NOT replace the whole body. So passing the
fields above is safe; the existing fields are preserved.

Why these specific fields:

- `subscriptionId` — strict match for the Scouting Findings tab.
- `source` / `target` — fallback match for objects created before
  subscriptionId was tracked, and for objects whose author didn't set
  the field. Setting them is cheap insurance.
- `category_id` — drives the category bucket on the dashboard.
- `kind` — old convention (still respected by the dashboard for
  objects without a category_id).

## BODY field conventions

The `body` parameter is a free-form JSON object that stores all
metadata about a finding. The Object Detail page renders known fields
as structured rows and collapses the rest into a raw-JSON drawer.
Follow these conventions so the UI looks clean.

### Always include (scout linkage)

```json
{
  "subscriptionId": "<subscription.id>",
  "source": "<subscription.target>",
  "target": "<subscription.target>",
  "category_id": "<subscription.category_id or null>"
}
```

These four fields are **required** — see the "REQUIRED" section above.

### Optional fields by semantics

| Field          | Type     | When to use                          |
|----------------|----------|--------------------------------------|
| `url`          | string   | **If the content has a URL, store it here.** Papers on arXiv, repos on GitHub, articles on HN, product pages — always capture the canonical URL so the user can click through. |
| `kind`         | string   | Legacy category hint ("iot", "job", "startup"). Only needed for back-compat; prefer `category_id`. |
| `stars`        | number   | GitHub stars, HN points, or any public score/rating. |
| `cost`         | string   | Cost estimates (e.g. `"50-100 USD"`, `"Free"`, `"Freemium"`). |
| `author`       | string   | Primary author or creator name. |
| `license`      | string   | Software license or content license. |
| `language`     | string   | Programming language / content language. |
| `publishedDate`| string   | ISO date or relative string of the original publication. |
| `source`       | string   | Already included in the required set — also set here for back-compat. |
| `target`       | string   | Same as `source` — the subscription's target. |

If the finding relates to something that has an online presence,
**always set `body.url`** to the canonical link. Without it the
finding is a dead end in the UI.

### What NOT to put in body

- **Free-form descriptions** → use the top-level `summary` field
  (shown in list views, searchable, truncates at ~200 chars).
- **Tags** → use the top-level `tags` array (drives the filter chip).
  Never nest tags inside body.
- **Large payloads** — body is stored as JSONB and returned on every
  list query. Keep it under ~2 KB. If you have a long original source,
  store the URL instead.

### Example — a starred GitHub repo

```json
mcp_hermieos_create_object({
  "type": "opportunity",
  "title": "Hermes — Autonomous Agent Framework (12.4k★)",
  "summary": "A general-purpose agent framework with tool calling, web search, and multi-platform messaging.",
  "tags": ["Agent", "AI", "Open Source"],
  "body": {
    "subscriptionId": "<subscription.id>",
    "source": "github:agent-hermes/hermes",
    "target": "github:agent-hermes/hermes",
    "category_id": "<subscription.category_id>",
    "url": "https://github.com/agent-hermes/hermes",
    "kind": "research_paper",
    "stars": 12400,
    "license": "MIT",
    "language": "Python"
  }
})
```

### Example — an arXiv paper

```json
mcp_hermieos_create_object({
  "type": "research",
  "title": "Hermes: A General-Purpose Agent Architecture",
  "summary": "This paper presents Hermes, a new agent architecture...",
  "tags": ["Agent", "LLM", "Architecture"],
  "body": {
    "subscriptionId": "<subscription.id>",
    "source": "arxiv:cs.AI",
    "target": "arxiv:cs.AI",
    "category_id": "<subscription.category_id>",
    "url": "https://arxiv.org/abs/2412.12345",
    "author": "Smith et al.",
    "publishedDate": "2024-12"
  }
})
```

### Example — a SaaS product

```json
mcp_hermieos_create_object({
  "type": "opportunity",
  "title": "AgentHub — No-code AI Agent Builder",
  "summary": "A low-code platform for building and deploying AI agents.",
  "tags": ["SaaS", "No-Code", "B2B"],
  "body": {
    "subscriptionId": "<subscription.id>",
    "source": "saas:agenthub",
    "target": "saas:agenthub",
    "category_id": "<subscription.category_id>",
    "url": "https://agenthub.example.com",
    "cost": "Free tier · $29/mo Pro",
    "kind": "saas_idea"
  }
})
```

All three examples follow the same pattern: **required scout fields +
URL if linkable + domain-specific metadata keys**. Stick to this pattern
for every object you create or update.

`subscription.category_id` is the user's chosen bucket for this scout
(`job`, `startup`, `research_paper`, `saas_idea`, `iot`, `grant`,
`competition`, `other` by default — or whatever the user has set up via
`mcp_hermieos_create_category`). Do not invent new top-level categories.

When you record a finding via `mcp_hermieos_create_object` (or update
an existing one):

- Set `body.category_id` to `subscription.category_id`. This is what
  the Scouting page uses to group opportunities into category buckets.
- Use the top-level `tags` array (NOT `body.tags`) for fine-grained
  classification. Tags are free-form — pick the ones the user would
  search by. Examples: `["ESP32", "Open Source"]`,
  `["Rust", "Database"]`, `["YC", "Seed", "B2B"]`. Tag liberally but
  don't duplicate the category name as a tag.

For legacy rows that store `body.kind` (e.g. `"job"`, `"startup"`)
instead of `body.category_id`, leave them alone — the dashboard falls
back to `kind` for those.

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
