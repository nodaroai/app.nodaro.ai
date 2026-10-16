/**
 * `NODE_DEFINITIONS` carries no price.
 *
 * It used to carry a hand-typed `creditCost` per node. Nothing charged from it
 * and no reprice touched it, so it disagreed with the charged price for 92 of
 * 224 nodes, and every surface that printed it printed a wrong number. A node's
 * credits are single-sourced in the backend: the price table
 * (`STATIC_CREDIT_COSTS` in `backend/src/ee/billing/credits.ts`), re-priced to
 * what a run is charged and served by `GET /v1/credits/model-cost` (the editor's
 * `useModelCredits`) and `GET /v1/nodes` (`NODE_REGISTRY`). The rule "input and
 * parameter nodes are free" lives in
 * `backend/src/lib/__tests__/node-registry-free-inputs.test.ts`.
 */
import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS, type NodeTypeDefinition } from "../nodes"

// Compile-time half: `creditCost` may only ever be typed `never`, so no entry can hold a number.
type CreditCostField = NonNullable<NodeTypeDefinition["creditCost"]>
const creditCostIsNever: [CreditCostField] extends [never] ? true : false = true

const MESSAGE =
  "NODE_DEFINITIONS must not carry a creditCost — prices live in the backend price table " +
  "(STATIC_CREDIT_COSTS, backend/src/ee/billing/credits.ts), read at runtime through GET /v1/credits/model-cost (useModelCredits)"

describe("NODE_DEFINITIONS carries no price", () => {
  it("the definition type has no usable creditCost field", () => {
    expect(creditCostIsNever, MESSAGE).toBe(true)
  })

  it("no entry has a creditCost key", () => {
    const priced = NODE_DEFINITIONS.filter((d) => Object.prototype.hasOwnProperty.call(d, "creditCost")).map((d) => d.type)
    expect(priced, MESSAGE).toEqual([])
  })
})
