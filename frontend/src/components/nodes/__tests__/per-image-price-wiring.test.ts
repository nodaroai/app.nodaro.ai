// @test-watches frontend/src/components/nodes/{generate-image,image-to-image,modify-image,reference-board}-node.tsx
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A model priced per input image is quoted from the images wired into the node:
 * a node whose pill leaves that count out shows less than the run reserves.
 */
const NODES = ["generate-image-node.tsx", "image-to-image-node.tsx", "modify-image-node.tsx", "reference-board-node.tsx"]

describe("per-image prices on the canvas", () => {
  it.each(NODES)("%s passes its wired images to the price id", (file) => {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8")
    expect(source).toContain("useWiredImageRefCount(id)")
    expect(source).toMatch(/buildCreditModelIdentifier\([\s\S]*?wiredImageRefs,?\s*\)/)
  })
})
