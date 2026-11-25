// fast-json-patch ships as CJS: default-import the module object (a named
// import throws under tsx — see ee/pipelines/chat/apply-stage-edit.ts).
import jsonpatch, { type Operation } from "fast-json-patch"
import { refuse } from "./refusal.js"

/**
 * Applying an editor's JSON Patch (RFC 6902) to a project's saved content.
 * Runs on the heavy-work thread (`heavy-jobs.ts`), never on a request thread.
 *
 * Only `add`, `remove`, `replace` and `test` are taken: the editor's
 * `compare` emits nothing else, and `copy` / `move` are what can make a tiny
 * patch expensive — fast-json-patch deep-clones a copied value, so each
 * `{"op":"copy","from":"","path":"/x"}` doubles the document (a 101-byte
 * patch against a 1 MB project once ran for seconds and grew the process past
 * a gigabyte). Any other op, or more than `MAX_PATCH_OPS` operations, is 422
 * `patch_failed` before anything is applied.
 *
 * The cost the op count does not bound: an `add` or `remove` on an array
 * index splices the array, work in its length. A client's patch may carry at
 * most `MAX_INDEX_OPS` of them (an `add` or `remove` whose path's last part
 * is a number, empty, or `-`), else 422 `too_complex` before anything is applied; the
 * editor sends anything larger whole. A version's own stored patch is not
 * held to it (it was cut, and rebuilt once, by the server itself).
 *
 * Without copy and move, every value the result gains comes from the patch
 * text itself, so the result can be at most the base plus the patch (the
 * patch is under 5 MB inflated); the canonical result is still refused over
 * the project cap.
 */

export const MAX_PATCH_OPS = 20_000

/** The most `add` / `remove` operations on an array index one client patch may carry. */
export const MAX_INDEX_OPS = 2_000

const ALLOWED_OPS: ReadonlySet<string> = new Set(["add", "remove", "replace", "test"])

/**
 * A path whose last part may name an array position: digits (leading zeros
 * included, which fast-json-patch reads as a number), empty, or `-` (the
 * append position). An object key that is a number counts too.
 */
const INDEX_TAIL = /\/(?:[0-9]*|-)$/

/**
 * `ops` checked against the rules above: the operations, or 422
 * `patch_failed`. With `indexBudget`, more `add` / `remove` operations on an
 * array index than that is 422 `too_complex`.
 */
export function checkedPatch(ops: unknown, options: { indexBudget?: number } = {}): Operation[] {
  if (!Array.isArray(ops) || ops.length > MAX_PATCH_OPS) throw refuse(422, "patch_failed")
  let indexOps = 0
  for (const op of ops) {
    if (op === null || typeof op !== "object" || !ALLOWED_OPS.has((op as { op?: unknown }).op as string)) {
      throw refuse(422, "patch_failed")
    }
    const { op: name, path } = op as { op: string; path?: unknown }
    if ((name === "add" || name === "remove") && typeof path === "string" && INDEX_TAIL.test(path)) indexOps++
  }
  if (options.indexBudget !== undefined && indexOps > options.indexBudget) throw refuse(422, "too_complex")
  return ops as Operation[]
}

/**
 * `ops` applied to `document` (parsed for this job alone, so applying in
 * place touches nothing shared). Every operation is validated, and a path
 * through `__proto__` or `constructor/prototype` is refused, both as 422
 * `patch_failed`.
 */
export function applyProjectPatch(document: unknown, ops: unknown, options: { indexBudget?: number } = {}): unknown {
  const operations = checkedPatch(ops, options)
  try {
    return jsonpatch.applyPatch(document, operations, true, true, true).newDocument
  } catch {
    throw refuse(422, "patch_failed")
  }
}
