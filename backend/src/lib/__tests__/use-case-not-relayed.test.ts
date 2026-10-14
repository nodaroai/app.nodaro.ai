// @test-watches backend/src/routes/nodaro-exclusive.ts backend/src/workers/handlers/nodaro-exclusive-relay.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"

// Decided 2026-10-13: Tighten Episode is Nodaro-exclusive for DISCOVERY (hidden
// and badged on an unconnected install), but its route is core and is never
// relayed whole — its inner Edit Plan / Speaker View jobs relay one by one.
describe("Tighten Episode is exclusive for discovery, never relayed as a whole", () => {
  it("is in the set", () => {
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("tighten-episode")).toBe(true)
  })
  it("no relay table names its route: its inner Edit Plan / Speaker View jobs relay individually", () => {
    const relay = readFileSync(join(__dirname, "..", "..", "routes", "nodaro-exclusive.ts"), "utf8")
    expect(relay).not.toMatch(/tighten-episode/)
    const worker = readFileSync(join(__dirname, "..", "..", "workers", "handlers", "nodaro-exclusive-relay.ts"), "utf8")
    expect(worker).not.toMatch(/tighten-episode/)
  })
})
