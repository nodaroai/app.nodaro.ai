/**
 * Admin → Nodaro Motion's Precise column (never the Motion column, whose
 * direct runs do not draw them; decided 2026-11-02): a third fill, None (the faces
 * found but kept as filmed, only the face mesh drawn on them), and the depth
 * blur on a depth fill.
 *
 * - The pure rules: a depth fill's blur is saved where it blurs (above 0);
 *   None needs the face mesh (Save is held otherwise); the environments whose
 *   engine lacks each (None also needs the face mesh there).
 * - The editor: None only where the page offers it (never a trend's editor),
 *   turning the face mesh on and keeping it on; no colormap, depth blur or
 *   blur strength under None; greyed out and naming the environments that
 *   lack each; a value already chosen stays, to be set back.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { depthBlurKindOf, environmentsThatCannotBlurDepthFill, environmentsThatCannotFillNone } from "../clip-preparation"
import { cleanMasking, maskingIssues } from "../model"
import { motionIssues } from "../../nodaro-motion/model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const at = (env: string, extra: Record<string, unknown> = {}): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...extra } },
})
const NEW = { faceMesh: true, maskFillNone: true, depthFillBlur: true }
const FILL: AdminTrendFaceMasking = { mode: "always", fill: "depth" }
const NONE: AdminTrendFaceMasking = { mode: "always", fill: "none", faceMesh: true }

describe("the rules", () => {
  it("a depth fill's blur is saved above 0; where no depth is drawn it is no key", () => {
    expect(depthBlurKindOf(FILL)).toBe("depth-fill")
    expect(depthBlurKindOf(NONE)).toBeNull()
    expect(cleanMasking({ ...FILL, depthBlur: 12 })).toEqual({ ...FILL, depthBlur: 12 })
    expect(cleanMasking({ ...FILL, depthBlur: 0 })).toEqual(FILL)
    expect(cleanMasking({ mode: "always", fill: "blur", depthBlur: 12 })).toEqual({ mode: "always", fill: "blur" })
    expect(cleanMasking({ ...NONE, depthBlur: 12, blurStrengthPct: 3, depthColormap: "inferno", depthModelSize: "small" })).toEqual(NONE)
    // A depth fill keeps its depth model size beside its blur.
    expect(cleanMasking({ ...FILL, depthModelSize: "small", depthBlur: 12 })).toEqual({ ...FILL, depthModelSize: "small", depthBlur: 12 })
  })

  it("Save is held on None without the face mesh, and on a depth fill's blur the server would refuse", () => {
    expect(maskingIssues(NONE)).toEqual([])
    expect(maskingIssues({ mode: "always", fill: "none" })).toEqual(['Face masking: the fill "None" draws only the face mesh, so it needs the face mesh on.'])
    expect(maskingIssues({ ...FILL, depthBlur: 12 })).toEqual([])
    expect(maskingIssues({ ...FILL, depthBlur: 41 })).toEqual(["Face masking: the depth blur is a whole number from 0 to 40."])
    // A setting without either: as before.
    expect(maskingIssues({ mode: "always", fill: "depth", faceMesh: true })).toEqual([])
  })

  it("the Motion setting holds Save on either (the Precise setting's alone); a value not read there is no issue", () => {
    expect(motionIssues({ masking: NONE })).toEqual(['Motion: the fill "None" is the Precise column\'s alone: choose Blur or Depth colors.'])
    expect(motionIssues({ masking: { ...FILL, depthBlur: 12 } })).toEqual(["Motion: a blur on the depth fill is the Precise column's alone: set it there."])
    expect(motionIssues({ masking: { ...FILL, depthBlur: 0 } })).toEqual([])
    expect(motionIssues({ masking: { mode: "always", source: "full-depth", depthBlur: 12 } })).toEqual([])
  })

  it("the environments that lack each (None also needs the face mesh); unknown while the environments are", () => {
    expect(environmentsThatCannotFillNone(undefined)).toBeUndefined()
    expect(environmentsThatCannotBlurDepthFill(undefined)).toBeUndefined()
    expect(environmentsThatCannotFillNone([at("production", NEW), at("staging", NEW)])).toEqual([])
    expect(environmentsThatCannotFillNone([at("production", NEW), at("staging", { maskFillNone: true })])).toEqual(["staging"])
    expect(environmentsThatCannotFillNone([at("production", NEW)])).toEqual(["staging"])
    expect(environmentsThatCannotBlurDepthFill([at("production", NEW), at("staging", NEW)])).toEqual([])
    // Full depth's declaration is not a depth fill's.
    expect(environmentsThatCannotBlurDepthFill([at("production", { depthBlur: true }), at("staging", NEW)])).toEqual(["production"])
  })
})

function Harness({ initial, source, noneMissingIn, fillBlurMissingIn, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  noneMissingIn?: readonly string[]
  fillBlurMissingIn?: readonly string[]
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      faceMeshMissingIn={[]}
      depthColormapsMissingIn={{ grayscale: [], turbo: [], inferno: [], magma: [], viridis: [] }}
      depthModelSizesMissingIn={{ small: [], base: [], large: [] }}
      fillNoneMissingIn={noneMissingIn}
      depthFillBlurMissingIn={fillBlurMissingIn}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const fillSelect = () => screen.getByRole("combobox", { name: "Fill" })
const meshBox = () => screen.getByRole("checkbox", { name: "Face mesh" })
const blurField = () => screen.queryByRole("spinbutton", { name: "Depth blur" })
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)
const NONE_LABEL = "None (faces as filmed, face mesh only)"

describe("the fill None in the editor", () => {
  it("only where the page offers it: never in a trend's editor", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial={{ mode: "always" }} />)
    await user.click(fillSelect())
    expect(optionNames()).toEqual(["Blur (default)", "Depth colors"])
    await user.keyboard("{Escape}")
    unmount()
    render(<Harness initial={{ mode: "always" }} noneMissingIn={[]} />)
    await user.click(fillSelect())
    expect(optionNames()).toEqual(["Blur (default)", "Depth colors", NONE_LABEL])
  })

  it("choosing None turns the face mesh on, which cannot be turned off while None is chosen; no depth or blur controls", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth", depthBlur: 12 }} noneMissingIn={[]} fillBlurMissingIn={[]} onValue={(m) => seen.push(m)} />)
    expect(blurField()).toBeEnabled()
    expect(screen.getByRole("combobox", { name: "Depth colormap" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Depth model" })).toBeInTheDocument()
    await user.click(fillSelect())
    await user.click(screen.getByRole("option", { name: NONE_LABEL }))
    expect(seen.at(-1)).toMatchObject({ mode: "always", fill: "none", faceMesh: true })
    expect(meshBox()).toBeChecked()
    expect(meshBox()).toBeDisabled()
    expect(screen.getByText(/The fill None draws only the face mesh, so it stays on/)).toBeInTheDocument()
    expect(blurField()).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Depth colormap" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Depth model" })).not.toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Blur strength (%)" })).not.toBeInTheDocument()
    // Another fill frees the switch again (the mesh stays on until turned off).
    await user.click(fillSelect())
    await user.click(screen.getByRole("option", { name: "Blur (default)" }))
    expect(meshBox()).toBeEnabled()
    await user.click(meshBox())
    expect(seen.at(-1)).toMatchObject({ mode: "always", fill: "blur" })
    expect(Object.hasOwn(seen.at(-1)!, "faceMesh")).toBe(false)
  })

  it("greyed out while an environment's engine cannot draw it, naming it; one already chosen stays, to be set back", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial={{ mode: "always" }} noneMissingIn={["staging"]} />)
    await user.click(fillSelect())
    const name = `${NONE_LABEL} (not supported yet: staging)`
    expect(screen.getByRole("option", { name })).toHaveAttribute("aria-disabled", "true")
    await user.keyboard("{Escape}")
    unmount()
    render(<Harness initial={NONE} noneMissingIn={["staging"]} />)
    expect(fillSelect()).toHaveTextContent(NONE_LABEL)
    expect(
      screen.getByText(
        "The Cast Swap engine of staging cannot keep the faces as filmed with only the face mesh yet, and this setting is shared by every environment: choose Blur or Depth colors to save.",
      ),
    ).toBeInTheDocument()
  })
})

describe("the depth blur on a depth fill in the editor", () => {
  it("only where the page offers it, and only on the depth fill", async () => {
    const { unmount } = render(<Harness initial={FILL} fillBlurMissingIn={[]} />)
    expect(blurField()).toBeEnabled()
    expect(screen.getByText(/Blurs the depth fill before its colours and the face mesh are drawn on it/)).toBeInTheDocument()
    unmount()
    const trend = render(<Harness initial={FILL} />)
    expect(blurField()).not.toBeInTheDocument()
    trend.unmount()
    render(<Harness initial={{ mode: "always", fill: "blur" }} fillBlurMissingIn={[]} />)
    expect(blurField()).not.toBeInTheDocument()
  })

  it("a number writes depthBlur; 0 removes the key", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={FILL} fillBlurMissingIn={[]} onValue={(m) => seen.push(m)} />)
    await user.type(blurField()!, "12")
    expect(seen.at(-1)).toEqual({ ...FILL, depthBlur: 12 })
    await user.clear(blurField()!)
    await user.type(blurField()!, "0")
    expect(Object.hasOwn(seen.at(-1)!, "depthBlur")).toBe(false)
  })

  it("greyed out while an environment's engine cannot blur a depth fill, naming it; one already set stays, to be set back to 0", () => {
    const { unmount } = render(<Harness initial={FILL} fillBlurMissingIn={["production"]} />)
    expect(blurField()).toBeDisabled()
    expect(screen.getByText("The Cast Swap engine of production cannot blur the depth fill yet, and this setting is shared by every environment.")).toBeInTheDocument()
    unmount()
    render(<Harness initial={{ ...FILL, depthBlur: 9 }} fillBlurMissingIn={["production"]} />)
    expect(blurField()).toBeEnabled()
    expect(screen.getByText(/cannot blur the depth fill yet, and this setting is shared by every environment: set it to 0 to save\./)).toBeInTheDocument()
  })
})
