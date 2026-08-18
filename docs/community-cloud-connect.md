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
- **Nodaro-exclusive capabilities** — the [Nodaro-exclusive
  nodes](#the-nodaro-exclusive-nodes) run through the connection and bill
  only that usage.

How much of your generation the connection carries is **your choice** — see
[Choose how nodaro.ai is used](#choose-how-nodaroai-is-used).

**The vendor-direct nodes are covered too.** AI Avatar / Cinematic Avatar
(HeyGen), Relight & Switch (Beeble) and Web Scrape (Apify) do not go through
the model router — their handlers call the vendor. On a connected install with
no key for that vendor, the worker replays the job on your nodaro.ai account's
identical route, brings the finished media back into your own storage, and
finalizes it as a local job (`providers/nodaro/run-on-cloud.ts`); the HeyGen
avatar/voice pickers list the cloud's catalog the same way. Billed to the
connected account like any other cloud model. Paste your own key for any of
them and that vendor is called directly instead — your own vendor key always
wins on these vendor-direct lanes, whatever the routing choice below says.

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
instance (`workflowId`, `nodeId`) never leave it. With a local LLM key the
route follows your [routing choice](#choose-how-nodaroai-is-used): under
**nodaro first** the proxy keeps serving these, under **my keys first** (and
on installs connected before the choice existed) your own key wins.

## How to connect

1. In your instance: **/setup → step 2 → Connect nodaro.ai** (or
   **Integrations → Nodaro Cloud → Connect**). Two accounts are involved and
   only two: your **server login** (lives in your own database) and your
   **nodaro.ai account** (created or signed into on the consent screen).
2. Your browser opens the Nodaro Cloud consent screen — sign in (or sign
   up) and approve. The instance registers itself with its own OAuth
   credential; the requested scopes are exactly what generation needs
   (`assets:write workflows:execute jobs:read credits:read`).
   If that browser is already signed in to nodaro.ai, the screen names the
   account it is about to connect — this is a **cloud** account, unrelated
   to the operator login you created for the instance itself. Click **Use
   a different account** to connect a different one.
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

If it reports **too many unfinished connection attempts from this address in
the last 24 hours**: each click on Connect registers this instance with the
cloud, and registrations nobody consented to expire after a day. Ten of those
from one address in a day and the cloud pauses that address. Finish the
consent window you already opened, or wait it out — pasting your own provider
key works meanwhile. Connect / Disconnect / Connect on the same instance does
not count against it: the instance keeps its registration across a
disconnect and reuses it.

## Choose how nodaro.ai is used

Right after a connection is made — the OAuth Connect **or** pasting an API
key — a dialog asks how the credential should participate in routing. Closing
the dialog without choosing applies the pre-selected defaults. Change it any
time from **Integrations → nodaro.ai → Change**.

- **nodaro for everything** *(pre-selected)* — every capability the
  connection covers routes through nodaro.ai, billed to the connected
  account. Inside it, who wins when you ALSO have your own provider keys:
  - **nodaro first** *(pre-selected)* — your other provider keys are
    ignored for the capabilities nodaro.ai serves; everything is billed to
    your nodaro.ai account.
  - **My keys first** — your own providers (KIE, Replicate, …) serve what
    they can; nodaro.ai fills the gaps. This is exactly how connections
    behaved before this choice existed.
- **Only the Nodaro-exclusive nodes** — the [exclusive
  nodes](#the-nodaro-exclusive-nodes) run through the connection;
  everything else behaves as if the credential did not exist.

Two deliberate bounds, so the choice never surprises you:

- **Installs connected before this dialog existed keep their old routing**
  (everything + my-keys-first) until they open the dialog — routing is never
  changed silently under an active install.
- **"nodaro first" applies to the model router.** The vendor-direct nodes
  (HeyGen avatars, Beeble relight, Apify web-scrape) still call the vendor
  directly whenever you have that vendor's key, and local processing
  (ffmpeg-family nodes) always runs locally.

## Managing provider keys (disable · replace · remove)

Every provider tile on **/setup → Install health** (and Integrations) can be
managed at runtime — including keys that came from `.env`:

- **Keys pasted in the app** show as "key set (app)" — **Change** or
  **Remove** them any time. This includes a pasted nodaro.ai API key.
- **Keys from `.env`** are read-only by nature, but the tile offers
  **Replace .env key** (an app-layer key that overrides the environment
  one without a rebuild) and **Disable** (the provider stops serving until
  re-enabled — useful when you want generation to fall to a different
  provider, e.g. from KIE to your nodaro.ai connection).
- Changes apply live — no container restart needed.

## The Nodaro-exclusive nodes

Five nodes are implemented only by Nodaro Cloud: **Generate Video Pro**,
**Edit Video Pro**, **Voice Changer Pro**, **Video Analysis** and **AI
Audit**. On a self-hosted install they appear in the editor wearing a
**NODARO** mark and run through your nodaro.ai connection — full parity with
the cloud, including Generate Video Pro's Stop & keep / Continue and Video
Analysis's probe.

- **Not connected?** The nodes still appear; the node card shows a
  **Connect nodaro.ai** CTA, and a run answers
  `503 nodaro_connection_required` with the same instruction instead of
  failing cryptically. Workflows containing them always save — the gate is
  at run time, never at save time.
- **Billing** happens on the connected nodaro.ai account. On the OAuth
  lane, per-instance monthly caps from Connected Instances apply. On the
  personal API-key lane the account is used as itself: free-tier accounts
  keep their standard limits and watermark until a first purchase, and
  there is no per-instance cap.
- The Story → Video generative pipeline remains Cloud-only (it is an
  interactive engine, not a relayable node).

## Or: an API key, like any other provider

nodaro.ai is also a provider in the ordinary sense — the same tile on
`/setup` → Install health as KIE.ai or Replicate. If you would rather not
run the OAuth flow, create a personal API token on app.nodaro.ai →
**Settings → API** and **paste it on the nodaro.ai tile** — it applies
live (no restart), shows as "key set (app)", and can be changed or removed
like any other pasted key. The same
[routing-choice dialog](#choose-how-nodaroai-is-used) opens after the paste.

Headless installs and infra-as-code can set it in the environment instead:

```bash
NODARO_API_KEY=ndr_...
```

and restart the app container. Either way, generation routes through your
nodaro.ai account, billed to the account that owns the token, per your
routing choice.

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

Disconnecting from the instance only forgets the local access token — the
instance keeps its cloud registration so the next Connect reuses it; revoke
from the cloud's Connected Instances page to kill access outright.
