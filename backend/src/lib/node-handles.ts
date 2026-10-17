// backend/src/lib/node-handles.ts — every node's declared handle ids: the
// gen:skills table (mcp/generated/node-handles.ts, legacy nodes only — gen:skills
// renders it from the hand-written literal) ∪ each node unit's handles
// (unit.json, through the registry aggregate). What the MCP edge normalizer and
// the Copilot edge validator check a wire against.
// @registry-enumerates ALL_NODE_HANDLES carries every node unit's handles
import { NODE_HANDLES, type NodeHandleSpec } from "./mcp/generated/node-handles.js"
import { UNIT_NODE_DESCRIPTORS } from "./unit-descriptors.js"
import { composeRecord, unitRecord } from "./unit-compose.js"

export const ALL_NODE_HANDLES: Readonly<Record<string, NodeHandleSpec>> = composeRecord<NodeHandleSpec>(
  "NODE_HANDLES",
  NODE_HANDLES,
  unitRecord(UNIT_NODE_DESCRIPTORS, (u) => ({ inputs: u.inputs, outputs: u.outputs })),
)
