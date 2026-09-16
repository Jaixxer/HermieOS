# HermieOS — Change Log (2026-09-17 session)

Task scheduling, deadlines, delegation briefs, and a shared progress log that
the user and Hermes both write to.

Repo base: `main` @ `5d615ab`, plus the local commit for this work.

---

## 1. Schema — migration `0011_tasks_schedule_delegation_progress`
File: `packages/db/drizzle/0011_tasks_schedule_delegation_progress.sql`
(hand-written, idempotent; journal entry added, applied to the live DB with
`pnpm db:migrate`)

`tasks` gained:
- `scheduled_for date` — the calendar day the task sits on. Day granularity on
  purpose: a `timestamp` would drift across timezones, a day does not.
- `delegate_note text` — the standing brief the user writes for Hermes.
- `delegated_at timestamptz` — when the hand-off happened (kept alongside the
  legacy `sent_to_hermes_at`, which also covers batch sends).
- `progress_percent integer not null default 0` — cached mirror of the newest
  log entry.

New table `task_updates` — the shared progress log, one row per entry:
`task_id` (cascade), `user_id` (cascade), `actor` (`user|hermes|system`),
`kind` (`progress|blocker|handoff|note|status`), `body`, `percent`,
`shared_with_hermes_at`, `created_at`. Plus `task_updates_task_created_idx`
and `task_updates_user_created_idx`.

**Why a table and not a field:** the user asked for status updates both sides
can write, including "Hermes did part of it, the rest is mine". That is a log
with authorship, not a mutable percentage.

---

## 2. The board was bucketing by the wrong date (the actual bug)

`getDashboard()`'s "today" bucket called `listTasks({since: startOfDay, until:
endOfDay})`, and `listTasks` filters `since`/`until` on **`created_at`**. So:
- a task assigned to today only appeared if it happened to be *created* today,
- and a task's **deadline had no effect on the board at all**.

The bucket now means what it says (`packages/mcp/src/data/dashboard.ts`):
assigned to today OR due today OR already `in_progress`. Overdue keeps its own
bucket, as before.

New day primitives in `packages/mcp/src/data/tasks.ts`: `listTasksForDay`,
`listOverdueTasks`, `listTasksInDayRange`, `markTaskDelegated`, `toDayKey`,
`dayStart`.

---

## 3. MCP tools (what Hermes can do)

`create_task` / `update_task` accept `scheduledFor` (`YYYY-MM-DD`) and
`delegateNote`; `list_tasks` filters by `scheduledFor`, `dueFrom`/`dueTo`,
`delegated`; `get_task` returns the log.

Two new tools (`packages/mcp/src/tools/dashboard.ts`):
- `add_task_progress` — append a log entry as Hermes: `id`, `body`, optional
  `percent` (0-100), optional `kind`.
- `list_task_progress` — read a task's log, newest first.

Rules encoded in `packages/mcp/src/data/task-updates.ts`: a percent of 1-99
promotes a `todo` task to `in_progress`; **100 does not complete it** (only the
user closes a task); a pure note without a percent touches nothing.

Live server went from 43 to **45 tools** (verified over the wire with
`tools/list`).

---

## 4. API (`packages/api/src/routes/dashboard.ts`)

- `GET /tasks?day=YYYY-MM-DD` — one day's board (assigned / due / in progress).
- `GET /tasks?from&to` — range view (assigned into OR due into) plus per-day
  `counts` for the week strip.
- `GET /tasks?delegated=true|false`.
- `GET /tasks/:id` — task + full log.
- `GET /tasks/:id/updates`, `POST /tasks/:id/updates` — append a user entry;
  **on a delegated task the entry is relayed into that task's Hermes
  conversation** and stamped `sharedWithHermesAt`. The relay never throws: the
  entry is already stored, so a gateway hiccup cannot fail the user's write.
- `POST /tasks/:id/delegate` — persists the guidance note on the task, then
  ships a brief with the task id, day, deadline, the **progress log so far**
  (so a re-delegation continues instead of restarting) and the guidance note.
  The reply tells Hermes to report through `add_task_progress`.

---

## 5. Web

New page `packages/web/src/pages/TasksPage.tsx` (**/planner**):
week strip with per-day counts, composer (day + deadline + notes + guidance for
Hermes), per-task card with deadline chip, progress bar, expandable shared log
labelled YOU / HERMES with kinds (progress, blocker, handoff, note) and a
"your part" marker, and a delegate sheet pre-filled from the stored brief.

`MissionPage` tickets now render the deadline (including *today*, with the
time) and the latest progress entry + percent.

Nav: rail entry 07 "Tasks", mobile TASKS tab, and the legacy Sidebar.

### The route is `/planner`, not `/tasks`
The API owns `GET /tasks` (the JSON list), and it wins over the static handler:
a hard load / refresh / shared link of `/tasks` returned `401 {"error":
"unauthorized"}` instead of the app shell. Found by driving the real app in a
browser, not by unit tests. `/feed` has the same latent collision (existing
page, existing route) — left alone, flagged here.

---

## 6. Verification

| Layer | Result |
|---|---|
| API suite (`test:run`) | **116/116** — incl. new `task-progress.test.ts` (18) |
| MCP suite (`test:run`) | **88/88** — incl. new `task-progress-tools.test.ts` (8, real tool path) |
| Web suite (`test:run`) | **93/93** — incl. new `TasksPage.test.tsx` (10) |
| `pnpm typecheck` | all 9 packages clean |
| Live MCP write probe | **8/8** — create scheduled task → Hermes wrote progress (actor `hermes`, 40%, promoted to `in_progress`) → read back → day board + dashboard show it → archived |
| Live UI probe (Playwright, served bundle) | **15/15** — SPA shell at `/planner`, 7-day strip, task created with `DEADLINE TODAY 06:47` + `ON THU 17 SEPT`, log entry attributed YOU, 25% bar, guidance echoed, Mission shows deadline + progress, no console errors |
| e2e `packages/web/e2e/planner.spec.ts` | passes (31 s) against the served bundle |

Probe scripts kept outside the repo:
`~/.hermes/scripts/hermieos/probe-task-scheduling.sh`,
`~/.hermes/scripts/hermieos/probe-task-write.mjs`.

Environment notes found while verifying:
- The e2e suite needs `SIGNUP_ENABLED=true` (the existing specs assert signup
  200; it is off on the live server). The new spec is token-driven and skips
  without `E2E_MCP_TOKEN`, so it runs on a hardened server too.
- `playwright.config.ts` now honours `E2E_BASE_URL`, which points the suite at
  an already-running server (the API-served bundle) instead of booting vite
  dev — enough to starve the renderer on this 3.7 GB box.
- Full-page screenshots time out under software rendering; DOM assertions are
  the reliable signal here.

State after the run: `hermieos-api` and `hermieos-mcp` restarted and active,
web bundle rebuilt into `packages/web/dist` (so the served app has the page),
0 unarchived probe tasks, 0 leftover probe sessions.
