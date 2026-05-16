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
- Counts every authenticated call: `/run`, `/status/:execId`,
  `/result/:execId`, and `/workflows`.
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

## 8. Error envelope

All errors share the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests. Max 30 per minute." } }
```

| HTTP | code | When |
|---|---|---|
| 400 | `validation_error` | Malformed body, bad UUID, invalid field. |
| 401 | `unauthorized` | Missing/invalid/expired/revoked token. |
| 402 | `insufficient_credits` | (Cloud edition only) Account out of credits. |
| 403 | `forbidden` | Token isn't authorized for this workflow (workflow scoping). |
| 403 | `edition_restricted` | Endpoint requires Business or Cloud edition. |
| 404 | `not_found` | Workflow, execution, or token not found. |
| 429 | `rate_limited` | You've exceeded the per-minute bucket. Back off. |
| 500 | `internal_error` | Server bug or downstream dependency failure. Retry with backoff. |

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

## 10. SDK alternative (TypeScript)

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

## See also

- [OAuth Flow](./oauth-flow.md) — third-party app authorization
- [SDK Quickstart](./sdk-quickstart.md) — TypeScript client walkthrough
- [SDK Reference](./sdk-reference.md) — full method index
- [Architecture](./architecture.md) — how requests flow through the system
- [Deployment](./deployment.md) — self-hosting your own instance
