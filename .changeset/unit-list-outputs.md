---
"@nodaro/shared": minor
---

A node can now hand on a list of files from one run on one output (for example, every layer of a split image). `LIST_OUTPUT_HANDLES` names those outputs and `isListOutputHandle(type, handle)` asks about one. A wire leaving such an output runs the next node once per item by default: `defaultEdgeOutputMode` now answers `"each"` for it. Nothing changes for any existing node.
