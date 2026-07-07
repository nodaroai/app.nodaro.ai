# SubWorkflowNode — Nested Container Primitive

**Status:** Draft v1 (Brainstorming)
**Target Version:** Nodaro v1.28+
**Last Updated:** 2026-05-14

---

## 1. Vision

A new node type — `SubWorkflowNode` — that contains an editable sub-graph, exposes input/output ports to the outer canvas, and can render itself in multiple display modes.

**Recursive by default:** containers can contain containers. Trilogy → Episode → Scene → Shot is a four-level nesting that should just work.

**Strategic positioning:** This is the **composition primitive** Nodaro has been edging toward. `run_workflow` already exists; workflows are units; apps wrap workflows. A `SubWorkflowNode` makes that mental model first-class on the canvas.

---

## 2. Why This Replaces "Collapsible Super-Nodes"

An earlier design considered a simpler, visual-only abstraction:

> Each scene's nodes (image + video + audio + lip-sync) can be **grouped into a collapsible super-node**. Two modes: Expanded (see every node), Collapsed (one super-node per scene).

Collapse/expand is a *visual* abstraction over a flat graph. It hides nodes but doesn't change what they are.

`SubWorkflowNode` is a *structural* abstraction:
- The container **is** a node from the parent canvas's perspective
- The sub-workflow inside is a real, addressable, reusable unit
- View modes are pluggable (storyboard, video, scripting, default)
- Containers are saveable as templates, exportable, importable, shareable
- They compose recursively

Collapse/expand is a UX feature. `SubWorkflowNode` is a platform primitive.

---

## 3. Core Capabilities Unlocked

| Capability | Concrete example |
|------------|------------------|
| **Composition** | Pack 5 nodes (i2i + animate + speech + lip-sync + caption) into 1 reusable unit |
| **Templates** | Save "Cinematic Close-Up Shot" — drop into any workflow with parameterized refs |
| **Multi-view per container** | Same scene rendered as storyboard panel (planning), video clip (review), script card (writing) |
| **Bulk view operations** | Canvas-wide toggle: "show all shots as storyboard" → instant storyboard view of entire film |
| **Encapsulation in published apps** | App users see "Scene 03" container; can't see the i2v model choice inside |
| **Recursion** | Trilogy → Episode → Scene → Shot |
| **Sharing & library** | (v2+) Marketplace of community shot containers |

---

## 4. UX

### 4.1 Outside the container (parent canvas)

```
┌─────────────────────────────────────┐
│  ⛶  Scene 03: Combat              │
│  ──────────────────────────────────  │
│  [storyboard ▼]                     │
│  ┌─────────────────────────────┐    │
│  │ <keyframe thumbnail>        │    │
│  │ "Hero charges into ranks"   │    │
│  └─────────────────────────────┘    │
○ character_ref          video_out ○  │
○ location_ref           audio_out ○  │
○ dialogue                            │
└─────────────────────────────────────┘
```

- Looks like any node — has handles, title, body
- Body is **render-mode dependent**: storyboard view shows keyframe + caption, video view shows clip preview, scripting view shows dialogue/action, default view shows status + ports
- ⛶ button opens fullscreen mode
- Status indicator (idle / running / awaiting_approval / done / failed) on the container header

### 4.2 Inside the container (fullscreen)

```
Workflow ▸ Scene 03                                    [Close ✕]
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│ ◯ character_ref      [image_to_image] ── [animate_image]    │
│ ◯ location_ref       └─────────────────┘                    │
│                                          ├────────────── ◯ video_out
│ ◯ dialogue ──── [generate_speech] ─ [lip_sync]              │
│                                          ├────────────── ◯ audio_out
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- Input ports become **Input Source** nodes on the left edge of the sub-canvas
- Output ports become **Output Sink** nodes on the right edge
- User edits freely — swap models, add steps, rewire
- Breadcrumb shows nesting depth (supports containers-in-containers)
- ESC or "Close" returns to parent; the container's outputs reflect the latest inner state

### 4.3 View modes

Each container declares supported view modes:

```ts
type ViewMode = {
  id: string;
  label: string;
  render: (containerData) => ReactNode;
};

const SHOT_VIEW_MODES = [
  { id: 'default',    label: 'Ports',      render: PortsView },
  { id: 'storyboard', label: 'Storyboard', render: StoryboardView },
  { id: 'video',      label: 'Video',      render: VideoPreviewView },
  { id: 'scripting',  label: 'Script',     render: ScriptCardView },
];
```

- View mode is a **per-node setting** (each container picks its own)
- Plus a **canvas-wide toggle** ("show all containers as storyboard") for bulk inspection
- New view modes plug in as React components — no engine changes needed
- Generic `SubWorkflowNode` ships with only "Ports" view; rich view modes ship with specialized container types (e.g., the Story-to-Video Shot container)

---

## 5. Architecture

### 5.1 Data model

Cheapest implementation reuses the existing `workflows` table:

```sql
ALTER TABLE workflows ADD COLUMN parent_workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE;
ALTER TABLE workflows ADD COLUMN is_template boolean DEFAULT false;
ALTER TABLE workflows ADD COLUMN exposed_ports jsonb;       -- which inner node handles surface externally
ALTER TABLE workflows ADD COLUMN view_mode_configs jsonb;   -- registered view modes for this container
```

A sub-workflow **is** a workflow, just with a parent pointer and exposed ports. Existing `run_workflow`, `export_workflow`, `import_workflow`, SDK/MCP tooling works for sub-workflows automatically.

`exposed_ports` shape:

```ts
{
  inputs: Array<{
    id: string;                 // 'character_ref'
    label: string;              // 'Character Ref'
    type: 'image' | 'video' | 'audio' | 'text' | 'any';
    boundInnerNodeId: string;   // points to the InputSource node inside
  }>;
  outputs: Array<{
    id: string;
    label: string;
    type: 'image' | 'video' | 'audio' | 'text' | 'any';
    boundInnerNodeId: string;   // points to the OutputSink node inside
  }>;
}
```

### 5.2 Port abstraction

Two approaches considered:

1. **Explicit boundary nodes** (recommended for v1) — special `InputSource` / `OutputSink` nodes inside the sub-canvas represent each port. User drags edges from these to inner nodes.
2. **Marked handles** (v2 sugar) — user right-clicks any inner node handle → "Expose as container input/output." A boundary indicator renders at the canvas edge.

v1 ships option 1 only — more explicit, matches how functions work in every programming language, easier to validate.

### 5.3 Execution model

Two valid approaches:

**(a) Recursive flattening (recommended for v1):** At execution time, the orchestrator flattens the entire graph — containers expand to their inner nodes, boundary nodes are replaced by direct edges. Topological sort runs across the flat result.

- **Pro:** Reuses existing engine completely. Zero changes to the workflow orchestrator.
- **Con:** Parallelism caps (`TIER_PARALLELISM`) apply globally, not per-container.

**(b) Nested execution scopes (v2):** Outer DAG schedules the container as a single step; that step internally drives the inner DAG.

- **Pro:** Clean isolation. Per-container parallelism, retry, cancel scoping.
- **Con:** Engine change required. State sync complexity.

**Ship v1 with (a).** Move to (b) only when scope-level features (per-container retry, partial-graph caching, isolated cancellation) become necessary.

### 5.4 State sync (parent ↔ child)

- Inner node statuses bubble up: container shows `running` if any inner is running, `awaiting_approval` if any gates, `done` when all `OutputSink` nodes have outputs, `failed` if any inner fails
- Progress events stream via existing SSE — tagged with the container path (`scene_03 > animate_image`)
- The container's preview (storyboard thumbnail, video clip) is the output of a designated **primary output port** — usually `video_out` or `image_out`, declared in `exposed_ports.outputs[primaryIndex]`

---

## 6. Story-to-Video Impact

### 6.1 Before (current architecture spec)

```
Pipeline root → 50–200 nodes flat, with optional collapse-to-super-node grouping
```

For a small project (3 characters, 2 locations, 8 shots): ~50 nodes flat.
For a 30-shot trailer: ~134 nodes flat. Collapse to ~30 grouped.

### 6.2 After (with SubWorkflowNode)

```
Pipeline root
├── [Character: Hero]            ← flat, characters stay simple in v1
├── [Character: Villain]
├── [Location: Carrier]
├── [Location: Desert]
├── [Scene 01 ▦] (container)     ← inside: i2i → i2v → speech → lip-sync
├── [Scene 02 ▦]
├── ...
├── [Scene 08 ▦]
├── [Music Track]
└── [Final Merge]
```

**Outer canvas drops from ~150 nodes to ~15.**

### 6.3 The director workflow

The "different displays" UX becomes the default working mode for directors:

1. **Planning:** Switch all scenes to **Storyboard view** → entire film as a comic-strip-style sequence
2. **Review:** Switch all scenes to **Video view** → grid of playable clip previews
3. **Copyedit:** Switch all scenes to **Script view** → dialogue + action text per shot for editing
4. **Edit:** Click any scene → fullscreen → modify the inner workflow (swap i2v model, regenerate one element)

Canvas-wide view-mode toggle in the editor toolbar.

### 6.4 What stays flat in v1

To control scope, only **scenes** become containers in v1. Characters, objects, locations stay flat (each character has main + variants as sibling nodes on the parent canvas).

**Rationale:** Scenes are where the multi-node anatomy lives (i2i + animate + speech + lip-sync). Characters are simpler (1 ref + variants), so wrapping them in containers adds no clarity. v2 can wrap them if the user wants.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Port abstraction is fiddly (resolving inner→outer edges, type checking) | Start with explicit `InputSource`/`OutputSink` nodes; defer marked-handles sugar to v2 |
| Recursive UI navigation can confuse users | Breadcrumbs + clear "exit fullscreen" affordance + ESC key + visited-history navigation |
| Execution engine changes non-trivial | Ship (a) flattening for v1 — zero engine changes |
| Templates with parameters need binding UI | Defer to v2 — v1 templates are clone-and-edit |
| User-created containers without exposed ports = dead-end nodes | Validation: require at least one output port before save |
| Tier parallelism applies globally under flattening | Document the limit; promote to per-container parallelism if it bites in practice |
| Nested workflows pollute project workflow list | Filter by `parent_workflow_id IS NULL` in workflow list endpoints; add admin tools to inspect orphans |
| MCP `list_workflows` / `get_workflow` surfacing sub-workflows confusingly | Default to top-level only; opt-in flag `include_sub_workflows: true` for advanced clients |

---

## 8. Phased Rollout

### v1 (~3-4 weeks)

- `SubWorkflowNode` primitive (frontend + backend + DB migration)
- Fullscreen open/close + breadcrumb navigation
- Explicit `InputSource`/`OutputSink` boundary nodes
- View-mode plugin interface + default "Ports" view
- Story-to-Video ships its Shot container with 4 view modes (default, storyboard, video, scripting)
- Recursive flattening execution (no engine changes)
- Save/load containers as part of workflow JSON
- Export/import containers via existing SDK/MCP tools
- Validation: containers must declare ≥1 output port

### v2

- User-created templates (save container as reusable, drop from palette)
- Parameter binding UI (template inputs become typed parameters with defaults)
- Canvas-wide view-mode toggle ("show all containers as storyboard")
- Marked-handles port exposure UX
- Per-container parallelism / isolated execution scope
- Containers in published apps (encapsulation gate for app users)

### v3+

- Shared / marketplace containers
- Versioning + diff for templates
- Approval gates on container boundaries (e.g., "pause here before entering the next scene")
- Type checking on port connections

---

## 9. Open Questions

1. **Naming.** `SubWorkflowNode` is descriptive but long. Alternatives: `Container`, `Group`, `Module`. The user-facing name in node palette could differ from the internal type.
2. **Nesting depth limit.** Should we cap at N levels? Likely yes for v1 (suggest N=3) to keep UX sane.
3. **Credit accounting.** Inner nodes charge as normal. Should the container itself add overhead credits? Recommended: no — the container is structural, not generative.
4. **Versioning.** When a template is updated, do existing instances pick up the new version, or stay pinned? Recommended: pinned by default (clone-and-fork semantics), with explicit "Update from template" action.
5. **Edge type validation.** Should we enforce `image` output → `image` input compatibility at the container boundary? Or stay loose like the rest of Nodaro? Probably loose for v1 to match existing behavior.
6. **Approval gates inside containers.** If a Story-to-Video shot container is in manual mode and has an approval gate inside, does the parent canvas show "awaiting approval"? Recommended: yes, bubble up.
7. **What happens when a parameter picker is inside a container?** The picker still works via FieldMappings — but the prompt fragment needs to flow out through a port instead of being injected via global FieldMappings. Needs a design pass.

---

## 10. Cross-cutting Concerns

### 10.1 ee/ boundary

Containers are core platform features. They live in `frontend/src/components/nodes/sub-workflow-node.tsx` and `backend/src/routes/workflows.ts` (extended). No ee/ coupling — they're useful for community-edition users too.

### 10.2 Provider Enum Sync

N/A. Sub-workflows don't make API calls themselves; their inner nodes do. The 12-step provider enum sync checklist applies only to inner generative nodes.

### 10.3 New Node Registration

`SubWorkflowNode` is itself a new node type and must complete the 19-step registration in CLAUDE.md ("New Node Registration") including:
- Step 6: node component
- Step 7: nodeTypes map
- Step 8 + 9: add-node-popup AND node-toolbar (both)
- Step 15: `EXECUTABLE_NODE_TYPES` set (under flattening, the container itself isn't directly executed — but the flattening pass needs to recognize it)
- Step 19: `NODE_REGISTRY` descriptor

Special handling: this is not a "generative" node — no credit cost, no provider, no inputSchema in the traditional sense.

### 10.4 SDK & MCP

- `export_workflow` already handles full graph export. Sub-workflows export as nested objects within the parent workflow JSON.
- `import_workflow` reconstructs sub-workflows along with their parent.
- `list_workflows` should filter `parent_workflow_id IS NULL` by default.
- A new MCP tool `list_sub_workflows(parent_workflow_id)` may be useful for v2 template discovery.

---

## TL;DR

A `SubWorkflowNode` is a node that **is** another workflow. From outside: ports + a configurable view. From inside: a fully editable canvas. Recursive. Reuses existing workflow infrastructure (export, import, SDK, MCP). v1 ships scoped to Story-to-Video scene containers + 4 view modes. v2 adds templates, parameter binding, and canvas-wide controls. Replaces an earlier "collapsible super-node" idea with a real structural primitive instead of a visual one.
