# Sub-Workflow Output
> Define typed output ports and pair with an input route to complete a sub-workflow interface.

## Overview
The Sub-Workflow Output node declares the output interface for a workflow that is intended to be invoked as a sub-workflow. It pairs with a Sub-Workflow Input node via a shared route ID to define a complete input-to-output execution path. The visible output port determines which result is surfaced to the calling workflow.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | string | `"Sub-Workflow Output"` | Display name for this output interface. |
| Route ID | string | `""` | The route ID of the paired Sub-Workflow Input node. Selected from a dropdown of available input routes in the workflow. |
| Ports | SubWorkflowPort[] | 1 default port | List of output ports. Each port has a name and media type. Minimum 1 port required. |
| Visible Output Port | string | `""` | ID of the port whose result is shown as the preview in the calling workflow. |

### Port Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| ID | string | auto-generated | Unique port identifier. |
| Name | string | `"Output"` | Display name for the port. |
| Media Type | enum | `"any"` | Output data type. Options: `text`, `image`, `video`, `audio`, `any`. |

## Inputs & Outputs

**Inputs:**
- `in` -- Receives the final result(s) from upstream nodes within the sub-workflow.

**Outputs:**
None. This is a terminal node within the sub-workflow. Results are returned to the calling Sub-Workflow node.

## Credit Cost
0 credits.

## Best Practices
- Always pair with a Sub-Workflow Input node by selecting its route ID.
- Set the Visible Output Port to the most relevant result for preview in the calling workflow.
- Name output ports to clearly describe what data they return (e.g., "Rendered Video", "Generated Audio").
- Match port media types to the actual output types of the upstream nodes connected to this output.

## Common Use Cases
- Returning a rendered video from a reusable composition sub-workflow.
- Outputting multiple results (e.g., both a video and a thumbnail image) from a single sub-workflow execution.
- Completing the interface definition for a modular processing pipeline.

## Tips
- The route ID dropdown only shows Sub-Workflow Input nodes that exist in the same workflow.
- A workflow can have multiple input/output route pairs, each representing a different execution path.
- The visible output port determines what the calling Sub-Workflow node displays as its result preview.
- Minimum 1 port is required.
