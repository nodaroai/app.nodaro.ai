# Skill Architecture — Design

**Status:** Draft v1
**Target:** Phase 1+ of the Nodaro skill ecosystem
**Last Updated:** 2026-05-18

**Related specs:**
- `nodaro-film-director-skill.md` (Draft v3) — current Film Director skill spec; this design refactors its delivery
- `2026-05-14-nodaro-film-director-implementation-plan.md` — Phase 0 plan that produced v1.0.1 → v1.0.9
- Layer 1/2/3 context [reference removed].

---

## 1. Vision

Decompose monolithic skill content (current Film Director `SKILL.md` is ~550 lines, mostly embedded node-shape reference and workflow-editing basics) into a **runtime-fetched, codebase-derived, drift-proof** skill system. Three coupled components:

- **G3 — per-node skill loader**: `get_node_skill(node_type)` MCP tool returns per-node markdown on demand
- **G4 — workflow-editing skill**: `start_workflow_editor` MCP tool returns general workflow JSON/edges/handles teaching content
- **G5 — auto-gen pipeline**: derives the per-node + workflow-editor content from the codebase, gated by CI

End state: any future workflow-building skill (Film Director v2.0, future Music Video Director, Story-to-Video pipeline) is a thin orchestrator that calls `start_workflow_editor` once + `get_node_skill(<type>)` on demand. Skill content tracks the codebase automatically.

## 2. Architecture overview

```
backend/
├── skills/                          # NEW — must be whitelisted in .dockerignore (root rule excludes *.md)
│   ├── workflow-editor.md           # G4 content (single hand-written + auto-gen blocks)
│   └── nodes/
│       ├── generate-image.md        # G3 per-node content (one file per node type)
│       ├── image-to-video.md
│       ├── generate-music.md
│       ├── ... (one per node type in NODE_DEFINITIONS — ~60 files at full coverage)
│       └── _README.md               # human-facing index, not consumed by tools
└── scripts/
    └── gen-skills.ts                # G5 auto-gen pipeline (uses ts-morph on frontend/src/types/nodes.ts)

backend/src/lib/mcp/tools/
├── skill-loaders.ts                 # NEW: get_node_skill + start_workflow_editor registrations
└── film-director.ts                 # REFACTORED v2.0 (thin orchestrator)

frontend/src/types/nodes.ts          # NO MOVE — gen-skills reads it directly via ts-morph
```

## 3. Three MCP tools

All three are **read-only, no scope gate, idempotent** — same posture as the existing `start_film_director`.

| Tool | Returns | Activation description (key phrases) |
|------|---------|--------------------------------------|
| `start_workflow_editor` | `backend/skills/workflow-editor.md` content | "Call FIRST when building or editing any Nodaro workflow. Returns the JSON shape contract, edge/handle conventions, update_workflow_json call patterns, and the catalog of node types you can request skills for via get_node_skill." |
| `get_node_skill(node_type)` | `backend/skills/nodes/<node_type>.md` content | "Returns the full skill content for a specific Nodaro node type: data shape required by update_workflow_json, default values, handle ids, result fields, MCP call shape (if the node has a matching generation tool), when-to-use guidance, common gotchas. Pass the exact `node_type` string from the catalog returned by start_workflow_editor." |
| `start_film_director` (existing) | v2.0 thin SKILL.md | (unchanged description — keeps "REQUIRED FIRST STEP for any cinematic video request" framing) |

### Tool input/output details

#### `start_workflow_editor`
```ts
inputSchema: {}  // no parameters
output: { content: [{ type: "text", text: <workflow-editor.md content> }] }
```

#### `get_node_skill`
```ts
inputSchema: { node_type: z.string().min(1).max(64) }
output: {
  // Success
  content: [{ type: "text", text: <nodes/<node_type>.md content> }]
  // OR unknown type
  isError: true,
  content: [{ type: "text", text: "Unknown node_type '<x>'. Valid types: <list from start_workflow_editor's catalog>" }]
}
```

The error path gives Claude self-correction info — it lists valid types if the requested type doesn't exist.

## 4. Content file format

### 4.1 Per-node file (`backend/skills/nodes/<type>.md`)

Marker-delimited auto-gen blocks coexist with hand-written prose:

```markdown
---
node_type: generate-image
generated_at: 2026-05-18T10:00:00Z
generated_from: <git-commit-sha>
---

# Generate Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-image`
**Category:** ai
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields** (from `GenerateImageData`):
- `label: string`
- `prompt: string`
- `provider: ImageProvider` — enum: `"flux" | "flux-flex" | "flux-kontext" | ... | "nano-banana-pro" | ...`
- `model: string`
- `style: string`
- `aspectRatio: string`
- `negativePrompt: string`
- `fieldMappings: Record<string, string>` (use `{}` if no input wiring)

**Optional data fields:**
- `resolution?: string`
- `quality?: string`
- `seed?: number`
- `referenceImageUrl?: string`
- ...

**Result fields (REQUIRED to render generated content on the canvas):**
- `executionStatus: "completed"` (literal string)
- `generatedImageUrl: string` — the URL from the generation response
- `currentJobId?: string`
- `generatedResults?: GeneratedResult[]` — array form; frontend reads this first, falls back to `generatedImageUrl`

**Default data** (from NODE_DEFINITIONS):
```json
{ "label": "Generate Image", "prompt": "", "provider": "nano-banana-pro", "model": "gemini-2.5-flash-image", "style": "", "aspectRatio": "16:9", "negativePrompt": "", "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_image`

**Input parameters** (from Zod schema):
- `prompt: string`
- `provider?: string` — defaults to `"nano-banana-pro"`
- `aspectRatio?: string` — defaults to `"16:9"`
- `referenceImageUrl?: string`
- ...

**Returns:** `{ jobId, status, result?: { url, ... } }` — `result.url` is the asset URL.
<!-- AUTO-GEN:END mcp-call -->

## When to use

Use for any text-to-image generation in a workflow. For trailers / cinematic flows, embed character + location descriptions directly in the prompt rather than pre-generating separate refs.

## Common gotchas

- The `provider` enum is large (~15 options) and varies by capability — see the auto-gen list above for the canonical set.
- `executionStatus: "completed"` is REQUIRED for the image to render after attaching the node via `update_workflow_json`. Without it, the canvas shows an empty placeholder.
- Field name is `generatedImageUrl` — NOT `imageUrl`, `outputUrl`, or `result.url`.
- For 4K output, only `nano-banana-pro` supports it currently.

<!-- AUTO-GEN:START examples -->
## Worked example

When attaching a generate-image node to a workflow after a successful tool call:

```json
{
  "id": "scene-1",
  "type": "generate-image",
  "position": { "x": 0, "y": 0 },
  "data": {
    "label": "Scene 1 — The Briefing",
    "prompt": "<the exact prompt you sent to generate_image>",
    "provider": "nano-banana-pro",
    "model": "gemini-2.5-flash-image",
    "style": "",
    "aspectRatio": "16:9",
    "negativePrompt": "",
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedImageUrl": "<URL from generate_image response>",
    "currentJobId": "<jobId from response>"
  }
}
```
<!-- AUTO-GEN:END examples -->
```

### 4.2 Workflow-editor file (`backend/skills/workflow-editor.md`)

Single hand-written file with optional auto-gen blocks. Structure:

```markdown
---
generated_at: 2026-05-18T10:00:00Z
generated_from: <git-commit-sha>
---

# Nodaro Workflow Editor — General Patterns

## Workflow JSON shape

```json
{
  "nodes": [ { "id": "...", "type": "...", "position": {...}, "data": {...} } ],
  "edges": [ { "id": "...", "source": "...", "sourceHandle": "...", "target": "...", "targetHandle": "..." } ],
  "settings": { ... }
}
```

## Edge wiring conventions

Source handle ids per node type are listed in each node's skill (see catalog below). Common patterns:
- `generate-image` outputs on handle `"image"`
- `text-prompt` outputs on handle `"text"`
- `loop` (Table) outputs on per-column handles named `col_<column_id>`
- ...

## update_workflow_json contract

(general guidance on calling the tool, error handling, etc.)

<!-- AUTO-GEN:START node-catalog -->
## Available node types

Call `get_node_skill(node_type)` to get full schema for any of:

- `generate-image` — Text-to-image generation
- `image-to-video` — Image-to-video animation
- `generate-music` — Music generation (Suno)
- `text-prompt` — Text display / script node
- `loop` — Multi-column table (UI label "Table")
- `list` — Single-column list
- `combine-videos` — Stitch multiple videos
- `merge-video-audio` — Final mix
- `trim-video` — Cut decisions
- ... (auto-generated list of all node types with skill files)
<!-- AUTO-GEN:END node-catalog -->

## Common gotchas

- Node types are kebab-case (e.g., `generate-image`, NOT `generateImage` or `GenerateImage`).
- ...
```

### 4.3 Frontmatter convention

Every generated or partially-generated file carries:
```yaml
---
node_type: <type>            # only on per-node files
generated_at: <ISO timestamp>
generated_from: <git SHA>    # short-hash of HEAD at gen time
---
```

`generated_at` updates whenever G5 rewrites any AUTO-GEN block. Useful for debugging staleness and PR-review traceability.

## 5. G5 auto-gen pipeline

### 5.1 Inputs

| Source | Read by | Used for |
|--------|---------|----------|
| `frontend/src/types/nodes.ts` | ts-morph AST parse | NODE_DEFINITIONS array literal — type, label, inputs/outputs/defaultData. `*Data` TypeScript interfaces — full field list with optionality + types. |
| MCP tool registrations under `backend/src/lib/mcp/tools/` | runtime introspection | MCP tool schemas (Zod-validated input shapes) — exact file layout discovered at run time |

**Why two methods:**
- **ts-morph for node definitions** — `nodes.ts` is 6050 lines, 66 interface declarations, and imports frontend-only modules (`@/lib/reference-photo-routing`, `IMAGE_STYLE_PRESETS`). Trying to `import()` it at runtime would require either bundling the frontend deps or shimming them. AST parsing sidesteps both — the gen-skills script is build-time only, so the cost of a TypeScript compile pass is acceptable. Also gives access to TS interface types (which don't exist at runtime).
- **Runtime introspection for MCP tools** — the MCP server already registers tools via `server.registerTool(name, config, handler)`. A wrapper around `buildMcpServer` collects the `{ name, inputSchema }` pairs as they're registered, with no separate AST pass.

### 5.2 Pipeline

```
npm run gen:skills (local)        →  rewrites AUTO-GEN blocks in-place + updates frontmatter
npm run gen:skills:check (CI)     →  runs gen, then `git diff --exit-code` — fails if changes weren't committed
```

The script:
1. Parses `frontend/src/types/nodes.ts` with ts-morph — extracts NODE_DEFINITIONS entries (each a literal object with `type`, `label`, `category`, `inputs`, `outputs`, `defaultData`) and the matching `*Data` interface declarations
2. Spawns a minimal MCP-tool-loader (re-uses `buildMcpServer` from `backend/src/lib/mcp/server.ts` in a "capture only" mode) — a wrapper around `server.registerTool` records each `{ name, inputSchema }` into a process-level map. The gen-skills script reads that map after server setup completes.
3. For each node type in NODE_DEFINITIONS:
   a. Read existing `backend/skills/nodes/<type>.md` if present
   b. Compute new AUTO-GEN block contents from sources
   c. Replace inside markers; preserve prose between markers
   d. Update frontmatter `generated_at` and `generated_from`
   e. Write back (if changed)
4. For workflow-editor.md:
   a. Compute the auto-gen catalog of all node types
   b. Rewrite the `<!-- AUTO-GEN:START node-catalog -->` block

### 5.3 New-node onboarding

When a developer adds a new node type to NODE_DEFINITIONS:
1. Run `npm run gen:skills` → creates `backend/skills/nodes/<new-type>.md` with auto-gen blocks but empty prose sections (`## When to use` blank, `## Common gotchas` blank).
2. Developer adds prose between the auto-gen markers if the node has nontrivial usage patterns. Optional for v1 — auto-gen content alone is usable.
3. CI passes once `gen:skills:check` succeeds.

### 5.4 Drift gate

CI step in `.github/workflows/test.yml` (or similar):

```yaml
- name: Verify skill content is up to date
  run: |
    cd backend && npm run gen:skills:check
```

`gen:skills:check` runs `gen:skills` then `git diff --exit-code backend/skills/`. Non-zero exit if any file changed → CI fails with message "Run `npm run gen:skills` and commit the changes".

This is the same pattern as the existing `film-director.test.ts` drift gate test for FALLBACK_SKILL_CONTENT.

## 6. Film Director v2.0 migration

### 6.1 What changes in SKILL.md

| Section | v1.0.9 (current) | v2.0 |
|---------|------------------|------|
| Operating principles | 8 principles, includes node-shape guidance | 8 principles, NO node-shape detail |
| Stage 0 — Initialize | calls `create_workflow` | calls `start_workflow_editor`, then `create_workflow` |
| Stage 1 onwards | references inline node-shape examples | references `get_node_skill(<type>)` for each node type needed |
| Node shapes reference (~250 lines) | embedded section | **REMOVED** — Claude fetches via `get_node_skill` on demand |
| Workflow JSON shape / edge wiring | embedded | **REMOVED** — fetched via `start_workflow_editor` |
| "What you do NOT do" | includes shape-guessing warnings | trimmed; shape-correctness now enforced by per-node skill content |
| FALLBACK_SKILL_CONTENT in film-director.ts | full SKILL.md embedded | proportionally smaller (~36% of original) — regenerated by drift-gate script |

Estimated SKILL.md line count: 550 → ~200.

### 6.2 New Stage 0 content (sketch)

```markdown
## Stage 0 — Initialize the live workspace

### Step 0.0: Load the workflow editor skill

Before any other action, call `start_workflow_editor` to receive the canonical workflow JSON shape, edge wiring conventions, and catalog of available node types. Reference its content for all downstream JSON construction.

### Step 0.1: Per-node skills on demand

When you reach a stage that uses a specific node type, call `get_node_skill(<type>)` for its full schema and usage guidance. The first time you use each of these in the trailer flow:
- `text-prompt` (Stage 1, script display)
- `loop` (Stage 2, shot list)
- `generate-image` (Stage 5, scene composition)
- `image-to-video` (Stage 6, animation)
- `generate-music` (Stage 7, soundtrack)
- `trim-video`, `combine-videos`, `merge-video-audio` (Stage 8, assembly)

Subsequent calls to the same node type can reference what you've already loaded — don't re-fetch.

### Step 0.2: Create the workflow

Call `create_workflow({ name: "<title>" })` and share the editor URL with the user.
```

### 6.3 Migration risk

- **Skill is stateless per invocation** — no in-flight session needs migration. Each Claude conversation starts fresh.
- **MCP cache** — Claude clients fetch the MCP tool list on connection; new tools (`start_workflow_editor`, `get_node_skill`) appear after the next session start. No special migration.
- **Drift gate** — v2.0's smaller FALLBACK_SKILL_CONTENT is regenerated by the existing drift-gate logic; no test changes beyond updating snapshots.

## 7. Implementation phases

Three PRs, sequential.

### Phase A — G3 + G4 infrastructure (~1-2 days)

**Prerequisite:** None. ts-morph parses `frontend/src/types/nodes.ts` directly from the gen-skills script — no cross-package refactor needed. Verified during spec self-review that `nodes.ts` is 6050 lines with 66 interfaces and frontend-only imports; moving it would cascade into multiple files. Keeping the parse-source-directly approach matches the audit's "no artificial coupling" principle.

**Deliverables:**
- `backend/skills/workflow-editor.md` — hand-written, includes `<!-- AUTO-GEN:START node-catalog -->` block (empty for now — Phase B fills it)
- `backend/skills/nodes/<type>.md` for the current 8-node whitelist (text-prompt, loop, generate-image, image-to-video, generate-music, trim-video, combine-videos, merge-video-audio) — hand-written with auto-gen markers in place
- `backend/src/lib/mcp/tools/skill-loaders.ts` — registers both MCP tools
- `backend/src/lib/mcp/tools/__tests__/skill-loaders.test.ts` — 4-6 tests:
  - `start_workflow_editor` returns content
  - `get_node_skill('generate-image')` returns content
  - `get_node_skill('unknown-type')` returns error with valid-types list
  - File-read happens at request time (no startup cache for v1)
- Update Dockerfile to ensure `backend/skills/` is copied
- Embedded fallback for `start_workflow_editor` only (single file, ~50 lines)

### Phase B — G5 auto-gen pipeline (~2-3 days)

**Deliverables:**
- `backend/scripts/gen-skills.ts` — the pipeline
- `package.json` adds `gen:skills` and `gen:skills:check` npm scripts
- `.github/workflows/test.yml` (or equivalent CI config) adds the drift-gate step
- Re-run gen on the 8 Phase A files — validate round-trip preserves prose
- Expand coverage: run gen on ALL nodes in NODE_DEFINITIONS (~60). Files start as auto-gen-only; prose sections empty.
- Snapshot tests on `gen-skills.ts` output for 5-10 representative node types
- Tests for the marker-preservation logic (in: file with prose; out: file with regenerated auto-gen blocks + same prose)

### Phase C — Film Director v2.0 refactor (~1 day)

**Deliverables:**
- Strip ~350 lines from SKILL.md (node-shape reference + workflow-editing basics)
- Add Step 0.0 and Step 0.1 per §6.2
- Update CHANGELOG.md with v2.0 entry
- Sync FALLBACK_SKILL_CONTENT (smaller now)
- Update existing `film-director.test.ts` snapshots
- E2E manual test with a trailer prompt — confirms Claude correctly fetches and uses the new tools

**Total:** ~4-6 days of focused work, three independent PRs.

## 8. Testing approach

| Component | Tests |
|-----------|-------|
| G3 `get_node_skill` | Returns content for known types; error for unknown; error message includes valid-types list. Drift-gate covers content correctness. |
| G4 `start_workflow_editor` | Returns content; activation description includes key phrases (`workflow`, `edit`, `JSON`, `update_workflow_json`); embedded fallback matches on-disk file byte-for-byte (same pattern as film-director.ts). |
| G5 gen-skills | Unit tests on marker-preservation (prose between markers MUST be preserved). Snapshot tests on per-node generated content for 5-10 representative types. CI drift gate (`gen:skills:check`). |
| Film Director v2.0 | Existing 11 tests pass with new (smaller) SKILL.md. Drift gate still green. Manual e2e on a fresh trailer prompt confirms Claude correctly calls the new tools. |
| Cross-skill | After Phase C ships, validate Claude in a fresh session: calls `start_film_director` → `start_workflow_editor` → `get_node_skill(<type>)` per stage. |

## 9. Open items — resolved

| Open item | Resolution |
|-----------|------------|
| `packages/shared` refactor scope/risk | Avoided. ts-morph reads `frontend/src/types/nodes.ts` directly at gen time. No runtime cross-package dependency; the gen-skills script (build tool, not runtime code) can reach into frontend source without coupling concerns. |
| List of node types in `start_workflow_editor` | Auto-generated via `<!-- AUTO-GEN:START node-catalog -->` block. Always in sync with the `backend/skills/nodes/` directory. |
| Embedded fallback for `start_workflow_editor` | YES — single file, manageable size, defense-in-depth matching film-director.ts pattern. |
| MCP tool schema introspection method | Runtime — server.registerTool captures schemas into a process-level registry. No AST parsing. |
| `_index.md` file in nodes/ directory | DROP — catalog lives in workflow-editor.md auto-gen block instead. Single source of truth. |

## 10. Naming conventions

Carrying forward from existing patterns:
- `start_*` for session-init / orchestrator tools (current: `start_film_director`; new: `start_workflow_editor`)
- `get_*` for parameterized fetch tools (new: `get_node_skill`)
- Node type strings are kebab-case in all references — `generate-image`, NOT `generate_image` or `generateImage`
- MCP tool names are snake_case — `generate_image`, `update_workflow_json`, etc.

## 11. Non-goals (v1)

Deliberately out of scope:
- **Per-tool skills** for utility MCP tools (extract_frame, voice_clone, etc.) — Claude uses the tool's own description. Future enhancement only if pain emerges.
- **Skill versioning** beyond frontmatter timestamps — no semver per node skill, no concurrent versions. Single canonical content per node type.
- **Multi-language skill content** — English only.
- **User-customizable skill overrides** — content is repo-controlled. Per-tenant overrides via DB are deferred to Phase 2+.
- **Auto-generated prose** — auto-gen produces structural data only; humans author prose. No LLM-based prose generation in the pipeline.
- **Live hot-reload during dev** — files are read at request time, but no file-watcher / hot-reload for in-flight sessions. Restart MCP connection to pick up changes (or accept the per-request read latency).

## 12. TL;DR

Three MCP tools + a file tree under `backend/skills/`. Per-node and workflow-editing skill content lives as markdown files with marker-delimited auto-gen blocks. G5 auto-gen reads NODE_DEFINITIONS + MCP tool schemas and rewrites the auto-gen blocks; CI enforces that gen output matches committed files. Film Director skill refactors to a thin v2.0 orchestrator that calls the new tools. End result: skill content tracks the codebase automatically; future skills are small, reusable, and never drift.
