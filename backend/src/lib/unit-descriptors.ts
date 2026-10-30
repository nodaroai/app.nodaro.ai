// backend/src/lib/unit-descriptors.ts — the server's one door to the node
// units' descriptors (§5.8 B, decided 2026-10-16; tools/units/README.md), a
// reviewed composer (tools/units/registry-composers.json). The registries
// derived from a unit's manifest — the required-media table, the saved-output
// reader, the finalize sets, the video-length rules, the worker map's
// membership, the MCP handle table, the MCP verbs' widget model
// (mcp/widget-models.ts), the concurrency-lane registry (laneOf) — read it
// here, not the generated aggregate.
// Each reader declares `@registry-enumerates` (a table over every unit) or
// `@registry-lookup` (it asks only `unitDescriptorOf(type)`).
import { unitInputHandleIn } from "@nodaro/render-rules"
import { UNIT_REGISTRY } from "../nodes/_generated/registry.js"
import type { UnitDescriptor, UnitInputHandle } from "../nodes/kit.js"
import { isLeafLane, type LeafLane } from "./concurrency-lanes/leaf-lanes.js"

/** Every node unit's descriptor (backend/src/nodes/<type>/descriptor.generated.ts), sorted by type. */
export const UNIT_NODE_DESCRIPTORS: ReadonlyArray<UnitDescriptor> = Object.values(UNIT_REGISTRY)

const BY_TYPE: ReadonlyMap<string, UnitDescriptor> = new Map(UNIT_NODE_DESCRIPTORS.map((d) => [d.type, d]))

/** The unit descriptor of `type`, or undefined when it is a legacy node (or unknown). */
export function unitDescriptorOf(type: string | undefined): UnitDescriptor | undefined {
  return type === undefined ? undefined : BY_TYPE.get(type)
}

/**
 * The input of unit `type` a wire on target handle `handle` lands on — undefined
 * for a legacy node, an undeclared handle, or a use-case unit (its inputs are
 * routed by routeUseCaseInput). The input lanes read it (unit-inputs.ts).
 */
export function unitInputHandleOf(type: string | undefined, handle: string | null | undefined): UnitInputHandle | undefined {
  return unitInputHandleIn(unitDescriptorOf(type), handle)
}

const LANE_CAPABILITY = "lane:"

/**
 * The concurrency lane unit `type`'s worker job counts in — its one `lane:*`
 * capability (tools/units/capabilities.mjs; the validator requires exactly one
 * on every worker unit) — or undefined for a legacy node, an unknown type, or a
 * unit that runs no worker job. The job lane registry reads it
 * (concurrency-lanes/registry.ts).
 */
export function laneOf(type: string | undefined): LeafLane | undefined {
  const cap = unitDescriptorOf(type)?.capabilities.find((c) => c.startsWith(LANE_CAPABILITY))
  const lane = cap?.slice(LANE_CAPABILITY.length)
  // The validator admits only the closed list; a lane outside it is never answered.
  return isLeafLane(lane) ? lane : undefined
}
