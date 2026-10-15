# Webhooks — Nodaro tells your server when a job ends

Register an https endpoint and Nodaro POSTs it every time one of your jobs
ends — `job.completed` or `job.failed` — instead of your app polling
`GET /v1/jobs/{id}`. Each request is signed with the endpoint's own secret,
retried with backoff until your server answers, and recorded in the
endpoint's delivery log.

This page is about webhooks Nodaro **sends**. To have an external system
start a workflow, see the Webhook Trigger in
[API Integration § 6](./api-integration.md#6-webhooks-push-into-nodaro); to
POST from inside a workflow, see the
[Webhook Output](./nodes/output/webhook-output.md) node.

## Quick start

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const client = createClient({ baseUrl: "https://app.nodaro.ai", auth: new StaticTokenAuth(process.env.NODARO_TOKEN!) })

const { data: endpoint, secret } = await client.webhooks.create({
  url: "https://example.com/nodaro-webhook",
  description: "order fulfilment",
})
// `secret` (whsec_…) is shown this once: store it with your server's config.

await client.webhooks.test(endpoint.id) // a `ping`, sent within seconds
```

The receiving side — any framework that gives you the raw request body:

```ts
import express from "express"
import { verifyWebhookSignature, WebhookSignatureError } from "@nodaro/sdk"

const app = express()

app.post("/nodaro-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await verifyWebhookSignature({
      payload: req.body, // the raw bytes, never re-serialized JSON
      header: req.headers["nodaro-signature"],
      secret: process.env.NODARO_WEBHOOK_SECRET!,
    })
    if (event.type === "job.completed") {
      await saveResult(event.data.job.id, event.data.job.output_data)
    }
    res.sendStatus(204) // any 2xx within 10 seconds = delivered
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.status(400).send(err.code)
    throw err
  }
})
```

From the terminal: `nodaro webhooks create --url https://example.com/nodaro-webhook`
prints the secret once; `nodaro webhooks test <id> --wait` shows how your
server answered. See [CLI](./cli.md).

## Events

| Event | Sent when |
|-------|-----------|
| `job.completed` | A job of yours reached `completed`. A job held for review (`pending_review`) is still in flight: its event is sent when it is approved. |
| `job.failed` | A job of yours reached `failed`. |
| `ping` | Only from `POST /v1/webhook-endpoints/{id}/test`. Never subscribed to. |

Every job in your jobs list counts — a single generation, and each node's
job inside a workflow run. A cancelled job sends nothing, and neither do the
statuses on the way (`pending`, `processing`). A job that changes ending
(fails, and is completed later) sends one event for each. The jobs inside a
Component node's run or a use-case node's run are not in your jobs list and
send nothing: the node that started the run reports for it. An endpoint
subscribes to both job events unless `events` says otherwise.

## The request

`POST` to your URL, `Content-Type: application/json`, with these headers:

| Header | Value |
|--------|-------|
| `Nodaro-Signature` | `t=<unix seconds>,v1=<hex>` (one `v1=` per secret while a rotation's grace lasts) — see [Verifying the signature](#verifying-the-signature) |
| `Nodaro-Event` | `job.completed`, `job.failed` or `ping` |
| `Nodaro-Delivery` | The delivery id — the same on every retry of this event |
| `Nodaro-Webhook` | The endpoint id |
| `Nodaro-Attempt` | `1` for the first attempt, then `2`, `3`, … |
| `User-Agent` | `Nodaro-Webhooks/1` |

Only the timestamp and the body are signed. The other headers are there for
your logs: route and de-duplicate on the verified body's `type` and `id`,
never on `Nodaro-Event` or `Nodaro-Delivery`.

The body:

```json
{
  "id": "6f1d0c0e-1c7e-4d0a-9f2b-0a4e2f7b9c11",
  "type": "job.completed",
  "createdAt": "2026-10-15T10:00:04.512Z",
  "data": {
    "job": {
      "id": "0b9a…",
      "status": "completed",
      "progress": 100,
      "job_type": "generate-image",
      "input_data": { "type": "generate-image", "prompt": "a lighthouse at dusk" },
      "output_data": { "imageUrl": "https://…/images/0b9a….png" },
      "error_message": null,
      "error_hint": null,
      "credits": 40,
      "credit_status": "committed",
      "credits_charged": 40,
      "source": "sdk",
      "source_detail": "sdk/2.28.0",
      "session_id": null,
      "user_id": "…",
      "created_at": "…",
      "started_at": "…",
      "completed_at": "…"
    }
  }
}
```

- `id` is the delivery id (also `Nodaro-Delivery`): unique per event per
  endpoint and the same on every retry, so de-duplicate on it — this one, in
  the signed body.
- `createdAt` is when the job reached this status.
- `data.job` is the job in the same shape `GET /v1/jobs/{id}` returns (the
  SDK's `Job` type, `jobs.get()`), as it was when the first attempt was sent:
  retries send that same body, byte for byte. (One exception: if Nodaro is
  cut off between sending an attempt and recording how it went, the next
  attempt builds the body again from the job as it is then — same `id`.)
  `credits_charged` can still be `null` (with `credit_status: "reserved"`)
  if the charge had not settled yet; read the job again for the final figure.
- An event is at most 64 KB, always. When a job's data is larger,
  `input_data` is left out, then `output_data`, and `data.omitted` lists
  what was left out: `GET /v1/jobs/{id}` has the whole job. Should a text
  field still be very long after that (an unusually long error message), it
  is cut to about 2 KB, ending in `…`.
- A `ping` carries `"data": { "webhookId": "<endpoint id>" }`.

## Verifying the signature

`Nodaro-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is the
HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint's whole secret
(`whsec_…`, as UTF-8). Check three things: the signature matches the exact
bytes you received, the timestamp is recent (5 minutes is the default
tolerance — it stops a captured request being replayed later), and you have
not already handled this `id`. During a secret rotation's grace the header
carries a `v1=` for each secret (the new one first); accept the request when
any of them matches.

With the SDK — Web Crypto only, so it runs in Node 20+, Deno, Bun,
Cloudflare Workers, Vercel Edge and browsers:

```ts
const event = await verifyWebhookSignature({ payload: rawBody, header, secret, toleranceSeconds: 300 })
```

It returns the parsed event, or throws a `WebhookSignatureError` whose `code`
is `missing_header`, `malformed_header`, `signature_mismatch`,
`timestamp_outside_tolerance`, `invalid_payload`, `missing_secret` or
`crypto_unavailable`. A header may carry more than one `v1=` (one is enough
to match); unknown schemes are ignored. `toleranceSeconds` must be a finite
number, 0 or more (0 turns the timestamp check off — not recommended):
anything else throws a `RangeError`.

By hand, in Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto"

// rawBody: the request body as received (a Buffer or a string).
function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const pairs = header.split(",").map((part) => part.trim().split("=", 2))
  const t = pairs.find(([key]) => key === "t")?.[1]
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest()
  const matches = pairs.some(([key, value]) => {
    if (key !== "v1") return false
    const got = Buffer.from(value, "hex")
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
  return matches && Math.abs(Date.now() / 1000 - Number(t)) <= toleranceSeconds
}
```

In Python:

```python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    pairs = [p.split("=", 1) for p in header.split(",") if "=" in p]
    t = next(v for k, v in pairs if k == "t")
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    ok = any(hmac.compare_digest(v, expected) for k, v in pairs if k == "v1")
    return ok and abs(time.time() - int(t)) <= tolerance
```

The delivery log keeps the exact body of a delivery that has not succeeded
(`requestBody`), so a failing check can be reproduced byte for byte.

## Delivery and retries

Any 2xx within 10 seconds counts as delivered. Anything else — a 3xx
(redirects are not followed), a 4xx, a 5xx, a timeout, an address that does
not answer — fails the attempt, and the delivery is tried again:

| After attempt | Next attempt in |
|---------------|-----------------|
| 1 | 30 seconds |
| 2 | 2 minutes |
| 3 | 10 minutes |
| 4 | 1 hour |
| 5 | 6 hours |
| 6 | 12 hours |
| 7 | 24 hours |

Each wait varies by up to 10% either way. After the 8th attempt (about 43
hours after the first) the delivery fails for good. A test `ping` is tried
once.

Delivery is **at least once**: a retry can arrive after your server already
handled the first attempt (it answered too late, say), so de-duplicate on the
delivery `id`. Deliveries are sent side by side — up to 5 at a time to one
endpoint and 10 for one account — so events can arrive out of order: use
`createdAt`, and the job's own `status`, rather than arrival order. However
long another account's queue, it does not hold up yours.

**When your server does not answer at all.** Five attempts in a row with no
HTTP answer (a timeout, a refused connection, an address that does not
resolve to a public one) rest the endpoint for a minute — twice as long each
time it happens again, an hour at most. Meanwhile its deliveries wait
together, their attempts unspent, and a test ping still goes. Any HTTP
answer, even an error status, ends the rest.

**A problem on Nodaro's side** (a job that could not be read, a signing
secret that could not be opened) is not counted against you: the delivery
waits a few minutes and is tried again, the attempt not spent, and it never
moves the endpoint towards an automatic switch-off. Its log entry says
`signing_unavailable` or `job_unreadable` meanwhile.

**Automatic switch-off.** When 50 deliveries in a row fail for good, the
endpoint is switched off: `isActive: false`, `disabledReason:
"consecutive_failures"`. Fix the receiver, check it with a test ping, then
switch the endpoint on again (`PATCH … { "isActive": true }`, which also
resets the count). A success resets the count too.

**While an endpoint is switched off** (by you or by the platform) no events
are recorded for it, and deliveries already waiting are dropped: they end
`failed` with `error: "endpoint_disabled"`. A test ping is still sent. An
endpoint a connected app registered stops the same way when you revoke the
app's access: what was waiting ends `failed` with `error: "app_revoked"`.

## The delivery log

`GET /v1/webhook-endpoints/{id}/deliveries` (SDK `webhooks.deliveries(id)`,
CLI `nodaro webhooks deliveries <id>`) lists the endpoint's deliveries,
newest first, 20 a page by default (up to 100), filterable by `status`
(`pending`, `delivered`, `failed`). Each one carries its `event`, `jobId`,
`status`, `attempts`, the receiver's last `responseStatus` and the first
2 KB of its `responseBody`, `durationMs`, `error`, `nextAttemptAt` for a
pending one, and `requestBody` — the exact body sent, kept while the
delivery is pending or after it failed (`null` once delivered). The log is
kept 30 days.

`GET /v1/webhook-endpoints/{id}/deliveries/{deliveryId}` (SDK
`webhooks.getDelivery(id, deliveryId)`) reads one delivery — the ping `test`
queued, say — however many others the log has since.

`error` is one of: `http_<status>`, `timeout`, `blocked_address` (the
address does not resolve to a public internet address — it does not resolve
at all, or to a private one, or it is this server's own; refused before
connecting), `connection_refused`, `connection_reset`, `tls_error`,
`network_error`, `endpoint_disabled`, `app_revoked`, `job_deleted` (the job
was deleted before it could be sent), `attempts_exhausted` (the last attempt
was cut off on Nodaro's side before its answer was recorded),
`signing_unavailable` or `job_unreadable` (a problem on Nodaro's side; the
delivery waits and is tried again, its attempts unspent).

## Managing endpoints

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/v1/webhook-endpoints` | Register `{ url, events?, description? }` → `201 { data, secret }`. The secret is in this response only. |
| `GET` | `/v1/webhook-endpoints` | Your endpoints, newest first. Never a secret. |
| `GET` | `/v1/webhook-endpoints/{id}` | One endpoint. |
| `PATCH` | `/v1/webhook-endpoints/{id}` | Change `url`, `events`, `description` (`null` clears it) or `isActive`. |
| `DELETE` | `/v1/webhook-endpoints/{id}` | The endpoint and its delivery log; deliveries waiting for it are not sent. |
| `POST` | `/v1/webhook-endpoints/{id}/rotate-secret` | A new secret → `{ secret, previousSecretExpiresAt }`, in this response only. It signs every delivery from then on, retries included; the secret it replaces keeps signing beside it (a second `v1=`) for `gracePeriodSeconds` — a day by default, at most 7 days — so you can update your receiver without a gap. `{ "gracePeriodSeconds": 0 }` ends the old secret at once (one that leaked). |
| `GET` | `/v1/webhook-endpoints/{id}/deliveries` | The delivery log (`?status=&limit=&cursor=`) → `{ data, next }`. |
| `GET` | `/v1/webhook-endpoints/{id}/deliveries/{deliveryId}` | One delivery → `{ data }`. |
| `POST` | `/v1/webhook-endpoints/{id}/test` | Queue a `ping` → `202 { data: <delivery> }`. |

An endpoint:

```json
{
  "id": "…",
  "url": "https://example.com/nodaro-webhook",
  "description": "order fulfilment",
  "events": ["job.completed", "job.failed"],
  "isActive": true,
  "disabledReason": null,
  "disabledAt": null,
  "consecutiveFailures": 0,
  "appId": null,
  "secretCreatedAt": "2026-10-15T10:00:00Z",
  "previousSecretExpiresAt": null,
  "createdAt": "2026-10-15T10:00:00Z",
  "updatedAt": "2026-10-15T10:00:00Z"
}
```

`previousSecretExpiresAt` is set after a rotation, while the replaced secret
still signs.

Errors use the usual envelope ([API Integration § 8](./api-integration.md#8-error-envelope)):
`400 validation_error` (a bad address or body), `400 limit_reached` (the
11th endpoint), `401`, `403 insufficient_scope`, `404 not_found` (an id that
is not one of yours), `409 url_taken` (you already have an endpoint for this
address), `409 url_invalid` (an endpoint whose stored address the rules no
longer accept: change its `url` before switching it on or testing it),
`409 secret_required` (an endpoint registered before signing existed: rotate
its secret before switching it on or testing it),
`503 encryption_key_missing` (a self-hosted install with no
`NODARO_ENCRYPTION_KEY`, see [Deployment](./deployment.md)) and
`503 not_available`.

## Rules and limits

- **https on a public host only.** Not `http://`, not `localhost`, not a
  private, loopback or link-local address, not a name that only means
  something inside a private network (a single label like `intranet`, or one
  ending in `.internal`, `.local`, `.lan`, `.home.arpa`, `.corp`, …), not
  this Nodaro server's own address, no user name or password in the URL, no
  control characters. The address is stored normalized (lower-case host, no
  default port). It is resolved again on every attempt, and a name that
  resolves to a private address is refused then (`blocked_address`). To
  receive on your own machine, use a tunnel (ngrok, cloudflared) and
  register its https address.
- **One endpoint per address.** Registering the same address twice is
  `409 url_taken`: subscribe one endpoint to both events instead.
- **10 endpoints per account** (on Nodaro Cloud, counted separately on each
  Nodaro environment you use).
- **Writes are rate-limited**: 30 a minute (create, update, delete,
  rotate-secret) and 10 test pings a minute.
- **Who can manage them**: a signed-in session, a personal API token, or a
  connected (OAuth) app's token with the `jobs:read` scope. A personal token
  limited to some workflows cannot.
- **An endpoint a connected app registers** (`appId` set) receives only the
  jobs that app submitted itself, and only while your grant to that app is in
  place and includes `jobs:read`. Jobs of a workflow run the app started are
  run by Nodaro's workflow engine and are not included — follow the run with
  `GET /v1/workflow-executions/{id}`. The app sees and manages only the
  endpoints it registered; you see and can delete all of them.
- **The secret** (`whsec_` + 43 characters) is stored encrypted, never in
  plain text, and is returned only by create and rotate-secret.
- **Self-hosted installs** send from their own server and need
  `NODARO_ENCRYPTION_KEY` (the compose stack generates it). An endpoint
  belongs to the install (`RUNTIME_ENV`) that created it: renaming
  `RUNTIME_ENV` hides endpoints created under the old name.
- **Not available over MCP**: registering an endpoint returns its signing
  secret once and sets up account-wide delivery of job events to a server —
  an app or CLI action, not one for an AI agent.
