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

The `save_editor_state` operation accepts an editor graph and its
`expectedVersion`. The server verifies that revision inside the save loop,
including after a concurrent writer wins. A stale snapshot returns HTTP 409
even if the caller omitted the outer `strict` flag. This operation edits ordinary
scene/settings state while preserving frame plans, reviews, bindings, linked
jobs/results, protected trash, completion receipts and sharing. It rejects a
draft whose indexed scenes cannot be reconstructed. Unknown stored settings
remain preserved by the server.

These boundaries do not by themselves enable the full dependent-frame feature.
Compatible editor controls, cloning/import handling and deployment capability
checks must also be available.

Compatible semantic saves preserve existing 3D previsualization alongside linked
frames: scene plans, revision history and blockout renders remain separate from
final clip results. Copying a scene keeps completed blockouts but drops its pending
3D jobs. Recipe exports retain blockout authoring inputs without scene/media results.

Compatible saves also preserve scene descriptions, per-prompt cast overrides and
reference captions. A role can remain description-only; assigning an actor later
keeps the scene's words and any prompt-specific overrides. Renaming a role moves
those overrides with it. Reference captions travel with copied settings and are
recorded when a clip is submitted, so later edits do not rewrite its history.

## Reading and reviewing frames

`GET /v1/studio/productions/capabilities` reports supported plan versions and
per-operation support for reading, editing, generating and accepting keyframes,
and generating linked clips. Source-video frame references have a separate flag.
The response depends on the installed host's compatible writer, immutable job
metadata and retained-image support. It performs no capture or generation.
Automatic acceptance and unattended generation are not supported.

`GET /v1/studio/productions/:id` includes the same capabilities beside its
`production` object. Dependency productions expose `requiredCapabilities`,
`keyframes`, `sequences`, and each linked shot's `sequenceBinding`. Each frame has
separate preview and accepted result keys/URLs, its current plan revision, result
count and pending markers. The final frame remains visible even when it has no
outgoing clip. `pending.keyframes` counts in-flight frame jobs. Shots also expose
pending still/clip jobs before their first result exists.

A full owner read includes authored plans, recorded review decisions, image
history and provenance. A summary omits image history. Other readers' frame
projections omit plans, private source references, review details, owner
identities and pending frame jobs. Recorded acceptance is historical state;
generation still verifies current revisions and retained inputs before use.

The SDK exposes these routes through `client.studio`. Generation and review are
separate calls: `generateKeyframe` submits the planned frame, `reconcile` records
finished jobs, and `acceptKeyframe` applies an explicit review. Description-only
cast references do not require a generated portrait. Adding a portrait later
does not change an existing description reference into image conditioning.
