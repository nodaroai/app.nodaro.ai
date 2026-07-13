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

The image-generating routes (`/v1/generate-character`,
`/v1/generate-character-asset`, and the location equivalents
`/v1/generate-location` / `/v1/generate-location-asset`) also accept optional
`quality` (`"medium"` / `"high"` / `"basic"`) and `resolution` (`"1K"` /
`"2K"` / `"4K"` / `"0.5 MP"` / `"1 MP"` / `"2 MP"` / `"4 MP"`). These are
**credit-affecting** and price exactly like `/v1/generate-image` (composite
ids such as `gpt-image:high` / `nano-banana-pro:4K`) — a 4K / high run
reserves more credits than the same model at its base tier. A value the
chosen model doesn't support is ignored, never a 400.

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

### Seedance 2 video capabilities

The video routes (`/v1/text-to-video`, `/v1/generate-video`) accept these on
the Seedance 2 family — `resolution` / `aspectRatio` are pass-through strings,
so a value the model doesn't support is ignored, never a 400:

- **`seedance-2`** (full) supports `resolution: "4k"` and
  `aspectRatio: "adaptive"` (plus `"21:9"`). `seedance-2-fast` and
  `seedance-2-mini` are **480p / 720p only** (no 1080p, no 4K).
- **Frames + references coexist.** When any reference (image / video / audio)
  is wired alongside a start/end frame, the frames become prompt-directed
  `Image N` references rather than pinned endpoints — the resolver decides the
  mode, there is no toggle.
- **Reference videos are billed `unit × (input + output)` duration.** The
  runtime ffprobes each `referenceVideoUrls` clip and scales the per-second
  `-ref` rate (see the [Generate Video node](nodes/ai-video/generate-video.md)
  for the live per-resolution rates) by the input-video duration plus the
  output duration, so longer source clips reserve proportionally more credits.

### Structured references (`connectedReferences`) on video

`POST /v1/generate-video` and `POST /v1/text-to-video` accept an optional
`connectedReferences` array — the SAME structured-reference shape
`/v1/generate-image` takes — so a direct API / SDK / MCP caller gets the identical
reference assembly the editor performs client-side, instead of hand-building a
prose "Image N is …" guide. When present, the route
assembles them server-side (via the shared video resolver the canvas and
orchestrator already use):

- **Unmentioned wired references auto-attach.** Each ref's `url` is appended to
  the worker's `referenceImageUrls` (deduped, and capped at the provider's
  image-ref limit — references beyond the limit are dropped *before* numbering,
  so an `@image_N` directive never binds a reference that wasn't sent) and gets
  a per-ref directive — `@image_N (reference): <label>` for
  images/objects/locations, a "Use these characters:" identity bullet for
  `wired-character` refs.
- **`{image:N:label}` tokens in `prompt` expand** to `the <label> from @image_N`,
  numbered against the attached references (front-of-list order).
- **`referenceOrder`** (an optional string array of stable ref ids) reorders the
  reference list and renumbers the `@image_N` bindings to match.
- **`identityLock` (per-reference, opt-in — default off).** Each
  `connectedReferences[]` entry may carry
  `identityLock?: { enabled: boolean; text?: string }`. With `enabled: true`, the
  prompt builder prepends a short identity-lock fidelity line for that reference
  (pinning its exact identity); `text` overrides the built-in per-source wording,
  and `{ref}` in that text is the placeholder for the reference's binding
  (`reference image A` on image, `@image_N` on video). Left off — the default —
  nothing identity-locking is injected. Honored when the route assembles in the
  hybrid reference format. CLI callers pass it inside the `connectedReferences`
  JSON via `--params-file` (no dedicated flag). See the
  [Reference Roles guide](./reference-roles-guide.md) for the role-label + lock
  model.
- **Provider-gated, per-provider caps.** Only models with verified image-reference
  support attach references; on any other model the `{image:N}` tokens are stripped
  to their bare labels and nothing is attached. Supported models and their
  image-reference caps: **Seedance 2** family (9), **HappyHorse Ref2V** (9),
  **Gemini Omni** / **Kling 3 Omni** / **Grok i2v** (7), **VEO 3.x**
  (`veo3` / `veo3.1` / `veo3_lite`, 3). This set is kept in lock-step with the
  model catalog by a drift guard, so it can't silently fall out of sync.
- **Backward compatible.** Omit `connectedReferences` and the route behaves
  exactly as before — a pre-assembled `prompt` + flat `referenceImageUrls` pass
  through unchanged. `connectedReferences` feeds the **image** channel only;
  `referenceVideoUrls` / `referenceAudioUrls` stay as explicit flat inputs.

Each ref's `url` rides the same SSRF gate as the flat `referenceImageUrls`, so a
ref pointing at a private address / non-http(s) scheme is rejected at the route
boundary. See the [Generate Video node](nodes/ai-video/generate-video.md#referencing-wired-assets-in-the-prompt-imagen--videon--audion-tokens)
page for the token syntax and worked examples.

> **`referenceOrder` on images too.** `POST /v1/generate-image` accepts the same
> optional `referenceOrder` (parity with video) to reorder its assembled
> reference list and renumber the `@image_N` bindings.

### Picker catalogs

`GET /v1/picker-catalogs` and `GET /v1/picker-catalogs/:nodeType` expose the
valid values for **parameter-picker** nodes (setting, mood, person, lens, …) —
the curated catalogs whose selection contributes a descriptive clause to a
downstream node's prompt. Public, no auth, same 5-minute cache as node
discovery (`Cache-Control: public, max-age=300`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/picker-catalogs` | Directory of every picker (`{ data: PickerCatalogSummary[] }`) — each `{ nodeType, label, catalogId, kind, valueField?, fields?, optionCount }`. |
| `GET` | `/v1/picker-catalogs/:nodeType` | One picker's catalog (`{ data: PickerCatalog }`). 404 `not_found` for an unknown type. |

`GET /v1/picker-catalogs/:nodeType` accepts these query params (a bad value
returns 400 `validation_error`):

| Param | Values | Purpose |
|---|---|---|
| `detail` | `compact` (default) / `full` | `compact`: `id`, `label`, `category`, `icon`. `full`: additionally includes each option's `description` and `promptHint` (the prompt fragment it injects). |
| `category` | string | Single-dim pickers: filter options to one category. |
| `field` | string | Multi-dim pickers (person / styling / framing): return only this dimension's field. |

A single-dim catalog carries `options`; a multi-dim catalog carries
`dimensions` (one `{ field, label, options }` per field). These are the same
catalogs that ship as pure data in [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared)
— prefer importing the package when you can bundle it (see
[Parameter Picker Catalogs](picker-catalogs.md)); the REST endpoints exist for
clients that can't.

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
| `analyze` | `{ action, nodeType, prompt?, provider?, style?, aspectRatio?, duration?, llmModel?, reasoningEffort?, nodeContext?, userPreference? }` | `{ jobId, questions }` |
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
| `GET` | `/v1/node-presets/factory` | `nodeType` (**required**) | The built-in catalog for a node type. |

A custom preset has `{ id, nodeType, name, description?, data, groupId?, tags, sortOrder, createdAt, updatedAt }`. The factory response is `{ data: FactoryPreset[] }`, where each entry has `{ id, name, description?, group?, groupKind?, data }`.

**Auth/scope:** same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT). OAuth app tokens additionally need the
`presets:read` scope (no-op for user / API-key auth — you own the resources).

```bash
# Your custom generate-image presets
curl -s https://app.nodaro.ai/v1/node-presets?nodeType=generate-image \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[].name'

# Built-in catalog
curl -s "https://app.nodaro.ai/v1/node-presets/factory?nodeType=generate-image" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '{count: (.data|length)}'
```

### Favorites

Per-user **favorites** let you star presets (factory or custom) so they surface
at the top of the editor's preset dropdown. These routes are **editor-auth /
first-party**: the reads also accept OAuth app tokens carrying the
`presets:read` scope, but the writes are **first-party only** (no OAuth scope
grants them).

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/node-presets/favorites` | `nodeType` (**required**) | Your favorited preset ids for that node type, most-recent first. Returns `{ data: string[] }`. |
| `POST` | `/v1/node-presets/favorites` | body `{ nodeType, presetId }` | Add a favorite (idempotent). Returns `{ data: { success: true } }`. |
| `DELETE` | `/v1/node-presets/favorites` | `nodeType`, `presetId` (**required**) | Remove a favorite. Returns `{ data: { success: true } }`. |

A favorite id is either a **factory preset id** (e.g.
`generate-image/character-board`) or a **user-preset uuid**. Because factory ids
contain a `/`, url-encode `presetId` in the `DELETE` query string.

```bash
# Your favorited generate-image presets (most-recent first)
curl -s "https://app.nodaro.ai/v1/node-presets/favorites?nodeType=generate-image" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data'

# Favorite a factory preset
curl -s -X POST "https://app.nodaro.ai/v1/node-presets/favorites" \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodeType": "generate-image", "presetId": "generate-image/character-board"}' | jq .

# Remove it again (url-encode the "/" in the factory id)
curl -s -X DELETE "https://app.nodaro.ai/v1/node-presets/favorites?nodeType=generate-image&presetId=generate-image%2Fcharacter-board" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq .
```

## 17. Community

The Community Library is an **admin-curated** catalog of shared characters,
locations, and objects. Admins publish; any logged-in user browses and **clones**
listings into their own library as independent copies. See
[Community Library](./community-library.md) for the feature overview, the
cloning model, and the likeness/consent safety rules.

> **Multi-user editions only.** These routes are registered on **Business** and
> **Cloud** instances. On a **Community** (single-user) instance they are not
> registered and return `404`.

`entity_type` is one of `character` / `location` / `object`. Listing records
returned by the read routes are sanitized to public columns: `id`,
`entity_type`, `creator_display_name`, `slug`, `title`, `description`,
`category`, `style`, `tags`, `preview_media_url`, `preview_images`,
`clone_count`, `favorite_count`, `created_at`.

### User routes (session auth)

All user routes require an authenticated bearer token (`ndr_…` / `ndr_app_…` /
Supabase JWT) and are scoped to the calling user.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/community/browse` | List public listings. Returns `{ data: Listing[], nextCursor }`. |
| `GET`  | `/v1/community/detail/:slug` | Fetch a single listing by `slug`. Returns `{ data: Listing }`; 404 `not_found` if missing/inactive. |
| `GET`  | `/v1/community/favorites` | The listings you've favorited. Returns `{ data: Listing[] }`. |
| `POST` | `/v1/community/listings/:id/clone` | Copy a listing into your library. Body `{ entityType }`. Returns `{ entityType, id }`. |
| `POST` | `/v1/community/listings/:id/favorite` | Toggle favorite. Returns `{ favorited }` (`true` after adding, `false` after removing). |
| `POST` | `/v1/community/listings/:id/report` | Flag a listing for moderation. Body `{ reason }`. Returns `{ ok: true }`. |

**`GET /v1/community/browse` query params:**

| Param | Type | Notes |
|---|---|---|
| `entityType` | `character \| location \| object` | Filter to one asset kind. |
| `q` | `string` | Full-text search across title / description / tags. |
| `category` | `string` | Filter to a single category. |
| `sort` | `popular \| newest` | Order by most-cloned or newest. Defaults to `newest`. |
| `cursor` | `string` | Opaque cursor from a previous page's `nextCursor`. |
| `limit` | `number` | Page size, capped at 50 (default 20). |

`nextCursor` is an opaque token; pass it back as `?cursor=` to page forward.
It is `null` when there are no more results.

**`POST /v1/community/listings/:id/clone`** copies the listing's assets into
**your own storage** — the clone is an independent snapshot that survives the
original being changed or taken down. Body is `{ entityType }` (must match the
listing's kind). When called with an **OAuth app token** it requires the
`assets:write` scope (no-op for user / API-key auth — you own the resources).
If your account is over its storage limit the route returns
`413 storage_limit_exceeded`.

**`POST /v1/community/listings/:id/report`** accepts a `reason` of
`real_person_no_consent` (depicts a real person without consent),
`inappropriate`, `ip_violation`, or `other`.

```bash
# Browse the newest shared characters
curl -s "https://app.nodaro.ai/v1/community/browse?entityType=character&sort=newest" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[] | {slug, title}'

# Clone one into your library
curl -s -X POST "https://app.nodaro.ai/v1/community/listings/$LISTING_ID/clone" \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entityType": "character"}' | jq .
# → { "entityType": "character", "id": "<new-asset-id>" }
```

### Admin routes (admin auth)

Publishing and moderation are **admin-only** — these routes require an admin
token. `entityType` in the path is one of `character` / `location` / `object`.

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/v1/admin/community/:entityType/:id/publish` | Publish one of your own assets to the catalog. Returns `{ slug, id }`. |
| `DELETE` | `/v1/admin/community/listings/:id` | Unlist + deactivate a listing and purge its preview blobs. Returns `{ ok: true }`. |
| `GET`    | `/v1/admin/community/reports` | List open (unresolved) reports. Returns `{ data: Report[] }`. |
| `POST`   | `/v1/admin/community/listings/:id/takedown` | Take a reported listing down: deactivate it, resolve its open reports, purge preview blobs. Returns `{ ok: true }`. |

**`POST /v1/admin/community/:entityType/:id/publish` body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | `string` | yes | 1–120 chars. |
| `description` | `string` | no | Up to 2000 chars. |
| `category` | `string` | no | Up to 60 chars. |
| `style` | `string` | no | Up to 60 chars. |
| `tags` | `string[]` | no | Up to 20 tags, 40 chars each. |
| `attestation` | `true` | yes | Must be literally `true` — the admin attests they have rights to share the asset. |
| `likenessAttestation` | `boolean` | conditional | **Required (`true`) for `entityType === "character"`** — confirms any real person depicted consented and is 18+. Optional for locations/objects. |

The source asset (`:id`) must be one the admin owns; otherwise the route returns
`404 not_found`. A character publish without `likenessAttestation: true` is
rejected with `400 validation_error`. See
[Community Library → Safety](./community-library.md#safety-likeness-and-consent)
for why the likeness attestation is mandatory for characters.

```bash
# Publish a character (likeness attestation required)
curl -s -X POST "https://app.nodaro.ai/v1/admin/community/character/$CHARACTER_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Detective Mara",
        "description": "Noir-styled investigator",
        "category": "people",
        "tags": ["noir", "detective"],
        "attestation": true,
        "likenessAttestation": true
      }' | jq .
# → { "slug": "detective-mara", "id": "<listing-id>" }
```

## 18. Studio timeline export

> **Cloud edition only.** Export a Studio production timeline to a portable
> editing-project file so you can finish the cut in an external NLE. Registered
> on Cloud instances; on Community/Business it is not registered and returns
> `404`.

### `POST /v1/freecut-export`

Serialize a timeline (your scene composites + the cut decisions between them)
into either a **FreeCut JSON** (`freecut-v1`) or a **FCPXML** (`fcpxml-v1.10`)
project file, upload it to your storage, and return the file URL.

This endpoint is **0 credits** and rate-limited to **10 requests / minute**.
Auth is the same bearer token as every other endpoint (`ndr_…` / `ndr_app_…` /
Supabase JWT); no scope is required.

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `format` | `"json" \| "fcpxml"` | yes | `json` → FreeCut JSON (`freecut-v1`, `application/json`); `fcpxml` → Final Cut Pro XML (`fcpxml-v1.10`, `application/xml`). |
| `timeline` | object | yes | The timeline to serialize (see below). |
| `name` | `string` | no | Up to 200 chars. A human label for your records. |

**`timeline` object:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `scenes` | `Scene[]` | yes | ≥ 1 scene, in playback order. One video clip is emitted per scene. |
| `musicAssetUrl` | `string` | no (default `""`) | URL of the music track. Empty string skips the music track/lane entirely. |
| `narrationAssetUrl` | `string` | no | URL of a narration track. When present, emitted as a **separate** audio track/lane (not pre-mixed with music). |
| `fadeOutDurationSec` | `number` | no (default `0.8`) | Tail fade-out applied to the music clip (JSON only; FCPXML carries no fade primitive). |

**`Scene` object** (each entry of `timeline.scenes`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `sceneEntityId` | `string` | yes | Non-empty id for the scene. |
| `compositeUrl` | `string` (URL) | yes | The pre-merged scene composite video — becomes one clip on the video track. |
| `shots` | `Shot[]` | yes | ≥ 1 shot. Drives the scene's duration and, via the first/last shot's `cut_decision`, its head/tail trim and out-transition. |

**`Shot` object** (each entry of `scene.shots`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `shot_id` | `string` | yes | Non-empty shot id. |
| `duration_seconds` | `number` (≥ 0) | yes | The shot's length; the scene clip's full duration is the sum of its shots. |
| `cut_decision` | object | no | The transition leaving this shot + in/out trims (see below). |

**`cut_decision` object:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `in_offset_sec` | `number` | yes | Head-trim into the scene composite (applied from the **first** shot's `cut_decision`). |
| `out_offset_sec` | `number` | yes | Tail-trim off the scene composite (applied from the **last** shot's `cut_decision`). |
| `transition_to_next` | `"hard_cut" \| "dissolve" \| "match_cut" \| "overlap"` | yes | Transition into the next scene. `dissolve`/`overlap` overlap the timeline by their duration; `hard_cut`/`match_cut` butt-join (no overlap). |
| `transition_duration_sec` | `number` | no | Overrides the per-type default (`hard_cut`/`match_cut` → 0, `overlap` → 1.0, `dissolve` → 0.5). |

**Response (200):**

```json
{ "url": "https://…/exports/<userId>/freecut-<uuid>.json", "format": "json", "assetId": "<uuid-or-null>" }
```

- `url` — the R2 URL of the uploaded project file.
- `format` — echoes the requested `format` (`"json"` or `"fcpxml"`).
- `assetId` — the id of the `assets` row created for the file, or `null` if the
  asset-row insert failed (the file upload still succeeded, so `url` is valid).

**Errors:** 400 `validation_error` (the `issues` array carries the Zod
details) · 401 `unauthorized`.

**Concatenation note:** when none of a timeline's shots carry a `cut_decision`,
the export is a **simple concatenation** — one clip per scene laid end-to-end at
cumulative positions, all joins are hard cuts, and the music (if any) is a single
track spanning the whole timeline. Per-shot trims **within** a scene are not
honored; only the first and last shot's `cut_decision` of each scene contribute
(head trim / tail trim / out-transition), because the scene composite is already
pre-merged.

```bash
TOKEN="ndr_..."
BASE="https://app.nodaro.ai"

# Export a two-scene timeline as FreeCut JSON (simple concatenation —
# no cut_decision on any shot).
curl -s -X POST "$BASE/v1/freecut-export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "format": "json",
        "name": "My Cut",
        "timeline": {
          "musicAssetUrl": "https://…/music.mp3",
          "scenes": [
            {
              "sceneEntityId": "scene-1",
              "compositeUrl": "https://…/scene-1.mp4",
              "shots": [{ "shot_id": "s1", "duration_seconds": 4 }]
            },
            {
              "sceneEntityId": "scene-2",
              "compositeUrl": "https://…/scene-2.mp4",
              "shots": [{ "shot_id": "s2", "duration_seconds": 6 }]
            }
          ]
        }
      }' | jq .
# → { "url": "https://…/exports/<userId>/freecut-<uuid>.json", "format": "json", "assetId": "<uuid>" }
```

## 19. SDK alternative (TypeScript)

The same backend is fronted by a typed TypeScript client:

```bash
npm install @nodaro/sdk
```

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

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

The credit identifier becomes `flux-lora-character` (**2 cr**). Multi-character
mentions fall back to the selected provider + ref injection.

## See also

- [Character Training](./features/character-training.md) — user-facing feature doc
- [OAuth Flow](./oauth-flow.md) — third-party app authorization
- [SDK Quickstart](./sdk-quickstart.md) — TypeScript client walkthrough
- [SDK Reference](./sdk-reference.md) — full method index
- [Architecture](./architecture.md) — how requests flow through the system
- [Deployment](./deployment.md) — self-hosting your own instance

## 9. OpenAPI spec & other languages (Go, Rust, Python, …)

The REST surface works from any language — bearer token, JSON in/out, the
error envelope from section 8. For typed clients, a machine-readable
**OpenAPI 3.1** spec is served live:

```
https://app.nodaro.ai/v1/openapi.json
```

It is a **curated subset** covering the automation core: workflows (run /
executions), jobs (status polling), node discovery (`/v1/nodes`), the
flagship generation endpoints (`/v1/generate-image`, `/v1/generate-video` —
every node type follows the same `POST /v1/{node-type}` shape), OAuth token
exchange, and credit cost lookup. Generate a client:

```bash
# Go
oapi-codegen -generate types,client -package nodaro https://app.nodaro.ai/v1/openapi.json

# Rust
openapi-generator generate -i https://app.nodaro.ai/v1/openapi.json -g rust -o nodaro-rs

# Python
openapi-generator generate -i https://app.nodaro.ai/v1/openapi.json -g python -o nodaro-py
```

Per-node request fields beyond the flagship pair are documented in the
[node catalog](./nodes/README.md) (every page also exists as raw `.md`).
