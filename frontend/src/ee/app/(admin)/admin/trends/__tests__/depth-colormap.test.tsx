/**
 * The depth colormap (`faceMasking.depthColormap`): the depth map's colors
 * wherever Nodaro Motion draws depth (Full depth, Keep people, a Faces hidden
 * depth fill).
 *
 * - The pure rules: saved only where it changes what is drawn (depth drawn,
 *   not the source's default, not under role outlines), so a setting without
 *   one is saved exactly as before; the maps each environment's engine draws
 *   (a trend's: some; Admin → Nodaro Motion's shared setting: every one, per
 *   map); its publish need as a sentence.
 * - The editor ("Depth colormap"): shown wherever depth is drawn (never on a blur fill or with
 *   the mode Off); the default writes no key; a map no engine draws is greyed
 *   out, the whole select while none is offered, saying why; under role
 *   outlines a depth fill is fixed at grayscale, saying why.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import type { VideoDepthColormap } from "@nodaro/shared/media"
import { ENVIRONMENTS } from "./harness"
import {
  DEPTH_COLORMAPS,
  depthColormapApplies,
  depthColormapSaved,
  depthColormapsSomeEngineDraws,
  environmentsThatCannotDrawColormaps,
} from "../clip-preparation"
import { cleanMasking, describeBlocker } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const mapsAt = (env: string, depthColormaps?: VideoDepthColormap[], extra: Record<string, unknown> = {}): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(depthColormaps ? { depthColormaps } : {}), ...extra } },
})
const ALL_MAPS = [mapsAt("production", [...DEPTH_COLORMAPS]), mapsAt("staging", [...DEPTH_COLORMAPS])]
const OLD_ENVS = [mapsAt("production"), mapsAt("staging")]

describe("the depth colormap's rules", () => {
  it("is the depth provider's maps", () => {
    expect(DEPTH_COLORMAPS).toEqual(["grayscale", "turbo", "inferno", "magma", "viridis"])
  })

  it("applies where depth is drawn: Full depth, Keep people, a depth fill (a fill left out is the blur)", () => {
    expect(depthColormapApplies({ source: "full-depth" })).toBe(true)
    expect(depthColormapApplies({ source: "keep-people" })).toBe(true)
    expect(depthColormapApplies({ fill: "depth" })).toBe(true)
    expect(depthColormapApplies({ fill: "blur" })).toBe(false)
    expect(depthColormapApplies({})).toBe(false)
  })

  it("is saved only where it changes what is drawn: never the default, a blur fill, or under role outlines", () => {
    expect(cleanMasking({ mode: "always", fill: "depth", depthColormap: "inferno" })).toEqual({ mode: "always", fill: "depth", depthColormap: "inferno" })
    expect(cleanMasking({ mode: "always", source: "full-depth", depthColormap: "turbo" })).toEqual({ mode: "always", source: "full-depth", depthColormap: "turbo" })
    expect(cleanMasking({ mode: "always", source: "keep-people", depthColormap: "magma" })).toEqual({ mode: "always", source: "keep-people", depthColormap: "magma" })
    for (const m of [
      { mode: "always", fill: "depth", depthColormap: "turbo" },
      { mode: "always", source: "full-depth", depthColormap: "grayscale" },
      { mode: "always", depthColormap: "inferno" },
      { mode: "always", fill: "blur", depthColormap: "inferno" },
      { mode: "always", fill: "depth", roleOutlines: true, depthColormap: "inferno" },
    ] as AdminTrendFaceMasking[]) {
      expect(depthColormapSaved(m), JSON.stringify(m)).toBeUndefined()
      expect(Object.hasOwn(cleanMasking(m), "depthColormap"), JSON.stringify(m)).toBe(false)
    }
    // A blur fill under role outlines keeps its outlines, never a colormap.
    expect(cleanMasking({ mode: "always", roleOutlines: true, depthColormap: "inferno" })).toEqual({ mode: "always", roleOutlines: true })
  })

  it("a trend: the maps some environment's engine draws", () => {
    expect(depthColormapsSomeEngineDraws(undefined)).toEqual([])
    expect(depthColormapsSomeEngineDraws(OLD_ENVS)).toEqual([])
    expect(depthColormapsSomeEngineDraws([mapsAt("production", ["magma"]), mapsAt("staging", ["inferno", "grayscale"])])).toEqual(["grayscale", "inferno", "magma"])
  })

  it("Nodaro Motion's shared setting: per map, the environments that cannot draw it, a missing one included", () => {
    expect(environmentsThatCannotDrawColormaps(undefined)).toBeUndefined()
    const missing = environmentsThatCannotDrawColormaps([mapsAt("production", ["inferno", "magma"]), mapsAt("staging", ["inferno"])])!
    expect(missing.inferno).toEqual([])
    expect(missing.magma).toEqual(["staging"])
    expect(missing.viridis).toEqual(["staging", "production"])
    expect(environmentsThatCannotDrawColormaps([mapsAt("production", ["inferno"])])!.inferno).toEqual(["staging"])
  })

  it("its publish need reads as a sentence", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "depthColormap:inferno" })).toBe(
      "production: the depth colormap inferno not supported yet",
    )
  })
})

function Harness({ initial, source, envs, missingIn, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  envs?: TrendEngineEnvironment[]
  missingIn?: Readonly<Record<VideoDepthColormap, readonly string[]>>
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      envs={envs}
      depthColormapsMissingIn={missingIn}
      offerRoleOutlines
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const colormapSelect = () => screen.queryByRole("combobox", { name: "Depth colormap" })
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)

describe("the face masking editor's depth colors", () => {
  it("is shown wherever depth is drawn, with the source's default", () => {
    for (const [initial, source, shown] of [
      [{ mode: "always", fill: "depth" }, "faces", "Turbo (default)"],
      [{ mode: "always", source: "full-depth" }, "full-depth", "Grayscale (default)"],
      [{ mode: "always", source: "keep-people" }, "keep-people", "Grayscale (default)"],
      [{ mode: "always", source: "keep-people", depthColormap: "magma" }, "keep-people", "Magma"],
    ] as const) {
      const { unmount } = render(<Harness initial={initial} source={source} envs={ALL_MAPS} />)
      expect(colormapSelect(), JSON.stringify(initial)).toBeEnabled()
      expect(colormapSelect()).toHaveTextContent(shown)
      unmount()
    }
  })

  it("is never shown on a blur fill (nothing to colour) or with the mode Off", () => {
    for (const initial of [{ mode: "always" }, { mode: "auto", fill: "blur" }, { mode: "off", fill: "depth" }] as AdminTrendFaceMasking[]) {
      const { unmount } = render(<Harness initial={initial} envs={ALL_MAPS} />)
      expect(colormapSelect(), JSON.stringify(initial)).not.toBeInTheDocument()
      unmount()
    }
  })

  it("a map writes depthColormap; the default removes the key", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth" }} envs={ALL_MAPS} onValue={(m) => seen.push(m)} />)
    await user.click(colormapSelect()!)
    expect(optionNames()).toEqual(["Grayscale", "Turbo (default)", "Inferno", "Magma", "Viridis"])
    await user.click(screen.getByRole("option", { name: "Inferno" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth", depthColormap: "inferno" })
    await user.click(colormapSelect()!)
    await user.click(screen.getByRole("option", { name: "Turbo (default)" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth" })
    expect(Object.hasOwn(seen.at(-1)!, "depthColormap")).toBe(false)
  })

  it("a trend: greys out a map no environment's engine draws", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ mode: "always", source: "full-depth" }} source="full-depth" envs={[mapsAt("production", ["inferno"]), mapsAt("staging")]} />)
    await user.click(colormapSelect()!)
    expect(optionNames()).toEqual(["Grayscale (default)", "Turbo (not supported yet)", "Inferno", "Magma (not supported yet)", "Viridis (not supported yet)"])
    expect(screen.getByRole("option", { name: "Magma (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Inferno" })).not.toHaveAttribute("aria-disabled")
  })

  it("a trend: the select is greyed out while no engine draws another map, and says why", () => {
    render(<Harness initial={{ mode: "always", fill: "depth" }} envs={OLD_ENVS} />)
    expect(colormapSelect()).toBeDisabled()
    expect(screen.getByText("No environment's Cast Swap engine draws other depth colormaps yet: the engine is out of date.")).toBeInTheDocument()
  })

  it("a map already chosen stays shown, and can be set back to the default, while no engine draws it", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth", depthColormap: "viridis" }} envs={OLD_ENVS} onValue={(m) => seen.push(m)} />)
    expect(colormapSelect()).toBeEnabled()
    expect(colormapSelect()).toHaveTextContent("Viridis")
    expect(screen.getByText(/No environment's Cast Swap engine draws the depth in Viridis yet/)).toBeInTheDocument()
    await user.click(colormapSelect()!)
    await user.click(screen.getByRole("option", { name: "Turbo (default)" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth" })
  })

  it("under role outlines a depth fill is fixed at grayscale, and says why", () => {
    const outlines = [mapsAt("production", [...DEPTH_COLORMAPS], { roleOutlines: true }), mapsAt("staging", [...DEPTH_COLORMAPS], { roleOutlines: true })]
    for (const initial of [
      { mode: "always", fill: "depth", roleOutlines: true },
      { mode: "always", fill: "depth", roleOutlines: true, depthColormap: "magma" },
    ] as AdminTrendFaceMasking[]) {
      const { unmount } = render(<Harness initial={initial} envs={outlines} />)
      expect(colormapSelect(), JSON.stringify(initial)).toBeDisabled()
      expect(colormapSelect()).toHaveTextContent("Grayscale")
      expect(screen.getByText(/Role outlines draw the depth fill in grayscale, so every outline colour reads/)).toBeInTheDocument()
      unmount()
    }
  })

  it("Admin → Nodaro Motion: a map is offered only once every environment's engine draws it, naming those that cannot", async () => {
    const user = userEvent.setup()
    const missingIn = environmentsThatCannotDrawColormaps([mapsAt("production", ["inferno", "magma"]), mapsAt("staging", ["inferno"])])!
    const { unmount } = render(<Harness initial={{ mode: "always", fill: "depth" }} missingIn={missingIn} />)
    await user.click(colormapSelect()!)
    expect(optionNames()).toEqual(["Grayscale (not supported yet)", "Turbo (default)", "Inferno", "Magma (not supported yet)", "Viridis (not supported yet)"])
    await user.keyboard("{Escape}")
    unmount()

    render(<Harness initial={{ mode: "always", fill: "depth", depthColormap: "magma" }} missingIn={missingIn} />)
    expect(
      screen.getByText("The Cast Swap engine of staging cannot draw the depth in Magma yet, and this setting is shared by every environment: choose the default to save."),
    ).toBeInTheDocument()
  })

  it("Admin → Nodaro Motion: greyed out while no environment draws another map, naming them", () => {
    render(<Harness initial={{ mode: "always", source: "full-depth" }} source="full-depth" missingIn={environmentsThatCannotDrawColormaps([mapsAt("production")])!} />)
    expect(colormapSelect()).toBeDisabled()
    expect(screen.getByText(/The Cast Swap engine of staging, production cannot draw other depth colormaps yet/)).toBeInTheDocument()
  })
})
