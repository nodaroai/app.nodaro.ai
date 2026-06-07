# Character Platform

Nodaro's **character platform** lets you script every Character Studio
operation through REST, the typed SDK, the CLI, and MCP. A character is a
canonical identity row — name, portrait, identity copy, plus six asset
buckets (`expressions`, `poses`, `motions`, `angles`, `bodyAngles`,
`lightingVariations`) — that downstream generation nodes reference to keep
the same person looking like the same person across an entire production.

This guide explains the data model, the four surfaces, and the canonical
"create → portrait → approve → layer assets" flow.

## When to use which surface

| Surface | Reach for it when… | Lives at |
|---|---|---|
| REST | curl-able, language-agnostic, simplest | `/v1/characters*`, `/v1/generate-character*` |
| SDK (`@nodaro/client`) | Building a typed integration in Node / browser / Bun / Deno | `client.characters.*` |
| CLI (`nodaro` / `@nodaro/cli`) | Terminal scripts, cron, CI, ad-hoc one-shots | `nodaro characters …` |
| MCP | An LLM agent (Claude.ai, Cursor, etc.) is driving the work | `create_character`, `approve_portrait`, etc. |

All four surfaces share the same database row and the same Worker pipeline;
they're four ways to call the same routes.

## The character row

The `characters` table stores one row per character. Highlights:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Stable identifier. |
| `user_id` | uuid | Owner. Every query is scoped by this. |
| `name` | text | Display name; case-insensitively unique per user. |
| `description` | text | Freeform identity notes (height, hair, vibe). |
| `gender` / `style` / `base_outfit` | text | Identity scaffolding for prompts. |
| `source_image_url` | text | The **anchor portrait** — set by `approve-portrait`. |
| `image_provider` | text | MODEL_CATALOG image-model id the main image was generated with (nullable). Set on create (the provider you generated with) + editable via `upsert`; validated server-side — unknown / non-image → `null`. |
| `seed_prompt` | text | Short prompt fragment that scaffolds portrait gen. |
| `canonical_description` | text | LLM-authored ~80–120-word visual description set when the portrait is approved. |
| `expressions` / `poses` / `motions` / `angles` / `body_angles` / `lighting_variations` | jsonb[] | Six asset buckets — each entry is `{ name, url }`. |
| `reference_photos` | jsonb[] | Real-life reference photos, one per kind (`frontFace`, `sideLeft`, …). |
| `real_life_refs_by_variant` | jsonb | Per-variant reference URL arrays (e.g. `{ smile: [url1, url2] }`). |
| `reference_videos_by_variant` | jsonb | Per-label user-uploaded reference VIDEO URL arrays (e.g. `{ angry: [url1] }`). Mirrors `real_life_refs_by_variant` for clips; read off the row to drive generate-video's `referenceVideoUrls`. Max 20 keys, 5 URLs each. |
| `voice` / `personality` | jsonb | Optional voice + personality blocks for audio nodes. |
| `deleted_at` | timestamptz | Non-null = soft-deleted (archived). |
| `created_at` / `updated_at` | timestamptz | Timestamps. |

Soft delete is the only delete the public surface exposes. The studio archive
view + REST `/restore` route bring a row back; permanent destruction is
UI-only by design.

## Asset arrays explained

Six bucket columns hold the variants of a character's anchor portrait. Each
entry is `{ name, url }`:

| Bucket | What it represents | Example variant names |
|---|---|---|
| `expressions` | Same head-and-shoulders framing, different emotion | `smile`, `angry`, `surprised`, `laughing` |
| `poses` | Full-body framing with a posture change | `standing`, `walking`, `sitting`, `running` |
| `angles` | Head-and-shoulders portrait at different camera angles | `front`, `3/4 left`, `left profile`, `right profile`, `3/4 right`, `back` |
| `bodyAngles` | Full-body at different angles, standing naturally with arms relaxed at sides | Same set as `angles`. |
| `lightingVariations` | Same pose, different lighting | `daylight`, `night`, `dramatic` |
| `motions` | Video clips animating the character (i2v) | `walking`, `head turn`, `wave` |

Each variant is generated independently via `POST /v1/generate-character-asset`
(or `POST /v1/generate-character-motion` for `motions`). The result is
appended to the named bucket on completion when `attachToCharacterId` +
`attachToColumn` + `attachName` are supplied.

### Motion source-frame resolution

`POST /v1/generate-character-motion` auto-resolves the i2v source frame
from the character row when `attachToCharacterId` is set. Priority:

1. Caller-provided `sourceImageUrl` (explicit override — always wins).
2. The `front` entry in `body_angles` (full-body framing produces much
   better motion than a portrait headshot crop).
3. Any other entry in `body_angles` (most recently saved).
4. The anchor portrait (`source_image_url` on the row) — legacy fallback.

To get the best motion clips, generate a `front` body angle first via
`POST /v1/generate-character-asset` with `assetType: "bodyAngles"`,
`variant: "front"`, `attachToColumn: "body_angles"`. The Character Studio
UI does this automatically before kicking off a motion generation when
no body angle exists yet.

## `realLifeRefsByVariant` shape

Some variants get a richer treatment by attaching real-life reference photos
that the provider can use as additional conditioning (e.g. a real laughing
face for the `smile` expression). The column is a JSONB map:

```jsonc
{
  "smile":   ["https://r2/.../laugh-ref-1.jpg", "https://r2/.../laugh-ref-2.jpg"],
  "walking": ["https://r2/.../walk-ref.jpg"]
}
```

Caps:

- max 20 keys
- max 5 URLs per key
- keys are lowercased + trimmed server-side (so `"  Smile "` and `"SMILE"`
  both write to `"smile"`)

Pass the map via `realLifeRefsByVariant` on the upsert body. When the worker
runs `generate-character-asset` for a specific `variant`, it picks up the
matching key's URL list automatically.

## The portrait approval flow

Generating a portrait is a three-step pipeline:

1. **Generate** — `POST /v1/generate-character` produces 1–10 candidate
   jobs (API accepts 1–10; common UI presets are 1, 2, or 4). With
   `attachToCharacterId` set, the worker writes the result to
   `source_image_url` for the FIRST job to complete (auto-approve for
   single-candidate runs).
2. **Approve** — for multi-candidate runs, `POST /v1/characters/:id/approve-portrait`
   with the chosen `candidateJobId` sets `source_image_url` AND fires an LLM
   caption (Claude Sonnet vision) inline to populate `canonical_description`.
3. **Caption** — if the caption sub-failed during approval, retry via
   `POST /v1/characters/:id/llm-caption`. Both routes are idempotent and safe
   to re-run.

`canonical_description` is what downstream prompts inject when they reference
this character ("Kira is a 25-year-old protagonist with auburn hair and
green eyes..."). Without it, identity drift between scenes is much more
likely.

## Using character assets as references

After the assets are populated, downstream generation calls reference the
URLs directly. Two patterns:

**Pattern A — explicit reference URLs.** Most generation nodes accept
`reference_images` (or `referenceImages` in the SDK). Pass any combination
of asset URLs to anchor the new image to the character:

```ts
const character = await client.characters.get(characterId)
const smileUrl = character.expressions?.find(e => e.name === "smile")?.url

await client.nodes.run("generate-image", {
  prompt: "Kira at a rooftop bar, golden hour",
  reference_images: [smileUrl].filter(Boolean),
})
```

**Pattern B — `@-mentions` in editor prompts.** Inside Character Studio + the
canvas, prompt fields support `{Kira}` interpolation that resolves at
execution time to the character's anchor portrait, with the active variant
swapped in based on the field-mapping rules.

For programmatic flows, prefer Pattern A — explicit URLs are easier to
reason about and don't depend on the canvas wiring.

## Injected references list (canvas editor)

Every consumer node config panel — generate-image, image-to-image,
modify-image, generate-video, video-to-video, lip-sync,
face-swap, motion-transfer, speech-to-video — surfaces a unified
**Injected References** list that mirrors exactly what the API will receive,
including:

- Wired upstream image refs (uploads, generated images, scene nodes, …).
- Wired Character node **canonicals** — auto-attached when the character
  is wired but not `@-mentioned` (pre-mention-feature behavior).
- `@-mention` resolved **variants** — when the prompt contains
  `@kira:1:smile`, kira's smile variant URL is in the list with a thumbnail
  + character / variant name annotation.
- Canonical **fallback** entries for any wired character the user hasn't
  `@-mentioned`. Dedup'd against `@-mentions`: if the user mentions
  `@kira:1:smile`, kira's canonical fallback is suppressed (mention wins).

Drag-to-reorder writes a `referenceOrder` array (stable tile IDs) on the
node data. The reorder is honored by both the orchestrator and single-node
"Run" execution paths via the shared `buildImagePrompt({referenceOrder})`
parameter in `@nodaro/shared`. URL positions are renumbered consistently:
every `Image N` token in the assembled prompt (directives + user-typed
`{image:N:label}` markers) is rewritten to match the new position, so
directive bullets and the worker's `referenceImageUrls` index stay in
lock-step.

The × button on each tile dispatches by origin:
- **Wired tile** → deletes the upstream edge.
- **Mention tile** → strips the `@kira:1:smile` token from the prompt.
- **Canonical fallback tile** → adds the character slug to
  `suppressedCanonicalCharacterIds`, hiding the auto-attached canonical
  for this consumer (the `@-mentioned` variants for the same character
  still attach).

This is a frontend-only convenience for canvas users — programmatic
flows control the reference list via the direct `reference_images` field
(Pattern A above).

## Mention usage modes

When you `@-mention` a character (e.g. `@kira:1:smile`), an optional 4th slug
segment chooses HOW the model should consume the reference image. The mode
also defaults from the character node's small "Default usage mode" dropdown,
so casual prompts (`@kira:1:smile` with no mode) inherit a sensible default.

| Mode | Slug suffix | What it does | Sample bullet |
|------|-------------|--------------|---------------|
| Identical (default) | `:identical` | Lock to the character's full identity. | `- Image 1 (Kira) — <canonical desc>. The subject must remain exactly the same person…` |
| Face only | `:face` | Borrow face + expression, adopt clothing / hair / posture from the prompt. | `- Image 1 (Kira). Take ONLY the facial features…` |
| Face + Pose | `:face-pose` | Face + body pose, prompt drives the rest. | `- Image 1 (Kira) — <canonical desc>. Take the facial features AND body pose…` |
| Pose only | `:pose` | Body posture only — face/hair/clothing from prompt. | `- Image 1 (Kira). Take only the body pose and posture…` |
| Emotion only | `:emotion` | Transfer the emotional cue, preserve identity. | `- Image 1 (Kira). Take only the emotional expression…` |
| Style only | `:style` | Lighting / color / tone — not the subject. | `- Image 1 (Kira). Take only the visual style and tone…` |
| Name only | `:name` | Label the slot with the character name, NO directive. Tells the model who the character is so it can correlate the image with a named entity, without prescribing how to use it. | `- Image 1 (Kira)` |
| None | `:none` | Attach the image silently. NO bullet, NO name in any label, and NO entry under the "Use these characters:" header for this mention. The mention text is replaced inline with the bare positional reference (`Image 1`) so the user's sentence still parses. Intent: "let the visual speak for itself; don't bias the model with text". If every mention of a character is `:none`, that character is invisible textually — only the image is attached. | _(no bullet emitted)_ |

**Worked example — mixed `:none` + `:face` on the same character:**

User prompt:
```
show @shira:1:none with @shira:2:face mode
```

Assembled prompt:
```
Use these characters:
- Image 2 (shira). Take ONLY the facial features and expression…

show Image 1 with shira mode
```

The first mention attaches the image silently (no bullet, inline replacement
is `Image 1`). The second mention emits the `face`-only directive bullet for
position 2. The `Use these characters:` header is present because at least
one mention contributed a bullet.

## Quickstart by surface

### REST

```bash
TOKEN="ndr_..."
BASE="https://nodaro.example.com"

# Create
CHAR=$(curl -s -X POST "$BASE/v1/characters" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"scripted","name":"Kira","seedPrompt":"kira portrait, warm natural lighting"}' \
  | jq -r .id)

# Generate one portrait (auto-attaches)
curl -s -X POST "$BASE/v1/generate-character" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Kira\",\"seedPrompt\":\"kira portrait, warm natural lighting\",\"count\":1,\"attachToCharacterId\":\"$CHAR\"}"

# (after job completes) Re-fetch the row
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/characters/$CHAR" | jq .sourceImageUrl
```

### SDK

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const { id } = await client.characters.create({
  nodeId: "scripted",
  name: "Kira",
  seedPrompt: "kira portrait, warm natural lighting",
})

const { jobId } = await client.characters.generate({
  name: "Kira",
  seedPrompt: "kira portrait, warm natural lighting",
  count: 1,
  attachToCharacterId: id,
})

// Poll the job; the worker auto-attaches the result on completion.
```

### CLI

```bash
nodaro characters create --name "Kira" --seed-prompt "kira portrait, warm natural lighting"
# → ✓ created character <UUID> (Kira)

nodaro characters generate <UUID> --count 1 --seed-prompt "kira portrait, warm natural lighting" --watch
# (auto-attaches on completion)

nodaro characters get <UUID>
# (full JSON dump)
```

### MCP

```jsonc
create_character({
  name: "Kira",
  description: "young protagonist with auburn hair",
  style: "realistic",
  seed_prompt: "kira portrait, warm natural lighting"
})
// → { id: "kira-uuid", name: "Kira" }

generate_character({
  kind: "main",
  name: "Kira"
})
// → { content: [text], structuredContent: { jobId: "job-1" } }

approve_portrait({
  character_id: "kira-uuid",
  candidate_job_id: "job-1"
})
// → { portraitUrl, canonicalDescription }
```

### Generating character assets via MCP

Once a character has an approved portrait, use the same
**`generate_character`** tool with `kind: "asset"` to add expression /
head-angle / body-angle / pose / lighting variants. Each asset
auto-attaches to the matching bucket on completion when
`attach_to_character_id` is set. Animated clips have a dedicated tool
(`generate_character_motion`) — they dispatch to a different route with
a motion-specific input shape.

```jsonc
// Add a smile expression
generate_character({
  kind: "asset",
  name: "Kira",
  asset_type: "expressions",
  variant: "smile",
  attach_to_character_id: "kira-uuid"
})

// Add a head-angle for cross-shot framing
generate_character({
  kind: "asset",
  name: "Kira",
  asset_type: "headAngles",
  variant: "3/4 left",
  attach_to_character_id: "kira-uuid"
})

// Add a full-body back angle
generate_character({
  kind: "asset",
  name: "Kira",
  asset_type: "bodyAngles",
  variant: "back",
  attach_to_character_id: "kira-uuid"
})

// Freeform custom asset (requires attach_to_column)
generate_character({
  kind: "asset",
  name: "Kira",
  asset_type: "custom",
  variant: "noir",
  attach_to_character_id: "kira-uuid",
  attach_to_column: "lighting_variations",
  attach_name: "Noir"
})

// Animated clip — different tool
generate_character_motion({
  motion_prompt: "slow head turn left, soft smile",
  name: "Kira",
  attach_to_character_id: "kira-uuid",
  attach_name: "head turn"
})
```

Variant names for canonical asset types:

| Asset type | Preset variants |
|-----------|-----------------|
| `expressions` | neutral, smile, angry, surprised, sad, talking, laughing, disgusted, fearful, smirk, crying |
| `headAngles` / `angles` | front, 3/4 left, left profile, right profile, 3/4 right |
| `bodyAngles` | front, 3/4 left, left profile, right profile, 3/4 right, back |
| `poses` | standing, walking, sitting, running, crouching, pointing, fighting stance, jumping, turning |
| `lighting` | daylight, night, dramatic |
| `custom` | any short label — pair with `attach_to_column` when attaching to a character row |

See [docs/mcp/tools.md](mcp/tools.md#generate_character) for the full
parameter reference.

## Identity-foundation fields (advanced)

For high-fidelity character work, three fields work together to anchor
identity across many generations:

- **`seedPrompt`** — short scaffold (typically 1-2 sentences) that frames the
  portrait. Should evoke camera/lighting/mood ("kira portrait, warm natural
  lighting, intimate framing").
- **`referencePhotos`** — up to 20 real-life-photo URLs tagged with their
  framing (`frontFace`, `sideLeft`, `sideRight`, `threeQuarterLeft`,
  `threeQuarterRight`, `frontBody`, `other`). Each non-`other` kind may
  appear at most once. These drive the i2v / i2i path when a provider
  supports multi-image conditioning.
- **`realLifeRefsByVariant`** — per-variant reference URL arrays (see
  [shape above](#reallifereferbyvariant-shape)). Lets you pin specific
  variants to specific real photos.
- **`referenceVideosByVariant`** — per-label user-uploaded reference VIDEO URL
  arrays (e.g. emotion takes: `{ angry: [url], happy: [url1, url2] }`). Same
  per-label map + caps (20 keys, 5 URLs each) and key-normalization as
  `realLifeRefsByVariant`. Persistence only — read the chosen URLs off the row
  and pass them to a Generate Video node's `referenceVideoUrls` input.

For everyday use, you can leave these empty and let the LLM caption do the
work via `canonicalDescription`. For production-grade character consistency,
populate them up-front via `upsert()` / `update()`.

## Soft delete + archive

`DELETE /v1/characters/:id` sets `deleted_at` rather than dropping the row.
The character disappears from `list()` by default but remains loadable via
`get(id)` so canvas nodes pointing at it keep rendering.

To see archived rows: `list({ archived: true })` (REST: `?archived=true`).
To un-archive: `POST /v1/characters/:id/restore`. If the name now collides
with another active row, the server auto-suffixes `"(restored)"`.

| Surface | Delete (archive) | Restore |
|---|---|---|
| REST | `DELETE /v1/characters/:id` | `POST /v1/characters/:id/restore` |
| SDK | `client.characters.delete(id)` | `client.characters.restore(id)` |
| CLI | `nodaro characters delete <id>` | `nodaro characters restore <id>` |
| MCP | **Not exposed** (LLM-driven destruction is unsafe) | **Not exposed** |

Permanent deletion is intentionally NOT exposed through any programmatic
surface. The archive view in the editor (`/library/characters`) is the only
place a user can permanently destroy a character row. REST / SDK / CLI
delete calls are always soft; the MCP surface intentionally omits delete
and restore entirely so an LLM cannot trigger them.

## Pricing notes

Character generation is metered through the same credit pipeline as other
generation routes:

- `POST /v1/generate-character` — `creditCost(provider) × count` credits,
  reserved for ALL jobs up-front before any is enqueued. Mid-batch
  reservation failures roll back atomically.
- `POST /v1/generate-character-asset` — `creditCost(provider)` credits per
  variant.
- `POST /v1/generate-character-motion` — `creditCost(provider)` credits per
  motion clip. Provider defaults to `kling` (~28 credits / 5-second clip).
- `POST /v1/characters/:id/approve-portrait` — currently free; the LLM
  caption is uncharged. (See the route's TODO comment in
  `backend/src/routes/character-portrait-approval.ts` for the pending 1-CR
  caption charge.)
- `POST /v1/characters/:id/llm-caption` — currently free; same TODO as above.

`creditCost` is fetched from the `model_pricing` table at runtime. See the
[Architecture](./architecture.md) doc for the full credit-flow walkthrough.

## See also

- [Location Platform](./location-platform.md) — the same surfaces, for locations
- [API Integration](./api-integration.md) — direct REST patterns
- [SDK Quickstart](./sdk-quickstart.md) — typed client walkthrough
- [SDK Reference](./sdk-reference.md) — every `client.characters.*` method
- [MCP Tools](./mcp/tools.md) — every character MCP tool
- [CLI](./cli.md) — `nodaro characters …` subcommands
