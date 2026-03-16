# Sub-Workflow Input
> Define typed input ports for a workflow that can be called as a sub-workflow.

## Overview
The Sub-Workflow Input node declares the input interface for a workflow that is intended to be invoked by a Sub-Workflow node in another workflow. Each input port defines a named, typed entry point that receives data from the calling workflow. A route ID is auto-generated to uniquely identify this input within the workflow, allowing multiple input/output route pairs.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | string | `"Sub-Workflow Input"` | Display name for this input interface. |
| Route ID | string | auto-generated | Unique identifier for this input route. Generated automatically; do not modify manually. |
| Ports | SubWorkflowPort[] | 1 default port | List of input ports. Each port has a name and media type. Minimum 1 port required. |

### Port Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| ID | string | auto-generated | Unique port identifier. |
| Name | string | `"Input"` | Display name for the port. |
| Media Type | enum | `"any"` | Expected data type. Options: `text`, `image`, `video`, `audio`, `any`. |

## Inputs & Outputs

**Inputs:**
None. This is an entry-point node.

**Outputs:**
- `out` -- Passes received data downstream within the sub-workflow.

## Credit Cost
0 credits.

## Best Practices
- Name ports descriptively so callers understand what data to provide (e.g., "Background Video", "Narration Text").
- Set the media type to the most specific type that applies, rather than using `any`, to catch connection errors early.
- Use multiple ports when the sub-workflow requires more than one input (e.g., an image and a text prompt).
- Pair every Sub-Workflow Input with a corresponding Sub-Workflow Output to define the complete interface.

## Common Use Cases
- Defining the input interface for a reusable image processing pipeline.
- Creating a parameterized video composition workflow that accepts different media inputs.
- Building a modular text-to-video pipeline that can be called from parent workflows.

## Tips
- The route ID links this input to its paired Sub-Workflow Output node. The pairing is set on the output node side.
- At runtime, `__injectedPortValues` contains the actual data passed by the calling Sub-Workflow node, mapped by port ID.
- A workflow can have multiple input/output pairs (routes), each representing a different execution path through the workflow.
- Minimum 1 port is required. Remove the last port will not be permitted by the UI.
