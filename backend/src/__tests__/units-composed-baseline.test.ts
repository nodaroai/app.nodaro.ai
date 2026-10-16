// @test-watches tools/units/__fixtures__/composed-baseline.backend.json tools/units/composed-baseline.mjs frontend/src/nodes/** backend/src/nodes/**
import path from "node:path"
import { describe, expect, it } from "vitest"
import { baselineFile, baselineFor, membership, ordered, sectionDiff } from "../../../tools/units/composed-baseline.mjs"
import { NODE_REGISTRY } from "../lib/node-registry.js"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"
import { REQUIRED_MEDIA_INPUTS } from "../services/workflow-engine/payload-builder.js"
import { FINALIZE_JOB_TYPES, NOT_GENERIC_RECOVERABLE } from "../lib/job-finalize.js"
import { PASS_THROUGH_VIDEO_TYPES, VIDEO_OUTPUT_LENGTH_RULES } from "../lib/video-output-length.js"
import { ffmpegHandlers } from "../workers/handlers/ffmpeg.js"
import { ALL_NODE_HANDLES } from "../lib/node-handles.js"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"

/**
 * Every server registry the node units compose (`legacy ∪ units`, §5.8 B PR1b,
 * tools/units/README.md), as it was before the composition: with the unit
 * aggregates empty, each composed collection must equal it — IN ORDER where a
 * user or an agent can see the order, as a set of members everywhere else
 * (decided 2026-10-16; tools/units/composed-baseline.mjs). From PR2 on, a node
 * migrated into a unit must leave it unchanged too. After a DELIBERATE change
 * to a legacy registry (a reprice, a new node), refresh it with
 * `npm run units:baseline` and review the diff.
 */
const ROOT = path.resolve(__dirname, "../../..")
const WRITE = process.env.UNITS_WRITE_BASELINE === "1"

const snapshot = {
  // GET /v1/nodes serves the nodes in this order.
  NODE_REGISTRY: ordered(NODE_REGISTRY),
  // Looked up by credit id; the readers that walk its keys (bands, the admin audit, docs:prices) take min/max or match ids.
  STATIC_CREDIT_COSTS: membership(STATIC_CREDIT_COSTS),
  CREDIT_COSTS_keys: membership(Object.keys(CREDIT_COSTS)),
  REQUIRED_MEDIA_INPUTS: membership(REQUIRED_MEDIA_INPUTS),
  FINALIZE_JOB_TYPES: membership(FINALIZE_JOB_TYPES),
  NOT_GENERIC_RECOVERABLE: membership(NOT_GENERIC_RECOVERABLE),
  VIDEO_OUTPUT_LENGTH_RULES: membership(VIDEO_OUTPUT_LENGTH_RULES),
  // Derived from the rules above; only tests iterate it (it.each).
  PASS_THROUGH_VIDEO_TYPES: membership(PASS_THROUGH_VIDEO_TYPES),
  ffmpegHandlers_keys: membership(Object.keys(ffmpegHandlers)),
  // What the MCP edge normalizer and the Copilot edge validator read. Ordered:
  // knownNodeTypes() lists its keys and suggestNodeTypes() breaks score ties by
  // that order, so the Copilot's "did you mean" follows it.
  ALL_NODE_HANDLES: ordered(ALL_NODE_HANDLES),
  AUDIO_PRODUCER_TYPES: membership(AUDIO_PRODUCER_TYPES),
  VIDEO_PRODUCER_TYPES: membership(VIDEO_PRODUCER_TYPES),
  IMAGE_PRODUCER_TYPES: membership(IMAGE_PRODUCER_TYPES),
  DYNAMIC_PRODUCER_TYPES: membership(DYNAMIC_PRODUCER_TYPES),
}

describe("the composed server registries equal the baseline (units change nothing they do not add)", () => {
  const { expected, actual } = baselineFor(ROOT, baselineFile("backend"), snapshot, WRITE)
  it.each(Object.keys(snapshot))("%s", (name) => {
    expect(sectionDiff(expected[name], actual[name]), `${name} differs from ${baselineFile("backend")} — if the change is deliberate, run npm run units:baseline and review the diff`).toEqual([])
  })
  it("the baseline has no section the snapshot lacks", () => {
    expect(Object.keys(expected)).toEqual(Object.keys(actual))
  })
})
