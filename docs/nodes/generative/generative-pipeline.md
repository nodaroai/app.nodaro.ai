# Story → Video (Generative Pipeline)

**Status:** Phase 1A (Cloud edition only). Stages 2-8 ship in Phase 1B+.

Generates an editable Nodaro graph from a single text prompt by orchestrating
multiple LLMs and generation steps under approval gates.

## Inputs

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `story_prompt` | string | yes | The story description, max 4000 chars |
| `target_duration_seconds` | number | yes | Per-format range; max 600s |
| `format` | enum | yes | `trailer` \| `short_film` \| `music_video` \| `reel` \| `commercial` |
| `output_resolution` | enum | no | `720p` \| `1080p` (default) \| `4K` |
| `mode` | enum | no | `manual` (default in 1A) \| `auto` \| `guided` |

### Format duration bounds

| Format | Min (s) | Max (s) |
|--------|---------|---------|
| reel | 7 | 90 |
| commercial | 10 | 90 |
| trailer | 30 | 180 |
| short_film | 30 | 600 |
| music_video | 30 | 600 |

## Stage 1 — Script

1. **Detection** (Haiku) extracts entities from the prompt.
2. **Showrunner** (Opus) builds a global `ShowrunnerPlan` — cast, locations, objects,
   scene list, beats, duration math.
3. **Script Critic** + **Cast Coverage Critic** (Sonnet, always-on) validate.
4. The Stage row enters `awaiting_approval` and the panel renders the plan.
5. User clicks **Approve** to finish (Phase 1A) or **Reject + feedback** to retry
   the Showrunner up to 2× with critic feedback injected.

## Credits

Phase 1A: ~30 credits per Stage 1 run (LLM calls only). Reserved upfront on POST;
refunded on cancel/failure. A future hard cap defaults to the tier ceiling and is
overridable via `max_cost_credits` in the request body.

## Edition gating

Available on **Cloud** edition only. Community + Business return 403 `edition_required`.

## Endpoints

| Method | Path | Scope | Notes |
|--------|------|-------|-------|
| POST | `/v1/pipelines` | `pipelines:execute` | Create + start a run |
| GET | `/v1/pipelines` | `pipelines:read` | List user's pipelines |
| GET | `/v1/pipelines/:id` | `pipelines:read` | Status + cost |
| GET | `/v1/pipelines/:id/events` | `pipelines:read` | SSE stream |
| GET | `/v1/pipelines/:id/stages/:stage_name` | `pipelines:read` | Fetch one stage |
| POST | `/v1/pipelines/:id/cancel` | `pipelines:execute` | Cancel + refund |
| GET | `/v1/pipelines/:id/pending-approvals` | `pipelines:approve` | List stages awaiting approval |
| POST | `/v1/pipelines/:id/stages/:stage_name/approve` | `pipelines:approve` | Approve a stage |
| POST | `/v1/pipelines/:id/stages/:stage_name/reject` | `pipelines:approve` | Reject + feedback |
