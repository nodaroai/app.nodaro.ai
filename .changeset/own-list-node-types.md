---
"@nodaro/shared": minor
---

Export `OWN_LIST_NODE_TYPES` and `ownsItsList(nodeType)`: the node types (Extract Field, JSON Process) whose saved list is the list their last run produced (`__listResults`), never an accumulated `generatedResults` history. The backend engine and the editor read a saved list of these nodes the same way.
