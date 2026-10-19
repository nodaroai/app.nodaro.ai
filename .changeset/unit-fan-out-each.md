---
"@nodaro/shared": minor
---

`FAN_OUT_EACH_HANDLES` (`@nodaro/shared/nodes`) can now include rows declared by node units, as well as its hand-written ones. A unit declares its row in `contract.fanOutEach`: the output pips an "each" edge reads one item at a time when the node ran once per item, and the pip that an edge naming no pip reads. Each row holds only a node type id and pip ids. `defaultEdgeOutputMode`, `listResultsServeHandle` and the table's shape are unchanged, and so are its hand-written rows.
