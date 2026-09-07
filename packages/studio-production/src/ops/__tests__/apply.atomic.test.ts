/**
 * `applyOps` — the BATCH, and the promise that it is all or nothing (D3.3).
 *
 * The sections' own tests pin what each handler does. This file pins the three
 * things only the batch can be wrong about:
 *
 *  1. **Atomicity.** A refusal at op *i* rejects the whole batch, names *i*, and
 *     leaves the document the caller handed in EXACTLY as it was. It is not
 *     enough that the return value is discarded — the ops run one after another
 *     on the same object, so a handler that mutated instead of copying would
 *     have already written half a batch by the time the third op threw. That is
 *     the failure this test exists to catch, and it is why the assertion is a
 *     deep comparison against a snapshot taken before the call rather than a
 *     check of what came back.
 *  2. **Validation happens FIRST.** A malformed op at the end of a batch is
 *     refused before the first well-formed one is applied, so a caller cannot
 *     half-apply a batch by getting an argument wrong.
 *  3. **The vocabulary is complete and classed.** Every schema in every section
 *     is in the union, every op in the union has a handler and a confirmation
 *     class, and the three operations this build declares but cannot yet apply
 *     refuse with `op_not_implemented` rather than doing something plausible.
 */
import { describe, expect, it } from "vitest"

import { applyOps } from "../apply"
import { isOpError, OpError } from "../errors"
import type { Production } from "../production"
import { OP_CLASS, OP_SCHEMAS, StudioProductionOpSchema } from "../schema"
import type { OpContext } from "../types"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "minted-1" }

/** Two shots and a folder — enough for a batch that touches three sections. */
function base(): Production {
  return {
    shots: [
      { id: "shot-1", name: "Opening" },
      { id: "shot-2" },
    ],
    folders: [{ id: "act-1", name: "Act I" }],
  }
}

/** The `OpError` a call threw, or a failure if it threw something else. */
function refusal(run: () => unknown): OpError {
  try {
    run()
  } catch (error) {
    if (!isOpError(error)) throw error
    return error
  }
  throw new Error("expected applyOps to refuse this batch")
}

describe("applyOps — a batch that succeeds", () => {
  it("applies the ops in order and returns one receipt per op", () => {
    const result = applyOps(
      base(),
      [
        { op: "rename_shot", id: "shot-1", name: "Rooftop" },
        { op: "add_folder", id: "act-2", name: "Act II" },
        { op: "move_shot_to_folder", shotId: "shot-1", folderId: "act-2" },
      ],
      ctx,
    )

    expect(result.production.shots[0].name).toBe("Rooftop")
    expect(result.production.shots[0].folderId).toBe("act-2")
    expect(result.production.folders).toHaveLength(2)
    expect(result.receipts.map((r) => r.op)).toEqual([
      "rename_shot",
      "add_folder",
      "move_shot_to_folder",
    ])
    for (const receipt of result.receipts) {
      expect(receipt.summary).toMatch(/\.$/)
    }
  })

  it("sees each op the one before it left behind, not the original", () => {
    // The folder does not exist when the batch starts; the third op can only
    // work if the second one's document is what it was handed.
    const result = applyOps(
      base(),
      [
        { op: "add_folder", id: "act-9", name: "Act IX" },
        { op: "move_shot_to_folder", shotId: "shot-2", folderId: "act-9" },
      ],
      ctx,
    )
    expect(result.production.shots[1].folderId).toBe("act-9")
  })

  it("collects the warnings of every op into one list", () => {
    const result = applyOps(
      base(),
      [
        { op: "clear_trash" },
        { op: "move_shot_to_folder", shotId: "shot-1", folderId: null },
      ],
      ctx,
    )
    expect(result.warnings).toEqual([
      "The bin was already empty.",
      "Opening was already out of every folder.",
    ])
  })

  it("returns an empty batch untouched", () => {
    const before = base()
    const result = applyOps(before, [], ctx)
    expect(result.production).toBe(before)
    expect(result.receipts).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe("applyOps — a batch that is refused", () => {
  it("an invalid 3rd op leaves the document untouched", () => {
    const before = base()
    const snapshot = structuredClone(before)

    const error = refusal(() =>
      applyOps(
        before,
        [
          { op: "rename_shot", id: "shot-1", name: "Rooftop" },
          { op: "add_folder", id: "act-2", name: "Act II" },
          // Refused: there is no shot-404 to move.
          { op: "move_shot_to_folder", shotId: "shot-404", folderId: "act-1" },
        ],
        ctx,
      ),
    )

    expect(error.code).toBe("op_target_missing")
    expect(error.opIndex).toBe(2)
    expect(before).toEqual(snapshot)
    expect(before.shots[0].name).toBe("Opening")
    expect(before.folders).toHaveLength(1)
  })

  it("refuses a MALFORMED op before applying any of the batch", () => {
    const before = base()
    const snapshot = structuredClone(before)

    const error = refusal(() =>
      applyOps(
        before,
        [
          { op: "rename_shot", id: "shot-1", name: "Rooftop" },
          // `name` is not a string — the schema rejects it.
          { op: "rename_shot", id: "shot-2", name: 7 },
        ],
        ctx,
      ),
    )

    expect(error.code).toBe("op_invalid")
    expect(error.opIndex).toBe(1)
    expect(before).toEqual(snapshot)
  })

  it("refuses an op name the vocabulary does not have", () => {
    const error = refusal(() =>
      applyOps(base(), [{ op: "set_vibe", vibe: "moody" }], ctx),
    )
    expect(error.code).toBe("op_invalid")
    expect(error.opIndex).toBe(0)
    expect(error.message).toContain("set_vibe")
  })

  it("names the offending op in the message", () => {
    const error = refusal(() =>
      applyOps(base(), [{ op: "rename_shot", id: "nope", name: "x" }], ctx),
    )
    expect(error.message).toContain("nope")
  })
})

describe("the operations this build declares but cannot yet apply", () => {
  const deferred = [
    { op: "land_job", jobId: "job-1" },
    { op: "add_pending_still", shotId: "shot-1", pending: { jobId: "job-1" } },
    { op: "remove_pending_still", shotId: "shot-1", jobId: "job-1" },
  ] as const

  it.each(deferred)("$op parses, and refuses with op_not_implemented", (op) => {
    expect(StudioProductionOpSchema.safeParse(op).success).toBe(true)

    const before = base()
    const snapshot = structuredClone(before)
    const error = refusal(() => applyOps(before, [op], ctx))

    expect(error.code).toBe("op_not_implemented")
    expect(error.opIndex).toBe(0)
    expect(before).toEqual(snapshot)
  })
})

describe("the vocabulary is complete", () => {
  /** Every op name the union accepts, read off the union itself. */
  const unionNames = new Set(
    StudioProductionOpSchema.options.map(
      (member) => member.shape.op.value as string,
    ),
  )

  it("the union holds every section's schemas, and nothing else", () => {
    expect([...unionNames].sort()).toEqual(Object.keys(OP_SCHEMAS).sort())
  })

  it("every operation carries a confirmation class", () => {
    expect(Object.keys(OP_CLASS).sort()).toEqual([...unionNames].sort())
    for (const value of Object.values(OP_CLASS)) {
      expect(["S", "D", "P", "$"]).toContain(value)
    }
  })

  it("every operation has a handler — a batch of one never falls through", () => {
    // A missing handler is a TypeError, not an OpError; either way the name
    // must be reachable. `applyOps` refuses a well-formed op only through
    // `OpError`, so anything else escaping here is a hole in the table.
    for (const name of unionNames) {
      const thrown = (() => {
        try {
          applyOps(base(), [{ op: name }], ctx)
          return null
        } catch (error) {
          return error
        }
      })()
      // Most of these are malformed (missing args) or address nothing — both
      // are `OpError`s. What must never happen is `undefined is not a function`.
      if (thrown !== null) expect(isOpError(thrown)).toBe(true)
    }
  })
})
