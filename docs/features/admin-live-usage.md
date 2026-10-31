# Admin live usage

**Admin → Live usage** shows how the concurrency lanes of this environment are
used right now: who has jobs running or waiting, at which provider, and on which
servers. It is available on every edition with an admin panel (Business and
Cloud). The live view, a user's drawer and the last 30 days answer only an
admin signed in to the app — an API or app token cannot read them.

Each person's jobs are counted in four lanes: **Provider** (calls to an outside
AI provider other than text models), **LLM** (text-model calls), **Local** (work
the server does itself, such as ffmpeg and renders) and **Runs** (whole workflow
runs, pipelines and directors). A person's own work, their workspace work and
work paid by a deployment are separate lines, each with its own lanes. See
[Concurrency lanes](../deployment.md#concurrency-lanes) for the sizes and the
environment variables.

## Live

The page refreshes every 3 seconds while its tab is in view. Two views share the
same figures; the page remembers which one you last used.

- **Users** — the totals (active users, running, queued, longest wait, and
  "would wait" while limits are off), then one row per user with anything
  running or queued, split by line: their plan (and a badge when they have an
  override), each lane as running, queued and free slots, their oldest wait and
  where the work came from (editor, API, MCP, app run, webhook, schedule). MCP
  work also names its clients, as each client names itself (for example
  "MCP · client-a 3, client-b 2"; up to five, the rest counted as others). Client
  names are shown live only and are not kept in the history. Users with the
  most waiting come first.
- **Providers** — one row per provider: jobs in flight against its platform
  ceiling, the users driving it, and its failure rate over the last 15 minutes.
  Work that is not limited (for example character training, which runs for
  hours at the provider) is listed apart.

Below either view, the servers strip shows each background worker pool's
occupancy against the share one person may hold.

Click a user in either view to open their drawer: their running and waiting
jobs (type, model, source, how long each has waited or run), a **Cancel** on a
job waiting for a slot, their override editor (Cloud), and their last 30 days.
Cancel asks first, and goes through the owner's own cancel; on Cloud the job's
reserved credits are refunded.

## Last 30 days

A daily summary per user and per provider: peak running, peak queued, peak over
the limit, longest wait, minutes spent at the limit, jobs that timed out in the
queue and live waits that expired. The history is kept for 90 days and shown as
the last 30.

## Measure-only

Concurrency limits are **off** by default. While they are off the lanes only
measure: every job starts at once and nothing waits. A job that would have
waited is counted as over its limit, and the page shows those as "would wait",
so you can see what limits would do before turning them on.

**Concurrency limits cannot be turned on yet in this release.** The page shows
the switch and its checks, but the switch stays off.

## Settings

The **Settings** tab holds the lanes' configuration:

- **Plan sizes** (Cloud) — how many jobs of each lane one line runs at once,
  per plan, each from 1 to 500. A user's override wins over their plan. A change
  applies within a minute; lowering a size stops nothing already running.
  Without plans (Business), every line has the same sizes, set by the server's
  environment, and the table is read-only.
- **Provider ceilings** (Cloud) — the most jobs the whole platform runs at once
  at one provider. A provider with no ceiling is not limited. Removing a
  ceiling asks first. Business has no provider ceilings.
- **Waiting limits** — the queue timeout (how long a queued job may wait for a
  free slot before it fails, refunded on Cloud; 5 to 1440 minutes, default 120)
  and the live-wait limit (how long a request answered while you wait may wait
  before it answers that the server is busy; from 1 minute up to the maximum
  the tab shows — 60 minutes today — default 10). On Cloud they are set here;
  on Business the tab shows them read-only, from each server's environment
  variables.
- **The switch** — turns concurrency limits on or off. It lists what should be
  true first, with the current values: the lane columns are in this database,
  every plugin job type declares its lane, the live-wait ceiling has been
  measured, and there are at least 7 days of measure-only data. Turning limits
  on always asks for confirmation, and with an item unmet only **Turn on
  anyway** turns them on. Turning them off starts every waiting job at once. In
  this release the switch is disabled.

**Shared settings, per-environment switch.** On Cloud, plan sizes, user
overrides, provider ceilings and the waiting limits are stored in the database,
so when two environments share one database (staging and production) a change
applies to both. The switch is the exception: each environment keeps its own.
On Business the sizes and the waiting limits come from each server's
environment variables instead.

On Cloud any admin can change these settings, cancel a waiting job and use
the switch. On Business only the switch and the cancel can be used; everything
else is read-only. On an instance whose usage a deployment payer funds, only a
platform operator can change anything, and other admins can read the tab.
