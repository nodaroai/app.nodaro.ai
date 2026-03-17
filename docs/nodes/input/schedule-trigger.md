# Schedule Trigger

> Trigger workflow execution on a recurring schedule.

## Overview

The Schedule Trigger node runs workflows automatically on a time-based schedule. Supports preset intervals (every 5 minutes to daily) or custom cron expressions. Optionally limit total executions. The scheduler checks every 60 seconds and skips if the workflow is already running.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Interval | Select | every hour | Preset or custom schedule |
| Timezone | Text | UTC | Timezone for schedule evaluation |
| Max Executions | Number | — | Optional limit (empty = unlimited) |

### Interval Options

| Option | Description |
|--------|-------------|
| Every 5 minutes | Runs at :00, :05, :10, etc. |
| Every 15 minutes | Runs at :00, :15, :30, :45 |
| Every hour | Runs at the top of each hour |
| Every day | Runs at midnight |
| Custom cron | 5-field cron expression |

### Custom Cron Format

```
minute hour day-of-month month day-of-week
 * * * * *
```

Examples:
- `0 9 * * 1-5` — 9:00 AM, Monday through Friday
- `*/30 * * * *` — Every 30 minutes
- `0 0 1 * *` — First day of each month at midnight

## Inputs & Outputs

**Inputs:** None (this is a trigger node)

**Outputs:**
- Trigger metadata (timestamp, execution count)
## Best Practices

- Start with longer intervals and decrease as needed
- Set Max Executions during testing to avoid runaway executions
- Account for timezone when scheduling (especially for daily triggers)
- The scheduler skips if the previous execution is still running

## Common Use Cases

- Daily social media content generation and posting
- Recurring report generation from RSS feeds
- Scheduled video rendering during off-peak hours
- Periodic content refresh pipelines

## Tips

- Plan your interval based on how frequently you need the workflow to run
- Combine with Webhook Trigger for workflows that run both on schedule and on demand
- The 60-second check interval means schedules are accurate to within 1 minute
- Workflows already in progress are skipped, preventing duplicate runs
