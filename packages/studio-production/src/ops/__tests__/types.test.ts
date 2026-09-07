/**
 * The operation contract, exercised.
 *
 * Mostly a COMPILE test: it stands up a miniature section exactly the way the
 * twelve real ones must — a schema table, a handler table derived from it, a
 * class table — so a change to `OpHandler`, `SectionHandlers` or `OpReceipt`
 * fails here before it fails in twelve places. The runtime assertions cover the
 * two things types cannot: that an `OpError` carries its code, and that
 * `withOpIndex` stamps a COPY rather than mutating the thrown error.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { OpError, isOpError, opError, withOpIndex } from "../errors"
import type { Production } from "../production"
import type {
  OpClass,
  OpContext,
  OpHandler,
  OpReceipt,
  OpResult,
  SectionClasses,
  SectionHandlers,
} from "../types"
import {
  DEFAULT_CATALOG_GATES,
  resolveCatalogGates,
  type RequestContext,
} from "../../requests/context"

// ── a miniature section, shaped like the twelve real ones ───────────────────

const exampleOpSchemas = {
  rename_shot: z.object({
    op: z.literal("rename_shot"),
    id: z.string(),
    name: z.string(),
  }),
} as const

const exampleHandlers: SectionHandlers<typeof exampleOpSchemas> = {
  rename_shot: (production, op, _ctx) => {
    const shot = production.shots.find((s) => s.id === op.id)
    if (!shot) {
      throw opError("op_target_missing", `No shot ${op.id} in this production.`)
    }
    return {
      production: {
        ...production,
        shots: production.shots.map((s) =>
          s.id === op.id ? { ...s, name: op.name } : s,
        ),
      },
      receipt: { op: "rename_shot", summary: `Renamed a shot to “${op.name}”.` },
    }
  },
}

const exampleClasses: SectionClasses<typeof exampleOpSchemas> = {
  rename_shot: "S",
}

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

const production: Production = {
  shots: [{ id: "shot-1", name: "Opening" }],
}

describe("the operation contract", () => {
  it("applies a handler copy-on-write and reports a receipt", () => {
    const before = production
    const result: OpResult = exampleHandlers.rename_shot(
      production,
      { op: "rename_shot", id: "shot-1", name: "Wide" },
      ctx,
    )

    expect(result.production.shots[0]?.name).toBe("Wide")
    expect(result.production).not.toBe(before)
    expect(before.shots[0]?.name).toBe("Opening")

    const receipt: OpReceipt = result.receipt
    expect(receipt.op).toBe("rename_shot")
    expect(receipt.summary).toBe("Renamed a shot to “Wide”.")
  })

  it("throws a typed OpError for a missing target", () => {
    expect(() =>
      exampleHandlers.rename_shot(
        production,
        { op: "rename_shot", id: "nope", name: "Wide" },
        ctx,
      ),
    ).toThrow(OpError)

    try {
      exampleHandlers.rename_shot(
        production,
        { op: "rename_shot", id: "nope", name: "Wide" },
        ctx,
      )
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
      expect(error.opIndex).toBeUndefined()
    }
  })

  it("stamps an op index onto a COPY of the error", () => {
    const raw = opError("op_invalid", "Nothing to do.")
    const stamped = withOpIndex(raw, 3)

    expect(stamped).not.toBe(raw)
    expect(stamped.opIndex).toBe(3)
    expect(stamped.code).toBe("op_invalid")
    expect(raw.opIndex).toBeUndefined()
  })

  it("declares a confirmation class for every op it declares", () => {
    const classes: ReadonlyArray<OpClass> = Object.values(exampleClasses)
    expect(Object.keys(exampleClasses)).toEqual(Object.keys(exampleOpSchemas))
    expect(classes).toEqual(["S"])
  })

  it("resolves request-builder gates over the package defaults", () => {
    const request: RequestContext = {
      mode: "start",
      gates: { negativePromptSupported: () => true },
    }
    const gates = resolveCatalogGates(request)

    expect(gates.negativePromptSupported("image", "anything")).toBe(true)
    expect(gates.videoAudioField).toBe(DEFAULT_CATALOG_GATES.videoAudioField)
    expect(resolveCatalogGates()).toEqual(DEFAULT_CATALOG_GATES)
  })
})

// Type-only pins: a handler is assignable to `OpHandler<Op>` on its own.
const _pin: OpHandler<z.infer<typeof exampleOpSchemas.rename_shot>> =
  exampleHandlers.rename_shot
void _pin
