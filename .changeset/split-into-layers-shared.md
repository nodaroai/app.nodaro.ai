---
"@nodaro/shared": minor
---

The Split into Layers node (`split-into-layers`) joins the node contracts: an image producer (its Base output) whose Layers output is a list of image files — `isListOutputHandle("split-into-layers", "layers")` is true, and a wire from it runs the next node once per layer by default (`defaultEdgeOutputMode` answers `"each"`) — and whose Layer data output (`layerData`) is JSON. Nothing changes for any existing node.
