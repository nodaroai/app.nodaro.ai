# Sub-Workflow
> Embed another workflow as a single node. Edit the inner workflow inline with breadcrumb navigation.

## Overview
The Sub-Workflow node embeds another workflow inside the current one. From the outside it looks like any node -- it has input/output ports and a status indicator. Click the Expand icon to **edit** the inner workflow inline; a breadcrumb appears at the top of the editor showing the nesting path (`[Parent] -> [Child] -> ...`). Execution is recursive with a maximum nesting depth of 5 levels, and cycle detection prevents infinite loops.

A workflow becomes callable as a sub-workflow when it contains at least one matched pair of Sub-Workflow Input + Sub-Workflow Output nodes sharing the same `routeId`. Each pair defines a "route" through the workflow; a single workflow can expose multiple routes.

## How to add a sub-workflow

Two paths:

- **Create empty (recommended for new work)** -- Click "Create empty sub-workflow" in the config panel. A fresh child workflow is created under the current parent with one input + one output node seeded automatically, and the editor opens for editing immediately. The child is hidden from the project workflow list (it's not standalone -- only reachable via this parent).
- **Reference an existing workflow** -- Use the Workflow dropdown to pick any standalone workflow that has matched input/output boundary nodes. The picker hides child workflows owned by other containers (so you only see top-level, reusable workflows).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | string | `"Sub-Workflow"` | Display name for this node instance. |
| Create empty sub-workflow | button | n/a | Creates and opens a fresh child workflow seeded with one input + one output node. Disabled until the parent has been saved. |
| Workflow | selector | none | Dropdown to pick an existing standalone workflow to reference. Hides child workflows of other containers. |
| All Projects | toggle | off | When enabled, shows workflows from all projects (not just the current one). |
| Route | selector | none | Select which input/output route to use if the referenced workflow exposes multiple routes. |
| Interface Preview | read-only | n/a | Displays the input and output port definitions of the selected route. |
| Refresh | button | n/a | Reloads the referenced workflow's interface definition. |
| View mode | selector | `Ports` | How the node renders on the canvas. v1 ships the Ports view (input/output handles + status + preview). Storyboard / Video / Script views land in a later release as plug-ins. |
| Edit (expand icon on node) | button | n/a | Opens the referenced workflow for editing inline. A breadcrumb appears at the top of the editor showing the nesting path; click any crumb to jump to that level. |
| View Workflow | button | n/a | Opens the referenced workflow in a read-only viewer modal (does not navigate away). |
| Open Workflow | button | n/a | Same as the Edit (expand) button -- opens the referenced workflow inline with breadcrumb nav. |

## Inputs & Outputs

**Inputs:** Dynamic handles based on the selected route's input port definitions.

**Outputs:** Dynamic handles based on the selected route's output port definitions.

## Breadcrumb navigation

When you open a referenced workflow via Expand (or "Open Workflow"), a breadcrumb appears at the top of the editor: `[Original Workflow] -> [Sub-workflow A] -> [Sub-workflow B]`. Click any crumb to jump to that level. The breadcrumb auto-clears when you navigate back to the original workflow.

If you have unsaved changes when you click Expand, the editor prompts you to save or discard before navigating.

## Validation

Workflows that contain `sub-workflow-input` or `sub-workflow-output` boundary nodes are validated at save time:

- Every input boundary node must have a matching output boundary node sharing the same `routeId`.
- Every output boundary node must have at least one declared output port.
- Two boundary nodes (input or output) must not share the same `routeId`.

Violations are rejected with `400 invalid_sub_workflow` and a structured `details` array listing each error.

## Best Practices

- Keep sub-workflow nesting shallow. The maximum depth is 5 levels; deeply nested workflows are harder to debug.
- Use the "Create empty" button for one-off encapsulation -- it keeps the child workflow private to its parent.
- Use the Workflow reference dropdown for reusable building blocks -- these stay top-level and can be picked from any parent.
- Use descriptive labels to clarify each Sub-Workflow node's role in the parent.
- Refresh the interface after modifying the referenced workflow to pick up any port changes.
- Use the "All Projects" toggle sparingly -- prefer workflows within the same project for organizational clarity.

## Common Use Cases

- Reusing a standard video composition pipeline across multiple content workflows.
- Encapsulating complex processing chains (image -> upscale -> effects) into a single reusable node.
- Building template-like workflows that can be parameterized via input ports.
- Organizing large workflows into manageable, modular sub-components.
- Grouping a multi-node scene (i2i + animate + speech + lip-sync) into a single shot container.

## Tips

- Cycle detection prevents a workflow from calling itself (directly or indirectly). Detection uses `workflowId:routeId` pairs, so the same workflow can still be called via different routes.
- Execution progress is tracked via `subWorkflowProgress` with `currentNode`, `completed`, and `total` counts.
- Only nodes reachable from the selected route's input (via BFS traversal) are executed -- not the entire referenced workflow.
- The route snapshot caches the interface definition. Use the Refresh button if the referenced workflow's ports have been modified.
- Child workflows created via "Create empty" do not show up in the project's main workflow list -- they're owned by their parent and reachable only via the Edit/Expand button.
