/**
 * What a JSON pip CARRIES — the handle typing behind "an EDL is not a
 * transcript" (decided 2026-10-07) and its reverse, "a transcript is not an
 * EDL" (decided 2026-10-08).
 *
 * Every JSON output colours the same "look" data pip, so a validator that sees
 * only the source NODE type cannot tell Edit Plan's edit list from a
 * Transcribe's transcript. Wired into Add Captions' Transcript input, the edit
 * list is accepted at connect time and only fails (or captions nothing) at run
 * time. This module is the one place that knows the difference, read by the
 * canvas validators and the server's edge normalization alike (MCP workflow
 * writes, the REST delta lane, the Copilot).
 *
 * Output kinds are DATA, never a list of node names:
 *   - a render node's `json` pip answers its registry `jsonKind`
 *     (`RENDER_NODE_TYPES`), so a render registered later — Speaker View, whose
 *     json is an EDL — is covered by its own registry entry;
 *   - the other JSON producers declare a kind per output pip in
 *     `JSON_OUTPUT_KINDS` below (add a row when a node gains an EDL or
 *     Transcript output).
 * Input kinds follow the platform's handle vocabulary: a `transcript` pip
 * expects a Transcript, an `edl` pip an EDL.
 */
import { RENDER_NODE_TYPES, type RenderNodeDescriptor } from "./render-nodes.js"

export type JsonKind = "transcript" | "edl"

interface JsonOutputs {
  /** The pip an edge with no `sourceHandle` reads. */
  readonly primary: string
  readonly pips: Readonly<Record<string, JsonKind>>
}

/** JSON outputs of the nodes that are not renders: pip id → what it carries. */
const JSON_OUTPUT_KINDS: Readonly<Record<string, JsonOutputs>> = Object.freeze({
  // Edit Plan: the plan on `edl` — a Tighten EDL, a clip set (`Edl[]`) or a chapter list.
  "edit-plan": { primary: "edl", pips: { edl: "edl" } },
  // Transcribe: its json is the normalized Transcript (its `text` pip is plain text, no kind).
  transcribe: { primary: "json", pips: { json: "transcript" } },
  // Camera Switch: the switched edit and the renamed (still a Transcript) transcript.
  "camera-switch": { primary: "edl", pips: { edl: "edl", transcript: "transcript" } },
})

/** The pip a render's order reads/writes its json on. */
const RENDER_JSON_PIP = "json"

/** The input pips whose kind is fixed by the handle vocabulary. */
const JSON_INPUT_KINDS: Readonly<Record<string, JsonKind>> = Object.freeze({
  transcript: "transcript",
  edl: "edl",
})

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

/**
 * What the JSON output `sourceHandle` of a node of `nodeType` carries, or
 * `undefined` when it is not known to carry one of the kinds (a Transcribe's
 * json, a web scrape, anything unregistered). `renders` is the render-node
 * registry (injectable for tests).
 */
export function jsonOutputKind(
  nodeType: string | null | undefined,
  sourceHandle: string | null | undefined,
  renders: Readonly<Record<string, RenderNodeDescriptor>> = RENDER_NODE_TYPES,
): JsonKind | undefined {
  if (typeof nodeType !== "string") return undefined
  const render = own(renders, nodeType)
  if (render) return (sourceHandle ?? RENDER_JSON_PIP) === RENDER_JSON_PIP ? render.jsonKind : undefined
  const outputs = own(JSON_OUTPUT_KINDS, nodeType)
  if (!outputs) return undefined
  return own(outputs.pips, sourceHandle ?? outputs.primary)
}

/** What the JSON input `targetHandle` of a node expects, or `undefined`. */
export function jsonInputKind(
  _nodeType: string | null | undefined,
  targetHandle: string | null | undefined,
): JsonKind | undefined {
  return typeof targetHandle === "string" ? own(JSON_INPUT_KINDS, targetHandle) : undefined
}

export interface JsonKindMismatch {
  readonly output: JsonKind
  readonly input: JsonKind
}

/**
 * The connections this blocks: a JSON output of one kind wired into an input of
 * the other (decided 2026-10-07 / 2026-10-08) — an EDL into a Transcript input
 * and a Transcript into an EDL input. Both directions read the same two
 * tables. `null` for every other pair — including pairs it cannot classify,
 * which keep today's behaviour.
 */
export function jsonKindMismatch(
  sourceType: string | null | undefined,
  sourceHandle: string | null | undefined,
  targetType: string | null | undefined,
  targetHandle: string | null | undefined,
  renders: Readonly<Record<string, RenderNodeDescriptor>> = RENDER_NODE_TYPES,
): JsonKindMismatch | null {
  const input = jsonInputKind(targetType, targetHandle)
  if (!input) return null
  const output = jsonOutputKind(sourceType, sourceHandle, renders)
  return output && output !== input ? { output, input } : null
}

/** The sentence a rejected connection is explained with. */
export function jsonKindMismatchMessage(
  mismatch: JsonKindMismatch,
  labels: { readonly sourceLabel?: string; readonly targetLabel?: string } = {},
): string {
  const source = labels.sourceLabel ?? "This output"
  const target = labels.targetLabel ?? "this node"
  if (mismatch.output === "transcript") {
    return (
      `${source} outputs a transcript, not an edit list (EDL), so it cannot feed the EDL input of ${target}. ` +
      `Wire an Edit Plan's or Camera Switch's edl there instead.`
    )
  }
  return (
    `${source} outputs an edit list (EDL), not a transcript, so it cannot feed the Transcript input of ${target}. ` +
    `Wire a Transcribe node's json (or Apply EDL's or Camera Switch's transcript) there instead.`
  )
}
