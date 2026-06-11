# Location Platform

Nodaro's **location platform** lets you script every Location Studio
operation through REST, the typed SDK, the CLI, and MCP. A location is a
canonical environment row — name, establishing shot, identity copy, plus six
asset buckets (`timeOfDay`, `weather`, `seasons`, `angles`, `lighting`,
`atmosphereMotions`) — that downstream generation nodes reference to keep
the same setting looking like the same place across every shot in a
production.

This guide explains the data model, the four surfaces, and the canonical
"create → main image → approve → layer variants → animate atmosphere" flow.

## When to use which surface

| Surface | Reach for it when… | Lives at |
|---|---|---|
| REST | curl-able, language-agnostic, simplest | `/v1/locations*`, `/v1/generate-location*` |
| SDK (`@nodaro/client`) | Building a typed integration in Node / browser / Bun / Deno | `client.locations.*` |
| CLI (`nodaro` / `@nodaro/cli`) | Terminal scripts, cron, CI, ad-hoc one-shots | `nodaro locations …` |
| MCP | An LLM agent (Claude.ai, Cursor, etc.) is driving the work | `create_location`, `approve_main_image`, etc. |

All four surfaces share the same database row and the same Worker pipeline;
they're four ways to call the same routes.

## The location row

The `locations` table stores one row per location. Highlights:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Stable identifier. |
| `user_id` | uuid | Owner. Every query is scoped by this. |
| `node_id` | text | Canvas node id the row was first bound to. MCP-created rows use the `"mcp-managed"` sentinel. |
| `project_id` | uuid (nullable) | Project the row belongs to. Nullable for MCP-created rows. |
| `workflow_id` | uuid (nullable) | Workflow the row was first bound to. |
| `name` | text | Display name. |
| `description` | text | Freeform identity notes. |
| `category` | text | One of `indoor`, `outdoor`, `urban`, `nature`, `fantasy`, `sci-fi`, `historical`, `futuristic`, `other`. |
| `style` | text | Visual style — one of `realistic`, `anime`, `3d-pixar`, `illustration`. |
| `source_image_url` | text | The **anchor establishing shot** — set by `approve-main-image`. |
| `image_provider` | text | MODEL_CATALOG image-model id the main image was generated with (nullable). Set on create + editable via the update route; validated server-side — unknown / non-image → `null`. |
| `canonical_description` | text | LLM-authored ~80–120-word visual description set when the main image is approved. Coerced from DB null to `""` on the wire. |
| `style_lock` | boolean | When `true`, every variant gen passes the main image as i2i source for layout consistency. Defaults to `true` on new rows. |
| `time_of_day` / `weather` / `seasons` / `angles` / `lighting` | jsonb[] | Five image asset buckets — each entry is `{ name, url }`. |
| `atmosphere_motions` | jsonb[] | The sixth bucket: looping video clips animated from the main image (i2v). Each entry is `{ name, url }` where `url` is a video. |
| `reference_photos` | jsonb[] | Mood-board photos (cap 20), each `{ kind, url }` with `kind ∈ {wide, interior, exterior, detail, moodBoard, other}`. |
| `selected_asset_by_variant` | jsonb | The user's chosen DEFAULT take per variant (Studio version history). OPAQUE map: key `"<bucket>:<variant>"` (e.g. `timeOfDay:dawn`) → the chosen asset URL (one already in that bucket). Keys stored **verbatim** (not normalized); soft-capped at 200 keys / 2048-char values, overflow dropped silently. A separate column — a selection never rewrites an asset bucket. |
| `deleted_at` | timestamptz | Non-null = soft-deleted (archived). |
| `created_at` / `updated_at` | timestamptz | Timestamps. |

Soft delete is the only delete the public programmatic surface exposes. The
studio archive view + REST `/restore` route bring a row back; permanent
destruction is reachable only via `DELETE /v1/locations/:id?permanent=true`
which is UI-only by design — the SDK, CLI, and MCP surfaces all soft-delete.

> The schema does **not** carry per-bucket status columns. In-flight asset
> generations are surfaced via `pendingJobs` on `GET /v1/locations/:id`,
> derived at request time from rows in the `jobs` table where
> `input_data.attachToLocationId = :id` and `status ∈ {pending, running}`.

## Asset arrays explained

Six bucket columns hold the variants of a location's anchor establishing
shot. Each entry is `{ name, url }`:

| Bucket | What it represents | Example variant names |
|---|---|---|
| `timeOfDay` | Same framing, different time of day | `dawn`, `morning`, `noon`, `afternoon`, `golden hour`, `dusk`, `blue hour`, `night`, `midnight` |
| `weather` | Same framing, different weather | `clear`, `cloudy`, `light rain`, `heavy rain`, `storm`, `snow`, `blizzard`, `fog`, `mist` |
| `seasons` | Same framing, seasonal swap | `spring`, `summer`, `autumn`, `winter` |
| `angles` | Camera-angle variants of the same place | `wide`, `medium`, `closeup`, `aerial`, `low-angle`, `eye-level`, `bird's-eye`, `dutch tilt` |
| `lighting` | Lighting-setup variants | `soft natural`, `harsh sunlight`, `golden`, `blue hour`, `neon`, `candlelit`, `cinematic`, `dramatic chiaroscuro` |
| `atmosphereMotions` | Looping video clips animating the main image (i2v) | `slow dolly-in`, `slow pan-left`, `drone fly-over`, `gentle drift`, `parallax` |

Each variant is generated independently via
`POST /v1/generate-location-asset` (or `POST /v1/generate-location-motion`
for `atmosphereMotions`). The result is appended to the named bucket on
completion when `attachToLocationId` + `attachToColumn` + `attachName` are
supplied.

The worker uses the `append_location_asset(p_location_id, p_column,
p_value)` Postgres RPC for the append — it's atomic per-column with a URL
dedup guard and a `deleted_at IS NULL` predicate, so two concurrent jobs
can't clobber each other and a job finishing after a soft-delete won't
resurrect the row.

### Seamless 360° surround continuation

`POST /v1/generate-surround-continuation` builds a look-around (45°, 90°, …
ring views) one frame at a time. Each call generates the next ring view as an
image-to-image continuation of the previous one (`referenceImageUrl`), so a
panorama viewer can stitch the views edge-to-edge.

The platform owns the whole pipeline:

1. **Half-carry composite** — it carries the reference's trailing half into the
   new frame's leading half (per `direction`) and grays the rest; the model
   paints only the gray region.
2. **Paint** — image-to-image off the composite (studio pins
   `provider: "nano-banana-pro"`, `aspectRatio: "16:9"`).
3. **Color harmonization** — it matches the painted half's exposure / white
   balance / color grade to the carried half and
   feathers the seam, so there is no tonal seam down the frame's center even when
   the model drifts warm. The carried half stays **pixel-exact**, so adjacent
   ring views line up perfectly.

`direction` is `right` (turn right), `up` (tilt up), or `down` (tilt down);
`carriedFraction` defaults to `0.5`. The result attaches to the location's
`angles` bucket when `attachToLocationId` + `attachToColumn: "angles"` +
`attachName` are supplied. Billed per image provider — same per-provider table
as `generate-location-asset`.

### Atmosphere motion clips

`POST /v1/generate-location-motion` animates the location's establishing
shot into an ambient camera-move clip — drifting fog, slow camera dollies,
parallax pulls, drone fly-overs — for use as `start_frame` references in
downstream i2v nodes or as B-roll loops.

- **`sourceImageUrl` is REQUIRED.** The route has no fallback — typically
  the location's approved main image URL.
- **Providers** — six image-to-video providers tuned for ambient camera
  moves and world motion: `kling`, `kling-turbo`, `kling-3.0`, `wan-i2v`,
  `wan-2.7-i2v`, `seedance-2`. Source of truth:
  `LOCATION_ATMOSPHERE_PROVIDERS` in `@nodaro/shared/model-constants.ts`.
  Default provider is `kling`.
- **Attach column** — hardcoded server-side to `atmosphere_motions` (locations
  have a single motion bucket). Callers supply `attachToLocationId` +
  `attachName` only — NOT `attachToColumn`.
- **Aspect ratio** — defaults to 16:9 (cinematic establishing shot). Override
  via the `aspectRatio` field (`1:1` / `3:4` / `16:9` / `9:16`). Reuses the
  4-value `CharacterAspectRatio` union — the supported ratios are identical.
- **Credits** — depends on the i2v provider; matches the equivalent
  image-to-video generation on that provider. See `docs/nodes/ai-video/generate-video.md`
  for the per-provider table.

#### Refinement (video-to-video)

Pass `refineFromVideoUrl` (REST) / `refine_from_video_url` (MCP) to route
the worker through video-to-video using THAT clip as the source instead of
running image-to-video from the source frame. Use to iterate on an existing
atmosphere clip with a new prompt without shifting composition:

```bash
# REST — refine an existing fog clip into rain
curl -X POST $API/v1/generate-location-motion \
  -H "Authorization: Bearer $NODARO_API_KEY" \
  -d '{
    "motionPrompt": "same shot but light rain instead of fog",
    "sourceImageUrl": "https://r2/loc.png",
    "refineFromVideoUrl": "https://r2/loc-fog.mp4",
    "provider": "wan-i2v",
    "name": "Old Library"
  }'
```

Routes through providers with the `video-to-video` capability (currently
Wan 2.6 via KIE). Same auto-attach behavior — the refined clip lands in
`atmosphere_motions[]` when `attachToLocationId` is set.

## Reference photos (mood-board)

The mood-board is a small array of caller-supplied reference images that
travel with the location and become **additional reference inputs** for any
downstream node that references the location via FieldMappings — even
without a wired edge. Each entry is `{ kind, url }`:

| `kind` | What it's for |
|---|---|
| `wide` | A wider-establishing crop of the same place. |
| `interior` | Interior shot when the main image is an exterior (or vice versa). |
| `exterior` | The reverse. |
| `detail` | Close-up of a defining detail (statue, sign, plant species, material). |
| `moodBoard` | Vibe / palette / aesthetic reference. |
| `other` | Free-form bucket. |

Caps:

- max 20 entries per location
- `kind` is one of the 6 values above (Zod-enforced)
- the user can attach any number per kind — unlike characters, locations
  don't have a one-per-kind constraint

Pass the array via `referencePhotos` on the create / update body. The
canonical-fallback injector picks the entries up automatically whenever a
downstream consumer references the location, and per-consumer suppression
is available via the canvas's Injected References × button.

#### Kind-tagged conditioning

Each reference photo's `kind` propagates into the prompt builder's subject
line — `Image 1 (Old Library — wide-angle reference) — <canonical
description>` — so the model understands the role of each ref at generate
time (wide-angle establishing context vs. interior detail vs. mood-board
inspiration). The kind labels are stable; you don't need to change anything
in your call sites.

#### PII consent

Reference photos may contain people's faces. Before the first photo can be
added to a location (via the studio UI), the user must tick a consent
checkbox confirming they have rights and consent. The tick is captured as a
timestamp on the `locations.pii_consent_at` column.

- Returned on `GET /v1/locations/:id` as `piiConsentAt` (ISO timestamp or null)
- Accepted on `POST /v1/locations` as `piiConsentAt` (optional)
- API/SDK callers MUST set this when first attaching reference photos to a
  location — `null` is treated as "not consented yet" and the studio UI
  shows the gate on next open

## The main-image approval flow

Generating an establishing shot is a three-step pipeline:

1. **Generate** — `POST /v1/generate-location` produces 1–10 candidate
   jobs (API accepts 1–10; common UI presets are 1, 2, or 4). With
   `attachToLocationId` set AND `count === 1`, the worker writes
   the result to `source_image_url` for the single job (auto-approve for
   single-candidate runs).
2. **Approve** — for multi-candidate runs,
   `POST /v1/locations/:id/approve-main-image` with the chosen
   `candidateJobId` sets `source_image_url` AND fires an LLM caption
   (Claude Sonnet vision) inline to populate `canonical_description`.
3. **Caption** — if the caption sub-failed during approval,
   `canonicalDescription` comes back as `""` (not null). Retry via
   `POST /v1/locations/:id/llm-caption` (502s on LLM failure;
   400 `no_source_image` when no main image is set). Both routes are
   idempotent and safe to re-run.

`canonical_description` is what downstream prompts inject when they
reference this location ("A neon-soaked Tokyo alley after midnight, with
mismatched vending machines lining a wet concrete corridor…"). Without it,
visual drift between scenes is much more likely.

## Using location assets as references

After the assets are populated, downstream generation calls reference the
URLs directly. Two patterns:

**Pattern A — explicit reference URLs.** Most generation nodes accept
`reference_images` (or `referenceImages` in the SDK). Pass any combination
of asset URLs to anchor the new image to the location:

```ts
const location = await client.locations.get(locationId)
const stormUrl = location.weather?.find(w => w.name === "storm")?.url

await client.nodes.run("generate-image", {
  prompt: "the same alley under a thunderstorm, a courier sprinting through",
  reference_images: [stormUrl].filter(Boolean),
})
```

**Pattern B — `{locationName}` field-mapping in editor prompts.** Inside
the canvas, prompt fields support `{Rainy Tokyo Alley}` interpolation that
resolves at execution time to the location's canonical description + the
main image attached as a reference (canonical fallback). Style Lock
controls whether the canonical description is injected verbatim or as
soft guidance.

For programmatic flows, prefer Pattern A — explicit URLs are easier to
reason about and don't depend on the canvas wiring.

**Pattern C — `@location:N:bucket/variant` mention syntax (canvas).** In
generate-image / image-to-image / modify-image prompts, type
`@oldlibrary:1:weather/rain` to pin a specific variant inline. The slug is
the location's slugified name (`old-library` → `oldlibrary` — see
`locationMentionSlug` in `@nodaro/shared`); the `bucket/variant` segment
maps to one of the 6 asset buckets (`timeOfDay`, `weather`, `seasons`,
`angles`, `lighting`, `atmosphereMotions`) and the variant's slugified
name. Three optional shapes:

| Shape | Effect |
|-------|--------|
| `@oldlibrary:1` | Canonical reference image, `identical` mode |
| `@oldlibrary:1:layout` | Canonical with `style` / `layout` / `none` mode override |
| `@oldlibrary:1:weather/rain` | Pin the rain variant (bucket/variant pair) |
| `@oldlibrary:1:weather/rain:style` | Variant + mode override |

The 4 usage modes (`identical`, `style`, `layout`, `none`) control how the
model uses the reference — match exactly, style/mood transfer, compositional
layout transfer, or attach the image without textual bias. The studio's
autocomplete pill (cyan) shows the mode via a dropdown.

**Pattern D — Smart variant selection (automatic).** When a wired location
feeds a generator and you DON'T type a `@location:N:variant` mention, the
prompt-builder scans your prompt for keywords matching the location's
variant names. `"at sunset"` → `timeOfDay/dusk` if you have a dusk variant;
`"rainy evening"` → `weather/rain`; `"neon-lit street"` → `lighting/neon`.
A small synonym table handles common alternatives ("sunset" matches "dusk",
"rainy" matches "rain"). Bucket priority on ties: timeOfDay > weather >
seasons > lighting > angles > atmosphereMotions. Explicit `@-mention`
always wins over smart match.

## Style Lock semantics

Style Lock is the location platform's most important consistency switch.
It's a single boolean (`styleLock`) defaulting to `true` on new rows that
travels with the location row and is read at every gen-time decision:

- **Style Lock ON** (default): every variant generation (time of day /
  weather / seasons / angles / lighting) passes the location's
  `sourceImageUrl` as the i2i source. The worker uses it to anchor the
  variant to the approved look — same building, same materials, same
  baseline composition. Downstream consumers also receive the canonical
  description as injected context. Use this for everything that should
  feel like the same place across shots.

- **Style Lock OFF**: variant gens omit `sourceImageUrl`, falling back to
  text-only generation. Downstream consumers still get the canonical
  description as soft guidance but the model is free to reinterpret
  layout, materials, and time-of-day baseline. Use this for intentional
  mash-ups, alternate aesthetic takes, or A/B comparisons.

Toggle Style Lock via:

- **Studio header** — the prominent toggle in the Location Studio modal.
- **Canvas config panel** — same toggle, surfaced in the right-side
  config panel when the location node is selected.
- **API** — `client.locations.update(id, { styleLock: false })`.

## Quickstart by surface

### REST

```bash
TOKEN="ndr_..."
BASE="https://nodaro.example.com"

# Create
LOC=$(curl -s -X POST "$BASE/v1/locations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "scripted",
    "name": "Rainy Tokyo Alley",
    "description": "Neon-soaked alley with vending machines and wet pavement",
    "category": "urban",
    "style": "realistic"
  }' | jq -r .id)

# Generate one establishing shot (auto-attaches)
curl -s -X POST "$BASE/v1/generate-location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Rainy Tokyo Alley\",\"count\":1,\"attachToLocationId\":\"$LOC\"}"

# (after job completes) Re-fetch the row
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/locations/$LOC" | jq .sourceImageUrl

# Generate a weather variant
curl -s -X POST "$BASE/v1/generate-location-asset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetType\": \"weather\",
    \"variant\": \"storm\",
    \"name\": \"Rainy Tokyo Alley\",
    \"attachToLocationId\": \"$LOC\",
    \"attachToColumn\": \"weather\",
    \"attachName\": \"storm\"
  }"

# Animate the establishing shot into an atmospheric motion clip
MAIN=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/locations/$LOC" | jq -r .sourceImageUrl)
curl -s -X POST "$BASE/v1/generate-location-motion" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Rainy Tokyo Alley\",
    \"motionPrompt\": \"slow dolly-in, neon signs flicker, light rain falling\",
    \"sourceImageUrl\": \"$MAIN\",
    \"provider\": \"kling\",
    \"attachToLocationId\": \"$LOC\",
    \"attachName\": \"neon dolly-in\"
  }"
```

#### Endpoint reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/locations` | JWT / `ndr_` | List active. Pass `?archived=true` to list archived. |
| `GET` | `/v1/locations/:id` | JWT / `ndr_` | Detail row + `pendingJobs[]`. Soft-deleted rows ARE returned by id. |
| `POST` | `/v1/locations` | JWT / `ndr_` | Upsert. With `id` → UPDATE (worker-owned columns dropped); without → INSERT. Optimistic-concurrency via `expectedUpdatedAt`. |
| `DELETE` | `/v1/locations/:id` | JWT / `ndr_` | Soft-delete (sets `deleted_at`). |
| `DELETE` | `/v1/locations/:id?permanent=true` | JWT / `ndr_` | Permanent destroy. **Row must already be archived** (400 `not_archived` otherwise). UI-only by design — SDK, CLI, MCP all omit this path. |
| `POST` | `/v1/locations/:id/restore` | JWT / `ndr_` | Un-archive. Auto-suffixes `"(restored)"` on name collision. |
| `POST` | `/v1/locations/:id/approve-main-image` | JWT / `ndr_` | Approve a candidate; sets `source_image_url`, fires LLM caption inline. |
| `POST` | `/v1/locations/:id/llm-caption` | JWT / `ndr_` | Re-run LLM caption against the current main image. |
| `POST` | `/v1/generate-location` | JWT / `ndr_` | Generate 1–10 candidate establishing shots. |
| `POST` | `/v1/generate-location-asset` | JWT / `ndr_` | Generate one variant for any of the 5 image buckets (or `custom`). |
| `POST` | `/v1/generate-surround-continuation` | JWT / `ndr_` | Generate the next seamless 360° ring view (half-carry composite + paint + color-harmonize); attaches to `angles`. |
| `POST` | `/v1/generate-location-motion` | JWT / `ndr_` | Animate the establishing shot into an atmosphere motion clip via i2v. |

All `/generate-*` routes return a `jobId` (count=1) or `jobIds[]` (count=2/4)
and reserve credits up-front before any worker job is enqueued.

### SDK

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

// Create a location, generate one main image, auto-attach on completion.
const { id: locationId } = await client.locations.create({
  nodeId: "scripted",
  name: "Rainy Tokyo Alley",
  description: "Neon-soaked alley with vending machines and wet pavement",
  category: "urban",
  style: "realistic",
})

const generated = await client.locations.generate({
  name: "Rainy Tokyo Alley",
  count: 1,
  attachToLocationId: locationId,
})
// Always returns `{ jobIds: string[] }` (`jobId` is a deprecated alias for single-candidate runs).

// Poll the job; with count=1 the worker auto-attaches the result on completion.

// For multi-candidate runs, explicitly approve the chosen candidate:
const approved = await client.locations.approveMainImage(
  locationId,
  "<candidateJobId>",
)
// approved.sourceImageUrl + approved.canonicalDescription

// Generate a weather variant — auto-attaches on completion.
await client.locations.generateAsset({
  assetType: "weather",
  variant: "storm",
  name: "Rainy Tokyo Alley",
  attachToLocationId: locationId,
  attachToColumn: "weather",
  attachName: "storm",
})

// Generate the next 360° ring view — the platform builds the half-carry
// composite, paints, and color-harmonizes so there is no seam; the carried half
// stays pixel-exact and the result auto-attaches to the `angles` bucket.
await client.locations.generateSurroundContinuation({
  referenceImageUrl: previousRingView,
  direction: "right",
  degrees: 45,
  provider: "nano-banana-pro",
  aspectRatio: "16:9",
  attachToLocationId: locationId,
  attachToColumn: "angles",
  attachName: "Surround 45°",
})

// Animate the establishing shot into an atmosphere motion clip.
await client.locations.generateMotion({
  motionPrompt: "slow dolly-in, neon signs flicker, light rain falling",
  sourceImageUrl: approved.sourceImageUrl,
  provider: "kling",
  name: "Rainy Tokyo Alley",
  attachToLocationId: locationId,
  attachName: "neon dolly-in",
  // aspectRatio defaults to "16:9" server-side; override here if needed.
})

// Flip Style Lock off for a one-off mash-up gen.
await client.locations.update(locationId, { styleLock: false })

// Soft-delete (archive) — recoverable.
await client.locations.delete(locationId)

// List the archive.
const { locations } = await client.locations.list({ archived: true })

// Restore from the archive.
await client.locations.restore(locationId)
```

Full surface: `list` / `get` / `create` / `update` / `delete` (soft) /
`restore` / `generate` / `generateAsset` / `generateSurroundContinuation` /
`generateMotion` / `approveMainImage` / `recaption`. Permanent-delete is
intentionally absent
— see the Soft delete + archive section.

### CLI

```bash
# Create a location
nodaro locations create "Rainy Tokyo Alley" \
  --node-id scripted \
  --description "Neon-soaked alley with vending machines" \
  --category urban --style realistic

# Generate one main image and auto-attach
nodaro locations generate \
  --name "Rainy Tokyo Alley" \
  --count 1 \
  --attach-to-location-id <location-id> \
  --watch

# Generate a single environmental variant
nodaro locations generate-asset <location-id> \
  --asset-type weather \
  --variant storm \
  --watch

# Animate the establishing shot into an atmospheric motion clip
nodaro locations generate-motion \
  --name "Rainy Tokyo Alley" \
  --motion-prompt "slow dolly-in, neon signs flicker, light rain falling" \
  --source-image-url "https://r2.example/locations/tokyo-alley-main.png" \
  --provider kling \
  --attach-to-location-id <location-id> \
  --attach-name "neon dolly-in" \
  --aspect-ratio 16:9 \
  --watch

# Approve a candidate as the main image (multi-candidate flow)
nodaro locations approve-main-image <location-id> \
  --candidate-job-id <job-id>

# Re-run the LLM caption against the current main image
nodaro locations recaption <location-id>

# Update Style Lock
nodaro locations update <location-id> --style-lock false

# Archive / list archived / restore
nodaro locations delete <location-id>
nodaro locations list --archived
nodaro locations restore <location-id>
```

Pass `--json` to any command for machine-readable output and `--watch` to
commands that fire jobs (`generate`, `generate-asset`, `generate-motion`)
to poll until completion. Multi-profile auth lives at
`~/.config/nodaro/config.json`; switch profiles with `--profile`.

### MCP

Eight location tools are exposed, gated by scope. Two
(`generate_location`, `generate_location_motion`) are verb-style entries
that live in the shared `verbs-*` / `locations.ts` registry alongside
`generate_image` and `generate_character`, while the other six
(list, get, create, update, approve, recaption) live in the dedicated
`locations.ts` MCP module.

| Tool | Scope | What it does |
|---|---|---|
| `list_locations` | `assets:read` | Summary list (name, main image URL, asset counts, identity copy). Pass `archived: true` for the archive. |
| `get_location` | `assets:read` | Full detail including all six asset arrays + reference photos. |
| `create_location` | `assets:write` | Create a new row with name + optional description / category / style. Returns the new id. |
| `update_location` | `assets:write` | Update identity fields (name / description / category / style / styleLock / canonicalDescription). Optimistic-concurrency via `expectedUpdatedAt`. |
| `approve_main_image` | `assets:write` | Approve a completed `generate_location` candidate as the main image. Fires the LLM caption inline. |
| `recaption_location` | `assets:write` | Re-run the LLM caption against the current main image. |
| `generate_location` | `workflows:execute` | Generate a main image (`kind: "main"`) or a variant asset (`kind: "asset"` + `asset_type` + `variant`). |
| `generate_location_motion` | `workflows:execute` | Animate the main image into an atmospheric motion clip via i2v. Hardcoded attach column = `atmosphere_motions`. |

`delete_location` and `restore_location` are **intentionally not exposed
via MCP** — destructive (or destructive-adjacent) operations driven by an
LLM are dangerous, and even a soft delete is hard to undo without context
the LLM doesn't have. Users (and SDK / CLI integrations on their behalf)
can still archive + restore through REST.

```jsonc
create_location({
  name: "Rainy Tokyo Alley",
  description: "Neon-soaked alley with vending machines",
  category: "urban",
  style: "realistic"
})
// → { id: "loc-uuid", name: "Rainy Tokyo Alley" }

// Main image (single candidate — auto-attaches on completion).
generate_location({
  kind: "main",
  name: "Rainy Tokyo Alley",
  attach_to_location_id: "loc-uuid"
})
// → { content: [text], structuredContent: { jobId: "job-1" } }

// Multi-candidate flow — approve the winner explicitly.
approve_main_image({
  location_id: "loc-uuid",
  candidate_job_id: "job-1"
})
// → { sourceImageUrl, canonicalDescription }

// Variant asset — auto-attaches to the `weather` bucket.
generate_location({
  kind: "asset",
  name: "Rainy Tokyo Alley",
  asset_type: "weather",
  variant: "storm",
  attach_to_location_id: "loc-uuid"
})

// Custom asset — caller must supply attach_to_column.
generate_location({
  kind: "asset",
  name: "Rainy Tokyo Alley",
  asset_type: "custom",
  variant: "neon-soaked midnight",
  attach_to_location_id: "loc-uuid",
  attach_to_column: "lighting",
  attach_name: "Neon Midnight"
})

// Atmosphere motion clip — animates the approved main image.
generate_location_motion({
  motion_prompt: "slow dolly-in, neon signs flicker, light rain falling",
  source_image_url: "https://r2.example/locations/tokyo-alley-main.png",
  provider: "kling",
  name: "Rainy Tokyo Alley",
  attach_to_location_id: "loc-uuid",
  attach_name: "neon dolly-in"
})

// Refinement — iterate an existing clip via video-to-video.
generate_location_motion({
  motion_prompt: "same shot but light rain instead of fog",
  source_image_url: "https://r2/loc.png",
  refine_from_video_url: "https://r2/loc-fog.mp4",
  provider: "wan-i2v",
  name: "Rainy Tokyo Alley"
})
```

#### App input parameterization for locations

When a workflow with a wired Location node is published as an app
(`/v1/apps`), the location surfaces as an app input via `get_app_inputs`
with `fieldKey: "selectedVariant"`. Callers pass a slug-form string to
pin a variant at run time:

```jsonc
run_app({
  slug: "neon-noir-poster",
  inputs: {
    my_location: "weather/rain"   // "<bucket>/<variant-name>"
  }
})
```

The orchestrator looks up the variant in the location's asset buckets and
patches `sourceImageUrl` so all downstream consumers see it as canonical
for this run. Format is `<bucket>/<variant-name>` where bucket is one of
the 6 asset buckets and variant-name slugifies to match the publisher-
stored entry (case-insensitive, `Light Rain` ↔ `light-rain`). Unknown
buckets or unmatched variant names fall through to canonical silently.

Variant names for canonical asset types:

| Asset type | Preset variants |
|---|---|
| `timeOfDay` | dawn, morning, noon, afternoon, golden hour, dusk, blue hour, night, midnight |
| `weather` | clear, cloudy, light rain, heavy rain, storm, snow, blizzard, fog, mist |
| `seasons` | spring, summer, autumn, winter |
| `angles` | wide, medium, closeup, aerial, low-angle, eye-level, bird's-eye, dutch tilt |
| `lighting` | soft natural, harsh sunlight, golden, blue hour, neon, candlelit, cinematic, dramatic chiaroscuro |
| `custom` | any short label — pair with `attach_to_column` when attaching to a location row |
| `atmosphereMotions` (via `generate_location_motion`) | slow dolly-in, slow pan-left, slow pan-right, push up, drone fly-over, gentle drift, parallax, static atmospheric |

See [docs/mcp/tools.md](mcp/tools.md#generate_location) for the full
parameter reference.

## Identity-foundation fields (advanced)

For high-fidelity location work, three fields work together to anchor the
sense of place across many generations:

- **`description`** — short identity scaffold (typically 1–3 sentences)
  that captures what makes the place distinctive ("Neon-soaked alley with
  mismatched vending machines lining wet concrete and a tangle of overhead
  cables").
- **`referencePhotos`** — up to 20 mood-board images tagged with their
  role (`wide` / `interior` / `exterior` / `detail` / `moodBoard` /
  `other`). Each entry is treated as an additional reference input by the
  canonical-fallback injector when no upstream image edge is wired.
- **`canonicalDescription`** — ~80–120-word LLM-authored visual caption
  populated by `approveMainImage()` / `recaption()`. This is what
  downstream prompts inject when a node references the location.

For everyday use, you can leave the mood-board empty and let the LLM
caption do the work via `canonicalDescription`. For production-grade
visual consistency on unfamiliar or fantastical locations, populate a 3–6
image mood-board up-front via `create()` / `update()` — the model has no
prior to anchor against and the wider context translates directly into
more faithful first-pass generations.

## Soft delete + archive

`DELETE /v1/locations/:id` sets `deleted_at` rather than dropping the row.
The location disappears from `list()` by default but remains loadable via
`get(id)` so canvas nodes pointing at it keep rendering.

To see archived rows: `list({ archived: true })` (REST: `?archived=true`).
To un-archive: `POST /v1/locations/:id/restore`. If the name now collides
(case-insensitive) with another active row, the server auto-suffixes
`"(restored)"` and returns the effective name.

| Surface | Delete (archive) | Restore | Permanent delete |
|---|---|---|---|
| REST | `DELETE /v1/locations/:id` | `POST /v1/locations/:id/restore` | `DELETE /v1/locations/:id?permanent=true` (archived rows only) |
| SDK | `client.locations.delete(id)` | `client.locations.restore(id)` | **Not exposed** |
| CLI | `nodaro locations delete <id>` | `nodaro locations restore <id>` | **Not exposed** |
| MCP | **Not exposed** | **Not exposed** | **Not exposed** |

Permanent deletion is intentionally NOT exposed through the SDK, CLI, or
MCP surfaces. The archive view in the editor (`/library/locations`) is the
only path: a two-step typed-name confirmation flow that calls
`DELETE /v1/locations/:id?permanent=true`. That route requires the row to
already be archived (returns 400 `not_archived` otherwise) and reaps the
referenced R2 keys (main image, the 6 asset buckets, reference photos)
via `batchDeleteFromR2`. The MCP surface intentionally omits delete and
restore entirely so an LLM cannot trigger them.

## Pricing notes

Location generation is metered through the same credit pipeline as other
generation routes:

- `POST /v1/generate-location` — `creditCost(provider) × count` credits,
  reserved for ALL jobs up-front before any is enqueued. Mid-batch
  reservation failures roll back atomically. The image-provider cost
  depends on the model (`nano-banana = 1 cr`, `flux = 2 cr`, etc.) — see
  `docs/nodes/ai-image/generate-image.md` for the per-provider table.
- `POST /v1/generate-location-asset` — `creditCost(provider)` credits per
  variant. Same per-provider table as `generate-image`.
- `POST /v1/generate-surround-continuation` — `creditCost(provider)` credits
  per ring view (one image generation). Same per-provider table as
  `generate-image`; the server-side composite + color-harmonization steps are
  not separately charged.
- `POST /v1/generate-location-motion` — `creditCost(provider)` credits per
  motion clip. Provider defaults to `kling` (~28 credits / 10-second clip (kling:5s = 14)).
  See `docs/nodes/ai-video/generate-video.md` for the full per-provider
  table.
- `POST /v1/locations/:id/approve-main-image` — currently free; the LLM
  caption is uncharged.
- `POST /v1/locations/:id/llm-caption` — currently free; same as above.

Pricing is fetched from the `model_pricing` table at runtime; the static
fallback in `STATIC_CREDIT_COSTS` lists `"location": 2` as the default
identifier when an image provider isn't supplied. See the
[Architecture](./architecture.md) doc for the full credit-flow walkthrough.

## See also

- [Location node reference](./nodes/assets/location.md) — the canvas-node UX guide (Studio modal, 7 tabs, approval flow)
- [Character Platform](./character-platform.md) — the same surfaces, for characters
- [API Integration](./api-integration.md) — direct REST patterns
- [SDK Quickstart](./sdk-quickstart.md) — typed client walkthrough
- [SDK Reference](./sdk-reference.md) — every `client.locations.*` method
- [MCP Tools](./mcp/tools.md) — every location MCP tool
- [CLI](./cli.md) — `nodaro locations …` subcommands
