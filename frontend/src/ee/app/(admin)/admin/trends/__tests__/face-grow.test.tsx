/**
 * Admin → Video Remake's face grow (decided 2026-11-23): its own setting (its
 * own row, never a key of the Precise masking), shown in each engine's Precise
 * column beside the masking it applies to.
 *
 * - The pure rules: where it applies (target Face, a covering fill); the
 *   environments whose engine or platform cannot take it; what is saved
 *   (0 is no key).
 * - The field: what is typed is what is set (0 or empty removes it); greyed
 *   out naming the environments that lack it; a value already set stays
 *   editable; a note when it changes nothing with the masking.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { faceGrowApplies, faceGrowMissing } from "../clip-preparation"
import { FaceGrowField } from "../components/FaceGrowField"
import { FACE_GROW_SPEC, faceGrowToSaved } from "../../nodaro-motion/settings-sections"
import { cleanMasking } from "../model"

const at = (env: string, castSwap: Record<string, unknown> = {}, platform?: Record<string, unknown>): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...castSwap }, ...(platform ? { platform } : {}) },
})
const FACE: AdminTrendFaceMasking = { mode: "always", target: "face", fill: "blur" }
const ALL = { engine: [], platform: [] }

describe("the rules", () => {
  it("applies with target Face and a blur or depth fill, the masking on; never with Head, Body or the fill None", () => {
    expect(faceGrowApplies(FACE)).toBe(true)
    expect(faceGrowApplies({ ...FACE, fill: "depth" })).toBe(true)
    expect(faceGrowApplies({ ...FACE, target: "head" })).toBe(false)
    expect(faceGrowApplies({ ...FACE, target: "body" })).toBe(false)
    expect(faceGrowApplies({ ...FACE, fill: "none", faceMesh: true })).toBe(false)
    expect(faceGrowApplies({ ...FACE, mode: "off" })).toBe(false)
    expect(faceGrowApplies(undefined)).toBe(false)
  })

  it("is saved per engine above 0 (0 is no key), and a stored body reads back unchanged", () => {
    expect(faceGrowToSaved({ "nodaro-prism": 18, "nodaro-pulse": 0 })).toEqual({ "nodaro-prism": 18 })
    const body = { faceGrow: { "nodaro-prism": 18 } }
    expect(FACE_GROW_SPEC.bodyOf(FACE_GROW_SPEC.draftOf(FACE_GROW_SPEC.storedOfBody(body)))).toEqual(body)
  })

  it("is never a key of the masking (the masking's clean drops nothing it does not know: it never had the key)", () => {
    expect(cleanMasking(FACE)).toEqual(FACE)
  })

  it("the environments that lack it, by engine and by platform; unknown while the environments are", () => {
    expect(faceGrowMissing(undefined)).toBeUndefined()
    const yes = at("production", { faceGrow: true }, { faceGrow: true })
    expect(faceGrowMissing([yes, at("staging", { faceGrow: true }, { faceGrow: true })])).toEqual(ALL)
    expect(faceGrowMissing([yes, at("staging", {}, { faceGrow: true })])).toEqual({ engine: ["staging"], platform: [] })
    expect(faceGrowMissing([yes, at("staging", { faceGrow: true })])).toEqual({ engine: [], platform: ["staging"] })
  })
})

function Harness({ initial, applies = true, missing = ALL, onValue }: {
  initial: number | undefined
  applies?: boolean
  missing?: { engine: string[]; platform: string[] }
  onValue?: (v: number | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceGrowField
      value={value}
      applies={applies}
      missing={missing}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
    />
  )
}

describe("the field", () => {
  it("sets what is typed; 0 removes it", async () => {
    let last: number | undefined = -1
    render(<Harness initial={undefined} onValue={(v) => (last = v)} />)
    const field = screen.getByLabelText("Face grow")
    await userEvent.type(field, "18")
    expect(last).toBe(18)
    await userEvent.clear(field)
    await userEvent.type(field, "0")
    expect(last).toBeUndefined()
  })

  it("is greyed out while an environment cannot take it, naming it; a value already set stays editable", () => {
    const { unmount } = render(<Harness initial={undefined} missing={{ engine: ["staging"], platform: ["production"] }} />)
    expect(screen.getByLabelText("Face grow")).toBeDisabled()
    expect(screen.getByText(/Cast Swap engine of staging cannot grow the face mask yet/)).toBeInTheDocument()
    expect(screen.getByText(/platform in production does not take the face grow yet/)).toBeInTheDocument()
    unmount()
    render(<Harness initial={18} missing={{ engine: ["staging"], platform: [] }} />)
    expect(screen.getByLabelText("Face grow")).not.toBeDisabled()
  })

  it("says so when the grow changes nothing with the masking (a Head target)", () => {
    render(<Harness initial={18} applies={false} />)
    expect(screen.getByText(/changes nothing/)).toBeInTheDocument()
  })
})
