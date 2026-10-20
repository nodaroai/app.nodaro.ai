// @test-watches backend/src/routes/nodaro-exclusive.ts backend/src/workers/handlers/nodaro-exclusive-relay.ts frontend/src/nodes/speaker-layout/unit.json
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES } from "@nodaro/render-rules"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"

// Decided 2026-10-13/14: every use-case node (Tighten Episode, Chapters, …) is
// Nodaro-exclusive for DISCOVERY (hidden and badged on an unconnected install),
// but its route is core and is never relayed whole — its inner Edit Plan /
// Speaker View jobs relay one by one.
describe.each([...USE_CASE_NODE_TYPES])("%s is exclusive for discovery, never relayed as a whole", (type) => {
  it("is in the set", () => {
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has(type)).toBe(true)
  })
  it("no relay table names its route: its inner Edit Plan / Speaker View jobs relay individually", () => {
    const relay = readFileSync(join(__dirname, "..", "..", "routes", "nodaro-exclusive.ts"), "utf8")
    expect(relay).not.toContain(type)
    const worker = readFileSync(join(__dirname, "..", "..", "workers", "handlers", "nodaro-exclusive-relay.ts"), "utf8")
    expect(worker).not.toContain(type)
  })
})

// Speaker Layout (decided 2026-10-17) is exclusive through its unit's capability — the one
// declaration both trees' sets compose from (no hand-written row in either cloud-only-nodes.ts).
describe("speaker-layout is exclusive through its capability", () => {
  it("its unit declares edition:nodaro-exclusive, and the backend's set has it", () => {
    const unit = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "frontend", "src", "nodes", "speaker-layout", "unit.json"), "utf8")) as { capabilities?: string[] }
    expect(unit.capabilities).toContain("edition:nodaro-exclusive")
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("speaker-layout")).toBe(true)
    const rows = readFileSync(join(__dirname, "..", "cloud-only-nodes.ts"), "utf8")
    expect(rows).not.toContain("speaker-layout")
  })
})
