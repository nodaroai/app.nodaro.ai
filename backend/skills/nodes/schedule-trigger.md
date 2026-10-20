---
node_type: schedule-trigger
generated_at: 2026-10-19T22:47:48.948Z
generated_from: 1b877ca03
---

# Schedule Trigger

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `schedule-trigger`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** (none)
**Outputs (source handles):** `payload`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `rules?: ScheduleRule[]`
- `timezone?: string`
- `maxExecutions?: number`
- `retry?: ScheduleRetry`
- `active?: boolean`
- `interval?: string`
- `cron?: string`

**Default data:**
```json
{
  "label": "Schedule Trigger",
  "rules": [
    {
      "id": "rule-1",
      "kind": "days",
      "every": 1,
      "hour": 9,
      "minute": 0
    }
  ],
  "active": false
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

To run a workflow (or one branch of it) on a schedule with no outside system: every N minutes / hours / days / weeks / months, or a 5-field cron. Write the schedule as `rules` — the workflow runs whenever ANY rule matches the current minute, read in `timezone` (an IANA name such as `Asia/Jerusalem`; UTC when omitted). Rule kinds and the fields each reads: `minutes` (`every` 1–59), `hours` (`every` 1–23, `minute`), `days` (`every` 1–31, `hour`, `minute`), `weeks` (`every` 1–52, `weekdays` 0 = Sunday … 6, `hour`, `minute`), `months` (`every` 1–12, `dayOfMonth`, `hour`, `minute`), `cron` (`cron`). Give each rule an `id`.

**The schedule fires only while `active` is `true`.** A node written without it is registered PAUSED — set `"active": true` in the same write when the schedule should start, and tell the person that saving alone never arms it (the editor shows the same switch on the node and in the top bar).

Wire the trigger's `payload` output into the first node of the branch it should run: a wired trigger runs only that branch (its downstream nodes plus what they need); a trigger wired to nothing runs the whole workflow.

**Retry on failure** (`retry`, optional — absent means none): `{ "afterMinutes": 30, "maxAttempts": 3, "cheapLanesOnly": true }`. A scheduled run that ends failed (or timed out; never cancelled) is run again `afterMinutes` (5–1440) after it ended, up to `maxAttempts` (1–5) times — a retry re-runs and re-bills the whole branch. `cheapLanesOnly` keeps the model calls of the scheduled run and its retries that honour it off the direct-vendor fallback (a call the aggregator lane fails simply fails, and the retry runs it later); today: Generate Text, AI Writer, Image to Text, Generate Script and Motion Graphics (Lottie engine) — the docs page lists them. Write all three fields; a missing one takes its default. The run history shows a retry with "Retry n of m".

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- `interval` and `cron` at the top level of `data` are the PRE-rules fields; they still convert on save, but write `rules` instead. Never write both.
- A timezone the server cannot read, an empty `weekdays` on a `weeks` rule, or a `cron` that is not 5 fields PARKS the node: a schedule it already had is kept paused with nothing to run, a new one is not registered — nothing is guessed. Fix the data and save again.
- "Every Nth day / week / month" counts from a fixed calendar origin (weeks start on Monday), not from the save; a re-save never shifts the phase.
- `maxExecutions` stops the schedule after that many runs; leave it out for unlimited. Retries (`retry`) do not count toward it.
- Only the schedule's LATEST run is ever retried: once the schedule fired again, an older failure is left alone; a failure older than two days is never retried; a retry waits while any run of the owner's of this workflow is still going.
- The switch is per node: a workflow may carry several Schedule Triggers, each running its own branch, each on or off on its own.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "schedule-trigger-1",
  "type": "schedule-trigger",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Schedule Trigger",
    "rules": [
      {
        "id": "rule-1",
        "kind": "days",
        "every": 1,
        "hour": 9,
        "minute": 0
      }
    ],
    "active": false
  }
}
```
<!-- AUTO-GEN:END examples -->
