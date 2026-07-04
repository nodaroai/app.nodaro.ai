# Location Asset
> Create a multi-variation environment asset with consistent identity across time of day, weather, seasons, angles, lighting, and atmospheric motion clips — built and managed in the full-screen Location Studio — or choose an existing location from your Library or the Public Gallery.

## Overview
The Location node creates a reusable environment asset with a canonical establishing shot, multiple visual variation categories (time of day, weather, seasons, angles, lighting), a set of atmospheric motion clips, and identity metadata (canonical description, category, style, mood-board reference photos). You can either build a new location or bind the node to an existing one from your Library or the Public Gallery. All location editing happens inside the **Location Studio** — a full-screen modal — while the canvas node itself stays compact and shows a summary. Locations are persisted per-project in the database and can be referenced by downstream nodes (scenes, image generation, image-to-video) via the `locationRef` output to maintain visual consistency across a project.

## When to Use
- **Multi-scene narratives** — you want the same setting to look the same across every shot.
- **Cinematic sequences** — establishing shot + variations (dusk, storm, aerial) for cutaways.
- **Anchored generation** — downstream image/video nodes should auto-pull the location's canonical description and mood-board references even when no edge is wired.
- **Atmosphere clips** — short looping ambient video (drifting fog, slow dolly-in, drone fly-over) reusable as `start_frame` or texture loops in downstream i2v nodes.

## The Canvas Node

The Location node on the canvas is a compact summary card. It shows:
- The main image preview (or a placeholder when the location has no approved main image yet)
- The location name plus `style · category` line, with a `· Style locked` suffix when style lock is on
- A 6-cell asset grid with one badge per bucket — **TOD**, **Weather**, **Seasons**, **Angles**, **Lighting**, **Motion** — each showing the bucket's icon and item count (or a spinner while a generation is in-flight)
- An **⬡ Open Studio** button that launches the Location Studio
- A **Choose existing** button (next to **⬡ Open Studio**) that opens the **Asset Picker** to bind the node to a location you already have. Once a location is bound, this button becomes **Replace** — use it to swap in a different location.

All appearance and asset editing — generating the main image, approving candidates, generating environmental variants, atmosphere motion clips, editing the canonical description, mood-board photos, and style lock — happens inside the studio.

## Configuration

The config panel (right side, when a Location node is selected) is intentionally minimal:

| Field | Type | Description |
|-------|------|-------------|
| Summary | read-only | Location name, style, and category at a glance. |
| Open Location Studio | button | Opens the full-screen Location Studio (same modal as the node's **⬡ Open Studio** button). |
| Choose from Library / Gallery | button (row) | Opens the **Asset Picker** to bind the node to an existing location. Becomes **Replace from Library / Gallery** once a location is bound — use it to swap in a different one. |
| Style Lock | toggle | When on, downstream image/video nodes inject the canonical description verbatim and refuse to override the style. When off, downstream nodes may freely reinterpret the location (useful for variants and mash-ups). Mirrors the toggle in the studio header. |
| Field Mappings | section | Map upstream node outputs to the location's inputs — `{locationName}` injection still works. |

### Location Data

In addition to the main image and identity settings, a location holds the following data (all built and managed in the studio):

| Data | Description |
|------|-------------|
| `sourceImageUrl` | The approved establishing shot. The reference image for all generated environmental variants and motion clips. |
| `canonicalDescription` | LLM-authored multi-sentence "true reference" description (~80–120 words). Written automatically by Claude Sonnet vision on main-image approval; editable manually; re-runnable via the studio's Retry caption button. Used as the implicit context block whenever a downstream consumer references this location. |
| `timeOfDay` | Image variants of the location at different times — dawn, morning, noon, afternoon, golden hour, dusk, blue hour, night, midnight. |
| `weather` | Image variants under different weather — clear, cloudy, light rain, heavy rain, storm, snow, blizzard, fog, mist. |
| `seasons` | Image variants across the four seasons — spring, summer, autumn, winter. |
| `angles` | Image variants from different camera positions — wide, medium, closeup, aerial, low-angle, eye-level, bird's-eye, dutch tilt. |
| `lighting` | Image variants under different lighting setups — soft natural, harsh sunlight, golden, blue hour, neon, candlelit, cinematic, dramatic chiaroscuro. |
| `atmosphereMotions` | Short **video clips** generated from the main image via image-to-video providers. Looping ambient motion for use as `start_frame` references or B-roll. |
| `referencePhotos` | Mood-board of up to 20 reference images (URL + kind label: `wide` / `interior` / `exterior` / `detail` / `moodBoard` / `other`). Treated as additional reference inputs by the canonical-fallback injector when no upstream wires are present. |
| `category` | Location category. Options: `indoor`, `outdoor`, `urban`, `nature`, `fantasy`, `sci-fi`, `historical`, `futuristic`, `other`. |
| `style` | Visual style. Options: `realistic`, `anime`, `3d-pixar`, `illustration`. |
| `styleLock` | Boolean. Defaults to `true` on new rows. |

### Asset Categories

| Category | Type | Presets | Examples |
|----------|------|---------|----------|
| Time of Day | images | 9 | `dawn`, `golden hour`, `dusk`, `night` |
| Weather | images | 9 | `clear`, `heavy rain`, `storm`, `fog` |
| Seasons | images | 4 | `spring`, `summer`, `autumn`, `winter` |
| Angles | images | 8 | `wide`, `aerial`, `low-angle`, `dutch tilt` |
| Lighting | images | 8 | `golden`, `neon`, `cinematic`, `dramatic chiaroscuro` |
| Atmosphere Motions | video clips | 8 | `slow dolly-in`, `drone fly-over`, `parallax`, `gentle drift` |

> Preset strings are load-bearing on backend dispatch — the `variant` you select is stored on the asset entry and sent as the route's enum value. Any custom variant is supported via the per-tab **Custom** prompt input, which uses `assetType: "custom"` so the worker doesn't try to look the variant up in the preset switch.

## Choosing an existing asset

Instead of building a new location in the studio, you can bind the node to one you already have. Open the **Asset Picker** from either the **Choose existing** button on the canvas node or the **Choose from Library / Gallery** row in the config panel. The picker has two tabs:

- **My Library** — your own saved locations.
- **Public Gallery** — locations shared by the community. Selecting one **clones it into your library first** (you can't reference another creator's private asset), then binds the node to that fresh clone.

This works both for an empty node (first-time selection) and to **replace** a location that's already set — once a location is bound, the buttons read **Replace** / **Replace from Library / Gallery**. Binding or replacing carries the full location (establishing shot plus every variation bucket — time of day, weather, seasons, angles, lighting, and atmosphere motion clips), so downstream nodes immediately use the new location.

In two more cases the picker helps you avoid clutter:

- **Already have a copy?** If you pick a Public Gallery listing you've cloned before, the picker asks whether to **use your existing copy** or **make a new copy** — so a gallery pick never silently piles up duplicates.
- **Delete from My Library.** Hover a card in the **My Library** tab and click the trash icon to remove a saved asset. It's archived (recoverable), and any nodes already using it keep working.

## Location Studio

The Location Studio is a full-screen modal where you build and manage everything about the location. Open it from:
- The **⬡ Open Studio** button on the canvas node, or
- The **Open Location Studio** button in the config panel.

The studio **auto-saves** as you work. Identity fields (name, description, category, style, canonical description, style lock, reference photos) are persisted via a debounced PATCH back to `/v1/locations/:id` — with optimistic-concurrency tokens (`expectedUpdatedAt`) so a stale tab can't clobber a fresher save. Generated assets are persisted by the **backend itself** at completion — every Generate call passes the location's DB id plus the target column along with the request, and the worker appends the result directly to the location row's JSONB column on job completion via the `append_location_asset` RPC. That means **if you close the tab or refresh mid-generation, the asset still lands on the location** the next time you open the studio. A small "Saving… / Saved" indicator in the header reflects the current state. There is no Save button for assets, only for identity fields.

The studio organizes everything into a config-driven vertical sidebar grouped into six sections (reference photos are now a first-class **References** page under Resources):

| Section | Tab | What it Does |
|---------|-----|--------------|
| **Resources** | 📷 References | Drag-and-drop / paste reference-photo mood-board (cap 20) with per-tile kind labels — the visual references the location is built from. |
| **Identity** | 🏞 Appearance | Main image generation + approval, identity form (name, description, category, style), canonical description editor, style lock toggle. |
| **Environment** | 🌅 Time of Day | Generate dawn / morning / noon / afternoon / golden hour / dusk / blue hour / night / midnight variants of the approved main image. |
| **Environment** | 🌧 Weather | Generate clear / cloudy / light rain / heavy rain / storm / snow / blizzard / fog / mist variants. |
| **Environment** | 🍁 Seasons | Generate spring / summer / autumn / winter variants. |
| **Composition** | 📐 Angles | Generate wide / medium / closeup / aerial / low-angle / eye-level / bird's-eye / dutch tilt camera-angle variants. |
| **Composition** | 💡 Lighting | Generate soft natural / harsh sunlight / golden / blue hour / neon / candlelit / cinematic / dramatic chiaroscuro lighting variants. |
| **Atmosphere** | 🎬 Motion | Generate atmospheric motion clips via image-to-video — looping camera moves and ambient world motion. |
| **Sheet** | 📋 Sheet | Composite reference-sheet boards (turnaround / variation / detail) generated from the location's assets. |

### Identity → Appearance

Identity controls for the location itself: name, description, category, style, and a **Generate** button to produce candidate main images. Below the form sit three sub-sections (reference photos now live on the **References** page under Resources):

- **Main image** — Preview of the approved establishing shot. Empty placeholder until the first approval.
- **Candidates grid** — When a multi-candidate generation finishes, completed candidates appear here with **Approve** / **Discard** buttons per card.
- **Canonical description** — Live textarea showing the LLM-authored description. Edit freely; saves are debounced. A **Retry caption** button calls `POST /v1/locations/:id/llm-caption` to re-run Claude Sonnet vision against the current main image (502s on LLM failure; 400 `no_source_image` when no main image is set).

### Approval Flow

The main image generation supports **multi-candidate approval** so you can compare options before committing:

1. Set count to **1, 2, or 4** in the Appearance tab. (Use **1** for "I trust the model and want it auto-attached"; **2** or **4** for "show me options.")
2. Click **Generate** — the studio fires `POST /v1/generate-location` and tracks the returned job ids. (When the row hasn't been saved yet, the studio first calls `ensureSavedBeforeGen()` to create it so the worker has a target.)
3. Candidates stream in via the studio's polling hook as each job completes.
4. For `count === 1`, the worker writes the result directly to `locations.source_image_url` on completion — no manual approval required.
5. For `count === 2 | 4`, each candidate appears as a card in the grid. Click **Approve** to call `POST /v1/locations/:id/approve-main-image` with the chosen `candidateJobId`. The route:
   - Sets `source_image_url` on the location row.
   - Runs **Claude Sonnet vision** inline to author the canonical description.
   - Returns the new main-image URL plus the caption.
6. **Discard** is purely client-side — it drops the card from the grid without telling the backend. The candidate's R2 asset stays in `jobs.output_data` and is eventually purged by the cleanup-cron.

> Caption-failure semantics: if the LLM call sub-fails during approval, `canonicalDescription` is returned as `""` (NOT null). The main image is still set; click **Retry caption** to recover.

While an approval call is in flight, the studio sets `isApprovingMainImage = true` and the Generate button is locked out — prevents an "approve then immediately re-generate" race that would clobber the new main image.

### Style Lock

Style Lock is the studio's most important consistency switch. It lives in two places:

- A header toggle in the studio modal.
- A toggle in the canvas config panel.

Behavior:

- **Style Lock ON** (default): when generating any environmental variant, the studio passes `sourceImageUrl` (the approved main image) as the i2i source. The worker uses it to anchor the variant to the approved look — same building, same materials, same time-of-day baseline. Downstream consumers also receive the canonical description as injected context.
- **Style Lock OFF**: the studio omits `sourceImageUrl` on variant gens. The worker falls back to text-only generation, freely reinterpreting the location each time. Useful for generating mash-ups, alternate aesthetic takes, or A/B comparisons.

### Reference Photos (Mood-Board)

The mood-board is a small array of caller-supplied reference images that travel with the location and become **additional reference inputs** for any downstream node that references the location via FieldMappings — even without a wired edge. Each entry has:

- `url` — the image URL.
- `kind` — one of `wide` / `interior` / `exterior` / `detail` / `moodBoard` / `other`. Free-form bucket for organizing what each reference is *for*.

Up to 20 entries per location. The mood-board is intended for unfamiliar or fantastical locations where a 3–6 image set gives the model the wider context it needs to render the place faithfully on the first generation. Each entry is treated as a reference input by the canonical-fallback injector; per-node suppression is available via the Injected References list's × button on consuming image/video nodes.

### Environmental Variants

The five environmental tabs (Time of Day, Weather, Seasons, Angles, Lighting) share a single layout:

- **Asset grid** — completed variant cards with hover ✕ remove + in-flight placeholder cards for jobs the studio is tracking. Empty-state copy when both are zero.
- **Preset chip row** — clickable buttons that fire `generateLocationAsset` with the configured `assetType` and `attachToColumn`. Click once per preset to generate that variant.
- **Custom prompt input** — free-form text. Fires `assetType: "custom"` with the typed text as both `variant` and `userPrompt` so the long-form user description wins over the short variant literal.
- **Generate All** button — queues every missing preset in one batch.

Auto-attach: when `attachToLocationId` + `attachToColumn` + `attachName` are all set, the worker appends the produced asset onto the location row's JSONB column at job-completion time. The studio refresh path on next save round-trip pulls the new entry from the canonical row; the in-flight placeholder gives the user visual acknowledgment until that round-trip completes.

### Atmosphere Motion Clips

The **Motion** tab generates short looping video clips from the location's approved main image — drifting fog, slow camera dollies, parallax pulls, drone fly-overs — for use as `start_frame` references in downstream i2v nodes or as B-roll loops.

- **Requires an approved main image first.** The Generate button is disabled with a tooltip until `sourceImageUrl` is set.
- **Providers** — six image-to-video providers tuned for ambient camera moves and world motion: `kling`, `kling-turbo`, `kling-3.0`, `wan-i2v`, `wan-2.7-i2v`, `seedance-2`. Source of truth: `LOCATION_ATMOSPHERE_PROVIDERS` in `@nodaro/shared/model-constants.ts`.
- **Preset chips** — 8 one-tap presets: `slow dolly-in`, `slow pan-left`, `slow pan-right`, `push up`, `drone fly-over`, `gentle drift`, `parallax`, `static atmospheric`.
- **Custom prompt** — free-form text describing what moves and how. Examples: "slow dolly-in, leaves drift across frame", "drone fly-over, neon signs flicker", "fog rolls in from the left while light beams shift slowly".
- **Aspect ratio** — defaults to **16:9** (cinematic establishing shot). Override via the `aspectRatio` field on the SDK / CLI surfaces (`1:1` / `3:4` / `16:9` / `9:16`).
- **Credit cost** — depends on the i2v provider; matches the equivalent image-to-video generation on that provider. See the [Image to Video](../ai-video/image-to-video.md) node for provider pricing.

The attach column is hardcoded server-side to `atmosphere_motions` — callers don't pass `attachToColumn` for motion (locations have a single motion bucket).

### Common Patterns

- **Auto-attach via `attachToLocationId`** — every generate call (main, variant, motion) accepts an optional location id; when set, the worker appends the result to the right bucket on completion. No manual approval needed for single-candidate paths.
- **Save-before-gen** — `ensureSavedBeforeGen()` creates the location row if it doesn't exist yet so the worker has a target for `attachToLocationId`. Without this, the asset lands in R2 but never appears on the row.
- **Optimistic concurrency** — every studio save passes `expectedUpdatedAt`; on mismatch the server returns 409 and the studio surfaces a "Server changed under you — reload?" reconcile dialog instead of silently overwriting.
- **In-flight placeholders** — each tab tracks pending jobs locally and renders placeholder cards until the worker callback fires.

## Soft-Delete + Archive Gallery

Locations are **soft-deleted** by default. `DELETE /v1/locations/:id` (`client.locations.delete(id)`, `nodaro locations delete <id>`) returns `{ success: true, archived: true }` and sets `deleted_at` on the row instead of destroying it. Soft-deleted locations:

- Are hidden from the default per-project list (`GET /v1/locations?projectId=…`).
- Remain loadable by id via `get()` so canvas nodes holding a stale `locationDbId` keep rendering.
- Can be listed via `GET /v1/locations?archived=true` (CLI: `nodaro locations list --archived`).
- Can be restored via `POST /v1/locations/:id/restore` (CLI: `nodaro locations restore <id>`). If the original name now collides (case-insensitive) with an active row, the server auto-suffixes "(restored)" and returns the effective name.

### Archive Gallery (`/library/locations`)

The standalone **Location Library** page provides two tabs:

- **Active** — all of the caller's non-archived locations with row counts and quick-open links.
- **Archived** — soft-deleted rows with a **Restore** button per row and a destructive **Permanently delete** action.

The permanent-delete flow is **two-step with typed-name confirmation**:

1. Click the trash icon on an archived row — opens a confirmation modal.
2. Type the location's exact name into the input field. The "Permanently delete" button stays disabled until the typed text matches.
3. Confirm — calls `DELETE /v1/locations/:id/permanent`, which destroys the row plus its R2 assets (cleanup-cron reaps the asset URLs).

**Permanent-delete is intentionally NOT exposed on the SDK / CLI / MCP surfaces** — it's reachable only from the `/library/locations` archive view. SDK / CLI `delete()` always soft-deletes; MCP doesn't expose delete or restore at all. The runtime archive gallery is the single user-facing path to permanent destruction.

## MCP / SDK / CLI

### MCP

Six location tools are exposed, gated by scope:

| Tool | Scope | What it does |
|------|-------|--------------|
| `list_locations` | `assets:read` | Summary list (name, main image URL, asset counts, identity copy). Pass `archived: true` for the archive. |
| `get_location` | `assets:read` | Full detail including all six asset arrays + reference photos. |
| `create_location` | `assets:write` | Create a new row with name + optional description / category / style. Returns the new id. |
| `update_location` | `assets:write` | Update identity fields (name / description / category / style / styleLock / canonicalDescription). Optimistic-concurrency via `expectedUpdatedAt`. |
| `approve_main_image` | `assets:write` | Approve a completed `generate_location` candidate as the main image. Fires the LLM caption inline. |
| `recaption_location` | `assets:write` | Re-run the LLM caption against the current main image. |
| `generate_location_motion` | `workflows:execute` | Animate the main image into an atmospheric motion clip via i2v. Hardcoded attach column = `atmosphere_motions`. |

Location candidate + variant-asset generation is exposed separately via the `generate_location` verb tool (kind=`main` / kind=`asset`). `delete_location` and `restore_location` are **intentionally not exposed via MCP** — destructive operations driven by an LLM are dangerous; archive/restore stays REST/SDK/CLI only.

Example — generate an atmospheric motion clip and auto-attach it:

```json
{
  "tool": "generate_location_motion",
  "arguments": {
    "motion_prompt": "slow dolly-in, neon signs flicker, light rain falling",
    "source_image_url": "https://r2.example/locations/tokyo-alley-main.png",
    "provider": "kling",
    "name": "Rainy Tokyo Alley",
    "attach_to_location_id": "9c8a…-uuid",
    "attach_name": "neon dolly-in"
  }
}
```

### SDK

The SDK surface lives on `client.locations`:

```ts
import { createClient } from "@nodaro/sdk"

const client = createClient({ apiKey: process.env.NODARO_API_KEY })

// Create a location, generate one main image, auto-attach on completion.
const { id: locationId } = await client.locations.create({
  nodeId: "node-1",
  name: "Rainy Tokyo Alley",
  description: "Neon-soaked alley with vending machines and wet pavement",
  category: "urban",
  style: "realistic",
})

const { jobId } = await client.locations.generate({
  name: "Rainy Tokyo Alley",
  count: 1,
  attachToLocationId: locationId,
}) as { jobId: string }

// ...poll the job, then approve the main image (for count > 1 paths)
const { sourceImageUrl, canonicalDescription } =
  await client.locations.approveMainImage(locationId, jobId)

// Generate an atmospheric motion clip from the approved main image.
const motion = await client.locations.generateMotion({
  motionPrompt: "slow dolly-in, neon signs flicker, light rain falling",
  sourceImageUrl,
  provider: "kling",
  name: "Rainy Tokyo Alley",
  attachToLocationId: locationId,
  attachName: "neon dolly-in",
  // aspectRatio defaults to "16:9" server-side; override here if needed.
})

// Generate a weather variant.
await client.locations.generateAsset({
  assetType: "weather",
  variant: "storm",
  name: "Rainy Tokyo Alley",
  attachToLocationId: locationId,
  attachToColumn: "weather",
  attachName: "storm",
})

// Soft-delete (archive) — recoverable.
await client.locations.delete(locationId)
await client.locations.restore(locationId)

// List the archive.
const { locations } = await client.locations.list({ archived: true })
```

Full surface: `create` / `update` / `get` / `list` / `delete` (soft) / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`. Permanent-delete is intentionally absent — see the Archive Gallery section above.

### CLI

```bash
# Create a location
nodaro locations create "Rainy Tokyo Alley" \
  --node-id node-1 \
  --description "Neon-soaked alley with vending machines" \
  --category urban --style realistic

# Generate one main image and auto-attach
nodaro locations generate \
  --name "Rainy Tokyo Alley" \
  --count 1 \
  --attach-to-location-id <location-id> \
  --watch

# Generate an atmospheric motion clip
nodaro locations generate-motion \
  --name "Rainy Tokyo Alley" \
  --motion-prompt "slow dolly-in, neon signs flicker, light rain falling" \
  --source-image-url "https://r2.example/locations/tokyo-alley-main.png" \
  --provider kling \
  --attach-to-location-id <location-id> \
  --attach-name "neon dolly-in" \
  --aspect-ratio 16:9 \
  --watch

# Generate a single environmental variant
nodaro locations generate-asset <location-id> \
  --asset-type weather \
  --variant storm

# Approve a candidate as the main image (multi-candidate flow)
nodaro locations approve-main-image <location-id> \
  --candidate-job-id <job-id>

# Re-run the LLM caption against the current main image
nodaro locations recaption <location-id>

# Archive / list archived / restore
nodaro locations delete <location-id>
nodaro locations list --archived
nodaro locations restore <location-id>
```

Pass `--json` to any command for machine-readable output and `--watch` to commands that fire jobs (`generate`, `generate-asset`, `generate-motion`) to poll until completion.

## Inputs & Outputs

**Inputs:**
- `in` — Optional text or image input for additional context (also drives `{locationName}` field mappings).

**Outputs:**
- `locationRef` — Location reference (identity) that can be connected to scene nodes, image generation, image-to-video, and any other node that accepts location references. Carries the canonical description, main image URL, and active style-lock state.
- `image` — The location's establishing shot as a **plain image**. Connect this anywhere a Generate Image output can go (image References, Image-to-Image, Generate Video image input, List columns, etc.). Unlike `locationRef`, it carries no canonical-description / variant injection — it is just the picture.

## Best Practices

- **Generate the main image first.** Everything else (environmental variants, atmospheric motion clips, the canonical description, downstream auto-injection) depends on the approved main image. Style-Lock-on variant gens use it as the i2i source; motion clips animate from it; canonical description is captioned from it.
- **Use multi-candidate (2 or 4) for fantastical or unfamiliar locations.** When the model has no anchor, the first candidate is rarely the right one. Pick the winner from the grid before committing.
- **Let the LLM author the canonical description on approval, then refine.** Manual edits compound on a strong base — the LLM gets the model-friendly vocabulary right (architecture, vegetation, lighting mood, scale) which is hard to hand-write from scratch.
- **Build a 3–6 image mood-board for unfamiliar locations.** Reference Photos are injected into downstream gens whenever the location is referenced — even without a wired edge — so wider context translates directly into more faithful first-pass results.
- **Keep Style Lock ON for consistency within a film.** Turn it OFF only when intentionally generating mash-ups, alternate aesthetics, or A/B variants where you *don't* want the model anchored to the approved look.
- **Curate the asset names.** The variant name (preset or custom) is the tag stored on the asset entry and surfaced to downstream selection. Smarter automatic downstream selection by scene context is a planned follow-up.
- **Generate atmospheric motion clips for any location you'll use as a B-roll source.** A 5-second drift / dolly / fly-over clip is reusable as a `start_frame` reference in i2v nodes and as filler between scenes.
- **Use the same `style` across all locations in a project.** Visual coherence is the whole point of locations.

## Common Use Cases

- Creating consistent backgrounds for multi-scene narratives — establishing shot + variants per scene.
- Generating establishing shots at different times of day for cinematic openers.
- Building weather variations for dynamic storytelling (a storm approaching the same alley, the same cathedral in fog vs golden hour).
- Producing camera-angle variants for coverage of a single location across a sequence.
- Capturing short atmospheric motion clips of a setting for use as i2v references or B-roll between cuts.

## Tips

- Locations are saved to the project database. They persist across sessions and can be reused in multiple workflows within the same project.
- The `locationRef` output carries the canonical description and main image URL, allowing downstream nodes to maintain visual consistency.
- Each time-of-day / weather / seasons / angles / lighting variant is stored as an individual image, so you can reference specific assets directly via the URL.
- Atmosphere motion clips are short videos — a motion clip costs the same as the equivalent image-to-video generation on the chosen provider (e.g. a Kling clip costs the same as a Kling image-to-video). See the [Image to Video](../ai-video/image-to-video.md) node for provider pricing details.
- An approved location with a canonical description is auto-injected as a reference into any downstream image/video node that references it via FieldMappings — even without a wired edge. Suppressible per-node via the Injected References list's × button (see Image / Video config panel docs).
- Close the studio to collapse it back to the compact canvas node — your saved data stays on the node and in the project database.
- Soft-delete is always safe. There's no destroy-on-delete path outside the `/library/locations` typed-name confirmation flow.
