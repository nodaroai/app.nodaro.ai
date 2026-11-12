// @registry-lookup asks the app fields of the one node type it is given (unitDescriptorOf)
/**
 * A node unit's app fields (unit.json `appFields`, tools/units/README.md "A unit's app fields"): the
 * settings a published app may let its user set, read from the unit's descriptor — the same declaration
 * the editor's app-field list comes from (frontend presentation/exposable-fields.ts).
 *
 * The declaration is a guarantee, not an app-form hint: a run may set such a field ONLY to a value it
 * declares — a select's value is one of its options, an integer field's a whole number in its range on its
 * step — whichever lane sets it and whether or not the app exposes it. `null` is refused too: the override
 * merge would delete the key, and the unit's payload and price would read no value instead of the declared
 * default. The wording is a legacy fixed-list field's (`quickFieldRefusal`).
 *
 * Held twice, like the outbound-node lock (input-override-lock.ts):
 *  - every route that takes a run request's `inputOverrides` refuses with a 400 `validation_error` before
 *    anything is written (`findUnitFieldOverrideRefusals`, next to its `findLockedOverrides`);
 *  - unconditionally at the ONE place every server run merges its overrides into node data,
 *    `applyInputOverridesToNodes` (workers/apply-input-overrides.ts, called once, by the orchestrator, for
 *    every lane and every continuation): it throws `UnitFieldOverrideError` before touching a node, and the
 *    orchestrator fails the execution with the message.
 * Only a run's override is held: a value the creator SAVED on the node keeps running (a value a narrowed
 * declaration no longer lists is the creator's to change — the README's "narrowing is breaking").
 * Legacy nodes are untouched: a node whose type declares no app fields is never read here.
 */
import { canonicalExposedFieldKey } from "@nodaro/shared/apps"
import type { UnitAppField } from "../nodes/kit.js"
import { MESSAGE_MAX_ENTRIES, MESSAGE_MAX_PATH_CHARS, clip } from "./input-override-lock.js"
import { unitDescriptorOf } from "./unit-descriptors.js"

/** The app field of node unit `nodeType` stored under `storedKey`; undefined for a legacy node or a field it does not declare. */
export function exposedUnitFieldSpec(nodeType: string | undefined, storedKey: string): UnitAppField | undefined {
  const fields = unitDescriptorOf(nodeType)?.appFields
  if (!fields || !nodeType) return undefined
  const key = canonicalExposedFieldKey(nodeType, storedKey)
  return fields.find((f) => f.field === key)
}

/** Every value a unit select takes, in its declared order. */
export function unitSelectValues(field: Extract<UnitAppField, { kind: "select" }>): string[] {
  return field.options.map((o) => o.value)
}

/** Whether `value` is a whole number an integer app field takes: in its range, on its step. */
export function isUnitIntegerValue(field: Extract<UnitAppField, { kind: "integer" }>, value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= field.min && value <= field.max && (value - field.min) % field.step === 0
}

/**
 * A refused value as the message shows it. The message reaches a 400 body and, on the merge path, a run's
 * `error_message` column, so it is caller-shaped text made safe to write: a string with its control characters
 * (NUL included) and lone surrogates escaped, anything else as JSON (a number or a boolean as written), and
 * the whole cut to `MESSAGE_MAX_PATH_CHARS` code points — a megabyte value cannot echo itself back.
 */
export function shownRefusedValue(submitted: unknown): string {
  const text =
    typeof submitted === "string"
      ? JSON.stringify(submitted).slice(1, -1)
      : typeof submitted === "number" || typeof submitted === "boolean" || submitted === null
        ? String(submitted)
        : (JSON.stringify(submitted) ?? String(submitted))
  return clip(text, MESSAGE_MAX_PATH_CHARS)
}

/**
 * Why a submitted value for a node unit's app field is refused, or null when it is accepted (or the field
 * is not a unit's app field: a legacy node's is checked by its own rules). `null` is a value like any other
 * here, and refused: it would clear the field.
 */
export function unitFieldRefusal(nodeType: string | undefined, storedKey: string, submitted: unknown): string | null {
  const field = exposedUnitFieldSpec(nodeType, storedKey)
  if (!field) return null
  if (field.kind === "select") {
    const values = unitSelectValues(field)
    if (typeof submitted === "string" && values.includes(submitted)) return null
    return `Invalid value for ${storedKey}: ${shownRefusedValue(submitted)}. Allowed: ${values.join(", ")}`
  }
  if (isUnitIntegerValue(field, submitted)) return null
  return `Invalid value for ${storedKey}: ${shownRefusedValue(submitted)}. Use a whole number between ${field.min} and ${field.max}${field.step > 1 ? ` in steps of ${field.step}` : ""}.`
}

export interface UnitFieldOverrideRefusal {
  readonly nodeId: string
  readonly nodeType: string
  /** The override key as the request sent it. */
  readonly field: string
  readonly message: string
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

/**
 * Every override entry that sets a node unit's app field to a value its declaration does not take. Pure.
 * Walks the GRAPH and looks each node up in the map — the same iteration and lookup the merge does
 * (`applyInputOverridesToNodes`, and `findLockedOverrides` beside it), so the two never disagree about
 * which nodes an entry reaches. A node of a type that declares no app fields is skipped: legacy nodes
 * never meet this check.
 */
export function findUnitFieldOverrideRefusals(
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string }> | null | undefined,
  inputOverrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null | undefined,
): UnitFieldOverrideRefusal[] {
  if (!nodes || !inputOverrides) return []
  const found: UnitFieldOverrideRefusal[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    if (!node?.type || !unitDescriptorOf(node.type)?.appFields) continue
    const fields = inputOverrides[node.id]
    if (!isPlainObject(fields)) continue
    for (const [key, value] of Object.entries(fields)) {
      const message = unitFieldRefusal(node.type, key, value)
      if (message === null) continue
      const at = `${String(node.id)}\u0000${key}`
      if (seen.has(at)) continue
      seen.add(at)
      found.push({ nodeId: String(node.id), nodeType: node.type, field: key, message })
    }
  }
  return found
}

/**
 * The refusal a request (or a run) answers with: each refused value's sentence, in graph order. One refusal
 * is its sentence as written; several are each closed with a full stop, so two never run together. Bounded
 * like the outbound-node lock's: at most `MESSAGE_MAX_ENTRIES` spelled out, the rest counted.
 */
export function describeUnitFieldOverrideRefusals(refusals: ReadonlyArray<UnitFieldOverrideRefusal>): string {
  if (refusals.length === 1) return refusals[0]!.message
  const shown = refusals.slice(0, MESSAGE_MAX_ENTRIES).map((r) => (/[.!?]$/.test(r.message) ? r.message : `${r.message}.`))
  const rest = refusals.length - MESSAGE_MAX_ENTRIES
  return [...shown, ...(rest > 0 ? [`${rest} more refused.`] : [])].join(" ")
}

/** Thrown by the merge; the orchestrator turns it into a failed execution carrying the message. */
export class UnitFieldOverrideError extends Error {
  readonly code = "validation_error" as const
  readonly refusals: ReadonlyArray<UnitFieldOverrideRefusal>

  constructor(refusals: ReadonlyArray<UnitFieldOverrideRefusal>) {
    super(describeUnitFieldOverrideRefusals(refusals))
    this.name = "UnitFieldOverrideError"
    this.refusals = refusals
  }
}

/** Refuse the whole run when any override sets a unit app field outside its declaration — nothing partial. */
export function assertUnitFieldOverrides(
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string }> | null | undefined,
  inputOverrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null | undefined,
): void {
  const refusals = findUnitFieldOverrideRefusals(nodes, inputOverrides)
  if (refusals.length > 0) throw new UnitFieldOverrideError(refusals)
}

/** A route's 400 body for these refusals (the same code and wording the run would fail with). */
export function unitFieldOverrideErrorBody(refusals: ReadonlyArray<UnitFieldOverrideRefusal>): { code: "validation_error"; message: string } {
  return { code: "validation_error", message: describeUnitFieldOverrideRefusals(refusals) }
}
