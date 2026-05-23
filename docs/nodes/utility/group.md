# Group

A spatial container for organizing related nodes. Drop nodes into the Group's box; the Group exposes one output per output-type its members have (text, image, video, audio).

## How membership works

- Drag a node so that **70% or more of its bounding box is inside** the Group's box on drag-end → the node becomes a child of the Group.
- Drag a child so that **more than 30% of it is outside** the Group → it detaches.
- Children move with the Group when you drag the Group.

## Outputs

- Output handles appear dynamically based on the types of children inside.
- A Group with 3 text-prompt children + 1 generate-image child exposes **two outputs**: `out-text` (3-item array) and `out-image` (1-item array).
- Output arrays plug into list-aware consumers (Loop, Merge Lists, list-handling nodes). Connecting to a single-string input passes only the first item.

## What participates

Children whose primary output type is text, image, video, or audio. Multi-output nodes (Loop, Merge Lists, etc.) and parameter pickers (tone, framing, lighting, etc.) are **skipped** — see Collect for those cases.

## Pricing

Free — no credits charged. The Group is a frontend aggregator, not an executed node.
