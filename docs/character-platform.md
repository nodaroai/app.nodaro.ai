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
| `seed_prompt` | text | Short prompt fragment that scaffolds portrait gen. |
| `canonical_description` | text | LLM-authored ~80–120-word visual description set when the portrait is approved. |
| `expressions` / `poses` / `motions` / `angles` / `body_angles` / `lighting_variations` | jsonb[] | Six asset buckets — each entry is `{ name, url }`. |
| `reference_photos` | jsonb[] | Real-life reference photos, one per kind (`frontFace`, `sideLeft`, …). |
| `real_life_refs_by_variant` | jsonb | Per-variant reference URL arrays (e.g. `{ smile: [url1, url2] }`). |
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
| `bodyAngles` | Full-body at different angles, neutral T-pose | Same set as `angles`. |
| `lightingVariations` | Same pose, different lighting | `daylight`, `night`, `dramatic` |
| `motions` | Video clips animating the portrait | `walking`, `head turn`, `wave` |

Each variant is generated independently via `POST /v1/generate-character-asset`
(or `POST /v1/generate-character-motion` for `motions`). The result is
appended to the named bucket on completion when `attachToCharacterId` +
`attachToColumn` + `attachName` are supplied.

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

1. **Generate** — `POST /v1/generate-character` produces 1, 2, or 4 candidate
   jobs. With `attachToCharacterId` set, the worker writes the result to
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
  motion clip. Provider defaults to `kling` (~22 credits / 5-second clip).
- `POST /v1/characters/:id/approve-portrait` — currently free; the LLM
  caption is uncharged. (See the route's TODO comment in
  `backend/src/routes/character-portrait-approval.ts` for the pending 1-CR
  caption charge.)
- `POST /v1/characters/:id/llm-caption` — currently free; same TODO as above.

`creditCost` is fetched from the `model_pricing` table at runtime. See the
[Architecture](./architecture.md) doc for the full credit-flow walkthrough.

## See also

- [API Integration](./api-integration.md) — direct REST patterns
- [SDK Quickstart](./sdk-quickstart.md) — typed client walkthrough
- [SDK Reference](./sdk-reference.md) — every `client.characters.*` method
- [MCP Tools](./mcp/tools.md) — every character MCP tool
- [CLI](./cli.md) — `nodaro characters …` subcommands
