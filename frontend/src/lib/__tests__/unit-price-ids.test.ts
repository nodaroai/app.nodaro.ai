// @test-units-by-name looks up remove-audio and the one priced unit its mocked price-ids aggregate declares
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A node unit priced by its settings states, in its price-id.ts, the credit id
 * a run reserves from the node's data (the rule of its backend price.ee.ts
 * creditId). The editor's quotes read it through unitCreditIdOf: the model
 * identifier every surface prices by (getModelIdentifier) and the run estimate
 * (estimateNodeCredits: the live charged price first, then the price mirror's
 * row, then the type's own row). A unit with no price-id.ts — every unit today
 * — is priced exactly as before. The aggregate is mocked with one settings-
 * priced type (a legacy type stands in for it, so its own row exists).
 */
const PRICED = vi.hoisted(() => "upscale-image")
vi.mock("@/nodes/_generated/price-ids", () => ({
  UNIT_PRICE_IDS: Object.assign(Object.create(null), {
    [PRICED]: (data: Readonly<Record<string, unknown>>) => (typeof data.creditId === "string" ? data.creditId : `${PRICED}:base`),
  }),
}))
const cached = vi.hoisted(() => new Map<string, number>())
vi.mock("@/ee/hooks/use-model-credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/hooks/use-model-credits")>()),
  getCachedCredits: (id: string) => cached.get(id),
}))

import { unitCreditIdOf } from "../unit-price-ids"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { estimateNodeCredits, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import type { WorkflowNode } from "@/types/nodes"

const node = (type: string, data: Record<string, unknown> = {}) => ({ id: "n", type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode

beforeEach(() => cached.clear())

describe("a unit priced by its settings (price-id.ts)", () => {
  it("unitCreditIdOf: the id its rule names from the node's data; undefined for a type without one", () => {
    expect(unitCreditIdOf(PRICED, { creditId: "generate-image" })).toBe("generate-image")
    expect(unitCreditIdOf(PRICED, undefined)).toBe(`${PRICED}:base`)
    expect(unitCreditIdOf("remove-audio", {})).toBeUndefined()
    expect(unitCreditIdOf("constructor", {})).toBeUndefined()
    expect(unitCreditIdOf(undefined, {})).toBeUndefined()
  })

  it("getModelIdentifier quotes the row its run reserves", () => {
    expect(getModelIdentifier(node(PRICED, { creditId: "generate-image" }))).toBe("generate-image")
    expect(getModelIdentifier(node(PRICED))).toBe(`${PRICED}:base`)
  })

  it("estimateNodeCredits: the cached charged price, else the price mirror's row, else the type's own row", () => {
    expect(NODE_CREDIT_COSTS["generate-image"]).toBeGreaterThan(0)
    expect(estimateNodeCredits(node(PRICED, { creditId: "generate-image" }))).toBe(NODE_CREDIT_COSTS["generate-image"])
    expect(estimateNodeCredits(node(PRICED, { creditId: "no-such-row" }))).toBe(NODE_CREDIT_COSTS[PRICED])
    cached.set("no-such-row", 77)
    expect(estimateNodeCredits(node(PRICED, { creditId: "no-such-row" }))).toBe(77)
  })

  it("a unit without price-id.ts is priced by its type, as before", () => {
    expect(getModelIdentifier(node("remove-audio"))).toBe("remove-audio")
    expect(estimateNodeCredits(node("remove-audio"))).toBe(NODE_CREDIT_COSTS["remove-audio"])
  })
})
