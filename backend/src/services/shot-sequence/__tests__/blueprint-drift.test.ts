/**
 * Blueprint drift guard — pins backend BLUEPRINT_IDS ↔ remotion component files.
 *
 * When a new blueprint is added:
 *   1. Create packages/remotion/src/blueprints/<id>.tsx
 *   2. Add id to BLUEPRINT_IDS in backend/src/services/shot-sequence/blueprint-params.ts
 *   3. Add entry to BLUEPRINT_REGISTRY in packages/remotion/src/blueprints/registry.ts
 *
 * This test fails if (1) and (2) are out of sync.
 * The registry.test.ts in packages/remotion fails if (1) and (3) are out of sync.
 */
import { describe, it, expect } from "vitest"
import { readdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { BLUEPRINT_IDS } from "../blueprint-params.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve from backend/src/services/shot-sequence/__tests__ → repo root → blueprints dir
const BLUEPRINTS_DIR = join(__dirname, "../../../../../packages/remotion/src/blueprints")

describe("BLUEPRINT_IDS vs remotion blueprint component files", () => {
  it("BLUEPRINT_IDS matches the .tsx basenames in packages/remotion/src/blueprints/", () => {
    const files = readdirSync(BLUEPRINTS_DIR)
    const componentBasenames = files
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.replace(".tsx", ""))
      .sort()

    expect([...BLUEPRINT_IDS].sort()).toEqual(componentBasenames)
  })

  it("every BLUEPRINT_ID has a corresponding .tsx file (individual check)", () => {
    const files = new Set(
      readdirSync(BLUEPRINTS_DIR)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => f.replace(".tsx", "")),
    )
    for (const id of BLUEPRINT_IDS) {
      expect(files.has(id), `Missing component file: ${id}.tsx`).toBe(true)
    }
  })
})
