/**
 * Admin → Nodaro Motion's Motion column (2026-11-06): the face mesh's lines
 * chosen layer by layer ("Choose the layers": one switch per layer, any
 * combination). A set a parts value names is saved as that value, exactly as
 * before the switches existed; any other as `faceMeshLayers`, which every
 * environment's engine and platform must take.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { environmentsThatCannotDrawFaceMeshLayers } from "../clip-preparation"
import { cleanMasking } from "../model"
import { faceMeshLinesSaved, layersOfSetting, savedFormOfLayers, withLayer } from "../face-mesh-layers"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const FD: AdminTrendFaceMasking = { mode: "always", source: "full-depth", faceMesh: true }
const NONE_MISSING = { features: [], mouth: [] } as const
const ALL_TAKE = { engine: [], platform: [] }

function Harness({ initial, layersMissing, onValue }: {
  initial: AdminTrendFaceMasking
  layersMissing?: { engine: string[]; platform: string[] }
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState<AdminTrendFaceMasking | undefined>(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source="full-depth"
      faceMeshMissingIn={[]}
      faceMeshPartsMissingIn={NONE_MISSING}
      faceMeshLayersMissing={layersMissing}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const linesSelect = () => screen.getByRole("combobox", { name: "Face mesh lines" })
const layer = (name: string) => screen.getByRole("switch", { name })

describe("the rules", () => {
  it("a setting's layers: its own set, else its parts value's (the full mesh when none)", () => {
    expect(layersOfSetting(undefined)).toEqual({ wireframe: true, eyes: true, lips: true })
    expect(layersOfSetting({ faceMeshParts: "mouth" })).toEqual({ lips: true })
    expect(layersOfSetting({ faceMeshParts: "features", faceMeshLayers: { irises: true, eyes: false } })).toEqual({ irises: true })
    expect(withLayer({ eyes: true }, "eyes", false)).toEqual({})
  })

  it("saved as the parts value that names the set (the full mesh as no key in the masking, as \"full\" where it is not the default)", () => {
    expect(savedFormOfLayers({ wireframe: true, eyes: true, lips: true }, ["full", "features", "mouth"])).toEqual({})
    expect(savedFormOfLayers({ wireframe: true, eyes: true, lips: true }, ["full", "features", "mouth", "contours"], { fullIsDefault: false })).toEqual({ faceMeshParts: "full" })
    expect(savedFormOfLayers({ eyes: true, lips: true, contours: true }, ["full", "features", "mouth", "contours"])).toEqual({ faceMeshParts: "contours" })
    expect(savedFormOfLayers({ eyes: true, lips: true, contours: true }, ["full", "features", "mouth"])).toEqual({ faceMeshLayers: { eyes: true, lips: true, contours: true } })
  })

  it("cleanMasking saves the lines only with the mesh drawn: its parts, or its layers as their parts value, else as layers", () => {
    expect(cleanMasking({ ...FD, faceMeshLayers: { eyes: true, lips: true } })).toEqual({ ...FD, faceMeshParts: "features" })
    expect(cleanMasking({ ...FD, faceMeshLayers: { wireframe: true, eyes: true, lips: true } })).toEqual(FD)
    expect(cleanMasking({ ...FD, faceMeshLayers: { irises: true, bold: true } })).toEqual({ ...FD, faceMeshLayers: { irises: true, bold: true } })
    expect(cleanMasking({ mode: "always", source: "full-depth", faceMeshLayers: { irises: true } })).toEqual({ mode: "always", source: "full-depth" })
    expect(faceMeshLinesSaved({ faceMeshParts: "mouth" }, true)).toEqual({ faceMeshParts: "mouth" })
    expect(faceMeshLinesSaved({ faceMeshParts: "mouth" }, false)).toEqual({})
  })

  it("the environments that cannot take layers, by engine and by platform; unknown while the environments are", () => {
    const at = (env: string, castSwap: Record<string, unknown>, platform?: Record<string, unknown>): TrendEngineEnvironment => ({
      ...ENVIRONMENTS[0]!,
      env,
      supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...castSwap }, ...(platform ? { platform } : {}) },
    })
    expect(environmentsThatCannotDrawFaceMeshLayers(undefined)).toBeUndefined()
    expect(environmentsThatCannotDrawFaceMeshLayers([at("staging", { faceMeshLayers: true }, { faceMeshLayers: true }), at("production", { faceMeshLayers: true })])).toEqual({
      engine: [],
      platform: ["production"],
    })
    expect(environmentsThatCannotDrawFaceMeshLayers([at("staging", {}, { faceMeshLayers: true })])).toEqual({ engine: ["staging", "production"], platform: ["production"] })
  })
})

describe("the switches, in the Motion column's editor", () => {
  it('"Choose the layers" only where the page offers it, and one switch per layer, starting from what is drawn', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial={{ ...FD, faceMeshParts: "features" }} />)
    await user.click(linesSelect())
    expect(screen.queryByRole("option", { name: "Choose the layers" })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    unmount()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ ...FD, faceMeshParts: "features" }} layersMissing={ALL_TAKE} onValue={(m) => seen.push(m)} />)
    await user.click(linesSelect())
    await user.click(screen.getByRole("option", { name: "Choose the layers" }))
    expect(seen.at(-1)).toEqual({ ...FD, faceMeshLayers: { eyes: true, lips: true } })
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "true", "true", "false", "false", "false"])
    await user.click(layer("Irises"))
    await user.click(layer("Bold lines"))
    await user.click(layer("Lip outline"))
    expect(seen.at(-1)).toEqual({ ...FD, faceMeshLayers: { eyes: true, irises: true, bold: true } })
    expect(layer("Contours")).toHaveAccessibleDescription(/turned face hides/)
    // Back to a parts value: the layers removed.
    await user.click(linesSelect())
    await user.click(screen.getByRole("option", { name: "Mouth only" }))
    expect(seen.at(-1)).toEqual({ ...FD, faceMeshParts: "mouth" })
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
  })

  it("bold alone draws nothing: said in place", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ ...FD, faceMeshLayers: { lips: true, bold: true } }} layersMissing={ALL_TAKE} />)
    expect(linesSelect()).toHaveTextContent("Choose the layers")
    await user.click(layer("Lip outline"))
    expect(screen.getByRole("alert")).toHaveTextContent("Turn on at least one layer other than Bold lines")
  })

  it("names the environments that cannot take a set no parts value names; a parts value's set needs nothing", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ ...FD, faceMeshLayers: { eyes: true, lips: true } }} layersMissing={{ engine: ["production"], platform: ["production", "staging"] }} />)
    const lacking = () => screen.queryAllByRole("status").filter((s) => /cannot draw these layers yet/.test(s.textContent ?? ""))
    expect(lacking()).toHaveLength(0)
    await user.click(layer("Irises"))
    expect(lacking().map((s) => s.textContent)).toEqual([expect.stringMatching(/^production, staging cannot draw these layers yet/)])
  })

  it("the face mesh turned off removes the layers too", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ ...FD, faceMeshLayers: { irises: true } }} layersMissing={ALL_TAKE} onValue={(m) => seen.push(m)} />)
    await user.click(screen.getByRole("checkbox", { name: "Face mesh" }))
    expect(seen.at(-1)).toEqual({ mode: "always", source: "full-depth" })
  })
})
