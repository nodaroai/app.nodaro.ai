# Per-node skill files

Each `.md` file in this directory is the canonical skill content for one node type. They are surfaced via the `get_node_skill(node_type)` MCP tool — the filename (without extension) is the node type string.

Auto-gen blocks are marked with `<!-- AUTO-GEN:START <id> -->` / `<!-- AUTO-GEN:END <id> -->` and are rewritten by `backend/scripts/gen-skills.ts`. Prose between markers is preserved across regenerations.

To add or refresh content: `npm run gen:skills` from `backend/`. CI gates on `npm run gen:skills:check`.
