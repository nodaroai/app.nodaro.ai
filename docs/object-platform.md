# Object Platform

Nodaro's **object platform** lets you script every Object Studio
operation through REST, the typed SDK, the CLI, and MCP. An object is a
canonical product / prop row — name, main image, identity copy, plus five
asset buckets (`angles`, `materials`, `variations`, `motionClips`,
`referencePhotos`) — that downstream generation nodes reference to keep
the same prop, vehicle, or piece of furniture looking like the same item
across every shot in a production.

This guide explains the data model, the four surfaces, and the canonical
"create → main image → approve → layer variants → animate motion" flow.

## When to use which surface

| Surface | Reach for it when… | Lives at |
|---|---|---|
| REST | curl-able, language-agnostic, simplest | `/v1/objects*`, `/v1/generate-object*` |
| SDK (`@nodaro/client`) | Building a typed integration in Node / browser / Bun / Deno | `client.objects.*` |
| CLI (`nodaro` / `@nodaro/cli`) | Terminal scripts, cron, CI, ad-hoc one-shots | `nodaro objects …` |
| MCP | An LLM agent (Claude.ai, Cursor, etc.) is driving the work | `generate_object`, `approve_object_main_image`, etc. |

All four surfaces share the same database row and the same Worker pipeline;
they're four ways to call the same routes.

## The object row

The `objects` table stores one row per object. Highlights:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Stable identifier. |
| `user_id` | uuid | Owner. Every query is scoped by this. |
| `node_id` | text | Canvas node id the row was first bound to. MCP-created rows use the `"mcp-managed"` sentinel. |
| `project_id` | uuid (nullable) | Project the row belongs to. Nullable for MCP-created rows. |
| `workflow_id` | uuid (nullable) | Workflow the row was first bound to. |
| `name` | text | Display name. |
| `description` | text | Freeform identity notes. |
| `category` | text | One of `furniture`, `vehicle`, `weapon`, `food`, `clothing`, `electronics`, `nature`, `tool`, `animal`, `other`. |
| `style` | text | Visual style — one of `realistic`, `anime`, `3d-pixar`, `illustration`. |
| `source_image_url` | text | The **anchor main image** — set by `approve-main-image`. |
| `canonical_description` | text | LLM-authored ~80–120-word visual description set when the main image is approved. Coerced from DB null to `""` on the wire. |
| `style_lock` | boolean | When `true`, every variant gen passes the main image as i2i source for layout consistency. Defaults to `true` on new rows. |
| `angles` / `materials` / `variations` | jsonb[] | Three image asset buckets — each entry is `{ name, url }`. |
| `motion_clips` | jsonb[] | The fourth bucket: looping video clips animated from the main image (i2v). Each entry is `{ name, url }` where `url` is a video. |
| `reference_photos` | jsonb[] | Mood-board photos (cap 20), each `{ kind, url }` with `kind ∈ {front, side, detail, context, moodBoard, other}`. |
| `deleted_at` | timestamptz | Non-null = soft-deleted (archived). |
| `created_at` / `updated_at` | timestamptz | Timestamps. |

Soft delete is the only delete the public programmatic surface exposes. The
studio archive view + REST `/restore` route bring a row back; permanent
destruction is reachable only via `DELETE /v1/objects/:id?permanent=true`
which is UI-only by design — the SDK, CLI, and MCP surfaces all soft-delete.

> The schema does **not** carry per-bucket status columns. In-flight asset
> generations are surfaced via `pendingJobs` on `GET /v1/objects/:id`,
> derived at request time from rows in the `jobs` table where
> `input_data.attachToObjectId = :id` and `status ∈ {pending, running}`.

## Asset arrays explained

Five bucket columns hold the variants of an object's anchor main image.
Each entry is `{ name, url }`:

| Bucket | What it represents | Example variant names |
|---|---|---|
| `angles` | Orientation / viewpoint variants of the same object | `front`, `side`, `top`, `back`, `three-quarter`, `detail`, `in-context`, `exploded`, `perspective` |
| `materials` | Material / texture variants | `wood`, `metal`, `glass`, `plastic`, `fabric`, `stone`, `ceramic`, `leather`, `paper`, `gold`, `silver`, `copper`, `marble` |
| `variations` | Condition / style variants | `clean`, `weathered`, `damaged`, `ornate`, `minimal`, `broken`, `antique`, `futuristic`, `holographic`, `dirty`, `polished` |
| `motionClips` | Looping video clips animating the main image (i2v) | `rotate-360`, `hover`, `spin-slow`, `parallax`, `pulse`, `drift`, `dolly-around`, `push-in`, `drone-orbit` |
| `referencePhotos` | Caller-supplied mood-board photos | `{ kind: "front", url }`, `{ kind: "side", url }`, … |

Each image variant is generated independently via
`POST /v1/generate-object-asset` (or `POST /v1/generate-object-motion`
for `motionClips`). The result is appended to the named bucket on
completion when `attachToObjectId` + `attachToColumn` + `attachName` are
supplied.

The worker uses the `append_object_asset(p_object_id, p_column, p_value)`
Postgres RPC for the append — it's atomic per-column with a URL dedup
guard and a `deleted_at IS NULL` predicate, so two concurrent jobs can't
clobber each other and a job finishing after a soft-delete won't resurrect
the row. Valid columns: `angles`, `materials`, `variations`,
`motion_clips` (the canonical set exposed via `OBJECT_ATTACH_COLUMNS` in
`@nodaro/shared`).

### Motion clips

`POST /v1/generate-object-motion` animates the object's main image into a
showcase camera-move clip — slow rotations, hovers, parallax pulls,
drone-style orbits — for use as `start_frame` references in downstream i2v
nodes or as B-roll loops in product cuts.

- **`sourceImageUrl` is REQUIRED.** The route has no fallback — typically
  the object's approved main image URL.
- **Providers** — eight image-to-video providers tuned for object motion
  and product-showcase camera moves: `kling-turbo`, `kling`, `kling-3.0`,
  `minimax`, `hailuo-2.3`, `wan-i2v`, `seedance`, `bytedance-lite`. Source
  of truth: `OBJECT_MOTION_PROVIDERS` in
  `@nodaro/shared/model-constants.ts`. Default provider is `kling-turbo`
  (the fastest variant; objects favour shorter turnarounds than location
  atmospheres).
- **Attach column** — hardcoded server-side to `motion_clips` (objects
  have a single motion bucket). Callers supply `attachToObjectId` +
  `attachName` only — NOT `attachToColumn`.
- **Aspect ratio** — defaults to `1:1` server-side via
  `resolveObjectAspectRatio({ assetType: "motion" })` — product-showcase
  framing favours square. Override via the `aspectRatio` field. Objects
  have their own 5-value enum (`1:1` / `3:4` / `16:9` / `9:16` / `4:3`)
  with `4:3` added vs. the character set to support classic product-
  catalogue aspect ratios.
- **Credits** — depends on the i2v provider; matches the equivalent
  image-to-video generation on that provider. See
  `docs/nodes/ai-video/generate-video.md` for the per-provider table.

#### Refinement (video-to-video)

Pass `refineFromVideoUrl` (REST) / `refine_from_video_url` (MCP) to route
the worker through video-to-video using THAT clip as the source instead of
running image-to-video from the source frame. Use to iterate on an existing
motion clip with a new prompt without shifting composition:

```bash
# REST — refine an existing rotation clip into a slow hover
curl -X POST $API/v1/generate-object-motion \
  -H "Authorization: Bearer $NODARO_API_KEY" \
  -d '{
    "motionPrompt": "same shot but slow hover instead of rotation",
    "sourceImageUrl": "https://r2/obj.png",
    "refineFromVideoUrl": "https://r2/obj-rotation.mp4",
    "provider": "wan-i2v",
    "name": "Antique Lantern"
  }'
```

Routes through providers with the `video-to-video` capability (currently
Wan 2.6 via KIE). Same auto-attach behavior — the refined clip lands in
`motion_clips[]` when `attachToObjectId` is set.

## Reference photos (mood-board)

The mood-board is a small array of caller-supplied reference images that
travel with the object and become **additional reference inputs** for any
downstream node that references the object via FieldMappings — even
without a wired edge. Each entry is `{ kind, url }`:

| `kind` | What it's for |
|---|---|
| `front` | A clean front-facing reference shot. |
| `side` | Side-profile reference (useful for vehicles, furniture, weapons). |
| `detail` | Close-up of a defining feature (engraving, hinge, hardware, texture detail). |
| `context` | The object in situ — held, mounted, in a scene — for scale / placement reference. |
| `moodBoard` | Vibe / palette / aesthetic reference. |
| `other` | Free-form bucket. |

Caps:

- max 20 entries per object
- `kind` is one of the 6 values above (Zod-enforced)
- the user can attach any number per kind — unlike characters, objects
  don't have a one-per-kind constraint

Pass the array via `referencePhotos` on the create / update body. The
canonical-fallback injector picks the entries up automatically whenever a
downstream consumer references the object, and per-consumer suppression
is available via the canvas's Injected References × button.

#### Kind-tagged conditioning

Each reference photo's `kind` propagates into the prompt builder's subject
line — `Image 1 (Antique Lantern — front reference) — <canonical
description>` — so the model understands the role of each ref at generate
time (front-facing reference vs. detail close-up vs. mood-board
inspiration). The kind labels are stable; you don't need to change anything
in your call sites.

> Object reference photos do **not** require a PII consent step — unlike
> the location platform's `pii_consent_at` column (Phase 2 #7), objects
> are inanimate by definition and the mood-board attaches without a
> dedicated consent gate.

## The main-image approval flow

Generating a main image is a three-step pipeline:

1. **Generate** — `POST /v1/generate-object` produces 1, 2, or 4 candidate
   jobs. With `attachToObjectId` set AND `count === 1`, the worker writes
   the result to `source_image_url` for the single job (auto-approve for
   single-candidate runs). The `generate()` response is a discriminated
   union: `{ jobId }` for `count: 1` (the default) and `{ jobIds: string[] }`
   for `count: 2 | 4` — SDK consumers should branch on `"jobIds" in result`.
2. **Approve** — for multi-candidate runs,
   `POST /v1/objects/:id/approve-main-image` with the chosen
   `candidateJobId` sets `source_image_url` AND fires an LLM caption
   (Claude Sonnet vision) inline to populate `canonical_description`.
3. **Caption** — if the caption sub-failed during approval,
   `canonicalDescription` comes back as `""` (not null). Retry via
   `POST /v1/objects/:id/llm-caption` (502s on LLM failure;
   400 `main_image_required` when no main image is set). Both routes are
   idempotent and safe to re-run.

`canonical_description` is what downstream prompts inject when they
reference this object ("A weathered brass lantern with hand-engraved
filigree on a tarnished cylindrical body, glass panels intact but cloudy,
hung from a wrought-iron hook…"). Without it, visual drift between scenes
is much more likely.

### Studio-gated LLM draft on generate-object-asset

When `POST /v1/generate-object-asset` is called with `attachToObjectId`
set and `description` omitted, the route first invokes an LLM to draft
a per-variant prompt fragment off the parent object's
`canonical_description` + the new variant name (e.g. "weathered" for a
materials swap). Without `attachToObjectId`, the route trusts the caller-
supplied prompt as-is. Studio-driven generations get the LLM draft
automatically; scripted / curl callers can either provide their own
`description` to skip the draft step or omit it to receive the LLM
fallback.

## Using object assets as references

After the assets are populated, downstream generation calls reference the
URLs directly. Two patterns:

**Pattern A — explicit reference URLs.** Most generation nodes accept
`reference_images` (or `referenceImages` in the SDK). Pass any combination
of asset URLs to anchor the new image to the object:

```ts
const object = await client.objects.get(objectId)
const weatheredUrl = object.variations?.find(v => v.name === "weathered")?.url

await client.nodes.run("generate-image", {
  prompt: "the lantern on a dusty workbench, golden hour",
  reference_images: [weatheredUrl].filter(Boolean),
})
```

**Pattern B — `{objectName}` field-mapping in editor prompts.** Inside
the canvas, prompt fields support `{Antique Lantern}` interpolation that
resolves at execution time to the object's canonical description + the
main image attached as a reference (canonical fallback). Style Lock
controls whether the canonical description is injected verbatim or as
soft guidance.

For programmatic flows, prefer Pattern A — explicit URLs are easier to
reason about and don't depend on the canvas wiring.

**Pattern C — `@object:N:bucket/variant` mention syntax (canvas).** In
generate-image / image-to-image / modify-image prompts, type
`@lantern:1:materials/gold` to pin a specific variant inline. The slug is
the object's slugified name (`Antique Lantern` → `antiquelantern`); the
`bucket/variant` segment maps to one of the 4 asset buckets (`angles`,
`materials`, `variations`, `motionClips`) and the variant's slugified
name. Three optional shapes:

| Shape | Effect |
|-------|--------|
| `@lantern:1` | Canonical reference image, `identical` mode |
| `@lantern:1:layout` | Canonical with `style` / `layout` / `none` mode override |
| `@lantern:1:materials/gold` | Pin the gold variant (bucket/variant pair) |
| `@lantern:1:materials/gold:style` | Variant + mode override |

The 4 usage modes (`identical`, `style`, `layout`, `none`) control how the
model uses the reference — match exactly, style/mood transfer, compositional
layout transfer, or attach the image without textual bias. The studio's
autocomplete pill (amber) shows the mode via a dropdown.

**Pattern D — Smart variant selection (automatic).** When a wired object
feeds a generator and you DON'T type a `@object:N:variant` mention, the
prompt-builder scans your prompt for keywords matching the object's
variant names. `"weathered"` → `variations/weathered`; `"gold finish"` →
`materials/gold`; `"side view"` → `angles/side`. A small synonym table
handles common alternatives ("aged" matches "weathered", "brass" matches
"gold"). Bucket priority on ties: materials > variations > angles >
motionClips. Explicit `@-mention` always wins over smart match.

## Style Lock semantics

Style Lock is the object platform's most important consistency switch.
It's a single boolean (`styleLock`) defaulting to `true` on new rows that
travels with the object row and is read at every gen-time decision:

- **Style Lock ON** (default): every variant generation (angles /
  materials / variations) passes the object's `sourceImageUrl` as the
  i2i source. The worker uses it to anchor the variant to the approved
  look — same proportions, same baseline silhouette, same defining
  features. Downstream consumers also receive the canonical description
  as injected context. Use this for everything that should feel like the
  same item across shots.

- **Style Lock OFF**: variant gens omit `sourceImageUrl`, falling back to
  text-only generation. Downstream consumers still get the canonical
  description as soft guidance but the model is free to reinterpret
  silhouette, proportions, and defining features. Use this for
  intentional design exploration, alternate aesthetic takes, or A/B
  comparisons.

Toggle Style Lock via:

- **Studio header** — the prominent toggle in the Object Studio modal.
- **Canvas config panel** — same toggle, surfaced in the right-side
  config panel when the object node is selected.
- **API** — `client.objects.update(id, { styleLock: false })`.

## Studio tabs

Object Studio organizes the editor into 5 tabs:

| Tab | What it surfaces |
|---|---|
| **Appearance** | Identity fields (name / description / category / style), the anchor main image, Style Lock toggle, and a Reference Photos sub-section (the 6-kind mood-board lives here, not as a top-level tab). |
| **Angles** | The `angles` asset bucket with the 9-preset picker (front, side, top, back, three-quarter, detail, in-context, exploded, perspective) plus a custom-label input. |
| **Materials** | The `materials` asset bucket. Pairs the 13-preset picker (wood / metal / glass / plastic / fabric / stone / ceramic / leather / paper / gold / silver / copper / marble) with a **Material catalog browser** that surfaces the 66-entry Material catalog from `@nodaro/shared` for richer descriptive selections (e.g. "polished brushed brass" instead of bare "gold"). |
| **Variations** | The `variations` asset bucket with the 11-preset picker (clean / weathered / damaged / ornate / minimal / broken / antique / futuristic / holographic / dirty / polished). |
| **Motion** | The `motionClips` asset bucket (i2v clips) with the 9-preset motion picker (rotate-360 / hover / spin-slow / parallax / pulse / drift / dolly-around / push-in / drone-orbit), provider selector, aspect-ratio override, and refinement-from-existing-clip input. |

Reference Photos is intentionally a **sub-section of Appearance** rather
than a top-level tab — it's read alongside the main image / identity copy
to inform the appearance gestalt and the Studio surfaces them inline with
the other identity fields.

## Upstream picker integration

The canvas object node exposes a `type` input handle that accepts upstream
parameter-picker nodes — **Animal**, **Vehicle**, **Furniture**,
**Weapon**, and **Material**. When wired, the picker's selected entry
contributes a prompt fragment that flows through `resolveSeedPromptHint`
and lands on the `generate-object-asset` request as
`seedPromptHint: "antique brass lantern"` (example for the Material
picker selecting "antique brass"). The worker composes the hint into the
final generation prompt — useful for driving an object node from a
catalog choice without retyping the description.

For programmatic callers, `seedPromptHint` is a top-level field on
`POST /v1/generate-object`, `POST /v1/generate-object-asset`, and
`POST /v1/generate-object-motion` — supply the fragment directly when
you want catalog-style prompt composition without wiring a canvas picker.

## Quickstart by surface

### REST

```bash
TOKEN="ndr_..."
BASE="https://nodaro.example.com"

# Create
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

# Generate one main image (auto-attaches)
curl -s -X POST "$BASE/v1/generate-object" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Antique Lantern\",\"count\":1,\"attachToObjectId\":\"$OBJ\"}"

# (after job completes) Re-fetch the row
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/objects/$OBJ" | jq .sourceImageUrl

# Generate a materials variant
curl -s -X POST "$BASE/v1/generate-object-asset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetType\": \"materials\",
    \"variant\": \"gold\",
    \"name\": \"Antique Lantern\",
    \"attachToObjectId\": \"$OBJ\",
    \"attachToColumn\": \"materials\",
    \"attachName\": \"gold\"
  }"

# Animate the main image into a motion clip
MAIN=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/objects/$OBJ" | jq -r .sourceImageUrl)
curl -s -X POST "$BASE/v1/generate-object-motion" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Antique Lantern\",
    \"motionPrompt\": \"slow 360 rotation, soft golden rim light\",
    \"sourceImageUrl\": \"$MAIN\",
    \"provider\": \"kling-turbo\",
    \"attachToObjectId\": \"$OBJ\",
    \"attachName\": \"rotate-360\"
  }"
```

#### Endpoint reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/objects` | JWT / `ndr_` | List active. Pass `?archived=true` to list archived. |
| `GET` | `/v1/objects/:id` | JWT / `ndr_` | Detail row + `pendingJobs[]`. Soft-deleted rows return uniform 404 `not_found`. |
| `POST` | `/v1/objects` | JWT / `ndr_` | Upsert. With `id` → UPDATE (worker-owned columns dropped); without → INSERT. Optimistic-concurrency via `expectedUpdatedAt`. |
| `DELETE` | `/v1/objects/:id` | JWT / `ndr_` | Soft-delete (sets `deleted_at`). |
| `DELETE` | `/v1/objects/:id?permanent=true` | JWT / `ndr_` | Permanent destroy. **Row must already be archived** (400 `not_archived` otherwise). UI-only by design — SDK, CLI, MCP all omit this path. |
| `POST` | `/v1/objects/:id/restore` | JWT / `ndr_` | Un-archive. Auto-suffixes `"(restored)"` on name collision. |
| `POST` | `/v1/objects/:id/approve-main-image` | JWT / `ndr_` | Approve a candidate; sets `source_image_url`, fires LLM caption inline. |
| `POST` | `/v1/objects/:id/llm-caption` | JWT / `ndr_` | Re-run LLM caption against the current main image. Idempotent retry — NO `expectedUpdatedAt` arg. |
| `POST` | `/v1/generate-object` | JWT / `ndr_` | Generate 1, 2, or 4 candidate main images. |
| `POST` | `/v1/generate-object-asset` | JWT / `ndr_` | Generate one variant for any of the 3 image buckets (or `custom`). Studio-gated LLM draft when `attachToObjectId` set + `description` omitted. |
| `POST` | `/v1/generate-object-motion` | JWT / `ndr_` | Animate the main image into a motion clip via i2v. |

All `/generate-*` routes return a `jobId` (count=1) or `jobIds[]` (count=2/4)
and reserve credits up-front before any worker job is enqueued.

### SDK

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

// Create an object, generate one main image, auto-attach on completion.
const { id: objectId } = await client.objects.create({
  nodeId: "scripted",
  name: "Antique Lantern",
  description: "Weathered brass lantern with hand-engraved filigree",
  category: "tool",
  style: "realistic",
})

const generated = await client.objects.generate({
  name: "Antique Lantern",
  count: 1,
  attachToObjectId: objectId,
})
// `count === 1` returns `{ jobId }`; `count === 2 | 4` returns `{ jobIds }`.
// Discriminate via `"jobIds" in generated`.

// Poll the job; with count=1 the worker auto-attaches the result on completion.

// For multi-candidate runs, explicitly approve the chosen candidate:
const approved = await client.objects.approveMainImage(
  objectId,
  "<candidateJobId>",
)
// approved.sourceImageUrl + approved.canonicalDescription

// Generate a materials variant — auto-attaches on completion.
await client.objects.generateAsset({
  assetType: "materials",
  variant: "gold",
  name: "Antique Lantern",
  attachToObjectId: objectId,
  attachToColumn: "materials",
  attachName: "gold",
})

// Animate the main image into a motion clip.
await client.objects.generateMotion({
  motionPrompt: "slow 360 rotation, soft golden rim light",
  sourceImageUrl: approved.sourceImageUrl,
  provider: "kling-turbo",
  name: "Antique Lantern",
  attachToObjectId: objectId,
  attachName: "rotate-360",
  // aspectRatio defaults to "1:1" server-side; override here if needed.
})

// Flip Style Lock off for a one-off design exploration.
await client.objects.update(objectId, { styleLock: false })

// Soft-delete (archive) — recoverable.
await client.objects.delete(objectId)

// List the archive.
const { objects } = await client.objects.list({ archived: true })
// or: client.objects.listArchived()

// Restore from the archive.
await client.objects.restore(objectId)
```

Full surface: `list` / `listArchived` / `get` / `create` / `update` /
`delete` (soft) / `permanentDelete` / `restore` / `generate` /
`generateAsset` / `generateMotion` / `approveMainImage` / `recaption`
(13 methods). `permanentDelete()` is included on the SDK for parity with
the archive-first studio flow (it 400s on non-archived rows server-side),
but MCP intentionally omits it — see the Soft delete + archive section.

### CLI

```bash
# Create an object
nodaro objects create "Antique Lantern" \
  --node-id scripted \
  --description "Weathered brass lantern with hand-engraved filigree" \
  --category tool --style realistic

# Generate one main image and auto-attach
nodaro objects generate \
  --name "Antique Lantern" \
  --count 1 \
  --attach-to-object-id <object-id> \
  --watch

# Generate a single materials variant
nodaro objects generate-asset <object-id> \
  --asset-type materials \
  --variant gold \
  --attach-to-column materials \
  --watch

# Animate the main image into a motion clip
nodaro objects generate-motion \
  --name "Antique Lantern" \
  --motion-prompt "slow 360 rotation, soft golden rim light" \
  --source-image-url "https://r2.example/objects/lantern-main.png" \
  --provider kling-turbo \
  --attach-to-object-id <object-id> \
  --attach-name "rotate-360" \
  --aspect-ratio 1:1 \
  --watch

# Approve a candidate as the main image (multi-candidate flow)
nodaro objects approve-main-image <object-id> \
  --candidate-job-id <job-id>

# Re-run the LLM caption against the current main image
nodaro objects recaption <object-id>

# Update Style Lock
nodaro objects update <object-id> --style-lock false

# Archive / list archived / restore
nodaro objects delete <object-id>
nodaro objects list --archived
nodaro objects restore <object-id>

# Permanent delete (archived rows only)
nodaro objects delete <object-id> --permanent
```

11 subcommands total: `list` / `get` / `create` / `update` /
`delete` (with `--permanent`) / `restore` / `generate` (with `--count`,
`--watch`) / `generate-asset` (with `--asset-type`, `--variant`,
`--attach-to-column`, `--watch`) / `generate-motion` (with `--provider`,
`--aspect-ratio`, `--watch`) / `approve-main-image` / `recaption`.

Pass `--json` to any command for machine-readable output and `--watch` to
commands that fire jobs (`generate`, `generate-asset`, `generate-motion`)
to poll until completion. Multi-profile auth lives at
`~/.config/nodaro/config.json`; switch profiles with `--profile`.

### MCP

Three object tools are exposed, gated by scope. They mirror the location
platform's "Studio-grade ops" subset: approve, recaption, and motion-
animate. Generation (main image + variants) flows through the shared
`generate_object` tool registered alongside the other verb-style entries.
(Unlike characters and locations, objects have no `create_object` /
`update_object` MCP tools — creation happens via `generate_object`, and
identity edits are done through the REST/SDK surface.)

| Tool | Scope | What it does |
|---|---|---|
| `approve_object_main_image` | `assets:write` | Approve a completed `generate_object` candidate as the main image. Fires the LLM caption inline. |
| `recaption_object` | `assets:write` | Re-run the LLM caption against the current main image. Idempotent retry — does NOT accept `expected_updated_at`. |
| `generate_object_motion` | `workflows:execute` | Animate the main image into a motion clip via i2v. Hardcoded attach column = `motion_clips`. Default provider `kling-turbo` + aspect ratio `1:1`. |

`delete_object`, `restore_object`, and `permanent_delete_object` are
**intentionally not exposed via MCP** — destructive (or destructive-
adjacent) operations driven by an LLM are dangerous, and even a soft
delete is hard to undo without context the LLM doesn't have. Users (and
SDK / CLI integrations on their behalf) can still archive + restore
through REST.

```jsonc
// After generate_object completes — approve the candidate.
approve_object_main_image({
  object_id: "obj-uuid",
  candidate_job_id: "job-1"
})
// → { sourceImageUrl, canonicalDescription }

// Recaption if the inline caption sub-failed (canonicalDescription === "").
recaption_object({ id: "obj-uuid" })
// → { canonicalDescription }

// Motion clip — animates the approved main image.
generate_object_motion({
  motion_prompt: "slow 360 rotation, soft golden rim light",
  source_image_url: "https://r2.example/objects/lantern-main.png",
  provider: "kling-turbo",
  name: "Antique Lantern",
  attach_to_object_id: "obj-uuid",
  attach_name: "rotate-360"
})

// Refinement — iterate an existing clip via video-to-video.
generate_object_motion({
  motion_prompt: "same shot but slow hover instead of rotation",
  source_image_url: "https://r2/obj.png",
  refine_from_video_url: "https://r2/obj-rotation.mp4",
  provider: "wan-i2v",
  name: "Antique Lantern"
})
```

#### App input parameterization for objects

When a workflow with a wired Object node is published as an app
(`/v1/apps`), the object surfaces as an app input via `get_app_inputs`
with `fieldKey: "selectedVariant"`. Callers pass a slug-form string to
pin a variant at run time:

```jsonc
run_app({
  slug: "product-showcase-reel",
  inputs: {
    my_object: "materials/gold"   // "<bucket>/<variant-name>"
  }
})
```

The orchestrator looks up the variant in the object's asset buckets and
patches `sourceImageUrl` so all downstream consumers see it as canonical
for this run. Format is `<bucket>/<variant-name>` where bucket is one of
the 4 asset buckets (`angles`, `materials`, `variations`, `motionClips`)
and variant-name slugifies to match the publisher-stored entry (case-
insensitive, `Polished Brass` ↔ `polished-brass`). Unknown buckets or
unmatched variant names fall through to canonical silently.

Variant names for canonical asset types:

| Asset type | Preset variants |
|---|---|
| `angles` | front, side, top, back, three-quarter, detail, in-context, exploded, perspective |
| `materials` | wood, metal, glass, plastic, fabric, stone, ceramic, leather, paper, gold, silver, copper, marble |
| `variations` | clean, weathered, damaged, ornate, minimal, broken, antique, futuristic, holographic, dirty, polished |
| `motionClips` (via `generate_object_motion`) | rotate-360, hover, spin-slow, parallax, pulse, drift, dolly-around, push-in, drone-orbit |
| `custom` | any short label — pair with `attach_to_column` when attaching to an object row |

See [docs/mcp/tools.md](mcp/tools.md#generate_object_motion) for the full
parameter reference.

## Identity-foundation fields (advanced)

For high-fidelity object work, three fields work together to anchor the
prop's identity across many generations:

- **`description`** — short identity scaffold (typically 1–3 sentences)
  that captures what makes the prop distinctive ("Weathered brass lantern
  with hand-engraved filigree on a cylindrical body, glass panels intact
  but cloudy, hung from a wrought-iron hook").
- **`referencePhotos`** — up to 20 mood-board images tagged with their
  role (`front` / `side` / `detail` / `context` / `moodBoard` / `other`).
  Each entry is treated as an additional reference input by the
  canonical-fallback injector when no upstream image edge is wired.
- **`canonicalDescription`** — ~80–120-word LLM-authored visual caption
  populated by `approveMainImage()` / `recaption()`. This is what
  downstream prompts inject when a node references the object.

For everyday use, you can leave the mood-board empty and let the LLM
caption do the work via `canonicalDescription`. For production-grade
visual consistency on hero-prop or signature-product work, populate a 3–6
image mood-board up-front via `create()` / `update()` — the model has no
prior to anchor against and the wider context translates directly into
more faithful first-pass generations.

## Soft delete + archive

`DELETE /v1/objects/:id` sets `deleted_at` rather than dropping the row.
The object disappears from `list()` by default and returns a uniform 404
`not_found` via `get(id)` (the studio-driven studio path uses a different
helper that preserves archived rows for the archive view).

To see archived rows: `list({ archived: true })` (REST: `?archived=true`).
To un-archive: `POST /v1/objects/:id/restore`. If the name now collides
(case-insensitive) with another active row, the server auto-suffixes
`"(restored)"` and returns the effective name.

| Surface | Delete (archive) | Restore | Permanent delete |
|---|---|---|---|
| REST | `DELETE /v1/objects/:id` | `POST /v1/objects/:id/restore` | `DELETE /v1/objects/:id?permanent=true` (archived rows only) |
| SDK | `client.objects.delete(id)` | `client.objects.restore(id)` | `client.objects.permanentDelete(id)` (archived rows only) |
| CLI | `nodaro objects delete <id>` | `nodaro objects restore <id>` | `nodaro objects delete <id> --permanent` (archived rows only) |
| MCP | **Not exposed** | **Not exposed** | **Not exposed** |

The MCP surface intentionally omits delete, restore, and permanent-delete
entirely so an LLM cannot trigger them. SDK / CLI / REST all support the
archive-first flow: `delete()` first to soft-archive, then
`permanentDelete()` to destroy. The hard-delete path requires the row to
already be archived (returns 400 `not_archived` otherwise) and reaps the
referenced R2 keys (main image, the 3 image asset buckets, motion clips,
reference photos) via `batchDeleteFromR2`.

## Pricing notes

Object generation is metered through the same credit pipeline as other
generation routes:

- `POST /v1/generate-object` — `creditCost(provider) × count` credits,
  reserved for ALL jobs up-front before any is enqueued. Mid-batch
  reservation failures roll back atomically. The image-provider cost
  depends on the model (`nano-banana = 2 cr`, `flux = 2 cr`, etc.) — see
  `docs/nodes/ai-image/generate-image.md` for the per-provider table.
- `POST /v1/generate-object-asset` — `creditCost(provider)` credits per
  variant. Same per-provider table as `generate-image`.
- `POST /v1/generate-object-motion` — `creditCost(provider)` credits per
  motion clip. Provider defaults to `kling-turbo` (the fastest variant
  in the object set; ~15 credits / 5-second clip — cheaper than the
  cinematic kling default used by locations). See
  `docs/nodes/ai-video/generate-video.md` for the full per-provider
  table.
- `POST /v1/objects/:id/approve-main-image` — currently free; the LLM
  caption is uncharged.
- `POST /v1/objects/:id/llm-caption` — currently free; same as above.

Pricing is fetched from the `model_pricing` table at runtime; the static
fallback in `STATIC_CREDIT_COSTS` lists `"object": 2` as the default
identifier when an image provider isn't supplied. See the
[Architecture](./architecture.md) doc for the full credit-flow walkthrough.

## See also

- [Object node reference](./nodes/assets/object.md) — the canvas-node UX guide (Studio modal, 5 tabs, approval flow)
- [Location Platform](./location-platform.md) — the same surfaces, for locations
- [Character Platform](./character-platform.md) — the same surfaces, for characters
- [API Integration](./api-integration.md) — direct REST patterns
- [SDK Quickstart](./sdk-quickstart.md) — typed client walkthrough
- [SDK Reference](./sdk-reference.md) — every `client.objects.*` method
- [MCP Tools](./mcp/tools.md) — every object MCP tool
- [CLI](./cli.md) — `nodaro objects …` subcommands
