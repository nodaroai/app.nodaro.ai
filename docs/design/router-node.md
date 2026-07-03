# Router Node — Design Spec

## Overview

A single **Router** node with two modes (**Radio** / **Checkbox**) that controls which downstream branches of a workflow execute. Supports configurable N routes with dynamic output handles.

- **Radio mode**: Exactly one route active (exclusive — radio button behavior)
- **Checkbox mode**: Any combination of routes active, including all or none (inclusive — toggle behavior)

## Node Data Type

```typescript
interface RouterNodeData {
  label: string;
  mode: "radio" | "checkbox";
  routes: Array<{
    id: string;        // crypto.randomUUID() — stable, never reused
    name: string;      // display name (e.g., "Route A")
    active: boolean;   // current activation state
  }>;
  // Execution result fields (set after execution)
  activeRoutes?: string[];          // IDs of active routes at execution time
  routeOutputs?: Record<string, any>; // routeId → passthrough value (or undefined)
  // Standard node fields
  status?: string;
  result?: string;
  progress?: number;
  skip?: boolean;
}
```

Default: 2 routes ("Route A", "Route B"), first route active, Radio mode.

Route IDs use `crypto.randomUUID()` for stability — deleting and re-adding a route never reuses an old ID, so existing edges won't silently reconnect to a different route.

## Canvas Appearance

### Node Body
- Header: Router icon + "Router" label + mode badge ("Radio" / "Checkbox")
- Body: List of routes with interactive controls
  - **Radio mode**: Filled/empty circle indicators (radio button visual). Clicking any route selects it exclusively.
  - **Checkbox mode**: Toggle switches. Clicking toggles individual routes independently.
- Active routes: bright text + green indicator
- Inactive routes: dimmed text + gray indicator
- **Warning badge**: When all routes are inactive in Checkbox mode, show an orange warning indicator (same pattern as SKIP badge)
- **Interactive controls**: Use `event.stopPropagation()` and React Flow's `noDragClassName` to prevent click events from triggering node selection/dragging

### Handles
- **Input**: One handle on the left (cyan) — accepts any upstream data
- **Outputs**: One handle per route on the right, dynamically created
  - Active routes: green handle circle with letter label (A, B, C...)
  - Inactive routes: gray handle circle with dimmed letter
  - Handle IDs match route IDs exactly (the `sourceHandle` on edges will be the route's UUID)
- **Dynamic handle registration**: Must call `useUpdateNodeInternals(id)` when routes are added/removed to ensure React Flow detects new `<Handle>` components
- Handle positions: percentage-based relative to node height (adapt to route count, similar to loop node pattern)

### Category
`processing` — same category as combine-text, split-text, and other control flow nodes.

### Toolbar Group
New group in add-node-popup and node-toolbar: **"Control Flow"** (under Processing category).

## Data Flow — Auto-Detect Passthrough

No explicit passthrough/gate toggle. Behavior is determined by connectivity:

- **Input connected**: Data from upstream passes through to all active output handles. Inactive handles return `undefined`.
- **Input not connected**: Node acts as a pure execution gate. Active routes allow downstream execution; inactive routes block it (return `undefined`).

This follows the QA Check node's *output routing pattern* (sourceHandle-based conditional output), but uses combine-text/split-text's *execution model* (inline, 0 credits). When a route returns `undefined`, downstream nodes connected to that route will still execute but receive empty input — this is consistent with QA Check behavior on the rejected branch.

### Passthrough Type Detection

The Router is media-type agnostic. When passing data through, it forwards whatever the upstream node produced (URL string for images/video/audio, text string for prompts, etc.). The downstream `input-resolver` determines how to map the Router's output based on URL pattern detection:
- URLs ending in image extensions → `imageUrl`
- URLs ending in video extensions → `videoUrl`
- URLs ending in audio extensions → `audioUrl`
- Plain text → `prompt`

This uses the same URL-regex pattern as the teleporter/preview nodes.

## Config Panel

Located in the processing configs section. Contains:

1. **Mode selector**: Dropdown or segmented control — "Radio" / "Checkbox"
2. **Route list**:
   - Each route: editable name field + delete button
   - Add route button at bottom
   - Minimum 2 routes enforced
   - Hard maximum 10 routes (prevents layout issues with too many handles)
3. **Active routes**: Toggle/radio controls matching the canvas (so config panel and canvas stay in sync)

When switching from Checkbox to Radio mode: if multiple routes are active, keep only the first active one.

## Execution Behavior

### Frontend DAG Executor

**`execute-node.ts`**: Router executes inline (no API call, no credits):
```typescript
// Pseudocode
const inputValue = resolveInput(node); // upstream value or undefined
const activeRoutes = node.data.routes.filter(r => r.active).map(r => r.id);
const routeOutputs: Record<string, any> = {};
for (const route of node.data.routes) {
  routeOutputs[route.id] = route.active ? (inputValue ?? "gate") : undefined;
}
updateNodeData(node.id, { activeRoutes, routeOutputs, result: "routed" });
```

**`extractNodeOutput()` in execution-graph.ts**: Reads from `node.data` fields:
```typescript
case "router": {
  if (!sourceHandle) return node.data.result;
  // sourceHandle is the route UUID — return that route's output
  return node.data.routeOutputs?.[sourceHandle];
}
```

**`node-input-resolver.ts`**: Router as input source — detect media type from URL pattern:
```typescript
case "router": {
  const value = extractNodeOutput(sourceNode, sourceHandle);
  if (!value || value === "gate") return { prompt: "" }; // gate mode
  if (isVideoUrl(value)) return { videoUrl: value };
  if (isImageUrl(value)) return { imageUrl: value };
  if (isAudioUrl(value)) return { audioUrl: value };
  return { prompt: value }; // text passthrough
}
```

### Backend Orchestrator

**`inline-executor.ts`**: Same logic as frontend — reads routes, produces `routeOutputs` map.

**`output-extractor.ts` — `getPrimaryOutput()`**:
```typescript
case "router": {
  if (!sourceHandle) return output?.result;
  return output?.routeOutputs?.[sourceHandle];
}
```

**`input-resolver.ts`**: Same media-type detection as frontend.

### Execution Result Shape
```typescript
// Stored on node.data (frontend) / nodeStates[id].output (backend)
{
  activeRoutes: string[];                // IDs of active routes
  routeOutputs: Record<string, any>;     // routeId → input value or undefined
  result: "routed";                      // primary output marker
}
```

## Credits

**0 credits** — pure control flow, no processing or API calls.

## Registration Checklist

Per CLAUDE.md 18-step new node registration:

| Step | File | What |
|------|------|------|
| 1 | `backend/src/routes/` | No route needed — inline execution |
| 2 | `backend/src/app.ts` | No registration needed |
| 3 | `backend/src/billing/credits.ts` | `"router": 0` in STATIC_CREDIT_COSTS |
| 4 | `backend/src/billing/credit-manager.ts` | `"router": 0` in CREDIT_COSTS |
| 5 | `frontend/src/types/nodes.ts` | `RouterNodeData` type + unions + NODE_DEFINITIONS (default outputs: 2 routes) |
| 6 | `frontend/src/components/nodes/router-node.tsx` | Node component with interactive toggles/radios + `useUpdateNodeInternals` |
| 7 | `frontend/src/components/nodes/index.ts` | `nodeTypes` map entry |
| 8 | `frontend/src/components/editor/add-node-popup.tsx` | NODE_OPTIONS entry (Control Flow group) |
| 9 | `frontend/src/components/editor/node-toolbar.tsx` | Sidebar entry (Control Flow group) |
| 10 | `frontend/src/components/editor/editor-toolbar.tsx` | Reset case: clear `result`, `activeRoutes`, `routeOutputs`, `status` |
| 11 | `frontend/src/components/editor/config-panels/processing-configs.tsx` | RouterConfig component |
| 12 | `frontend/src/components/editor/config-panels/index.ts` | Export |
| 13 | `frontend/src/components/editor/config-panel.tsx` | Import, display name, add to `RUN_BUTTON_TYPES` set, render conditional |
| 14 | `frontend/src/lib/api.ts` | No API function needed — inline node |
| 15 | `frontend/src/components/editor/workflow-editor/types.ts` | EXECUTABLE_NODE_TYPES entry |
| 16 | `frontend/src/components/editor/workflow-editor/execute-node.ts` | Inline execution block |
| 17 | `frontend/src/components/editor/workflow-editor/execution-graph.ts` | `extractNodeOutput()` case |
| 18 | `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Input source mapping with media-type detection |

Backend orchestrator files:
- `backend/src/services/workflow-engine/inline-executor.ts` — inline execution
- `backend/src/services/workflow-engine/output-extractor.ts` — `getPrimaryOutput()` sourceHandle routing
- `backend/src/services/workflow-engine/input-resolver.ts` — input resolution with media-type detection

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| One node vs two | Single Router node with mode toggle | Halves registration effort, cleaner toolbar, same underlying logic |
| Mode naming | "Radio" / "Checkbox" | Universally understood, more intuitive than "Exclusive/Inclusive" |
| Route count | User-configurable N (min 2, max 10) | Flexible with hard cap to prevent layout issues |
| Route IDs | `crypto.randomUUID()` | Stable — deleting/re-adding never reuses IDs, protects existing edges |
| Canvas interaction | Fully interactive toggles/radios | Quick route switching without opening config panel |
| Radio vs checkbox visuals | Distinct (circles vs toggles) | Instant mode recognition at a glance |
| Data flow detection | Auto-detect from input connectivity | No extra config toggle needed — simpler UX |
| Execution model | Inline (no API, no BullMQ job) | Zero-cost control flow, instant execution |
| Credits | 0 | Pure routing, no resource consumption |
| Handle positioning | Percentage-based relative to node height | Adapts to route count without handles extending beyond node |

## Edge Cases

- **Checkbox with 0 active routes**: All downstream branches receive `undefined`. Node shows orange warning badge. This is consistent with QA Check rejected-branch behavior — downstream nodes will execute but receive empty input.
- **Mode switch (Checkbox → Radio)**: If multiple routes active, keep only the first active one. Edges remain connected — inactive routes just produce `undefined`.
- **Route deletion with connected edges**: React Flow automatically removes edges connected to handles that no longer exist.
- **Large route count**: Hard cap at 10 prevents handle layout overflow.

## Future Considerations

- **App runner exposure**: Routes could be exposed as user-configurable inputs in presentation mode (separate feature)
- **Conditional routing**: Could add expression-based route activation (e.g., "activate if input contains X") — not in scope for initial implementation
- **Visual edge dimming**: Inactive route edges could be rendered with lower opacity on the canvas — nice-to-have polish
