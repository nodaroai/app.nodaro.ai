/**
 * THE ACCEPTANCE FIXTURE — the golden production, after the golden batch.
 *
 * `golden-production.json` pins the document the codec writes;
 * `golden-ops.json` is a batch that touches every operation this build
 * implements. This file applies the second to the first and pins the RESULT,
 * byte for byte, as `golden-after-ops.json` (plan P1.1's acceptance).
 *
 * Why a committed artefact rather than a set of assertions about the outcome:
 * the same batch has to be applied twice, in two repositories, and produce the
 * same document. The studio's editor applies it locally for its optimistic
 * state and the platform applies it inside the ops route, and D4's whole
 * argument — that replaying the outbox IS the merge, and is exact — is only
 * true if those two agree completely. A list of assertions can only check the
 * fields someone thought to name; a byte comparison checks the ones nobody did,
 * including a key the serializer stopped writing and a marker a handler quietly
 * dropped. The studio's Phase 3 contract test reuses this exact file.
 *
 * Determinism is what makes that possible, and it is why the operations take a
 * `ctx` at all: the batch below is applied with a fixed instant and a counting
 * id source, so a re-mint (`insert_shots`, `duplicate_shot`'s trash entries)
 * lands the same ids every time.
 *
 * **Regenerating:** `UPDATE_GOLDEN=1 npx vitest run src/__tests__/golden-after-ops.test.ts`.
 * Do that only when a deliberate change to an operation's SEMANTICS moved the
 * document — never to make a red test green. The diff is the review.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { reserialize } from "../fixtures/build-golden"
import { applyOps } from "../ops/apply"
import type { OpContext } from "../ops/types"
import { parseProduction, type SerializedProduction } from "../shot-graph"
import type { WorkflowLike } from "../workflow-like"

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const AFTER = resolve(FIXTURES, "golden-after-ops.json")

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown

const golden = readJson("golden-production.json") as WorkflowLike
const goldenOps = readJson("golden-ops.json") as ReadonlyArray<unknown>

/** Fixed clock, counting ids — nothing ambient, so the bytes are reproducible. */
function context(): OpContext {
  let minted = 0
  return {
    now: "2026-09-06T12:00:00.000Z",
    mintId: () => `minted-${++minted}`,
  }
}

/** The batch, applied and serialized: nodes, edges and `settings.studio`. */
function afterOps(): SerializedProduction {
  const before = parseProduction(golden)
  return reserialize(applyOps(before, goldenOps, context()).production)
}

/** Pretty JSON with a trailing newline — the shape every committed file has. */
const asFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

describe("applyOps over the golden batch", () => {
  const produced = afterOps()

  if (process.env.UPDATE_GOLDEN) writeFileSync(AFTER, asFile(produced))

  it("serializes byte-identically to the committed fixture", () => {
    expect(asFile(produced)).toBe(readFileSync(AFTER, "utf8"))
  })

  it("is reproducible — the same batch twice is the same bytes", () => {
    expect(asFile(afterOps())).toBe(asFile(produced))
  })

  it("survives a save and a reload with nothing lost, and settles there", () => {
    // CONTENT is preserved exactly; LAYOUT is allowed to move once. An
    // operation stores the object it was handed — `set_voice`'s voice,
    // `set_music_plan`'s selections — in the caller's key order, and the parser
    // rebuilds every one of them in ITS field order on the next load. So the
    // first reload can reorder keys, and the second cannot: the document has
    // settled onto the codec's canonical layout. Anything else (a key gone, a
    // marker dropped) would show up in the deep comparison first.
    const reloaded = reserialize(
      parseProduction({ ...golden, ...produced } as WorkflowLike),
    )
    expect(reloaded).toEqual(produced)

    const again = reserialize(
      parseProduction({ ...golden, ...reloaded } as WorkflowLike),
    )
    expect(JSON.stringify(again)).toBe(JSON.stringify(reloaded))
  })

  it("left the input document untouched", () => {
    const before = parseProduction(golden)
    const snapshot = structuredClone(before)
    applyOps(before, goldenOps, context())
    expect(before).toEqual(snapshot)
  })
})
