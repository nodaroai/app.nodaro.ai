# Schedule Trigger

**Category:** Input · **Cost:** free (the nodes it starts pay their own way)

The Schedule Trigger runs a workflow on a schedule you describe in plain terms — every 20 minutes, every day at 9:00, weekdays at 18:30, the 1st of every third month — or, if you prefer, as a cron expression. A schedule is a list of **rules**; the workflow runs whenever any rule matches the current minute, read in the timezone you choose.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it — the nodes downstream of the trigger, plus every node those nodes need as input (so a branch that also reads from a node off to the side gets a fresh result). Nodes the trigger does not reach are left alone. A trigger **wired to nothing** runs the whole workflow. This is what lets one workflow carry several triggers, each starting its own branch. A manual run from the editor, an API run and a published app are not scoped by triggers.

"Wired" is anything that feeds another node: a drawn connection, a node inside a Group (it feeds the group), or a field mapping. The run starts from the node the schedule was saved from; a schedule created by hand through the API names no node, so the only Schedule Trigger on the canvas is used — with two such nodes there is no honest answer, and the whole workflow runs. The switch card in the node's settings tells you which case you are in.

**A branch that stops for a review is refused.** When the branch a trigger runs holds an [Apply EDL](../processing-video/apply-edl.md) render set to **Proxy** (a Preview), nobody is there to review what it renders, so every fire is refused before anything runs or is billed. The workflow's run history shows one failed run with the code `preview_review_required` (repeated fires do not add more), and the trigger's card warns while it is switched on. Set the render's **Quality** to **Final** to let the trigger run. (Rolled out under a flag, `PREVIEW_STOP_RULE_ENABLED`; where it is off, nothing is refused. See [Apply EDL](../processing-video/apply-edl.md#a-run-stops-at-a-preview).)

## Turning it on

**A schedule runs only while its switch is on.** Placing the node and saving registers the schedule but does not start it: the card says *Paused* and nothing runs until you turn it on —

- in the node's settings, with the switch at the top of the panel, or
- with the **Schedule** button in the editor's top bar, shown whenever the workflow has a Schedule Trigger. It turns every schedule in the workflow on (or, when all are on, off) and saves.

Turning it off pauses the schedule the same way. The switch is part of the node (`"active": true` in its data), so a schedule created through the API, the SDK or MCP is on only when that field says so, and a template export never carries it — an imported schedule always starts paused.

To try the branch right now without turning the schedule on, use **Run from here** at the bottom of the panel (a trigger wired to nothing has no branch to run from — run the workflow instead).

## Configuration

| Field | What it does |
|-------|--------------|
| Presets | *Every 5 min*, *Hourly*, *Daily 9am*, *Weekdays 9am* — one click writes the matching rule (the chip lights up when the schedule is exactly that rule) |
| Trigger rules | One or more rules, each with its own interval and fields (below). The last rule cannot be removed. |
| Timezone | The clock the rules are read in — a searchable list of every timezone, your own offered first. UTC when not set. |
| Max executions | Stop after this many runs. Leave empty for unlimited. |
| Switch | Active / Paused — see above |

### Rules

| Interval | Fields | Runs |
|----------|--------|------|
| Minutes | every 1–59 | at minute 0, N, 2N… of every hour |
| Hours | every 1–23, minute | at hour 0, N, 2N… of every day, at that minute |
| Days | every 1–31, hour, minute | every Nth calendar day at that time |
| Weeks | every 1–52, weekdays, hour, minute | on those weekdays, every Nth week (weeks start on Monday) |
| Months | every 1–12, day of month 1–31, hour, minute | on that day — or the month's last day when it is shorter — every Nth month |
| Custom (cron) | a 5-field cron expression | whenever the expression matches |

"Every Nth day / week / month" counts from a fixed calendar origin, so saving again never shifts the phase, and the panel's preview shows the same days the server will run.

### When it runs

The panel shows what the rules mean before you save: the schedule in words, how many runs a day, today's runs on a 24-hour bar (past grey, upcoming pink — today in the schedule's timezone) and the next three runs with how far away they are. The node card shows the same headline, the next run and the Active / Paused state. Everything shown is computed with the arithmetic the server uses, so the preview is what will happen.

## How it fires

- The server checks once every minute and runs the workflow when a rule matches that minute. A minute is never fired twice — a restart, a second server, or the clocks falling back cannot double a run; a minute the clocks jump over is skipped that day.
- If the previous run of this workflow is still going, that minute is skipped.
- After *Max executions* runs the schedule stops firing (it stays registered; raise or clear the cap to continue).
- A schedule whose node **you added in the editor** counts as your own run for a stored HTTP credential (see [Webhook Output](../output/webhook-output.md)); one created through the API, or one that was already in the workflow when you opened it, does not.

## Registration details

Every save projects the graph's trigger nodes onto the server's schedule registry, however the workflow was written (editor, API, SDK, `import`, MCP): a change to the rules or the timezone takes effect on save, and deleting the node removes the schedule (the server also drops a schedule whose node is gone). Worth knowing:

- **A node that cannot run is parked** — a cron rule with no expression, a weekly rule with no weekday, or a timezone the server cannot read (a typo, a city name instead of `Area/City`). Nothing is guessed: a schedule it already had is kept paused with nothing to run, a new one is not registered, and the card says *Won't run* while the switch is on. Fix it and save again.
- **Schedules you created by hand** against `POST /v1/workflow-triggers` are left alone by saves — they belong to no node.
- `PATCH /v1/workflow-triggers/<id>` with `{ "isActive": false }` pauses a row until the next save, which applies the node's switch again. Use the switch for anything you want to stick.
- Inspect what a workflow has with `GET /v1/workflows/<id>/triggers`; the API shape of a schedule's `config` is in [API integration](../../api-integration.md).

## Older schedules

A Schedule Trigger saved before rules existed (an interval such as "5m", or a preset cron) shows its converted rules in the panel and moves onto rules on its next edit or save. Its cadence now follows the clock — every 5 minutes means :00, :05, :10… rather than five minutes after the previous run. Such schedules start paused; turn them on when you are ready.

## Outputs

- `payload` — trigger metadata (the fire time and the previous run's time)

## Tips

- Start with a longer interval and shorten it once the branch behaves; set *Max executions* while testing.
- Combine with a Webhook Trigger for a workflow that runs both on a schedule and on demand — each trigger starts its own branch.
