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

---

## 7. Phone pass — usability, calendar day detail, and performance

### Calendar: a day said "3" and nothing else
`MonthGrid` renders chips from `sm:block` and, below that, coloured dots plus a
count — useless for "which task is due on the 18th?". Two fixes:

- **Task placement was wrong, not just the display.** `eventsOnDay()` filtered
  tasks by `dueAt` only, so a task *assigned* to a day (`scheduledFor`, the new
  field from §1) never appeared on the calendar at all. It now lands on both its
  assigned day and its deadline day, labelled `PLANNED` vs `DUE`.
- **`DayAgenda`** (`data-testid="day-agenda"`): under the month grid on phones,
  the tapped day's items are listed with time, kind, category, progress and
  delegation state. Tapping an empty day says `NOTHING ON THIS DAY.`
- The tasks query now uses the server-side range (`from`/`to` day keys) instead
  of downloading every task (limit 200) and filtering in the browser.
- Month cells carry `data-day` + a real `aria-label` (tests and future deep
  links can address a specific date).

### Planner (`/planner`) on a phone
- Week strip is a swipeable row of 84 px day cells (was a 4-up grid that wrapped).
- Composer stacks on phones; every input/select/button is 44 px tall at that
  width (`h-11 sm:h-*`), with a full-width primary action.
- Card actions, checkbox, status buttons and the log controls are 44 px targets.
- **Found by the phone spec, not by eye:** the planner's checkbox was still
  24×24 px on a 390 px viewport — the spec's tap-target assertion failed on it.

### Today's Mission ticket redesign
The ticket was a `flex-wrap` row where the number, checkbox, title, category
chip, rotated "stamp" and four icon buttons all competed for the same line, so
rows zig-zagged and pills wrapped mid-word. Rebuilt as one grid
(checkbox | body | actions): title with a small index, one status pill, a single
meta line (category · deadline · % done), a slim progress bar, the newest log
line, and the urgency carried by a coloured left rail (missed/blocked → red, due
today → red accent, in flight → accent, normal → white). On phones the actions
drop to their own row at 44 px; on desktop they sit in a third column.

### Performance (measured, not guessed)
`packages/web/scripts/perf-probe.mjs` drives the app at 390×844 with 4× CPU
throttling and a ~1.6 Mbps/120 ms link and reports bytes, requests, timings and
long tasks.

| | before | after |
|---|---|---|
| JS on `/planner` (1 request) | 846 kB | **435 kB in 5 requests** |
| JS on `/` | 846 kB | **427 kB** |
| image bytes | 136 kB | **0** (logo inlined at 3.6 kB) |
| longest long task | 730–965 ms | **364–434 ms** |

What produced it:
- **Route-level code splitting** (`React.lazy` per page in `App.tsx`) plus two
  vendor buckets — one shared stack, one for gsap. Finer vendor splitting was
  tried and reverted: it looked tidy in the build log but added round-trips that
  delayed first paint on a throttled phone.
- **`vendor-markdown` split out**: react-markdown + rehype-highlight + remark-gfm
  (122 kB) were in the shared vendor chunk, so every screen — including the
  phone dashboard — downloaded the chat renderer for nothing.
- **Logo: 1536×1024 / 136 kB PNG → 192×128 / 3.6 kB WebP** (it renders at 40 px).
  Encoded with Chromium's canvas (`scripts/shrink-logo.mjs`), no image deps added.
- **MissionPage stopped animating on phones**: 220-star canvas + per-frame line
  strokes + a GSAP warp timeline + a looping floating heading became a
  statically drawn 60-star field with no timeline at all (`lightMotion()`, which
  also honours `prefers-reduced-motion` and degrades safely where `matchMedia`
  is missing). The rAF loop also stops when the tab is hidden.
- **Backdrop blur removed at phone widths** (3 overlays) — a full-screen GPU pass
  per frame on mobile.
- **Fewer background refetches**: dashboard/scouts/notifications 15–30 s → 60 s,
  planner 60 s → 120 s, global `staleTime` 30 s → 60 s. SSE already pushes
  server-side changes.

Honest caveat: wall-clock "ready" in the harness barely moved (8.19 s → 8.11 s)
because that profile is dominated by fixed round-trips (page → JS → `/me` →
route chunk) rather than bytes; the halved JS and CPU work is what shows up as
scroll/tap jank on the device.

### Verification
- `pnpm --filter @hermieos/web test:run` — **95/95** (13 files), typecheck clean.
- `e2e/planner.spec.ts` passes (desktop journey).
- `e2e/mobile-phone.spec.ts` (new, Pixel-8 viewport, touch) passes: no horizontal
  overflow on `/planner`, `/calendar`, `/mission`; 44 px tap targets asserted on
  the real elements; task created with day + deadline from the phone UI; progress
  logged; calendar agenda lists the task by name; mission ticket shows
  deadline + `35% DONE`.
- Both specs are token-driven, so they run on a server with signup disabled.

---

## 8. Interaction latency — the real "it lags while typing"

§7 measured *startup*; the user's actual complaint was interaction: consistent
lag, including on every keystroke. That is not a bundle problem, so it needed its
own instrument: `packages/web/scripts/interaction-probe.mjs` types 25 characters
into a screen's main input at 390×844 with 4× CPU throttling and reports, per
key: wall time, Event-Timing events over the 16 ms frame budget, the worst one,
total event-processing time, and DOM mutations.

Baseline on `/planner` was damning:

| | before | after |
|---|---|---|
| per keystroke | 96 ms | **58 ms** |
| worst input event | 104 ms | **56 ms** |
| event processing, 25 keys | 3472 ms | **1832 ms** |

Root cause: **the composers' state lived in the page components.** On
`/planner`, `title`/`category`/`assignDay`/`deadline`/`notes`/`guidance` sat in
`TasksPage`, so every character re-rendered the page — week strip, every card,
every open progress log, every nested query consumer. `MissionPage`'s quick-add
had the same shape (`draft`/`category` at page level). On chat, the composer
lives in the same component as the transcript, so each keystroke re-rendered
every message bubble — re-parsing markdown and re-highlighting code per
character.

Changes:
- **`TaskComposer` and `MissionQuickAdd` are their own components**, owning their
  draft state and their create mutation. A keystroke now re-renders a form and
  nothing else.
- **`MessageBubble` / `MarkdownContent` are memoised** (`React.memo`), so the
  chat transcript is skipped entirely while typing. Message objects come from the
  query cache, so their identity is stable.
- **`CalendarPage` buckets items by day once per data change** (`itemsByDay`)
  instead of filtering every event/task/upcoming item for each of the 42 month
  cells on every render — 42 × N passes became N.
- Global `keydown` listeners were audited: the palette and notification bell act
  only on cmd-K / Escape and toggle nothing per keystroke.

Scroll frame times (p95, same profile) also came down: `/planner` 17 ms with
0 frames over 32 ms, from 17 ms with 2.

Caveat, stated plainly: **58 ms per key is still over the 16 ms frame budget**
under 4× CPU throttling on this box. The remaining cost is React render + paint
under throttle rather than DOM churn (mutations per key measured 0), and a real
phone is faster than this profile — but the honest next step is a React DevTools
profile of the composer subtree, or turning on the React Compiler, before
claiming typing is solved.

`/mission` and `/chat` typing could not be measured on this box: their inputs did
not appear inside the probe's 30 s window at 4× throttle (the same lazy-chunk
boot the planner passed only because it waited on a text anchor first). Their
composers got the identical mechanical fix and are covered by the unit suites
(13 files / 95 tests) and the two e2e specs.
