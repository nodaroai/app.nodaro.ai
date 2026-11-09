/**
 * What the content guard is asked about: the text a request would generate
 * from, and whether anything structured already says the subject is a minor.
 *
 * Content-free. The vocabulary is a deployment's own, inside its registered
 * guard (`lib/content-guard.ts`); the only signals decided here are the ones
 * the product's own catalog already defines (`isMinorAge`, `containsMinorAgeHint`,
 * the same functions the minor-age floor runs on), so a new age added to the
 * Person catalog is read the same way everywhere.
 *
 * Two readers, one shape: `subjectOfAssembly` for a final assembled prompt (the
 * prompt-policy funnel) and `subjectOfInputData` for what a job row or a built
 * payload carries (the insert funnel, the workflow engine).
 */
import { containsMinorAgeHint, isMinorAge } from "@nodaro/prompts/picker-catalogs"
import type { ContentGuardSubject } from "./content-guard.js"
import type { PromptAssembly } from "./prompt-policy.js"

/** The final prompt as a route, worker or the workflow engine assembled it. A negative prompt is never read: it lists what to keep OUT. */
export function subjectOfAssembly(a: PromptAssembly): ContentGuardSubject {
  return {
    texts: [a.prompt],
    minorSignal: a.subjectMinor === true || containsMinorAgeHint(a.prompt),
    kind: a.kind,
  }
}

/**
 * Past this a request is refused, never read in part. It sits above the largest
 * body any route accepts, so a real request does not meet it; it exists so one
 * crafted payload cannot hold the event loop, since matching is linear in what
 * is read.
 */
const MAX_TOTAL_CHARS = 32 * 1024 * 1024

/** An address or encoded bytes from start to end is not text anyone wrote. Text that merely begins with a scheme still is. */
const WHOLLY_AN_ADDRESS = /^(?:https?:\/\/|blob:https?:\/\/|gs:\/\/|s3:\/\/|data:[^\s,]*,)\S*$/i
/** A field listing what to keep OUT of the result: `negativePrompt`, `negative_prompt`, `negativeStyle`, … */
const NEGATIVE_FIELD = /negative/i
/** The fields that hold a Person value directly. */
const PERSON_FIELD = /^(?:person|subject|characterPerson)$/

/** Whether `value`, in field `key`, is a Person value worth asking `isMinorAge` about. */
function isPersonValue(key: string, value: Record<string, unknown>): boolean {
  if (PERSON_FIELD.test(key)) return true
  if (typeof value.customAge === "number") return true
  return typeof value.age === "string" && value.age.startsWith("age-")
}

/** A Person value that says the subject is a minor: by the catalog's age or type, or by the structured-prompt shape's number or `child`. */
function personIsMinor(value: Record<string, unknown>): boolean {
  if (value.gender === "child") return true
  if (typeof value.age === "number" && Number.isFinite(value.age) && value.age < 20) return true
  return isMinorAge(value as { age?: string; customAge?: number; type?: string })
}

/**
 * The texts and the minor signal of a request's input data (a job row's
 * `input_data`, a built payload). Every string that is not an address or a
 * negative is read, at every depth, because the fields that carry a request's
 * words are many and differ per lane (`prompt`, `userPrompt`, `seedPrompt`,
 * `description`, `shots[].prompt`, `dialogue`, `lyrics`, a prefix or suffix, …);
 * a list of them would be the thing a new lane forgets. Nothing is cut: every
 * text is read to its end, however many come before it and however deeply it
 * is nested. A request past `MAX_TOTAL_CHARS` comes back `overLimit`, and the
 * funnel refuses it rather than judge part of it.
 */
export function subjectOfInputData(inputData: Record<string, unknown> | null | undefined): ContentGuardSubject {
  const texts: string[] = []
  const seen = new WeakSet<object>()
  // An explicit stack, so depth cannot overflow; children go on in reverse so texts keep the request's order.
  const stack: Array<readonly [value: unknown, key: string]> = [[inputData, ""]]
  let read = 0
  let minorSignal = false

  while (stack.length > 0) {
    const [value, key] = stack.pop()!
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed.length === 0 || WHOLLY_AN_ADDRESS.test(trimmed)) continue
      read += value.length
      if (read > MAX_TOTAL_CHARS) return { texts, minorSignal, overLimit: true }
      texts.push(value)
      continue
    }
    if (value === null || typeof value !== "object" || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push([value[i], key])
      continue
    }
    const record = value as Record<string, unknown>
    if (isPersonValue(key, record) && personIsMinor(record)) minorSignal = true
    const entries = Object.entries(record)
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [field, item] = entries[i]!
      if (NEGATIVE_FIELD.test(field)) continue
      if (field === "subjectMinor" && item === true) minorSignal = true
      stack.push([item, field])
    }
  }

  return { texts, minorSignal: minorSignal || containsMinorAgeHint(texts.join(" . ")) }
}
