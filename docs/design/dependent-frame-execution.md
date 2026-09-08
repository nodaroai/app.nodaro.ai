# Executing linked frames and clips

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

This execution boundary does not by itself enable the full dependent-frame
feature. Compatible production saves, editor controls and deployment capability
checks must also be available.
