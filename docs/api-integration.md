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
2. Go to **Settings → API**. On a deployment-payer instance (one where a
   single billing account funds every user) that card is not shown in
   Settings — open `/settings/api` directly by URL, signed in as the
   billing account.
3. Click **Create token**.
4. Fill in:
   - **Name** — a label for your records (e.g. `prod-scheduler`).
   - **Rate limit** — requests per minute, default `30`, max `120`.

   A token made here can run any workflow you own. To limit one to
   specific workflows, see
   [Tokens limited to some workflows](#tokens-limited-to-some-workflows).
5. Save. The full token is shown **once**. It will look like:

   ```
   ndr_<64 hex characters>
   ```

   Copy it into your secret store immediately. Nodaro only stores a
   SHA-256 hash, so if you lose it you must mint a new one.

You can have up to **10 tokens** per account, active or not — a
deactivated token still counts; delete it to free the slot. The eleventh
create is refused with `400 limit_reached`. Edit name, workflow scope,
rate limit, or active flag at any time. Deleting a token revokes it
instantly.

A personal token never expires and carries no spend cap: it lives until
you deactivate or delete it, and it is not re-checked against your
sign-in provider — a token minted before an account was removed from the
identity provider keeps working until it is revoked. Treat it as a
permanent credential and store it accordingly.

**On a deployment-payer instance** — where one billing account funds
every user — only the billing account can create a token
(`403 api_tokens_payer_only` for anyone else), every call the token makes
debits the deployment's pool, and the token can never administer that
pool: balance reads made as the billing account answer
`403 payer_balance_jwt_only` ([§3](#3-public-api-endpoints)) and the
billing account's own routes (`/v1/deployment-billing/*`) answer
`403 payer_required` — those need the billing account's browser session.

Backend reference: `POST /v1/api-tokens` (JWT-authenticated, body
`{ name, workflowIds[], rateLimit }`). See `backend/src/routes/api-tokens.ts`.

<a id="tokens-limited-to-some-workflows"></a>**Tokens limited to some
workflows.** Send `workflowIds` (up to 50 workflows of your personal space)
when you create a token with `POST /v1/api-tokens`, or later with
`PATCH /v1/api-tokens/:id`, from a signed-in session. An edit applies within
a minute at most. Such a token is for running those workflows. It
can run them, read them and their inputs, and follow their runs, and nothing
else:

- `GET /v1/api/workflows`, `GET /v1/workflows` and
  `GET /v1/projects/:projectId/workflows` list only those workflows, and
  `GET /v1/executions` lists only their runs.
- `GET /v1/api/schema`, `POST /v1/api/run`, `GET /v1/workflows/:id`,
  `GET /v1/workflows/:id/interface`, `POST /v1/workflows/:id/run`,
  `POST /v1/workflows/:id/render-final/estimate` and
  `GET /v1/workflows/:id/executions` answer for those workflows only.
- `GET /v1/api/status/:execId`, `GET /v1/api/result/:execId` and
  `GET /v1/workflow-executions/:id` (with `/stream` and `/cancel`) answer for
  runs of those workflows only. A run that is not yours answers `404`.
- Routes that need no sign-in at all (the public gallery, the model and node
  catalogs) answer as they would without a token.

Every other request answers `403 forbidden` ("This API key is limited to
specific workflows, and this request is outside them. Use a key without a
workflow limit for anything else."). That covers another workflow or its runs,
editing or deleting a workflow, the direct generation routes, uploads, jobs,
published apps, MCP, and use as a relay credential (below). It is refused
before anything runs, so nothing is reserved or billed. A token with no
`workflowIds` is the account's full-access token.

**Using a token to run a self-hosted or local instance on a hosted one.**
A personal token (one without a workflow limit) is also the simplest relay credential: on the
self-hosted instance set `NODARO_CLOUD_URL` to the hosted instance and
`NODARO_API_KEY` to the token, and every generation runs on the hosted
engine and is billed to the token's account. No OAuth connection is
needed for this path. On a deployment-payer instance the billing account
is the one that creates that token. Details in
[Connect your instance to Nodaro Cloud](./community-cloud-connect.md#or-an-api-key-like-any-other-provider).

## 3. Public API endpoints

Personal API tokens (`Authorization: Bearer ndr_…`) authenticate every
authenticated route in the backend, including the published-app endpoints
under `/v1/app/:slug/*` (see the [Embed App Guide](./embed-app-guide.md))
and the per-feature routes (jobs, workflows, projects, etc.). A token limited
to some workflows reaches only the routes listed under
[Tokens limited to some workflows](#tokens-limited-to-some-workflows).

A few surfaces are deliberately app-only and reject API tokens and OAuth
app tokens with `403 in_app_only` — currently the
[Workflow Copilot](./features/workflow-copilot.md) (`/v1/copilot/*`),
the admin panel's message-a-user send, and the stored HTTP credentials
behind Webhook Output (`/v1/http-credentials`, below). They exist for the
Nodaro web app's own session, not as an integration surface. To build
workflows programmatically, use MCP or the SDK.

### HTTP credentials (Webhook Output)

A Webhook Output node can send with a stored credential — a header name and a
secret saved once under Integrations, referenced from the node by id
(`credentialId`). The secret never appears in workflow JSON, an export or a
template, and no response of these routes ever returns it.

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/v1/http-credentials` | List your credentials: `{ id, name, authKind, headerName, boundUrl, boundMatch, createdAt, updatedAt }` — never the secret. |
| `POST`   | `/v1/http-credentials` | Create: `{ name, headerName, secret, boundUrl?, boundMatch? }`. `headerName` is letters / digits / dashes and may not be a framing header (`Host`, `Content-Length`, `Cookie`, …); `secret` is single-line printable ASCII; `boundUrl` is an `https` address on a public host; `boundMatch` is `exact` (default) or `prefix`. |
| `PATCH`  | `/v1/http-credentials/:id` | Rename, rotate the secret, or set / move the lock. Clearing a lock is refused (`409 binding_required`) — delete and recreate instead. |
| `DELETE` | `/v1/http-credentials/:id` | Remove. Nodes that referenced it fail at their next send with a clear message; nothing is ever sent without the key. |

All four are browser-session only (`403 in_app_only` otherwise) and rate
limited per user; a missing instance encryption key answers
`503 encryption_key_missing`. Running a workflow that sends with a credential
works from every lane (editor, API token, MCP, schedule, published app), with
the rules the [Webhook Output](./nodes/output/webhook-output.md) page
describes: the credential is the workflow **owner's**, a plain (unlocked) one
travels only on a run the owner starts in person — a run from the editor, or a
schedule the owner set up in the editor — and a locked one only to its
address. A run started with an API token or an OAuth app token, by a webhook
trigger, by a schedule created through the API, or from a published app does
not count as the owner's own, even though it runs as the owner — for any of
those, lock the credential. Publishing an app or sharing a workflow for run answers
`409 credential_unbound` — with
`details: [{ nodeId, nodeLabel, credentialId, nodeUrl, kind, credentialName, urlMapped? }]`,
where `kind` is `plain` (no lock), `missing` (deleted or not the owner's) or
`mismatch` (locked, but the node's URL is not under the lock), and
`urlMapped: true` marks a node whose URL comes from another node at run time
(`nodeUrl` is empty then; lock the credential to the address it will send
to) — until every credential it sends with, including inside sub-workflows,
is locked to an address the node sends to.

One surface is app-only *conditionally*: on a deployment-payer instance —
where a single billing account funds every user — the credit-balance reads
(`GET /v1/credits/balance`, `GET /v1/user/credits`, `GET /v1/credits/check`)
answer `403 payer_balance_jwt_only` when the caller authenticates **as the
billing account itself** with an API token or an OAuth app token. That pool is
the operator's, readable only from that account's own browser session. Every
other identity, and every instance without a deployment payer, is unaffected.

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
A flat input whose field is a number (an exposed slider, a Lottie number slot)
takes a number or a numeric string: `"0.4"` arrives at the node as `0.4`. A
value that is not a number is passed on unchanged, and the node treats it as it
always has (Text to Speech, for one, ignores it and keeps the voice's own
setting). The field types and slider ranges are what MCP `get_app_inputs`
returns (see [MCP tools](./mcp/tools.md#get_app_inputs)).

An exposed model or quick setting whose choices are a fixed list (the models a
node offers, a Suno model) is held to that list: a value outside it returns
`400 validation_error`, and a number outside a setting's range does too (see
[Model and quick-setting fields](./embed-app-guide.md#model-and-quick-setting-fields)). A `null` in
`inputOverrides` CLEARS that field of the node for the run, so the node's own
default applies; a `null` flat input is dropped, so the saved value applies
(see [Clearing a field](./embed-app-guide.md#clearing-a-field)).

One class of field is refused on every run path (`/v1/app/:slug/run`,
`/v1/workflows/:id/run`, `/v1/present/:token/run`, `/v1/component/execute`,
`/v1/api/run`): a **destination on an outbound node**. Outbound nodes are
Webhook Output, the social publishers, and the fetchers (Web Scrape, Meta Ads,
Instagram Scrape, RSS Feed, Telegram Channel Feed, and the Video URL node). On
those nodes an override may not touch any `*Url` field, `target` / `targets` /
`query` / `channel` / `chatId` / `connectionId` / `credentialId` / `platform` /
`webhook` / `endpoint` / `host` / `privacy`, or the `actor` / `mode` selectors
that decide which destination field a fetcher reads — nested inside an object
or a `fieldMappings` entry included, and whether the value is a new address or
an empty one (blanking a destination makes the node read its upstream text
instead). Where a workflow sends to or fetches from is decided by the workflow
itself, not by a run request; an override that names one is rejected with
`400 locked_field` before anything runs. The error names at most ten offending
fields (and counts the rest); an override nested more than 32 levels deep on
such a node is refused outright. Ordinary fields on those nodes (a caption, a
limit) and media `url` fields on input nodes (uploads, reference audio) stay
overridable.

A second class is refused the same way on every run path: what a
**Sub-workflow** node runs. Its `workflowId`, `selectedRouteId` and
`routeSnapshot`, set directly or through a `fieldMappings` entry, answer
`400 locked_field`. Which workflow a node runs, and which part of it, is
decided by the workflow itself, not by a run request.

On a [UGC video node](#13e-ugc-video-nodes-nodaro-cloud-only), a run can set
only UGC Creator's `source`, `gender` and `photoUrl` and UGC Script's
`targetDurationSec`, on every run path above. Any other key on a UGC node (a
kept result, a script, a clip, a re-render count) is rejected with
`400 locked_field` (`inputOverrides cannot set "<field>" on a UGC node "<id>".`),
so a run request can never hand a UGC node a result of its own.

<a id="ugc-videos-in-a-published-app-or-template"></a>**UGC videos in a published app or template.** Publishing ships every UGC
node empty: no script, clip tickets, takes, cards or Notes, no kept script or
creator (Keep is off), no creator image, and never the author's own photo: a
UGC Creator keeps no `photoUrl`. Two more kinds of node ship emptied with it:
every node whose value can flow into a UGC Creator's photo input, and every
node made from one of those or from a UGC node: the UGC video's own join,
overlay and captions, and anything made from them, from the creator's image or
from the upload that feeds the photo, such as an outro after the captions, an
upscale of the creator's image, or a Preview of the video or of that upload.
Both are read over the workflow and every sub-workflow it references, at any
depth: over every wire, field mapping, teleport's channel and Preview's items,
into a sub-workflow through its input and back out through its output; a Group
holding such a node counts as made from it, and so does what that Group feeds.
A node emptied this way keeps only its settings, its prompt among them. What
its runs left goes (its renders, text, lists and Preview items, a publisher's
post link), and so does a copy of its input that a step keeps, or a plan it
built from it (Manual Edit, After Effects, 3D Title, Composite), and a
Character's, Object's, Creature's or Location's link to the author's own
library entry and its trained LoRA, so a run never loads the author's pictures
in its place; its name stays. So do an earlier render a node keeps under a key
of its own (Paint Mask's source image, Generate Image's refine base). An Upload
Image ships with no image, asset or file name, a Text node without its text,
and a List without its items and rows. A file address in its settings goes
only when it is the author's photo or something made from a UGC run: when it
matches a value held by a node on a creator's photo path, by a node that takes
the photo (a component holding a UGC video, a graph that cannot be read), by a
UGC node, or left by a run of a node made from them. The same address counts
however it is spelled: with or without its scheme, query or fragment, a
default port, an upper-case host, an encoded or doubled-slash path, inside the
platform's image proxy or download link, and on any host of the platform's own
storage; so does the same asset by its address or by its asset id (an address
that names a matching asset's id included), and an address quoted inside a
prompt is cut out of it, the prompt's other words kept. A logo, a Lottie file
or an outro the author set by its address ships and keeps working. A node
whose value can flow into a creator's photo, a node that takes the photo, a UGC
node and a library entity keep no file address or asset id at all — a library
entity made from the video loses even its own library pictures. Anywhere else
in the workflow, a node that holds the author's photo or a UGC render as its
own value (a copy of the photo's upload, a take dropped into an Upload Video)
ships empty too, with what is made from it, and every other node keeps what it
holds but never one of those addresses. An outbound node
made from one of them keeps where it sends (a Webhook Output's address, a
publisher's account), unless its own value can flow into a creator's photo. A
character the workflow defines (its `characterDefinitions` setting) ships
without its reference picture when a node on a creator's photo path draws on
it (a generator's characters, a Scene's), or when the picture is itself one of
those values; the others ship as they are. A node
the runner fills (an app's or a share link's input, a
component's input handle) keeps that role and ships empty too, and a
component's exposed setting on such a node defaults to what the node ships
with.

<a id="a-template-can-include-one-runs-results"></a>**A template can include one run's results.** When you publish a template with
**Include this run's results** (`includeRunResults: true` on
`POST /v1/templates/publish`), a UGC video made in one run with an AI creator
ships its results as an example: the creator's image, the script's spoken
lines, each clip's current take, the finished clips UGC Finish handed on, the
joined, carded and captioned video, and the Notes. Nothing a run reads ships with them (no plan, clip tickets, creator
record or kept creator), and the template's price is the same either way. A
video made from your own photo never ships its results, with or without the
choice; neither does one we cannot trace, step by step, to your own run.
Published apps, components and share links never include results. The kept
files are copies the template holds: deleting your own files later does not
remove them; publishing again without the choice, or deleting the template,
does (a deleted template's copies go 30 days later). The publish answers
`keptResults`: `{ included, reason }`, where `reason` is `not_requested`,
`no_ugc_video`, `no_results`, `photo_run` or `unverified`. A re-publish that
leaves `includeRunResults` out keeps the template's last choice.
`POST /v1/templates/keep-check` with `{ workflowId }` asks the same question
without publishing, and answers `{ shown, eligible, current, reason }`:
`shown` is false for a workflow with no UGC video, and `current` is whether
the template already published from it includes a run.

<a id="a-template-slug"></a>**A template's slug.** `POST /v1/templates/publish` takes an optional
`slug` (up to 50 characters, normalised to lower-case letters, digits and dashes).
A new template gets exactly that slug when no template holds it, active or
inactive; when it is taken (or you lost a race to another publisher for it), the
template gets the slug with a short random suffix instead (`ugc-website-video`
becomes `ugc-website-video-w6rmls`) and the response's `slug` says which you got.
`browse`, `publish`, `keep-check`, `mine`, `favorite` and `favorites` are never
handed out as they are, since those paths are routes of their own. Without a
`slug`, the slug is made from the template's name plus the suffix. Publishing
again from the same workflow always keeps the template's slug, even when you
rename it or send a different `slug` (the `slug` field only matters the first
time), so a link to `GET /v1/templates/:slug` stays good.

A sub-workflow whose workflow holds a UGC node, at any depth, counts as one of
the video's nodes: its stored outputs ship empty, and so does everything made
from it. So does a component whose published version holds one, and what feeds
such a component counts as flowing into a creator's photo. A sub-workflow whose
workflow cannot be read (deleted, not the owner's, nested deeper than a run
goes or in a loop, or past the 200 workflows and components one read takes),
or a component whose published version cannot be found, is read the same way
as one holding a UGC video: its stored outputs and what is made from it ship
empty, and what feeds it counts as flowing into a creator's photo. A publish
that fails to read one of them answers `500` with `internal_error` and writes
nothing; publish again. A run asks once more for a graph that fails to load,
and reads it the same way only if it fails again. A sub-workflow or component
node that names no graph at all is a plain node, unless it holds outputs of
its own. Each run renders them fresh. Every other node keeps
its results, as in any app. The listed price is the price of what ships, which
is what its runners run: with Keep off, a UGC video's script and creator are in
it, at the length setting. The listed price is a range: the price at the saved settings
(`estimatedCredits`, with `perMinuteCredits` / `perItemCredits`) is "from", and
`maxEstimatedCredits` / `maxPerMinuteCredits` / `maxPerItemCredits` (a template:
`maxEstimatedCredits` / `maxEstimatedPerMinuteCredits`) are "up to" — the most a
run can cost over the choices its user has: every exposed field, at the
publisher's restricted values (`allowedValues`) where set, each model's own
options, and a reference clip the user supplies at its longest. Up to 256
combinations are priced one by one; past that, each other field is taken at its
priciest value for each model. The `max*` fields appear on the browse, detail and
app-page responses only when they differ from "from"; a version published before
the range existed carries none until it is republished or backfilled. A preview picked automatically for an app or a
template is read from what ships, so it is never one of those renders (a
template that includes its run starts from that run's captioned video), nor
the author's photo or anything on its path. A
preview the author chooses ships exactly as chosen, whatever it shows (a UGC
render, their own photo or something made from it included): an app's
thumbnail node, a template's thumbnail (Set as Thumbnail), or the preview sent
with the publish. A template's thumbnail is the author's pick only when they set
it: a cloned template and a remixed app start with no thumbnail, and a
workflow cloned earlier whose thumbnail is still the source template's preview
takes the automatic preview instead. A preview set later
(`previewMediaUrl` on `PATCH /v1/apps/:appId` or `PATCH /v1/templates/:templateId`)
is stored as the author sends it. An app's link card on other sites (its
`og:image`) shows the app's icon when it has one, else that preview. A run of
a published app or component
(whoever runs it, its author included) and a share-link viewer's run load
every sub-workflow they reach the same way, at every depth, with the
workflow's character definitions shipped as above. A workflow read by link
(`GET /v1/public/workflows/:id`) or copied from a shared production gives
anyone but its owner a UGC video the same way too. Anyone the workflow itself
is shared with — a member of its workspace, or someone it is shared with
directly — who opens it (`GET /v1/workflows/:id`), exports it
(`GET /v1/workflows/:id/export`, MCP `export_workflow` or `get_workflow_json`)
or runs it (`POST /v1/workflows/:id/run`) reads and runs the live graph, as
its owner does.

An app whose UGC Creator is set to **My photo** needs the runner's own photo. A
run of it that gives none is refused with
`400 { "error": { "code": "ugc_photo_required", "message": "This app needs a photo of you. Add one, then run it again." } }`
before anything is written, priced or billed. The runner's photo is the
creator's `photoUrl` in the run's inputs, or an image the run's inputs give a
node whose image can reach that creator's photo input: an Upload Image's
image, a List's rows, a sub-workflow input port that takes an image (or one
that states no kind, given a file address). Text is never the photo: a Text
node's text, a picker's choice or a value on a port that takes text gives
none, even where it hands an Upload Image its link. Nothing the workflow holds
counts: the author's own image never ships in the graph a run receives. A node that makes the image in the
run from nothing that brings it an image, such as a generator prompted by a
Text node, gives the runner's photo from a value the runner gives a node that
sets it up; one that is also handed an image gives it only through that image.
A **My photo** creator inside a sub-workflow the run executes (one that is not
frozen), at any depth, is asked the same: the run's inputs reach it only
through a node of the run's own graph whose image flows into it, through the
sub-workflow's input. So is a component whose published version holds a
**My photo** creator: the run's inputs must give an image to a node whose image
reaches the component.

A presentation share link treats a UGC video the same way. `GET /v1/present/:token`
gives anyone but the workflow's owner the graph as published: its UGC nodes,
every node whose value can flow into a UGC Creator's photo input, and every
node made from either (a sub-workflow or a component holding a UGC video among
them), emptied as publishing empties them; the price it shows is that graph's.
A viewer's run (`POST /v1/present/:token/run`) runs that graph, and every
sub-workflow it reaches loaded the same way: nothing made from the owner's UGC
runs, and no photo of theirs, is handed on. A viewer's run of a UGC Creator set
to **My photo**, in the workflow or in a sub-workflow the run executes, that
gives no photo of the viewer's own is refused with the same
`400 ugc_photo_required`, before anything is written or billed. The owner's own
run through the link is theirs, as in the editor.

A published component is stripped the same way. Its caller gives its UGC
Creator a photo as the creator's `photoUrl` in `inputOverrides`, or as an image
given to a node whose image can reach the creator's photo input, such as an
Upload Image or a sub-workflow input port that takes an image, that the
component takes as an input handle (a handle that takes text gives no photo, a
creator's own input handle sets its source, never a photo, and an upload that
holds only the author's image ships empty).
`POST /v1/component/execute` refuses a run of a **My photo** creator, in the
component or in a sub-workflow it executes, that gives none, with the same
`400 ugc_photo_required`, before the component's job exists.

<a id="runs-that-would-stop-for-a-review"></a>**Runs that would stop for a review.** *Rolled out under a flag* (`PREVIEW_STOP_RULE_ENABLED`, see [Apply EDL](./nodes/processing-video/apply-edl.md#a-run-stops-at-a-preview)): where it is off, none of these runs is refused. Studio, Voice and any other client besides the editor and an app's own page count as nobody to review, and get the message below as is. A workflow whose [Apply EDL](./nodes/processing-video/apply-edl.md#a-run-stops-at-a-preview) render is set to **Preview** (`quality: "proxy"`) stops at that preview for a person to review, and only a person in the editor (whose runs send `"reviewer": "editor"`) or on a published app's page (whose runs send `"reviewer": "app"` to `/v1/app/:slug/run`, with a signed-in session token, not `headless`; see [Render final of an app run](#render-final-of-an-app-run)) can. Every other run path has nobody to review it, so a run that would execute a render set to Preview is refused before anything runs or is billed: `/v1/workflows/:id/run` called with an API token, an OAuth app token, from MCP, or with a signed-in session token from anywhere but the editor (the SDK's `supabaseAuth`, for one), `/v1/api/run`, `/v1/present/:token/run` and `/v1/app/:slug/run` without the app page's mark (the SDK's `apps.run`, the CLI, MCP `run_app`) answer `400` with `{ "error": { "code": "preview_review_required", "message": "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. Open it there to run it, or set the render to Final (or send a Final quality override for it)." } }`. To run it anyway, override the render to Final for that run: `"inputOverrides": { "<render node id>": { "quality": "final" } }` on `/v1/workflows/:id/run`, or `"inputs": { "<render node id or label>": { "quality": "final" } }` on `/v1/api/run`. A webhook fire answers the same `400`; schedule and Telegram fires are skipped. Each trigger lane leaves one failed execution with `error_message: "preview_review_required"` in the workflow's history (repeated fires do not add more). A run whose sub-workflow or component holds a render set to Preview is refused with `preview_render_nested` — a nested graph cannot stop for a review — and `POST /v1/apps/publish` refuses to publish such a component (`400 preview_render_nested`). When the server's own check refuses a run that was already accepted, the execution ends `failed` with the code as its `error_message`. A [Tighten Episode](./nodes/processing-video/tighten-episode.md#review-before-render) node with **Review before render** on stops a run the same way and is refused on the same paths: the `400` keeps the code above, and its message names that node's remedy (turn Review before render off) instead of the render's. The code a refused run records — a failed execution's `error_message`, a trigger's history entry, a sub-workflow node's error — also says what held it: `preview_review_required_review_on` / `preview_render_nested_review_on` when only such nodes hold the run, `preview_review_required_mixed` / `preview_render_nested_mixed` when a render at Preview and such a node both do; a render alone keeps `preview_review_required` / `preview_render_nested`, as every earlier refusal does. Treat all six as one refusal: `isPreviewRefusalCode(code)` from `@nodaro/shared` matches each. Where the flag is off, a run holding such a node is not refused up front: the nodes before it run and are charged, and the node then fails with `preview_review_required` and the same message (nothing is charged for it); in an editor or app-page run, the nodes after it run on its preview and run again at its Render final, as after a render at Preview. Whatever the flag, a review-on Tighten Episode fed by a List (one run per item) is refused before any of its runs starts: the node fails with `use_case_review_list_driven`.

<a id="continuing-a-run"></a>**Continuing a run (`continueFromExecutionId`).** `POST /v1/workflows/:id/run` can continue an earlier execution instead of starting over: send `"continueFromExecutionId": "<execution id>"` together with `nodeIds`. The run executes only `nodeIds`. Every other node hands on what that execution produced — its outputs as the execution recorded them — never the workflow's saved results in their place, so the inputs that run used (an upload, an app input) are used again, and nothing upstream runs or is billed again. A node that execution did not run either (one it was told to skip, or one outside its own `nodeIds`) handed on its saved results there, and hands on the same here: every saved result where a node reads a list. An [Edit Plan](./nodes/processing-video/edit-plan.md) hands on the plan that execution made, with your current review of it applied — also when that execution was itself a continuation or a partial run that applied an earlier review; a review made on another plan is ignored. A node the earlier execution did not complete hands on nothing, and does not run again: a node of the run that reads it gets no value from it, and a node whose every input comes from such nodes is skipped (with the nodes after it) instead of running on nothing. Render final after a run that stopped at its preview is one:

```json
{
  "nodeIds": ["<render node id>", "<every node after it>"],
  "inputOverrides": { "<render node id>": { "quality": "final" } },
  "continueFromExecutionId": "<the run that stopped at the preview>"
}
```

`inputOverrides` are meant for the nodes the run executes, such as the render's Final quality above. The `inputOverrides` the earlier execution ran with are recorded on it when it starts, and a continuation applies them again: a node the run executes reads the workflow as it is now, with the earlier run's `inputOverrides` and the ones you send over them — yours win, field by field (a field you do not send keeps the earlier run's value). They are the ones that run applied, so nothing changed since reaches the continuation. An execution that started before the server recorded them has none recorded: its continuation applies only the `inputOverrides` you send. A render the run does not execute is read by what the earlier execution rendered: when that was a Preview and a node the run executes would consume it, the [stop rule above](#runs-that-would-stop-for-a-review) applies — a run from the editor stops there, and any other run is refused with `preview_review_required` (checked once the run starts, so the execution ends `failed` with that code). The earlier execution must be one you started, of this workflow, of the workflow itself (not of a published app version), and it must have ended `completed` (`failed`, when [continuing a failed run](#continuing-a-failed-run)). Otherwise the request is refused before any execution exists:

| Status | `error.code` | When |
|---|---|---|
| `400` | `continuation_subset_required` | `nodeIds` is missing or empty (without `continueMode`) |
| `409` | `continuation_subset_required` | with `"continueMode": "from-failed"`: every node that run was to run completed — nothing is left to continue |
| `404` | `continuation_not_found` | no such execution, or it is not yours |
| `400` | `continuation_workflow_mismatch` | it ran another workflow |
| `400` | `continuation_version_mismatch` | it ran a published app version of the workflow (continue a failed app run with the app's [Retry](#retry-of-a-failed-app-run)) |
| `409` | `continuation_not_completed` | it is still running, or it failed or was cancelled |
| `409` | `continuation_not_failed` | with `"continueMode": "from-failed"`, or when continuing a Tighten Episode or Chapters run from where it failed (`POST /v1/tighten-episode/continue` or `POST /v1/episode-chapters/continue`, `"mode": "from-failed"`): that run did not fail |
| `409` | `continuation_superseded` | with `"continueMode": "from-failed"`, or on the Tighten Episode or Chapters continue route with `"mode": "from-failed"`: a later continuation of that run failed — continue that one instead. On `/run`, also a later continuation that completed everything the run left (`supersededBy.status: "completed"`): the work is done, and its results are on that execution. On `/run` only the newest later continuation counts: when it completed only part of what was left, the run is built on it instead (see below). `/run` names it in `executionId` and `supersededBy: { executionId, status }` (and in the message); the continue routes in `jobId` |
| `409` | `continuation_preview_pending` | only on `/run`, with `"continueMode": "from-failed"`: the newest later continuation of that run completed by stopping at a [Preview review](#runs-that-would-stop-for-a-review) — of an Apply EDL render, or of a [Tighten Episode](./nodes/processing-video/tighten-episode.md#review-before-render) with Review before render on — so continuing again would stop at the same Preview. The answer names that execution in `executionId`, its renders in `renderNodeIds` and its Tighten Episode nodes in `reviewNodeIds` (and in the message), and the run that finishes them in `next`: `{ "continueFromExecutionId", "nodeIds", "inputOverrides" }`, to send as the body of `POST /v1/workflows/:id/run` (see below). With one render and nothing else, that run is the render's [Render final](#render-final) — `"renderFinal": { "renderNodeId": "<the render>" }` with `"continueFromExecutionId": "<executionId>"` does the same |
| `402` | `insufficient_credits` | any continuation — a run of `nodeIds`, a [Render final](#render-final), a `next` below, or a [continue-from-failed](#continuing-a-failed-run): the payer's credits cannot cover the nodes the run executes, priced on the graph it executes as a Render final's quote is (`required`, and `available` unless a deployment's operator pays). A continue-from-failed is priced on what it still runs: a node the failed run completed is handed on, never priced. A Tighten Episode or Chapters node that will continue its failed attempt (see below) is priced at what that continuation charges — the steps the attempt did not complete and its fee — and one that will run again from the start, or whose inputs are not known before the run starts (a node before it that this run executes hands them on), at a whole run. A retry with the same `Idempotency-Key` as a request that already started its run answers that run (`200`, `deduped: true`), never this refusal. Balance only: a model your plan cannot use, or a daily limit, is still refused by that node when the run reaches it |
| `409` | `continuation_settling` | only on the Tighten Episode or Chapters continue route (`POST /v1/tighten-episode/continue` or `POST /v1/episode-chapters/continue`): that run failed a moment ago and is still being settled — try again in a moment |
| `409` | `already_running` | on the Tighten Episode or Chapters continue route: a continuation of that run is already under way (its `jobId` is in the answer) — wait for it. With `"mode": "render-final"`, only a Render final still in progress blocks another: once one has completed, the same preview can be rendered final again (after a further edit, say) — the final steps run and are charged again, still with no use-case fee. (On `/run`, a run of this workflow you still have under way — a continuation included — answers `409 already_running` with its `executionId`.) |
| `409` | `render_final_already_rendered` | only on the Tighten Episode or Chapters continue route, with `"mode": "render-final"`: a Render final of that preview with this very edit (or with no edit, again) has already completed — nothing would change, so nothing runs. The answer names that final (`jobId`); its result is the one to use. A changed edit renders again |

<a id="continuing-a-failed-run"></a>**Continuing a failed run (`"continueMode": "from-failed"`).** A run of a saved workflow that failed can be continued from where it stopped, keeping what it completed: send `"continueFromExecutionId": "<the run that failed>"` with `"continueMode": "from-failed"`. `nodeIds` is optional: the nodes to consider, every node of the workflow when left out. The run executes only the nodes among them that the failed run did not complete — the node that failed, the ones it held back, the ones it never reached — and every node it completed hands on its output as above, never run or charged again. What is kept is kept per node: a node that failed runs again in full, so one that failed partway through a list runs every item of it again, those it had finished included (a few nodes recognise an identical item they already made and reuse it). A [Tighten Episode](./nodes/processing-video/tighten-episode.md#if-a-run-fails) or Chapters node that failed is the exception: it continues its own run from the step that failed (the steps it finished are not run or charged again, and its fee is charged once: the failed attempt's was refunded, and the continuation holds it again) — but only when its recording, its music bed (Tighten Episode) and its settings are exactly the ones that attempt ran with. A setting added to the node since that attempt ran counts as unchanged while it holds its default. When any of them differs — an `inputOverrides` you send changes a setting, or a node before it ran again on a corrected recording, in this run or in a later continuation the run is built on — it runs again from the start on what it has now, and that run's fee is the one charged. This holds whether the run is a continue-from-failed or a run of named nodes. A node you name whose upstream that run did not complete either runs with that upstream: the nodes it needs are added to the run, and a named id that is no node of the workflow is ignored (a list of nothing but such ids is a `400 validation_error`; an empty list reads as left out). Everything else is the continuation above: your own run of this workflow (not of a published app version: continue an app's run in the app), the inputs it ran with applied again, the same [Preview review](#runs-that-would-stop-for-a-review) of the nodes the run executes. It cannot be combined with `renderFinal` (`400 validation_error`), and `continueMode` without `continueFromExecutionId` is a `400 validation_error` too. It is checked against the payer's credits before it starts, as every continuation is: one its payer cannot cover — priced on the nodes it still runs, a Tighten Episode or Chapters node that continues its attempt at that attempt's steps left and its fee — is refused with `402 insufficient_credits` and no execution is created (see the table above). A continuation that runs only nodes that cost nothing is never refused for credits.

```json
{
  "continueFromExecutionId": "<the run that failed>",
  "continueMode": "from-failed"
}
```

A continuation's results hold everything the runs before it completed, so the newest continuation of a run holds all of its progress, and a continuation is always decided by that newest one: the most recently created continuation of the run (or of any continuation of it) that has started and ended, failed or completed. Continuing from an older run would only run (and charge) again what that newest one already did, so:

- When the newest **failed**, continuing any other run of the chain is refused with `409 continuation_superseded`, naming it in `executionId` and `supersededBy: { executionId, status: "failed" }`: continue that one instead.
- When the newest **completed everything** that was left, continuing is refused the same way with `status: "completed"`: the work is done and its results are on that execution, so there is nothing to continue.
- When the newest **stopped at a [Preview review](#runs-that-would-stop-for-a-review)** — of an Apply EDL render, or of a [Tighten Episode](./nodes/processing-video/tighten-episode.md#review-before-render) with Review before render on (it completed with the Preview made and what follows it not run) — continuing again would only stop at the same Preview, so it is refused with `409 continuation_preview_pending`, naming that execution in `executionId`, its renders in `renderNodeIds` and its Tighten Episode nodes in `reviewNodeIds`. The next step is the run the answer names in `next`: send `next` as the body of `POST /v1/workflows/:id/run`. It continues that execution, runs each held render at Final and each held Tighten Episode continuing the run that made its Preview (its final, with no Tighten Episode fee), then every node after them, and nothing before them. With a single render, `next` is that render's [Render final](#render-final), so `"renderFinal": { "renderNodeId": "<render>" }` with `"continueFromExecutionId": "<that execution>"` is the same run, with the same credit check before it starts. A node after the holds that previews of its own (a second render set to Preview, a Tighten Episode with Review before render on) makes `next` a run that stops for a review again, so from the API it is refused `preview_review_required`, as any such run is. With two or more renders, finish them in that one run: `renderFinal` takes one render, and when two Previews feed the same node, the Render final of either runs that node on the other's Preview, so it is held again (and refused `preview_review_required` from the API). A Tighten Episode has no `renderFinal` on `/run`. Its own continue route (`POST /v1/tighten-episode/continue` with `"mode": "render-final"`) renders the episode but runs none of the workflow's nodes after it, so the chain stays held; and once that final has completed, the same final in `next` is refused `render_final_already_rendered`.
- When the newest **completed only part** of what was left otherwise — it was sent a narrower `nodeIds` — continuing the run that failed builds on it: the run is seeded from that continuation (the failed run's completed nodes and its own), applies the inputs it ran with, and runs only what is still left — nothing it completed is run or charged again. Of several such continuations, the newest is the one built on.

A **Render final**, or a run of named nodes (`nodeIds` with `continueFromExecutionId`, no `continueMode`), that continues the **newest** continuation of the chain becomes part of the chain too, so the rules above see it. It counts as having completed everything that was left when the continuation it continues had, or when it runs every node of work that continuation did not complete — and, either way, only when it stops at no Preview and leaves none of that continuation's Previews waiting. So the Render final of a continuation whose only stop was its Preview finishes the chain (continuing the failed run is then refused as done, naming the Render final), and one that leaves anything is built on. A Preview it does not run stays waiting on it: a run of another branch of a continuation held at a Preview is itself held at that Preview, and continuing the failed run is refused with `continuation_preview_pending` naming the newer run, whose `next` finishes it. One that continues an older continuation of the chain stays outside it, so the newest still holds all the progress. So does a Render final that continues no execution: after one, continuing the failed run still answers `continuation_preview_pending`: send its `next` to finish the chain (the render and the nodes after it then run, and are charged, again). The editor's [Render final](./nodes/processing-video/apply-edl.md#render-final) continues the run whose Preview it renders — the server run the render's take came from, when that run is a completed run of this workflow and every node feeding the final (by a wire, a Group, or a field mapping) still holds on the canvas what that run hands on: the very take, text or data (a Transcribe's transcript, on the output it is wired from) that run recorded, the same plan for an Edit Plan (the server re-applies the saved review), or the value it read for an input — sending the same `nodeIds` and `inputOverrides` with that run's `continueFromExecutionId`, so it joins the chain like an API Render final. The one exception is the run a `continuation_preview_pending` answer names, when its only hold is one render: the editor's Render final of that render continues it whatever the canvas shows, so the chain is finished (a node feeding the final that was edited since reads that run's value). Where it cannot (the Preview was rendered by the render's own ▶ in the browser, which makes no execution, or the run cannot be read), it is a plain run of the render and the nodes after it, outside the chain. The editor's **Continue from failed** sends `continueMode: "from-failed"` for your newest run of the open workflow when it failed (see [Run results on the canvas](./features/run-results.md#continuing-a-run-that-failed)).

The `202` answer of a continue-from-failed names the execution it continued from in `continuedFrom`: the run you sent, or the newer continuation it was built on. A continuation that was cancelled does not count, and one still under way is `409 already_running`. A continuation refused before it started (by the Preview review, say) holds nothing and does not count either: continuing it is refused, naming the newest continuation that failed or completed everything of its run (or, when the newest stopped at a Preview, with `continuation_preview_pending` as above), or else a run that failed — the run it continued, or for a Render final or a run of named nodes, the chain's first run. Two continuations sent at the same moment can both start — send an `Idempotency-Key` header (at least 8 characters) with each, so a retry of the same request starts nothing new: it answers `200` with the run already started and `deduped: true`, or, once that run is under way or has superseded the one it continued, the `409` naming it. The SDK sends this as `client.workflows.run(id, { continueFromExecutionId, continueMode: "from-failed" }, { idempotencyKey })`, the CLI as `nodaro workflows run <id> --continue-from <executionId> --from-failed --idempotency-key <key>`, and MCP clients as `run_workflow` with `continue_from_execution_id` and `from_failed: true` (the same key is its `client_request_id`, reused when retrying). A `next` is sent as is: `client.workflows.run(id, error.next)` in the SDK, `nodaro workflows run <id> --next '<the next JSON>'` in the CLI (which prints that command, or the `nodaro workflows render-final` of a single held render, when a continue-from-failed is refused with `continuation_preview_pending`), and `run_workflow` with `continue_from_execution_id`, `node_ids` and `inputs` (its `nodeIds` and `inputOverrides`) over MCP.

<a id="render-final"></a>**Render final (`renderFinal`).** Instead of assembling a Render final yourself, name the render and let the server work it out: send `"renderFinal": { "renderNodeId": "<render node id>" }` with `continueFromExecutionId` (the run that stopped at the preview) on `POST /v1/workflows/:id/run`, and nothing else — no `nodeIds`, no `inputOverrides`. The server runs what the editor's [Render final](./nodes/processing-video/apply-edl.md#render-final) runs: the [Apply EDL](./nodes/processing-video/apply-edl.md) render at Final for this run only, and every node after it (directly, through a teleport, a Group or a field mapping); with Camera Switch between the Edit Plan and the render, Camera Switch runs again first. The Edit Plan does not run again. The run is then a continuation as above, with the same checks.

```json
{
  "renderFinal": { "renderNodeId": "<render node id>" },
  "continueFromExecutionId": "<the run that stopped at the preview>"
}
```

Quote it first with `POST /v1/workflows/:id/render-final/estimate` and `{ "renderNodeId": "…", "continueFromExecutionId": "…" }`. It creates and charges nothing, and answers `200 { "data": { "renderNodeId", "nodeIds", "inputOverrides", "estimatedCredits", "sufficient", "available" } }`: the nodes the run executes, the override it runs with (`{ "<render node id>": { "quality": "final" } }`) and its estimated credits, priced on the graph the run executes (the earlier run's recorded `inputOverrides` with the render's Final over them); `sufficient` says whether the payer's credits cover them, and `available` is the payer's spendable credits (`null` when a workspace budget pays, or when a deployment's operator pays — that balance is not shown). All three figures are `null` in an edition without credits. It refuses with the continuation codes above, and both refuse:

| Status | `error.code` | When |
|---|---|---|
| `400` | `render_final_node_not_found` | the workflow has no node with that id |
| `400` | `render_final_not_a_render` | the node is not an Apply EDL render |
| `400` | `validation_error` | `renderFinal` sent with `nodeIds` or `inputOverrides`, or without `continueFromExecutionId` |

The run is checked against the payer's credits before it starts, on the figure the quote shows: one its payer cannot cover is refused with `402 { "error": { "code": "insufficient_credits", "message", "required", "available" } }` and no execution is created (`available` is left out when a deployment's operator pays). The check is the balance only; a model your plan cannot use, or a daily limit, is still refused by that node when the run reaches it. A workspace budget's headroom is checked as each node reserves.

The run is the authority on every other refusal (`preview_review_required` when another render after this one still reads Preview (`quality: "proxy"`) — under the `PREVIEW_STOP_RULE_ENABLED` flag, as [above](#runs-that-would-stop-for-a-review); a run already going).
| `400` | `validation_error` | `continueFromExecutionId` is not an execution id |

<a id="render-final-of-an-app-run"></a>**Render final of an app run.** *Rolled out under a flag* (`PREVIEW_STOP_RULE_ENABLED`): where it is off, apps run as before (no run stops at a preview), and this route re-renders the render you name at Final, then every node after it — on any render of a completed run, whatever its take, as the editor's Render final does with the flag off; the Preview-only refusals below do not apply. The app's page offers it on a render whose take is a Preview whatever the flag, as the editor's node does. A run of a published app started from the app's page (`"reviewer": "app"`, above) whose render is set to **Preview** (`quality: "proxy"`) stops at the preview like an editor run: the render's take is a Preview, and the nodes after it are `skipped` and not billed. `POST /v1/app/:slug/runs/:runId/render-final` with `{ "renderNodeId": "<render node id>" }` renders that run's final: a continuation of the run's execution (as above) that runs the render at Final for that run only, then every node after it, once — the server decides which nodes run; nothing before the render runs or is billed again. It answers `202 { "executionId", "runId", "status": "pending" }`; an `Idempotency-Key` header of 8 characters or more makes a retry of the same request answer `200` with `"deduped": true` and start nothing. The final is charged to the runner at the nodes' own prices, as a second execution OUTSIDE the app run: the creator's fee on the app does not apply, it adds no row to the run history and does not count toward the app's daily run limit, and like an app run it draws on the runner's app credits. An Edit Plan review the runner stored on the run (`nodeStates: { "<plan id>": { "editedEdl": … } }` through `PATCH /v1/app/:slug/runs/:runId`) is applied to the final. Once the final has results, `GET /v1/app/:slug/runs/:runId` (and the run list) shows them in `execution.nodeStates` over the preview's — a node the final completed replaces the run's own state of it — and carries the final as `finalExecution: { id, status, completedNodes, totalNodes, errorMessage, completedAt, creditsUsed }` (`null` when none was asked for); the run's `creditsUsed` stays the app run's own. A second render set to **Preview** further on stops the final at its own preview; that render has its own Render final, which continues from the run's NEWEST final (so nothing an earlier final rendered runs or is billed again), one at a time — the run then links the newest as `finalExecution`, and the views lay every final of the chain that completed over the run's states, oldest first. A final that failed or was cancelled is neither shown nor continued, even where it completed its render before a node after it failed: `finalExecution` reports it with its `status` and `errorMessage`, the views show the states under it (its render's Preview again), and the next Render final continues from the newest final that completed — or from the run's own execution when none did. Edits stored on the nodes a final completed are dropped once it has completed, since its results replaced theirs; until then, after a final that failed, and on any node it did not complete, they stay. A state the final completed carries `"fromRenderFinal": true`. A [Tighten Episode](./nodes/processing-video/tighten-episode.md#review-before-render) node with Review before render on is finished the same way, whatever the flag: it holds its own Preview, so name the node itself as `renderNodeId`. The final runs the node and every node after it, once, with the node continuing the run that made its Preview: the episode at Final, with the settings that run was built from and the runner's review of its edit (stored on the run as an Edit Plan's is, `nodeStates: { "<node id>": { "editedEdl": … } }`), then its captions and music bed, and no Tighten Episode fee. (Where the flag is off, the nodes after the node already ran on its Preview in the app run, and run again in the final.) Only a take that is a Preview is finished: a node whose take is Final, or one that ran once per list item, is refused `render_final_not_preview`. Refused before anything is written or billed:

| Status | `error.code` | When |
|---|---|---|
| `400` | `not_a_render` | `renderNodeId` is neither a render node nor a Tighten Episode node of the app |
| `400` | `preview_render_nested` | the app is a component: a nested graph never stops for a review |
| `404` | `not_found` | no such run of yours under this app |
| `409` | `continuation_not_completed` | the run has no execution yet (a draft), or it has not completed |
| `409` | `render_final_not_preview` | with the flag on: the render's take is not a Preview — in the run, or in its newest final (a render set to Final, or one a final already rendered, has no final to render). A Tighten Episode node, whatever the flag: its take is not a Preview, or it ran once per list item |
| `409` | `already_running` | a final of this run is still rendering (its id is in `executionId`) |
| `400` | `preview_review_required` | with the flag on: without the app page's mark, a final that would stop at another Preview further on |
| `402` | `insufficient_app_credits` | the runner's app credits cannot cover a run |
| `503` | `run_finals_unavailable` | the run's earlier finals could not be read just now: try again (nothing was started) |

<a id="retry-of-a-failed-app-run"></a>**Retry of a failed app run.** A run of a published app that failed is continued from where it stopped, not started over: `POST /v1/app/:slug/runs/:runId/resume` (the app page's **Retry**) runs only the steps the run did not complete, and every step it completed hands on its result, as a [continue-from-failed](#continuing-a-run) does. A step that completed runs nothing and is charged nothing again. A [UGC Clip](./nodes/ai-video/ugc-clip.md) that failed renders only the clips it did not finish: the clips it finished are handed back at no cost, because the Retry is the same run going on and names the same run to the clip route. The Retry runs the app version the run ran, with the inputs the run applied; it takes none of its own. That version must still be the one you are on: send `"version": <n>`, the version starting over would run (the app page sends the version picked, else the latest); without it, the app's latest. When the app has changed since the run (a newer version published, or another version picked), a Retry would continue a snapshot you no longer see, so it is refused with `409 app_run_version_changed`, naming `runVersion` and `appVersion`. To continue on the run's own version anyway, send that version. To run with other inputs or on the app's current version, start the run over instead: the ordinary `POST /v1/app/:slug/run` with the run's `runId` runs every step again, and charges for each. The run's execution moves to the Retry's (`GET /v1/app/:slug/runs/:runId` then shows it, with the completed steps from before), so a Retry of a Retry continues from what the latest one completed. A Retry refused before it started holds nothing, and the next Retry continues from what that one continued.

Send `{ "dryRun": true }` (with the same `version`) to learn what a Retry would do without starting anything: `200 { "data": { "runId", "continuesExecutionId", "appVersion", "nodeIds", "steps": [{ "nodeId", "type", "label" }], "estimatedCredits", "reusedClips", "sufficient", "available" } }`. `steps` are the steps that run again, `estimatedCredits` is what the Retry is expected to charge, the creator's fee on the app included (`null` in an edition without credits), and `reusedClips` counts the clips handed back at no cost. A clip counts there only when it is your own finished clip of that very run, checked against your jobs; anything that cannot be checked is priced in full, so the figure may be above what the Retry charges, never below it. `sufficient` says whether your balance covers what the Retry holds while its clips render (each clip at twice its price). The app page always shows this before a Retry starts. Without `dryRun` it answers `202 { "executionId", "runId", "status": "pending", "nodeIds" }`; pressing it twice starts one Retry (the second answers `200` with `"deduped": true`). The Retry is the app run going on, not a run beside it: the creator's fee on the app is settled once, on what the Retry runs (a failed run settles none), and like an app run it draws on the runner's app credits. Refused before anything is written or billed:

| Status | `error.code` | When |
|---|---|---|
| `404` | `not_found` | no such run of yours under this app |
| `404` | `continuation_not_found` | the run's execution is not yours |
| `409` | `app_run_version_unavailable` | the app version the run ran is no longer available: start the run over to run the app's current version |
| `409` | `app_run_version_changed` | the app is on another version than the one the run ran (`version`, else the latest; both are in the answer as `appVersion` and `runVersion`): start the run over to run it |
| `409` | `continuation_not_failed` | the run did not fail (it completed, or it was stopped): start it over to run it again |
| `409` | `already_running` | the run is still running (its execution is in `executionId`), or it was started again elsewhere meanwhile |
| `409` | `continuation_subset_required` | every step of the run completed: there is nothing left to retry |
| `400` | `locked_field` | an input the run applied sets a field the app does not let a runner set |
| `400` | `preview_review_required` | with the preview stop rule on: without the app page's mark, a Retry that would stop at a Preview |
| `402` | `insufficient_app_credits` / `insufficient_credits` | the runner's app credits, or balance, cannot cover the Retry |

Run views carry the runner's own edits of the run's results as `nodeStateEdits`: the one map `PATCH /v1/app/:slug/runs/:runId` sets with `nodeStates`. The PATCH **replaces** that map, so send the whole map — the edits already stored with yours merged in — or the ones you leave out are lost.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/api/workflows` | List workflows your token can run. Supports `?limit=` and `?cursor=` pagination. |
| `GET`  | `/v1/api/schema?workflowId=…` | Inspect a workflow's input fields and output handles before running it. Includes `estimatedCredits`. |
| `POST` | `/v1/api/run` | Execute a workflow. Optionally pass `inputs` to override input-node values. Supports `?wait=true&timeout=…` for sync mode. |
| `GET`  | `/v1/api/status/:execId` | Poll a running execution. Returns `status`, progress counts, credits used and, once completed, `outcome` (see [Runs that find nothing new](#runs-that-find-nothing-new)). |
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

Both forms return the same `data`: for `POST /v1/workflows/:id/move`, and for
a `PATCH` that carries a `projectId`, it is the moved workflow as it now
stands. A mover whose access to it, once moved, is below `edit` (a workspace
admin moving a member's work into a workspace whose `admin_access` is `view`,
or a mover left with no access to it at all) receives it as a `view` reader's
`GET /v1/workflows/:id` shows it: without what a `view` reader does not
receive, listed under [reaching one
workflow](./organizations.md#reaching-one-workflow).

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
`email_unverified` / `account_linked_other_provider` /
`account_linked_other_subject` — linking refused; `account_linked_other_provider`
when the email already belongs to an account linked to a **different** identity
provider, which is never re-stamped; `account_linked_other_subject` — *next
release* — when a same-provider assertion for the deployment's billing account
does not carry the subject that first linked it: that account links on its first
verified assertion regardless of `EXTERNAL_SSO_LINK_EXISTING`, an unverified one
is `email_unverified`, and every later assertion must be verified and from the
same subject), `404` (unknown provider), `400`
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
  case "$STATUS" in completed|failed|cancelled|timed_out|discarded) break;; esac
  # Only completed/failed executions have a /result payload; for the other
  # three read errorMessage from the /status response instead.
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
  "outcome": "succeeded",
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

Only `sdk/<version>`, `cli/<version>` and `extension/<name>` are recognised
(`extension/<name>` is the label a browser extension sends for itself); any
other value is ignored rather than trusted, since the header is
unauthenticated. `@nodaro/sdk` and `@nodaro/cli` send it automatically — you
only need this when calling the REST API directly. Omitting it is fine; those
jobs are simply recorded as generic API calls.

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

Bind or unbind with `PATCH /v1/api-tokens/:id`. Token management is
JWT-only: send your signed-in session's Supabase JWT, not an API token — a
personal token or OAuth app token is refused with `403 forbidden` ("API
token management is only available from a logged-in session.").

```bash
# bind
curl -X PATCH https://app.nodaro.ai/v1/api-tokens/$TOKEN_ID \
  -H "Authorization: Bearer $SESSION_JWT" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"6f1e6b4c-6a4e-4b7b-9d2a-2f0f0a1d9c34"}'

# unbind
curl -X PATCH https://app.nodaro.ai/v1/api-tokens/$TOKEN_ID \
  -H "Authorization: Bearer $SESSION_JWT" \
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

## 4d. Parameter corrections (`adjustments`)

`POST /v1/generate-image`, `/v1/image-to-image`, `/v1/edit-image`,
`/v1/text-to-video` and `/v1/generate-video` accept a single, model-agnostic
vocabulary for `aspectRatio`, `resolution` and `quality` — but no model supports
all of it. Rather than reject a request (a rejection mid-workflow takes every
already-generated, already-billed sibling node down with it), the server
**corrects** the value to one the chosen model accepts and tells you what it
changed:

```json
{
  "jobId": "0f1a…",
  "adjustments": [
    {
      "field": "aspectRatio",
      "from": "3:2",
      "to": "auto",
      "reason": "GPT Image 2 does not support aspectRatio \"3:2\" — using \"auto\" instead. Supported: auto, 1:1, 16:9, 9:16, 4:3, 3:4."
    },
    {
      "field": "resolution",
      "from": "4K",
      "to": "1K",
      "reason": "GPT Image 2 only renders 1K at the \"auto\" aspect ratio."
    }
  ]
}
```

- `adjustments` is **absent** when nothing needed correcting — a valid request's
  body is exactly `{ "jobId": "…" }`.
- `/v1/generate-image` can also answer **`warnings`** (`[{ code, message }]`,
  absent when there is nothing to say) for something you asked for that was
  not sent: today `moodboard_images_not_sent`, when some of a
  [moodboard's](./palettes-and-moodboards.md) images did not fit the model's
  reference limit. The run goes ahead; the job keeps the same warnings in
  `input_data.warnings`.
- `to` is absent when the model has no such lever at all and the value was
  dropped (e.g. an `aspectRatio` sent to `recraft-upscale`).
- **Credits are reserved against the corrected values.** A `gpt-image-2` request
  for `auto` + `2K` renders and bills at 1K, because `auto` only renders 1K.
- **`aspectRatio: "auto"` keeps your photo's shape** on `/v1/image-to-image` and
  `/v1/edit-image`. A model with a native `auto` receives it as is. On a model
  without one, the server reads the size of `imageUrl` and uses the supported
  ratio closest to it — a 1104x1472 portrait sent to `seedream-5-pro-i2i`
  renders at `3:4` — and reports the choice in `adjustments`. If the image's
  size cannot be read, `auto` falls back to the model's first listed ratio.
  The ratio never changes the price on these models.
- **`/v1/generate-image` does the same when a photo is wired in**: the photo is
  the first image the request sends the model — `baseImageUrl` (inpaint /
  refine) when set, else the first reference image (`referenceImageUrls`, or
  the first one assembled from `connectedReferences`). Without a photo, `auto`
  on a model without a native one gives its first listed ratio, as before.
- The per-model option lists are in `GET /v1/models`; a workflow saved through
  the API or MCP is corrected the same way at write time — except `auto` on a
  generate-image, image-to-image, modify-image or edit-image node, which is
  kept and resolved against the photo when the workflow runs.

### On the video routes

`/v1/text-to-video` and `/v1/generate-video` return `adjustments` in the same
shape. `/v1/generate-video` reports each correction **twice** — once in
`adjustments` (structured: `field`, `from`, `to`, `reason`) and once in its
existing `warnings` array (the `reason` prose only, alongside any non-parameter
warning such as `voice_unsupported_for_provider`). Read `adjustments` when you
need to know *which* lever moved; the two never disagree.

Three video-specific rules:

- **An off-list value snaps to the NEAREST option, never the cheapest or the
  first.** A `4k` request on a model that tops out at 1080p renders 1080p (not
  the 480p floor), and a portrait `9:21` becomes `9:16` (not landscape `16:9`).
- **An omitted `resolution` is sent at the band it is priced at.** Where the
  platform declares a model's default band, that band is what you are billed for
  *and* what the provider is asked for — the request no longer leaves the field
  unset for the provider to fill with something else. The value is echoed in the
  job's `input_data`, so you can always see what was actually sent.
- **Spelling is canonicalised before pricing.** `4K` is read as `4k`, so it
  prices and renders the 4K band rather than silently falling back.

A few models **ignore** an unsupported resolution and render a fixed default
instead of the nearest band — `minimax-h3` renders 2K for anything that is not
`768P`, and the `wan-3` family and `vidu-q4` render 720p (all described under
[Seedance 2 video capabilities](#seedance-2-video-capabilities)).
For those the correction targets the band the provider will actually produce, so
the price still matches the render. Each such model declares this in the catalog
via `unlistedResolutionRendersAs`, which is what `GET /v1/models` reflects.

**Duration is billed for the length the model renders.** A video request that
sends no `duration` renders — and is charged for — the model's own default
length, `defaultDuration` in `GET /v1/models` (Seedance 2 / Fast / Mini and
Seedance 2.5 8 s, Grok Imagine 6 s on `grok-i2v` and 8 s on 1.5, Hailuo 6 s,
Kling 5 s, LTX 6 s), never a flat 5 s; that length is sent to the provider, so
what you are charged for is what is rendered. A `duration` the model does not
offer is moved to the nearest length it does (a tie goes to the shorter one) and
reported in `adjustments`: a 7 s request on Kling renders and bills 5 s, a 7 s
request on an LTX 2.3 model renders and bills 6 s.

`duration: -1` means **Auto** on the models that support it (the Seedance 2
family — `autoDuration: true` in `GET /v1/models`): the model picks the clip
length, which is the source clip's length when it edits a reference video. An
Auto run reserves credits for the model's longest clip and is refunded down to
the length actually delivered. On any other model `-1` is ignored and the model
renders its default duration.

## 4e. Generation sessions

A creation tool (an image, video or music maker built on the API) can keep
its work in **sessions** inside **projects**: Project → its sessions → each
session's items, the same on every device. Nothing is stored app-side.

```bash
# 1. Open a session, optionally inside one of your projects.
SESSION=$(curl -s -X POST "$BASE/v1/sessions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"projectId":"<project-id>","tool":"create-image","title":"Beach"}' | jq -r .data.id)

# 2. Generate inside it: send `sessionId` beside the usual params.
curl -s -X POST "$BASE/v1/generate-image" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"prompt\":\"a red car\",\"sessionId\":\"$SESSION\",\"origin\":\"create-image\"}"

# 3. The session's feed, newest first.
curl -s "$BASE/v1/sessions/$SESSION/items" -H "Authorization: Bearer $TOKEN"
```

| Route | What it does |
|-------|--------------|
| `POST /v1/sessions` | Create. Body: `tool` (required — lowercase letters, digits and dashes, at most 40), `projectId?` (one of your projects), `title?` (at most 200). |
| `GET /v1/sessions` | Your sessions, newest first. Query: `projectId`, `tool`, `includeArchived=true`, `limit` (1–100, default 50), `cursor`. Each carries `itemCount`, `coverJobId` and up to four `previewUrls`: the cover's image first when one is set, then its newest completed items. |
| `GET /v1/sessions/:id` | One session. |
| `PATCH /v1/sessions/:id` | `title` (`null` = untitled), `archived`, and `coverJobId`: one of the session's items to lead its previews (`404` if it is not an item of this session), or `null` to go back to automatic. A session's **project is fixed** at creation. |
| `DELETE /v1/sessions/:id` | Deletes the session and its links. Its jobs are kept, and stay in every other session that holds them. |
| `GET /v1/sessions/:id/items` | The feed: every item, born in the session or imported, newest first. Each item: `jobId`, `addedAt`, `imported`, `importedFrom { sessionId, title }`, and `job` in the same shape `GET /v1/jobs/:id` returns. Paged with `limit` / `cursor`. |
| `POST /v1/sessions/:id/items` | **Import** `{ "jobIds": [...] }` (1–100) — a link, never a copy. All-or-nothing: if any id is not one of your jobs, nothing is imported (404). Items already in the session are left as they are. Answers `{ imported, requested }`. |
| `DELETE /v1/sessions/:id/items/:jobId` | **Remove** one item from this session. Only the link goes: the job, and every other session holding it, stay. |

**Which generation routes take `sessionId`:** every route that creates a job
(`generate-image`, `generate-video`, `text-to-video`, `text-to-speech`,
`generate-music`, …). It must be one of **your** sessions, on the side of the
workspace line the request is on (see 4c) — otherwise the request answers
`404` and nothing is created or charged. The job's `session_id` is set once,
when it is created, and shows on `GET /v1/jobs/:id` and `GET /v1/jobs`. Runs of
a workflow are never filed in a session.

**Moving work between projects:** there is no "move". Import the items into a
session of the other project, then remove them from the old one if you no
longer want them there. Removing never deletes anything; deleting a job
(`DELETE /v1/jobs/:id`) removes it from every session.

**Pre & post text and `origin` on `generate-image`:** `promptPrefix` /
`promptSuffix` wrap the prompt the same way they wrap an AI prompt node's (a
preset's words); together with the prompt they may not exceed the prompt
limit. `origin` (your app's slug — lowercase letters, digits and dashes,
starting with a letter or digit, at most 40 characters) is stored on the job
(`input_data.origin`) and is what `GET /v1/jobs?origin=` filters on. **Every
route that creates a job takes it** — image, video, speech, music, sound,
lip-sync, upscale, the character / location / object generations, … — the
same way `sessionId` works: the platform stamps it on the job, whatever the
route. A value that is not a slug answers `400 validation_error` and nothing is
created or charged. Runs of a workflow carry none.

**`userPrompt` on `generate-image`:** when `prompt` is a version your app
expanded (filled-in fields, resolved references), send the text as your user
typed it as `userPrompt`. It is stored on the job (`input_data.userPrompt`) to
show what the user wrote, and never sent to the model; it defaults to `prompt`.

**Scopes (OAuth apps):** reading sessions needs `jobs:read`; creating, editing,
importing and removing need `assets:write` — and so does sending `sessionId`
with a generation request (without it the request answers `404`). A personal API key limited to some
workflows cannot reach these routes.

## 4f. Applying a preset on `/v1/generate-image` (`presetId`)

`POST /v1/generate-image` takes `presetId` — a factory id such as
`generate-image/cinematic-still` (list them with `GET /v1/node-presets/factory?nodeType=generate-image`)
or one of your own presets — and applies it the way the editor applies it to a
Generate Image node, so the job is the one the editor's Run would send:

- the preset's prompt and pre/post text (`promptPrefix` / `promptSuffix`);
- `{name || default}` placeholders filled with their defaults;
- its `style` folded into the prompt;
- its negative prompt sent natively on a model that takes one, and folded into
  the prompt as an "Avoid:" line on every other model;
- its levers, and the editor's defaults for the ones it leaves unset (model
  `gpt-image-2`, ratio `16:9`) — the same model and price as in the editor.

Fields you send override the preset, as an edit on the applied node would: your
`prompt` replaces the preset's and is wrapped in its pre/post text; `provider`,
`aspectRatio`, `resolution`, `quality`, `negativePrompt`, `style` and the rest
replace the preset's values. References, `sessionId`, `origin` and the other
fields are kept.

A placeholder with no default (`{BRAND}`, `{TEXT}`) has nothing to fall back
on: send its value in `presetVariables`, e.g.
`{ "presetId": "generate-image/logo-wordmark", "presetVariables": { "BRAND": "Acme" } }`.
Without it the route answers `400` with `code: "preset_variables_required"` and
`tokens: ["BRAND"]`. An unknown `presetId` answers `404 preset_not_found`. The
credit check prices the request after the preset is applied, and neither
`presetId` nor `presetVariables` is stored on the job. A preset combines with
`count` and `models` — several images in one call, see
[§ 4g](#4g-several-images-in-one-call-count-models).

A preset call cannot use one of your own palettes or moodboards yet: when its
`direction` names one (`"palette:<id>"`, `"moodboard:<id>"` — sent by you, or
saved in the preset) the route answers `400 validation_error` with `field`
naming the key, before anything is created or charged. See
[Palettes and moodboards](./palettes-and-moodboards.md).

## 4g. Several images in one call (`count`, `models`)

`POST /v1/generate-image` can make several images at once:

- **`count`** (1–4): that many images of one model. Each image is **its own
  job**, one image per job.
- **`models`** (2–4 distinct image model ids — the same ids `provider` takes —
  *instead of* `provider`): the same request on each model. Each model's
  levers are fitted to it exactly as on a single call naming it, and what was
  corrected is reported per model.
- With both, `count` is per model: `models: ["gpt-image-2", "flux-2-max"],
  count: 2` makes four images. At most 8 images per request.

```bash
curl -s -X POST "$BASE/v1/generate-image" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 0f8e6c1a-try-1" \
  -d '{"prompt":"a lighthouse at dusk","models":["gpt-image-2","flux-2-max"],"count":2,"seed":41}'
```

```json
{
  "jobId": "…first job…",
  "jobIds": ["…", "…", "…", "…"],
  "batchId": "6b1f7e2a-0c4d-5e8f-9a1b-2c3d4e5f6a7b",
  "groups": [
    { "model": "gpt-image-2", "jobIds": ["…", "…"], "credits": 120 },
    { "model": "flux-2-max", "jobIds": ["…", "…"], "credits": 180,
      "adjustments": [{ "field": "resolution", "from": "1K", "to": "2 MP", "reason": "…" }] }
  ],
  "totalCredits": 300
}
```

(The credit figures above only show the shape; each image is charged what a
single call for it costs.) Without `count` / `models` — or with `count: 1` —
the answer is the usual `{ "jobId" }`, unchanged. `jobId` is always the first
job, so code that reads it keeps working.

- **Credits: the batch as a whole, or not at all.** A batch costs the sum of
  its jobs. The balance is checked against that sum before anything is
  created — short, the request answers `402 insufficient_credits` with
  `required` = the batch's total, and nothing is created. The jobs are then
  created, charged and queued together: if a charge fails part-way (the
  balance moved in between), the jobs already created are refunded and
  removed before the answer, which is that charge's error.
- **Idempotency, per image.** With `Idempotency-Key: K`, image *i* is keyed
  `K:i`. Repeating the request with the same key returns the same job ids and
  never charges a job twice. When every job exists and is paid for, the repeat
  is answered from those jobs before any balance check (`deduped: true` and
  `X-Dedup-Hit: 1`), so it cannot answer `402` even if your balance has dropped
  since; a paid job that never reached the queue is queued again. A batch that
  was only partly created is completed: the balance is checked against the
  images still to pay for, only those are created and charged (the answer then
  has no `deduped`), and each is the same image it would have been. Two requests with
  the same key at once do not split the batch between them: the second waits
  for the first and then returns its jobs, or answers
  `409 batch_in_progress` if the first is still working after 15 seconds (retry
  it). A key belongs to one request: repeating it with a different body while
  any of its images still waits answers `422 idempotency_key_reused`, and
  nothing is charged or queued. Without a key, every request is a new batch.
- **Seeds.** With `seed`, image *i* of each model gets `seed + i` — one seed
  for every image would draw the same image each time.
- **With a preset** ([§ 4f](#4f-applying-a-preset-on-v1generate-image-presetid)):
  `count` makes N images of the preset's request. With `models` the preset is
  applied once **per model** — that model as the edit on the applied preset —
  so each model gets the editor's request for it (a negative prompt sent
  natively where the model takes one and folded into the prompt where it does
  not, that model's reference limit and levers), each fitted and priced as a
  call naming it.
- **Finding a batch later.** Every job of the batch carries the same
  `input_data.batchId` (and its position, `input_data.batchIndex`):
  `GET /v1/jobs?batchId=<id>` lists them. Each job also carries the request's
  `origin` and `sessionId`, like any job.
- **Refused before anything is created (`400 validation_error`):** `count`
  outside 1–4, fewer than 2 or more than 4 `models`, a repeated or unknown
  model, `models` together with `provider`, more than 8 images. A model the
  deployment does not offer answers `403 model_not_available`.

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
  `/v1/api/result/:execId` — `status` is `completed`, `failed`,
  `cancelled`, `timed_out` or `discarded`, and `outputs[]` is filled in.
- If it doesn't: returns `202` with `{ executionId, status: "pending" }`
  and you fall back to polling.

Recommended cutoff: use sync for workflows you expect to finish in under
a minute (text generation, light image work). For multi-step workflows
that include video rendering or upscaling, use async.

<a id="runs-that-find-nothing-new"></a>
### Runs that find nothing new

A scheduled run often has nothing to do: the feed it polls has no new posts, so
the writer behind it would be asked to write about nothing. Such a run **ends
`completed`, not `failed`.** A node that sends text to a model or a voice
(Generate Text, Generate Script, Text to Speech, Generate Music, Text to Audio)
is skipped when the text it would send is empty and that text came from a node
which, in this run, produced nothing — and the nodes behind it are skipped with
it. An output node that sends what is wired into it (Webhook Output, the social
post nodes) is skipped when every one of its wires carried nothing in this run,
so no empty request leaves the run. Nothing is billed for a skipped node.

Where that shows:

- `/v1/api/status/:execId` and `/v1/api/result/:execId` (and the
  `?wait=true` answer) carry `"outcome": "nothing_new"` once the run completes;
  every other completed run says `"succeeded"`. A failed or cancelled run has
  no `outcome`, only its `status`. `errorMessage` stays `null` — nothing went
  wrong.
- In `GET /v1/workflow-executions/:id`, the skipped node's entry in
  `nodeStates` reads `{ "status": "skipped", "skipReason": "empty_input" }`. A
  node skipped by a Router's inactive route carries no `skipReason`, as before.
- A Telegram Channel Feed that returns no new posts is not charged.

A node with a typed prompt still runs on an empty wire (its prompt is the
request), and a node with no wire at all still fails with the validation error
it always had — only a wire that carried nothing in this run counts.

Linked-frame canvas nodes require the Studio production generation API. The
canvas workflow-run endpoint and direct media requests that identify a saved
linked node return HTTP 400 with `sequence_execution_required`. Queued workflows
also check this requirement before executing their graph. See
[the execution boundary](design/dependent-frame-execution.md).

Generic saves of a dependency-aware production's graph or settings return
HTTP 409 `production_capability_required`, including delta updates and updates
that omit its dependency fields. Use compatible Studio production operations
to preserve reviewed inputs and apply revision checks.

The Cloud Studio plugin exposes `GET /v1/studio/productions/capabilities` for
per-operation support and `GET /v1/studio/productions/:id?detail=full` for planned
frames, candidate history, recorded acceptance, linked endpoints and pending
jobs. These reads do not generate media, reconcile jobs or accept candidates.
Character descriptions work without a generated portrait; image conditioning
is an explicit choice. See [the Studio SDK methods](sdk-reference.md#clientstudio)
for generation, reconciliation and separate review actions.

When `operations.saveEditorState` is available, `POST /v1/studio/productions/:id/ops` accepts `save_editor_state` with an
`expectedVersion` and a serialized editor `graph`. This saves ordinary editor
fields while preserving protected frame and job state. The revision is checked
inside the compare-and-swap loop; a stale draft returns HTTP 409 even without
an outer `strict` flag. Retain the local draft when handling that conflict.

When `operations.revisionedSharing` is available, use
`POST /v1/studio/productions/:id/share` with `{ shared, expectedVersion }` to
change link sharing at the reviewed workflow revision. The route separately
checks permission to change visibility. If another edit wins before the write,
it returns HTTP 409 `workflow_conflict` without rebasing the sharing decision.
Use `shared: false` on the same route for revision-checked unsharing.

With `operations.editableSharedCopies`, the sharing body also accepts
`allowEditableCopy`. Enabling it requires `shared: true` and `expectedVersion`,
and the same owner/admin visibility authority. Authenticated link viewers may
then call `POST /v1/studio/productions/:id/clone` to copy the saved live plan,
prompts, cast descriptions, retained inputs and take history. The bin and private
review notes are excluded. Destination media uses the viewer's storage quota;
frames need fresh acceptance and no generation jobs are started. Unsharing clears
copy permission. Revocation blocks subsequent requests; already admitted copies
remain independent. Public snapshots advertise `publicView.editableCopyAllowed`
without exposing the editable source. The clone route rechecks permission.

Public link reads of dependency-aware productions require the matching plugin's
public projection. They return a marked `settings.studio.publicView` media
snapshot: selected clips, accepted frames, selected previews and planned-frame
labels. Private inputs, reviews, pending jobs, trash and unselected history are
omitted. The snapshot is for read-only display; it is not an editable plan or a
lossless clone source. Without compatible projection support, the public read
returns the same 404 as an unavailable link. Ordinary public workflows retain
their existing response shape.

For a linked segment, `POST /v1/studio/productions/:id/generate` with
`kind: "clip"`, `shotId` and `dryRun: true` verifies both accepted endpoints and
returns an estimate for the normalized clip settings. Its `inputHash` covers
those settings and endpoint pins. Send it back as `expectedInputHash` on the
explicit generation request; a mismatch returns `sequence_quote_changed` (409)
before submitting a job. Quoting itself creates no job and accepts no frame.

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

A trigger wired to something runs only the branch behind it (its downstream
nodes plus whatever they need as input); a trigger wired to nothing runs the
whole workflow — so one workflow can carry several triggers, each starting
its own branch. "Wired" covers a drawn connection, Group membership and a
field mapping. A trigger row created by hand names no node, so its branch
is found by node type; with two nodes of that type the whole workflow runs.

Both node types register on **save**, whichever way the workflow was
written (editor, API, SDK, import, MCP). The editor saves through the
database directly and then asks `POST /v1/workflows/<id>/sync-triggers` to
project the stored graph; any caller with edit access may call it to
re-project a workflow (`{ data: { synced, created, updated, removed } }`).
Its optional body `{ vouchNodeIds: [...] }` names the trigger nodes the
caller just added; only an owner's own browser session can vouch, and only
those rows count as the owner's own runs for a plain stored credential.
Likewise `accountNodes: [{ id, settings }]` names the Telegram Account
Triggers the owner's editor changed, each with the listening settings it set
(`telegramAccountListeningSignature` in `@nodaro/shared`): only the owner's
own browser session can name them, and one is armed, widened or re-pointed
only while the stored node still says exactly that. Any other save made as
the owner (a token, a connected app, MCP) can switch an account trigger off,
never on.
Inspect a workflow's triggers with `GET /v1/workflows/<id>/triggers`; pause
or resume one with `PATCH /v1/workflow-triggers/<id>` (a Telegram Account
Trigger's row can only be paused there: it is started in the editor). Triggers you create directly with
`POST /v1/workflow-triggers` are not managed by any node, so saving the
workflow never changes or removes them.

A schedule's `config` carries `rules` — the same model the Schedule Trigger
node uses — plus an optional `timezone` (a zone name the server can read,
such as `Asia/Jerusalem`; the clock the rules are read in, UTC when omitted)
and `maxExecutions`:

```json
{
  "workflowId": "…",
  "type": "schedule",
  "config": {
    "rules": [
      { "kind": "days", "every": 1, "hour": 9, "minute": 0 },
      { "kind": "weeks", "every": 2, "weekdays": [1, 3], "hour": 18, "minute": 30 }
    ],
    "timezone": "Asia/Jerusalem"
  }
}
```

| `kind` | Fields | Runs |
|--------|--------|------|
| `minutes` | `every` 1–59 | at minute 0, N, 2N… of every hour |
| `hours` | `every` 1–23, `minute` | at hour 0, N, 2N… of every day, at that minute |
| `days` | `every` 1–31, `hour`, `minute` | every Nth calendar day at that time |
| `weeks` | `every` 1–52, `weekdays` (0 = Sunday … 6 = Saturday), `hour`, `minute` | on those weekdays, every Nth week |
| `months` | `every` 1–12, `dayOfMonth` 1–31, `hour`, `minute` | on that day (or the month's last day when it is shorter), every Nth month |
| `cron` | `cron` — a 5-field expression | whenever the expression matches |

The workflow runs whenever **any** rule matches the current minute. "Every
Nth day / week / month" counts from a fixed origin (weeks start on Monday),
so re-saving never shifts the phase. In a `cron` rule every field must
match — day-of-month **and** day-of-week, where some crontabs read
either/or — and `7` is Sunday like `0`. Values outside a kind's range are
refused with a 400, as is a timezone the server cannot read. A `config` sent
in a `PATCH` is merged into the stored one — send only what changes; the
row's link to its node and its run count are kept. The older
`interval` (`"5m"`, `"1h"`, `"1d"`) and `cron` forms are still accepted for
triggers you create by hand; a Schedule Trigger node saved with them is
converted to rules on save.

A Schedule Trigger **node** fires only while its data says `"active": true`
— the node's switch. A node written through the API, the SDK or MCP with no
`active` is registered paused; the editor's switch and its top-bar Schedule
button set the same field. `PATCH /v1/workflow-triggers/<id>` with
`isActive` overrides the row until the next save applies the node's switch
again; a schedule you created by hand has no node and keeps whatever you
set.

## 6b. Webhook endpoints (Nodaro pushes to you)

The other direction: register an https endpoint and Nodaro POSTs it every
time one of your jobs ends — `job.completed` or `job.failed` — so your server
stops polling `GET /v1/jobs/{id}`. Each request is signed
(`Nodaro-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`),
retried with backoff for about 43 hours, and recorded in the endpoint's
delivery log. The full guide — events, body, headers, verifying by hand,
retry schedule, automatic switch-off — is [Webhooks](./webhooks.md).

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/v1/webhook-endpoints` | Register `{ url, events?, description? }` → `201 { data, secret }`; the `whsec_…` secret is in this response only. 30/min. |
| `GET` | `/v1/webhook-endpoints` | Your endpoints, newest first (never a secret). |
| `GET` | `/v1/webhook-endpoints/:id` | One endpoint. |
| `PATCH` | `/v1/webhook-endpoints/:id` | `{ url?, events?, isActive?, description? }`; `isActive: true` also clears an automatic switch-off. 30/min. |
| `DELETE` | `/v1/webhook-endpoints/:id` | The endpoint and its delivery log. 30/min. |
| `POST` | `/v1/webhook-endpoints/:id/rotate-secret` | `{ gracePeriodSeconds? }` → `{ secret, previousSecretExpiresAt }` — a new secret, in this response only; the replaced one keeps signing beside it for the grace (a day by default, `0` = stop it now). 30/min. |
| `GET` | `/v1/webhook-endpoints/:id/deliveries` | The delivery log, newest first: `?status=pending\|delivered\|failed&limit=&cursor=` → `{ data, next }`. Kept 30 days. |
| `GET` | `/v1/webhook-endpoints/:id/deliveries/:deliveryId` | One delivery → `{ data }`. |
| `POST` | `/v1/webhook-endpoints/:id/test` | Queue a `ping` (tried once, even to an endpoint that is switched off) → `202 { data: <delivery> }`. 10/min. |

https on a public host only — no `http://`, no `localhost` (use a tunnel), no
private address or private-network name, not this server's own address; one
endpoint per address (`409 url_taken`) and at most 10 endpoints per account.
A session, a personal API token, or a connected app's token with `jobs:read`
can manage them; an endpoint a connected app registers receives only the jobs
that app submitted itself, and nothing once you revoke the app. Verify a delivery with `verifyWebhookSignature` from `@nodaro/sdk`
([SDK Reference](./sdk-reference.md#clientwebhooks)). These routes are not
under `/v1/webhooks/`, which is the public trigger above.

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
routes) returns `rate_limited`. Every other limiter returns
`rate_limit_exceeded`: a per-IP limiter on a few unauthenticated endpoints —
e.g. OAuth Dynamic Client Registration (`POST /v1/oauth/register`,
10/min/IP) and the SSO exchange — a per-caller limiter on specific
authenticated routes (the route's own section on this page states its
limit, e.g. `POST /v1/freecut-export` 10/min; these send a `Retry-After`
header and, on spend routes, answer `503 rate_limit_unavailable` if the
limiter's store is down), and a published app's daily run cap. Match on
the HTTP 429 status for retry logic; use the `code` only to tell the
per-token bucket from the rest.

## 8. Error envelope

All errors share the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests. Max 30 per minute." } }
```

| HTTP | code | Extra field | When / route family |
|---|---|---|---|
| 400 | `validation_error` | — | Malformed body, bad UUID, invalid field. |
| 400 | `limit_reached` | — | `POST /v1/api-tokens`: you already have 10 tokens (active or not). Delete one first. |
| 400 | `invalid_workflow` | — | `POST /v1/api-tokens` / `PATCH /v1/api-tokens/:id`: a `workflowIds` entry is not a workflow in your personal space (workspace workflows cannot be scoped to a token). |
| 401 | `unauthorized` | — | Missing/invalid/expired/revoked token. |
| 402 | `insufficient_credits` | `required` (plus `balance`, except on a deployment-payer instance) | (Cloud edition only) Account out of credits. On a deployment-payer instance it means the **deployment's** pool is empty ("This deployment is out of credits. Contact your administrator."): the response names `required` and never `balance`, and only the billing account can top the deployment up. |
| 402 | `budget_exceeded` | — | (Cloud edition, organizations) Workspace-paid work: the workspace's allocated budget can't cover the reservation. Ask a workspace admin for headroom. Rollout-gated: availability may lag this document. |
| 402 | `member_cap_exceeded` | — | (Cloud edition, organizations) Workspace-paid work: your per-member spending cap in this workspace is reached. Rollout-gated. |
| 402 | `user_allowance_exceeded` | `required`, `remaining` (top-level, on the pre-run check) | (Cloud edition, deployment-payer instances) Your per-user allowance on this deployment can't cover this run — distinct from `insufficient_credits`, which means the deployment's own pool is empty. Only the deployment's billing account can raise an allowance. Fires only on a deployment that has switched allowance **enforcement** on; until then your allowance is shown (`GET /v1/user/credits` → `allowance.enforced: false`) but never refuses a run. |
| 402 | `instance_cap_reached` | — | (OAuth tokens of a connected self-hosted instance only) The instance has spent its monthly cap on the account that connected it. Raise or remove the cap under the account's **Connected Instances**; a personal API key used as the relay credential has no such cap. |
| 403 | `forbidden` | — | The token is limited to some workflows, and the request is outside them ("This API key is limited to specific workflows, and this request is outside them. Use a key without a workflow limit for anything else."; see [Tokens limited to some workflows](#tokens-limited-to-some-workflows)) — or the route is session-only and refuses API/OAuth tokens: `/v1/api-tokens` management ("API token management is only available from a logged-in session."), node-preset writes, the `/v1/billing/*` purchase routes (checkout, load sessions, auto-recharge, purchase history, Stripe portal). Repeat the call with your browser session's JWT. |
| 403 | `access_blocked` | — | (Business and Cloud editions) An administrator blocked the account — or, for a browser session, the network the request comes from. Every credential of the account is refused (session, API token, OAuth app token), its schedules and triggers stop running, and a run of its published apps or components answers `404 not_found`. Contact support if you think this is a mistake. |
| 403 | `member_suspended` | — | (Cloud edition, organizations) Workspace-paid work: your membership in the paying workspace is suspended. Rollout-gated. |
| 403 | `not_a_member` | — | (Cloud edition, organizations) The request names a workspace you are not an active member of. Rollout-gated. |
| 403 | `insufficient_scope` | `missingScope` (+ `message`) | (OAuth tokens only) The token is missing a scope the route requires. Re-run the OAuth consent with the broader scope. See [OAuth Flow §4](./oauth-flow.md#4-scope-vocabulary). |
| 403 | `sso_required` | — | (Deployments that restrict sign-in to their identity provider) A session JWT for an account that was not provisioned through that provider. Sign in through the provider; API tokens and OAuth app tokens are not affected. |
| 403 | `edition_required` | `required_edition: "<edition>"` (+ `message`) | Endpoint needs a higher edition than the caller has. `required_edition` is the minimum: `"cloud"` for pipeline (`POST /v1/pipelines/:id/branch`) + scene-helper routes; `"business"` for API-token management (`POST /v1/api-tokens`, `GET /v1/api-tokens`). |
| 403 | `api_tokens_payer_only` | — | On a deployment-payer instance only the billing account may create a personal API token; every other user is refused. Existing tokens stay listable and revocable by their owner. |
| 403 | `payer_balance_jwt_only` | — | (Deployment-payer instances only) A credit-balance read (`GET /v1/credits/balance`, `GET /v1/user/credits`, `GET /v1/credits/check`) authenticated **as the billing account** with an API token or an OAuth app token. The deployment's pool is the operator's number and is answered only to that account's own browser session — see [§3](#3-public-api-endpoints). No other identity is affected. |
| 403 | `subscription_required` | — | (Cloud edition only) A pay-as-you-go account tried to spend from a first-party consumer surface (browser session in the studio or another Nodaro app). Payg credits are redeemable via the API/SDK/CLI/MCP — this never fires for token-authenticated calls. Rollout-gated: availability may lag this document. |
| 404 | `not_found` | — | Workflow, execution, or token not found. |
| 404 | `workspace_not_found` | — | (Cloud edition, organizations) The workspace named by workspace-paid work does not exist (or was deleted mid-flight). Rollout-gated. |
| 409 | `workspace_archived` | — | (Cloud edition, organizations) Workspace-paid work into an archived workspace. Unarchive it or move the work. Rollout-gated. |
| 409 | `retained_image_in_use` | — | A delete would remove protected image bytes, or a production has active jobs using retained images. Finish or cancel active jobs before deleting the production. |
| 409 | `workflow_conflict` | `currentVersion`, `currentUpdatedAt`, `currentRecord` | `PATCH /v1/workflows/:id`: the workflow changed since your `expectedVersion` / `expectedUpdatedAt` — merge onto `currentRecord` and save again (see [`workflows.update`](./sdk-reference.md#updateid-input)). An edges-only save (`edges` without `nodes`) that wires a [Video Overlay](./nodes/processing-video/video-overlay.md) layer rewrites that node and returns `409 workflow_conflict` (with `currentVersion` / `currentRecord`) if the workflow changed since it was read — even when you sent no `expectedVersion`; nothing is overwritten and the save is not retried. |
| 409 | `idempotency_key_reused` | — | A use-case run or its continue (`POST /v1/tighten-episode`, `POST /v1/episode-chapters`, and their `/continue`): the `Idempotency-Key` already belongs to one of your jobs that is not a run of that node — a run of another use-case node, or any other kind of job (an image generation, say). Refused; nothing is created or charged. Send a new key. A key that already belongs to a run of the same node answers that run (`202`, `deduped: true`). |
| 422 | `job_blocked` | — | A job policy registered by this deployment refused the generation before it ran. `message` is user-facing text written by the deployment's policy (or by the platform, when the policy supplies none) — show it as-is. No job was created and nothing was charged. The platform does not retry a refused request; whether the same request would be judged differently is the deployment's policy's business. Only occurs on deployments that register a job policy — see [deployment.md](./deployment.md#surface-profile-nodaro_surface_profile). Two bookkeeping inserts are the honest exception: the Suno voice-persona ownership rows and the connected-cloud LLM mirror row treat a block as best-effort — the operation proceeds and its row is simply not recorded — so a policy blocking one of those neither stops the call nor reaches you as a 422. |
| 422 | `upload_blocked` | — | An upload policy registered by this deployment refused the upload before it was stored (every byte-carrying ingestion lane: `POST /v1/upload*`, the proxy PUT and the handoff POST). `message` is the deployment's own reason — show it as-is. Nothing was written. Only occurs on deployments that register an upload policy. |
| 429 | `rate_limited` | — | You've exceeded the per-minute bucket. Back off. |
| 500 | `internal_error` | — | Server bug or downstream dependency failure. Retry with backoff. |
| 503 | `price_not_configured` | — | (Cloud edition only) No pricing row exists for the requested model — the server hard-fails rather than silently mis-billing. Operator must seed the price; the call is not retryable as-is. |

Treat anything in the 5xx range as transient — retry with exponential
backoff. Treat 4xx as terminal — don't retry without fixing the request.

### Job failure hints (`error_hint`) and credit status

The table above covers request-level errors — a call that never produced a
job. A **job** that later fails carries its own detail in `error_message`
plus, for two classes of failure, a structured `error_hint`.

A provider content-policy block:

```json
{ "kind": "safety-block", "class": "copyright" | "likeness" | "safety", "retried": boolean, "suggestedProvider"?: string }
```

Or, on a deployment that registers a job policy, a rejection by that policy:

```json
{ "kind": "policy-block", "policyId": string, "reason": string, "hookPoint": "request" | "result" }
```

`reason` is user-safe text written by the deployment's policy (or by the platform, when the policy supplies none) — show it as-is.
`hookPoint` says whether the request was refused before the job ran or the
output was rejected after it was produced (including a reviewer rejecting a
job that had been held in `pending_review`). The reservation is refunded. (The
rare exception is a job whose credits were already settled before the gate
spoke — there is then nothing left to return, and no platform message claims
otherwise.) Unlike `safety-block`, the platform does not retry a policy rejection
and offers no fallback model: whether the same request would be judged
differently is the deployment's policy's business, not the platform's.

`error_hint` is `null`/absent on every other failure — including a **request
reject**, where the provider answered the submission with a 4xx because the
settings or input media are invalid for that model. That one has no structured
hint, but its `error_message` says the provider *rejected these settings for
this model* and `retryable` is `false`: change the settings or the media before
re-running. A provider 5xx stays retryable however validation-shaped its
wording is. For `safety-block`,
`class` distinguishes a
deterministic block (`copyright`, `likeness` — retrying the identical request
never helps) from `safety`, whose filter is known to be non-deterministic for
some models: `retried` reports whether the platform already spent its one
automatic retry on the same request, and `suggestedProvider` — present only
when the model's catalog entry declares a fallback — is a real model id you
can retry the same prompt/references on. `error_hint` is included on every
job payload that carries `error_message`: `GET /v1/jobs`, `GET /v1/jobs/:id`,
`GET /v1/jobs/:id/status`, `GET /v1/jobs/status`, and
`POST /v1/jobs/batch-status`.

`GET /v1/jobs/:id/status` carries `completed_at` — when the job finished, on
the server's clock (`null` until it has) — as `GET /v1/jobs/:id` does.

`GET /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/status`, and
`GET /v1/jobs/status` also carry `credit_status: "reserved" | "committed" |
"refunded" | null` — the job's credit reservation lifecycle, derived
server-side from the usage log. `null` when the job has no usage log to
report; never present on `POST /v1/jobs/batch-status`.

A job's `credits` is the amount **held** when it was accepted, and it never
changes. `GET /v1/jobs` and `GET /v1/jobs/:id` also carry `credits_charged:
number | null` — what the job actually cost once its hold settled, read from
the same usage log. It can be lower than `credits` (some jobs hold more than
they end up using — a possible re-render, a length measured after the run —
and the rest goes back to your balance), it is `0` when the hold was refunded,
and it is `null` while the job is still running (`credit_status: "reserved"`)
or when the job reserved nothing of its own. To total what jobs cost, sum
`credits_charged`, not `credits`. Example: a job that held 888 and settled at
444 reads `credits: 888`, `credits_charged: 444`, `credit_status: "committed"`. A generation that ends in
a safety-filter block or a policy block is always refunded — see
[§12 Credits](#12-credits-cloud-edition). A job a deployment's policy has
**held** for human review reports `status: "pending_review"` — an in-flight
status, not a terminal one; keep polling rather than treating it as a failure
— with `credit_status: "reserved"` for the whole hold; it then resolves to
`completed`, `failed` (with the `policy-block` hint above) or `cancelled`
(a held job is cancellable like any in-flight job). A hold can also time
out: on a deployment that sets a review deadline (`JOB_HOLD_TTL_HOURS`), a
job nobody reviews in time is auto-rejected — `failed` with the
`policy-block` hint (`hookPoint: "result"`), the reservation refunded and
the withheld output deleted; it is never auto-approved. Without that
setting a hold waits for a reviewer indefinitely.

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
  up. Returning and spending credits stops future cleanup. Cleanup takes
  the files a generation stored as its own result, including ones its result
  holds inside a structured output (a list of variants, a track file), and
  only those: an input the result repeats is left alone, and a file one of
  your library items still holds (a result you saved, say) stays until that
  item is cleaned up too. Side files a generation keeps next to its result
  are cleaned up with it, including the unstitched clip of a video
  extension. (An older extension stored that clip under a name of its own,
  not the job's; those clips are not cleaned up.) A later extension keeps
  its own copy of the clip it continues from (`chainReferenceUrl` in its
  result), so cleaning up the earlier one never breaks it. An extension that
  fails partway deletes the copies it had made. When a
  file is cleaned up, its link is cleared (set to `null`) in every job
  result that holds it, including results that repeated it as an input, so
  no result keeps a link to a file that is gone. Nothing else in those
  results changes. If storage fails to remove a file, whether during this
  cleanup or when you delete something yourself, the platform tries again on
  later days (a few times at most, on every edition, self-hosted included),
  and the file's link stays in place until the file is really gone. A file
  you deleted yourself (a library item or an upload) whose removal failed is
  kept, and not tried again, when a generation made after the failure links
  it. A file cleanup took is tried again even then.

## 9. Characters

Character routes let you fully script character creation, identity edits,
asset generation, and the portrait-approval pipeline that drives Character
Studio. All routes require an authenticated bearer token (`ndr_…` /
`ndr_app_…` / Supabase JWT) and are scoped to the calling user.

### Lifecycle

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/characters` | List characters (cursor-paginated). Query: `projectId`, `archived=true`, `q` (search — see [below](#search-q)), `limit` (default 100, max 500), `cursor`. Returns `{ characters, nextCursor }` — see [pagination](#get-v1characters--pagination) below. |
| `GET` | `/v1/characters/:id` | Get full character + in-flight portrait/asset jobs. Query: `candidates=all` also returns the current portrait's own take in `previousCandidates`, flagged `isPortrait: true` (default `alternates` leaves it out); the flagged take is absent when its job is older than 7 days or the portrait was not generated by a job. |
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
- `archived=true` pages the same way, over the archived set, and so does a
  search (`q`): keep sending the same `q` with each `cursor`.
- Rows created *while* you are paging (newer than page 1's boundary) are not
  picked up by the walk — restart from no cursor to see them.

### Search (`q`)

`GET /v1/characters?q=red%20car` lists only the characters whose **name or
description** contains every word of `q`, ignoring case — so `red car` finds
"Car, red". `GET /v1/locations`, `GET /v1/objects`, `GET /v1/creatures` and
`GET /v1/faces` take the same `q` and match the same two fields, and
`GET /v1/library` takes it for the filename ([Your media library](#your-media-library)).

- **Words.** `q` is split on spaces into words, and only the first 5 are
  searched. Each word may be in the name or in the description; all of them
  must be there, in any order.
- **Every character of a word is matched as itself**: `%`, `_` and `*` are not
  wildcards, and punctuation is kept — `Smith,` needs the comma. Commas,
  quotes, brackets and backslashes need no escaping beyond ordinary URL
  encoding (`?q=100%25` searches for `100%`).
- Leading and trailing spaces are ignored, and a blank `q` is no search.
  More than 200 characters, or a NUL character, is a `400 validation_error`.
- `q` combines with every other filter and with pagination — `projectId` on
  all five, `archived=true` on all but `/v1/faces`, which has no archive —
  and results keep the list's order (newest first).
- The generated caption (`canonicalDescription`) is not searched.
- Saved posts and collection records also take `q` as up to 5 words that must
  all appear; there, punctuation is removed before the words are matched.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/characters?q=maya&limit=20"
```

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
for single-candidate runs. Add `attachPortrait: false` to keep each take a
candidate instead: only `approve-portrait` then sets the portrait.

The image-generating routes (`/v1/generate-character`,
`/v1/generate-character-asset`, and the location equivalents
`/v1/generate-location` / `/v1/generate-location-asset`) also accept optional
`quality` (`"medium"` / `"high"` / `"basic"`) and `resolution` (`"1K"` /
`"2K"` / `"4K"` / `"0.5 MP"` / `"1 MP"` / `"2 MP"` / `"4 MP"`). These are
**credit-affecting** and price exactly like `/v1/generate-image` (composite
ids such as `gpt-image:high` / `nano-banana-pro:4K`) — a 4K / high run
reserves more credits than the same model at its base tier. A value the chosen
model doesn't support is **corrected to one it does** (the same mechanism as
"Parameter corrections" above), never a 400 — and the credits reserved match
the corrected value, not the one you asked for. These four routes apply the
correction but, unlike `/v1/generate-image`, `/v1/image-to-image` and
`/v1/edit-image`, do **not** return an `adjustments` array — the corrected
value is visible only in the job's persisted `input_data` (`GET /v1/jobs/:id`),
not in the route's own response body.

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
| `GET` | `/v1/objects` | List objects. Query: `projectId`, `archived=true`, `q` (the name-or-description [search](#search-q) of `/v1/characters`); optional `limit` (max 500) + `cursor` opt into the same cursor pagination as `/v1/characters` and add `nextCursor` to the response — without `limit` the full legacy listing returns, unchanged. `/v1/creatures`, `/v1/locations` and `/v1/faces` accept the identical parameters. |
| `GET` | `/v1/objects/:id` | Get full object + in-flight asset jobs. Archived rows return uniform 404 `not_found`. |
| `POST` | `/v1/objects` | Upsert (create if no `id`, update otherwise). Optimistic-concurrency via `expectedUpdatedAt`. |
| `POST` | `/v1/objects/:id/restore` | Un-archive a soft-deleted object. |
| `DELETE` | `/v1/objects/:id` | Soft-delete (archive). Restorable. |
| `DELETE` | `/v1/objects/:id?permanent=true` | Permanent destroy. Row must already be archived (400 `not_archived` otherwise). |

**What a permanent delete removes from storage.** A permanent delete of an
object, creature, location or library item removes the row, and deletes the
stored files it names only when they are provably yours and no one else's: a
file one of your generations made, a file you uploaded, or one in your upload
folder — and not a file another user's generation made, one in their upload
folder, or one another user's library still holds. Any other file the row names
stays in storage. The row is still removed; its size is credited back to your
storage quota only for the row that was counted against it when the file was
stored. Storage retention cleanup follows the same rule: an expired row whose
file another user's library still holds lets go of the file and is credited
back like a deleted one, and an expired row naming a file no one can be shown
to own keeps it (the file stays in storage). These four kinds of rows, and
characters, are written only through the API: a direct database write from a
signed-in browser session is refused.

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
`outputType`, `creditCost` (the credits a run is charged, the same figure as the node's Run button: one number for a flat price, a `"min-max"` range for a node priced per model or setting — Cloud only; community and business installs have no credit system and omit the field), `creditRate` (a node charged per unit of its own measure, whose `creditCost` is a word rather than a number — Speaker Frames, `"per-1000-frames"`: `{ identifier, unit, creditsPerUnit, minUnits, rounding, note }`. `creditsPerUnit` is the exact charged credits of one unit, not rounded — 2.2<!-- credits-rate: speaker-frames --> for a Speaker Frames block of 1,000 sampled frames — and `rounding: "ceil-run-total"` means a run of N units (at least `minUnits`) is charged `ceil(N × creditsPerUnit)`, rounded up once: 11 blocks are 25<!-- credits: speaker-frames@11 -->, not 11 × the one-block price. `identifier` is the price id, `unit` a token naming the unit. Cloud only, like `creditCost`), `inputSchema`
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

Neither endpoint requires authentication; they expose only registry
metadata and prices. No scopes required. Both describe what a USER of the
instance can use: a node the deployment withholds from users is absent, and
Web Scrape's description leaves out any source it withdraws (its Instagram
source follows the Instagram node's availability).

### Model catalog

`GET /v1/models` — the REST twin of the MCP `list_models` tool, for plain
SDK/HTTP clients. Public (model availability is not a secret), cached 5
minutes (`Cache-Control: public, max-age=300`). Returns
`{ sections, recommendations, totalModels }`: models grouped by kind
(`image` / `video` / `audio`) and vendor family, each with capability
sheets (`modes`, `features`, `aspectRatios`, `resolutions`, `durations`),
per-variant credit `pricing` — the credits a run is charged, the price
`GET /v1/credits/model-cost` returns for that variant (Cloud only — like
`creditCost` on `/v1/nodes`, editions without a credit system omit it), compact
`promptTips`, and the
`doctrineCovered` truth flag (`true` only when a sourced per-family prompt
doctrine exists — gate "vendor doctrine" badges on it; never overclaim).

Every model also names its **maker** and carries the maker's mark:

| Field | Type | Meaning |
|---|---|---|
| `maker` | `{ id, name }` | The company that made the model. `id` is stable — one per company, the company's name lowercased and hyphenated (`google`, `black-forest-labs`, `bytedance`) — so an app can key its own assets on it; a newer server can add makers, so handle an id you do not know. It is not always the `family` the model is grouped under: a few families name a lab, a product line or a cloud brand (Tongyi-MAI and HappyHorse are Alibaba's, Depth Anything and Volcengine are ByteDance's, InfiniTalk is Meituan's). |
| `logoUrl` | string \| `null` | The maker's official mark (an SVG) on this instance's own media CDN, or `null` when the instance does not publish one for that maker — draw a fallback then (the maker's name or initial). Use the address as given: it carries its file's version (`?v=…`), so a replaced mark arrives under a new address. |

A mark is published by the instance's operator, and the server lists its
address only once the file is in storage — never before it is uploaded (see
[Model maker marks](./deployment.md#model-maker-marks-logourl)).
The MCP `list_models` tool carries `maker` but not `logoUrl`.

A speech model (`mode: tts`, and the dialogue models) lists a second
`pricing` row, `<model>:per-100-chars`, on an instance that prices speech
by length: the credits of one started 100 characters of the text sent. A
request is priced as a whole and rounded once, so `N × that row` (with
`N = max(8, ceil(characters / 100))`) is only an upper bound of what it
costs. The exact price is the identifier `<model>:per-100-chars:<N>u`,
which `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost`
answer — the figure the request is charged; quote that rather than
multiplying. A client that does not see the row (it is absent where length
pricing is off, and so is every `:<N>u` identifier) quotes the model's flat
row, and the two never appear together with different meanings.

The same holds for every run priced per unit: the minutes of an Apply EDL
or Speaker View render, the 5-second units of Trim Video, Loop Video,
Combine Videos, Assemble Narrated Video and Mask Composite, the
seconds of an LTX 2.3 Pro extend or retake, and the started minutes of a
dub (`elevenlabs-dubbing`, Hebrew `elevenlabs-dubbing-v2`), and the started
blocks of 1,000 sampled frames of a Speaker Frames run (`speaker-frames`, at
least one block). The row is the
price of one unit, and a run is priced as a whole and rounded once, so
`N × the row` can come to more than the run costs. The exact price of N
units is the identifier `<row>:<N>u` — for example `apply-edl:4u`,
`elevenlabs-dubbing:3u`, `speaker-frames:11u`, or `ltx-2.3-pro-retake:per-second:2.5u` (N is
fractional where the run's units are; a dub is charged whole minutes, 1 to
30, and Speaker Frames whole blocks) — which both endpoints answer. A row not charged per unit, or a unit
count no run of it can have, lands in `missing`.

So `GET /v1/credits/model-cost?model=speaker-frames` answers ONE block's
price, 3<!-- credits: speaker-frames --> — the least a run is charged, never
a run's price: a run of 11 blocks is charged 25<!-- credits: speaker-frames@11 -->,
where 11 × 3<!-- credits: speaker-frames --> would say 33<!-- credits: 11*speaker-frames -->. A Speaker Frames run's blocks are counted by the
server from the edit it samples, so to quote a run before it starts, send the
workflow to `POST /v1/credits/estimate-workflow` (`{ nodes, edges? }` →
`{ data: { totalCredits, … } }`): it counts the wired edit's frames the way the
[editor's estimate](./nodes/processing-video/speaker-frames.md#what-the-estimate-shows-before-you-run)
does. With the block count in hand, `speaker-frames:<N>u` is its exact price,
and `GET /v1/nodes/speaker-frames` serves the per-block rate as `creditRate`
([§11](#11-node-discovery)).

A Voice Changer Pro convert (`POST /v1/voice-changer-pro`) is priced the
same way: each recast voice is priced in base units and the convert is
charged the sum, rounded once, so per-voice prices do not add up to it.
Its exact price is the identifier `voice-changer-pro:<slot>,<slot>,…`, one
slot per recast voice — `sts-<seconds>` (a speech-to-speech voice, by its
stem length), `respeak-<characters>` (a Re-speak voice on v3),
`respeak-v4-<characters>` (on v4), `respeak-v4t-<characters>` (on v4,
speaking a translation — send the transcript's characters; the server adds
the allowance for a re-rendered line), or the bare kind for an unknown
measure — for example `voice-changer-pro:sts-26.76,respeak-v4-1200`. Both endpoints answer it with
the credits the convert reserves; more than 8 slots, a stem past an hour or
a malformed slot lands in `missing`. See
[Voice Changer Pro](./nodes/ai-audio/voice-changer-pro.md#credit-pricing).

| Query param | Values | Purpose |
|---|---|---|
| `kind` | `image` / `video` / `audio` | Filter to one media kind. |
| `mode` | e.g. `t2i`, `i2v`, `t2v`, `tts`, `video-analysis` | Filter by operation. |
| `family` | string | Vendor / lab name, e.g. `Google`, `Bytedance`. |
| `featuredOnly` | boolean | Featured models only. |

### Edit Plan modes

`GET /v1/edit-plan/capabilities` — the [Edit Plan](./nodes/processing-video/edit-plan.md)
modes this server can plan. Authenticated; `Cache-Control: private, no-store`
(a server update can change the answer).

```json
{ "modes": ["tighten", "clips", "chapters", "trailer"], "source": "server", "perMinute": true }
```

`perMinute` says whether this server charges Edit Plan **per started minute**
of the recording (`true`) or at the 15/30/60/90/120/180-minute step its length
rounds up to (`false`, and on a self-hosted install). The editor's estimates
follow it; the formula and examples are on the
[Edit Plan](./nodes/processing-video/edit-plan.md#credit-cost) page. A client
that predates the field can ignore it.

`tighten`, `clips` and `chapters` are always listed. `trailer` is listed only
when the server can plan a trailer; until then the editor greys the Trailer
option out, with a reason that depends on `source`, which says who answered:

| `source` | Who answered | Reason the editor shows |
|---|---|---|
| `server` | This server: nodaro.ai, or a self-hosted install that is not connected | "needs a plugin update" |
| `nodaro.ai` | A self-hosted install connected to nodaro.ai, with nodaro.ai's answer | "Available once nodaro.ai supports it" |
| `nodaro.ai-unreachable` | A self-hosted install connected to nodaro.ai that can't reach it | "Couldn't reach nodaro.ai — try again later" |

A mode the server does not list, and a
mode that is not one of the four, is refused before anything is charged, on
every lane, except Trailer on a self-hosted install connected to nodaro.ai that
can't reach it, where the job is retried instead (see below). Every refusal
carries one message (for Trailer: *Trailer mode is not available on
this server yet. Choose another mode, or try again after the next update. You
were not charged.*):

- `POST /v1/edit-plan` answers `400` with
  `{ "error": { "code": "mode_not_available", "message": "…" } }` before any
  credits are reserved. The check applies to a `mode` the request sends.
- A workflow or app run fails the Edit Plan node. An unknown mode fails before
  any credits are reserved. On nodaro.ai, a run in Trailer mode is refused
  until the server plans trailers, and any reservation is refunded.
- The MCP `plan_edit` tool refuses before dispatch and names the modes the
  server plans.

On a self-hosted install (Community, Business) connected to nodaro.ai, Edit
Plan runs on nodaro.ai and is charged to the connected nodaro.ai account, so
the install answers with the modes nodaro.ai plans: it asks nodaro.ai's
`GET /v1/edit-plan/capabilities` over its existing connection and reuses the
answer for up to a minute. `trailer` is listed there as soon as nodaro.ai plans
trailers, and Trailer is refused there only when nodaro.ai answers that it
does not plan trailers yet. When nodaro.ai can't be reached, the install lists
only `tighten`, `clips` and `chapters` (`source: "nodaro.ai-unreachable"`), but
it does not refuse a run in Trailer mode: the outage is temporary. `POST
/v1/edit-plan` and MCP `plan_edit` create the job, and the job is retried under
the usual job retry policy, failing with *could not reach nodaro.ai* only when
nodaro.ai still can't be reached on the last attempt. Nothing is relayed to
nodaro.ai until the install has asked it which modes it plans, so nothing is
charged to the connected nodaro.ai account for a failed attempt. An unknown
mode is still refused at once. An install that is not connected lists the same three modes,
and cannot run Edit Plan at all until it connects.
The editor asks this route again when an Edit Plan node's settings open or the
browser tab regains focus, at most once a minute, so a change in the answer
shows up without a page reload.

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
- **`minimax-h3`** (MiniMax H3) takes the same reference fields with the
  same 9 / 3 / 3 caps and renders at `resolution: "2K"` (default) or `"768P"`
  (the cheaper per-second rate) — any other resolution value renders and bills
  as 2K. `aspectRatio: "adaptive"` is the default; a pure text-to-video call
  needs a concrete ratio (adaptive coerces to 16:9 there). Reference audio
  must ride with an image or video reference; input images beyond the first 5
  add a per-image surcharge.
- **`wan-3` / `wan-3-prime`** (Wan 3.0 / Wan 3.0 Prime) take
  `referenceImageUrls` (≤ 10), `referenceVideoUrls` (≤ 5) and
  `referenceAudioUrls` (≤ 5); every reference video and audio clip is 1–15 s
  with a ≤ 15 s combined cap per media type (the per-clip **audio** cap is the
  only one checked before submission; the video caps are the provider's and
  surface mid-run). On the Wan wire the reference arrays are mutually exclusive
  with the start/end frame fields (`imageUrl` / `endFrameUrl`), so — exactly as
  on Seedance 2 and MiniMax H3 — sending both **folds** rather than fails: the
  frame is appended to `referenceImageUrls` after your own images (their
  ordinals are unchanged) and named in the prompt as the opening/closing frame.
  The two are never sent together and the call is not rejected.
  `duration` is a whole number of seconds from **2 to 30** (default 5); with
  a reference video wired, input duration + output duration must be ≤ 30 s.
  `resolution` is `480p` / `720p` / `1080p` —
  send the lowercase display value like every other model; the provider's own
  enum is uppercase and the platform normalizes it for you, and an omitted or
  unsupported value renders and bills at **720p**. `aspectRatio` defaults to
  `"adaptive"` and the model's own set is `adaptive` / `16:9` / `4:3` / `1:1` /
  `3:4` / `9:16` (no `21:9`). Prime is the faster, pricier SKU on an identical
  schema. Reference-video runs bill output seconds only — there is no
  input-duration surcharge on Wan 3.0.
- **`vidu-q4`** (Vidu Q4) has **no text-to-video mode**: it needs an
  `imageUrl` (start frame) or at least one `referenceImageUrls` entry, and
  `POST /v1/text-to-video` answers `image_required`. One id serves two
  provider endpoints, picked by what you send: `imageUrl` alone animates that
  frame (`prompt` optional; the output keeps the frame's shape, so
  `aspectRatio` is ignored); any `referenceImageUrls` (≤ 15) or
  `referenceAudioUrls` (≤ 3) selects reference mode, where `prompt` is
  **required** (an empty one is a `400` before anything is reserved),
  `aspectRatio` is `16:9` (default) / `9:16` / `1:1` / `4:3` / `3:4`, and an
  `imageUrl` sent alongside is appended to the reference images after your own
  and named in the prompt as the opening frame. Reference audio must ride with
  an image, and must be **MP3, 3–12 s per clip** — any other format or length
  is refused before the job is created (`audio_format_unsupported`,
  `audio_too_short`, `audio_too_long`). No `referenceVideoUrls`, no
  `endFrameUrl`, no `seed`. `duration` is a whole number of seconds from **3 to
  16** (default 5) and `resolution` is `540p` / `720p` / `1080p` / `2k` / `4k`
  (`2K` / `4K` accepted); an omitted or unsupported resolution renders and bills
  at **720p**. Priced per second on one ladder for both modes and audio on or
  off (see the [Generate Video node](nodes/ai-video/generate-video.md)); the 4K
  tier is not available on the free tier.
- **`gemini-omni-flash`** takes exactly the same fields as
  `gemini-omni-video` on the same 720p / 1080p / 4K tiers, the same 4 / 6 / 8 /
  10 `duration` menu (an omitted duration renders and bills as 8 s), the same
  16:9 / 9:16-only `aspectRatio`, and the same 7-unit input quota (each image
  1 unit, a source video 2). It is the cheaper, faster SKU of the pair.
- **Frames + references coexist** (Seedance 2 and MiniMax H3 — **not** Wan 3.0,
  whose arrays are exclusive, see above). When any reference (image / video /
  audio) is wired alongside a start/end frame, the frames become
  prompt-directed `Image N` references rather than pinned endpoints — the
  resolver decides the mode, there is no toggle.
- **Reference videos are billed `unit × (input + output)` duration.** The
  runtime ffprobes each `referenceVideoUrls` clip and scales the per-second
  `-ref` rate (see the [Generate Video node](nodes/ai-video/generate-video.md)
  for the live per-resolution rates) by the input-video duration plus the
  output duration, so longer source clips reserve proportionally more credits.

### `{image:N}` tokens on the image routes

On `POST /v1/generate-image` (MCP `generate_image`) an `{image:N}` /
`{image:N:label}` token in `prompt` addresses the N-th reference image:

- **Without connected references** (no `connectedReferences`, an empty list, or
  only `describedReferences` / MCP `described_references` beside your photos),
  N counts the flat `referenceImageUrls` in order — `{image:1}` is the first URL
  you sent.
- **With at least one `connectedReferences` entry**, N counts the
  `connectedReferences` entries, in order. Flat `referenceImageUrls` sent in the
  same request are still attached (ahead of the connected ones), but `{image:N}`
  does not address them: to name a photo in the prompt, pass it as a
  `connectedReferences` entry rather than in `referenceImageUrls`.
- A token with no image at its position renders as its label (`{image:1:person}`
  reads as `person`); a bare `{image:1}` is left out.

The canvas editor and a workflow run number tokens the same way. An image that
reaches a Generate Image node only through a passthrough node (a Text node in
between) is sent and addressed as `{image:1}` on both.

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
  **Gemini Omni** / **Kling 3 Omni** / **Grok i2v** (7), **VEO 3.1 Fast and
  Lite** (`veo3.1` / `veo3_lite`, 3). **VEO 3.1 Quality (`veo3`) is not on the
  list** — the provider serves reference-to-video on Fast and Lite only, so
  references sent with `veo3` are ignored and the run proceeds with its frames.
  This set is kept in lock-step with the model catalog by a drift guard, so it
  can't silently fall out of sync.
- **References-only runs (no `imageUrl`).** On `POST /v1/generate-video` the
  start frame is optional whenever at least one supplied reference kind is
  supported by the selected provider (per the caps above) — e.g. Kling 3 Omni
  with `referenceImageUrls` alone. VEO 3.1 Fast / Lite references-only runs
  are auto-normalized to `REFERENCE_2_VIDEO`, so passing `generationType` is
  not required; `veo3` (Quality) carries no references, so a references-only
  run on it still needs `imageUrl`. Reference kinds the provider can't carry don't lift the
  requirement: a provider with no reference support still needs `imageUrl`,
  and e.g. audio-only references on an images-only model are rejected with a
  400 rather than silently dropped. An **end frame alone** is accepted the same
  way on the models that fold it into their references (Seedance 2.x, MiniMax
  MiniMax H3, Wan 3) — send `endFrameUrl` once, without repeating the same
  picture in `referenceImageUrls`. That membership is the exported predicate
  `videoProviderFoldsLoneEndFrame(provider)` in
  [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared) — the same
  one this route reads, so a client can gate its own UI on it instead of
  hand-mirroring the family list.
- **`image_required` vs `validation_error` on a missing start frame.** When
  `POST /v1/generate-video` gets no `imageUrl`, no `REFERENCE_2_VIDEO`
  `generationType` and no reference kind the provider can carry, the response
  depends on the model. Any model whose catalog `modes` omit `text-to-video`
  (e.g. Kling 3 Omni, HappyHorse Ref2V, Hailuo 2.3 — the set is derived, so
  `GET /v1/models` is the authority, not this list) returns
  `400 image_required` naming the model; every other provider returns
  `400 validation_error` telling you to use `POST /v1/text-to-video` for a
  prompt-only run. The `image_required` message also says whether references
  are an alternative for that model — derived from the same reference caps the
  guard above uses, so a model with no image-reference capability is told it
  needs a start frame.
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

### Described references (`describedReferences`) — a name you have no picture for

`POST /v1/generate-image`, `POST /v1/generate-video`, `POST /v1/text-to-video`
and `POST /v1/extend-video` also accept an optional `describedReferences` array
— up to **10** entries of `{ name, description }` (name ≤ 80 chars, description
≤ 2000). It is the channel for a subject you can NAME and DESCRIBE but have no
media for: a cast role no entity is bound to yet, a character that exists only
in the script, a slot a video analysis identified.

- **No url, so nothing is attached.** A described reference consumes no
  image-reference budget and claims no `@image_N` seat; the numbering of your
  `connectedReferences` is untouched.
- **It reaches the model as prose** — one `<Name> — <description>.` line per
  entry, alongside the reference directives the route assembles. Correlation is
  BY NAME: leave the name in your prompt text (`Natalie walks down the pier.`)
  and the line tells the model who Natalie is. Do NOT write an `@name:1` mention
  for a described reference — that grammar addresses an attached image.
- **It is a reference channel on its own.** Send `describedReferences` with no
  `connectedReferences` at all and the route still assembles — that is the
  normal case for a story that has been written before any entity exists.
- **Entries missing a name or a description are dropped**, and a repeated name
  renders once. An empty list behaves exactly like omitting the field.
- On `POST /v1/extend-video` described references are NOT gated on the
  reference-capable transport the way `connectedReferences` are: they carry no
  url, so every extend provider accepts them.

### Per-use descriptions (`descriptionOverride`) and rail captions

Two smaller channels for the same problem — telling the model what a reference
IS, for this run only:

- **`descriptionOverride` (per `connectedReferences[]` entry, ≤ 2000 chars).**
  The reference's identity description for THIS run. It fills the description
  slot the assembled directive already has, winning over the entity's stored
  canonical description and over the entry's own `description` (which stays the
  reference's label). Where the hybrid reference format renders no description
  at all, it adds one `reference image A — <text>.` / `@image_1 — <text>.` line —
  so the model is told once, never twice. Omit it and the entity's own wording
  is used, exactly as before.
- **`referenceVideoCaptions` / `referenceAudioCaptions` (`POST /v1/generate-video`
  and `POST /v1/text-to-video`, each entry ≤ 500 chars).** Captions for the
  video / audio rail references, **index-aligned** with `referenceVideoUrls` /
  `referenceAudioUrls` — `referenceVideoCaptions[0]` describes
  `referenceVideoUrls[0]`. Each renders as `@video_N: <caption>.` /
  `@audio_N: <caption>.`, and the list is bounded by the number of rail
  references that actually ship, so a caption can never bind a slot the payload
  dropped. Leave an entry blank to skip it without breaking the alignment.
- **`characterReferences` (`POST /v1/generate-video` and `POST /v1/text-to-video`,
  up to 3).** Identity inputs that keep a real person's face on models with a
  dedicated character channel — today `gemini-omni-video` and
  `gemini-omni-flash`. Each entry is `{ imageUrl, description, bodyImageUrl?,
  name?, voice? }`: a portrait URL, a description of the person (appearance, clothing,
  style; ≤ 2000 chars), an optional full-body image and an optional name (≤ 100
  chars). Unlike `referenceImageUrls`, which a multimodal model treats as loose
  context, this is the input that holds the face. Any other model answers `400`
  `character_references_unsupported`; combining it with a start frame (`imageUrl`) or an end frame (`endFrameUrl`)
  answers `400` `character_references_with_start_frame` /
  `character_references_with_end_frame` (a current Nodaro limit); and the request must fit
  the model's 7-unit input budget — `images + 2 × videos + characters ≤ 7`, a
  character counting 1 unit (2 with a `bodyImageUrl`) — or it answers `400`
  `character_references_quota`. It adds no credit charge. The references are
  recorded on the job's input. `voice` — `{ preset, description?, exampleLine? }`, `preset` one of the 30
  Gemini voice ids — pins one voice to that character across clips (up to 3
  distinct voices a request, else `400` `character_voices_over_limit`; `description` ≤ 2000 chars, `exampleLine`
  ≤ 120); see [Pinning a voice](nodes/ai-video/generate-video.md#pinning-a-voice-to-a-character-reference) for the presets. See [Character references
  (Gemini Omni)](nodes/ai-video/generate-video.md#character-references-gemini-omni).

### Naming an image reference in the prompt (`@<name-slug>:<index>[:<role>]`)

On `POST /v1/generate-image` a **media** reference (`source: "wired-image"` or
`"manual"`) can be addressed inline by the slug of its name, the same way
characters and locations already are — so you can say *where in the sentence*
the picture belongs instead of relying on the trailing auto-attach block.

- **The slug is derived from the entry's `defaultName`**, lower-cased with every
  run of non-alphanumerics collapsed to a single `-` (`"Old Town"` →
  `old-town`). There is no separate slug field to set, and nothing changes on
  the wire: give the reference a name and it becomes mentionable.
- **Grammar:** `@<name-slug>:<index>` renders that reference's binding at the
  position you typed it (`reference image C`); `@<name-slug>:<index>:<role>`
  renders the role phrase (`the background from reference image C`). The
  `<index>` is a **correlation number only** — it is never echoed into the
  prompt, and the platform binds by its own numbering walk, so you never
  compute a seat.
- **Roles** are the curated media set — `object`, `person`, `face`, `clothes`,
  `background`, `style`, `pose`, `texture` — or any custom single-word role,
  which passes through verbatim. Omit the role and the entry's own
  `defaultRole` applies; with neither, you get the bare binding.
- **`~lock` / `~nolock`** work here exactly as on character and location
  mentions (`@town:1:background~lock`): a trailing sentinel forces that
  reference's identity lock on or off for that mention.
- **Precedence is character → location → image → creature → object.** A name
  shared by a character and an image resolves as the character. Duplicate names
  within one kind bind first-wins.
- **A name that can't be a slug is never mentionable** — `"3D Render"` slugs to
  `3d-render`, which starts with a digit and is outside the grammar, so no
  token can bind it. Rename the reference to mention it.
- Honored when the route assembles in the hybrid reference format. Under the
  legacy format the token stays literal text and the reference auto-attaches
  exactly as before. A token whose reference was capped out by the provider's
  image-reference limit likewise stays literal.

Mentioning a reference **re-seats** it: its URL moves from the trailing
auto-attach block into the mention block, which re-letters the references after
it. That is the point of the feature — the letters follow the sentence.

### Naming a creature or object in the prompt (same grammar)

`source: "wired-creature"` and `source: "wired-object"` entries use the **same
grammar**, the same slug derivation from `defaultName`, the same `~lock` /
`~nolock` sentinels, and the same hybrid-only, capped-ref and unmentionable-slug
rules as the media mention above. Two things differ:

- **The roles are the entity sets** — creature: `creature`, `anatomy`,
  `markings`, `pose`, `color`, `style`; object: `object`, `shape`, `material`,
  `color`, `texture`, `style` — or any custom single-word role, verbatim. Omit
  the role and the entry's `defaultRole` applies; with neither you get the
  source default, `the creature from …` / `the object from …`.
- **A mention SUPPRESSES that entry's trailing auto-attach phrase.** Unlike a
  media reference, an unmentioned creature or object already contributes a
  trailing line (`the creature from reference image D`). Without a mention the
  entity's *name* sits in your prose as plain text while its binding dangles at
  the end — two halves of one intent. Mention it and the phrase renders once,
  inline, where you typed it.

```jsonc
{
  "prompt": "a wide shot of @nessie:1 rising beside @dock:2:material",
  "connectedReferences": [
    { "id": "cr-1", "defaultName": "Nessie", "source": "wired-creature", "url": "https://…/nessie.png" },
    { "id": "ob-1", "defaultName": "Dock",   "source": "wired-object",   "url": "https://…/dock.png" }
  ]
}
// → "a wide shot of the creature from reference image A rising beside
//    the material from reference image B"
```

### Reference lock (`referenceLock`) on generate-image

`POST /v1/generate-image` accepts an optional `referenceLock` token — an id,
not text — that opts a run into the platform's measured reference-compliance
wording, prepended ahead of the scene it governs (hybrid reference format):

- `"standard"` — default-deny + likeness + compose (the population winner in
  the platform's measurements). Reach for it on multi-reference composition.
- `"multi-person"` — adds the face clauses (never alter face structure, never
  blend faces). Reach for it when two or more faces are in play and elements
  cross between them; on a single subject it is dead weight.

Free-text lock wording is deliberately not accepted: the wording is
platform-owned and improves without a client release. Omitting the field keeps
the platform-wide default — no lock is ever injected unrequested. Under the
legacy reference format the token is accepted but inert.

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
  the `temporal*` keys, `transition`, `loopSubject` — which fold on the video
  routes; see [the next section](#cinematic-direction-on-the-video-routes).)
  Valid ids come from
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
- **Your own palettes and moodboards.** `colorLook` also takes
  `"palette:<id>"` (its colours, named, go into the prompt) and `style`
  `"moodboard:<id>"` (its description goes into the prompt and its images go
  to the model as style references, after your own references and up to the
  model's limit). Unlike a catalog id, one of these is never skipped: a
  malformed or misplaced one answers `400 validation_error`, one that is not
  yours `404 direction_not_found`, and a request that also applies a preset
  (`presetId`) answers `400 validation_error` for now — see
  [Palettes and moodboards](./palettes-and-moodboards.md).
- **The clauses land in a trailing `[style]` section**, not inline in your
  prose. The assembled prompt is your prompt (plus any `subject` clauses and
  the `structured` fragment, `". "`-joined, in that order) — then a blank line,
  then:

  ```
  [style]:
  <film line>
  <scene line>
  ```

  The **film line** carries the dimensions that describe the capture —
  `cameraFormat`, `colorLook`, `style`, `era` (and the legacy `cameraFormatId`)
  — and the **scene line** every other selected dimension. Both are
  `". "`-joined, and a line with nothing on it is omitted entirely. Telling the
  model structurally which sentences are the LOOK stops a broad direction from
  burying the shot in a dozen same-register sentences.
- **Fold order is the platform's**, not your object's key order: it decides
  which clause is rendered first within a line, and it is also the order things
  shed in (below). Repeated identical clauses collapse to one. A direction that
  renders no clause emits **no section at all** — no header, no extra newline —
  so your `prompt` comes back byte-for-byte untouched.
- **Over the provider's prompt cap, direction clauses are the first thing to
  go — never your references or your prose.** A maximal `direction` renders
  more than a low-cap model accepts (seedream = 3000 characters), so the
  assembler sheds hint clauses from the END of the fold order, one at a time,
  until the prompt fits: the dimensions the platform folds first outlive the
  ones it folds last. `subject` clauses (below) fold ahead of every direction
  clause and therefore shed last — who is in the shot outlives how it was lit. That fold order is the platform's own compatibility order,
  not a ranking of which dimension matters most — survival is position, not
  importance. Everything else outranks a hint — reference directives and
  the role phrases that bind them, `@`-mention-resolved text, your prose, the
  `structured` fragment, and the appended `Style:` / `Avoid:` lines all survive
  intact. Nothing is shed while the prompt fits, so an under-cap request is
  byte-for-byte what it always was. Only when the body still overflows with
  ZERO hints left — very long prose, or many bound references on their own —
  does the last-resort tail clamp cut mid-text and end the prompt with `...`.
  Send the dimensions that carry the shot rather than everything at once and
  you will never reach either stage. **The video routes shed the same way**, at
  much tighter caps and with one extra thing in the budget; see
  [the next section](#cinematic-direction-on-the-video-routes).

### Cinematic direction on the video routes

`POST /v1/generate-video` and `POST /v1/text-to-video` accept the SAME
`direction` object, with the same tolerance rules, the same wire bounds and the
same "absent ≠ empty" semantics as generate-image above — including the
truncation ordering, which sheds direction clauses before your prose or your
references. Three things differ — the dimension set and how motion renders,
below, and what the truncation budget has to cover (after the example). Your own
palettes and moodboards (`"palette:<id>"`, `"moodboard:<id>"`) are
generate-image only: these two routes answer `400 validation_error` for one
rather than fold nothing.

**The dimension set is the video surface.** Every look dimension listed above
folds here too, minus the seven stills-only ones (`aperture`, `shutterSpeed`,
`isoValue`, `postProcess`, `photoGenre`, `photographer`, `renderQuality`), plus
the motion dimensions: `cameraMotion`, `actionFx`, `temporalSpeed`,
`temporalFreeze`, `temporalDirection`, `temporalShutter`, `transition`,
`loopSubject`. `cameraMotion` folds FIRST, ahead of every look clause — and,
being motion, it also READS first, in the body. A
stills-only key sent to a video route is **accepted and simply contributes no
clause** — surface is a rendering concern, not a validation one — so one
client-side look map can be sent to either route unchanged.

**Motion dimensions render compact, and stay in the body.** Look dimensions
inject their full clause; motion dimensions inject their short professional term
(`"cross-dissolve"`, not the sentence describing what a cross-dissolve does).
Motion cues read better to a video model as terse directives, and video prompt
ceilings are far tighter than image ones.

That same split decides WHERE a clause reads. Camera motion is part of the
shot, not part of the look, so the motion clauses stay in the prompt body with
your prose — `". "`-joined, after it, before the `structured` fragment — and
only the look clauses lift into the trailing `[style]` section described above.
One dimension is never compact in the body and full in the section: the two
rules read the same column, deliberately, so they cannot drift apart.

```json
{
  "imageUrl": "https://…/frame.png",
  "provider": "seedance-2",
  "prompt": "she turns toward the window",
  "direction": {
    "cameraMotion": "dolly-in",
    "shotSize": "medium-shot",
    "timeOfDay": "dawn",
    "temporalSpeed": "slow-motion"
  }
}
```

The fold happens **before** reference assembly, so your direction clauses sit
inside the body that the reference resolver frames — the identity directives for
a bound character still wrap the whole description. In the hybrid reference
format the resolver extends the END of that body with a bound character's
canonical role phrase, inserted ahead of the `[style]` section: the section
stays last and carries look clauses only, so a binding never reads as one. (The
legacy format PREPENDS its character block instead, ahead of everything.)
`jobs.input_data` records both
halves: `prompt` is what the model received, `userPrompt` is the text you
submitted (empty string if you sent `direction` with no prompt at all), and
`direction` is your ids verbatim.

**Truncation is the third thing that differs — in the budget, not the rule.**
Video prompt ceilings are provider-specific and far lower than image ones (kling
clamps at 1000 characters), so a broad `direction` can exceed one on its own.
The shed described for generate-image applies here too: over the ceiling, the
route drops hint clauses from the END of the fold order until the prompt fits,
and your prose, your references and the role phrases that bind them all survive
intact. `subject` clauses ([below](#structured-subject-subject)) are in the same
budget on this surface too, folded ahead of `direction` and therefore shed last
— and a `subject`-only request is budgeted exactly the same way.

Two video-specific details are worth knowing:

- **The budget includes the reference framing.** The fold runs before reference
  assembly (above), and the resolver then ADDS text — the `Use these characters:`
  block, or, in the hybrid format, the lock lines and the canonical role phrases
  that end the body. None of it is sheddable and all of it counts, so the shed is
  decided on the length AFTER framing. Reference text is never what gets dropped.
- **The ceiling is the one the negative prompt leaves.** For a provider with no
  native `negative_prompt` parameter the negative is folded into the prompt as an
  `Avoid: …` suffix whose room is reserved FIRST, so the base prompt's real
  ceiling is `cap − suffix`. The shed budgets against that number, which means a
  longer `negativePrompt` costs you hint clauses rather than prose. The suffix is
  separated by a blank line when the prompt ends with the `[style]` section, so
  the negative never reads as a look clause.

Two things stay outside the budget and fall back to the order-blind clamp (a
bare tail cut, with no trailing `...`): the opt-in identity injection
(`injectCharacterContext`), which appends a character's canonical description
after assembly, and a body that still overflows with ZERO hints left — very long
prose, or many bound references on their own. As on the image side, nothing is
shed while the prompt fits, so an under-cap request is byte-for-byte what it
always was.

`POST /v1/extend-video` deliberately has no `direction` field: its prompt
continues an existing clip, where re-stating the look is the wrong lever.

### Structured subject (`subject`)

`POST /v1/generate-image`, `POST /v1/generate-video` and
`POST /v1/text-to-video` accept an optional `subject` object — the same
doctrine as `direction`, one channel over: a flat map of **catalog ids**
describing WHO is in the shot (the person, how they are styled, and the props
in frame) which the platform folds into the prompt as its own clauses.

```json
{
  "prompt": "on the seawall at dusk",
  "provider": "nano-banana",
  "subject": {
    "type": "woman",
    "age": "age-30s",
    "ethnicity": "east-asian",
    "hairBase": "base-short-straight",
    "makeup": "makeup-smoky",
    "outerwear": "outerwear-trench",
    "heldProp": "smartphone"
  }
}
```

- **The keys are the platform's own picker field names**, exactly as with
  `direction` — every Person dimension field (`type`, `age`, `ethnicity`,
  `frame`, `faceShape`, `eyeColor`, `hairBase`, `hairColor`, `skinTone`,
  `lipState`, `distinctiveFeature`, …), every Styling dimension field
  (`makeup`, `hairCut`, `jewelry`, `outfit`, `top`, `bottom`, `outerwear`,
  `footwear`, `fabric`, `wardrobeState`, …), the three prop keys `heldProp`,
  `material` and `animal`, and the one number below. Valid ids come from
  [`GET /v1/picker-catalogs`](#picker-catalogs) — the `person`, `styling`,
  `held-prop`, `material` and `animal` catalogs.
- **`subject` and `direction` never overlap.** The two key sets are disjoint by
  contract, so one selection can never emit two clauses. `pose` rides
  `direction`.
- **`customAge` is the one number.** Send `"age": "age-custom"` with
  `"customAge": 34` for a literal age in years; it is rounded and clamped to
  0–120. Without `age-custom` it contributes nothing.
- **Single id or an array**, with per-dimension caps the catalogs and the
  prop rows define: `jewelry`, `wardrobeState` and `distinctiveFeature` take 3;
  `ethnicity`, `regionalAesthetic`, `hairColor`, `eyeColor`, `lipState`,
  `eyeState`, `skinTexture`, `hairState`, `heldProp` and `material` take 2
  (two held props read as two clauses, two materials fold into one "made of A
  and B"); every other dimension — `animal` included — is single-pick. Over a
  dimension's cap the extra ids are dropped, not rejected. The wire
  bounds that DO reject with a `validation_error` are the same shape as
  direction's: at most **8** entries per key and **100** characters per id,
  plus at most **128** keys in the object and **64** characters per key.
- **Unknown keys are stripped and unknown ids are skipped**, never rejected —
  the same version-skew tolerance as `direction`, and the same reason to deploy
  the platform before the client that starts sending new fields. What
  `jobs.input_data.subject` records is your bag after that strip, i.e. exactly
  the ids that folded.
- **A deployment-registered person pack folds too.** Unlike `direction` (whose
  getters read the base catalogs), the person fold reads the pack-composed
  taxonomy, so a pack dimension's field is accepted and renders its clause.
- **Fold order is the platform's**, and `subject` lands ahead of `direction`:
  the subject is the noun phrase the cinematography then modifies. Subject
  clauses are BODY text — they read in your prose, never in the `[style]`
  section, because who is in the shot is not part of the look. Person
  arrives as ONE comma-joined clause and Styling as another — those catalogs
  are authored as compound clauses, not sentences. Overlapping selections
  collapse rather than doubling (picking the Person `lip-state-bold-red` and
  the Styling `makeup-bold-lips` emits the lipstick once).
- **Verbosity is per surface.** generate-image folds the full clause for every
  dimension; the video routes fold the short professional term, because the
  start frame already carries the subject's identity into the clip.
- **Absent ≠ empty**, and a `subject` that renders no clause leaves your
  `prompt` byte-for-byte untouched. Under a provider's prompt cap — on
  generate-image and on both video routes alike — subject clauses ARE shed
  candidates, exactly like direction clauses, but they are the LAST hints to
  go: the whole direction fold leaves before the first subject clause does, and
  neither channel is ever shed before your prose, your references or the
  `structured` fragment (see the direction sections above). On the video routes
  the same reference framing and negative-prompt reservation are inside the
  budget, so a subject-only fold is budgeted exactly like a direction one.

`POST /v1/extend-video` deliberately has no `subject` field, for the same
reason it has no `direction`.

### Picker catalogs

`GET /v1/picker-catalogs` and `GET /v1/picker-catalogs/:nodeType` expose the
valid values for **parameter-picker** nodes (setting, mood, person, lens, …) —
the curated catalogs whose selection contributes a descriptive clause to a
downstream node's prompt. Public, no auth, same 5-minute cache as node
discovery (`Cache-Control: public, max-age=300`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/picker-catalogs` | Directory of every picker (`{ data: PickerCatalogSummary[] }`) — each `{ nodeType, label, catalogId, kind, valueField?, fields?, optionCount, imageCount }`; `imageCount` is how many of its options carry an `imageUrl` (0 = no pictures). |
| `GET` | `/v1/picker-catalogs/:nodeType` | One picker's catalog (`{ data: PickerCatalog }`). 404 `not_found` for an unknown type. |

`GET /v1/picker-catalogs/:nodeType` accepts these query params (a bad value
returns 400 `validation_error`):

| Param | Values | Purpose |
|---|---|---|
| `detail` | `compact` (default) / `full` | `compact`: `id`, `label`, `category`, `term`, `icon`, `imageUrl` (when the option has a picture). `full`: additionally includes each option's `description` and `promptHint` (the prompt fragment it injects). |
| `category` | string | Single-dim pickers: filter options to one category. |
| `field` | string | Return only this dimension's field — multi-dim pickers (person / styling / framing), and the secondary parameters of a single-dim picker (transition / character-fx: `position` / `duration` / `intensity`; character-motion: `position` / `pace`). |

A single-dim catalog carries `options`; a multi-dim catalog carries
`dimensions` (one `{ field, label, options }` per field). A single-dim catalog
with secondary parameter fields beside its main picker — `transition` and
`character-fx` (`position` / `duration` / `intensity`) and `character-motion`
(`position` / `pace`), whose dropdowns are catalogs in their own right —
carries **both**: `options` for the picker and `dimensions` for the secondary
fields. Every option carries a
`term` at **both** detail levels — the short professional phrase to inject into
a prompt when you want a compact instruction (`"whip pan left"`), where `label`
is display-only and `promptHint` is the full mechanism sentence. It is `""` for
a no-op (`auto` / `none`) option that injects nothing. These are the same
catalogs that ship as pure data in [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared)
— prefer importing the package when you can bundle it (see
[Parameter Picker Catalogs](picker-catalogs.md)); the REST endpoints exist for
clients that can't.

#### Pictures (`imageUrl`, `sections`)

Every option that has a picture carries an **absolute** `imageUrl`, at both
detail levels, in `options` and in `dimensions[].options` alike; an option
without one simply has no `imageUrl`. These are the pictures the editor's
pickers show:

| Pickers | Picture |
|---|---|
| `person`, `styling`, `held-prop`, `material`, `animal` | A photo, WebP, up to 480px wide. |
| `music-genre`, `music-mood`, `instrumentation`, `voice-character`, `voice-delivery` | A 3D emoji (WebP, 128px) or a flag (WebP, 120px wide). |
| Look pickers (`style`, `color-look`, `lens`, `framing`, `lighting`, `mood`, `camera-format`, `camera-motion`, …) | Nodaro Cloud only: a 480px still of the rendered preview from the Nodaro CDN (a frame of the clip for `camera-motion`). A self-hosted install returns none. |

- **Host.** Self-hosted pictures are served by the installation itself under
  `/picker-art/`, so `imageUrl` uses its public address — `PUBLIC_URL`
  (Nodaro Cloud: `https://app.nodaro.ai`; a self-hosted install: its own
  `PUBLIC_URL`, e.g. `http://localhost:3000`). Use the URL as given; never
  build one from an option id.
- **Caching.** File names carry a content hash, so a changed picture gets a
  new URL; they are served with `Cache-Control: public, max-age=31536000,
  immutable` and `Access-Control-Allow-Origin: *` (usable from `<img>`,
  `fetch` and canvas on any origin).
- **Topics.** `person` and `styling` also return `sections`: the topics the
  editor groups their settings under, in order — each `{ label, fields,
  imageUrl? }`, where `fields` are the node-data fields of the settings in
  that topic (`Identity` → `type`, `age`, `ethnicity`, `regionalAesthetic`)
  and `imageUrl` is the topic's round picture.

```bash
curl -s https://app.nodaro.ai/v1/picker-catalogs/person | jq '.data.sections[0], .data.dimensions[0].options[0]'
```

```json
{ "label": "Identity", "fields": ["type", "age", "ethnicity", "regionalAesthetic"],
  "imageUrl": "https://app.nodaro.ai/picker-art/character/sections/identity.2d5ec1a4.webp" }
{ "id": "man", "label": "Man", "term": "man",
  "imageUrl": "https://app.nodaro.ai/picker-art/character/person/man.441363db.webp" }
```

A look picker on Nodaro Cloud (`/v1/picker-catalogs/mood`):

```json
{ "id": "happy", "label": "Happy", "category": "positive", "term": "happy expression",
  "imageUrl": "https://cdn.nodaro.ai/cdn-cgi/image/width=480,format=auto,quality=80/images/710df65a-3c1e-485b-b8b7-29f7b3baf479.png" }
```

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
| `GET` | `/v1/catalogs` | Every registered catalog: `{ curated, packs, version, data? }`. `data: ProjectedCatalog[]` is present only when the deployment registered catalog packs (`curated: true`); with none (`curated: false`) the catalogs are the bundled ones, served per picker by `/v1/picker-catalogs/:nodeType`. |

Query param (a bad value returns 400 `validation_error`):

| Param | Values | Purpose |
|---|---|---|
| `detail` | `compact` (default) / `full` | `compact`: `id`, `label`, `category`, `term`, `icon`, `imageUrl` (when the option has a picture). `full`: additionally includes each option's `description` and `promptHint`. |

Each `ProjectedCatalog` is `{ nodeType, label, catalogId, kind, valueField?, defaultValue?, categoryOrder?, categoryLabels?, detail, options?, fields?, dimensions?, sections? }` — single-dim catalogs carry `options`; multi-dim catalogs carry `dimensions` (one `{ field, label, options }` per field); a single-dim catalog with secondary parameter fields (`transition`, `character-fx`: `position` / `duration` / `intensity`; `character-motion`: `position` / `pace`) carries both. Each option is `{ id, label, category?, term, icon?, imageUrl?, description?, promptHint? }` — `imageUrl` and `sections` follow the [picture rules above](#pictures-imageurl-sections); `term` rides at **both** detail levels so a thin client can render `label` and inject the compact professional term without a second `detail=full` fetch. The shape is deliberately tag/policy-free.

### Text → pickers (AI Fill)

`POST /v1/text-to-picker` fills pickers from a free-text scene/shot
description — the "AI Fill" behind Nodaro Cine. Authenticated,
credit-billed (an LLM call; same credit id as describe-to-picker).

Body: `{ text, targetPickers?, instructions?, origin?, llmModel?,
reasoningEffort? }` — omit `targetPickers` to analyze ALL analyzable
pickers (the server fans out per family and merges). With no `llmModel` and
no `reasoningEffort` the run is Claude Opus 5.5 at `"high"`, the same default
as describe-to-picker: it runs on Anthropic's own API and bills
`describe-to-picker:premium-direct` (28 credits<!-- credits: describe-to-picker:premium-direct -->, one charge however many
batches it fans out to). Another model with no effort keeps Auto (see
[Describe to Picker — Credit Cost](nodes/ai-image/describe-to-picker.md#credit-cost)). Returns
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
`anyOf` / `oneOf` of concrete types (both convert to a union, below the root
only), `minimum` / `maximum` / `minItems` / `maxItems` /
`minLength` / `maxLength`, `multipleOf`, `exclusiveMinimum` and `description`.
`not`, `if` / `then` / `else`, `dependent*` and external `$ref` are refused
with 400, and so is `anyOf` / `oneOf` / `allOf` **at the top level** — the
root must be a plain object (that is what a forced-tool schema is to the
provider); put the alternatives under a property. One caveat worth reading twice:
**below the root**, an `anyOf` of bare `required` branches — the usual "at
least one of these fields" idiom — is **accepted and not enforced** (at the
root it is refused like any other combinator). Express cross-field rules in
your own validator.

Returns `{ jobId, output, usage: { inputTokens, outputTokens } }`, where
`output` has your schema's shape. `maxRetries` (0–3, default 2) is how many
times an invalid answer is fed back to the model together with its validation
error before the call gives up; `maxTokens` must not exceed the chosen model's
own output limit (400 otherwise). The two sampling levers are **not
symmetric**: `maxTokens` applies on every call — a deliberate departure from
the LLM routes that put both levers behind the Advanced-mode gate —
while `temperature` is **silently ignored** unless you also send
`advancedMode: true`. Advanced mode pins the call to the vendor's own API,
where those levers take effect, and therefore bills **one credit rung up** (a premium model moves to its premium-direct price);
asking for it on a model with no direct lane is a 400
`advanced_mode_unsupported`. The call is
**synchronous and a single call may run several minutes**: each attempt is
allowed up to 240 seconds *per provider lane*, and a call that cannot reach its
primary lane falls back to one alternate, so the ceiling is
`(maxRetries + 1) x 2 x 240 s` — 24 minutes at the default `maxRetries: 2`, 32 at
the maximum. Give your HTTP client a timeout sized against that, or use the
asynchronous twin below and stop holding a connection open.
Errors: 400 `validation_error`, 401, 402 (credits), 500 `internal_error` (the
job row could not be created), 502 `llm_error` once the retries are spent, 503
`provider_unavailable`. SDK: `client.llm.structured(body)` — mind the client's
`timeoutMs`: the default 60 s is far shorter than this call can run, and even
`timeoutMs: 300_000` only covers a fast draft, not the ceiling above. Size it
against your own `maxRetries`, or use the asynchronous twin below.

### Asynchronous structured drafts (`POST /v1/llm/structured/jobs`)

The same call as a job. `POST /v1/llm/structured/jobs` takes the body above
plus three optional fields and answers `{ jobId }` at once. Poll
`GET /v1/jobs/:id/status`: on `completed`, `output_data` is
`{ output, inputTokens, outputTokens }` with `output` in your schema's shape;
on `failed`, `error_message` says why. The row is yours to find again —
`GET /v1/jobs?type=llm-structured&origin=<your slug>` lists every draft you
started — so a client can leave and come back. (The synchronous route stores
its result on a job row too, but only tells you the id with the answer.)

- `label` (≤ 120 chars) — a display label stored on the job, for run lists.
- `videoUrl` — draft **from a video**. The platform analyzes it first through
  `POST /v1/video-analysis` (the same probe, duration policy, tiers and price
  as calling it yourself; the analysis is a separate job you also own,
  `output_data.analysisJobId`) and appends the analysis — compact JSON with
  its server-derived fields removed — to your `input` before the LLM call.
  While the analysis runs `output_data.stage` is `"analyzing"` and `progress`
  mirrors it; then `"drafting"`. The finished row carries `analysisJobId`
  and `analysisCredits` beside the output.
- `videoAnalysis` — `{ llmModel?, selectionMode? }`, handed to the analysis
  route unchanged (its tier names and vocabulary; only with `videoUrl`).

Credits: the LLM step is reserved at creation under `llm-structured:<tier>`,
exactly as the synchronous route; a movie run's analysis is reserved by the
analysis route under its own id. Errors at creation: the synchronous route's
400 / 401 / 402 / 503, plus — when `videoUrl` is set — the analysis route's
own answers, verbatim: `422 video_too_long` / `live_stream_not_supported` /
`invalid_video_duration`, or `402` for the analysis price; in every refused
case nothing stays reserved — a refused analysis refunds the parent's
reservation. Cancelling the draft
(`POST /v1/jobs/:id/cancel`) cancels a still-running analysis with it; a
finished analysis stays. A retry is a new job. On an instance that proxies
its LLM calls to nodaro.ai the route answers `503 provider_unavailable` —
use the synchronous route there. SDK: `client.llm.structuredJob(body)` and
`client.jobs.list({ type: "llm-structured", origin })`.

### Direct uploads

`POST /v1/upload` (multipart: `file` + `type` of `image` / `video` /
`audio`) stores a file on the instance's media host and returns its URL.
Accepted audio formats include MP3, WAV, M4A/AAC, OGG, WebM and FLAC
(`audio/flac` / `audio/x-flac`); size caps are enforced per media type
(50 MB for audio and for JSON). One exception: a Speaker Frames face-track
file — JSON whose multipart `purpose` field, sent before `file`, is
`speaker-tracks`, and whose content is a face-track set — is taken up to
64 MiB, the size a track file may be; a connected self-hosted install sends
its track files this way when it relays a Speaker View render. The SDK wraps this as `client.uploads`; MCP clients use
`prepare_audio_upload` / `request_audio_upload` and friends.

**The declared content type does not have to be the canonical one.** The
server resolves the part's `Content-Type` before validating it: parameters are
stripped (`audio/webm;codecs=opus` → `audio/webm`), well-known vendor
spellings map to the format they mean (`audio/vnd.dlna.adts` — what Windows
calls a plain `.aac` — → `audio/aac`; `image/jpg` → `image/jpeg`;
`video/mov` → `video/quicktime`), and an uninformative type
(`application/octet-stream`, or none at all) is resolved from the **filename
extension**. A type that still resolves to nothing we accept is rejected with
`400 validation_error` listing the accepted formats. The resolved type is what
comes back as `mimeType` and what the stored object is served as.

**MP4 and MOV videos are stored with their index in front ("faststart").**
A recording from OBS or a phone often keeps the MP4/MOV index (the `moov`
box) at the end of the file, so the first seek into a large upload has to fetch
the tail first. Every video upload lane — `POST /v1/upload`, the proxy PUT
behind `prepare_video_upload`, the handoff page and widget behind
`request_video_upload`, and the server-side import of a recording URL —
rewrites such a file once, before it is stored, by copying its streams into a
new container: no re-encode, the picture and sound are byte-identical, and the
duration and stream count are checked against the original. A file that is
already faststart, fragmented, or not an MP4/MOV is stored exactly as sent, and
so is any file the rewrite does not verify, has no room to run (it needs
free disk of at least twice the file's size), or arrives while the server is
already rewriting its limit of files at once. Because a
rewritten file is re-wrapped, the stored size can differ slightly from the
number of bytes you sent: `sizeBytes` (and the byte count the upload returns) is
always the stored object's final length, so do not compare it to your local
file size or checksum. Files uploaded before this change are not rewritten. A self-hosted install can turn the rewrite off with `UPLOAD_FASTSTART_ENABLED=false` (see the deployment guide); every upload is then stored exactly as sent.

### Your media library

`GET /v1/library` lists your media, newest first: by default the files you
saved to your library plus the shared library; with `owned=true`, every file
you own (uploads and generations, saved or not). Query:

| Param | Meaning |
|---|---|
| `type` | `all` (default), `image`, `video` or `audio`. |
| `q` | Search: only the files whose filename contains every word of `q` (up to 5), ignoring case — the [`q` rule](#search-q) of the entity lists. Every character of a word is matched as itself (`%`, `_` and `*` are not wildcards); a blank `q` is no search; up to 200 characters. `search` is the earlier name of this parameter and still works. A `q` that is not blank wins over `search`; a blank `q` counts as no `q`, so `?q=&search=poster` searches for `poster`. |
| `owned=true` | Every file you own instead of the library view. |
| `source` | Only media from one surface: `internal`, `mcp`, `app`, `cli`, `sdk`, `extension`, `web` or `api`. Files from before origin tracking have none, so they appear only when this is left out. |
| `limit` | Page size, 1–100 (default 40). |
| `cursor` | The `nextCursor` of the previous page. |

The answer is `{ data, nextCursor, totalCount }`: each item carries `id`,
`type`, `filename`, `mimeType`, `sizeBytes`, `url`, `thumbnailUrl`,
`metadata`, `isLibraryItem`, `uploadSource`, `source`, `sourceDetail`,
`jobId` (the job that made the file; `null` for an upload) and `createdAt`; `nextCursor` is `null` on the last page; `totalCount`, the number
of matching files, comes with the first page only. SDK:
`client.library.list(params)`. The MCP tool `browse_uploads` reads the
`owned=true` view, with the same filename search as its `search` argument.

Saving a file to your library (`POST /v1/library/save-generated`, body
`{ url, type }`) takes a file on Nodaro storage only when it is yours: one of
your generations, a file you uploaded, or one in your upload folder. Any other
file on Nodaro storage is refused with `403 forbidden`, the same answer whether
or not the file exists. A link to any other site is saved as given. A permanent
delete of a library item removes its stored file only under the same rule (see
"What a permanent delete removes from storage" in the objects section).

#### Linking a user to one file

To send a signed-in user to one file in the app's file library (My Files),
link to `/library` with one of two query parameters:

| Link | Opens |
|---|---|
| `https://app.nodaro.ai/library?job=<jobId>` | The file that job made: the `id` your generation call returned. |
| `https://app.nodaro.ai/library?asset=<assetId>` | That file: an `id` from `GET /v1/library?owned=true`. (Without `owned=true` the list also holds shared library items owned by someone else, which My Files never shows.) |

The page shows "Looking for the file…" while it searches, then scrolls to the
file, marks it and opens its preview. It looks through the user's newest
1,000 files or so (25 pages of the list); a link to an older file opens My
Files without it. When the file cannot be shown, a short message says why and
the page opens as usual: the id is unknown or not the user's, the job is
still running, or the job failed or made no file. If the lookup itself fails
(a server error or no connection), the message says to try the link again
rather than that the file is gone. Changing the type filter while it looks
stops the search. The parameter is removed from the address once read, so a
refresh or Back does not open it again. A user who is not signed in signs in
first and then lands on the file. A self-hosted install answers the same
paths on its own address.

### Media processing (free, synchronous)

`POST /v1/media/process` cuts or crops a stored file: body
`{ sourceUrl, type: "video" | "audio", trim?: { startTime, endTime }, crop?: { x, y, width, height }, format?, deleteSource? }`,
answer `{ data: { url, thumbnailUrl, assetId, sizeBytes, mimeType, metadata } }`.
`deleteSource: true` removes the source object afterwards when it is yours
and nothing else references it — the cut replaces the original. The free
sibling of the priced `trim-video` node. SDK: `client.media.process(input)`.

## 12. Credits (Cloud edition)

Three endpoints surface the caller's credit balance and transaction
history. All three are **Cloud-edition only** — on Community/Business they
are not registered and return 404.

| Method | Path | Query | Purpose |
|---|---|---|---|
| `GET` | `/v1/credits/balance` | — | Return `{ total, subscription, topup, tier, effectiveTier }`. `total = subscription + topup`. `effectiveTier` is the entitlement tier actually enforced — `"payg"` = no subscription but purchased credits (all models unlocked, no watermark, no daily cap). On a deployment-payer instance this is the caller's own pool, which does not fund their runs — read the allowance below instead. |
| `GET` | `/v1/user/credits` | — | The fuller balance payload. On a deployment-payer instance it adds `allowance: { granted, remaining, enforced } \| null` — the caller's per-user allowance in credits, `enforced` telling you whether the deployment refuses runs beyond it (`false` = shown, not enforced). `null` for the billing account itself (it holds the real pool) or when the figure could not be read; never treat `null` as zero. |
| `GET` | `/v1/credits/transactions` | `limit` (1–50, default 20), `cursor` (ISO timestamp for page-forward) | Return `{ data: Transaction[], nextCursor }`. Cursor is the `created_at` of the last row; pass it as `?cursor=` on the next request. `nextCursor` is `null` when there are no more rows. |

**The welcome offer.** While a deployment has the welcome offer switched on,
`GET /v1/user/credits` carries `welcomeOffer: { popupSeen, consentPending, credits }`
beside `freeGrantState`; the key is absent while it is off (no popup, no banner,
no block). `credits` is the number of credits a claim grants — show that figure
rather than a constant, so the offer follows the server when the grant changes.
Two writes answer it:

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/v1/credits/welcome-offer/claim` | `{ sourceApp?, browserKey?, deviceKey? }` (all optional; a malformed value is stored as absent, never a 400) | The user's "yes": records the marketing-email consent, then claims the free signup grant with it. Returns `{ consent: "granted", grant, credits }` — `grant` is where the free grant stands afterwards — `"granted"` (the grant has landed: this claim topped the subscription credits up to `credits`, or it had landed before), `"withheld"` (the abuse checks refused it), `"revoked"` (taken back earlier; the claim moves nothing) or `"unclaimed"` (nothing moved, e.g. the consent was not yet visible to the claim — treat it as a failure and let the user retry). `credits` is the grant's figure: a grant tops the subscription credits UP TO it, it is not added on top. An account already decided only has its consent recorded. Rate limited to 10 a minute. |
| `POST` | `/v1/credits/welcome-offer/seen` | — | Records that the one-time popup was shown (`welcomeOffer.popupSeen` turns `true`); the first stamp wins. Returns `{ ok: true }`. Rate limited to 10 a minute. |

Both are **browser session only**: the consent is a person's choice in a
browser, so they answer a Supabase session from a first-party web app and
refuse an API token or an OAuth app token with `403 forbidden`. Both answer
`409 welcome_offer_disabled` while the offer is off. SDK:
`client.credits.claimWelcomeOffer(input)` and
`client.credits.markWelcomeOfferSeen()`.

`Transaction` fields: `id`, `created_at`, `credits_charged`,
`credits_reserved`, `credits_used`, `action`, `provider`, `status`,
`metadata`, `payer` (`"user"` or `"workspace"`) and `workspaceId`
(`string | null`). Rows with `payer: "workspace"` were paid by a class or team
budget, not your balance.

**Which amount to read.** A run first HOLDS credits (the reservation) and is
then settled: it is charged all or part of the hold, and the rest goes back to
your balance. Some runs routinely settle below their hold — a hold that covers
a possible re-render, a length measured after the run, a metered run — so the
hold is not what you paid.

| Field | Meaning |
|---|---|
| `credits_charged` | What the run cost you, once settled. Can be lower than the hold; `0` when the hold was refunded; `null` while the hold is still open (`status: "reserved"`). **Sum this field for spend.** |
| `credits_reserved` | The hold taken when the run was accepted. Never changes. |
| `credits_used` | The same hold as `credits_reserved`, under its original name, kept for existing integrations. It never changes after a partial settle, so it reads above the charge for those runs. Prefer `credits_charged`. |

Example: a run that held 888 and was charged 444 reads `credits_charged: 444`,
`credits_reserved: 888`, `credits_used: 888`, `status: "committed"`; the other
444 is back on your balance.

`status` is the reservation's billing lifecycle: `"reserved"` (credits held,
not yet resolved), `"committed"` (charged — the run delivered; the charge is
`credits_charged`), or `"refunded"` (the reservation was released — e.g. a
provider safety-filter block, see [Generate Image](./nodes/ai-image/generate-image.md#when-the-providers-safety-filter-blocks-a-request)).
The same lifecycle is exposed on job payloads as `credit_status`
([§8](#8-error-envelope)), with the settled amount as `credits_charged`, so you
don't have to look up the transaction to know what a given job cost.

`metadata` is an object carrying the run's billing mechanics, projected to a
fixed set of keys. Present when the ledger recorded them: `model`, `from_sub`
and `from_topup` (which of your credit pools funded the run), `is_app_run`,
`allowance_delta`, `web_free_mode`, `status`, `loop_trim_refunded`,
`surround_refine_refunded`. Any other key is omitted, and `metadata` is always
an object — `{}` when nothing applies — so it is safe to read without a null
check. Credits, not currency, are the billing unit the API exposes.

All three routes use the same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT).

Top-up credits are **valid for 12 months** from purchase. Subscription
credits reset to the plan's monthly allocation **every month — on a yearly
plan too** — and unused subscription credits do not roll over into the next
month. Spending draws subscription credits first.

The plans on sale and their prices are public — see
[§12c](#12c-plans-and-prices-cloud-edition), which also covers
`GET /v1/billing/subscription`, the account's own subscription. The routes that
buy and manage billing are **first-party-only**: they reject API and OAuth-app
tokens and are used from a logged-in Nodaro session — manage billing at
[app.nodaro.ai/billing](https://app.nodaro.ai/billing).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/billing/create-checkout-session` | Opens Stripe Checkout for a plan or a credit pack. |
| `POST` | `/v1/billing/create-load-session` | Opens Stripe Checkout to load a whole amount as credits. |
| `POST` | `/v1/billing/change-plan` | Moves an active subscription to another plan. |
| `POST` | `/v1/billing/manage-subscription` | A link to the Stripe Customer Portal. |
| `GET` | `/v1/billing/auto-recharge` | The automatic top-up setting. |
| `PUT` | `/v1/billing/auto-recharge` | Changes it. |
| `GET` | `/v1/billing/transactions` | Purchase history, with receipt links. |

On a deployment-payer instance the billing account manages the
deployment's pool and per-user allowances through
`/v1/deployment-billing/*` (its `/billing-admin` page). Those routes exist
only where a payer is configured (`404` elsewhere) and answer
`403 payer_required` to anything but the billing account's own browser
session — a personal token or OAuth token gets that code even when the
billing account owns it. `POST /v1/deployment-billing/checkout` answers
`503 stripe_not_configured` on a deployment that takes no card; the
account is then topped up by the platform operator instead.

## 12b. Billing surface

Two endpoints let a client render cost and usage views without hard-coding
"is this deployment metered?" — the deployment tells you which billing
provider is registered and answers per-job / per-account cost lookups
through it.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/billing/surface` | **Public** (no token) | Deployment-level projection — no per-user data, cacheable. Returns `{ data: { contract, providerId, displayUnit, canReport, canQuote, canAccount, mountCostTab, deploymentPayer } }`. On a keyless / community install `providerId` is `"none"` and `mountCostTab` is `false` (no cost view). `deploymentPayer` is `true` when one billing account funds every user on the instance (see `payer_balance_jwt_only`, `api_tokens_payer_only` and `user_allowance_exceeded` in [§8](#8-error-envelope)); which account that is is never exposed. |
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

The SDK reads both as `client.billing.surface()` and `client.billing.account()`.

## 12c. Plans and prices (Cloud edition)

`GET /v1/billing/plans` lists the plans and the credit packs on sale, with what
each costs. It is **public**: no token is needed and none is read, so a pricing
page can call it signed out. Every caller gets the same answer, sent with
`Cache-Control: public, max-age=300`. Nodaro Cloud only — on Community and
Business the route is not registered and answers 404. SDK:
`client.billing.plans()`; CLI: `nodaro billing plans` (no sign-in needed).

Each figure is read from what charges or grants it: a plan's prices are the
Stripe prices its checkout charges; the credits a price grants, a plan's
parallelism and its storage are the limits the platform applies; and a pack's
price is the rate the top-up checkout charges, confirmed against the price the
fixed-pack checkout sells it for. The shape, with placeholders for the figures:

```text
{
  "data": [
    { "id": "free", "name": "Free", "prices": null,
      "signupCredits": <credits>, "parallelism": <n>, "storageBytes": <bytes> },
    { "id": "basic", "name": "Basic",
      "prices": {
        "monthly": { "amount": <amount>, "currency": "USD",
                     "credits": { "amount": <credits>, "per": "month" } },
        "yearly":  { "amount": <amount>, "currency": "USD", "perMonth": <amount>,
                     "credits": { "amount": <credits>, "per": "month" } }
      },
      "signupCredits": null, "parallelism": <n>, "storageBytes": <bytes> },
    …
  ],
  "topUps": [
    { "id": "topup-10", "credits": <credits>, "price": { "amount": <amount>, "currency": "USD" } },
    …
  ],
  "topUpRange": { "min": <amount>, "max": <amount>, "currency": "USD" }
}
```

| Field | Meaning |
|---|---|
| `data` | The plans: the free plan first, then the paid plans from the smallest. `id` is stable (`free`, `basic`, `standard`, `pro`, `business`). |
| `prices` | `null` for the free plan. Otherwise `monthly` and `yearly`: `amount` in the currency's major unit, `currency` an ISO-4217 code, and `yearly.perMonth` the yearly amount spread over its months. A price Stripe cannot sell right now (it could not be read, or it is archived) is `null` — show it as unavailable, never as free. |
| `prices.*.credits` | What the price grants: `{ amount, per }`, `per` being `"month"` or `"year"`. A yearly price grants the plan's credits every month, as a monthly price does; unused subscription credits expire at each monthly reset, and top-up credits are untouched. `null` when the price does not state it. |
| `signupCredits` | The free plan's one-time grant at sign-up; `null` on a paid plan, whose credits come with each price. |
| `parallelism` | How many nodes of one workflow run at once. |
| `storageBytes` | Storage for your media, in bytes. |
| `topUps` | The credit packs, `{ id, credits, price }`, smallest first. Top-up credits are valid for 12 months. `price` is `null` when it cannot be stated right now. |
| `topUpRange` | `{ min, max, currency }`: any whole amount in this range can be loaded as credits in the app, at the same rate as the packs. |

| Status | `error.code` | When |
|---|---|---|
| `403` | `self_serve_disabled` | The deployment does not sell to its users — the same answer its checkout gives. |
| `503` | `stripe_not_configured` | The deployment takes no card payments. |
| `503` | `plan_prices_unavailable` | The prices could not be read; retry shortly. Once read, the last prices keep being served for up to an hour while they cannot be read again. |

Buying stays in the app (the first-party routes in [§12](#12-credits-cloud-edition)):
to sell a plan, send the user to the Nodaro app's pricing page.

**The signed-in account's plan.** `GET /v1/billing/subscription` (Cloud only)
answers a signed-in session, a personal API token without a workflow limit, or
an app's OAuth token; a workflow-limited key gets `403 forbidden` and a billing
integration key `403 billing_key_scope`. It answers `{ data, effectiveTier }`.
`data` is the account's latest subscription — `tier`, `status` (`active`,
`trialing`, `past_due`, `paused`, `canceled`, `incomplete` or `expired`),
`current_period_start`, `current_period_end`, `cancel_at_period_end`,
`cancel_at`, `canceled_at` and its Stripe ids — or `null` when it never
subscribed. `effectiveTier` is the tier the account's entitlements follow:
usually a plan `id` from the list above; `"payg"` (no subscription, credits
bought — every model, no watermark); or a tier that is not on sale, such as
`"enterprise"`. Match it against `data[].id` to mark the current plan — no
match means pay-as-you-go or such a tier. SDK: `client.billing.subscription()`;
CLI: `nodaro billing subscription`.

## 13. Job batch polling

The listing, plus two endpoints that poll multiple job statuses in a single round trip
(useful for workflow UIs that track many concurrent jobs):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/jobs?limit=&cursor=&status=&type=&origin=&favorited=&rating=&batchId=&attachToCharacterId=` | Your jobs, newest first, cursor-paginated: `{ data: Job[], next }` (`limit` ≤ 100; pass `next` back as `cursor`). `status` is one or more job statuses (`pending`, `queued`, `processing`, `pending_review`, `completed`, `failed`, `cancelled`); an unknown one is `400 validation_error`. `type` is one or more `input_data.type` values — the route that created the job (`llm-structured`, `video-analysis`, …), up to 20. Both take a comma-separated list (`status=failed,cancelled`) or a repeated parameter (`type=a&type=b`). `origin` matches `input_data.origin` — the client app that sent it (`studio`, …). `favorited=true` keeps the jobs you favorited (`false`: the ones you did not), and `rating` is `good`, `bad`, `rated` (any rating) or `unrated` — see [§13a](#13a-favorites-and-ratings). `batchId` matches `input_data.batchId` — the jobs of one generate-image batch ([§ 4g](#4g-several-images-in-one-call-count-models)). Every filter is exact-match and they combine with AND. Every job carries `favorited` and `rating`. A page may hold fewer than `limit` rows — even none — and still carry a `next`; page on `next`, never on `data.length`. `attachToCharacterId` is the per-character archive described under characters. |
| `GET` | `/v1/jobs/status?ids=a,b,c` | Comma-separated IDs, max 100. Returns `{ jobs: { id, status, output_data, error_message, error_hint, credit_status }[] }`. Cross-user / non-existent IDs are silently omitted — reconcile locally. |
| `POST` | `/v1/jobs/batch-status` | Body `{ jobIds: string[] }`, max 100. Returns `{ data: { id, status, output_data, error_message, error_hint }[] }` (no `credit_status` on this route). |

An Apply EDL job's `output_data` says what the render was cut from: `quality` (`"proxy"` is a preview), `clipKey` (the plan clip, when one was given), `planBasis` (the plan value, when one was given: `POST /v1/apply-edl` accepts an optional `planBasis` of 16 lowercase hex digits, `renderReadBasis` in `@nodaro/shared`) and `renderBasis` (always: the server's fingerprint of the render's `output`, `crossfadeMs` and the effective source URLs). See the SDK's [`applyEdl`](./sdk-reference.md#applyedlinput) for the full parameter list.

An Apply EDL job recorded before `output_data.quality` was written reads back with the quality it was ordered at filled in on every job read above, plus `GET /v1/jobs/:id` and `GET /v1/jobs/:id/status` (`"proxy"` is a preview, anything else the final). The stored job is unchanged.

All three require `jobs:read` scope when using an OAuth token; admin tokens may
see cross-user jobs. These endpoints are public API — they are used by the
editor but are equally suited to external polling clients. `input_data` and
`output_data` are public projections: server-only fields such as Recast's
private pre-watermark remux base are removed recursively for every caller,
including administrators.

### Image size on image jobs

Every job whose `output_data` publishes an `imageUrl` (generations, edits,
image-to-image, studio images, collages, overlays, extracted frames, …) also
carries the image's pixel size, so a client can lay out a grid before the images
load, or show and sort by size:

| Field | Type | Meaning |
|---|---|---|
| `width`, `height` | integer | The size of `imageUrl` in pixels, as the file is **stored** — what you download, a free-tier watermark included — with EXIF orientation applied, so it is the size a browser shows. |
| `images` | `{ url, width, height }[]` | Beside `imageUrls` (a job that made several images): one entry per image, in `imageUrls` order. An entry whose size could not be read has only its `url`. `imageUrls` itself is unchanged (an array of strings). |

```json
{
  "imageUrl": "https://cdn.nodaro.ai/images/<jobId>.png",
  "imageUrls": ["https://cdn.nodaro.ai/images/<jobId>.png", "https://cdn.nodaro.ai/images/<jobId>-v1.png"],
  "width": 1024,
  "height": 1536,
  "images": [
    { "url": "https://cdn.nodaro.ai/images/<jobId>.png", "width": 1024, "height": 1536 },
    { "url": "https://cdn.nodaro.ai/images/<jobId>-v1.png", "width": 1024, "height": 1536 }
  ]
}
```

Treat all three as optional: jobs completed before the size was recorded carry
none of them, and a size the server could not read (a file it cannot decode, a
storage read that did not answer in time) is left out, never guessed. A node that
already reported its own size (Image Overlay, and its `variants[]`) keeps it.
The same fields are on every job read above, on `GET /v1/jobs/:id` and
`GET /v1/jobs/:id/status`; the MCP job envelope (`get_job`, `wait_for_job`,
`get_asset`) carries `width` / `height` beside `outputUrl`.

### How long a component run may take

`POST /v1/component/execute` answers `202 { jobId }` and runs the component in the
background; poll that wrapper job like any other. The server gives the run 90 minutes,
plus the time budget of any long render inside it (today: an Apply EDL final render,
whose budget is sized from its edit). A client that polls with its own time limit can ask
how long the server will wait:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/component/execute/:jobId/wait-limit` | `{ data: { budgetExcessMs, waitLimitMs, pendingBudgetedNodes } }` — `waitLimitMs` is the server's wait on this run (90 minutes + `budgetExcessMs`); `budgetExcessMs` is `0` until the run has started a long render. `pendingBudgetedNodes` is `true` while the run still has a long render it has not started yet (and while the run has not started at all), so a `0` excess does not yet mean "nothing long inside". Both can change while the run goes on, so ask again when `waitLimitMs` is reached. Owner-only (404 on a foreign or non-component job); `jobs:read` scope with an OAuth token. |

The editor keeps its own 30-minute wait for a run with nothing long inside. When the run
has started a long render it waits `waitLimitMs`; when a long render is still to come
(`pendingBudgetedNodes`) it waits at least the server's 90 minutes, and asks again then.

### Video Pro segment estimates

`POST /v1/credits/video-pro-estimate` accepts `provider`, `resolution`, `duration`, `aspectRatio`, `renderMethod`, `anchorMode`, `contextTailSec`, `planOnly`, and the Video Pro segment controls. It reads prices without creating a job or reserving credits.

```json
{"provider":"gemini-omni-flash","resolution":"720p","duration":12,"renderMethod":"keyframes","segmentMode":"short"}
```

The response is `{ "data": { "credits": 760, "upperBound": true } }` in an example configuration with a 760-credit<!-- credits: n/a --> reservation. Read the live response for current prices. For Short/Long, `upperBound` identifies the pre-plan reservation limit; settlement follows the actual plan. A plan-only estimate covers the planning fee and returns `upperBound: false`.

`segmentMode` accepts `short`, `long`, or `max` and cannot be combined with numeric `preferredSegmentSec` or explicit `segmentDurations`. Short/Long first assign complete actions to source spans. A plan-only result’s `sourceSegmentDurations` and `planCheckpoint` can be passed back as `sourceSegmentDurations` and `seedPlan` with the same mode and generation settings. See [Generate Video Pro](nodes/ai-video/generate-video-pro.md#how-segmentation-works).

### Seedance 2.5 HD finalize estimates

`POST /v1/credits/seedance-hd-estimate` returns the credits to finalize a Seedance 2.5 draft at 1080p (Video Upscale with `provider: "seedance-2-5-hd"`). It reads prices without creating a job or reserving credits. Cloud only; requires authentication.

Name the draft the way the finalize does, by `sourceJobId` (its job id) or `taskId` (its `providerTaskId`):

```json
{"sourceJobId":"<the draft's job id>"}
```

The response is `{ "data": { "credits": 1580, "minimum": false } }` for a 4 s draft without a reference video. Read the live response for current prices. `credits` is exactly what `POST /v1/video-upscale` reserves for the same draft — the same checks, the same billable length, the same pricing. A draft the finalize would refuse is refused here with the same status and code (`403 forbidden`, `404 draft_not_found`, `409 draft_not_ready` / `draft_not_finalizable`, `422 not_a_draft` / `not_a_seedance_draft` / `invalid_media_duration`), and nothing is charged.

Send `{}` (no draft) for the lowest price any draft can finalize for, returned with `minimum: true` — the editor's "from N". That is **1568**<!-- credits: seedance-2-5-hd:4s-ref@1.5 -->: the shortest reference clip Seedance 2.5 accepts (2 s) with the shortest draft (4 s), priced as 2 + 4 seconds. See [Seedance 2.5 HD (from draft)](nodes/processing-video/video-upscale.md#seedance-25-hd-from-draft) for the formula.

### Seedance reference-video estimates

`POST /v1/credits/seedance-ref-estimate` returns the credits a Seedance 2 generation with reference video(s) reserves (`seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `seedance-2-5`) — Generate Video with reference videos wired, or Video to Video's Seedance 2.5 Edit lane, whose source clip is reference video 1. Such a run is billed for the reference clips' seconds plus the output seconds, so the price depends on the clips' real lengths: the server measures them and prices them exactly as the run's reservation does. It reads prices without creating a job or reserving credits. Cloud only; requires authentication; rate-limited to 60 requests a minute.

```json
{"provider":"seedance-2-5","resolution":"720p","duration":8,"referenceVideoUrls":["https://…/clip.mp4"]}
```

| Field | Type | Meaning |
|---|---|---|
| `provider` | string | A Seedance 2 model. Any other model is a `400 validation_error`. |
| `resolution` | string? | As the run sends it; omitted = the model's default. |
| `duration` | number? | Output seconds; `-1` = Auto (priced at the model's longest clip, as the run reserves it). Omitted = the model's default. |
| `draft` | boolean? | Seedance 2.5 Draft: priced at 480p. |
| `referenceVideoUrls` | string[] | The reference clips the run will send, in order. |
| `unknownReferenceVideos` | number? | Wired clips whose file does not exist yet (their upstream node has not produced them). |

The response is `{ "data": { "credits": …, "min": …, "exact": true } }`. With every clip named, `credits` is exactly what the run reserves — the same measurement, the same billable seconds (see [Generate Video → Reference videos bill input + output duration](nodes/ai-video/generate-video.md)), the same rounding — and `min` equals it. A clip that cannot be measured counts as the model's longest accepted clip, as the run counts it. With `unknownReferenceVideos`, `exact` is `false`: `credits` prices each unknown clip at the longest clip the model accepts (never below what the run can reserve) and `min` at the shortest. A clip the run would refuse is refused here with the run's own `400 video_too_long`, and nothing is charged.

## 13a. Favorites and ratings

Two marks you keep on your generations, readable on every job and usable as
list filters:

- **Favorites** — a bookmark on a job: one of your own (any status), or anyone's
  public completed one in the gallery. `POST /v1/gallery/favorite` toggles one.
- **Ratings** — your verdict on one of your own jobs, `good` or `bad`.
  `PUT /v1/jobs/:id/rating` sets or clears it.

`GET /v1/jobs` and `GET /v1/jobs/:id` carry both on every job: `favorited`
(`true` / `false`) and `rating` (`"good"`, `"bad"` or `null`) — the job owner's
own marks. If the server cannot read them for a moment, the jobs still answer
and the two fields are left out: treat a missing field as unknown, never as
`false` (a toggle on an unknown favorite could remove it). `GET /v1/jobs`
filters on them with `favorited=true|false` and `rating=good|bad|rated|unrated`
(see the table in [§13](#13-job-batch-polling)).

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `PUT` | `/v1/jobs/:id/rating` | body `{ rating: "good" \| "bad" \| null }` | Rate one of your jobs, or clear its rating with `null` (`rating` is required, so clearing is explicit). One rating per job, its owner's: anyone else's job — an admin's request included — is `404 not_found`. A rating other than `good`, `bad` or `null` is `400 validation_error`. Returns `{ data: { jobId, rating } }`. |
| `POST` | `/v1/gallery/favorite` | body `{ jobId }` | Favorite a job, or un-favorite it when it already is. Returns `{ favorited: boolean }` — the job's state after the toggle. Another person's private job is `404 not_found` (nothing is stored); removing a favorite always works. |
| `GET` | `/v1/gallery/favorites` | none | Your favorited job ids, newest first: `{ data: string[] }`. |
| `GET` | `/v1/gallery` | `type` (`image` \| `video` \| `audio`), `userId`, `favoritesOnly=true`, `limit` (1–50, default 20), `cursor` | The public gallery, newest completed first: `{ data: GalleryItem[], nextCursor, totalCount? }` (`totalCount` on the first page only; pass `nextCursor` back as `cursor`). No token needed. With `userId`, only that person's work — your own id lists your private items too, anyone else's their public ones. `favoritesOnly=true` narrows **your own** items (your `userId`, with your token) to the ones you favorited; asked for anyone else's favorites it is refused — `401` without a token, `403` with another person's `userId` or none. Each item is `{ id, type, jobName, outputUrl, thumbnailUrl, createdAt, prompt, model, preview? }` (`id` is the job id) — never whose it is. |

OAuth app tokens need `assets:write` for the two writes, and `assets:read` or
`jobs:read` to list your favorites (no-op for user / API-key auth); the job
reads stay `jobs:read`. A deployment that hides the gallery serves none of the
`/v1/gallery` routes (they answer `404`). On a server whose database does not
have ratings yet, the rating write and a `rating=` filter answer
`503 not_available`, and every job reads `rating: null`.

```bash
# Rate a job good and favorite it, then list your good favorites that completed
curl -s -X PUT "https://app.nodaro.ai/v1/jobs/$JOB/rating" \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": "good"}' | jq .
curl -s -X POST "https://app.nodaro.ai/v1/gallery/favorite" \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jobId\": \"$JOB\"}" | jq .
curl -s "https://app.nodaro.ai/v1/jobs?rating=good&favorited=true&status=completed" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[] | {id, favorited, rating}'
```

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

## 13e. UGC video nodes (Nodaro Cloud only)

The six UGC video nodes ([UGC Creator](./nodes/ai-video/ugc-creator.md),
[UGC Script](./nodes/ai-video/ugc-script.md), [UGC Clips](./nodes/ai-video/ugc-clips.md),
[UGC Clip](./nodes/ai-video/ugc-clip.md), [UGC Finish](./nodes/ai-video/ugc-finish-clips.md),
[UGC Cards](./nodes/ai-video/ugc-cards.md)) call
these routes when they run, in the editor and in a workflow or app run alike. They are served
on Nodaro Cloud only; elsewhere every UGC node fails before anything is reserved, with "UGC
videos are a Nodaro Cloud feature and are not served on this deployment." Their request and
answer shapes are the nodes' own business and may change between versions: to make a UGC
video through the API, run a workflow or an app that holds the nodes. Every route needs an
authenticated caller.

| Route | What the node uses it for | Answers |
|---|---|---|
| `POST /v1/ugc/creator` | UGC Creator: what to draw for an AI creator (its image jobs and the checks on them), or the check for a photo. An API run draws one creator and never waits for a pick. | JSON |
| `GET /v1/ugc/categories` | The product categories UGC Creator offers; also UGC Cards' first call, free, so nothing is paid where the routes are not served. | JSON |
| `POST /v1/ugc/script` | UGC Script: writes the script. | a job id |
| `POST /v1/ugc/clips` | UGC Clips: with `surface: "canvas"` (and the node's `voiceId`), the answer carries one clip per take, the script with its clips marked, and the transcript. | JSON |
| `POST /v1/ugc/clip` | UGC Clip: renders one clip. In the editor, a clip whose content has not changed hands back its earlier job. A published app's run never hands back a clip another app run made; its [Retry](#retry-of-a-failed-app-run) is the same run going on, so it hands back the clips that run finished. | a job id |
| `POST /v1/ugc/cards` | UGC Cards: with `surface: "canvas"`, the screenshot cards, the captions and the Notes, from the word timings and the clips' notes. | JSON |
| `POST /v1/ugc/quote` | What a UGC video costs (below). Free: nothing is reserved. | JSON |

**`POST /v1/ugc/quote`** (30 calls a minute) has two forms:

- **Tickets** — `{ "tickets": [ … ], "hasCards": true }`: the clips UGC Clips handed on (1 to
  11), priced as UGC Clip and the steps after it will be. This is the figure UGC Clips shows.
  `finishes` (optional, `true`): the clips go through UGC Finish's job (a Hebrew video, whose UGC
  Clips answer hands UGC Finish a finish call); the quote then has a "Finish the clips" line
  (key `finish`), charged once, at the price that job is charged. The join line (key `join`) is
  priced as the UGC template's Join clips node is charged: its settings, and each clip at its
  ticket's length. A run charges the join each finished clip's real length, which is at most its
  ticket's, so the join line is never below what the run charges for it.
  `reusedClips` (optional): the clips the run expects handed back from an earlier render, each as
  `{ "clip": <its place in tickets, from 1>, "jobId": "<the UGC Clip job of its take>", "nonce": <the
  Re-render count the run sends> }`. The server checks every one: a clip is handed back only when
  its job is the caller's own finished UGC Clip job, made from exactly that ticket at that count with
  no run key (an editor run, or a run that is not an app run's), and an earlier attempt of the same
  clip would not be admitted again first. Each clip that holds is a clip line at 0 credits marked
  `"reused": true`, counted in neither `expected` nor `ceiling` (nor the clip part of `parts` and
  `holdParts`); a clip that does not hold (another user's job, a deleted or failed one, another
  count) is priced in full, as is every clip when the check cannot be made. The join line still
  takes every clip. The editor sends it for a run of UGC Clip whose UGC Clips does not run, naming
  the takes of its last run that record their job and count. A clip above the tickets' count, one
  named twice, or a `jobId` that is not a job id is a `400`.
  `runEstimate` (optional): the estimate input of the video the clips belong to (the estimate
  form's `targetDurationSec`, `screenshotCount`, `source` and `language`); the answer then also has
  `runHold`, the most that video's estimate holds for its clips and the steps after them (its
  `worstCase` without the script, the creator, the speech, its word timings and its split), priced
  with the same `hasCards` and `finishes`.
- **Estimate** — `{ "estimate": { "targetDurationSec": 15, "screenshotCount": 3, "source": "sampled" } }`:
  a whole video before anything runs, the script and the creator included, at the target length
  and at 0.8× and 1.2× of it. `targetDurationSec` is 4 to 300; `screenshotCount` 0 to 8 (1 or 2
  price as none, since the script drops them); `source` is `"sampled"` (an AI creator) or
  `"photo"`.
  - `rendersEveryCandidate` (optional): price every creator option, as an editor run draws them.
    Without it, one creator, as an app or API run draws it.

Both forms answer `lines` (each with an English `label`, its `credits` and a stable `key`; a clip
line also its number `n` and its `seconds`), `expected` (what the video is expected to cost),
`ceiling` (what it holds while its clips render: each clip at twice its price), `parts` (the
expected credits per part of the video: `script`, `creator`, `clip`, `cards`, `join`, `overlay`
and `captions`, adding up to `expected`) and `holdParts` (what each part holds; they add up to
the ticket form's `ceiling`). The estimate also answers `range` (what it is expected to cost at
0.8× and 1.2× the length) and `worstCase` (what it holds at the longer length; its `holdParts`
add up to it), and, when the server supplies all three, `limits`: the script's line limits in
characters, `{ "hook": …, "beatLine": …, "closerLine": … }` (each a whole number), which the
editor holds a script's edited lines to. An item that cannot be priced answers `422 unpriceable`; where the UGC routes are not
served, `503 not_available`.

For a Hebrew video (`language: "he"`) the recorded speech decides how many clips there are, so
the estimate has no 0.8× and 1.2× runs: `expected` and `ceiling` are the clips the speech is
expected to need, `range` runs to the most clips that speech usually needs, and `worstCase` holds
the dearest way any speech the video may record can be cut, every clip at twice its price. A
recording may hold at most 1.2 times the target length, and never more than 21 seconds (a 15-second
video: 18 seconds; 17.5 seconds and longer: 21 seconds), so the worst case grows with the target up
to six clips of up to 7 seconds. The speech, its word
timings, its split and the finish are lines of their own, each charged once.

**Before a Hebrew video's clips render**, UGC Clips (in the editor, in a published app and in an API
run alike) asks the ticket form with `runEstimate` for the clips the split handed on. When their
`ceiling` is over `runHold` (the clips would hold more than the run was checked for before it
started), or no figure can be had, the run stops at UGC Clips before any clip renders; the speech,
its word timings and its split stay charged, and the node fails with
`The clips for this recording would cost more than this run was checked for, so none was rendered. Run UGC Clips again to record the speech again.`

**A published app's run** of a UGC video is checked, before it starts, against what the video
can hold while its clips render: a run whose payer cannot cover that is refused with
`402 insufficient_credits`,
`This video can hold up to about <n> credits while it renders; your balance is <balance>.`,
before anything runs or is billed. What a published UGC video carries,
and the photo an app set to My photo needs, are in
[UGC videos in a published app or template](#ugc-videos-in-a-published-app-or-template).

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

**Errors:** 400 (pipeline_not_completed, invalid_stage) · 404 (pipeline_not_found, also for a pipeline that is not yours) · 401 (unauthorized)

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

Your saved node presets — create, update, delete, import, reorder and file them
in folders — your favorites, and the built-in factory catalog. A preset's
`data` is captured node config; merge it into a node's data when you build a
workflow to "apply" it.

**Auth/scope:** same bearer-token auth as every other endpoint
(`ndr_…` / `ndr_app_…` / Supabase JWT) — except the built-in catalog,
`GET /v1/node-presets/factory`, which needs **no auth at all**: it is the
deployment's own list, the same for everyone and holding no user data, so a
client app can show it (names, example pictures, how many photos each preset
needs) to visitors who are not signed in and ask for a login only when they
generate. Public, same 5-minute cache as the model catalog
(`Cache-Control: public, max-age=300`); an invalid or expired token sent with
it is ignored. For
everything else: an OAuth app token needs `presets:read` for the reads and
`assets:write` for the writes; your own API key needs neither. A personal key
limited to some workflows cannot reach your own presets (`403 forbidden`) — the
factory catalog it reads as anyone can.

### Reads

| Method | Path | Query | Purpose |
|---|---|---|---|
| `GET` | `/v1/node-presets` | `nodeType` (optional) | Your custom presets (newest first). |
| `GET` | `/v1/node-presets/factory` | `nodeType` (**required**) | The built-in catalog for a node type. **No auth needed.** |
| `GET` | `/v1/node-presets/favorites` | `nodeType` (**required**) | Your favorite preset ids (see [Favorites](#favorites)). |
| `GET` | `/v1/node-preset-groups` | `nodeType` (optional) | Your preset folders/sections. |

A custom preset has `{ id, nodeType, name, description?, data, groupId?, tags, sortOrder, minReferences, needsImage, previewUrl, createdAt, updatedAt }`. The factory response is `{ data: [...] }`, where each entry has `{ id, name, description?, group?, groupKind?, data, minReferences, needsImage, previewUrl }`.

**Photos a preset works from — `minReferences` / `needsImage`.** `minReferences`
is how many connected reference images the preset works from (0 = none), and
`needsImage` is `true` when it is at least one. Run such a preset with that
many reference images attached — with `presetId` on `POST /v1/generate-image`
(§4f), send them as `referenceImageUrls`; without them it describes a photo
that is not there. The Reference Sheet, Cast & Consistency, Edit by Name, Face Privacy,
Edits, Portrait Transformations and Stylized Subject presets need one (Cast Mega
Grid two), and so does every template whose prompt uses `{image:N}` tokens —
its count is the highest N. A preset of your own is counted the same way, from
the `{image:N}` / `{image:N:label}` tokens in its prompt, its pre/post text and
its negative prompt.

**Example pictures — `previewUrl`.** For a factory preset, an absolute URL on the
server you asked (`https://<host>/preset-previews/<nodeType>/<slug>.<hash>.webp`),
or `null` while the preset has no picture yet. The name changes whenever the
picture does, so a URL can be cached for good. For a preset of your own, the
preset's own copy of the image you gave it (see Writes), or `null`.

### Writes

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| `POST` | `/v1/node-presets` | `{ nodeType, name, description?, data, groupId?, tags?, sortOrder?, previewUrl? }` | Create a preset. Answers `201` with the preset. |
| `PATCH` | `/v1/node-presets/:id` | any of `name`, `description`, `data`, `groupId`, `tags`, `sortOrder`, `previewUrl` (`null` removes it); optional `expectedUpdatedAt` | Rename, replace the config, move or set the preview. |
| `DELETE` | `/v1/node-presets/:id` | optional `expectedUpdatedAt` query parameter | Delete a preset (and its favorite entries). |
| `POST` | `/v1/node-presets/import` | `{ presets: [{ nodeType, name, description?, data, previewUrl? }] }` (up to 500) | Create many at once. Returns `{ data: { imported } }`. |
| `POST` | `/v1/node-presets/reorder` | `{ groups?: [{ id, sortOrder }], presets?: [{ id, groupId?, sortOrder }] }` | Positions, and moves between folders. Returns `{ data: { ok: true } }`. |
| `POST` | `/v1/node-preset-groups` | `{ nodeType, name, kind?, sortOrder? }` | Create a `folder` (default, collapsible) or a `section` (a flat header). |
| `PATCH` | `/v1/node-preset-groups/:id` | `{ name?, sortOrder? }` | Rename or move a folder. |
| `DELETE` | `/v1/node-preset-groups/:id` | — | Delete a folder; its presets move out of it, none are deleted. |

- A preset's `name` is unique per node type, ignoring case: create and update answer `409 name_taken`; import keeps both by naming the newcomer "… (imported 2)".
- `data` is at most 64 KB. Runtime keys (results, job ids, the node's label) are stripped; an imported preset with nothing left is skipped.
- `groupId` must be one of your folders (`400 invalid_group`).
- `previewUrl` must be one of your own images on this platform — an upload or a finished generation result (png, jpg, webp, gif or avif) — and the file must already exist. Anything else answers `400 validation_error` naming the field (`presets[3].previewUrl` on import). Set it once the job that makes the picture has completed.
- The preset keeps its **own copy** of that picture, and the response's `previewUrl` is the copy's address (under `node-presets/`), not the one you sent: deleting the original from your library never breaks the preset. Setting the same picture again reuses the copy; the copy is deleted once no preset of yours uses it.
- `expectedUpdatedAt` (the `updatedAt` you read) makes an update or delete refuse with `409 conflict` when the preset changed since.
- A preset or folder that is not yours, or an id that is not a uuid, answers `404 not_found` (with `expectedUpdatedAt` too: ownership is checked before the revision).
- Each account keeps at most 5,000 presets, 500 folders and 2,000 favorites. Past that, a create, an import or a favorite answers `409 limit_reached` and writes nothing (an import that does not fit whole imports none).
- One reorder moves at most 2,000 presets and 500 folders from the editor, and 500 presets and 100 folders from an API key or an OAuth app; more answers `400 validation_error` — send the rest in another call.
- Writes are limited to 60 a minute per credential (import: 10), then `429 rate_limit_exceeded`.

```bash
# Your custom generate-image presets
curl -s https://app.nodaro.ai/v1/node-presets?nodeType=generate-image \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[].name'

# Built-in catalog: the presets that need a photo, and their example pictures (no token needed)
curl -s "https://app.nodaro.ai/v1/node-presets/factory?nodeType=generate-image" \
  | jq '.data[] | select(.needsImage) | {id, minReferences, previewUrl}'

# Save a preset of your own, with one of your images as its picture
curl -s -X POST https://app.nodaro.ai/v1/node-presets \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodeType": "generate-image", "name": "Studio portrait", "data": {"provider": "gpt-image-2", "aspectRatio": "3:4", "prompt": "{image:1:person}, studio portrait, soft key light"}, "previewUrl": "https://cdn.example.com/images/<jobId>.png"}' | jq '.data | {id, minReferences, previewUrl}'

# Rename it, refusing if it changed elsewhere since you read it
curl -s -X PATCH https://app.nodaro.ai/v1/node-presets/<presetId> \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Studio portrait (warm)", "expectedUpdatedAt": "<updatedAt>"}' | jq .data.name
```

### App settings presets

The same personal library supports app settings under logical namespaces. `recast-render` stores Recast generation settings; it is not an executable node type. Factory entries are read-only and personal entries remain private to their owner across devices.

Its `data` is a strict complete snapshot:

```json
{
  "schemaVersion": 1,
  "provider": "seedance-2-5",
  "resolution": "480p",
  "segmentSec": "max",
  "renderMethod": "extend",
  "anchorMode": "upfront",
  "citeStyle": "bare",
  "promptTiming": true,
  "textOnly": false,
  "interactive": true,
  "anchorGates": false,
  "musicGates": true,
  "musicSource": "generated"
}
```

`segmentSec` accepts `max`, `scenes-max` (Long), or `scenes` (Short). `resolution` accepts `480p`, `720p`, `1080p`, or `4k`; `renderMethod` accepts `extend` or `keyframes`; `anchorMode` accepts `upfront`, `progressive`, or `none`; `citeStyle` accepts `bare` or `rich`; `musicSource` accepts `generated`, `original`, or `upload`. All switches are booleans. Unknown fields and schema versions are rejected on create, replacement and import. Source media, cast references, prompts, uploaded track URLs, rights attestations and results are excluded. Applying an Original or Upload music choice uses the target project's own media; it never prepares or uploads audio automatically.

These are written with the same routes as any preset — create with `POST /v1/node-presets`, rename or replace data with `PATCH /v1/node-presets/:id`, and delete with `DELETE /v1/node-presets/:id` — and they need no photos and carry no preview (`minReferences: 0`, `previewUrl: null`). Send the `updatedAt` returned by the library as `expectedUpdatedAt`: a concurrent change returns `409 conflict` and requires a refresh. Applying a preset updates settings and refreshes the quote; it does not submit generation. Validate the target model's current capabilities before generating.

A preset may carry `promptPrefix` / `promptSuffix`; the MCP generation verbs wrap
the caller's prompt with them when `presetId` is passed (see
[Prompt pre & post text](./prompt-pre-post-text.md)).

### Favorites

Per-user **favorites** let you star presets (factory or custom) so they surface
at the top of the editor's preset dropdown. The read needs `presets:read` from
an OAuth app token, the writes `assets:write`.

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/node-presets/favorites` | `nodeType` (**required**) | Your favorited preset ids for that node type, most-recent first. Returns `{ data: string[] }`. |
| `POST` | `/v1/node-presets/favorites` | body `{ nodeType, presetId }` | Add a favorite (idempotent). Returns `{ data: { success: true } }`. |
| `DELETE` | `/v1/node-presets/favorites` | `nodeType`, `presetId` (**required**) | Remove a favorite (idempotent). Returns `{ data: { success: true } }`. |

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

## 16b. Saved posts (inspiration wall)

Save a post you found (a [Social Search](./nodes/input/social-search.md) result)
with a note and tags, then come back to it on the **Inspiration** page or feed
it into a workflow. A save keeps a snapshot of the post, because links and
numbers on the platform change, and the post's still is copied into your
storage so the wall outlives the platform's expiring image links. The copy
counts toward your storage and stays out of the media picker. One save per
post: saving the same post again updates its note and tags.

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/saved-posts` | `platform`, `tag`, `q`, `cursor`, `limit` (1-100, default 40) | Your saves, newest first. Returns `{ data: SavedPost[], nextCursor }`. |
| `POST` | `/v1/saved-posts` | body `{ post, note?, tags?, source? }` | Save a post (`post` is a `SocialPost`, exactly as Social Search returns it). `201` with the new save; `200` with the existing save when the post was already saved. |
| `POST` | `/v1/saved-posts/lookup` | body `{ postIds }` (up to 200) | Which of these posts you saved. Returns `{ saved: [{ postId, id }] }`. |
| `PATCH` | `/v1/saved-posts/:id` | body `{ note?, tags? }` | Change a save's note or tags. |
| `DELETE` | `/v1/saved-posts/:id` | none | Remove a save and its copied still. Returns `{ success: true }`. |

Tags are stored lower-case without a leading `#`: at most 10 per save, 40
characters each. A comma in any script splits a tag (`"hooks, openers"` is two
tags), and braces, quotes and backslashes are removed. A note is up to 2,000
characters. `q` finds words in the note, the post's text and its title.
`nextCursor` is an opaque token; pass it back as `?cursor=` for the next page
(`null` on the last page). A cursor the list did not give out is refused with
`400 invalid_cursor`.

The post is checked before it is stored. A post without an id, a supported
platform, an `http(s)` link, an author (`handle` and `name`) or text is refused
with `400`; any other field of the wrong kind (a count that is not a number, a
link that is not `http(s)`) is dropped. A post snapshot over 64 KB is refused
with `413 post_too_large`.

`thumbnailUrl` is the copied still, or `null` when there is none (the copy
failed, or it was cleaned up under the account's
[media retention](#8b-pay-as-you-go-accounts)); the post's own
`media.thumbnailUrl` is then the only, expiring, link. Saving the post again
copies the still again.

OAuth app tokens need `assets:read` for the reads and `assets:write` for the
writes (no-op for user / API-key auth: you own the resources). Saving is
limited to 30 requests a minute per token (`429`). On a server that does not
have saved posts yet, the reads answer empty and the writes answer
`503 not_available`.

```bash
# Save one post from a Social Search run (post.json holds that post)
curl -s -X POST https://app.nodaro.ai/v1/saved-posts \
  -H "Authorization: Bearer $NODARO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --slurpfile p post.json '{post: $p[0], note: "strong hook", tags: ["hooks"]}')" | jq .

# Your saved TikTok posts tagged "hooks"
curl -s "https://app.nodaro.ai/v1/saved-posts?platform=tiktok&tag=hooks" \
  -H "Authorization: Bearer $NODARO_TOKEN" | jq '.data[] | {url, note}'
```

The same routes are wrapped by the SDK (`client.savedPosts`), the MCP tools
(`save_post` / `list_saved_posts`) and the CLI (`nodaro saved-posts`).

## 16d. Collections

Where a workflow's records live: named sets of records a workflow saves to and
reads back (see [Collections](./features/collections.md)). A record holds a
title, a text (up to 20,000 characters), a link, media links (as given — never
fetched, never copied), up to 50 scalar `fields` and a `source`. Text and links
only, never files. Available on every edition.

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/collections` | none | Your collections, newest first, each with `recordCount`. Returns `{ data: Collection[], available, caps: { collections, records } }` — `available: false` on a server whose database does not have collections yet (then `data` is empty), `caps` are yours (`null` = no limit). |
| `POST` | `/v1/collections` | body `{ name, description? }` | Create a collection. `201`; `409 name_taken` when you already have one by that name (case-insensitive); `403 collection_limit_reached` at your plan's cap. 30 a minute. |
| `GET` | `/v1/collections/:id` | none | One collection, with `usedCount` (how many of its live records are used) and `trashCount` (how many sit in the Trash) — both left out on a server whose database predates the usage release. `recordCount` counts every record, the Trash included: that is what the cap sees. |
| `PATCH` | `/v1/collections/:id` | body `{ name?, description? }` | Rename or re-describe (`409 name_taken` when the new name is already yours). |
| `DELETE` | `/v1/collections/:id` | none | Remove a collection and every record in it. Returns `{ success: true }`. |
| `GET` | `/v1/collections/:id/records` | `q`, `since` / `until` (an ISO date **and** time, e.g. `2026-10-06T00:00:00Z`; `until` is exclusive), `usage` (`all`, the default, `unused` — not used yet — or `used`), `status` (`active`, the default — the live records — or `trash`), `order` (`newest`, the default, or `oldest`), `cursor` **or** `offset` (0–1,000,000; a numbered page is `offset = (page − 1) × limit`), `limit` (1-100, default 50) | The records. Returns `{ data: CollectionRecord[], nextCursor, total? }` — `total`, how many match the filters in all, comes with a page asked for by `offset` (a cursor walk never pays for the count). Each record carries `usedAt` (null until it is used), `usedBy` (who used it, the shape of `source`) and `deletedAt` (null while it is live); `source` and `usedBy` carry `workflowName` and `projectId` when the workflow is yours. |
| `PATCH` | `/v1/collections/:id/records/:recordId` | body `{ used: boolean, source? }` | Mark a record used (`usedAt` now, `usedBy` = `source`, which defaults to `{ via: "api" }`) or not used again (`used: false`). Returns the record. `404 not_found` for a record that is not yours; `503 not_available` on a server whose database predates the usage release (an older server has no such route and answers 404, and ignores `usage` / `until` / `order` on the list). |
| `POST` | `/v1/collections/:id/records` | body `{ title?, text?, url?, media?, fields?, dedupeKey?, source?, item? }`; header `Idempotency-Key` (optional, up to 200 characters) | Save one record. `201 { record, outcome: "inserted", evicted }`; `200` with `outcome: "duplicate"` (the same dedupe key is already there — the existing record comes back) or `"replayed"` (a write with the same `Idempotency-Key` already happened); `409 conflict` when a rule fired but that record was removed in the same instant (send it again). 120 a minute. |
| `DELETE` | `/v1/collections/:id/records/:recordId` | none | Move one record to the collection's **Trash** — it leaves every list, node read, export and MCP read, keeps its dedupe key (the same story saved again is a duplicate of it and stays in the Trash), and still counts toward the cap. Returns `{ success: true }`; `503 not_available` on a server whose database predates the Trash (nothing is deleted in its stead). |
| `DELETE` | `/v1/collections/:id/records/:recordId/permanent` | none | Delete a record that is already in the Trash, for good. `409 not_in_trash` for a live record (move it to the Trash first), `404 not_found` when it is not yours. |
| `POST` | `/v1/collections/:id/records/:recordId/restore` | none | Bring a record back from the Trash. Returns the record; `404 not_found` when it is not yours; `503 not_available` on a server whose database predates the Trash. |
| `POST` | `/v1/collections/:id/records/bulk` | body `{ ids: string[] (1–100), action: "trash" \| "restore" \| "delete" }` | Move many records to the Trash, bring them back, or (`delete`) remove records already in the Trash for good, in one call. `404 not_found` for a collection that is not yours; only the ids that are yours in that collection and not already in the asked state change. Returns `{ updated }`. 120 a minute. |
| `GET` | `/v1/collections/:id/export` | `format` (`csv`, the default, or `json`), `since`, `until`, `usage`, `q` | The whole collection as a file, newest first (`Content-Disposition: attachment`); the CSV ends with `used_at` and `used_by` columns. 10 a minute. |

**Mapping an item.** Instead of (or besides) the explicit fields, send `item`:
any JSON — a Telegram post, a Social Search result, an article object an LLM
wrote — and the server maps it: title ← `title` / `headline` / `name`; text ←
`text` / `body` / `caption` / `description`; link ← `url` / `postUrl` / `link`;
media ← `media[]` and the `imageUrl` / `videoUrl` / `audioUrl` keys; every other
scalar lands in `fields`. An explicit field wins over the mapping. A record with
no title, text, link or medium is refused (`400 empty_record`).

**One record per story.** The dedupe key is `dedupeKey` when given, else the
link, else the item's `slug` / `id` / `postId`; it is trimmed, lower-cased and
unique within the collection. Keys and idempotency keys are both optional — a
record with neither is always inserted.

**Caps.** Your plan's caps come back on the list (`caps`; pay-as-you-go
accounts get Basic's). Past the records cap the oldest records are evicted
after the write; `evicted` says how many. On a self-hosted server the caps are
the operator's two env ceilings (unset = `null`, no limit). A cap the server
cannot determine for a request (a failed plan lookup) is `null` for that
request — nothing is ever evicted on a guess.

`q` finds words in the title, the text and the link. `nextCursor` is an opaque
token; pass it back as `?cursor=` (`null` on the last page); a cursor the list
did not give out is refused with `400 invalid_cursor`. In the CSV export, a
cell starting with `=`, `+`, `-` or `@` is prefixed with `'` so a spreadsheet
opens it as text.

OAuth app tokens need `assets:read` for the reads and `assets:write` for the
writes (no-op for user / API-key auth). On a server that does not have
collections yet, the list answers `available: false`, the other reads answer
`404` and the writes answer `503 not_available`.

```bash
# Create a collection, then save one feed post into it
curl -s -X POST https://app.nodaro.ai/v1/collections \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"News","description":"Articles the pipeline wrote"}' | jq -r .id

curl -s -X POST "https://app.nodaro.ai/v1/collections/$COLLECTION_ID/records" \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-42-item-0" \
  -d "$(jq -n --slurpfile p post.json '{item: $p[0], fields: {topic: "tech"}}')" | jq '{outcome, evicted, id: .record.id}'

# What was saved in the last two days, as CSV
curl -s "https://app.nodaro.ai/v1/collections/$COLLECTION_ID/export?since=$(date -u -d '2 days ago' +%FT%TZ)" \
  -H "Authorization: Bearer $NODARO_TOKEN" -o news.csv
```

The same routes are wrapped by the SDK (`client.collections`), the MCP tools
(`list_collections` / `read_collection` / `add_collection_record`) and the CLI
(`nodaro collections`).

## 16e. Palettes and moodboards

Your own colour palettes and moodboards, used on generate-image as a
direction: `direction.colorLook: "palette:<id>"` names the palette's colours in
the prompt, and `direction.style: "moodboard:<id>"` adds the moodboard's
description to the prompt and sends its images as style references after your
own references, up to the model's reference limit. The whole contract — what
the prompt gets, how the images are capped, the `moodboard_images_not_sent`
warning, pricing and errors — is on its own page:
[Palettes and moodboards](./palettes-and-moodboards.md). Available on every
edition.

| Method | Path | Query / Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/palettes` | `limit` (1-100, default 50), `cursor` | Your palettes, newest first. Returns `{ data: ColorPalette[], nextCursor }`. |
| `POST` | `/v1/palettes` | body `{ name, colors, description? }` | Create a palette: 1–80-character name, 2–12 `#RRGGBB` colours (stored upper case), a note of up to 500 characters. `201`. |
| `GET` | `/v1/palettes/:id` | none | One palette. |
| `PATCH` | `/v1/palettes/:id` | body: any of `name`, `colors`, `description` | Only the fields sent are written; `description: null` clears it. |
| `DELETE` | `/v1/palettes/:id` | none | Returns `{ success: true }`. |
| `GET` | `/v1/moodboards` | `limit`, `cursor` | Your moodboards, newest first. Returns `{ data: Moodboard[], nextCursor }`. |
| `POST` | `/v1/moodboards` | body `{ name, description?, images }` | Create a moodboard: a description of up to 1,000 characters (the words that go into the prompt) and 1–12 images `{ url, caption? }` — `http(s)` links, never `localhost` or a private address, kept as links (never copied). `201`. |
| `GET` | `/v1/moodboards/:id` | none | One moodboard. |
| `PATCH` | `/v1/moodboards/:id` | body: any of `name`, `description`, `images` | Only the fields sent are written; `images` replaces them all. |
| `DELETE` | `/v1/moodboards/:id` | none | Returns `{ success: true }`; the linked images are untouched. |

Another person's palette or moodboard answers `404` like one that does not
exist. OAuth app tokens need `assets:read` for the reads and `assets:write` for
the writes; writes are limited to 30 requests a minute. On a server that does
not have them yet, the lists answer empty and the writes answer
`503 not_available`. The same routes are wrapped by the SDK (`client.palettes`,
`client.moodboards`), the MCP tools (`list_palettes` / `save_palette` /
`list_moodboards` / `save_moodboard`; `generate_image` takes `palette_id` /
`moodboard_id`) and the CLI (`nodaro palettes`, `nodaro moodboards`).

## 16c. Competitors (Nodaro Cloud)

Track brands (your competitors, or your own) and get action cards: what
happened, why it matters, what to do, each with the posts it rests on. A
scan reads the brand's accounts and searches posts that name it, one Social
Search page per search; see [Competitors](./features/competitors.md).

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/v1/competitors` | none | Every tracked brand: `{ data: TrackedCompetitor[], historyMonths }`, where `historyMonths` is how many months of scans your plan keeps (see **Over time**). Each lists in `searchPlan` what its next scan searches (`{ kind, platform }`: `own` for an account, `about` for the name searched on a platform). |
| `POST` | `/v1/competitors` | `{ brand, website?, accounts?, aboutPlatforms?, isOwn?, schedule? }` | Track a brand. `accounts` takes a handle or link per platform: `tiktok`, `instagram`, `youtube` (`@handle` or `youtube.com/channel/…`; an old `youtube.com/c/…` or `/user/…` link is refused), `x`, `linkedin` (a company page, or a person's profile `linkedin.com/in/…`), `meta_ads` (advertiser). An account that cannot be read answers `400 invalid_account`, naming it and what its field takes. A repeated `aboutPlatforms` entry counts once. `201` with the brand; `409 too_many_competitors` past 50 brands. |
| `GET` | `/v1/competitors/:id` | `?scan=<id>` optional | One brand with its latest scan (posts and cards), that scan platform by platform (`platforms`, see **Who is where**; `null` before its first scan) and its scan history (counts only). With `scan`, the brand as of that scan (`404 scan_not_found` for a scan that is not this brand's). |
| `GET` | `/v1/competitors/:id/history` | none | The brand's scans oldest first (free): `{ scans: [{ id, at, platforms: [{ platform, own, about, followers, usual, unit }] }] }` — per platform what each scan found and read; a scan stored before these were kept answers `null` for `own`, `about` and `followers`. |
| `GET` | `/v1/competitors/:id/compare` | `?from&to[&vsFrom&vsTo]` (ISO datetimes) | The brand over a period, and a second one to compare with (free): `{ periods: [{ from, to, platforms: [{ platform, own, about, usual, unit, followers, change, lessons, best }] }], posts }`. See **Over time**. `400 validation_error` when a period ends before it starts, is longer than a year, or `vsFrom` comes without `vsTo`. |
| `PATCH` | `/v1/competitors/:id` | any field of the above | Change it. `accounts` replaces the whole set: send every account to keep. A new `schedule` restarts its clock, so send it only to change it. While a scan of the brand runs, a change to `brand`, `accounts`, `aboutPlatforms` or `isOwn` answers `409 scan_running` (the scan was priced on them). |
| `DELETE` | `/v1/competitors/:id` | none | Stop tracking it (its scans and cards go too). |
| `GET` | `/v1/competitors/cards` | none | Every card from each brand's latest scan, most urgent first: `{ cards, posts, record, brands }`, where `posts` holds the posts the cards rest on, `record` is your track record (see **Did it work?**) and `brands` gives each brand's latest scan platform by platform (see **Who is where**). |
| `GET` | `/v1/competitors/:id/lessons` | none | What works for the brand (free): `{ lessons, posts }`. `lessons.platforms[]` gives, per platform, the brand's own posts counted (`posts`), their median reach (`usual`, `null` below `lessons.minPosts` posts), the best and weakest post ids, and `lessons[]`: a trait its best posts share (`kind`: `short_videos`, `long_videos`, `format`, `question_hook`, `number_hook`, `short_caption`, `long_caption`, `hashtag`, `sound`, `weekday`), its `params` (`lift`, `posts`, `winners`, `unit` and the trait's value), the `evidence` post ids and an English `text`. `posts` holds every post they name. |
| `GET` | `/v1/competitors/actions` | none | The cards you marked done, newest first, with how each went (free): `{ actions, record, posts }`. See **Did it work?** |
| `POST` | `/v1/competitors/actions` | `{ cardId, postUrl? }` | "I did this" on a card on your wall (`cardId` from `/cards`), optionally with the full link to your post that came of it. `201` with `{ action, posts, created: true }`; a card marked before answers `200` with its mark (`created: false`; a link sent then fills an empty one). `404 card_not_found` when the card left the wall, `400 not_measurable` when its advice is not a post of yours, `400 short_link` for a short link, `409 too_many_actions` past 500 marks. |
| `PATCH` | `/v1/competitors/actions/:id` | `{ postUrl }` or `{ seen: true }` | Link the post that came of it (`null` removes the link; another post is judged afresh, the same post under another link keeps its verdict), or mark its verdict seen. |
| `DELETE` | `/v1/competitors/actions/:id` | none | Undo the mark (its verdict leaves your record). |
| `POST` | `/v1/competitor-discover` | `{ website }` | Find a brand's accounts from its website (free). Each account says whether the site linked it or it is a guess to check. |
| `POST` | `/v1/competitor-scan` | `{ competitorId }` | Scan now. Answers `{ jobId }` at once; poll the job. |

**Price.** A scan of a brand with `n` searches (`TrackedCompetitor.searches`:
one per account, one per platform its name is searched on) costs `n`
Social Search pages, the credit id `competitor-scan:<n>`. The scan runs the
searches it was priced on, even if the brand changes before it starts.
Searches that fail are not charged; if every search fails the scan fails
and nothing is charged. Adding, reading and website lookups are free.

**Schedule.** `weekly` (the default) or `daily` scans start on their own
and are charged like a manual scan; `off` scans only on request. A scan
that could not start (no credits, the feature not offered on your account)
is reported on the brand as `lastScanError`.

**Cards.** Each card has a `kind` (`outlier`, `launch`, `complaints`,
`spreading`, `sound`, `mentions_up`, `pace`, `market_sound`,
`top_in_sources`), a `priority` (1 act now, 2 opening, 3 good to know),
`params` (the numbers to phrase it with), the ids of the posts it rests on,
English `title` / `why` / `action`, and a `strength` from 0 to 1. The list
comes ordered: priority, then a fixed order of kinds, then strength, across
all your brands. Competitor scans do not produce `top_in_sources`. A scan's
`counts.okSearches` names the searches that returned (`own:tiktok`,
`about:reddit`); a post is new only against scans that could read its
platform.

**Who is where.** `brands` (on `/cards`, keyed by brand id: `{ scanId, at, platforms }`) and `platforms` (on `/:id`) list, per platform the latest scan searched or found posts on: `own` (the brand's own posts it kept there) and `about` (posts about the brand), `searched` (which of its searches ran there: `own` for the account, `about` for the name) and `failed` (which of those failed; `null` for a scan stored before failed searches were recorded by name that had failures, so it cannot say which), plus what works there: `usual` (the brand's typical reach there, in `unit`: `views`, `likes` or `points`), and `top` (its strongest lesson there, shaped as in `/lessons`). `usual`, `unit` and `top` are worked out when a brand is scanned, from the same scans `/lessons` reads, so they match `/lessons` until the next scan, and are `null` until a brand's first scan after they were added. Every tally also carries `followers` (the account's followers at that scan; `null` on YouTube and Reddit, which give none, or when no post of its own was read). `brands`, `platforms`, `searchPlan` and `followers` are absent from a server older than them.

**Over time.** Scans are kept for a window that follows your plan (`historyMonths` on the list: Free, Pay as you go and Basic a month; Standard 3; Pro 6; Business 12); older scans are deleted when the brand is next scanned. `/history` is the series. `/compare` reads the stored scans for one period (`from`–`to`) or two (`vsFrom`–`vsTo` as well): a post belongs to a period by the day it was published (a scan reads a month back, so one post shows up in several scans and is counted once, with its newest numbers; a post the platform gave no date for counts on the day the first scan saw it). Per platform: `own` and `about` (posts in the period), `usual` (the median reach of its own posts, `null` below three), `followers` (`{ value, at }` from the newest scan inside the period, `null` when none read them) and `change` (against the newest scan before the period, `null` when either side is unknown), `lessons` (what worked there, shaped as in `/lessons`; they need eight posts) and `best` (up to four post ids, best first). `posts` holds every post named.

**Did it work?** A mark keeps what the card said (`card`: its words,
`params`, `priority`, brand, platform, evidence) and its `outcome`, judged
from the scans of your own brand (the one with `isOwn`): `state` is `worked`,
`flat` or `missed` (a verdict on the one post tied to the card, with
`ratio`, `reach` and the `usual` it was compared with), `waiting` (too new,
or not scanned yet), `not_found`, `older_than_advice`, `no_baseline`,
`posts_since` (nothing tied; your posts since, no verdict), `no_posts_yet`
or `no_brand`. A post is tied by your link, or for a sound card by your
first post with that sound after the advice (`matchedBy`). `candidates`
lists your recent posts to pick the one from. The first verdict is kept in
`verdict` and does not change; `seenAt` is when you first saw it; `onWall`
is false once the card left the wall (it can then be marked anew). `record`
sums verdicts per family of advice (`sound`, `outlier`, `launch`,
`complaints`): `tried`, `worked`, `flat`, `missed`, `avgRatio`; `shown`
when there are enough to say, and `tier` (`proven`, `weak`, `neutral`): on
`/cards`, cards of a `proven` family come first within their priority and
`weak` ones last.

OAuth app tokens need `assets:read` for the reads and `assets:write` for the
writes, the marks and the website lookup; a scan spends credits, so it also needs a
`:write` or `:execute` scope. While the tables are missing on a server the
reads answer empty and the writes answer `503 not_available`; the marks
(`/v1/competitors/actions*`) answer `503 not_available` until their table
exists, and `/cards` then answers with an empty `record`.

```bash
# Track a brand from its website, then scan it
curl -s -X POST https://app.nodaro.ai/v1/competitor-discover \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -d '{"website": "acme.example"}' | jq .
curl -s -X POST https://app.nodaro.ai/v1/competitors \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -d '{"brand": "Acme", "accounts": {"tiktok": "acme", "instagram": "acme"}}' | jq '.id'
curl -s -X POST https://app.nodaro.ai/v1/competitor-scan \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -d '{"competitorId": "<id>"}' | jq .

# What to do now
curl -s https://app.nodaro.ai/v1/competitors/cards -H "Authorization: Bearer $NODARO_TOKEN" | jq '.cards[] | {id, title, action}'

# Did it work? Mark a card done with your post, then read how it went
curl -s -X POST https://app.nodaro.ai/v1/competitors/actions \
  -H "Authorization: Bearer $NODARO_TOKEN" -H "Content-Type: application/json" \
  -d '{"cardId": "<card id>", "postUrl": "https://www.tiktok.com/@you/video/123"}' | jq '.action.outcome'
curl -s https://app.nodaro.ai/v1/competitors/actions -H "Authorization: Bearer $NODARO_TOKEN" | jq '.record'
```

The same routes are wrapped by the SDK (`client.competitors`), the MCP tools
(`list_competitors`, `competitor_cards`, `competitor_lessons`,
`competitor_tried`, `mark_card_done`, `add_competitor`, `scan_competitor`)
and the CLI (`nodaro competitors`).

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
| `GET` | `/v1/voice-clones` | List the voice clones you created before cloning was retired. |
| `POST` | `/v1/voice-clones`, `/v1/voice-clones/from-url` | **Retired** — voice cloning is no longer offered. Both answer `410` with `error.code = "voice_cloning_retired"`. Use `/v1/voice-design` for a new custom voice. |
| `PATCH` | `/v1/voice-clones/:id` | Rename / edit an existing clone. |
| `DELETE` | `/v1/voice-clones/:id` | Delete an existing clone. |
| `POST` | `/v1/voice-design` | Design a synthetic voice from a description (`{ text, voiceDescription, model?, loudness?, guidanceScale?, seed?, quality?, shouldEnhance? }`) → job. |
| `POST` | `/v1/voice-remix` | Speak a text in a described voice, no cloning (`{ text, voiceDescription }`) → job. |
| `POST` | `/v1/dubbing` | Translate-and-revoice audio OR video (`{ audioUrl \| videoUrl \| sourceUrl (exactly one), targetLanguage, sourceLanguage?, numSpeakers? (0=auto), disableVoiceCloning?, dropBackgroundAudio?, startTime?, endTime?, highestResolution?, useProfanityFilter?, targetAccent?, watermark? }`) → job. Video mode delivers `output_data.videoUrl` + the dubbed `audioUrl`. Priced per minute of the dubbed span (min 1); span capped at 30 minutes (413 past it — the start/end window is the lever). |

The id to use everywhere a voice is accepted is the clone's
`elevenlabsVoiceId` (create/list responses) or the catalog's `voice_id`.

### Voice Changer & Voice Changer Pro

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/voice-changer` | Single-voice re-voicing of an audio track or a talking video (`{ voiceId, audioUrl? \| videoUrl?, model?, stability?, similarityBoost?, style?, useSpeakerBoost?, seed?, removeBackgroundNoise? }`) → job. |
| `POST` | `/v1/voice-changer-pro` | Multi-speaker recast (**Cloud; self-host runs it through the [nodaro.ai connection](./community-cloud-connect.md)**): `orderedVoices` maps detected speaker N to entry N (string id, per-voice settings object, or `null` keep-slot). `output: "video"` (default) renders the finished result; `output: "stems"` returns dry per-track stems for an interactive mix. Pass a prior `analysis` to skip re-detection. → job. |
| `POST` | `/v1/voice-changer-pro/analyze` | Detect the speakers WITHOUT recasting (**Cloud only** — the interactive analyze/mix/export flow is not relayed to self-host yet): separates voice from music once and diarizes, returning `speakers` (id, segments, first-appearance, word count, snippet), detected language, and the persisted stem urls. `suggestTitle: true` adds an LLM title. → job. |
| `POST` | `/v1/voice-changer-pro/export` | Render the final video from a mixed track set (**Cloud only**): `{ videoUrl, tracks: [{ url, gain 0–200, muted, kind?: "voice"\|"background" }] (≤16), voiceFx? }`. The video stream is copied, never re-encoded; at least one track must be un-muted. → job. |
| `POST` | `/v1/voice-changer-pro/translate` | Translate the detected transcript into one target language, per segment, with a per-utterance length budget so the re-spoken line fits its slot (**Cloud only**): `{ speakers, targetLanguage, sourceLanguage?, tier?: economy\|standard\|premium }` → job. `output_data.speakers` keeps every speaker, segment and timing with the translated `text` (the original as `sourceText`) plus `untranslated` (utterance ids left in the source language). Quote them back as the recast's `analysis.speakers` with `engine: "v4", languageCode: "<target>"` on each re-spoken voice — `languageCode` is accepted on `"v4"` only (`400` on `"sts"`/`"v3"`, or for a language the model does not offer). Metered on the model's usage, floor 3 credits<!-- credits: voice-changer-pro-translate -->, ceiling per started 1K source characters by tier (~5.5 / ~11 / ~16.5). |

Credits: recast charges per **mapped** speaker; analyze and export are
flat-priced; translate is metered on the translation model's usage with a
3-credit<!-- credits: voice-changer-pro-translate --> floor under a per-tier ceiling (see the [Voice Changer Pro node page](./nodes/ai-audio/voice-changer-pro.md)
for the formulas). Off Cloud, the four `voice-changer-pro*` routes are absent (404).

### Media ingestion

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/download-video` | Import a social video (YouTube/TikTok/Instagram/X/Facebook) or a direct video file link into storage (`{ url, maxHeight?, sectionStartSec?, sectionEndSec?, exactSection?, requireAudio? }`). A section is fetched with a few seconds of margin on each side, for a client that trims it afterwards; `exactSection: true` cuts it at exactly the requested range instead. A result with no audio stream fails unless `requireAudio: false`. At most 4 downloads run per account at once — a fifth answers `429 too_many_downloads`. Returns `{ downloadId }` — not a job. |
| `GET` | `/v1/download-video/progress/:downloadId` | Live progress as **server-sent events** (`{ phase, percent, videoUrl?, error? }` every ~500ms; stream ends on `completed`/`failed`). |
| `POST` | `/v1/video-metadata` | Probe duration/dimensions/title without downloading (`{ url }`). Direct read, not a job. |
| `POST` | `/v1/trim-video` | Trim a video (`{ videoUrl, startTime?/endTime? \| keepFirstSeconds? \| keepLastSeconds? \| trim*Frames/Seconds }`) → job. |
| `POST` | `/v1/trim-audio` | Trim/extract audio (`{ videoUrl? \| audioUrl?, startTime?, endTime?, audioFormat?: mp3\|wav\|aac }`) → job. |
| `POST` | `/v1/split-media` | Cut a video and/or an audio file into consecutive parts, local FFmpeg, **22 credits**<!-- credits: split-media --> per run whatever the number of parts (`{ videoUrl?, audioUrl? (at least one; both are each split on their own), chunkDuration: ≥ 1 (seconds, the longest a part may be), minPartDuration?: ≥ 0 (seconds, default 4; above `chunkDuration` is a `400 validation_error`), audioFormat?: mp3\|wav\|aac — aac parts are `.m4a` files }`; `output_data` = `{ videoUrls?: string[], audioUrls?: string[], chunkCount, partDurationsSec?: number[], audioPartDurationsSec?: number[] (only when both were split) }`). Video is cut on whole frames, each part's sound ending at most ~21 ms before its picture; audio-only parts are sample-exact in mp3/wav and on whole AAC frames in aac; sources up to 3 hours, at most 200 parts per input — a source that needs more, is shorter than the minimum, or cannot be cut into parts between the two lengths fails with a message saying so. Full rules: [Split into Chunks](./nodes/processing-audio/split-media.md). → job. |
| `POST` | `/v1/add-captions` | Burn captions into a video (`{ videoUrl, text? \| captions?[] \| transcript? \| auto_transcribe?, transcribe_provider?: incredibly-fast-whisper\|elevenlabs-stt\|whisper, style?: subtitle\|word-highlight\|karaoke\|tiktok-words\|word-pop\|bouncy, position?, positionY?, fontSize?, color?, backgroundColor?, look?: outline\|clean, fontFamily?, fontWeight?, strokeColor?, strokeWidth?, uppercase?, maxWordsPerLine?, highlightColor?, animate?, wordLevel?, segments?[] }`) → job. Caption-source precedence: `captions[]` > `transcript` > `text` on `subtitle` > auto-transcription. On a top-level `subtitle` (no `segments`) `text` is burned as-is as ONE static block for the whole video — never transcribed over, with or without styling levers; omit it to caption the speech. On a kinetic style `text` is only the fallback (used when transcription returns nothing or `auto_transcribe` is `false`, spread evenly across the video). An unset `look` is `outline` on the kinetic styles and `clean` on `subtitle`. `maxWordsPerLine` (integer 1–20, optional) caps the words on one caption line — or one `tiktok-words` page — **on top of** the frame-width budget, sentence ends and ≥0.5 s pauses (`1`–`2` = the punchy CapCut read, unset = fit the width); it counts words, not caption entries (a phrase-level entry holding more than N words is split into sub-phrases of at most N words; on a `text` subtitle it only sets the line breaks of the one static block); it exists top-level and per `segments[]` entry (a segment inherits the top-level value) and is inert on `word-pop`. `word-highlight`, `karaoke` and `bouncy` show one held line at a time. `highlightColor` and `animate` are kinetic-only (`400` on `subtitle`); every other lever, `maxWordsPerLine` included, also styles a `subtitle`. A kinetic style needs a `transcribe_provider` that returns word timings (`incredibly-fast-whisper`, the default, or `elevenlabs-stt`) — `whisper` is a `400` on `transcribe_provider` there when transcription is the render's only caption source; `subtitle` needs phrase timing only and works with any engine. A bare plain-text `subtitle` is the cheap FFmpeg burn; a kinetic style, any styling lever, timed captions, auto-transcription or `segments` renders via Remotion, bills at the kinetic price and keeps the source frame rate (whole number, 15–60 fps; a variable-frame-rate or very long source renders at 30 fps). Full reference: [Add Captions](./nodes/processing-video/add-captions.md). |
| `POST` | `/v1/silence-detect` | Detect silent spans in an audio or video source, local FFmpeg, **11 credits**<!-- credits: silence-detect -->, keyless (`{ audioUrl, thresholdDb?: -35, minSilenceMs?: 700, padMs?: 120 }`; `output_data.json` = `{ version, ranges: [{ startMs, endMs }], durationMs }`) → job. |
| `POST` | `/v1/audio-sync` | Measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound, local FFmpeg + correlation, **10 × (sources − 1) credits** (2 → 10, 4 → 30, 6 → 50), keyless (`{ sources: [{ id, url }] (2–6, unique ids, audio or video), reference?: <one of the ids, default the first> }`; a repeated id or a `reference` that is not one of the ids is a `400 validation_error` naming it; `output_data.json` = `{ version, reference, offsets: [{ sourceId, offsetMs, confidence, driftMsPerHour }], notes }` with `referenceMs = sourceMs + offsetMs`; drift is measured and warned in `notes` past 33 ms over the shared stretch, never corrected). Full reference: [Audio Sync](./nodes/processing-audio/audio-sync.md). → job. |
| `POST` | `/v1/edit-plan` | Plan a transcript-driven edit of a recording, no media output (`{ mode: tighten\|clips\|chapters\|trailer, planTier: economy\|standard\|premium, transcript, sources: [{ id, url, kind, role?, speakers?, offsetMs? }] (1–6), silence?, instructions?, styleGuide?, count?, targetDurationSec?, targetAspect?, platform? }`; `output_data` = an EDL for `tighten`, `{ version, clips: Edl[] }` for `clips`, `{ version, chapters }` for `chapters`, an EDL for `trailer`). A mode the server does not plan ([Edit Plan modes](#edit-plan-modes)) or does not know answers `400 mode_not_available` before anything is charged. Priced per source-minute × tier on a length bucket, plus a flat term in `clips` and `trailer` modes: `per_minute(tier) × bucket_minutes + (clips or trailer ? clips_flat(tier) : 0)` — full formula and worked examples on [Edit Plan](./nodes/processing-video/edit-plan.md#credit-cost). Runs on nodaro.ai; a self-hosted install relays it once connected and otherwise answers `503 nodaro_connection_required`. Multicam offsets are applied by the caller before this request (the SDK's `editPlan({ offsets })` and MCP `plan_edit` do it for you). → job. |
| `POST` | `/v1/episode-chapters` | [Chapters](./nodes/processing-video/episode-chapters.md): a recording's chapters in one run — Transcribe, then Edit Plan in Chapters mode, each its own job; nothing is rendered (`{ mediaUrls: [<recording URL>] (one, up to 3 hours, with sound), planTier?: economy\|standard\|premium (default economy), instructions?, styleGuide? }`; `output_data.text` = the show notes, one `M:SS Title` line per chapter (once a chapter starts at 1:00:00 or later, every line is `H:MM:SS`; the first at 0:00, the times strictly increasing — two chapters in the same second keep the first), `output_data.json` = `[{ startMs, title }]`, the same rows; the first starts at 0). A run that finds no chapters fails and its fee is refunded. Its steps at their own rates plus a per-run fee of **11 credits**<!-- credits: use-case-fee:episode-chapters -->. An `Idempotency-Key` makes a retry answer the same run (`deduped: true`). On a self-hosted install it needs a nodaro.ai connection (`503 nodaro_connection_required` otherwise, nothing created). **Not yet enabled on nodaro.ai.** → `202 { jobId, executionId }`. |
| `POST` | `/v1/episode-chapters/estimate` | The same body; answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` and starts nothing (the credit figures are 0 on an edition without credits). |
| `POST` | `/v1/episode-chapters/continue` | `{ jobId, "mode": "from-failed" }`: run what a failed Chapters run did not complete, as a new job (finished steps are kept and not charged again; the fee is held again, the failed run's was refunded). Refusals: the [continuation codes](#continuing-a-run); `"mode": "render-final"` is refused `409 render_final_not_preview` (nothing renders). |
| `POST` | `/v1/camera-switch` | Put each cut of an edit on the camera of whoever is speaking — the sound never changes (`{ edl, transcript (with speaker labels), speakerMap?, speakerNames?, minShotMs?, leadMs?, maxShotMs?, wideEvery?, layoutHints? }`; `output_data.json` = the switched EDL for `/v1/apply-edl`, `output_data.transcript` = the transcript with `speakerNames` applied). **11 credits**<!-- credits: camera-switch --> flat per run. Refused before anything is created: `400 invalid_edl` when `edl` is not one master-clock edit (a clip set, a chapters plan), `422 no_speakers` when the transcript has no speaker labels. Runs on nodaro.ai; a self-hosted install relays it once connected and otherwise answers `503 nodaro_connection_required`. Full reference: [Camera Switch](./nodes/processing-video/camera-switch.md). → job. |
| `POST` | `/v1/speaker-view` | Render an edit with the speakers laid out on screen, from the original cameras with the master audio (`{ edl | videoUrl, transcript?, quality?: final\|proxy, targetAspect?: 16:9\|9:16\|1:1\|4:5, layout?, switch?: { type, durationMs? }, emphasis?: { style, durationMs? }, speakerRegions?: [{ source, speaker, region }], tracks?, motion?: static\|glide, clipKey? }` — `tracks` is Speaker Frames' output descriptor, never the boxes, its labels overriding the stored file's by track id; a camera the render follows (a slot without its own crop in the EDL) whose file or offset changed since Speaker Frames ran, or tracks no Speaker Frames run of the account made, are refused `400 invalid_tracks` before anything is created — a check made by the editor's Run, by a workflow run and by the route itself, on nodaro.ai and on a self-hosted install alike (a self-hosted install makes it against its own Speaker Frames run before it relays the render, and nodaro.ai leaves the relayed render to it); `output_data` = `videoUrl` + `thumbnailUrl`, `json` = the edit as rendered, `transcript` = the wired transcript remapped through it, absent when none was wired). Send exactly one of `edl` and `videoUrl` (a public http(s) link to a video, cut whole at the speakers' turns, `targetAspect` defaulting to 9:16): with `videoUrl` the `transcript` is required and must name its speakers, the server measures the picture's real length once and builds the one-clip edit itself, and a clip whose length cannot be measured (`422 video_unreadable`), both or neither input (`400 invalid_input`), a missing transcript (`400 transcript_required`, `422 no_speakers`) or a video already as narrow as the target aspect (`400 source_not_wider`) is refused before anything is created. Priced per minute of output in two tiers by how many speakers are on screen at once (see the [Speaker View node page](./nodes/processing-video/speaker-view.md#credit-cost)): reserved on the edit as given, charged on the rendered cut's own minutes. Runs on nodaro.ai; a self-hosted install relays it once connected (otherwise `503 nodaro_connection_required`), and first refuses `422 source_too_large`, naming the source and its size, when a source stored on the install is over the 500 MB a relay can send — use a public URL for a large camera file. A `quality: proxy` render is private. → job. |
| `POST` | `/v1/speaker-frames` | Find where each speaker's face is, per camera (`{ edl?, videoUrl?, transcript?, excludeSourceIds? }` — exactly one of `edl` (one EDL, a clip pack run once over the union of its clips, or a clip set) and `videoUrl`; `output_data.json` = the stored face-track file's descriptor: `url`, `sha256`, `bytes` and per-camera track summaries). Priced per started block of 1,000 sampled frames (at least one block), reserved from the frames the server counts itself — the edit's kept spans on the ticked cameras, or the video's measured length — and charged on the frames the run sampled. Runs on nodaro.ai; a self-hosted install relays it once connected (otherwise, or when nodaro.ai rejects the install's connection, `503 nodaro_connection_required`), sending only detection copies it builds itself of the cameras it samples — never an original: every other source of the edit (the master audio, an unticked camera) goes as a placeholder URL nodaro.ai never reads — and answers `503 speaker_frames_relay_unavailable` while nodaro.ai does not take runs from a connected install. → job. |
| `GET` | `/v1/speaker-frames/capabilities` | `{ relay, source }`: whether this server runs a Speaker Frames job relayed from a connected self-host (a self-host asks nodaro.ai's copy). `source`: `server`, `nodaro.ai`, `nodaro.ai-unreachable`, `nodaro.ai-rejected` (the install's connection was rejected) or `not-connected`. |
| `POST` | `/v1/apply-edl` | Render an edit decision list into one video or audio file, local FFmpeg, keyless (`{ edl, sources?: [url] (positional overrides of edl.sources[i].url), transcript?, output?: video\|audio, quality?: final\|proxy, crossfadeMs?: 0–5000, clipKey?: "<first inMs>-<last outMs>" }`; `output_data` = `videoUrl` + `thumbnailUrl` or `audioUrl`, `quality`, `clipKey` when sent, and `json` = the transcript remapped through the cut when one was sent). Priced per minute of rendered output: **11 credits**<!-- credits-rate: apply-edl --> **× ceil(output_seconds ÷ 60)** at `final`, **1.1 credit**<!-- credits-rate: apply-edl:proxy --> **× ceil(output_seconds ÷ 60)** for a `proxy` Preview, the run's total rounded up to a whole credit (minimum one minute; a Preview is always private). An EDL the renderer cannot render, or one over 180 minutes of output, is a `400 invalid_edl` naming the segment and rule before any credits are reserved. Full reference: [Apply EDL](./nodes/processing-video/apply-edl.md). → job. |
| `POST` | `/v1/still-to-video` | One still image + one audio track → MP4, local FFmpeg, **0 credits** (`{ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? }`; output duration = the audio's duration, no duration field) → job. |
| `POST` | `/v1/slideshow` | 2–100 images + one optional audio track → MP4 slideshow, local FFmpeg, **0 credits** (`{ imageUrls[], audioUrl?, imageDurations?[] (null=auto), perImageDuration?, transition?, transitionDuration?, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? }`; with audio the duration IS the audio's — pinned-row mismatches scale proportionally, disclosed in output) → job. |
| `POST` | `/v1/video-overlay` | 1–20 timed image layers over a video, local FFmpeg, **22 credits**<!-- credits: video-overlay --> (`{ videoUrl, layers[]: { imageUrl, start, end?, preset?: card\|corner-badge\|full-frame, corner?, anchor?, x?, y?, width?, height?, fit?: contain\|cover, opacity?, animate?, zIndex? }, outputAspect?: 16:9\|9:16\|1:1\|4:5, baseFit?: cover\|contain, backgroundColor? }`; an explicit box field overrides the preset, neither = a corner badge (bottom-right, or the `corner` it names); `end` omitted = to the end of the video; base audio untouched; 30 requests / minute per user) → job; output `{ videoUrl, thumbnailUrl, width, height, durationSec, warnings[] }`. Full reference: [Video Overlay](./nodes/processing-video/video-overlay.md). |
| `POST` | `/v1/video-depth` | Turn a video into a depth video — near is bright, far is dark (`{ videoUrl, provider?: video-depth-anything\|depth-anything-frames, modelSize?: small\|base\|large, colormap?: grayscale\|turbo\|inferno\|magma\|viridis, resolution?: auto\|360p\|480p\|720p\|1080p, sideBySide? }`; `provider` defaults to `video-depth-anything` and `modelSize` to `large`). `video-depth-anything` honours every lever; `depth-anything-frames` (per frame, may flicker) honours `modelSize` and `colormap` `grayscale` or `inferno` only. A lever the provider does not take is ignored and a colormap it cannot render becomes `grayscale`, so switching providers never fails a request — but every value sent must still be valid (an unknown provider, model size, colormap or resolution is a `400 validation_error`). The clip is measured before anything is created and priced by its length tier: `400 video_too_long` over the provider's limit (2,400 frames and at most 300 s for `video-depth-anything`, a clip with no frame rate counted at 30 fps; 80 s for `depth-anything-frames`), `400 video_unreadable` when the clip cannot be read, `400 validation_error` on a malformed body, `403 model_not_available` when this deployment has turned the provider off (an omitted `provider` is checked as the default) — nothing is reserved on any of them. → `{ jobId }`; output `{ videoUrl, thumbnailUrl }`. Full reference: [Video Depth](./nodes/processing-video/video-depth.md). |
| `POST` | `/v1/video-mask` | Text-prompted video segmentation (SAM 3.1 / SAM 3) → a black-and-white mask video, white = the subject (`{ videoUrl, prompt (≤500 chars; commas track several subjects), threshold?: 0.05–0.95 (default 0.5), provider?: "sam-3.1" (default) \| "sam-3" (about half the price) }`). Clips up to 5 minutes at 30 fps (a faster clip counts proportionally longer; over 60 s is segmented in chunks); a clip that can't be read or is over the limit is refused with 400 `invalid_video_duration` / `video_duration_exceeds_limit` before anything is charged. Priced by length: `sam-3.1-video:<n>s` / `sam-3-video:<n>s` for n = 5, 10, 15, 30, 60, 90, 120, 180, 240, 300 (SAM 3.1: 55<!-- credits: sam-3.1-video:5s --> … 3108 credits<!-- credits: sam-3.1-video:300s -->; SAM 3: 28<!-- credits: sam-3-video:5s --> … 1555<!-- credits: sam-3-video:300s -->) → job; output `{ videoUrl, thumbnailUrl, width, height, frames, chunks, coverage }`. Full reference: [Video Mask](./nodes/ai-video/video-mask.md). |
| `POST` | `/v1/mask-composite` | A foreground video over a background video through a mask video (white = foreground), local FFmpeg, keyless, **11 credits**<!-- credits-rate: mask-composite --> **per started 5 s of the result** (foreground measured first; over 300 s → 400 `video_duration_exceeds_limit`) (`{ foregroundUrl, backgroundUrl, maskUrl, invertMask?, feather?: 0–20, grow?: -10–10, backgroundFit?: cover\|contain\|stretch, audioSource?: foreground\|background\|mix\|none }`; the result follows the foreground's size, rate and length — the background loops, the mask holds its last frame) → job; output `{ videoUrl, thumbnailUrl, width, height, durationSec }`. Full reference: [Mask Composite](./nodes/processing-video/mask-composite.md). |
| `POST` | `/v1/site-capture` | A web page captured at phone width: full page + up to 8 section stills and a section map, **11 credits**<!-- credits: site-capture --> (`{ url, maxStills?: 3–8 }`). Always answers `{ jobId, status: "pending" }` at once; poll `GET /v1/jobs/:id`. Blocked, empty, unreachable or failed captures are refunded; a site that answers 403 or 429, or shows only a bot challenge, counts as blocked. Each still is shot with its section scrolled into view, so sections that appear as you scroll are captured too. A still that renders as one flat colour, or as mostly one empty band, is shot once more and then skipped: the next section takes its place (`still_blank_skipped:<section order>` in `warnings`). A section whose heading still does not show once it is on screen (a carousel slide that is not showing, for one) is skipped (`still_hidden_skipped:<section order>`), and the stills stop after about 45 s with what they have (`stills_time_budget`). `facts[]` are whole figures on one line (a price with its period, a count with its noun, a percentage, a date). A robots.txt disallow, an unreadable robots.txt, an address that does not resolve, or missing media storage is a 422 before any charge. Output `{ pageUrl, finalUrl, title, lang, dir, fullPage, stills[], sections[], facts[], usableStills, warnings[] }`; a failed job carries `error.code`. Served only where capture is enabled on the install (`SITE_CAPTURE_ENABLED`, on by default); elsewhere the route answers 404. |
| `POST` | `/v1/save-to-storage` | Server-side copy of an external URL into storage (`{ mediaUrl, filename?, mediaType? }`) → job. |

### Social connections & publishing

Connect flows are popup-based and meant for the web app; publishing is available to personal tokens (OAuth apps are deliberately blocked from managing connections).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/social/providers` | Registry of supported networks with per-deployment availability: `{ id, label, connectKind, editor, category, capabilities, available, missingEnv?, setupHint? }`. `category` is `social` (a feed you post to) or `publishing` (a site you publish articles on) — every network declares one. Unconfigured networks are listed with `available: false` — never hidden. |
| `GET` | `/v1/social/auth-url?platform=` | Start an OAuth connect (popup URL). `400 provider_not_configured` (with the missing env var names) when the deployment lacks that network's app credentials. |
| `GET` | `/v1/social/callback/:platform` | OAuth redirect target (public). For Facebook/Instagram logins managing multiple Pages/accounts, responds with an **account picker** page instead of silently connecting the first account. |
| `POST` | `/v1/social/connect/finalize` | Completes an account-picker selection (`{ token, accountId }`; the one-time token authorizes the call — public route, popup-internal). |
| `GET` | `/v1/social/connections` | List the caller's connected accounts. |
| `DELETE` | `/v1/social/connections/:id` | Disconnect an account. |
| `POST` | `/v1/social/telegram/connect` | Connect Telegram by pasting a bot token (`{ botToken }`). |
| `POST` | `/v1/social/connect/custom` | Connect a `custom_fields` network (`{ platform, fields }`) — Bluesky, Dev.to, Hashnode, Medium, WordPress, Lemmy. Field specs come from `GET /v1/social/providers` (`customFields`); the credential is validated against the network before saving. |
| `POST` | `/v1/social/publish` | Publish now (`{ platform, action, connectionId?, caption?, mediaUrl? \| mediaItems?, … }`) → job. 11 credits<!-- credits: social-publish -->. Retry semantics differ by failure: `503 publish_retryable` means nothing was posted and the identical request is safe to re-send, while `500 publish_failed` means the outcome is unknown — re-sending it can duplicate the post. |
| `POST` | `/v1/social/scheduled-posts` | Schedule a publish (`{ connectionId, action, scheduledAt, caption?, media?: [{type, r2Key \| url}], … }`). Media must be assets hosted on this deployment (stable refs — resolved to fresh URLs at publish time; foreign URLs are rejected). 11 credits<!-- credits: social-publish -->, charged at publish. |
| `GET` | `/v1/social/scheduled-posts?from=&to=&status=` | List the caller's scheduled posts (calendar range). |
| `PATCH` | `/v1/social/scheduled-posts/:id` | Edit while still `queued`/`draft` (`409 not_editable` once publishing). |
| `DELETE` | `/v1/social/scheduled-posts/:id` | Cancel a queued post (soft — history retained). |

### Audio primitives

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/audio-separation` | Demucs stems (`{ audioUrl, mode?: vocal_instrumental\|stems, quality?: auto\|fast\|best }`) → job. |
| `POST` | `/v1/audio-isolation` | Voice isolation / denoise (`{ audioUrl }`) → job. |
| `POST` | `/v1/audio-fx` | Reverb/echo/telephone/megaphone (`{ audioUrl, preset?, mix?, delayMs?, decay?, eqLow?, eqHigh? }`) → job. |
| `POST` | `/v1/mix-audio` | Sum 2–20 tracks (`{ audioUrls, trackVolumes?, duck?, endAt? }`) → job. `duck` = `{ under, amount?, thresholdDb?, ratio?, attackMs?, releaseMs? }` dips every track except `audioUrls[under]` while that track is loud (sidechain compression; `amount` 0–100 default 75, `thresholdDb` default -30, `attackMs` 20, `releaseMs` 500; `ratio` 1–20 overrides `amount`). A ducked mix sums instead of averaging. Same price with or without `duck`. `endAt` (`"longest"`, the default, or `"voice"`): `"voice"` ends the mix when the `duck.under` track ends, and needs `duck` (else `400 validation_error`). |
| `POST` | `/v1/adjust-volume` | Level/normalize/fade (`{ audioUrl? \| videoUrl?, volume?, normalize?, fadeIn?, fadeOut? }`) → job. |
| `POST` | `/v1/pitch-tempo` | Pitch shift + time-stretch with Rubber Band (`{ audioUrl \| videoUrl (exactly one), semitones?: -12..12, tempo?: 0.5..2, preserveFormants?: boolean }`) → job; a video keeps its picture (tempo fixed at 1). Priced per started input minute (22 credits<!-- credits-rate: pitch-tempo -->/min, inputs up to 30 min); the input is measured first — `400 invalid_media_duration` / `media_duration_exceeds_limit` before any charge. See [Pitch & Tempo](./nodes/processing-audio/pitch-tempo.md). |
| `POST` | `/v1/combine-audio` | Concatenate segments (`{ segments: [{ url, startTime?, endTime? }] }`) → job. |
| `POST` | `/v1/transcribe` | Speech → text (`{ audioUrl, provider?: elevenlabs-stt\|incredibly-fast-whisper\|whisper, language?, diarize?, tagAudioEvents?, wordTimestamps? }`) → job; `output_data` = `{ text, language?, words? (ms), json? (the normalized Transcript, ms), segments? (seconds, legacy lanes) }`. All three engines are accepted. Word timings: `elevenlabs-stt` always (and it is the lane that honours `diarize` / `tagAudioEvents`), `incredibly-fast-whisper` with `wordTimestamps: true`, `whisper` never — it returns phrase segments only, and `wordTimestamps: true` on it is a `400 validation_error` on `wordTimestamps`, before the job is created (nothing charged). Omitting `provider` still runs the legacy `whisper` lane, so name an engine whenever you need word timings. `words` is the `captions[]` shape `/v1/add-captions` takes. Full reference: [Transcribe](./nodes/ai-text/transcribe.md#word-timestamps-which-engine-can-do-it). |

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

# 1b. (Optional) Translate the transcript to re-speak the video in another language
#     — metered on the translation model's usage (2-credit floor, per-tier ceiling)
JOB=$(curl -s -X POST $BASE/v1/voice-changer-pro/translate -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"speakers\":$(echo $ANALYSIS | jq .speakers),\"targetLanguage\":\"es\",\"tier\":\"economy\"}" | jq -r .jobId)
TRANSLATED=$(curl -s "$BASE/v1/jobs/$JOB/status" -H "$AUTH" | jq .data.output_data)   # review/edit .speakers[].segments[].text
ANALYSIS=$(echo $ANALYSIS | jq --argjson s "$(echo $TRANSLATED | jq .speakers)" '.speakers = $s')
# each re-spoken voice then carries engine "v4" + languageCode "es" (the target), e.g.
#   "orderedVoices":[{"voiceId":"Rachel","engine":"v4","languageCode":"es"},null,"Aria"]

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

// Or sync — the server holds the request for up to 10 minutes.
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
> for the user-facing feature doc. On other editions these three routes are not
> registered (404). SDK: [`client.characters.train` / `trainingStatus` /
> `deleteLora`](./sdk-reference.md#character-training); CLI: `nodaro characters
> train | training | delete-lora`; MCP: `train_character`, with the status on
> `get_character`.

**Scopes.** With an OAuth app token, starting a training and removing a
trained model need `assets:write` — the same gate as creating or deleting the
character — and are refused with `403 insufficient_scope` otherwise, before
anything is reserved. The status read needs no scope, like the character reads.
A session or a personal API key needs no scope.

The refusals these routes write themselves use an older body shape — the code
is a bare string, `{ "error": "<code>" }`, sometimes with a top-level `message` —
rather than the `{ "error": { "code", "message" } }` envelope (the scope, credit,
rate-limit and job-policy refusals use the envelope). A 400 for a malformed id
or body is `{ "message", "issues": [...] }`. The SDK reads both shapes into
`NodaroError.code` / `.message`.

### `POST /v1/characters/:id/train` — start training

Reserves **1,650 credits**<!-- credits: character-lora-training --> and submits a training to Replicate. Requires the
character to have **≥ 4** distinct images across:
`source_image_url`, `reference_photos`, `expressions`, `poses`, `angles`,
`body_angles`, `lighting_variations` (de-duplicated; at most 20 are used).

**Body (optional):** `{ "selectedImageUrls": ["https://…", …] }` — up to 200
URLs of the character's own images; the training uses only those (at least 4
must remain). Omitted or empty: every eligible image.

> `character_sheet` is **excluded** from the training-image count. Its
> composite views (front/side/back) overlap with `angles`/`body_angles` and
> its DB column shape cannot be reduced to a simple URL list, so the
> training helper ignores it entirely.

**Response (202):**
```json
{ "jobId": "uuid", "trainingId": "<replicate-id>", "triggerWord": "TOK_<slug>_<6hex>" }
```

The job (`jobId`) ends `completed`, `failed` or `cancelled` with the training.

**Errors:**
- `400 insufficient_training_images` — fewer than 4 distinct images:
  `{ "error": "insufficient_training_images", "count": 2, "message": "Need at least 4 reference photos to train (have 2). …" }`
- `400` — a malformed id or `selectedImageUrls` (`{ "message", "issues" }`)
- `402 insufficient_credits` — not enough credits for the reservation
  (`required` and `balance` beside the envelope)
- `403 insufficient_scope` — an OAuth app token without `assets:write`
- `409 already_training_or_not_found` — a training is already in flight (atomic
  CAS guard; double-click safe), or the character is not yours or is archived
- `422 job_blocked` — this deployment's job policy refused the training
- `429` — over the rate limit
- `500 claim_failed` — the training slot could not be claimed; nothing started
- `502 training_dispatch_failed` — the training could not be started (Replicate
  rejected it, or the images could not be packaged); the reservation is refunded
  and the orphan zip in R2 is cleaned up. Its `message` is a fixed sentence; the
  cause is kept for the deployment's admins.
- `503 public_url_not_configured` — `PUBLIC_URL` not set in this instance
- `503 price_not_configured` — this instance has no price for a training
- `503 dedup_race_winner_unresolvable` — a duplicate of the request was in
  flight and its outcome could not be read; this one reserved nothing

(`503 webhook_not_configured` is not this route's: it is what Replicate's
completion call gets when `REPLICATE_WEBHOOK_SECRET` is unset — see
[Character Training](./features/character-training.md#deployment-notes-self-hosted-cloud).)

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

`untrained`: never trained, the trained model was removed, or a training could
not be started (`502 training_dispatch_failed` releases the slot by resetting
the status — even for a character trained before). Generation uses the trained
model **only while `status` is `succeeded`**. `trainedAt` and `version` belong
to the last successful training and stay set through a re-train, a failed or
cancelled one, or one that could not be started — the model is not used in any
of those states. `404 not_found` for a character that is not yours or is
archived.

### `DELETE /v1/characters/:id/lora` — tear down

Cancels any in-flight training (refunds reserved credits), deletes the
Replicate model (`nodaroai/char-<characterId>`), and nulls out the LoRA
columns on the character row — the status then reads `untrained`. It cannot be
undone. `403 insufficient_scope` for an OAuth app token without
`assets:write`; `404 not_found` for a character that is not yours or is
archived.

**Response:** `{ "ok": true }`

### Routing decision

When you call `POST /v1/generate-image` with a prompt that `@mentions` a
single trained character (and that character is wired upstream of the node),
the orchestrator transparently swaps:

- `provider` → `replicate`
- `model` → `flux-lora-character`
- `referenceImageUrls` → `[]`
- Prompt → `TOK_<slug>_<6hex>, <your prompt with @-tokens stripped>`

The credit identifier becomes `flux-lora-character` (**22<!-- credits: flux-lora-character --> cr**). Multi-character
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

## 3D scenes

`GET /v1/3d-scene/capabilities` reports Basic support and an optional `advanced`
capability. When Advanced is unavailable, `advanced` is `null`. An explicitly
selected unavailable engine returns `503 SCENE_CAPABILITY_UNAVAILABLE` before
Basic credit checks; it never silently substitutes Basic authoring. Existing
requests without an `engine` field, or with `engine: "basic"`, retain Basic
behavior. Advanced engines own their admission and quote requirements.

Editable clay scenes use `POST /v1/3d-scene/generate` and `POST /v1/3d-scene/edit`, returning job IDs. Render via `POST /v1/render-video/plan` with `planType: "3d-scene"`. See [Generate 3D Scene](nodes/composition/generate-3d-scene.md) and [Edit 3D Scene](nodes/composition/edit-3d-scene.md) for inputs and revision behavior.

The node-slug aliases `POST /v1/generate-3d-scene` and `POST /v1/edit-3d-scene` use the same validation, authorization and credit handling. `POST /v1/render-video` also accepts a `planType` and `plan`, dispatching to the same composition renderer; requests without `planType` retain the template format. These paths support generic SDK node execution.

The generate node advertises `scene3d-embed-v1` in `GET /v1/nodes` when this deployment includes the [interactive 3D preview embed](scene3d-embed.md). Clients can check this capability before offering the embedded editor.

### 3D Render Pro

Two endpoints, ONE paid job.

`POST /v1/pro-3d-render/quote` prices a request without starting it and answers
`{quoteId, expiresAt, maxCredits, breakdown, pricingVersion, capabilitiesVersion,
normalizedInputHash}`. It reserves nothing and spends nothing; `maxCredits` is a
ceiling, not a charge.

`POST /v1/pro-3d-render` takes the same body plus that `quoteId` and an
`Idempotency-Key` header (8–255 characters), and returns `{ jobId }`. Admission
re-checks the quote against the request, so a body edited between the two calls
is refused rather than run at an unquoted price; an expired or stale quote is
refused before anything is reserved.

The body's `source` is a strict discriminated union — exactly one of:

- `{kind:"prompt", prompt, references?}` — author a new scene, then render it.
- `{kind:"scene", revisionId, sourceJobId}` — **render-only** export of that
  exact revision, with no authoring or build charge. Adding `editPrompt`
  revises the scene first; **omit** the field for a plain export, since an empty
  string is a different request.
- `{kind:"local-export", exportId, connectionId}` — a completed export from a
  paired desktop Blender, where that is available.

`sourceJobId` is required for Basic scenes retained only in job history. It is
optional for retained revisions, including manual edits, which the engine
authorizes through current scene permissions.

Other fields: `engine` (`blender-cloud` default, `blender-local` where paired),
`localConnectionId`, `quality`, `style` (`clay`), `maxRepairPasses` (0–2,
default 2), `durationSeconds` / `fps` / `aspectRatio` (including `21:9`),
`acceptedSceneSchemaVersions`, plus the usual `workflowId` / `nodeId` /
`forcePrivate` context. There is no model or reasoning-effort field: the planner
is fixed and server-owned.

**Source timing is not silently overridden.** A `scene` source already has its
own duration, fps and aspect ratio — omit those fields to keep them. Sending
them is an explicit re-time request, and an incompatible one is rejected.

`acceptedSceneSchemaVersions` is checked against what the source PRODUCES: a
prompt or local-export source mints a v2 manifest, so a client that omits `2` is
refused for free. A `scene` source inherits its revision's version, so a
retained v1 scene still renders for a v1-only client.

The completed job's `output_data` carries `videoUrl` (the standard resolved
video field), `scenePlan`, `sceneRevisionId`, `posterAssetId`, an optional
`shotStills` (one still per shot — `{shotIndex, frame, assetId, url}`, ordered
by `shotIndex`, at no extra credit cost), an optional `sourceArtifactId`,
`validation` (`{status, reportAssetId, warnings[]}`), `renderer` and `metadata`
(`{width, height, fps, frames, duration}`).

A run that **authored** additionally reports its own account of the answer, in
optional fields: `validation.warnings[]` entries coded
`SCENE_AUTHORING_ASSUMPTION` (the planner's assumptions, with any normalization
the engine applied), `metadata.summary` (its one-or-two-sentence description of
what it authored — on a repaired run, of the repair), top-level `repairPasses`
(repairs actually run, `0` when the scene was accepted first time) and top-level
`admissionRetries` (pre-build planner retries — a recipe the compiler would not
admit, re-asked with no build and no repair pass spent, counted apart from
`repairPasses` and never folded into it), top-level `mechanicalPasses` (repairs
the engine applied itself from the compiler's own remedy with no planner call,
counted **apart** from `repairPasses` because they spend their own quoted
allowance rather than one of your repairs; each also carries a
`REMEDY_AUTO_APPLIED` warning naming the assertion and the change) and
`restoredAssertions` (mandatory assertions put back after a planner answer
re-shaped one the feedback had not named — `{op, path, value?, assertionId,
reason}`, each also an `ASSERTION_RESTORED` warning). A render-only export
authored nothing: it reports no summary and omits the counts rather than
claiming `0`.

The one case where `mechanicalPasses` **is** a subset of `repairPasses` is a run
quoted before that allowance existed, whose quote carries no `mechanical` line.
The discriminant is the quote, not the result — read the quote you were given
rather than deriving the accounting from the two counts. The same
fields appear on a `generate-3d-scene` job served by an advanced engine; the
deterministic Basic lane carries none of them. Warning codes are open-ended —
read `code` and treat an unrecognized one as informational. See
[3D Render Pro](nodes/composition/pro-3d-render.md#warning-codes).

A **completed** authoring job may have been delivered **without the visual
review's approval**, in which case `metadata.review` carries a verdict and
`verdict` says which of two ways.

`{ verdict: "refused", objections[], observed? }` — the repair budget was spent,
every mandatory check passed, and the review still objected, so the scene was
delivered with the refusal attached rather than withheld. Each objection is
`{ category, what, correction?, frames[] }`, with no `severity` field because
only blocking findings become objections, and `validation.warnings[]` carries
one `SCENE_REVIEW_REFUSED` entry per objection, tagged with a `shotId` where the
cited frames fall inside one shot.

`{ verdict: "unavailable", reason, attempts, objections[], observed? }` — the
review produced no usable verdict. `reason` is `"provider"` when it never reached
its provider and `"unusable"` when the provider answered with nothing usable. A
repair cannot answer either, so instead of spending one the run asks the review
once more — after a bounded pause for an unreachable provider, at once for an
unusable answer, and not at all when the provider broke after it had already
streamed usage — and, if there is still no usable verdict, delivers the
assertion-passing scene unreviewed: **nobody judged it**. `attempts` is how many
times the review was asked. `validation.warnings[]` **leads** with one
`SCENE_REVIEW_UNAVAILABLE` entry, then one `SCENE_REVIEW_REFUSED` per surviving
objection — a review is batched, so objections on this arm are whichever batches
answered usably first and are **not** a verdict on the scene. A retry is never
billed on top of the asking before it: an asking that reported no usage is
unbilled, and the second asking of an unusable answer is not charged again. The
delivery bills as the refused one does.

Three readings that look right and are not: `validation.status` is still
`passed` on both (the mandatory checks *did* pass); `objections` may be
**empty**, which reports a refusal that named nothing actionable; and an empty
`objections` under an `unavailable` verdict is not approval, it is silence. Test
for `metadata.review` itself, then branch on `verdict`. A visual refusal alone
no longer fails the job; `SCENE_QUALITY_FAILED` now means a mandatory check
failed or the compiler refused the recipe, and the retained draft is on the
failed job — where a deployment does not deliver unapproved scenes, an
unreviewed one is retained there too, with `SCENE_REVIEW_UNAVAILABLE` leading
its warnings and no `metadata` block to carry a verdict. See
[When a scene that passed is delivered unapproved](nodes/composition/pro-3d-render.md#when-a-scene-that-passed-is-delivered-unapproved).

**A FAILED node in a workflow run carries what its run retained.** In
`GET /v1/workflow-executions/:id` and on its SSE stream, a node's entry in
`nodeStates` carries `output` when it `completed` — and ALSO when it `failed`
and the run retained a structured result. A refused 3D-scene authoring node
reports `status: "failed"` with its `error`, and `output.plan` holding the draft
revision it published; the job row behind it still carries the full
`output_data` described above. This is additive: a client that does not read the
field sees exactly what it saw before. Two rules for one that does — gate on the
FIELD, not on the status (a `pending` or `running` node never has one, and a
future node type may start retaining), and never read a present `output` as
success. The node failed; it simply failed holding something.

Availability is per deployment. `GET /v1/3d-scene/capabilities` reports a `pro`
block with `available` plus the engines, quality profiles, styles, aspect ratios
and repair-pass ceiling a client may OFFER; `GET /v1/nodes` omits the type where
it is unavailable, and both routes answer `503 SCENE_CAPABILITY_UNAVAILABLE`. A
deployment with no configured credit price answers `503 price_not_configured`
before anything is reserved. See
[3D Render Pro](nodes/composition/pro-3d-render.md).

### Scene versions and binary assets

New-scene requests may select retained GLBs with `inputAssets` on
`POST /v1/3d-scene/generate`, or `source.inputAssets` for a Pro prompt source.
Each selector is `{id, revisionId, assetId, label?}`; the list is limited to
eight unique logical and artifact IDs. Image/video `references` remains a
separate field. The server authorizes the exact revision pin and resolves
immutable byte metadata before quoting or reserving credits. Caller receipts
and URLs are rejected. Imports require an advanced engine with import support;
Basic and unavailable import lanes refuse without starting a generation.

`Scene3DPlan` is a discriminated union: schema version 1 stores primitives and
keyframes; version 2 stores semantic entities, immutable GLB assets, baked camera
samples and contiguous shots. Read `schemaVersion` before accessing version-specific
fields. Basic authoring continues to produce version 1. Clients requesting an
optional engine declare `acceptedSceneSchemaVersions` and check capabilities.

Version 2 manifests contain asset IDs, byte lengths and SHA-256 digests. They do
not contain storage keys or public download URLs. A retained revision provides:

- `GET /v1/3d-scene/revisions/:revisionId` — its scene manifest and asset descriptors.
- `GET /v1/3d-scene/revisions/:revisionId/assets/:assetId` — authorized playback assets.
- `GET /v1/3d-scene/revisions/:revisionId/source` — the editable native source, when retained.

Binary requests use normal bearer authentication. Playback requires permission
to view the revision's workflow; native source requires edit permission. Personal
revisions are owner-only. A deleted or inaccessible revision returns 404, and
responses use `Cache-Control: no-store`. **Internal authoring recipes and repair
checkpoints are not downloadable through the revision routes** — the one
exception is a refused run's recipe, which is reached through its delivery and is
described below. A revision with pending source materialization does not
advertise an outdated native source file.

An export that retains delivery evidence exposes it separately from its source:

- `GET /v1/3d-scene/deliveries/:jobId` returns `sourceKind`, the exact
  `sceneRevisionId`, source digests, mode, and opaque descriptors — the poster,
  the validation report, and one `shot-still` per shot where the render produced
  a contact sheet. One kind has no scene behind it: `refused-authoring`,
  published by a 3D Render Pro run whose recipe the compiler refused on every
  pass. Nothing compiled, so no revision exists and no frame was rendered —
  `sceneRevisionId` and `sourcePlanSha256` are `null`, and there is no poster.
  What that delivery lists is the refusal report and, when the run had a recipe
  to keep, a `source-json` descriptor (usage `checkpoint`): the planner's last
  admitted recipe. See [3D Render Pro](nodes/composition/pro-3d-render.md).
- `GET /v1/3d-scene/deliveries/:jobId/assets/:assetId` returns those bytes with
  bearer authentication, range support, and `Cache-Control: no-store`.

**The retained recipe needs `edit`.** A `source-json` descriptor is listed, and
its bytes served as `application/json`, only to a caller with edit access to the
job's workflow — the same access the native `.blend` source requires, and for the
same reason: a collaborator invited to watch a workflow reads what a run
produced, not the authoring input behind it. A reader with less sees no such
descriptor and gets `404` on the bytes, never a `403` that would confirm one
exists. This is the ONE place a `source-json` is readable: a delivered scene's
own recipe is pinned by its revision, and the revision routes list no checkpoint
kinds. Reading it costs no credits, like every other delivery read. The failed
job's `output_data.validation.sourceRetained` says whether there is one to fetch
before you ask.

Delivery reads require current access to both the delivery workflow and the
source workflow; personal sources remain owner-only. Deleting the source revision
does not remove delivered evidence or waive its source permissions. Delivery
metadata never includes storage keys or native source files, and no delivery
descriptor is a URL.

`POST /v1/3d-scene/revisions/:revisionId/edits` saves deterministic v2 overlays
without a generation job or LLM charge. It requires edit access to the retained
scene and `workflows:write` for OAuth apps. Send `newRevisionId`, the base
`expectedContentHash`, `operations`, and optional `lockedObjectIds`. Reuse the
same new revision ID and body when retrying a transport failure. The response is
`{ scenePlan, changeSummary }`; a stale digest or conflicting revision ID returns
409. The request accepts operations, not uploaded geometry or a replacement
manifest. Saving creates an immutable revision; the caller separately selects
it in its workflow, checking that the active revision has not changed meanwhile.

### Character Motion metadata

Character Motion catalog options include optional `motion` metadata at both compact and full detail. It carries authored `requires`, `startPose`/`endPose`, `endVisibility`, `handsAfter`, `needsFreeHands`, `kind`, `fixedPace`, `counterpart`, search `aliases`, and `deprecated`/`replacementId`. Missing fields mean unknown. Preserve retired IDs when loading saved workflows; hide them from new choices. See [Character Motion](nodes/parameters/character-motion.md) for composition, naming, review and advisory-diagnostic behavior. `client.pickerCatalogs.get("character-motion")` exposes this as `PickerOption.motion`; the structural type is `CharacterMotionMetadata` from `@nodaro/shared`.
