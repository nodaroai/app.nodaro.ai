/**
 * Where a node unit's wired input lands when it is not a data field (decided
 * 2026-10-18; tools/units/README.md). A JSON input (accepts "look") keeps the
 * wired value as a string. A many-wire media input (`many: true`) keeps one
 * row per upstream node, in the order of the workflow's edge list, each with
 * the upstream node's id (what Audio Sync's `sources` does by hand). Both
 * engines' resolvers call this, so a unit's payload.ts and its exec.ts read
 * the same `unitInputs`. Pure.
 */
import { PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"

/** One source of a many-wire input: the upstream node, its media, and whether that media is a video or an audio. */
export interface UnitSourceRow {
  readonly id: string
  readonly url: string
  readonly kind: "video" | "audio"
}

/** What a unit input lands as: a JSON input's string, or a many-wire input's rows. */
export type UnitInputValue = string | readonly UnitSourceRow[]

/** The lane an input's wires land in. */
export type UnitInputLane = "many" | "json"

/** The part of a unit input handle the lanes read (both kits' UnitInputHandle satisfy it). */
interface LaneInput {
  readonly id: string
  readonly accepts: ReadonlyArray<string>
  readonly many?: true
}

/** The part of a unit definition / descriptor the lanes read. */
interface LaneUnit<H extends LaneInput> {
  readonly execution: { readonly kind: string }
  readonly handles: { readonly inputs: ReadonlyArray<H> }
}

/**
 * The input of `unit` a wire on target handle `handle` lands on. Undefined
 * for no unit, no handle, a handle the unit does not declare, or a use-case
 * unit — its inputs are routed by `routeUseCaseInput`, never by these lanes.
 */
export function unitInputHandleIn<H extends LaneInput>(unit: LaneUnit<H> | undefined, handle: string | null | undefined): H | undefined {
  if (!unit || !handle || unit.execution.kind === "use-case") return undefined
  return unit.handles.inputs.find((h) => h.id === handle)
}

/**
 * The lane an input's wires land in: "many" for an input that takes every
 * wire, "json" for a JSON input; undefined for any other input (it has a data
 * field, or is routed by its source's type). The validator lets neither lane
 * declare a field, and a JSON input accepts nothing but "look".
 */
export function unitInputLaneOf(h: LaneInput): UnitInputLane | undefined {
  if (h.many === true) return "many"
  return h.accepts.includes("look") ? "json" : undefined
}

/**
 * Whether a wire from a node of `sourceType` may land in a unit lane at all.
 * A parameter picker (mood, lens, …) is an additive prompt hint, never a
 * value: both resolvers skip it before routing, unless it is also a text
 * source (Text Prompt), which carries its text like any text source.
 * `textSources` is the calling engine's text-source set (the server's
 * TEXT_SOURCE_NODE_TYPES, the editor's TEXT_PRODUCER_TYPES).
 */
export function unitLaneTakesSource(sourceType: string | undefined, textSources: ReadonlySet<string>): boolean {
  return !sourceType || !PARAMETER_NODE_TYPES.has(sourceType) || textSources.has(sourceType)
}

/**
 * Land one wire on a unit input that holds `current`.
 * - many: a row per upstream node — the first wire from a node wins, a wire
 *   whose upstream produced nothing adds no row (the input is still recorded,
 *   as `[]` when it has no row yet). The `kind ?? "video"` default is for a
 *   caller that passes no kind (it could not tell the media): it is read as
 *   video, the pricier chain, so a run is never under-quoted.
 * - json: the wired string; of two real wires the last wins. A wired input
 *   whose upstream produced nothing records "" so the unit refuses the run
 *   (as Edit Plan's `offsets` does), never reads it as unwired — but an empty
 *   wire never erases a real value another wire landed.
 */
export function unitInputLanding(
  current: UnitInputValue | undefined,
  input: {
    readonly many: boolean
    readonly json: boolean
    readonly sourceNodeId: string
    readonly value: string
    readonly kind: "video" | "audio" | undefined
  },
): UnitInputValue {
  if (input.many) {
    const rows: readonly UnitSourceRow[] = Array.isArray(current) ? current : []
    if (input.value === "" || rows.some((r) => r.id === input.sourceNodeId)) return rows
    return [...rows, { id: input.sourceNodeId, url: input.value, kind: input.kind ?? "video" }]
  }
  if (input.value === "") return typeof current === "string" ? current : ""
  return input.value
}
