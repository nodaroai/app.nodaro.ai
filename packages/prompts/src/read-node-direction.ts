/**
 * Narrow readers turning UNTRUSTED persisted node data (`workflows.nodes`
 * JSONB — import, MCP write, node preset, a Studio-emitted graph) into the
 * typed `direction` / `structured` levers `assembleImageInput` accepts.
 * `buildPayload` has no zod and workflow writes are
 * `z.record(z.string(), z.unknown())`, so this blob may have been written years
 * ago by any client.
 *
 * Used by ALL THREE image-assembly sites so what the canvas accepts cannot
 * drift between them: the frontend single-node executor (`execute-node.ts`),
 * the orchestrator (`payload-builder.ts`), and the config-panel final-prompt
 * preview (`build-image-assemble-input.ts`).
 *
 * `readDirectionFields` is DERIVED FROM `DIRECTION_FIELDS`, never a hand list:
 * a dimension added to the registry is honored here by construction, so the
 * reader can never silently drop a key the wire schema and the renderer both
 * know about. Anything unrecognised is DROPPED, never thrown on — a malformed
 * blob must not fail a canvas run, and an unknown catalog ID already degrades
 * to `""` inside each `get*PromptHint`, so this validates SHAPE only.
 *
 * BOUNDS MATCH THE WIRE SCHEMA where both exist, by SHARED CONSTANT:
 * `DIRECTION_ID_MAX_CHARS` and `DIRECTION_ARRAY_CEILING` are the same two
 * literals the `generate-image` route's `directionSchema` enforces, imported
 * from the registry rather than re-typed here — a body the route accepts and a
 * node the canvas re-runs must not disagree about which strings are ids.
 *
 * DELIBERATELY STRICTER THAN THE WIRE SCHEMA on `structured` values: the
 * route's `structuredPromptFieldsSchema` declares every field as a bare
 * `z.string().optional()` (unbounded), while `MAX_STRUCTURED_VALUE_CHARS` below
 * bounds them at 200. Do not "fix" that asymmetry by loosening HERE — this
 * reads a blob any client may have written years ago, and the values land
 * verbatim in `jobs.input_data.prompt`. Tightening the ROUTE instead would be a
 * new 400 on currently-accepted input, so a >200-char structured value stored
 * on a node is dropped on a canvas run while `POST /v1/generate-image` still
 * renders it. That is the one known divergence; it is bounded to a field the
 * canvas UI never writes that long.
 *
 * RETURNS `undefined`, NEVER `{}`: an empty object would still be a *defined*
 * `direction`, and the call sites' `...(x !== undefined ? { x } : {})` spread
 * would then hand `assembleImageInput` a defined-but-empty lever. Returning
 * `undefined` keeps that spread honest and the exact no-op branch taken.
 */
import {
  DIRECTION_ARRAY_CEILING,
  DIRECTION_FIELDS,
  DIRECTION_ID_MAX_CHARS,
  type DirectionFields,
} from "./direction-registry.js"
import type { StructuredPromptFields } from "./prompt-builder-structured-fields.js"

/**
 * Read a node's stored cinematic-direction ids. Accepts a single id OR an array
 * on every key (multi-pick dimensions carry arrays; a single-pick key may
 * legitimately carry one).
 *
 * The SEMANTIC per-dimension cap stays the renderer's slice (`maxPicks`) — this
 * reader does not know a row's pick budget and must not guess it. But it DOES
 * bound cardinality at `DIRECTION_ARRAY_CEILING`, the same ceiling the wire
 * schema enforces: the value is untrusted persisted JSONB (a node blob is
 * validated only as `z.record(z.string(), z.unknown())` on write), and handing
 * an unbounded array to `renderDirectionHints` would put an `includes`-dedupe
 * scan in front of that slice. Keeping the FIRST `DIRECTION_ARRAY_CEILING`
 * survivors is what the wire door already does to the same input.
 *
 * Junk is filtered BEFORE the cap, so valid ids sitting behind malformed
 * entries survive rather than being crowded out by them.
 */
export function readDirectionFields(value: unknown): DirectionFields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const src = value as Record<string, unknown>
  const out: Record<string, string | string[]> = {}
  for (const spec of DIRECTION_FIELDS) {
    const v = src[spec.key]
    if (typeof v === "string") {
      if (v.length > 0 && v.length <= DIRECTION_ID_MAX_CHARS) out[spec.key] = v
    } else if (Array.isArray(v)) {
      const kept: string[] = []
      for (const x of v) {
        if (kept.length >= DIRECTION_ARRAY_CEILING) break
        if (typeof x === "string" && x.length > 0 && x.length <= DIRECTION_ID_MAX_CHARS) {
          kept.push(x)
        }
      }
      if (kept.length > 0) out[spec.key] = kept
    }
  }
  return Object.keys(out).length > 0 ? (out as DirectionFields) : undefined
}

// ── structured ───────────────────────────────────────────────────────────────

type FieldKind = "string" | "number" | "gender"
const GENDERS = ["man", "woman", "child", "non-binary"] as const
const MAX_STRUCTURED_VALUE_CHARS = 200

type Group = Exclude<keyof StructuredPromptFields, "mood">
type GroupFields<K extends Group> = Record<keyof NonNullable<StructuredPromptFields[K]>, FieldKind>

/**
 * A FIELD-BY-FIELD table (not a registry walk) on purpose:
 * `StructuredPromptFields` is a small HAND-AUTHORED type, not catalog-derived,
 * and the table is what blocks `person: { age: "drop table" }` from rendering
 * verbatim into `jobs.input_data.prompt` — `renderStructuredFields` never
 * throws on junk, but it does render it. Totality is enforced by the
 * `GroupFields<K>` / `{ [K in Group]: … }` mapped types: a new field or group
 * on the published type fails to typecheck here.
 */
const PERSON_FIELDS: GroupFields<"person"> = {
  age: "number",
  gender: "gender",
  hair: "string",
  eyes: "string",
  expression: "string",
  profession: "string",
  warriorType: "string",
}
const STYLING_FIELDS: GroupFields<"styling"> = {
  mood: "string",
  lighting: "string",
  aesthetic: "string",
  colorLook: "string",
}
const SETTING_FIELDS: GroupFields<"setting"> = {
  era: "string",
  atmosphere: "string",
  backdrop: "string",
}
const CAMERA_FIELDS: GroupFields<"camera"> = {
  framing: "string",
  motion: "string",
  format: "string",
}
const LENS_FIELDS: GroupFields<"lens"> = { focalLength: "string", aperture: "string" }

const STRUCTURED_GROUPS: { [K in Group]: GroupFields<K> } = {
  person: PERSON_FIELDS,
  styling: STYLING_FIELDS,
  setting: SETTING_FIELDS,
  camera: CAMERA_FIELDS,
  lens: LENS_FIELDS,
}

function readField(v: unknown, kind: FieldKind): string | number | undefined {
  if (kind === "number") return typeof v === "number" && Number.isFinite(v) ? v : undefined
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_STRUCTURED_VALUE_CHARS) {
    return undefined
  }
  if (kind === "gender") return (GENDERS as readonly string[]).includes(v) ? v : undefined
  return v
}

/** Read a node's stored Path-1 structured prompt fields. Same drop-never-throw
 *  and `undefined`-never-`{}` contract as `readDirectionFields`. */
export function readStructuredFields(value: unknown): StructuredPromptFields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const group of Object.keys(STRUCTURED_GROUPS) as Group[]) {
    const raw = src[group]
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue
    const rawRec = raw as Record<string, unknown>
    const kept: Record<string, unknown> = {}
    for (const [field, kind] of Object.entries(
      STRUCTURED_GROUPS[group] as Record<string, FieldKind>,
    )) {
      const v = readField(rawRec[field], kind)
      if (v !== undefined) kept[field] = v
    }
    if (Object.keys(kept).length > 0) out[group] = kept
  }
  const mood = readField(src.mood, "string")
  if (mood !== undefined) out.mood = mood
  return Object.keys(out).length > 0 ? (out as StructuredPromptFields) : undefined
}
