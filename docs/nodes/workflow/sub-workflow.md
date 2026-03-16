# Sub-Workflow
> Execute another workflow as a nested sub-workflow within the current workflow.

## Overview
The Sub-Workflow node invokes another workflow by reference, passing inputs through defined ports and receiving outputs when execution completes. It enables modular workflow design by allowing common pipelines to be built once and reused across multiple parent workflows. Execution is recursive with a maximum nesting depth of 5 levels, and cycle detection prevents infinite loops.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | string | `"Sub-Workflow"` | Display name for this node instance. |
| Workflow | selector | none | Dropdown to select the target workflow to execute. |
| All Projects | toggle | off | When enabled, shows workflows from all projects (not just the current one). |
| Route | selector | none | Select which input/output route to use if the target workflow defines multiple routes. |
| Interface Preview | read-only | n/a | Displays the input and output port definitions of the selected route. |
| Refresh | button | n/a | Reloads the target workflow's interface definition. |
| View / Open | button | n/a | Navigate to the referenced workflow for inspection or editing. |

## Inputs & Outputs

**Inputs:**
- `in` -- Data to pass to the sub-workflow's input ports. Dynamic handles are created based on the selected route's input port definitions.

**Outputs:**
- `out` -- Results from the sub-workflow's output ports. Dynamic handles are created based on the selected route's output port definitions.

## Credit Cost
0 credits for the Sub-Workflow node itself. Credits are consumed by the individual nodes within the referenced workflow as they execute.

## Best Practices
- Keep sub-workflow nesting shallow. The maximum depth is 5 levels; deeply nested workflows are harder to debug.
- Use descriptive labels to clarify what each Sub-Workflow node does in the parent workflow context.
- Refresh the interface after modifying the referenced workflow to pick up any port changes.
- Use the "All Projects" toggle sparingly -- prefer workflows within the same project for organizational clarity.

## Common Use Cases
- Reusing a standard video composition pipeline across multiple content workflows.
- Encapsulating complex processing chains (e.g., generate image, upscale, apply effects) into a single reusable node.
- Building template-like workflows that can be parameterized via input ports.
- Organizing large workflows into manageable, modular sub-components.

## Tips
- Cycle detection prevents a workflow from calling itself (directly or indirectly). Detection uses `workflowId:routeId` pairs.
- Execution progress is tracked via `subWorkflowProgress` with `currentNode`, `completed`, and `total` counts.
- Only nodes reachable from the selected route's input (via BFS traversal) are executed, not the entire target workflow.
- The route snapshot caches the interface definition. Use the Refresh button if the target workflow's ports have been modified.
- The Sub-Workflow node itself is free, but all nodes executed within the referenced workflow consume credits as they normally would.
