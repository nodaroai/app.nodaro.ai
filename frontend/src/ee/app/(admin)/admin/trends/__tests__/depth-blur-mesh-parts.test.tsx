/**
 * Admin → Nodaro Motion's Motion column (decided 2026-11-02): a Full depth's
 * depth blur (`faceMasking.depthBlur`, 0–40, 0 = off) and what the face mesh
 * draws (`faceMasking.faceMeshParts`: Full, Eyes and mouth, Mouth only).
 *
 * - The pure rules: saved only where they change what is drawn (a blur above
 *   0 on Full depth; parts other than the full mesh with the mesh on), so a
 *   setting without them is saved exactly as before; the environments whose
 *   engine lacks each (a shared setting: every environment must have it);
 *   leaving Full depth drops the blur, Keep people drops the parts.
 * - The editor: both controls only where the page offers them (the Motion
 *   column passes its lists; a trend's editor and the Precise column pass
 *   none); greyed out and naming the environments that lack them.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { environmentsThatCannotBlurDepth, environmentsThatCannotDrawFaceMeshParts, withClipPreparation } from "../clip-preparation"
import { cleanMasking, maskingIssues } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const at = (env: string, extra: Record<string, unknown> = {}): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, faceMesh: true, ...extra } },
})
const NEW = { depthBlur: true, faceMeshParts: ["full", "features", "mouth"] }
const ALL_NEW = [at("production", NEW), at("staging", NEW)]
const FD: AdminTrendFaceMasking = { mode: "always", source: "full-depth" }

describe("the rules", () => {
  it("the depth blur is saved on Full depth above 0 only; the parts with the mesh on and not the full mesh", () => {
    expect(cleanMasking({ ...FD, depthBlur: 28 })).toEqual({ ...FD, depthBlur: 28 })
    expect(cleanMasking({ ...FD, depthBlur: 0 })).toEqual(FD)
    expect(cleanMasking({ mode: "always", depthBlur: 28 })).toEqual({ mode: "always" })
    expect(cleanMasking({ ...FD, faceMesh: true, faceMeshParts: "mouth" })).toEqual({ ...FD, faceMesh: true, faceMeshParts: "mouth" })
    expect(cleanMasking({ ...FD, faceMesh: true, faceMeshParts: "full" })).toEqual({ ...FD, faceMesh: true })
    expect(cleanMasking({ ...FD, faceMeshParts: "features" })).toEqual(FD)
    expect(cleanMasking({ mode: "always", source: "keep-people", faceMesh: true, faceMeshParts: "mouth" })).toEqual({ mode: "always", source: "keep-people" })
  })

  it("Save is held on a blur the server would refuse (not whole, or past 40)", () => {
    expect(maskingIssues({ ...FD, depthBlur: 28 })).toEqual([])
    for (const depthBlur of [41, -1, 28.5]) {
      expect(maskingIssues({ ...FD, depthBlur }), String(depthBlur)).toEqual(["Clip preparation: the depth blur is a whole number from 0 to 40."])
    }
  })

  it("leaving Full depth drops the blur; Keep people drops the parts with the mesh", () => {
    expect(withClipPreparation({ ...FD, depthBlur: 28, faceMesh: true, faceMeshParts: "features" }, "faces").masking).toEqual({
      mode: "always",
      faceMesh: true,
      faceMeshParts: "features",
    })
    expect(withClipPreparation({ ...FD, depthBlur: 28, faceMesh: true, faceMeshParts: "features" }, "keep-people").masking).toEqual({ mode: "always", source: "keep-people" })
    expect(withClipPreparation({ mode: "always", faceMesh: true, faceMeshParts: "mouth" }, "full-depth").masking).toEqual({ ...FD, faceMesh: true, faceMeshParts: "mouth" })
  })

  it("the environments that lack each (a Cast Swap engine before 0.430.0, or none recorded); unknown while the environments are", () => {
    expect(environmentsThatCannotBlurDepth(undefined)).toBeUndefined()
    expect(environmentsThatCannotDrawFaceMeshParts(undefined)).toBeUndefined()
    expect(environmentsThatCannotBlurDepth(ALL_NEW)).toEqual([])
    expect(environmentsThatCannotBlurDepth([at("production", NEW), at("staging")])).toEqual(["staging"])
    expect(environmentsThatCannotBlurDepth([at("production", NEW)])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMeshParts(ALL_NEW)).toEqual({ features: [], mouth: [] })
    expect(environmentsThatCannotDrawFaceMeshParts([at("production", { faceMeshParts: ["full", "features"] }), at("staging")])).toEqual({
      features: ["staging"],
      mouth: ["staging", "production"],
    })
  })
})

function Harness({ initial, source, blurMissingIn, partsMissingIn, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  blurMissingIn?: readonly string[]
  partsMissingIn?: Readonly<Record<"features" | "mouth", readonly string[]>>
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      faceMeshMissingIn={[]}
      depthBlurMissingIn={blurMissingIn}
      faceMeshPartsMissingIn={partsMissingIn}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const blurField = () => screen.queryByRole("spinbutton", { name: "Depth blur" })
const partsSelect = () => screen.queryByRole("combobox", { name: "Face mesh lines" })
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)
const NONE_MISSING = { features: [], mouth: [] } as const

describe("the depth blur in the editor", () => {
  it("only where the page offers it (the Motion column), and only on Full depth", () => {
    const { unmount } = render(<Harness initial={FD} source="full-depth" blurMissingIn={[]} />)
    expect(blurField()).toBeEnabled()
    expect(blurField()).toHaveAttribute("min", "0")
    expect(blurField()).toHaveAttribute("max", "40")
    expect(blurField()).toHaveAttribute("step", "1")
    unmount()
    // A trend's editor and the Precise column pass no list: no control.
    const trend = render(<Harness initial={FD} source="full-depth" />)
    expect(blurField()).not.toBeInTheDocument()
    trend.unmount()
    render(<Harness initial={{ mode: "always", fill: "depth" }} blurMissingIn={[]} />)
    expect(blurField()).not.toBeInTheDocument()
  })

  it("a number writes depthBlur; 0 or empty removes the key", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={FD} source="full-depth" blurMissingIn={[]} onValue={(m) => seen.push(m)} />)
    await user.type(blurField()!, "28")
    expect(seen.at(-1)).toEqual({ ...FD, depthBlur: 28 })
    await user.clear(blurField()!)
    expect(seen.at(-1)).toEqual(FD)
    await user.type(blurField()!, "0")
    expect(Object.hasOwn(seen.at(-1)!, "depthBlur")).toBe(false)
  })

  it("greyed out while an environment's engine cannot blur, naming it; one already set stays, to be set back to 0", () => {
    const { unmount } = render(<Harness initial={FD} source="full-depth" blurMissingIn={["staging"]} />)
    expect(blurField()).toBeDisabled()
    expect(screen.getByText("The Cast Swap engine of staging cannot blur the depth map yet, and this setting is shared by every environment.")).toBeInTheDocument()
    unmount()
    render(<Harness initial={{ ...FD, depthBlur: 20 }} source="full-depth" blurMissingIn={["staging"]} />)
    expect(blurField()).toBeEnabled()
    expect(blurField()).toHaveValue(20)
    expect(screen.getByText(/cannot blur the depth map yet, and this setting is shared by every environment: set it to 0 to save\./)).toBeInTheDocument()
  })
})

describe("what the face mesh draws, in the editor", () => {
  it("under the face mesh switch while it is on, only where the page offers it", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial={FD} source="full-depth" partsMissingIn={NONE_MISSING} />)
    expect(partsSelect()).not.toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Face mesh" }))
    expect(partsSelect()).toBeEnabled()
    expect(partsSelect()).toHaveTextContent("Full (default)")
    unmount()
    render(<Harness initial={{ ...FD, faceMesh: true }} source="full-depth" />)
    expect(partsSelect()).not.toBeInTheDocument()
  })

  it("Eyes and mouth / Mouth only write faceMeshParts; Full removes the key; the mesh turned off removes both", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ ...FD, faceMesh: true }} source="full-depth" partsMissingIn={NONE_MISSING} onValue={(m) => seen.push(m)} />)
    await user.click(partsSelect()!)
    expect(optionNames()).toEqual(["Full (default)", "Eyes and mouth", "Mouth only"])
    await user.click(screen.getByRole("option", { name: "Mouth only" }))
    expect(seen.at(-1)).toEqual({ ...FD, faceMesh: true, faceMeshParts: "mouth" })
    await user.click(partsSelect()!)
    await user.click(screen.getByRole("option", { name: "Eyes and mouth" }))
    expect(seen.at(-1)).toEqual({ ...FD, faceMesh: true, faceMeshParts: "features" })
    await user.click(partsSelect()!)
    await user.click(screen.getByRole("option", { name: "Full (default)" }))
    expect(seen.at(-1)).toEqual({ ...FD, faceMesh: true })
    await user.click(partsSelect()!)
    await user.click(screen.getByRole("option", { name: "Mouth only" }))
    await user.click(screen.getByRole("checkbox", { name: "Face mesh" }))
    expect(seen.at(-1)).toEqual(FD)
    expect(partsSelect()).not.toBeInTheDocument()
  })

  it("Faces hidden too (the column's own Faces hidden masking, before the shot list)", () => {
    render(<Harness initial={{ mode: "always", faceMesh: true }} partsMissingIn={NONE_MISSING} />)
    expect(partsSelect()).toBeEnabled()
  })

  it("a part an environment's engine cannot draw is greyed out, naming it; one already chosen says so, to be set back to Full", async () => {
    const user = userEvent.setup()
    const missing = { features: [], mouth: ["production"] }
    const { unmount } = render(<Harness initial={{ ...FD, faceMesh: true }} source="full-depth" partsMissingIn={missing} />)
    await user.click(partsSelect()!)
    expect(optionNames()).toEqual(["Full (default)", "Eyes and mouth", "Mouth only (not supported yet)"])
    expect(screen.getByRole("option", { name: "Mouth only (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    await user.keyboard("{Escape}")
    unmount()
    render(<Harness initial={{ ...FD, faceMesh: true, faceMeshParts: "mouth" }} source="full-depth" partsMissingIn={missing} />)
    expect(
      screen.getByText("The Cast Swap engine of production cannot draw only the mouth of the face mesh yet, and this setting is shared by every environment: choose Full to save."),
    ).toBeInTheDocument()
  })

  it("greyed out while no environment's engine draws any part alone, naming them", () => {
    render(<Harness initial={{ ...FD, faceMesh: true }} source="full-depth" partsMissingIn={{ features: ["staging", "production"], mouth: ["staging", "production"] }} />)
    expect(partsSelect()).toBeDisabled()
    expect(screen.getByText("The Cast Swap engine of staging, production cannot draw only parts of the face mesh yet, and this setting is shared by every environment.")).toBeInTheDocument()
  })
})
