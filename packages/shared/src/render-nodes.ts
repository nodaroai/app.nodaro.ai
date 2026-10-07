/**
 * The render-node registry (SV18, decided 2026-10-06): every node type that
 * turns an EDL into a finished file, and how each one behaves wherever the
 * platform gives a render its meaning — review and the Preview label, privacy,
 * the latest-batch reader, the owner-only listings, and what its `json` handle
 * carries.
 *
 * ONE registry, read by both engines, the editor, the listings and MCP, so a
 * second render (Speaker View) joins by adding one entry — never by finding
 * every `=== "apply-edl"`. The backend census test
 * (`render-node-census.test.ts`) fails a new `apply-edl` literal at any site
 * that is not pure registration of that node.
 *
 * The key is the node type AND the job name: a render's job is never renamed
 * (by quality or otherwise — only its credit id changes), so the same key
 * answers for `node.type` and for `jobs.job_type`.
 */
import { applyEdlCreditId, speakerViewCreditId } from "./credit-identifiers.js"
import type { RenderMedium } from "./render-output.js"

/** Where a render's player maps the output clock back to the master clock
 *  from: the EDL it was given (`input_data.edl`), or the EDL it emitted on its
 *  `json` output (a render that rewrites its EDL, e.g. by splitting turns). */
export type RenderClockSource = "input" | "output-json"

/** What a render's `json` output handle carries. Only a `transcript` is handed
 *  on as one (Add Captions, the word-timing preflight). */
export type RenderJsonKind = "transcript" | "edl"

export interface RenderNodeDescriptor {
  /** The medium the render's order asks for (its node data, or its job's
   *  `input_data`) — before any output exists to say. */
  readonly mediumOf: (data: Readonly<Record<string, unknown>>) => RenderMedium
  /** The credit id a render of this quality and output reserves on. */
  readonly creditId: (quality: unknown, output?: unknown) => string
  readonly clockMapFrom: RenderClockSource
  /** Listed in its owner's own views only, never in a public one (decided
   *  2026-10-06): a Preview is private, and a public final would be exposure
   *  nobody decided. */
  readonly ownerOnlyListing: boolean
  /** An `each` wire reads its LATEST batch only, never its accumulated history
   *  (TA6, decided 2026-10-04). */
  readonly latestBatch: boolean
  readonly jsonKind: RenderJsonKind
}

type Data = Readonly<Record<string, unknown>>

/** Its `output` setting, video when absent. */
const outputSettingMedium = (data: Data): RenderMedium => (data.output === "audio" ? "audio" : "video")

const descriptor = (d: RenderNodeDescriptor): RenderNodeDescriptor => Object.freeze({ ...d })

export const RENDER_NODE_TYPES: Readonly<Record<string, RenderNodeDescriptor>> = Object.freeze({
  "apply-edl": descriptor({
    mediumOf: outputSettingMedium,
    creditId: (quality) => applyEdlCreditId(quality),
    clockMapFrom: "input",
    ownerOnlyListing: true,
    latestBatch: true,
    jsonKind: "transcript",
  }),
  // Speaker View (C3.2): video only; its `json` is the EDL as it drew it (the
  // turns split, the layouts written), so a player maps the output clock
  // through THAT, and Add Captions never takes it for a Transcript.
  "speaker-view": descriptor({
    mediumOf: () => "video",
    creditId: (quality) => speakerViewCreditId(quality),
    clockMapFrom: "output-json",
    ownerOnlyListing: true,
    latestBatch: true,
    jsonKind: "edl",
  }),
})

/** Every render node type, in registry order. */
export const RENDER_NODE_TYPE_IDS: readonly string[] = Object.freeze(Object.keys(RENDER_NODE_TYPES))

/** The descriptor of a render node type (or job name); `undefined` for any
 *  other value. Own keys only, so `"constructor"` is not a render. */
export function renderNodeOf(type: unknown): RenderNodeDescriptor | undefined {
  return typeof type === "string" && Object.hasOwn(RENDER_NODE_TYPES, type) ? RENDER_NODE_TYPES[type] : undefined
}

/** Is this node type (or job name) a render? */
export function isRenderNodeType(type: unknown): type is string {
  return renderNodeOf(type) !== undefined
}

/** Does an `each` wire from this node read its latest batch only? */
export function rendersLatestBatch(type: unknown): boolean {
  return renderNodeOf(type)?.latestBatch === true
}

/** Is this node a render whose `json` output is a Transcript? */
export function rendersTranscriptJson(type: unknown): boolean {
  return renderNodeOf(type)?.jsonKind === "transcript"
}

/** The render job types that list in their owner's own views only. */
export const OWNER_ONLY_LISTING_RENDER_TYPES: readonly string[] = Object.freeze(
  RENDER_NODE_TYPE_IDS.filter((t) => RENDER_NODE_TYPES[t]!.ownerOnlyListing),
)
