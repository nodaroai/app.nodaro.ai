# API Integration

This guide is for developers building **server-to-server** automations that
talk to Nodaro on behalf of **their own** Nodaro account — cron jobs,
internal tools, scripts, CI pipelines, backend services. If instead you're
building a hosted product that authenticates **other users'** Nodaro
accounts, you want OAuth — see [OAuth Flow](./oauth-flow.md).

The mechanism here is **API tokens**: long-lived bearer tokens minted from
the Nodaro UI, scoped to your own account, optionally locked to specific
workflows. They are simpler than OAuth and require no consent screen.

## 1. API tokens vs OAuth

| You are… | Use | Token format |
|---|---|---|
| Scripting **your own** Nodaro account from your server | API token | `ndr_<64hex>` |
| Building a product that runs **other users'** workflows | OAuth | `ndr_app_<64hex>` |
| Self-hosting Community edition for personal use | Supabase JWT directly | `eyJ…` (JWT) |

Quick test: if your server only ever needs one set of credentials and there
is no consent screen involved, use an API token. If you need 500 customers
to each grant your app access to their own account, use OAuth.

API tokens are currently gated to **Business** and **Cloud** editions in
the Nodaro UI. If you're running **Community** edition for yourself, you
can call the same `/v1/*` endpoints using your Supabase user JWT
(`Authorization: Bearer <jwt>`) and skip the API-token layer entirely.

## 2. Creating an API token

1. Sign in to your Nodaro instance.
2. Go to **Settings → API**.
3. Click **Create token**.
4. Fill in:
   - **Name** — a label for your records (e.g. `prod-scheduler`).
   - **Workflow scope** *(optional)* — pick specific workflows the token
     can trigger. If empty, the token can run any workflow you own.
   - **Rate limit** — requests per minute, default `30`, max `120`.
5. Save. The full token is shown **once**. It will look like:

   ```
   ndr_<64 hex characters>
   ```

   Copy it into your secret store immediately. Nodaro only stores a
   SHA-256 hash, so if you lose it you must mint a new one.

You can have up to **10 active tokens** per account. Edit name, workflow
scope, rate limit, or active flag at any time. Deleting a token revokes
it instantly.

Backend reference: `POST /v1/api-tokens` (JWT-authenticated, body
`{ name, workflowIds[], rateLimit }`). See `backend/src/routes/api-tokens.ts`.

## 3. Public API endpoints

Personal API tokens (`Authorization: Bearer ndr_…`) authenticate every
authenticated route in the backend, including the published-app endpoints
under `/v1/app/:slug/*` (see the [Embed App Guide](./embed-app-guide.md))
and the per-feature routes (jobs, workflows, projects, etc.).

The five legacy endpoints below are scoped specifically to running
workflows by ID with input overrides — they live under `/v1/api/` and
predate the published-app system. Most new integrations should prefer
`/v1/app/:slug/run` instead, but these remain supported.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/api/workflows` | List workflows your token can run. Supports `?limit=` and `?cursor=` pagination. |
| `GET`  | `/v1/api/schema?workflowId=…` | Inspect a workflow's input fields and output handles before running it. Includes `estimatedCredits`. |
| `POST` | `/v1/api/run` | Execute a workflow. Optionally pass `inputs` to override input-node values. Supports `?wait=true&timeout=…` for sync mode. |
| `GET`  | `/v1/api/status/:execId` | Poll a running execution. Returns `status`, progress counts, and credits used. |
| `GET`  | `/v1/api/result/:execId` | Fetch the final outputs once `status` is `completed` or `failed`. |

All responses use the same envelope: success returns the payload directly
(or under `data`), errors return `{ error: { code, message } }`. See
[§8 Errors](#8-error-envelope) for status codes.

The full route handler is at `backend/src/routes/api-tokens.ts`.

**OAuth scope note:** the `workflows:read` scope also gates the broader
workflow REST routes: `GET /v1/workflows` (flat list across all projects),
`GET /v1/workflows/:id`, and `GET /v1/workflows/:id/export` — in addition
to the project-scoped `GET /v1/projects/:projectId/workflows`. If your
OAuth token will call any of these, request `workflows:read` in the
authorization scope.

## 4. Worked example: generate an image

End-to-end bash. Assumes you've copied your token into `$TOKEN` and have
a workflow that contains a `text-prompt` input node and a
`generate-image` output node.

```bash
TOKEN="ndr_..."
WORKFLOW_ID="0000-0000-0000-0000"
BASE="https://nodaro.example.com"

# 1. Discover the workflow's input shape (optional but useful).
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/api/schema?workflowId=$WORKFLOW_ID" | jq .

# 2. Kick off an execution with an input override.
EXEC=$(curl -s -X POST "$BASE/v1/api/run" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"workflowId\": \"$WORKFLOW_ID\",
        \"inputs\": {
          \"text-prompt-1\": { \"text\": \"a cat at sunset\" }
        }
      }" | jq -r .executionId)

echo "Execution: $EXEC"

# 3. Poll until done.
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE/v1/api/status/$EXEC" | jq -r .status)
  echo "Status: $STATUS"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 5
done

# 4. Fetch the result.
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/api/result/$EXEC" | jq .
```

A successful `result` response looks like:

```json
{
  "executionId": "…",
  "status": "completed",
  "creditsUsed": 4,
  "durationMs": 12450,
  "errorMessage": null,
  "outputs": [
    {
      "nodeId": "generate-image-1",
      "label": "Generate Image",
      "type": "image",
      "url": "https://…/output.png"
    }
  ]
}
```

The `inputs` object is keyed by **node ID** (or, as a convenience, by
**unique node label**). The inner key is the input field for that node
type — the schema endpoint tells you what to use.

## 5. Sync vs async execution

By default, `POST /v1/api/run` is **async**: it returns `202 Accepted`
with `{ executionId, status: "pending" }` immediately and you poll
`/status/:execId` until done.

For short-lived workflows you can hold the connection until completion:

```
POST /v1/api/run?wait=true&timeout=120
```

- The server polls the execution every 5 seconds for up to `timeout`
  seconds (default 120, max 600).
- If the workflow finishes in time: returns the same payload as
  `/v1/api/result/:execId` — `status` is `completed`, `failed`, or
  `cancelled` and `outputs[]` is filled in.
- If it doesn't: returns `202` with `{ executionId, status: "pending" }`
  and you fall back to polling.

Recommended cutoff: use sync for workflows you expect to finish in under
a minute (text generation, light image work). For multi-step workflows
that include video rendering or upscaling, use async.

## 6. Webhooks (push into Nodaro)

A complementary path: instead of your server calling Nodaro to start a
workflow, you can let an external system push **into** a workflow.

Add a **Webhook Trigger** node to a workflow. Save it. Nodaro mints a
unique 32-byte token and exposes:

```
POST /v1/webhooks/<token>
```

This route is fully public — the token **is** the auth. The request body
becomes the trigger payload visible to downstream nodes. Rate limited to
10 requests per minute per token. Use cases:

- A Stripe webhook that triggers an "onboarding video" workflow.
- A GitHub webhook that triggers a "release notes summary" workflow.
- A no-code tool (Zapier, n8n, Make) firing on schedule.

If you need scheduled triggers (cron-like) without an external system,
use the Schedule Trigger node instead — Nodaro polls the schedule
internally every 60 seconds.

## 7. Rate limits

Per-token, in-memory bucket:

- Default `30` requests/minute, configurable up to `120` per token.
- Counts only the mutating / heavy calls: `POST /v1/api/run` and
  `GET /v1/api/workflows`. Read-only poll routes (`/status/:execId`,
  `/result/:execId`, `/schema`) do **not** consume the bucket.
- Bucket resets once per minute; a 429 response carries
  `{ error: { code: "rate_limited", message: "Too many requests. Max N per minute." } }`.

Recommended client behaviour:

- For polling, sleep 2–5 seconds between `/status` calls. The execution
  state changes at second-scale, not millisecond-scale.
- On 429, exponentially back off (e.g. 5 → 10 → 20 seconds) before
  retrying.
- If you need a higher limit, raise the `rateLimit` field on the token
  (max 120). Beyond that, mint multiple tokens and shard across them.

Webhook triggers (`POST /v1/webhooks/:token`) are rate-limited
**separately** — 10 requests/minute per webhook trigger.

**Two distinct 429 codes.** The per-token bucket above (the `/v1/api/*`
routes) returns `rate_limited`. A separate **global** limiter
(`@fastify/rate-limit`) protects a handful of unauthenticated endpoints —
e.g. OAuth Dynamic Client Registration (`POST /v1/oauth/register`,
10/min/IP) — and returns the code `rate_limit_exceeded` instead. Match on
the HTTP 429 status for retry logic; use the `code` only to tell the two
limiters apart.

## 8. Error envelope

All errors share the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests. Max 30 per minute." } }
```

| HTTP | code | Extra field | When / route family |
|---|---|---|---|
| 400 | `validation_error` | — | Malformed body, bad UUID, invalid field. |
| 401 | `unauthorized` | — | Missing/invalid/expired/revoked token. |
| 402 | `insufficient_credits` | — | (Cloud edition only) Account out of credits. |
| 403 | `forbidden` | — | Token isn't authorized for this workflow (workflow scoping). |
| 403 | `insufficient_scope` | `missingScope` (+ `message`) | (OAuth tokens only) The token is missing a scope the route requires. Re-run the OAuth consent with the broader scope. See [OAuth Flow §4](./oauth-flow.md#4-scope-vocabulary). |
| 403 | `edition_required` | `required_edition: "<edition>"` (+ `message`) | Endpoint needs a higher edition than the caller has. `required_edition` is the minimum: `"cloud"` for pipeline (`POST /v1/pipelines/:id/branch`) + scene-helper routes; `"business"` for API-token management (`POST /v1/api-tokens`, `DELETE /v1/api-tokens/:id`). |
| 404 | `not_found` | — | Workflow, execution, or token not found. |
| 429 | `rate_limited` | — | You've exceeded the per-minute bucket. Back off. |
| 500 | `internal_error` | — | Server bug or downstream dependency failure. Retry with backoff. |
| 503 | `price_not_configured` | — | (Cloud edition only) No pricing row exists for the requested model — the server hard-fails rather than silently mis-billing. Operator must seed the price; the call is not retryable as-is. |

Treat anything in the 5xx range as transient — retry with exponential
backoff. Treat 4xx as terminal — don't retry without fixing the request.

## 9. Characters

Character routes let you fully script character creation, identity edits,
asset generation, and the portrait-approval pipeline that drives Character
Studio. All routes require an authenticated bearer token (`ndr_…` /
`ndr_app_…` / Supabase JWT) and are scoped to the calling user.

### Lifecycle

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/characters` | List characters. Query: `projectId`, `archived=true`, `limit` (default 100, max 500). |
| `GET` | `/v1/characters/:id` | Get full character + in-flight portrait/asset jobs. |
| `POST` | `/v1/characters` | Upsert (create if no `id`, update otherwise). |
| `POST` | `/v1/characters/:id/duplicate` | Fork to a new row with `(copy)` suffix. |
| `POST` | `/v1/characters/:id/restore` | Un-archive a soft-deleted character. |
| `DELETE` | `/v1/characters/:id` | Soft-delete (archive). Restorable. |
| `GET` | `/v1/characters/:id/usage` | List workflows that reference this character. |

The upsert body is documented in `backend/src/routes/characters.ts`. On
UPDATE, only the fields you supply are written; omitted keys are left alone
so partial saves don't clobber asset arrays a worker is concurrently
appending to.

### Generation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/generate-character` | Generate 1 / 2 / 4 portrait candidates. |
| `POST` | `/v1/generate-character-asset` | Generate one expression / pose / angle / lighting variant. |
| `POST` | `/v1/generate-character-motion` | Animate the character's portrait into a motion clip. |

All generation routes return at minimum `{ jobId }`. `/v1/generate-character`
additionally returns `{ jobIds: string[] }` so multi-candidate runs are
trackable. Pass `attachToCharacterId` to auto-attach the result to the
character row when the job completes — no separate `approve` step needed
for single-candidate runs.

### Portrait approval

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/characters/:id/approve-portrait` | Set the row's `source_image_url` from a completed candidate job AND fire the LLM caption. |
| `POST` | `/v1/characters/:id/llm-caption` | Re-run the LLM caption against the current portrait. |

`approve-portrait` body: `{ candidateJobId: <uuid> }`. The candidate must be
`status="completed"` and belong to the caller. The route returns
`{ portraitUrl, canonicalDescription }` — `canonicalDescription` is `null` if
the LLM caption sub-failed (portrait still set; retry via `llm-caption`).

### Worked example: create → generate → approve

```bash
TOKEN="ndr_..."
BASE="https://nodaro.example.com"

# 1. Create the character row.
CHAR=$(curl -s -X POST "$BASE/v1/characters" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "nodeId": "scripted",
        "name": "Kira",
        "description": "young protagonist with auburn hair",
        "style": "realistic",
        "seedPrompt": "kira portrait, warm natural lighting"
      }' | jq -r .id)

# 2. Generate 4 portrait candidates, auto-attaching to the row.
JOB_IDS=$(curl -s -X POST "$BASE/v1/generate-character" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"name\": \"Kira\",
        \"seedPrompt\": \"kira portrait, warm natural lighting\",
        \"count\": 4,
        \"attachToCharacterId\": \"$CHAR\"
      }" | jq -r '.jobIds | join(" ")')

# 3. Poll each job until done, then approve your favorite.
for JOB in $JOB_IDS; do
  while true; do
    STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "$BASE/v1/jobs/$JOB" | jq -r .status)
    [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
    sleep 3
  done
done

PICK=$(echo "$JOB_IDS" | awk '{print $1}')
curl -s -X POST "$BASE/v1/characters/$CHAR/approve-portrait" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"candidateJobId\": \"$PICK\"}" | jq .

# 4. Generate an "smile" expression off the approved portrait.
curl -s -X POST "$BASE/v1/generate-character-asset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"name\": \"Kira\",
        \"assetType\": \"expressions\",
        \"variant\": \"smile\",
        \"attachToCharacterId\": \"$CHAR\",
        \"attachToColumn\": \"expressions\",
        \"attachName\": \"smile\"
      }"
```

A complete walkthrough — including motion generation and using character
assets as references in downstream image/video calls — is in
[Character Platform](./character-platform.md).

## 10. Objects

Object routes let you fully script object (prop / product / vehicle / etc.)
creation, identity edits, asset generation, and the main-image approval
pipeline that drives Object Studio. All routes require an authenticated
bearer token (`ndr_…` / `ndr_app_…` / Supabase JWT) and are scoped to the
calling user.

### Lifecycle

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/objects` | List objects. Query: `projectId`, `archived=true`. |
| `GET` | `/v1/objects/:id` | Get full object + in-flight asset jobs. Archived rows return uniform 404 `not_found`. |
| `POST` | `/v1/objects` | Upsert (create if no `id`, update otherwise). Optimistic-concurrency via `expectedUpdatedAt`. |
| `POST` | `/v1/objects/:id/restore` | Un-archive a soft-deleted object. |
| `DELETE` | `/v1/objects/:id` | Soft-delete (archive). Restorable. |
| `DELETE` | `/v1/objects/:id?permanent=true` | Permanent destroy. Row must already be archived (400 `not_archived` otherwise). |

The upsert body is documented in `backend/src/routes/objects.ts`. On
UPDATE, only the fields you supply are written; omitted keys are left alone
so partial saves don't clobber asset arrays a worker is concurrently
appending to. Worker-owned asset buckets (`angles` / `materials` /
`variations` / `motion_clips`) are intentionally dropped on UPDATE — a
stale-snapshot save would clobber the worker's atomic
`append_object_asset()` writes.

### Generation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/generate-object` | Generate 1 / 2 / 4 candidate main images. |
| `POST` | `/v1/generate-object-asset` | Generate one angles / materials / variations / custom variant. Studio-gated LLM draft when `attachToObjectId` set + `description` omitted. |
| `POST` | `/v1/generate-object-motion` | Animate the object's main image into a motion clip (i2v). Defaults: provider `kling-turbo`, aspect ratio `1:1`. |

`/v1/generate-object` returns a discriminated union: `{ jobId }` for
`count: 1` (default) and `{ jobIds: string[] }` for `count: 2 | 4` — branch
on `"jobIds" in response`. The asset / motion routes always return
`{ jobId }`. Pass `attachToObjectId` to auto-attach the result to the
object row when the job completes — no separate approval step needed for
single-candidate runs.

### Main-image approval

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/objects/:id/approve-main-image` | Set the row's `source_image_url` from a completed candidate job AND fire the LLM caption. Accepts `expectedUpdatedAt` for optimistic-concurrency. |
| `POST` | `/v1/objects/:id/llm-caption` | Re-run the LLM caption against the current main image. Idempotent retry — does NOT accept `expectedUpdatedAt`. |

`approve-main-image` body: `{ candidateJobId: <uuid>, expectedUpdatedAt? }`.
The candidate must be `status="completed"` and belong to the caller. The
route returns `{ sourceImageUrl, canonicalDescription }` —
`canonicalDescription` is `""` (not null) when the LLM caption sub-failed
(main image still set; retry via `llm-caption`). The `llm-caption` route
502s on LLM failure and 400 `main_image_required` when no main image is
set yet.

### Worked example: create → generate → approve

```bash
TOKEN="ndr_..."
BASE="https://nodaro.example.com"

# 1. Create the object row.
OBJ=$(curl -s -X POST "$BASE/v1/objects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "nodeId": "scripted",
        "name": "Antique Lantern",
        "description": "Weathered brass lantern with hand-engraved filigree",
        "category": "tool",
        "style": "realistic"
      }' | jq -r .id)

# 2. Generate 4 main-image candidates, deferring auto-attach.
JOB_IDS=$(curl -s -X POST "$BASE/v1/generate-object" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"name\": \"Antique Lantern\",
        \"count\": 4
      }" | jq -r '.jobIds | join(" ")')

# 3. Poll each job until done, then approve your favorite.
for JOB in $JOB_IDS; do
  while true; do
    STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "$BASE/v1/jobs/$JOB" | jq -r .status)
    [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
    sleep 3
  done
done

PICK=$(echo "$JOB_IDS" | awk '{print $1}')
curl -s -X POST "$BASE/v1/objects/$OBJ/approve-main-image" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"candidateJobId\": \"$PICK\"}" | jq .

# 4. Generate a "gold" materials variant off the approved main image.
curl -s -X POST "$BASE/v1/generate-object-asset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"name\": \"Antique Lantern\",
        \"assetType\": \"materials\",
        \"variant\": \"gold\",
        \"attachToObjectId\": \"$OBJ\",
        \"attachToColumn\": \"materials\",
        \"attachName\": \"gold\"
      }"
```

A complete walkthrough — including motion generation, the Studio-gated LLM
draft on `generate-object-asset`, the 5-tab Studio surface, and using
object assets as references in downstream image/video calls — is in
[Object Platform](./object-platform.md).

## 11. Node discovery

`GET /v1/nodes` and `GET /v1/nodes/:type` let clients enumerate every
node type the server has registered without hard-coding a list.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/nodes` | Return the full node registry (`{ data: NodeDescriptor[] }`). Responses are cached for 5 minutes (`Cache-Control: public, max-age=300`). |
| `GET` | `/v1/nodes/:type` | Return a single descriptor by node type string. 404 `not_found` when the type doesn't exist. |

`NodeDescriptor` fields (subset): `type`, `label`, `category`,
`outputType`, `creditCost` (static credit cost when known), `inputSchema`
(JSON Schema for the node's config fields), `providers` (supported
provider slugs), `capabilities` (feature flags the node exposes). The
exact shape grows over time — treat unknown fields as forward-compatible.

Neither endpoint requires authentication; they expose only static
registry metadata. No scopes required.

## 12. Credits (Cloud edition)

Two endpoints surface the caller's credit balance and transaction
history. Both are **Cloud-edition only** — on Community/Business they are
not registered and return 404.

| Method | Path | Query | Purpose |
|---|---|---|---|
| `GET` | `/v1/credits/balance` | — | Return `{ total, subscription, topup, tier }`. `total = subscription + topup`. |
| `GET` | `/v1/credits/transactions` | `limit` (1–50, default 20), `cursor` (ISO timestamp for page-forward) | Return `{ data: Transaction[], nextCursor }`. Cursor is the `created_at` of the last row; pass it as `?cursor=` on the next request. `nextCursor` is `null` when there are no more rows. |

`Transaction` fields: `id`, `created_at`, `credits_used`, `action`,
`provider`, `metadata`.

Both routes use the same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT).

## 13. Job batch polling

Two endpoints let you poll multiple job statuses in a single round trip
(useful for workflow UIs that track many concurrent jobs):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/jobs/status?ids=a,b,c` | Comma-separated IDs, max 100. Returns `{ jobs: { id, status, output_data }[] }`. Cross-user / non-existent IDs are silently omitted — reconcile locally. |
| `POST` | `/v1/jobs/batch-status` | Body `{ jobIds: string[] }`, max 100. Returns `{ data: { id, status, output_data, error_message }[] }`. |

Both require `jobs:read` scope when using an OAuth token; admin tokens may
see cross-user jobs. These endpoints are public API — they are used by the
editor but are equally suited to external polling clients.

## 14. Pipelines

Story-to-Video pipelines orchestrate multi-stage AI production: script → characters
→ objects → locations → shot list → scene images → animate + audio + edit → post merge.

### Branch (re-run from stage)

#### `POST /v1/pipelines/:id/branch`

Create a new pipeline by re-running from a completed stage. The original pipeline
must be in `status='completed'`. Upstream stages clone forward (status='approved'),
the branch stage starts running, downstream stages are created fresh by the
orchestrator.

**Body:** `{ fromStage: "script" | "characters" | "objects" | "locations" | "shot_list" | "scene_images" | "animate_audio_edit" | "post_merge" }`

**Response (201):** `{ pipelineId: string, clonedStages: string[], clonedEntities: number }`

**Errors:** 400 (pipeline_not_completed, invalid_stage) · 404 (pipeline_not_found) · 403 (forbidden) · 401 (unauthorized)

**Scope (OAuth):** `pipelines:execute`

Asset rows are NOT duplicated — pipeline entities reference the same asset_ids
(assets are content-addressed by R2 path; safe to share across pipelines).
Chat turns (Guided Mode, Phase 1D.2) explicitly do NOT clone — the branched
pipeline starts with empty chat history per chat-enabled stage.

## 15. Prompt Wizard

AI assistance for writing prompts for generation nodes. One endpoint, three
actions — discriminated by the `action` field. Credit-guarded (reserves
credits per call).

### `POST /v1/prompt-helper/wizard`

| Action | Body | Response |
|---|---|---|
| `analyze` | `{ action, nodeType, prompt?, provider?, style?, aspectRatio?, duration?, llmModel?, nodeContext?, userPreference? }` | `{ jobId, questions }` |
| `generate` | `{ action, nodeType, selections[], originalPrompt?, ... }` | `{ jobId, prompt, recommendedModel? }` |
| `enhance` | `{ action, nodeType, prompt?, ... }` (no selections) | `{ jobId, prompt, recommendedModel? }` |

- **`analyze`** — turns a rough idea into guided questions. Each question is
  `{ category, label, options[], selected, allowCustom, multi? }`. Omit
  `prompt` to build the questions from scratch.
- **`generate`** — builds a single optimized prompt from the chosen answers.
  Each selection is `{ category, value, isCustom }`. `originalPrompt` is woven
  in when supplied.
- **`enhance`** — one-shot "improve this prompt": skips the questions
  round-trip and returns the optimized prompt directly.

`recommendedModel` is present on `generate` / `enhance` when the wizard can
suggest a provider/model for the target node type.

**Errors:** 400 `validation_error` · 401 `unauthorized` · 503
`provider_unavailable` · 502 `malformed_response` · 500 `llm_error`.

The same endpoint is wrapped by the SDK (`client.promptHelper.{analyze,
generate,enhance}`), the MCP tools (`analyze_prompt` / `generate_prompt` /
`enhance_prompt`), and the CLI (`nodaro prompt wizard/analyze/generate/enhance`).

## 16. Presets

Read your saved node presets and the built-in factory catalog. **Read-only over
the API** — creating/editing presets stays in the editor. A preset's `data` is
captured node config; merge it into a node's data when you build a workflow to
"apply" it.

| Method | Path | Query | Purpose |
|---|---|---|---|
| `GET` | `/v1/node-presets` | `nodeType` (optional) | Your custom presets (newest first). |
| `GET` | `/v1/node-preset-groups` | `nodeType` (optional) | Your preset folders/sections. |
| `GET` | `/v1/node-presets/factory` | `nodeType` (**required**) | The built-in catalog for a node type, plus `popularIds` (most-used quick-picks, in order). |

A custom preset has `{ id, nodeType, name, description?, data, groupId?, tags, sortOrder, createdAt, updatedAt }`. The factory response is `{ data: FactoryPreset[], popularIds: string[] }`, where each entry has `{ id, name, description?, group?, groupKind?, data }`.

**Auth/scope:** same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT). OAuth app tokens additionally need the
`presets:read` scope (no-op for user / API-key auth — you own the resources).

```bash
# Your custom generate-image presets
curl -s https://app.nodaro.ai/v1/node-presets?nodeType=generate-image \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[].name'

# Built-in catalog + which ones are "popular"
curl -s "https://app.nodaro.ai/v1/node-presets/factory?nodeType=generate-image" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '{count: (.data|length), popular: .popularIds}'
```

## 17. SDK alternative (TypeScript)

The same backend is fronted by a typed TypeScript client:

```bash
npm install @nodaro/client
```

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

// Inspect a workflow.
const schema = await client.workflows.schema(workflowId)

// Run it (async — kick off + poll yourself).
const exec = await client.workflows.run(workflowId, {
  inputs: { "text-prompt-1": { text: "a cat at sunset" } },
})

// Or sync — wait up to 120s.
const result = await client.workflows.runAndWait(workflowId, {
  inputs: { "text-prompt-1": { text: "a cat at sunset" } },
  timeoutSeconds: 120,
})

console.log(result.outputs)
```

The SDK works identically with API tokens and OAuth tokens — pass either
to `StaticTokenAuth`. It also has `supabaseAuth` for browser apps. See
[SDK Quickstart](./sdk-quickstart.md) and the
[SDK Reference](./sdk-reference.md) for the full surface.

## Character LoRA training

> **Cloud edition only.** Trains a Flux LoRA on Replicate for a character so
> `generate-image` can route through the trained model for highest-fidelity
> identity match. See [Character Training](./features/character-training.md)
> for the user-facing feature doc.

### `POST /v1/characters/:id/train` — start training

Reserves **150 credits** and submits a training to Replicate. Requires the
character to have **≥ 4** reference photos across:
`source_image_url`, `reference_photos`, `expressions`, `poses`, `angles`,
`body_angles`, `lighting_variations`.

> `character_sheet` is **excluded** from the training-image count. Its
> composite views (front/side/back) overlap with `angles`/`body_angles` and
> its DB column shape cannot be reduced to a simple URL list, so the
> training helper ignores it entirely.

**Response (202):**
```json
{ "jobId": "uuid", "trainingId": "<replicate-id>", "triggerWord": "TOK_<slug>_<6hex>" }
```

**Errors:**
- `400 insufficient_training_images` — fewer than 4 deduped URLs available
- `409 already_training_or_not_found` — a training is already in flight (atomic
  CAS guard; double-click safe)
- `503 public_url_not_configured` — `PUBLIC_URL` not set in this instance
- `503 webhook_not_configured` — `REPLICATE_WEBHOOK_SECRET` not set
- `502 training_dispatch_failed` — Replicate rejected the request; reservation
  is refunded and the orphan zip in R2 is cleaned up

Rate-limited to **3 / minute** per token.

### `GET /v1/characters/:id/training` — poll status

**Response:**
```json
{
  "status": "untrained" | "queued" | "training" | "succeeded" | "failed" | "cancelled",
  "trainingId": "<replicate-id>" | null,
  "error": "<message>" | null,
  "trainedAt": "ISO8601" | null,
  "version": "nodaroai/char-<id>:<hash>" | null,
  "triggerWord": "TOK_<slug>_<6hex>" | null,
  "imageCount": 12 | null
}
```

### `DELETE /v1/characters/:id/lora` — tear down

Cancels any in-flight training (refunds reserved credits), deletes the
Replicate model (`nodaroai/char-<characterId>`), and nulls out the LoRA
columns on the character row.

**Response:** `{ "ok": true }`

### Routing decision

When you call `POST /v1/generate-image` with a prompt that `@mentions` a
single trained character (and that character is wired upstream of the node),
the orchestrator transparently swaps:

- `provider` → `replicate`
- `model` → `flux-lora-character`
- `referenceImageUrls` → `[]`
- Prompt → `TOK_<slug>_<6hex>, <your prompt with @-tokens stripped>`

The credit identifier becomes `flux-lora-character` (**3 cr**). Multi-character
mentions fall back to the selected provider + ref injection.

## See also

- [Character Training](./features/character-training.md) — user-facing feature doc
- [OAuth Flow](./oauth-flow.md) — third-party app authorization
- [SDK Quickstart](./sdk-quickstart.md) — TypeScript client walkthrough
- [SDK Reference](./sdk-reference.md) — full method index
- [Architecture](./architecture.md) — how requests flow through the system
- [Deployment](./deployment.md) — self-hosting your own instance
