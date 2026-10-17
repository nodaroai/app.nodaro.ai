// @test-watches tools/units/__fixtures__/composed-baseline.frontend.json tools/units/composed-baseline.mjs frontend/src/nodes/**
import path from "node:path"
import { describe, expect, it } from "vitest"
import { baselineFile, baselineFor, membership, ordered, sectionDiff } from "../../../tools/units/composed-baseline.mjs"
import { NODE_DEFINITIONS, NODE_DEF_MAP } from "@/types/nodes"
import { nodeTypes } from "@/components/nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { FAMILY_RANK, NODE_FAMILIES, OWNER_FAMILY_BY_TYPE } from "@/lib/node-families"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { FFMPEG_NODE_TYPES } from "@/lib/ffmpeg-handles"
import { GENERATE_BUTTON_TYPES, RESULT_PRODUCING_TYPES, RUN_BUTTON_TYPES } from "@/components/editor/config-panel-node-sets"
import { getNodeTypeDisplayName } from "@/components/editor/config-panel-label"
import { LABEL_TABLES } from "@/lib/i18n/labels"

/**
 * Every editor registry the node units compose (`legacy ∪ units`, §5.8 B PR1b,
 * tools/units/README.md), as it was before the composition: with the unit
 * aggregates empty, each composed collection must equal it — IN ORDER where a
 * user or an agent can see the order, as a set of members everywhere else
 * (decided 2026-10-16; tools/units/composed-baseline.mjs). From PR2 on, a node
 * migrated into a unit must leave it unchanged too. After a DELIBERATE change
 * to a legacy registry, refresh it with `npm run units:baseline` and review the diff.
 */
const ROOT = path.resolve(__dirname, "../../..")
const WRITE = process.env.UNITS_WRITE_BASELINE === "1"

const snapshot = {
  // The add-node popup, the skills catalog and every "all nodes" list follow this order.
  NODE_DEFINITIONS: ordered(NODE_DEFINITIONS),
  // Looked up by type only (nothing iterates it).
  NODE_DEF_MAP_keys: membership([...NODE_DEF_MAP.keys()]),
  // React Flow looks components up by type; read-only-canvas re-keys it into another record.
  nodeTypes: membership(nodeTypes),
  // The picker renders options and family members in this order.
  NODE_OPTIONS: ordered(NODE_OPTIONS),
  NODE_FAMILIES: ordered(NODE_FAMILIES),
  OWNER_FAMILY_BY_TYPE: membership(OWNER_FAMILY_BY_TYPE),
  FAMILY_RANK: membership(FAMILY_RANK),
  EXECUTABLE_TYPES: membership(EXECUTABLE_TYPES),
  NODE_CREDIT_COSTS: membership(NODE_CREDIT_COSTS),
  // Per-type lookup; enumerate-connection-options collects a type's handle ids into a Set.
  HANDLE_OUTPUT_TYPES: membership(HANDLE_OUTPUT_TYPES),
  // getTargetHandlesAccepting walks it in order: the handle popover lists candidates in this order.
  TARGET_HANDLE_ACCEPTS: ordered(TARGET_HANDLE_ACCEPTS),
  FFMPEG_NODE_TYPES: membership(FFMPEG_NODE_TYPES),
  GENERATE_BUTTON_TYPES: membership(GENERATE_BUTTON_TYPES),
  RUN_BUTTON_TYPES: membership(RUN_BUTTON_TYPES),
  RESULT_PRODUCING_TYPES: membership(RESULT_PRODUCING_TYPES),
  displayNames: membership(Object.fromEntries(NODE_DEFINITIONS.map((d) => [d.type, getNodeTypeDisplayName(d.type)]))),
  // The node-label tables are what units add to (labels.generated.ts); "<locale> <label>" → text, looked up by label.
  nodeLabels: membership(Object.fromEntries(Object.entries(LABEL_TABLES).flatMap(([locale, t]) => Object.entries(t?.node ?? {}).map(([label, text]) => [`${locale} ${label}`, text])))),
}

describe("the composed editor registries equal the baseline (units change nothing they do not add)", () => {
  const { expected, actual } = baselineFor(ROOT, baselineFile("frontend"), snapshot, WRITE)
  it.each(Object.keys(snapshot))("%s", (name) => {
    expect(sectionDiff(expected[name], actual[name]), `${name} differs from ${baselineFile("frontend")} — if the change is deliberate, run npm run units:baseline and review the diff`).toEqual([])
  })
  it("the baseline has no section the snapshot lacks", () => {
    expect(Object.keys(expected)).toEqual(Object.keys(actual))
  })
})
