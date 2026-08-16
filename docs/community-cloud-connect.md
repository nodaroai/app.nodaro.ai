# Connect your self-hosted instance to Nodaro Cloud

> **Cloud-side switch.** Nodaro Cloud accepts self-hosted registrations
> only while its `COMMUNITY_CONNECT_ENABLED` flag is on — live on
> `app.nodaro.ai` since 2026-08-16. If it is ever off, your instance's
> **Connect nodaro.ai** button says so in place
> (`cloud_connect_unavailable`) and your own provider keys keep working;
> nothing about your install is broken.

Self-hosted community instances can connect to Nodaro Cloud and use it as a
**provider in your provider list** — the same way you'd connect ElevenLabs
or KIE. You keep your own provider keys for anything you already run
locally; the Nodaro connection adds:

- **One-click start, no credit card.** Connecting signs you into (or
  creates) a Nodaro Cloud account. New accounts receive the standard
  one-time 1,500-credit signup grant. Free-account outputs are
  watermarked; the first credit purchase lifts the watermark and unlocks
  every model. Connected-instance usage has **no daily spending cap**.
- **Standard models without wrangling keys** — image and video generation,
  speech and the LLM lanes route through your Nodaro balance.
- **Nodaro-exclusive capabilities** — cloud-only models run through the
  connection and bill only that usage.

**The vendor-direct nodes are covered too.** AI Avatar / Cinematic Avatar
(HeyGen), Relight & Switch (Beeble) and Web Scrape (Apify) do not go through
the model router — their handlers call the vendor. On a connected install with
no key for that vendor, the worker replays the job on your nodaro.ai account's
identical route, brings the finished media back into your own storage, and
finalizes it as a local job (`providers/nodaro/run-on-cloud.ts`); the HeyGen
avatar/voice pickers list the cloud's catalog the same way. Billed to the
connected account like any other cloud model. Paste your own key for any of
them and that vendor is called directly instead — local keys win.

**The text (LLM) nodes work the same way, standalone or inside a workflow.**
Generate Text, AI Writer, Choose Best (AI judge), Image to Text, QA Check,
Prompt Helper, Motion Graphics / Lottie / 3D Title and the picker analyzers do
not go through the model router either — each route calls the LLM directly.
With no LLM key (KIE, Anthropic or Gemini) and a live connection, the route
forwards the same request to your nodaro.ai account's identical route
(`lib/cloud-llm-proxy.ts`), then records the finished answer as a job in your
own database (`viaNodaroCloud: true`, the cloud's id kept as `cloudJobId`) —
so the job shows in your execution history and the `jobId` you get back is
one your instance can resolve. Identifiers that only mean something on your
instance (`workflowId`, `nodeId`) never leave it. Any local LLM key switches
the route back to your own provider — local keys win.

## How to connect

1. In your instance: **/setup → step 2 → Connect nodaro.ai** (or
   **Integrations → Nodaro Cloud → Connect**). Two accounts are involved and
   only two: your **server login** (lives in your own database) and your
   **nodaro.ai account** (created or signed into on the consent screen).
2. Your browser opens the Nodaro Cloud consent screen — sign in (or sign
   up) and approve. The instance registers itself with its own OAuth
   credential; the requested scopes are exactly what generation needs
   (`assets:write workflows:execute jobs:read credits:read`).
3. You land back on your instance with the connection active. The card
   shows your live cloud balance. The connection is **per instance**, not
   per user — whoever clicks Connect binds the whole install to their
   nodaro.ai account.
4. Generation through the Nodaro provider is picked up on the next start
   of the app container (`docker compose … restart nodaro`); until then
   the first job that finds no provider re-checks the connection on its
   own, so a Run right after connecting also works.

The instance's credential is stored server-side only — it never reaches
your browser.

If the button reports that nodaro.ai is not accepting connections or cannot
be reached, that is the cloud side or your network — your own provider keys
(`KIE_API_KEY`, `REPLICATE_API_TOKEN`, …) work independently of it.

## Or: an API key, like any other provider

nodaro.ai is also a provider in the ordinary sense — the same tile on
`/setup` → Install health as KIE.ai or Replicate. If you would rather not
run the OAuth flow (headless installs, infra-as-code, or you already keep
keys in `.env`), create a personal API token on app.nodaro.ai → **Settings →
API** and set:

```bash
NODARO_API_KEY=ndr_...
```

Restart the app container. Generation routes through your nodaro.ai
account exactly as with the connection, billed to the account that owns the
token, alongside whatever other keys you set (local keys are preferred per
capability; nodaro.ai fills the rest).

Differences from the OAuth connection: an API key is a personal credential —
there is no per-instance monthly spend cap and the instance does not appear
under **Connected Instances**; revoke it from Settings → API. If both an API
key and an OAuth connection exist, the OAuth connection is used.

## Managing connected instances (cloud side)

On app.nodaro.ai → Billing → **Connected Instances**, the account owner
sees every connected instance with its spend this month, and can:

- set a **monthly spend cap** per instance (auto-saved; the instance gets
  `402 instance_cap_reached` past it), and
- **Disconnect** an instance — its tokens die immediately.

## Configuration reference

| Where | Variable | Meaning |
|---|---|---|
| Instance | `NODARO_CLOUD_URL` | Cloud host to connect to (default `https://app.nodaro.ai`) |
| Instance | `NODARO_API_KEY` | Personal API token from app.nodaro.ai → Settings → API — nodaro.ai as a plain provider, no OAuth flow. The OAuth connection wins if both exist. |
| Instance | `PUBLIC_URL` | Your instance's public URL — used for the OAuth callback |
| Cloud | `COMMUNITY_CONNECT_ENABLED` | Master flag for instance registrations + the Connected Instances surface |

Disconnecting from the instance only forgets the local credential; revoke
from the cloud's Connected Instances page to kill access outright.
