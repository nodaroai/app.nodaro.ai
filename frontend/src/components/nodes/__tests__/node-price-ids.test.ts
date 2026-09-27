/**
 * A node's price badge (and so its Run button) prices the id its route
 * RESERVES. Seven processing nodes priced the generic "ffmpeg" row instead and
 * showed half of what the run charged (11 shown, 22 charged); the others only
 * matched it by coincidence of today's prices. Every processing route reserves
 * its own node type, so the badge must ask for that.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const NODES_DIR = join(__dirname, "..")

/** Nodes with no route of their own to price by. */
const NO_OWN_ROUTE = new Set(["manual-edit-node.tsx"])

describe("node price badges", () => {
  it("never price by the generic ffmpeg id", () => {
    const offenders = readdirSync(NODES_DIR)
      .filter((f) => f.endsWith("-node.tsx") && !NO_OWN_ROUTE.has(f))
      .filter((f) => /useModelCredits\(\s*"ffmpeg"/.test(readFileSync(join(NODES_DIR, f), "utf8")))
    expect(offenders).toEqual([])
  })
})
