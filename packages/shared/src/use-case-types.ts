import { UNIT_USE_CASE_TYPES } from "./generated/unit-contracts.js"

/**
 * The use-case node types — each a route (`POST /v1/<type>`, `/estimate`,
 * and `POST /v1/<type>/continue` to continue one of its runs): the node units
 * whose execution.kind is "use-case" (generated/unit-contracts.ts), in their
 * position order, the order every list of the types shows.
 */
export const USE_CASE_NODE_TYPES = UNIT_USE_CASE_TYPES
export type UseCaseNodeType = (typeof USE_CASE_NODE_TYPES)[number]

/** Is `type` a use-case node type? Anything that is not one of the strings above is not (an object key like "constructor" included). */
export function isUseCaseNodeType(type: unknown): type is UseCaseNodeType {
  return typeof type === "string" && (USE_CASE_NODE_TYPES as readonly string[]).includes(type)
}

if (new Set(USE_CASE_NODE_TYPES).size !== USE_CASE_NODE_TYPES.length) {
  throw new Error(`USE_CASE_NODE_TYPES: ${USE_CASE_NODE_TYPES.join(", ")} lists a type twice — a type is one node unit`)
}
