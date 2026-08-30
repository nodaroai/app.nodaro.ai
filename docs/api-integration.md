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

A few surfaces are deliberately app-only and reject API tokens and OAuth
app tokens with `403 in_app_only` — currently the archived-runs routes and
the [Workflow Copilot](./features/workflow-copilot.md) (`/v1/copilot/*`).
They exist for the Nodaro web app's own session, not as an integration
surface. To build workflows programmatically, use MCP or the SDK.

The five legacy endpoints below are scoped specifically to running
workflows by ID with input overrides — they live under `/v1/api/` and
predate the published-app system. Most new integrations should prefer
`/v1/app/:slug/run` instead, but these remain supported.

`POST /v1/app/:slug/run` takes the app's exposed fields as flat `inputs`, plus an
optional `inputOverrides` — nested `{ nodeId: { field: value } }` raw node
overrides for THIS run. The two are merged, not either/or: the nested overrides
are applied OVER the flat `inputs`, per node and per field, so `inputOverrides`
wins on any field both set and reaches fields no app input exposes (such as
`promptPrefix`; see [Prompt pre & post text](./prompt-pre-post-text.md)).

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

### Moving a workflow between projects

```
POST /v1/workflows/:id/move   { "projectId": "…" }
```

Authorized by `workflows:write` — a move is a workflow write, not a permission
of its own. `PATCH /v1/workflows/:id` with a `projectId` does the same thing
and is decided by the same rule; it remains supported.

You may move work you created. Inside an organization a workspace admin may
also move work between two workspaces they administer — both sides, not one.
A personal project must be your own on both sides: owning the workflow is not
enough to file it in somebody else's project.

| Status | Code | Meaning |
|---|---|---|
| `400` | `validation_error` | The workflow is already in that project |
| `403` | `not_permitted` | Not yours to move, or not yours to move there |
| `404` | `not_found` | No such workflow, or no such project for you |
| `409` | `move_blocked` | The work was created for an assignment |
| `409` | `workspace_archived` | The target workspace is archived |

A move that changes workspace clears the workflow's collaborator grants and
reports them, so you can see what the move cost. Both forms do this; the
`PATCH` form includes the field only when something was actually dropped, so
an ordinary save keeps the response shape it has always had:

```json
{
  "data": { "id": "…", "projectId": "…" },
  "droppedCollaborators": [{ "userId": "…", "name": "Sam" }]
}
```

Those grants are the ones described under [workflow
collaborators](./organizations.md#workflow-collaborators): a move can carry
work out of the reach of somebody who was sharing it, and the response names
who so you can tell them.

**OAuth scope note:** the `workflows:read` scope also gates the broader
workflow REST routes: `GET /v1/workflows` (flat list across all projects),
`GET /v1/workflows/:id`, and `GET /v1/workflows/:id/export` — in addition
to the project-scoped `GET /v1/projects/:projectId/workflows`. If your
OAuth token will call any of these, request `workflows:read` in the
authorization scope.

### External SSO

Two **public** (no-auth) endpoints let a trusted external identity provider
sign a user in. They are the only things mounted under `/v1/sso/`, and only for
`GET`. Full setup — provider config, the assertion contract, and the
account-linking rules — is in [External SSO](./sso.md); it is **off** unless
`EXTERNAL_SSO_PROVIDERS` is configured.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/sso/providers` | Public provider metadata for the login page. Returns `{ "providers": [{ "id", "label", "kind" }] }` — **never** a secret. `{ "providers": [] }` when SSO is off. |
| `GET` | `/v1/sso/:provider` | The exchange endpoint (a **browser redirect** endpoint, not a JSON API). |

`GET /v1/sso/:provider` behaves by what it is called with:

- **Without `?assertion=`** — redirects (`302`) to the provider's `initiateUrl`
  (the login-button entry point), or `400 no_assertion` if none is configured.
- **With `?assertion=<jwt>`** — verifies the assertion (HS256 signature, `aud`,
  `exp`, server-enforced max lifetime, single-use `jti`), applies the
  account-linking rules, mints a one-time Supabase login token, and redirects
  (`302`) to `/sso?sso_token=<token>&next=<same-origin-relative-path>`. The
  browser's `/sso` landing exchanges that token for a session.
- A `?next=` value is honoured only when it is a same-origin **relative** path;
  anything else falls back to `/projects` (open-redirect guard).

Status codes: `401` (bad or replayed assertion), `403` (`account_exists` /
`email_unverified` / `account_linked_other_provider` — linking refused; the last
when the email already belongs to an account linked to a **different** identity
provider, which is never re-stamped), `404` (unknown provider), `400`
(`not_assertion_provider` when a native OIDC/SAML provider is hit with an
assertion), `429` (per-IP rate limit). The assertion and the minted token are
redacted from request logs.

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

## 4b. Identifying your client (optional)

Send an `X-Nodaro-Client` header and Nodaro records it as the origin of every
job the request creates, which is what the admin jobs view groups by:

```
X-Nodaro-Client: sdk/1.10.0
```

Only `sdk/<version>` and `cli/<version>` are recognised; any other value is
ignored rather than trusted, since the header is unauthenticated. `@nodaro/sdk`
and `@nodaro/cli` send it automatically — you only need this when calling the
REST API directly. Omitting it is fine; those jobs are simply recorded as
generic API calls.

Browser callers need do nothing — and should NOT send this header. The `Origin`
header already identifies the site, and Nodaro prefers it: it names the product
(`studio.nodaro.ai`) rather than the library. `@nodaro/sdk` omits the header
automatically when it runs in a browser, so a page never depends on the header
being allowlisted server-side.

## 4c. Selecting a workspace (Cloud, organizations)

Accounts that belong to an organization can work inside one of its workspaces.
Send the workspace's id and the request is scoped to it:

```
X-Nodaro-Workspace: 6f1e6b4c-6a4e-4b7b-9d2a-2f0f0a1d9c34
```

The header does two things, and only these two: it decides **which workspace a
list returns** and **where a create lands**. It never grants access. Reading,
updating, deleting or running something you name by id is decided by that
object's own workspace, so a forgotten header cannot hide your work and a
forged one cannot reach anyone else's.

Send it only for a workspace you belong to. Anything else — a workspace you are
not a member of, one that does not exist, or one whose organization is not
active — is refused with `403 not_a_member`; a suspended membership with
`403 member_suspended`; a value that is not a uuid with `400 validation_error`.
Omit it and you are working in your personal space, exactly as an account with
no organization always does.

Two exceptions exist so a stale selection can never lock you out: on
`GET /v1/me` and `GET /v1/workspaces` (and when accepting an invitation) a
workspace you can no longer select is treated as if you had sent nothing, and
the call succeeds. Those are the endpoints that tell you which workspaces you
may select, so clear a cached selection when they stop listing it.

An API token may be bound to one workspace; it then behaves as if it sent this
header on every request, and an explicit header naming a different workspace
is refused with `400 token_workspace_mismatch`.

Bind or unbind with `PATCH /v1/api-tokens/:id`:

```bash
# bind
curl -X PATCH https://app.nodaro.ai/v1/api-tokens/$TOKEN_ID \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"6f1e6b4c-6a4e-4b7b-9d2a-2f0f0a1d9c34"}'

# unbind
curl -X PATCH https://app.nodaro.ai/v1/api-tokens/$TOKEN_ID \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":null}'
```

You may bind a token only to a workspace you could select with the header;
anything else is refused the same way the header is. Unbinding is always
allowed. The binding is returned as `workspaceId` when you list your tokens.

### Where a create lands

Inside a workspace, a create that names no project lands in **that
workspace's** project, never your personal one. If the workspace has no
project yet the create is refused with `409 workspace_has_no_default_project`
rather than guessing — name a project explicitly and it will succeed.

A project you name must belong to the workspace you are working in. One that
belongs to a different workspace, or to your personal space, answers
`404 Project not found` — the same answer a project that does not exist gets,
so the header cannot be used to discover what exists.

Creating a **project** inside a workspace may be restricted to its admins. When
it is, members get `403 project_create_not_allowed`.

### Archived workspaces are read-only

Archiving a workspace keeps everything in it readable and stops new work being
added. Lists behave normally. Every create — a project, a workflow, an import,
a sub-workflow — answers `409 workspace_archived`, as does moving work **into**
it. Moving work **out** of an archived workspace stays allowed: rescuing it is
the reason to open one.

### When the personal space is closed

An organization can require that its members create only inside a workspace.
For those accounts, a create with no workspace selected answers
`403 personal_space_disabled`. Send the workspace header and the same call
succeeds. Accounts that belong to no organization are never affected.

The [SDK](./sdk-reference.md#clientwithworkspaceworkspaceid) sends it for you
— `createClient({ workspaceId })`, or `client.withWorkspace(id)` for a client
scoped to one workspace. The [CLI](./cli.md#working-in-a-workspace) takes
`--workspace`, `NODARO_WORKSPACE`, or a saved profile selection. For the full
organization surface — members, invitations, join codes, the audit log — see
[Organizations](./organizations.md).

The header has no effect unless organizations are enabled on the instance you
are calling; self-hosted builds ignore it.

The organization, workspace and membership endpoints themselves — creating an
organization, adding people, archiving a class — are documented in
[Organizations](./organizations.md).

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
| 403 | `subscription_required` | — | (Cloud edition only) A pay-as-you-go account tried to spend from a first-party consumer surface (browser session in the studio or another Nodaro app). Payg credits are redeemable via the API/SDK/CLI/MCP — this never fires for token-authenticated calls. Rollout-gated: availability may lag this document. |
| 404 | `not_found` | — | Workflow, execution, or token not found. |
| 429 | `rate_limited` | — | You've exceeded the per-minute bucket. Back off. |
| 500 | `internal_error` | — | Server bug or downstream dependency failure. Retry with backoff. |
| 503 | `price_not_configured` | — | (Cloud edition only) No pricing row exists for the requested model — the server hard-fails rather than silently mis-billing. Operator must seed the price; the call is not retryable as-is. |

Treat anything in the 5xx range as transient — retry with exponential
backoff. Treat 4xx as terminal — don't retry without fixing the request.

## 8b. Pay-as-you-go accounts

You do not need a subscription to use the API. Buying any credit pack —
or loading an arbitrary whole-dollar amount ($5–$1,000) from the Billing
page; larger loads earn a better per-credit rate — activates the
pay-as-you-go tier: balance responses report
`effectiveTier: "payg"`, all models are unlocked, outputs are not
watermarked, and there is no daily spending cap. Credits are valid for 12 months from purchase.
Pay-as-you-go credits are redeemable through the developer surfaces —
API, SDK, CLI, and MCP; using the web studio requires an active
subscription. Subscriptions remain available and always include a lower
per-credit rate at sustained volume.

**Auto-recharge** (optional): in Billing you can set "when my balance drops
below X credits, load $Y" — the amount is charged off-session to your saved
card (any manual load saves it) at the same rate as manual loads. Three
failed charges disable auto-recharge until you re-enable it. Every charge
(manual or automatic) emails a Stripe receipt, and receipt links appear in
the Billing page's Credit Activity. Rollout-gated:
availability may lag this document.

Two behaviors to know:

- **Outputs are public by default.** Private mode is a subscription
  feature (Standard plan and above) — pay-as-you-go outputs appear in
  the public gallery like free-tier outputs do. (Jobs created through
  the MCP server are always private, regardless of tier.)
- **Media retention follows account activity.** Your generated files are
  stored while your account is active; after roughly 3 months without a
  purchase or any credit spend, files older than 60 days may be cleaned
  up. Returning and spending credits stops future cleanup.

## 9. Characters

Character routes let you fully script character creation, identity edits,
asset generation, and the portrait-approval pipeline that drives Character
Studio. All routes require an authenticated bearer token (`ndr_…` /
`ndr_app_…` / Supabase JWT) and are scoped to the calling user.

### Lifecycle

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/characters` | List characters (cursor-paginated). Query: `projectId`, `archived=true`, `limit` (default 100, max 500), `cursor`. Returns `{ characters, nextCursor }` — see [pagination](#get-v1characters--pagination) below. |
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

### `GET /v1/characters` — pagination

The list is cursor-paginated. One call returns **at most `limit` rows**
(default 100, max 500), so treating a single response as "all characters"
silently truncates the list for anyone above that count.

```jsonc
{
  "characters": [ /* … */ ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTMxVDEwOjAwOjAxWiIsImlkIjoi…"
}
```

| Field | Meaning |
|---|---|
| `nextCursor` | Opaque token. Pass it back as `?cursor=` to fetch the next page. |
| `nextCursor: null` | You have reached the end — there are no more rows. |

Keep requesting until `nextCursor` is `null`:

```bash
CURSOR=""
while :; do
  RESP=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE/v1/characters?limit=100${CURSOR:+&cursor=$CURSOR}")
  echo "$RESP" | jq -r '.characters[].id'
  CURSOR=$(echo "$RESP" | jq -r '.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
```

Notes:

- The cursor is a **keyset** over `(created_at, id)` — the ordering is
  `created_at DESC, id DESC`. Pairing the id with the timestamp is what keeps
  rows created in the same transaction (identical `created_at`) from being
  skipped at a page boundary.
- The cursor is **opaque**: do not parse, construct, or persist it across
  releases. Only ever echo back a `nextCursor` the server gave you.
- A malformed cursor is a `400 validation_error`, not a silent reset to the
  first page.
- `archived=true` pages the same way, over the archived set.
- Rows created *while* you are paging (newer than page 1's boundary) are not
  picked up by the walk — restart from no cursor to see them.

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
| `GET` | `/v1/objects` | List objects. Query: `projectId`, `archived=true`; optional `limit` (max 500) + `cursor` opt into the same cursor pagination as `/v1/characters` and add `nextCursor` to the response — without `limit` the full legacy listing returns, unchanged. `/v1/creatures`, `/v1/locations` and `/v1/faces` accept the identical parameters. |
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
`outputType`, `creditCost` (static credit cost when known — Cloud only; community and business installs have no credit system and omit the field), `inputSchema`
(JSON Schema for the node's config fields), `providers` (supported
provider slugs), `capabilities` (feature flags the node exposes). Nodes
with per-model constraints carry additional discovery fields —
`maxDurationSec` (hard duration ceiling), `sparseProviders` (models whose
segment-duration menu is sparse; off-menu values snap to the nearest
entry), `providerResolutions` (per-model resolution tiers, e.g.
`{ "minimax-h3": ["2K", "768P"] }`), `providerResolutionWire` (display
resolution → the literal wire value the API expects — send `"768P"`, not
`"768p"`, to reach minimax-h3's cheap tier), and `soundtrack` (Generate
Video Pro: the deployed engine accepts the original-audio `soundtrack`
input). The exact shape grows over time — treat unknown fields as
forward-compatible.

Every AI prompt node also lists `promptPrefix` and `promptSuffix` (`text`) in
`inputSchema` — see [Prompt pre & post text](./prompt-pre-post-text.md).

Neither endpoint requires authentication; they expose only static
registry metadata. No scopes required.

### Model catalog

`GET /v1/models` — the REST twin of the MCP `list_models` tool, for plain
SDK/HTTP clients. Public (model availability is not a secret), cached 5
minutes (`Cache-Control: public, max-age=300`). Returns
`{ sections, recommendations, totalModels }`: models grouped by kind
(`image` / `video` / `audio`) and vendor family, each with capability
sheets (`modes`, `features`, `aspectRatios`, `resolutions`, `durations`),
per-variant credit `pricing` (Cloud only — like `creditCost` on
`/v1/nodes`, editions without a credit system omit it), compact
`promptTips`, and the
`doctrineCovered` truth flag (`true` only when a sourced per-family prompt
doctrine exists — gate "vendor doctrine" badges on it; never overclaim).

| Query param | Values | Purpose |
|---|---|---|
| `kind` | `image` / `video` / `audio` | Filter to one media kind. |
| `mode` | e.g. `t2i`, `i2v`, `t2v`, `tts`, `video-analysis` | Filter by operation. |
| `family` | string | Vendor / lab name, e.g. `Google`, `Bytedance`. |
| `featuredOnly` | boolean | Featured models only. |

### Seedance 2 video capabilities

The video routes (`/v1/text-to-video`, `/v1/generate-video`) accept these on
the Seedance 2 family — `resolution` / `aspectRatio` are pass-through strings,
so a value the model doesn't support is ignored, never a 400:

- **`seedance-2`** (full) supports `resolution: "4k"` and
  `aspectRatio: "adaptive"` (plus `"21:9"`). `seedance-2-fast` and
  `seedance-2-mini` are **480p / 720p only** (no 1080p, no 4K);
  `seedance-2-5` is **480p / 720p / 1080p** (no 4K; 1080p added 2026-08-17).
- **`seedance-2-5`** (Seedance 2.5) generates up to **30s in one call** — every
  other Seedance 2 SKU stops at 15s — and raises the reference caps to
  **30 images / 10 videos / 10 audio** (audio ≤ 30s per clip). With a start
  frame it always renders at that frame's aspect ratio; an explicit
  `aspectRatio` is coerced to `adaptive` rather than sent.
- **`minimax-h3`** (MiniMax Hailuo 3) takes the same reference fields with the
  same 9 / 3 / 3 caps and renders at `resolution: "2K"` (default) or `"768P"`
  (the cheaper per-second rate) — any other resolution value renders and bills
  as 2K. `aspectRatio: "adaptive"` is the default; a pure text-to-video call
  needs a concrete ratio (adaptive coerces to 16:9 there). Reference audio
  must ride with an image or video reference; input images beyond the first 5
  add a per-image surcharge.
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

`POST /v1/generate-video`, `POST /v1/text-to-video`, and `POST /v1/extend-video`
accept an optional `connectedReferences` array — the SAME structured-reference
shape `/v1/generate-image` takes — so a direct API / SDK / MCP caller gets the
identical reference assembly the editor performs client-side, instead of
hand-building a prose "Image N is …" guide. When present, the route
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
- **`{ref:<id>}` / `{ref:<id>:label}` address a reference by its own id.** Write
  the `id` you gave the entry in `connectedReferences` and the platform substitutes
  its `@image_N` seat *after* it has numbered the references (flat
  `referenceImageUrls` first, then unmentioned wired characters, then the other
  entries, in order) — so you never compute `N` yourself, and a later change to
  the numbering can't misbind your picture. Ids are opaque and may contain `:`
  and `/` (an image URL is a fine id). A token whose reference was not attached
  (capped out, or a provider without reference support) drops to its label, else
  the entry's `defaultName`, else nothing — it never reaches the model raw.
  `{ref:}` follows the reference through `referenceOrder`; `{image:N}` keeps its
  literal `N`. The canvas editor keeps writing `{image:N}`.
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
- **References-only runs (no `imageUrl`).** On `POST /v1/generate-video` the
  start frame is optional whenever at least one supplied reference kind is
  supported by the selected provider (per the caps above) — e.g. Kling 3 Omni
  with `referenceImageUrls` alone. VEO 3.x references-only runs are
  auto-normalized to `REFERENCE_2_VIDEO`, so passing `generationType` is not
  required. Reference kinds the provider can't carry don't lift the
  requirement: a provider with no reference support still needs `imageUrl`,
  and e.g. audio-only references on an images-only model are rejected with a
  400 rather than silently dropped.
- **Backward compatible.** Omit `connectedReferences` and the route behaves
  exactly as before — a pre-assembled `prompt` + flat `referenceImageUrls` pass
  through unchanged. `connectedReferences` feeds the **image** channel only;
  `referenceVideoUrls` / `referenceAudioUrls` stay as explicit flat inputs.
- **Extend Video: Seedance 2 Extend only, with one seat reserved.** On
  `POST /v1/extend-video` both `connectedReferences` and the flat
  `referenceImageUrls` are accepted when `provider` is `seedance-2-extend` — the
  only extend transport with a reference path; any other extend provider
  refuses them with a 400 rather than silently dropping. The image budget is
  the Seedance 2 cap **minus one** (up to **8** user references): the extension
  pipeline itself occupies one reference seat with the source's last frame (the
  continuation anchor), appended AFTER the user references so `@image_1…@image_8`
  ordinals never shift. The source's 2-second tail rides as `@video_1` and is
  already priced into the extend rates — reference images add no extra credits.

Each ref's `url` rides the same SSRF gate as the flat `referenceImageUrls`, so a
ref pointing at a private address / non-http(s) scheme is rejected at the route
boundary. See the [Generate Video node](nodes/ai-video/generate-video.md#referencing-wired-assets-in-the-prompt-imagen--videon--audion-tokens)
page for the token syntax and worked examples.

> **`referenceOrder` on images too.** `POST /v1/generate-image` accepts the same
> optional `referenceOrder` (parity with video) to reorder its assembled
> reference list and renumber the `@image_N` bindings.

### Cinematic direction (`direction`) on generate-image

`POST /v1/generate-image` accepts an optional `direction` object: a flat map of
**catalog ids**, one key per cinematic dimension, which the platform folds into
the prompt as its own hint clauses. Send ids, not prose — the wording stays
platform-owned, so a saved production picks up improved phrasing instead of
freezing whatever text your client wrote the day it was saved.

```json
{
  "prompt": "a knight on a hill",
  "provider": "nano-banana",
  "direction": {
    "shotSize": "wide-shot",
    "lightingStyle": "rembrandt",
    "style": "anime",
    "mood": ["happy", "joyful"]
  }
}
```

- **The keys are the platform's own picker field names** — `shotSize`, `angle`,
  `coverage`, `composition`, `vantage`, `pose`, `compositionEffect`,
  `cameraFormat`, `lens`, `aperture`, `shutterSpeed`, `isoValue`, `timeOfDay`,
  `lightingStyle`, `lightingDirection`, `lightingRatio`, `colorTemperature`,
  `colorLook`, `atmosphere`, `postProcess`, `style`, `mood`, `aesthetic`,
  `photoGenre`, `photographer`, `renderQuality`, `setting`, `era`, `backdrop`.
  (The registry also defines motion dimensions — `cameraMotion`, `actionFx`,
  the `temporal*` keys, `transition`, `loopSubject` — for the video surface;
  `POST /v1/generate-video` does not accept a `direction` field yet, so sending
  one there has no effect today.) Valid ids come from
  [`GET /v1/picker-catalogs`](#picker-catalogs) — the same catalogs the canvas
  pickers read. One caveat on deployments that register catalog **packs**: that
  endpoint returns the pack-composed catalogs while the fold reads the base
  catalogs, so a pack-added id is listed and accepted but renders no clause.
- **Single id or an array.** Multi-pick dimensions (`mood`, `aesthetic`,
  `photographer`, `atmosphere`, `postProcess`, `composition`, `lightingStyle`)
  honor up to their own cap; a single-pick key given an array takes the first
  entry. Exceeding a *dimension's* cap truncates rather than 400ing. The two
  *wire* bounds do reject with a `validation_error`: at most **8** entries per
  key, and at most **100** characters per id.
- **Absent ≠ empty.** A missing key means "no hint", never a default. An empty
  string or an empty array contributes nothing, and a `direction` that renders
  no clause leaves your `prompt` byte-for-byte untouched.
- **Unknown keys and unknown ids are skipped silently**, not rejected — a newer
  client on an older API degrades to fewer hints rather than erroring, which is
  why you should deploy the platform before the client that starts sending new
  dimensions.
- **Fold order is the platform's**, not your object's key order, and the
  clauses are appended after your prompt (`". "`-joined), before any
  `structured` fragment. Repeated identical clauses collapse to one.
- The assembled prompt is still truncated to the provider's verified prompt cap,
  so a maximal `direction` on a low-cap model can lose its tail clauses — send
  the dimensions that matter most first-class rather than everything at once.

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
| `detail` | `compact` (default) / `full` | `compact`: `id`, `label`, `category`, `term`, `icon`. `full`: additionally includes each option's `description` and `promptHint` (the prompt fragment it injects). |
| `category` | string | Single-dim pickers: filter options to one category. |
| `field` | string | Return only this dimension's field — multi-dim pickers (person / styling / framing), and the secondary parameters of a single-dim picker (transition / character-fx: `position` / `duration` / `intensity`). |

A single-dim catalog carries `options`; a multi-dim catalog carries
`dimensions` (one `{ field, label, options }` per field). A single-dim catalog
with secondary parameter fields beside its main picker — `transition` and
`character-fx`, whose `position` / `duration` / `intensity` dropdowns are
catalogs in their own right — carries **both**: `options` for the picker and
`dimensions` for the three secondary fields. Every option carries a
`term` at **both** detail levels — the short professional phrase to inject into
a prompt when you want a compact instruction (`"whip pan left"`), where `label`
is display-only and `promptHint` is the full mechanism sentence. It is `""` for
a no-op (`auto` / `none`) option that injects nothing. These are the same
catalogs that ship as pure data in [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared)
— prefer importing the package when you can bundle it (see
[Parameter Picker Catalogs](picker-catalogs.md)); the REST endpoints exist for
clients that can't.

### Catalogs (server-driven projection)

`GET /v1/catalogs` returns **every** picker catalog in one call, projected to a
single flat wire shape — the server-driven counterpart to the per-picker
`/v1/picker-catalogs/:nodeType`. Its purpose is deployment curation: a
self-hosted or managed deployment can register *vendored catalog packs*
(replace / extend / deny a catalog's options), and this endpoint reflects the
**registered, pack-composed** set. A thin client that renders its own pickers
therefore honors the deployment's curation without shipping its own copy of the
catalogs. Public, no auth, same 5-minute cache (`Cache-Control: public, max-age=300`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/catalogs` | Every registered catalog (`{ data: ProjectedCatalog[] }`). |

Query param (a bad value returns 400 `validation_error`):

| Param | Values | Purpose |
|---|---|---|
| `detail` | `compact` (default) / `full` | `compact`: `id`, `label`, `category`, `term`, `icon`. `full`: additionally includes each option's `description` and `promptHint`. |

Each `ProjectedCatalog` is `{ nodeType, label, catalogId, kind, valueField?, defaultValue?, categoryOrder?, categoryLabels?, detail, options?, fields?, dimensions? }` — single-dim catalogs carry `options`; multi-dim catalogs carry `dimensions` (one `{ field, label, options }` per field); a single-dim catalog with secondary parameter fields (`transition`, `character-fx`: `position` / `duration` / `intensity`) carries both. Each option is `{ id, label, category?, term, icon?, description?, promptHint? }`; `term` rides at **both** detail levels so a thin client can render `label` and inject the compact professional term without a second `detail=full` fetch. The shape is deliberately tag/policy-free.

### Text → pickers (AI Fill)

`POST /v1/text-to-picker` fills pickers from a free-text scene/shot
description — the "AI Fill" behind Nodaro Cine. Authenticated,
credit-billed (an LLM call; same credit id as describe-to-picker).

Body: `{ text, targetPickers?, instructions?, origin?, llmModel?,
reasoningEffort? }` — omit `targetPickers` to analyze ALL analyzable
pickers (the server fans out per family and merges). Returns
`{ jobId, pickerJson, gaps? }`: `pickerJson` is
`pickerType → dimension → chosen catalog id(s)` (the same shape as
describe-to-picker — hydrate pickers from it verbatim), and `gaps` lists
attributes the text described that no catalog id represents well (surface
as "we couldn't infer X"). SDK: `client.pickerCatalogs.analyzeText(...)`;
CLI: `nodaro pickers analyze "<text>"`.

### Structured LLM output (any schema)

`POST /v1/llm/structured` runs one LLM call whose answer is forced to the
JSON Schema you supply, validated against it, and handed back as an object.
Authenticated and credit-billed under its own `llm-structured` feature id
(priced per model tier). It is the generic primitive behind schema-authoring
clients — Nodaro Studio composes a whole production plan with it.

Body: `{ system, input, jsonSchema, schemaName?, llmModel?, reasoningEffort?,
maxRetries?, origin?, advancedMode?, temperature?, maxTokens? }`. `system` and
`input` are plain text (each at most 100,000 characters; `input` must be at
least 1 character). `schemaName` names the forced-output tool the provider
sees and caps at 64 characters. Omit `llmModel` and the call runs on
`gemini-3.6-flash`, the generic `llm-chat` default. `jsonSchema` is a JSON
Schema **object** (`type: "object"`, at most 64 KB serialized and 20 levels of
nesting) written in the keyword subset the server can convert:
`properties` / `required` / `additionalProperties` (including the record
form), `items`, `string` / `number` / `integer` / `boolean`, `enum`, `const`,
`anyOf` of concrete types, `minimum` / `maximum` / `minItems` / `maxItems` /
`minLength` / `maxLength`, `multipleOf`, `exclusiveMinimum` and `description`.
`not`, `if` / `then` / `else`, `dependent*` and external `$ref` are refused
with 400. One caveat worth reading twice: an `anyOf` of bare `required`
branches — the usual "at least one of these fields" idiom — is **accepted and
not enforced**. Express cross-field rules in your own validator.

Returns `{ jobId, output, usage: { inputTokens, outputTokens } }`, where
`output` has your schema's shape. `maxRetries` (0–3, default 2) is how many
times an invalid answer is fed back to the model together with its validation
error before the call gives up; `maxTokens` must not exceed the chosen model's
own output limit (400 otherwise). The two sampling levers are **not
symmetric**: `maxTokens` applies on every call — a deliberate departure from
the LLM routes that put both levers behind the Advanced-mode gate —
while `temperature` is **silently ignored** unless you also send
`advancedMode: true`. Advanced mode pins the call to the vendor's own API,
where those levers take effect, and therefore bills **one credit tier up**;
asking for it on a model with no direct lane is a 400
`advanced_mode_unsupported`. The call is
**synchronous and a single call may run several minutes** — each attempt is
allowed up to 240 seconds — so give your HTTP client a matching timeout.
Errors: 400 `validation_error`, 401, 402 (credits), 500 `internal_error` (the
job row could not be created), 502 `llm_error` once the retries are spent, 503
`provider_unavailable`. No typed SDK resource yet — call it with
`client.request("POST", "/v1/llm/structured", { body })`.

### Direct uploads

`POST /v1/upload` (multipart: `file` + `type` of `image` / `video` /
`audio`) stores a file on the instance's media host and returns its URL.
Accepted audio formats include MP3, WAV, M4A/AAC, OGG, WebM and FLAC
(`audio/flac` / `audio/x-flac`); size caps are enforced per media type
(50 MB for audio). The SDK wraps this as `client.uploads`; MCP clients use
`prepare_audio_upload` / `request_audio_upload` and friends.

## 12. Credits (Cloud edition)

Two endpoints surface the caller's credit balance and transaction
history. Both are **Cloud-edition only** — on Community/Business they are
not registered and return 404.

| Method | Path | Query | Purpose |
|---|---|---|---|
| `GET` | `/v1/credits/balance` | — | Return `{ total, subscription, topup, tier, effectiveTier }`. `total = subscription + topup`. `effectiveTier` is the entitlement tier actually enforced — `"payg"` = no subscription but purchased credits (all models unlocked, no watermark, no daily cap). |
| `GET` | `/v1/credits/transactions` | `limit` (1–50, default 20), `cursor` (ISO timestamp for page-forward) | Return `{ data: Transaction[], nextCursor }`. Cursor is the `created_at` of the last row; pass it as `?cursor=` on the next request. `nextCursor` is `null` when there are no more rows. |

`Transaction` fields: `id`, `created_at`, `credits_used`, `action`,
`provider`, `metadata`.

`metadata` is an object carrying the run's billing mechanics, projected to a
fixed set of keys. Present when the ledger recorded them: `model`, `from_sub`
and `from_topup` (which of your credit pools funded the run), `is_app_run`,
`allowance_delta`, `web_free_mode`, `status`, `loop_trim_refunded`,
`surround_refine_refunded`. Any other key is omitted, and `metadata` is always
an object — `{}` when nothing applies — so it is safe to read without a null
check. Credits, not currency, are the billing unit the API exposes.

Both routes use the same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT).

Top-up credits are **valid for 12 months** from purchase (subscription
credits reset each billing cycle); spending draws subscription credits
first. The `/v1/billing/*` routes (checkout, load sessions, auto-recharge,
purchase history with receipt links, Stripe portal) are **first-party-only**:
they reject API and OAuth-app tokens and are used from a logged-in Nodaro
session — manage billing at [app.nodaro.ai/billing](https://app.nodaro.ai/billing).

## 12b. Billing surface

Two endpoints let a client render cost and usage views without hard-coding
"is this deployment metered?" — the deployment tells you which billing
provider is registered and answers per-job / per-account cost lookups
through it.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/billing/surface` | **Public** (no token) | Deployment-level projection — no per-user data, cacheable. Returns `{ data: { contract, providerId, displayUnit, canReport, canQuote, canAccount, mountCostTab } }`. On a keyless / community install `providerId` is `"none"` and `mountCostTab` is `false` (no cost view). |
| `GET` | `/v1/billing/account` | Bearer token | Per-user account summary (`AccountSummary`) from the registered provider: `{ data: AccountSummary \| null }`. `data: null` means the metering authority could not answer — clients MUST render that distinctly and never as a zero balance. |

`contract` is the billing-surface contract version (an integer, currently `2`).
`displayUnit` is the unit a cost view should default to (e.g. `"usd"` or
`"credits"`) — it follows the registered metering authority, not the edition.

**`AccountSummary` shape.** The four base fields are always present: `plan`
(a plain string; `"unknown"` is a real answer), `balance` (`number | null`),
`dailyAllowance` (`number | null`), and `unit`. Contract v2 adds a set of
**optional, nullable** rich fields a provider MAY expose; a provider that omits
one is saying "no such concept", and a client renders only the fields it
receives:

- `periodStart` — ISO start of the current usage period.
- `generations` — count of generations this period.
- `spent` — money spent this period, as `{ amount, currency }` (an ISO-4217
  currency code); `null` = unavailable.
- `payg` — pay-as-you-go state `{ enabled, reserve, rate, monthlyCap }`
  (`monthlyCap` is a `{ amount, currency }` money figure); omitted/`null` when
  the provider has no PAYG concept.
- `daily` — structured daily cap `{ limit, used, remaining, resetsAt }`
  (`resetsAt` is an ISO-8601 instant). `limit: 0` is a real value meaning
  "blocked", never "no limit"; when `daily` is present, prefer it over the
  scalar `dailyAllowance`.
- `reserveValue` — money value of the PAYG reserve, as `{ amount, currency }`;
  `null` when not priced.
- `byCategory` — per-category usage rows
  `{ category, count, amount, spent }[]`, where `amount` is `number | null` and
  `spent` is a `{ amount, currency }` money figure or `null`.

Every money figure and per-category `amount` is `number | null` / a nullable
money object: a `null` means **unavailable**, never `0`. Render a `null`
distinctly (e.g. an em dash), never as a free/zero cost.

**Cost summary response (`POST /v1/jobs/cost-summary`).** The credit field
`total_credits` (top-level and per breakdown row) is `number | null`, the
response carries `unit` — the registered provider's display unit the credit
figures are denominated in — and an `unavailable` count (jobs the metering
authority could not price). A `null` total means **no** job in the batch had a
known charge — it is NOT `0`. Render a `null` value distinctly (e.g. an em
dash), never as a free/zero cost. `total_cost_usd` (top-level and per row) is
**admin-only**, like every USD figure across api/sdk/mcp: for a non-admin
caller the key is absent (not `null`).

## 13. Job batch polling

Two endpoints let you poll multiple job statuses in a single round trip
(useful for workflow UIs that track many concurrent jobs):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/jobs/status?ids=a,b,c` | Comma-separated IDs, max 100. Returns `{ jobs: { id, status, output_data }[] }`. Cross-user / non-existent IDs are silently omitted — reconcile locally. |
| `POST` | `/v1/jobs/batch-status` | Body `{ jobIds: string[] }`, max 100. Returns `{ data: { id, status, output_data, error_message }[] }`. |

Both require `jobs:read` scope when using an OAuth token; admin tokens may
see cross-user jobs. These endpoints are public API — they are used by the
editor but are equally suited to external polling clients. `input_data` and
`output_data` are public projections: server-only fields such as Recast's
private pre-watermark remux base are removed recursively for every caller,
including administrators.

## 13b. Generate Video Pro run control (Cloud; self-host via the nodaro.ai connection)

The segmented long-video engine ([Generate Video Pro](./nodes/ai-video/generate-video-pro.md)) generates one segment at a time and checkpoints between segments, so a run can be stopped gracefully and continued later:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/generate-video-pro/:jobId/stop` | Graceful stop of a **processing** run: the in-flight segment is abandoned (still billed — the provider keeps rendering it), remaining segments are skipped, everything completed is stitched into the job's final video, and the untouched remainder of the reserve is refunded. Responds `{ jobId, stopping: true }`; keep polling the job — it completes with `output_data.pro.stopped = true` and `stoppedAtSegment`. A **pending** job is cancelled with a full refund instead (the generic cancel response is forwarded). |
| `POST` | `/v1/generate-video-pro/continue` | Body `{ fromJobId, fromSegment? }`. Starts a **new job** that reuses the parent run's plan and delivered segments below `fromSegment` (1-based; default = first not-yet-delivered) and regenerates from there, billed only for the regenerated segments plus the flat pro fee. The parent must be terminal (stopped / failed with ≥1 delivered segment / completed — an explicit `fromSegment` on a completed run re-rolls its tail). Responds `{ jobId, continuedFromJobId, fromSegment, segmentCount }`. Honors the `Idempotency-Key` header. |

Both enforce ownership (404 on a foreign job) and 400 on non-pro jobs. Pricing details and worked examples: the node page's [Stopping and continuing a run](./nodes/ai-video/generate-video-pro.md#stopping-and-continuing-a-run).

## 13c. Recast (Cloud edition)

`POST /v1/recast` (regenerate an analyzed source video with your own cast — the engine behind [recast.nodaro.ai](https://recast.nodaro.ai)) **requires `workflowId`**: the uuid of an existing workflow you own, which the recast run attaches to. Omitting it is a `400 workflow_id_required`; an unknown or foreign id is a `404 workflow_not_found`.

The full run lane (all Cloud-only; SDK: `client.recast`, MCP: the
`start_recast` / `get_recast_status` / `resolve_recast_gate` verbs):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/recast/estimate` | Quote the run in credits (`{ totalCredits, breakdown }`) before buying. Free. Body mirrors create: `analysisJobId`, `fidelity`, `resolution`, `segmentSec`, `renderMethod`, `interactive?`, `provider?`. |
| `POST` | `/v1/recast` | Create the run — **buys the plan**. Returns `{ recastId }`. |
| `GET` | `/v1/recast/:id` | Poll the run: `{ status, interactive?, capabilities?, audio? }` — `interactive.next` names the pending step or gate on interactive runs. A server with revisioned audio returns `capabilities.audioLayers: 1`. |
| `POST` | `/v1/recast/:id/start` | Start rendering a `planned` run (idempotent; the plan's quote covered it). Returns `{ gvpJobId? }`. |
| `POST` | `/v1/recast/:id/select` | Answer a pending pick — body `{ gate: "cast" \| "sheet" \| "anchors" \| "music", picks? / anchorPicks? / musicPick?, segment? / section?, finishAuto? }`. The pick itself is free. |
| `POST` | `/v1/recast/:id/estimate-rescore` | Quote a revisioned Music replacement and/or complete desired mix. Free; returns `{ credits, audioRevision, noOp }`. |
| `POST` | `/v1/recast/:id/rescore` | Apply the quoted audio operation. V2 returns `{ recastId, jobId }`, or `{ recastId, noOp: true, audioRevision }` without creating a job. |

Interactive runs are **server-driven**: a platform cron advances every
non-gate step, so a client only polls `GET /v1/recast/:id` and answers
gates via `/select`. Gates only open for gate kinds the run's create
declared in `clientCapabilities` (e.g. `"clientCapabilities":
["sheet-gate"]`) — a client that doesn't declare a capability never sees
that gate; the platform decides it automatically instead. Pass
`finishAuto: true` on `/select` to hand this and every remaining gate to
the automatic critic.

### Revisioned audio layers

Only enable an audio-layer UI when status includes
`capabilities.audioLayers: 1` and the selected completed take has an `audio`
manifest. The manifest is server-authored:

```ts
interface RecastAudioManifestV1 {
  version: 1
  revision: string
  mode: "bed" | "replace"
  present: { music?: true; video?: true }
  layers: { music?: { url: string }; video?: { url: string } }
  bakedEffectiveGain: { music?: number; video?: number }
  pendingRescore?: {
    jobId: string
    requestId: string
    state: "pending" | "running"
    expectedAudioRevision: string
    requestedEffectiveGain: { music?: number; video?: number }
  }
}
```

`present` is the logical layer set; `layers` is only the subset with a
browser-ready audio derivative. Do not infer that a missing derivative is absent
from the downloadable video. `bakedEffectiveGain` is the effective integer
percentage already rendered into the current result. The only generated video
URL exposed to clients remains `resultUrl`; private remux bases are not part of
this contract.

Quote and Apply use the same prospective operation:

```json
{
  "expectedAudioRevision": "server-revision",
  "sections": [{ "index": 0, "brief": "Sparse analogue pulse" }],
  "mix": {
    "music": { "gain": 60, "muted": false },
    "video": { "gain": 85, "muted": false }
  }
}
```

Send at most one Music replacement: either `audioUrl`, or one or more
`sections`. A mix-only request is also valid. Gains are finite linear
percentages; the server rounds and clamps them to 0–200, and a muted lane has an
effective gain of zero. Address only lanes in `present` (or Music introduced by
this request); replace-mode takes do not have a Video lane. The resolved
operation cannot leave every layer silent.

For Apply, add a UUID `requestId` and send the same
`expectedAudioRevision`. Keep that UUID stable only while retrying the identical
transport request. A successful no-op reserves no credits and creates no job.
Otherwise poll status: `audio.pendingRescore` survives reloads and disappears
when the new revision is published or the operation fails. Refresh status before
another operation.

Expected validation failures are `400` (`validation_error`,
`duplicate_section`, `unknown_section`, `all_audio_silent`). State conflicts are
`409` (`audio_layers_unavailable`, `audio_layer_unavailable`,
`audio_preview_unavailable`, `rescore_sections_unavailable`,
`legacy_mix_mismatch`, `stale_audio_revision`, `rescore_in_progress`,
`idempotency_conflict`).
`audio_preview_unavailable` means the layer is logically present but its
browser/ffmpeg-ready derivative is not available for an honest custom mix. A
stale-revision or in-progress response includes the current revision or live job
when available. Quoting never reserves credits and still returns the final
price when the current balance is insufficient; the paid route can return the
normal `402 insufficient_credits` response.

Revisioned replacement requests should normally send the complete desired
`mix`, even when its gains equal the current bake. Omitting `mix` is accepted only
when the resolved output exactly matches the fixed legacy recipe: Music 35 +
Video 100 in bed mode, or Music 100 in replace mode. Any other baked state returns
`409 legacy_mix_mismatch` instead of publishing gains that do not match the file.

Compatibility: a request with no `requestId`, `expectedAudioRevision`, or `mix`
and exactly one of `audioUrl` / `sections` uses the legacy rescore behavior. New
clients should use the revisioned contract above.

## 13d. Authored script import (Cloud edition)

Turn an LLM-authored screenplay JSON into a recast — **no source video**. All three endpoints are **free**.

- `POST /v1/video-analysis/import/validate` — body `{ "script": { … } }`. Returns
  `{ valid, errors: [{ path, message, hint? }], warnings: [] }`. The errors are written for an
  LLM repair loop: fix each `path` using its `hint` and repeat until `valid: true`.
- `POST /v1/video-analysis/import` — body `{ "script": { … }, "rightsAttested": true }`.
  Stores the validated document as a **completed analysis job**; returns
  `{ jobId, created, warnings, json }`, where `json` is the document **with the server-derived
  fields** (`sceneNumber`, `slotRefs`, `visualResolved`) — always use it, never your input, as
  the document of record. Re-importing an identical script returns the same `jobId`
  (`created: false`). `rightsAttested: true` is required (403 `rights_attestation_required`
  otherwise): authored recasts render **Faithful — exactly as written**, so the assertion that
  the script is your own work is the gate.
- `GET /v1/video-analysis/authoring-skill` — the generated authoring guide (markdown): the
  field contract, enum vocabularies, bounds, audio rules, and a validated worked example.
  Hand it to the LLM that writes your script.

**The document.** `meta` (`durationSec`, `width`, `height`, `aspectRatio` of `"16:9"` or
`"9:16"` — width/height must agree — and a required `title`, which names the project),
optional `look`, `slots[]` (`role`: `person` | `object` | `background`), and `scenes[]`
(contiguous from 0, each ≤ 8s, total from 4s up to the platform run cap; over-cap documents
are rejected, never truncated). Do **not** write `sceneNumber`/`slotRefs`/`visualResolved` —
the server derives them and ignores supplied values, which is also why pasting a full
exported analysis (the editor's "Copy JSON") works as-is.

The returned `jobId` is a standard analysis job: create a recast from it per §13c with
`analysisJobId` + `fidelity: "faithful"` + `rightsAttested: true`.

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
| `analyze` | `{ action, nodeType, prompt?, provider?, style?, aspectRatio?, duration?, llmModel?, reasoningEffort?, advancedMode?, temperature?, maxTokens?, nodeContext?, userPreference? }` | `{ jobId, questions }` |
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

A preset may carry `promptPrefix` / `promptSuffix`; the MCP generation verbs wrap
the caller's prompt with them when `presetId` is passed (see
[Prompt pre & post text](./prompt-pre-post-text.md)).

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

## Voice, Voice Changer Pro & media endpoints

Everything the voice stack exposes is plain REST under `/v1/` — the same
async-job contract as the rest of the platform: `POST` returns `{ jobId }`,
poll `GET /v1/jobs/:id/status` (or batch, [§13](#13-job-batch-polling))
until `status` is `completed`, read the result from `output_data`.

### Voices & clones

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/voices` | Premade voice catalog (name, `voice_id`, gender/accent/age metadata). |
| `GET` | `/v1/voices/library` | Search the shared Voice Library (`?search=`, `?gender=`, `?language=`, … `?page=`, `?page_size=`). |
| `GET` | `/v1/voice-clones` | List your voice clones. |
| `POST` | `/v1/voice-clones` | Clone from an uploaded **file** (multipart: `name` field + `file` part, ≤10 MB). |
| `POST` | `/v1/voice-clones/from-url` | Clone from an already-uploaded sample URL (`{ name, audioUrl }`). |
| `PATCH` | `/v1/voice-clones/:id` | Rename / edit a clone. |
| `DELETE` | `/v1/voice-clones/:id` | Delete a clone. |
| `POST` | `/v1/voice-design` | Design a synthetic voice from a description (`{ text, voiceDescription, model?, loudness?, guidanceScale?, seed?, quality?, shouldEnhance? }`) → job. |
| `POST` | `/v1/voice-remix` | Speak a text in a described voice, no cloning (`{ text, voiceDescription }`) → job. |
| `POST` | `/v1/dubbing` | Translate-and-revoice (`{ audioUrl, targetLanguage, sourceLanguage?, numSpeakers?, disableVoiceCloning?, dropBackgroundAudio? }`) → job. |

The id to use everywhere a voice is accepted is the clone's
`elevenlabsVoiceId` (create/list responses) or the catalog's `voice_id`.

### Voice Changer & Voice Changer Pro

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/voice-changer` | Single-voice re-voicing of an audio track or a talking video (`{ voiceId, audioUrl? \| videoUrl?, model?, stability?, similarityBoost?, style?, useSpeakerBoost?, seed?, removeBackgroundNoise? }`) → job. |
| `POST` | `/v1/voice-changer-pro` | Multi-speaker recast (**Cloud; self-host runs it through the [nodaro.ai connection](./community-cloud-connect.md)**): `orderedVoices` maps detected speaker N to entry N (string id, per-voice settings object, or `null` keep-slot). `output: "video"` (default) renders the finished result; `output: "stems"` returns dry per-track stems for an interactive mix. Pass a prior `analysis` to skip re-detection. → job. |
| `POST` | `/v1/voice-changer-pro/analyze` | Detect the speakers WITHOUT recasting (**Cloud only** — the interactive analyze/mix/export flow is not relayed to self-host yet): separates voice from music once and diarizes, returning `speakers` (id, segments, first-appearance, word count, snippet), detected language, and the persisted stem urls. `suggestTitle: true` adds an LLM title. → job. |
| `POST` | `/v1/voice-changer-pro/export` | Render the final video from a mixed track set (**Cloud only**): `{ videoUrl, tracks: [{ url, gain 0–200, muted, kind?: "voice"\|"background" }] (≤16), voiceFx? }`. The video stream is copied, never re-encoded; at least one track must be un-muted. → job. |

Credits: recast charges per **mapped** speaker; analyze and export are
flat-priced (see the [Voice Changer Pro node page](./nodes/ai-audio/voice-changer-pro.md)
for the formula). Off Cloud, the three `voice-changer-pro*` routes are absent (404).

### Media ingestion

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/download-video` | Import a social video (YouTube/TikTok/Instagram/X/Facebook) into storage (`{ url, maxHeight?, sectionStartSec?, sectionEndSec? }`). Returns `{ downloadId }` — not a job. |
| `GET` | `/v1/download-video/progress/:downloadId` | Live progress as **server-sent events** (`{ phase, percent, videoUrl?, error? }` every ~500ms; stream ends on `completed`/`failed`). |
| `POST` | `/v1/video-metadata` | Probe duration/dimensions/title without downloading (`{ url }`). Direct read, not a job. |
| `POST` | `/v1/trim-video` | Trim a video (`{ videoUrl, startTime?/endTime? \| keepFirstSeconds? \| keepLastSeconds? \| trim*Frames/Seconds }`) → job. |
| `POST` | `/v1/trim-audio` | Trim/extract audio (`{ videoUrl? \| audioUrl?, startTime?, endTime?, audioFormat?: mp3\|wav\|aac }`) → job. |
| `POST` | `/v1/still-to-video` | One still image + one audio track → MP4, local FFmpeg, **0 credits** (`{ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? }`; output duration = the audio's duration, no duration field) → job. |
| `POST` | `/v1/slideshow` | 2–100 images + one optional audio track → MP4 slideshow, local FFmpeg, **0 credits** (`{ imageUrls[], audioUrl?, imageDurations?[] (null=auto), perImageDuration?, transition?, transitionDuration?, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? }`; with audio the duration IS the audio's — pinned-row mismatches scale proportionally, disclosed in output) → job. |
| `POST` | `/v1/save-to-storage` | Server-side copy of an external URL into storage (`{ mediaUrl, filename?, mediaType? }`) → job. |

### Social connections & publishing

Connect flows are popup-based and meant for the web app; publishing is available to personal tokens (OAuth apps are deliberately blocked from managing connections).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/social/providers` | Registry of supported networks with per-deployment availability: `{ id, label, connectKind, editor, capabilities, available, missingEnv?, setupHint? }`. Unconfigured networks are listed with `available: false` — never hidden. |
| `GET` | `/v1/social/auth-url?platform=` | Start an OAuth connect (popup URL). `400 provider_not_configured` (with the missing env var names) when the deployment lacks that network's app credentials. |
| `GET` | `/v1/social/callback/:platform` | OAuth redirect target (public). For Facebook/Instagram logins managing multiple Pages/accounts, responds with an **account picker** page instead of silently connecting the first account. |
| `POST` | `/v1/social/connect/finalize` | Completes an account-picker selection (`{ token, accountId }`; the one-time token authorizes the call — public route, popup-internal). |
| `GET` | `/v1/social/connections` | List the caller's connected accounts. |
| `DELETE` | `/v1/social/connections/:id` | Disconnect an account. |
| `POST` | `/v1/social/telegram/connect` | Connect Telegram by pasting a bot token (`{ botToken }`). |
| `POST` | `/v1/social/connect/custom` | Connect a `custom_fields` network (`{ platform, fields }`) — Bluesky, Dev.to, Hashnode, Medium, WordPress, Lemmy. Field specs come from `GET /v1/social/providers` (`customFields`); the credential is validated against the network before saving. |
| `POST` | `/v1/social/publish` | Publish now (`{ platform, action, connectionId?, caption?, mediaUrl? \| mediaItems?, … }`) → job. 10 credits. Retry semantics differ by failure: `503 publish_retryable` means nothing was posted and the identical request is safe to re-send, while `500 publish_failed` means the outcome is unknown — re-sending it can duplicate the post. |
| `POST` | `/v1/social/scheduled-posts` | Schedule a publish (`{ connectionId, action, scheduledAt, caption?, media?: [{type, r2Key \| url}], … }`). Media must be assets hosted on this deployment (stable refs — resolved to fresh URLs at publish time; foreign URLs are rejected). 1 credit, charged at publish. |
| `GET` | `/v1/social/scheduled-posts?from=&to=&status=` | List the caller's scheduled posts (calendar range). |
| `PATCH` | `/v1/social/scheduled-posts/:id` | Edit while still `queued`/`draft` (`409 not_editable` once publishing). |
| `DELETE` | `/v1/social/scheduled-posts/:id` | Cancel a queued post (soft — history retained). |

### Audio primitives

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/audio-separation` | Demucs stems (`{ audioUrl, mode?: vocal_instrumental\|stems, quality?: auto\|fast\|best }`) → job. |
| `POST` | `/v1/audio-isolation` | Voice isolation / denoise (`{ audioUrl }`) → job. |
| `POST` | `/v1/audio-fx` | Reverb/echo/telephone/megaphone (`{ audioUrl, preset?, mix?, delayMs?, decay?, eqLow?, eqHigh? }`) → job. |
| `POST` | `/v1/mix-audio` | Sum 2–20 tracks (`{ audioUrls, trackVolumes? }`) → job. |
| `POST` | `/v1/adjust-volume` | Level/normalize/fade (`{ audioUrl? \| videoUrl?, volume?, normalize?, fadeIn?, fadeOut? }`) → job. |
| `POST` | `/v1/combine-audio` | Concatenate segments (`{ segments: [{ url, startTime?, endTime? }] }`) → job. |

### Worked example: recast a multi-speaker interview end-to-end

The interactive Voice Changer Pro flow — ingest → detect → recast to stems →
mix → export — over plain REST. (One-shot recast is the same second call with
`output` omitted and no prior analyze.)

```bash
BASE=https://app.nodaro.ai
AUTH="Authorization: Bearer $NODARO_ACCESS_TOKEN"

# 0. Ingest: import the interview from YouTube (or skip if you have a URL)
DL=$(curl -s -X POST $BASE/v1/download-video -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/XXXX","maxHeight":720}' | jq -r .downloadId)
curl -sN $BASE/v1/download-video/progress/$DL -H "$AUTH"   # SSE until phase=completed → videoUrl
VIDEO=…                                                     # the completed event's videoUrl

# 1. Detect the speakers (charges the flat analyze price; recast not yet committed)
JOB=$(curl -s -X POST $BASE/v1/voice-changer-pro/analyze -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"videoUrl\":\"$VIDEO\",\"suggestTitle\":true}" | jq -r .jobId)
# poll until completed, then keep the whole output_data as the analysis fast-path
ANALYSIS=$(curl -s "$BASE/v1/jobs/$JOB/status" -H "$AUTH" | jq .data.output_data)
echo $ANALYSIS | jq '.speakers[] | {id, firstStartSec, wordCount, snippet}'   # pick voices per speaker

# 2. Recast to dry stems, reusing the analysis (no re-detection, re-recast as often as needed)
JOB=$(curl -s -X POST $BASE/v1/voice-changer-pro -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"videoUrl\":\"$VIDEO\",\"orderedVoices\":[\"Rachel\",null,\"Aria\"],
       \"output\":\"stems\",\"analysis\":$ANALYSIS}" | jq -r .jobId)
STEMS=$(curl -s "$BASE/v1/jobs/$JOB/status" -H "$AUTH" | jq .data.output_data)  # per-track stem urls

# 3. Mix in your UI (levels / mutes / fx are free to iterate), then render once
curl -s -X POST $BASE/v1/voice-changer-pro/export -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"videoUrl\": \"$VIDEO\",
  \"tracks\": [
    { \"url\": \"<voice stem 0>\", \"gain\": 100, \"muted\": false },
    { \"url\": \"<voice stem 1>\", \"gain\": 90,  \"muted\": false },
    { \"url\": \"<background stem>\", \"gain\": 70, \"muted\": false, \"kind\": \"background\" }
  ],
  \"voiceFx\": { \"preset\": \"hall\", \"wetDryMix\": 25 }
}"   # → { jobId }; the completed job's output_data.videoUrl is the finished video
```

The same chain is one method per step in the SDK
(`client.voices.analyze` → `client.voices.recast({ output: "stems", analysis })`
→ `client.voices.exportMix`) and one command per step in the CLI
(`nodaro voice analyze` → `voice recast --output stems --analysis-file` →
`voice export` — see the [CLI reference](./cli.md)).

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

Reserves **1,500 credits** and submits a training to Replicate. Requires the
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

The credit identifier becomes `flux-lora-character` (**20 cr**). Multi-character
mentions fall back to the selected provider + ref injection.

## Cine shots — share → remix records

Small persisted records of a builder state (picker selections, prompts, chosen
models, entity refs) behind an opaque short id, powering `/s/:id` share links
and one-click remixing.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/shots` | Bearer | Create; body carries `mode`, `selectionState` (verbatim `{ pickerNodeType → valueId \| { field: valueId } }`), optional `freeText` / `negativePrompt` / `assembledPrompt` / `perModelPrompts` / `models` / `entityRefs` / `resultUrls`, and `visibility` (**default `private`**). Returns `{ id }`. |
| `GET /v1/shots/:id` | **public** | Read for the share page / remix hydration. The id is the capability; private shots return 404 to everyone but their owner. Rate-limited per IP. |
| `PATCH /v1/shots/:id` | owner | Update any subset — including flipping `visibility` to `public` (the explicit "make shareable" action). |
| `DELETE /v1/shots/:id` | owner | Delete. |

Rules: `resultUrls` accept only plain public http(s) URLs (signed URLs are
rejected — their tokens must not leak into a shareable record). Records carry
`schemaVersion`; hydrators should skip-with-note on ids referencing catalog
entries that no longer exist rather than fail the remix.

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
