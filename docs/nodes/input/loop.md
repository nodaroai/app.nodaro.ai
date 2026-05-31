# Table (loop) — merged into [List](./list.md)

> The `loop` node (UI label "Table") has been folded into the canonical [List](./list.md) node.

The `loop` type is a **deprecated alias**, auto-migrated to `list` on load (editor, presentation, and app runner) plus a one-time database sweep. Old workflows that used a `loop`/"Table" node keep working unchanged.

The List node now covers everything Table did: it starts as a single text column and **grows into a multi-column typed table** when you connect producers to its bottom-left "+" handle. See **[List](./list.md)** for the full reference.
