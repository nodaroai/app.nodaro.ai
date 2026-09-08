# Saving and executing linked frames and clips

Workflow nodes marked `studio-dependent-frames-v1`, or carrying a `keyframeId`
or `sequenceBinding`, require the Studio production generation API. The canvas
can display their graph, but it cannot choose an accepted image from the latest
visible result. Attempts return `sequence_execution_required` before that node
starts a media job or reserves credits.

The same check applies to workflow execution, nested workflows, direct canvas
media requests and the browser executor. Direct requests with `workflowId` and
`nodeId` verify the stored node after checking access to its workflow; omitting
a capability from the request does not remove that stored requirement.

Use the production's manual generation actions for these nodes. They resolve
the reviewed inputs and record the submitted pins. Ordinary image and video
nodes retain their existing generation behavior.

Dependency-aware productions also require compatible saves. Generic workflow
updates, delta updates and direct database writes cannot replace their graph or
settings, even if the replacement removes the dependency marker. They return
`production_capability_required`; the HTTP API reports this as a 409 conflict.
Stored completion receipts remain protected after the last planned frame is
removed. Ordinary workflows and metadata-only edits retain their existing path.

The production API validates semantic edits against the current document and
saves with its loaded workflow version. A concurrent edit forces a fresh read
and retry; a strict revision request is refused when that revision has moved.
The compatible database functions are server-only and do not grant clients a
raw JSON replacement path. The server integration must authorize the target and
validate the document before calling them.

These boundaries do not by themselves enable the full dependent-frame feature.
Compatible editor controls, cloning/import handling and deployment capability
checks must also be available.
