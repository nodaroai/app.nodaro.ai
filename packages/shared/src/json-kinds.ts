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
 *     `JSON_OUTPUT_KINDS` below. EVERY node with a JSON output declares one
 *     (decided 2026-10-08): `transcript`, `edl`, or `other` for JSON that is
 *     neither (a scrape, an analysis, a collection). `other` is a positive
 *     statement, not a gap — it connects exactly as an undeclared pip always
 *     has. A guard test enumerates the node definitions' JSON pips and fails
 *     on one with no declaration, so a new JSON node cannot ship unclassified
 *     and a Transcript producer cannot slip past the EDL/Transcript block.
 * Input kinds follow the platform's handle vocabulary: a `transcript` pip
 * expects a Transcript, an `edl` pip an EDL.
 */
import { RENDER_NODE_TYPES, type RenderNodeDescriptor } from "./render-nodes.js"

/** The two JSON shapes the platform's handle vocabulary tells apart. */
export type JsonKind = "transcript" | "edl"

/**
 * What a JSON output pip DECLARES: one of the two kinds, or `other` — JSON that
 * is neither a Transcript nor an EDL. Only `JsonKind` ever takes part in a
 * connection check; `other` records that the pip was classified.
 */
export type JsonOutputDeclaration = JsonKind | "other"

interface JsonOutputs {
  /** The pip an edge with no `sourceHandle` reads — absent when that read is not JSON (Text to Dialogue's is its audio). */
  readonly primary?: string
  readonly pips: Readonly<Record<string, JsonOutputDeclaration>>
}

/** JSON outputs of the nodes that are not renders: pip id → what it carries. */
const JSON_OUTPUT_KINDS: Readonly<Record<string, JsonOutputs>> = Object.freeze({
  // Edit Plan: the plan on `edl` — a Tighten EDL, a clip set (`Edl[]`) or a chapter list.
  "edit-plan": { primary: "edl", pips: { edl: "edl" } },
  // Transcribe: its json is the normalized Transcript (its `text` pip is plain text, no kind).
  transcribe: { primary: "json", pips: { json: "transcript" } },
  // Camera Switch: the switched edit and the renamed (still a Transcript) transcript.
  "camera-switch": { primary: "edl", pips: { edl: "edl", transcript: "transcript" } },
  // Text to Dialogue: the Transcript built from the model's own word timings (its default read is the audio).
  "text-to-dialogue": { pips: { json: "transcript" } },

  // ── JSON that is neither a Transcript nor an EDL (decided 2026-10-08) ──
  // Forced Alignment: `{ alignment: [{ word, start, end }] }` in seconds — a word list, not a Transcript.
  "forced-alignment": { primary: "data", pips: { data: "other" } },
  // Video Analysis / Video Audit: the canonical analysis result (an audit IS an analysis).
  "video-analysis": { primary: "json", pips: { json: "other" } },
  "video-audit": { primary: "json", pips: { json: "other" } },
  // Silence Detect: `{ version, ranges, durationMs }`. Audio Sync: `{ version, reference, offsets, notes }`.
  "silence-detect": { primary: "json", pips: { json: "other" } },
  "audio-sync": { primary: "json", pips: { json: "other" } },
  // Scrapers and searches: the scraped page / ad array / post list.
  "web-scrape": { primary: "json", pips: { json: "other" } },
  "meta-ads-scrape": { primary: "json", pips: { json: "other" } },
  "instagram-scrape": { primary: "json", pips: { json: "other" } },
  "social-search": { primary: "json", pips: { json: "other" } },
  "telegram-channel-feed": { primary: "json", pips: { json: "other" } },
  // Content Recipe: the recipe's structured result.
  "content-recipe": { primary: "json", pips: { json: "other" } },
  // Collections and libraries: the stored rows, whatever the user keeps in them.
  "collection-read": { primary: "json", pips: { json: "other" } },
  "collection-write": { primary: "json", pips: { json: "other" } },
  "inspiration-read": { primary: "json", pips: { json: "other" } },
  "competitor-read": { primary: "json", pips: { json: "other" } },
  // Describe to Picker: the picker values read off an image.
  "describe-to-picker": { primary: "picker-json", pips: { "picker-json": "other" } },
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
 * What the JSON output `sourceHandle` of a node of `nodeType` DECLARES —
 * `transcript`, `edl`, `other` — or `undefined` when the pip is not declared at
 * all (a non-JSON pip, an unknown handle, an unregistered node). `renders` is
 * the render-node registry (injectable for tests). The guard test reads this to
 * prove every JSON pip is classified.
 */
export function declaredJsonOutput(
  nodeType: string | null | undefined,
  sourceHandle: string | null | undefined,
  renders: Readonly<Record<string, RenderNodeDescriptor>> = RENDER_NODE_TYPES,
): JsonOutputDeclaration | undefined {
  if (typeof nodeType !== "string") return undefined
  const render = own(renders, nodeType)
  if (render) return (sourceHandle ?? RENDER_JSON_PIP) === RENDER_JSON_PIP ? render.jsonKind : undefined
  const outputs = own(JSON_OUTPUT_KINDS, nodeType)
  if (!outputs) return undefined
  const pip = sourceHandle ?? outputs.primary
  return typeof pip === "string" ? own(outputs.pips, pip) : undefined
}

/** The declared JSON output pips of the non-render nodes, as `[nodeType, pipId, declaration]` rows. */
export function declaredJsonOutputRows(): ReadonlyArray<readonly [string, string, JsonOutputDeclaration]> {
  return Object.entries(JSON_OUTPUT_KINDS).flatMap(([type, o]) =>
    Object.entries(o.pips).map(([pip, kind]) => [type, pip, kind] as const),
  )
}

/**
 * What the JSON output `sourceHandle` of a node of `nodeType` carries, or
 * `undefined` when it is not known to carry one of the two kinds (anything
 * declared `other`, a non-JSON pip, anything unregistered).
 */
export function jsonOutputKind(
  nodeType: string | null | undefined,
  sourceHandle: string | null | undefined,
  renders: Readonly<Record<string, RenderNodeDescriptor>> = RENDER_NODE_TYPES,
): JsonKind | undefined {
  const declared = declaredJsonOutput(nodeType, sourceHandle, renders)
  return declared === "other" ? undefined : declared
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
