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

## 9. SDK alternative (TypeScript)

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
