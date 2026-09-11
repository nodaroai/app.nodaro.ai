# Scene3D Preview Embed (`/embed/scene3d`)

Frame Nodaro's real 3D previsualization viewport inside your own application.

`/embed/scene3d` renders the same `Scene3DPlan` viewer the Nodaro editor uses —
three.js viewport, transport, object list, numeric pose editors, revision
history — driven entirely by `postMessage`. Your page keeps the scene; the frame
draws it and reports what the user did.

> **This is not the MiniApp embed.** `/embed/:slug` runs a published workflow and
> talks to the API on the user's behalf. `/embed/scene3d` runs nothing: no slug,
> no session, no network call. See the [Embed App Guide](./embed-app-guide.md)
> if you want to run a workflow in an iframe.

**Contents**

- [What the frame does and does not do](#what-the-frame-does-and-does-not-do)
- [The URL](#the-url)
- [The handshake](#the-handshake)
- [Parent → frame: `state`](#parent--frame-state)
- [Frame → parent: `ready` and `event`](#frame--parent-ready-and-event)
- [Read-only mode](#read-only-mode)
- [Validation and limits](#validation-and-limits)
- [Parent-side checklist](#parent-side-checklist)
- [Worked example](#worked-example)
- [Versioning](#versioning)

---

## What the frame does and does not do

| | |
|---|---|
| **Reads** | Only the `parentOrigin` + `channel` in its URL, and `state` messages from that exact origin. |
| **Renders** | The scene you push: viewport, playback + scrub, object list, per-object and camera pose editors, revision history, pending-revision notice. For a **baked (v2)** scene: the baked-camera viewport, shot navigation, semantic entities with their identity colours, and overlay controls. |
| **Emits** | `ready` once it is listening, then one `event` per user action — plus an `asset-request` per declared asset of a v2 scene. |
| **Never does** | Authenticate, read or write storage, call any `/v1` endpoint, persist anything across a reload, or advance its own view after an edit. |

The frame is **stateless by construction**. When the user commits an edit it
sends you a new immutable revision and keeps showing the old one until *you*
push the result back. That is deliberate: a frame that ran ahead of its parent
could show a revision that never gets saved.

The security model is the message checks below, not a network boundary. The
frame is not privileged, holds no secret, and is safe to load in a page you do
not fully control — but the *scene data you push into it* is only as private as
the origin you address it to, so always send an exact origin (see
[Parent-side checklist](#parent-side-checklist)).

---

## The URL

```
https://app.nodaro.ai/embed/scene3d?parentOrigin=<origin>&channel=<uuid>
```

| Param | Required | Rule |
|---|---|---|
| `parentOrigin` | yes | The **exact, normalized origin** of the page doing the framing. Must satisfy `new URL(value).origin === value`: scheme + host + optional port, nothing else. `http:` and `https:` only. A trailing slash, a path, a query, userinfo, `null`, or any other scheme is refused. Max 255 characters. |
| `channel` | yes | A **freshly generated random UUID** (`crypto.randomUUID()`), one per mounted frame. It is what keeps two Scene3D embeds on the same page — or a stale frame from a dialog you just closed — from repainting each other. |

The exact-origin rule is not cosmetic. `MessageEvent.origin` arrives
browser-normalized, so requiring the parameter in the same spelling is what lets
the frame compare the two with `===` instead of guessing.

If either parameter is missing or malformed the frame renders an error, sends
nothing, and listens to nothing.

---

## The handshake

```
parent                                   frame (/embed/scene3d)
  │                                        │
  │  ── iframe src=… ──────────────────▶   │
  │                                        │  mounts, starts listening
  │  ◀───────── nodaro:scene3d:ready ────  │  (repeats until you answer)
  │                                        │
  │  ── nodaro:scene3d:state ──────────▶   │  validates, renders
  │                                        │
  │  ◀───────── nodaro:scene3d:event ────  │  user acted
  │  (validate expectedRevisionId, apply)  │
  │  ── nodaro:scene3d:state ──────────▶   │  the new truth
```

**Send your first `state` in response to `ready`, not on `iframe.onload`.** The
frame re-announces `ready` on a short bounded schedule until it hears anything
from you, which covers a parent that attached its listener slightly late — but
`load` fires before the React route has mounted its listener, so a push timed off
`load` alone can be dropped.

The frame stops re-announcing after your first *addressed* message, including a
message it refuses: a rejection still proves you are listening.

---

## Parent → frame: `state`

One message type, carrying a full snapshot. There is no partial update — always
send the complete state you want rendered.

```ts
{
  type: "nodaro:scene3d:state",
  version: 1 | 2,                     // 2 unlocks baked (v2) scenes — see below
  channel: string,                    // must equal the URL's channel
  scenePlan: Scene3DPlan,             // required, validated
  selectedObjectIds?: string[],       // default []
  lockedObjectIds?: string[],         // default []
  history?: Scene3DRevisionEntry[],   // default []
  pendingPlan?: Scene3DPlan,          // default absent
  isGenerating?: boolean,             // default false
  readOnly?: boolean,                 // DEFAULT true
}
```

`Scene3DRevisionEntry`:

```ts
{
  revisionId: string,                     // UUID
  scenePlan: Scene3DPlan,                 // validated like the active one
  source: "generate" | "edit" | "manual" | "upstream",
  createdAt: string,                      // your timestamp; shown as-is
  changeSummary?: string,
  context?: { prompt?: string },          // only `prompt` is kept, see below
}
```

`scenePlan` is the public `Scene3DPlan` from `@nodaro/shared`
(`scene3DPlanSchema`) — the same shape a `generate-3d-scene` / `edit-3d-scene`
job returns in `output_data.scenePlan`.

Notes:

- **`context` is narrowed on purpose.** Only `prompt` is retained (it becomes the
  restore button's tooltip); model, temperature, references and the rest of the
  authoring metadata are stripped. Extra keys inside `context` are dropped
  silently — the frame never echoes history back, so nothing is lost. Extra keys
  at any *other* level are refused (see [Versioning](#versioning)).
- **`readOnly` defaults to `true`.** Silence means look-don't-touch. An editable
  frame must say `readOnly: false` explicitly.
- **`isGenerating: true`** only adds a note that a revision is being generated.
  The scene stays live and (when not read-only) editable.
- **`pendingPlan`** is the "a job finished after you edited" case: the frame
  shows the notice, and in an editable frame the two resolution buttons.

### What is ignored vs what is refused

| The frame sees | It does |
|---|---|
| `event.source` is not the framing window | **ignores** — silently |
| `event.origin ≠ parentOrigin` | **ignores** — silently |
| a different `type`, a different `channel`, a non-object payload | **ignores** — silently |
| an unknown `version` | **refuses**, visibly |
| a malformed envelope, an unknown key, an over-limit list | **refuses**, visibly |
| a `scenePlan`, `pendingPlan` or *any* `history[].scenePlan` that fails validation | **refuses**, visibly |

Ignoring is silent because another frame's traffic is not the user's problem.
Refusing is loud because it is *your* message that was wrong.

**A refusal never destroys accepted data.** The last snapshot the frame accepted
stays on screen under a banner naming the reason; the next valid `state` clears
it.

---

## Frame → parent: `ready` and `event`

Both are posted to the exact `parentOrigin` from the URL. The frame never uses
`"*"` as a target origin.

```ts
{
  type: "nodaro:scene3d:ready",
  version: 1,                              // the baseline, always 1
  channel: string,
  protocolVersions: [1, 2],                // every version this frame accepts
  capabilities: {
    assetTransport: true,                  // it can ask you for asset bytes
    sceneSchemaVersions: [1, 2],           // scene versions it can draw
  },
}
```

**Match `ready` on `type` + `channel`, and read `protocolVersions`** — do not
compare the whole message for equality. `version` stays `1` so a parent written
against version 1 keeps working; everything version 2 adds is announced in
fields such a parent simply does not read.

```ts
{
  type: "nodaro:scene3d:event",
  version: 1 | 2,                     // 2 ONLY for `edit-operations`
  channel: string,
  expectedRevisionId: string | null,
  event:
    | { kind: "plan", plan: Scene3DPlan, changeSummary: string }
    | { kind: "selection", objectIds: string[] }
    | { kind: "locks", objectIds: string[] }
    | { kind: "restore", revisionId: string }
    | { kind: "resolve-pending", adopt: boolean }
    // v2 scenes only — see "Baked (v2) scenes" below.
    | { kind: "edit-operations", operations: Scene3DV2EditOperation[], expectedContentHash: string },
}
```

The envelope carries `version: 2` **only** for `edit-operations`. Every
pre-existing event kind still says `1`, so a version-1 parent never meets a
version it does not know on a message it does understand.

**`expectedRevisionId` is the revision the frame was showing when the user
acted** — i.e. the base the action was computed from. Apply the event only if it
still equals your own active `scenePlan.revisionId`; otherwise drop it. That one
check is what makes a click on a snapshot you have already replaced a no-op
instead of a silent rollback. It is `null` only before any state was accepted.

Event meanings:

| `kind` | Meaning | What you do |
|---|---|---|
| `plan` | A deterministic local edit (a numeric pose commit, a colour change) produced a **new immutable revision**. `plan.parentRevisionId` is `expectedRevisionId`. No model ran, nothing was billed. | Adopt `plan` as the active revision, append to history, push a new `state`. |
| `selection` | The user selected / deselected objects. | Mirror it and push `state` (or just remember it). |
| `locks` | The user locked / unlocked objects. Locks are the set an edit job must leave byte-identical. | Persist and push `state`. |
| `restore` | The user asked for an earlier revision from the history you sent. | Make it active and push `state`. |
| `resolve-pending` | `adopt: true` → use `pendingPlan`; `false` → keep the current one. | Resolve and push `state` with `pendingPlan` cleared. |
| `edit-operations` | A **v2** overlay edit, as operations. The frame does not apply it — a v2 revision your server has not stored would draw as if it were saved. | Call `applyScene3DV2EditOperations(plan, operations, { expectedRevisionId, expectedContentHash, lockedObjectIds })`, persist the result, push the persisted plan back. |

---

## Baked (v2) scenes and the asset transport

A **v1** scene is self-contained: primitives, keyframes and a camera, all inside
the plan you push. A **v2** scene is baked geometry — its manifest carries
semantic entities, shots, a baked camera track and a list of **asset ids with
SHA-256 digests**, and the bytes themselves live behind Nodaro's authenticated
API.

The frame has no session and makes no network call. That does not change for
v2 — instead the frame asks *you* for exactly the assets the manifest declares,
and you fetch them with your own session.

### Turning it on

Send `version: 2` on your `state` push. A v2 scene arriving on a `version: 1`
push is **refused** with
`scenePlan — this scene uses schema version 2, which needs embed protocol version 2 (asset transport)`,
because a version-1 parent has no handler for the asset request and the frame
would sit forever on a scene it could never draw. v1 scenes are unaffected on
either version.

### The messages

```ts
// frame → parent
{
  type: "nodaro:scene3d:asset-request",
  version: 2,
  channel: string,
  requestId: string,                 // fresh per request; echo it back verbatim
  revisionId: string,                // plan.revisionId
  assetId: string,                   // an opaque id from plan.assets
  kind: "glb" | "camera-track-json",
  byteLength: number,                // what the manifest declares
  sha256: string,                    // 64 lowercase hex
}

// parent → frame, success
{
  type: "nodaro:scene3d:asset-response",
  version: 2,
  channel: string,
  requestId: string,                 // echoed
  revisionId: string,                // echoed
  assetId: string,                   // echoed
  ok: true,
  bytes: ArrayBuffer,                // structured clone — NOT a URL, NOT base64
}

// parent → frame, failure
{ …same envelope…, ok: false, error: "short reason" }
```

`revisionId` is the current retained plan revision. Each retained revision pins
all its assets, including reused bytes. `originRevisionId` records provenance;
it does not change the authorization scope.

### What the frame checks

Silently ignored (this is normal traffic, not an error):

- a response from any window other than the parent, from any other origin, or on
  another `channel`;
- a `requestId` that is not outstanding — a late answer after a timeout, a
  duplicate, or an unsolicited "here are some bytes".

Fails that one asset, visibly:

- `version` ≠ 2, an unrecognized field, or a missing one;
- `revisionId` / `assetId` that are not the ones requested;
- `ok: false` (your `error` is shown, truncated);
- `bytes` that is not an `ArrayBuffer`;
- a length that is not the manifest's `byteLength`;
- **a SHA-256 that is not the manifest's digest.**

The digest check is the one that matters: it is the difference between "the host
delivered the bytes" and "the bytes are the ones this revision is made of". The
renderer verifies them a second time before parsing, so no path draws unverified
geometry.

The frame also bounds itself: at most **4 requests in flight** (the rest queue),
**64 requests** and **64 MiB** per revision, **20 s** per request, and every
outstanding request is rejected when a new revision arrives or the frame
unmounts — an answer for a scene the user has left is never drawn. Identical
assets (same id + digest) are requested once, so an overlay revision that reuses
a GLB does not re-download it.

### Parent-side rules (MUST)

1. **Authorize against what you pushed.** Answer only if `request.revisionId` is
   the revision you pushed (`plan.revisionId`), **and** `request.assetId` is in that plan's
   `assets` with the same `byteLength` and `sha256`. Otherwise reply
   `ok: false`. Skipping this makes your session an oracle: whoever controls the
   framed page could ask for arbitrary revision/asset ids and read the answer.
2. **Never send a credential.** No token, no cookie, and no signed URL — a URL
   that grants access *is* a bearer token with a different spelling. Send bytes.
3. **Post to the frame's exact origin**, never `"*"`.
4. **Do not transfer a buffer you keep** — a structured clone copies it; a
   transfer list detaches your copy.
5. **Drop requests for a revision you have replaced**, and keep at most one
   in-flight fetch per `(revisionId, assetId)`.

### Reference implementation

```ts
import { createClient } from "@nodaro/sdk"
import type { Scene3DPlanV2 } from "@nodaro/shared"

const client = createClient({ baseUrl: "https://app.nodaro.ai", auth: myAuth })

/** The plan you most recently pushed. */
let active: Scene3DPlanV2

window.addEventListener("message", async (event) => {
  if (event.source !== iframe.contentWindow) return
  if (event.origin !== NODARO_ORIGIN) return
  const data = event.data
  if (data?.type !== "nodaro:scene3d:asset-request") return
  if (data.channel !== channel || data.version !== 2) return

  const reply = (body: Record<string, unknown>) =>
    iframe.contentWindow?.postMessage(
      {
        type: "nodaro:scene3d:asset-response",
        version: 2,
        channel,
        requestId: data.requestId,
        revisionId: data.revisionId,
        assetId: data.assetId,
        ...body,
      },
      NODARO_ORIGIN,
    )

  // 1. Authorize: the asset must belong to the plan we pushed, and the request
  //    must name the revision that plan says the bytes are pinned to.
  const asset = active.assets.find((a) => a.assetId === data.assetId)
  const pinnedTo = active.revisionId
  if (
    !asset ||
    data.revisionId !== pinnedTo ||
    asset.byteLength !== data.byteLength ||
    asset.sha256 !== data.sha256
  ) {
    reply({ ok: false, error: "unknown asset" })
    return
  }

  // 2. Fetch with OUR session, and send the bytes — never the URL or the token.
  try {
    const bytes = await client.scene3d.assetBytes(pinnedTo, asset)
    reply({ ok: true, bytes })
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : "fetch failed" })
  }
})
```

### Editing a v2 scene

v2 edits are **overlays**, and the frame never applies one. A v2 revision your
server has not stored would render as if it were saved while its assets still
belong to the revision it came from — so the frame sends the operation and keeps
showing the revision you pushed:

```ts
// event.event
{
  kind: "edit-operations",
  operations: [
    { op: "set-override", override: { kind: "entity-transform", entityId: "hero", space: "local", position: [3, 0.5, 0] } },
  ],
  expectedContentHash: "<64 hex>",   // plan.provenance.contentHash
}
```

Feed all three stale-check values straight into the shared applier — the same
one the API uses — then publish and push the result back:

```ts
import { applyScene3DV2EditOperations } from "@nodaro/shared"

const result = await applyScene3DV2EditOperations(active, message.event.operations, {
  expectedRevisionId: message.expectedRevisionId,          // the envelope's field
  expectedContentHash: message.event.expectedContentHash,
  lockedObjectIds,
})
if (!result.ok) return showError(result.message)           // stale_revision, locked, …
```

An override names only the channels it changes, and the frame builds it that way
on purpose: for an `asset` entity the GLB node transform is authoritative, so an
edit that moved something must not also restate a rotation it never touched.

---

## Read-only mode

`readOnly` (default `true`) keeps the full **viewer** and withholds every write:

| Still works | Withheld |
|---|---|
| Play / pause / scrub | Numeric pose commits (object + camera) |
| Click-to-select in the viewport and the list | Object and background colour |
| Reading the object list, lock badges, revision history | Lock toggles |
| The pending-revision notice | Restore, and the pending-revision buttons |

The only event a read-only frame emits is `selection`.

Enforcement is in both directions: the controls that would produce a mutation
are disabled or not rendered, *and* the frame refuses to emit a mutation event
even if a control is driven directly. Read-only is a property of the frame, not
a styling choice.

---

## Validation and limits

`scenePlan`, `pendingPlan` and every `history[].scenePlan` are parsed with the
public `scene3DPlanSchema` from `@nodaro/shared` — structure *and* the
cross-field rules (parent cycles, dangling parents, keyframes past the last
frame, duration ceiling). A plan that fails is refused whole.

| Bound | Value | Source |
|---|---|---|
| `history` entries | 12 | embed protocol |
| `selectedObjectIds` / `lockedObjectIds` entries | 100 | embed protocol |
| Length of each object id | 64 | `SCENE3D_LIMITS.maxIdLength` |
| `changeSummary` and `context.prompt` length | 2000 | `SCENE3D_LIMITS.maxChangeSummaryLength` |
| `createdAt` length | 64 | embed protocol |
| `parentOrigin` length | 255 | embed protocol |
| Frame width and height | 100–2560 px, each axis | `SCENE3D_LIMITS.minDimensionPx` / `.maxDimensionPx` (above 1920 px on the longest side a render is priced at a [larger tier](nodes/composition/render-video.md#what-a-3d-scene-render-costs)) |
| Objects per scene | 100 | `SCENE3D_LIMITS.maxObjects` |
| Keyframes per object / camera track | 240 | `SCENE3D_LIMITS.maxKeyframes` |
| Entities in a v2 scene | 100 | `SCENE3D_V2_LIMITS.maxEntities` |
| Assets / shots / overrides in a v2 scene | 64 / 32 / 200 | `SCENE3D_V2_LIMITS` |
| Declared asset bytes a v2 scene may claim | 64 MiB | `SCENE3D_V2_LIMITS.maxRendererAssetBytes` |

A v2 manifest is a promise about bytes, so the declared totals are checked
before a single asset is requested — the frame never allocates from a number it
has not itself bounded.

The list-length checks run before anything is parsed, so an oversized payload is
refused without being walked.

---

## Parent-side checklist

Do all of these on the parent. The frame guards its own inbox; only you can
guard yours.

1. **Mint a fresh `channel`** per frame with `crypto.randomUUID()`, and keep it.
2. **Build the URL with your own exact origin** — `window.location.origin`, not
   a string you assembled.
3. On every inbound message, check **all four**:
   - `event.source === iframe.contentWindow`
   - `event.origin === <the Nodaro origin you framed>` (exact string)
   - `data.channel === <your channel>`
   - `data.version` is a version you implement (`1`, or `2` if you serve assets)
4. **Check `expectedRevisionId` against your active revision** before applying a
   `plan`, `restore` or `resolve-pending` event. Drop it if it does not match.
5. **Re-validate `plan` with `scene3DPlanSchema`** before you store it. The frame
   validates what it renders; you are responsible for what you persist.
6. **Send `state` on `ready`,** and again after every change you accept.
7. **Never post `"*"`.** Address the Nodaro origin explicitly.
8. **Do not put anything secret in a message.** The protocol carries scene
   geometry and revision ids. No tokens, no user identifiers, no URLs you would
   not put in a scene reference.
9. **Remove the listener when the dialog closes** — a stale listener plus a
   reused channel is how two dialogs start answering each other.
10. **If you serve v2 scenes, authorize every asset request** against the plan
    you pushed (see the next section). Answering one you cannot tie back to a
    plan you sent turns your session into a read oracle for whoever loaded the
    frame.

---

## Worked example

```ts
import { scene3DPlanSchema, type Scene3DPlan } from "@nodaro/shared"

const NODARO_ORIGIN = "https://app.nodaro.ai"
const channel = crypto.randomUUID()

const iframe = document.createElement("iframe")
iframe.src =
  `${NODARO_ORIGIN}/embed/scene3d` +
  `?parentOrigin=${encodeURIComponent(window.location.origin)}` +
  `&channel=${channel}`
iframe.allow = "" // the frame needs no permissions

let active: Scene3DPlan = /* your current revision */ initialPlan
let history: RevisionEntry[] = [/* newest last, at most 12 */]

function pushState() {
  iframe.contentWindow?.postMessage(
    {
      type: "nodaro:scene3d:state",
      version: 1,
      channel,
      scenePlan: active,
      selectedObjectIds: selection,
      lockedObjectIds: locks,
      history: history.slice(-12),
      readOnly: false,          // omit this and the frame is view-only
    },
    NODARO_ORIGIN,              // never "*"
  )
}

function onMessage(e: MessageEvent) {
  if (e.source !== iframe.contentWindow) return
  if (e.origin !== NODARO_ORIGIN) return
  const data = e.data
  if (!data || typeof data !== "object") return
  if (data.channel !== channel || data.version !== 1) return

  if (data.type === "nodaro:scene3d:ready") {
    pushState()                 // the frame is listening — (re)send the truth
    return
  }
  if (data.type !== "nodaro:scene3d:event") return

  // The action was computed from a revision we may already have replaced.
  const mutates = data.event.kind !== "selection"
  if (mutates && data.expectedRevisionId !== active.revisionId) return

  switch (data.event.kind) {
    case "selection":
      selection = data.event.objectIds
      return                    // no re-push needed; the frame already shows it
    case "locks":
      locks = data.event.objectIds
      break
    case "plan": {
      // Trust nothing you persist.
      const parsed = scene3DPlanSchema.safeParse(data.event.plan)
      if (!parsed.success) return
      active = parsed.data
      history = [...history, {
        revisionId: active.revisionId,
        scenePlan: active,
        source: "manual",
        changeSummary: data.event.changeSummary,
        createdAt: new Date().toISOString(),
      }].slice(-12)
      break
    }
    case "restore": {
      const entry = history.find((h) => h.revisionId === data.event.revisionId)
      if (!entry) return
      active = entry.scenePlan
      break
    }
    case "resolve-pending":
      active = data.event.adopt ? pending! : active
      pending = undefined
      break
  }
  pushState()
}

window.addEventListener("message", onMessage)
document.body.appendChild(iframe)

// On teardown:
//   window.removeEventListener("message", onMessage)
//   iframe.remove()
```

Generating and editing scenes with a model, and rendering one to MP4, are
ordinary API jobs — see the `generate-3d-scene`, `edit-3d-scene` and
`render-video` nodes in the [Node Reference](./nodes/README.md) and
[API Integration](./api-integration.md). The embed is the *viewer*; it never
starts a job and never spends anything.

---

## Versioning

`version: 1` is the frozen v1 contract. The `state` envelope is **strict**: an
unrecognized top-level key (or an unrecognized key inside a `history` entry) is
refused rather than ignored, so a parent and a frame can never half-agree about
what a message means. Growth happens by bumping `version`, and a frame that does
not implement a version refuses the payload out loud instead of guessing.

**`version: 2` is a superset, not a replacement.** It adds baked (v2) scenes,
the asset transport and the `edit-operations` event, and changes nothing about
version 1: a parent that only speaks version 1 keeps working byte-for-byte, and
a frame tells you what it can do in `ready.protocolVersions` /
`ready.capabilities` rather than making you probe. Read those two fields instead
of assuming — that is what makes the next version additive too.

If you need a field that does not exist yet, open an issue rather than smuggling
it through — a refused message is the contract working.

When submitting an edit from a reference picker, pass `replaceReferences: true` with the complete `references` list (an empty list clears it). Without that flag, edits retain the existing references and merge supplied entries by ID. This applies to both instruction and deterministic edits; each creates a new revision.
