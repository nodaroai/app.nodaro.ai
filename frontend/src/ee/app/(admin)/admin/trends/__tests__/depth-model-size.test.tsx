/**
 * The depth model size (`faceMasking.depthModelSize`): the size of the model
 * that draws the depth wherever Nodaro Motion draws depth (Full depth, Keep
 * people, a Faces hidden depth fill, under role outlines too).
 *
 * - The pure rules: saved only where it changes the render (depth drawn, not
 *   large), so a setting without one is saved exactly as before; role
 *   outlines do not drop it (unlike the colormap); the sizes each
 *   environment's engine draws with (a trend's: some; Admin → Nodaro
 *   Motion's shared setting: every one, per size); its publish need as a
 *   sentence.
 * - The editor ("Depth model"): shown wherever depth is drawn (never on a
 *   blur fill or with the mode Off); Large, the default, writes no key; a
 *   size no engine draws with is greyed out, the whole select while none is
 *   offered, saying why; a size already chosen stays, to be set back.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import type { VideoDepthModelSize } from "@nodaro/shared/media"
import { ENVIRONMENTS } from "./harness"
import { DEPTH_MODEL_SIZES, depthModelSizeSaved, depthModelSizesSomeEngineDraws, environmentsThatCannotDrawModelSizes } from "../clip-preparation"
import { cleanMasking, describeBlocker } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const sizesAt = (env: string, depthModelSizes?: VideoDepthModelSize[], extra: Record<string, unknown> = {}): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(depthModelSizes ? { depthModelSizes } : {}), ...extra } },
})
const ALL_SIZES = [sizesAt("production", [...DEPTH_MODEL_SIZES]), sizesAt("staging", [...DEPTH_MODEL_SIZES])]
const OLD_ENVS = [sizesAt("production"), sizesAt("staging")]

describe("the depth model size's rules", () => {
  it("is the Video Depth node's sizes", () => {
    expect(DEPTH_MODEL_SIZES).toEqual(["small", "base", "large"])
  })

  it("is saved only where it changes the render: never large, a blur fill or an unknown value; kept under role outlines", () => {
    expect(cleanMasking({ mode: "always", fill: "depth", depthModelSize: "small" })).toEqual({ mode: "always", fill: "depth", depthModelSize: "small" })
    expect(cleanMasking({ mode: "always", source: "full-depth", depthModelSize: "base" })).toEqual({ mode: "always", source: "full-depth", depthModelSize: "base" })
    expect(cleanMasking({ mode: "always", source: "keep-people", depthModelSize: "small" })).toEqual({ mode: "always", source: "keep-people", depthModelSize: "small" })
    expect(cleanMasking({ mode: "always", fill: "depth", roleOutlines: true, depthModelSize: "small" })).toEqual({
      mode: "always",
      fill: "depth",
      roleOutlines: true,
      depthModelSize: "small",
    })
    for (const m of [
      { mode: "always", fill: "depth", depthModelSize: "large" },
      { mode: "always", source: "full-depth", depthModelSize: "large" },
      { mode: "always", depthModelSize: "small" },
      { mode: "always", fill: "blur", depthModelSize: "base" },
      { mode: "always", fill: "depth", depthModelSize: "huge" },
    ] as AdminTrendFaceMasking[]) {
      expect(depthModelSizeSaved(m), JSON.stringify(m)).toBeUndefined()
      expect(Object.hasOwn(cleanMasking(m), "depthModelSize"), JSON.stringify(m)).toBe(false)
    }
  })

  it("a trend: the sizes some environment's engine draws with", () => {
    expect(depthModelSizesSomeEngineDraws(undefined)).toEqual([])
    expect(depthModelSizesSomeEngineDraws(OLD_ENVS)).toEqual([])
    expect(depthModelSizesSomeEngineDraws([sizesAt("production", ["base"]), sizesAt("staging", ["small", "large"])])).toEqual(["small", "base", "large"])
  })

  it("Nodaro Motion's shared setting: per size, the environments that cannot draw with it, a missing one included", () => {
    expect(environmentsThatCannotDrawModelSizes(undefined)).toBeUndefined()
    const missing = environmentsThatCannotDrawModelSizes([sizesAt("production", ["small", "base"]), sizesAt("staging", ["small"])])!
    expect(missing.small).toEqual([])
    expect(missing.base).toEqual(["staging"])
    expect(missing.large).toEqual(["staging", "production"])
    expect(environmentsThatCannotDrawModelSizes([sizesAt("production", ["small"])])!.small).toEqual(["staging"])
  })

  it("its publish need reads as a sentence", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "depthModelSize:small" })).toBe("production: the small depth model not supported yet")
  })
})

function Harness({ initial, source, envs, missingIn, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  envs?: TrendEngineEnvironment[]
  missingIn?: Readonly<Record<VideoDepthModelSize, readonly string[]>>
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      envs={envs}
      depthModelSizesMissingIn={missingIn}
      offerRoleOutlines
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const sizeSelect = () => screen.queryByRole("combobox", { name: "Depth model" })
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent)

describe("the face masking editor's depth model", () => {
  it("is shown wherever depth is drawn, role outlines' gray fill included, Large by default", () => {
    const outlines = [sizesAt("production", [...DEPTH_MODEL_SIZES], { roleOutlines: true }), sizesAt("staging", [...DEPTH_MODEL_SIZES], { roleOutlines: true })]
    for (const [initial, source, shown, envs] of [
      [{ mode: "always", fill: "depth" }, "faces", "Large (default)", ALL_SIZES],
      [{ mode: "always", source: "full-depth" }, "full-depth", "Large (default)", ALL_SIZES],
      [{ mode: "always", source: "keep-people" }, "keep-people", "Large (default)", ALL_SIZES],
      [{ mode: "always", source: "keep-people", depthModelSize: "base" }, "keep-people", "Base", ALL_SIZES],
      [{ mode: "always", fill: "depth", roleOutlines: true, depthModelSize: "small" }, "faces", "Small", outlines],
    ] as const) {
      const { unmount } = render(<Harness initial={initial} source={source} envs={[...envs]} />)
      expect(sizeSelect(), JSON.stringify(initial)).toBeEnabled()
      expect(sizeSelect()).toHaveTextContent(shown)
      unmount()
    }
  })

  it("reads an off-list stored value as Large (the default) instead of failing", () => {
    render(<Harness initial={{ mode: "always", fill: "depth", depthModelSize: "medium" as never }} missingIn={environmentsThatCannotDrawModelSizes(OLD_ENVS)!} />)
    expect(sizeSelect()).toHaveTextContent("Large (default)")
  })

  it("is never shown on a blur fill (no depth drawn) or with the mode Off", () => {
    for (const initial of [{ mode: "always" }, { mode: "auto", fill: "blur" }, { mode: "off", fill: "depth" }] as AdminTrendFaceMasking[]) {
      const { unmount } = render(<Harness initial={initial} envs={ALL_SIZES} />)
      expect(sizeSelect(), JSON.stringify(initial)).not.toBeInTheDocument()
      unmount()
    }
  })

  it("a size writes depthModelSize; Large (the default) removes the key", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth" }} envs={ALL_SIZES} onValue={(m) => seen.push(m)} />)
    await user.click(sizeSelect()!)
    expect(optionNames()).toEqual(["Small", "Base", "Large (default)"])
    await user.click(screen.getByRole("option", { name: "Small" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth", depthModelSize: "small" })
    await user.click(sizeSelect()!)
    await user.click(screen.getByRole("option", { name: "Large (default)" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth" })
    expect(Object.hasOwn(seen.at(-1)!, "depthModelSize")).toBe(false)
  })

  it("a trend: greys out a size no environment's engine draws with", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ mode: "always", source: "full-depth" }} source="full-depth" envs={[sizesAt("production", ["small"]), sizesAt("staging")]} />)
    await user.click(sizeSelect()!)
    expect(optionNames()).toEqual(["Small", "Base (not supported yet)", "Large (default)"])
    expect(screen.getByRole("option", { name: "Base (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Small" })).not.toHaveAttribute("aria-disabled")
  })

  it("a trend: the select is greyed out while no engine draws with another size, and says why", () => {
    render(<Harness initial={{ mode: "always", fill: "depth" }} envs={OLD_ENVS} />)
    expect(sizeSelect()).toBeDisabled()
    expect(screen.getByText("No environment's Cast Swap engine draws the depth with other model sizes yet: the engine is out of date.")).toBeInTheDocument()
  })

  it("a size already chosen stays shown, and can be set back to the default, while no engine draws with it", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth", depthModelSize: "base" }} envs={OLD_ENVS} onValue={(m) => seen.push(m)} />)
    expect(sizeSelect()).toBeEnabled()
    expect(sizeSelect()).toHaveTextContent("Base")
    expect(screen.getByText(/No environment's Cast Swap engine draws the depth with the Base model yet/)).toBeInTheDocument()
    await user.click(sizeSelect()!)
    await user.click(screen.getByRole("option", { name: "Large (default)" }))
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth" })
  })

  it("Admin → Nodaro Motion: a size is offered only once every environment's engine draws with it, naming those that cannot", async () => {
    const user = userEvent.setup()
    const missingIn = environmentsThatCannotDrawModelSizes([sizesAt("production", ["small", "base"]), sizesAt("staging", ["small"])])!
    const { unmount } = render(<Harness initial={{ mode: "always", fill: "depth" }} missingIn={missingIn} />)
    await user.click(sizeSelect()!)
    expect(optionNames()).toEqual(["Small", "Base (not supported yet)", "Large (default)"])
    await user.keyboard("{Escape}")
    unmount()

    render(<Harness initial={{ mode: "always", fill: "depth", depthModelSize: "base" }} missingIn={missingIn} />)
    expect(
      screen.getByText("The Cast Swap engine of staging cannot draw the depth with the Base model yet, and this setting is shared by every environment: choose the default to save."),
    ).toBeInTheDocument()
  })

  it("Admin → Nodaro Motion: greyed out while no environment draws with another size, naming them", () => {
    render(<Harness initial={{ mode: "always", source: "full-depth" }} source="full-depth" missingIn={environmentsThatCannotDrawModelSizes([sizesAt("production")])!} />)
    expect(sizeSelect()).toBeDisabled()
    expect(screen.getByText(/The Cast Swap engine of staging, production cannot draw the depth with other model sizes yet/)).toBeInTheDocument()
  })
})
