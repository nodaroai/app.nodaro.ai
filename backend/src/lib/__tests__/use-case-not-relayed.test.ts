// @test-watches backend/src/routes/nodaro-exclusive.ts backend/src/workers/handlers/nodaro-exclusive-relay.ts
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
