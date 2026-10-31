/**
 * The face mesh (`faceMasking.faceMesh`): thin face lines drawn on the masked
 * heads (Faces hidden) or on the depth clip (Full depth), never with Keep
 * people.
 *
 * - The pure rules: saved only as `true` (off = no key), dropped on the way
 *   to Keep people, refused there; the environments that cannot draw it
 *   (Admin → Nodaro Motion's shared setting); its publish need as a sentence.
 * - The editor: shown while masking with Faces hidden or Full depth, and only
 *   once some environment's engine draws it (a switch already on stays, to be
 *   turned off); never for Keep people or with the mode Off; unticking
 *   removes the key.
 */
import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { clipPreparationIssues, environmentsThatCannotDrawFaceMesh, someEngineDrawsFaceMesh, withClipPreparation } from "../clip-preparation"
import { cleanMasking, describeBlocker } from "../model"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"

const meshAt = (env: string, faceMesh?: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(faceMesh === undefined ? {} : { faceMesh }) } },
})
const MESH_ENVS = [meshAt("production", true), meshAt("staging", true)]
const OLD_ENVS = [meshAt("production"), meshAt("staging", false)]

describe("the face mesh's rules", () => {
  it("is saved only as true, and never with Keep people", () => {
    expect(cleanMasking({ mode: "always", faceMesh: true })).toEqual({ mode: "always", faceMesh: true })
    expect(cleanMasking({ mode: "always", source: "full-depth", faceMesh: true })).toEqual({ mode: "always", source: "full-depth", faceMesh: true })
    expect(cleanMasking({ mode: "always", faceMesh: false })).toEqual({ mode: "always" })
    expect(cleanMasking({ mode: "always", source: "keep-people", faceMesh: true })).toEqual({ mode: "always", source: "keep-people" })
  })

  it("is dropped on the way to Keep people, and kept between Faces hidden and Full depth", () => {
    expect(withClipPreparation({ mode: "auto", faceMesh: true }, "keep-people").masking).toEqual({ mode: "always", source: "keep-people" })
    expect(withClipPreparation({ mode: "always", faceMesh: true }, "full-depth").masking).toEqual({ mode: "always", source: "full-depth", faceMesh: true })
    expect(withClipPreparation({ mode: "always", source: "full-depth", faceMesh: true }, "faces").masking).toEqual({ mode: "always", faceMesh: true })
  })

  it("names Keep people with a face mesh as a refusal", () => {
    expect(clipPreparationIssues({ mode: "always", source: "keep-people", faceMesh: true })).toEqual([
      "Clip preparation: Keep people keeps the faces as filmed, so it takes no face mesh.",
    ])
    expect(clipPreparationIssues({ mode: "always", source: "full-depth", faceMesh: true })).toEqual([])
  })

  it("Nodaro Motion's shared setting: the environments that cannot draw it, a missing one included", () => {
    expect(environmentsThatCannotDrawFaceMesh(undefined)).toBeUndefined()
    expect(environmentsThatCannotDrawFaceMesh([])).toEqual(["staging", "production"])
    expect(environmentsThatCannotDrawFaceMesh([meshAt("production", true)])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMesh(OLD_ENVS)).toEqual(["staging", "production"])
    expect(environmentsThatCannotDrawFaceMesh(MESH_ENVS)).toEqual([])
  })

  it("a trend offers it once some environment's engine draws it", () => {
    expect(someEngineDrawsFaceMesh(undefined)).toBe(false)
    expect(someEngineDrawsFaceMesh(OLD_ENVS)).toBe(false)
    expect(someEngineDrawsFaceMesh([meshAt("production"), meshAt("staging", true)])).toBe(true)
  })

  it("its publish need reads as a sentence", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "faceMesh" })).toMatch(/production.*the face mesh/)
  })
})

function Harness({ initial, source, envs, onValue }: {
  initial: AdminTrendFaceMasking | undefined
  source?: AdminTrendFaceMaskingSource
  envs?: TrendEngineEnvironment[]
  onValue?: (m: AdminTrendFaceMasking | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <FaceMaskingEditor
      value={value}
      source={source}
      envs={envs}
      onChange={(m) => {
        setValue(m)
        onValue?.(m)
      }}
    />
  )
}

const meshBox = () => screen.queryByRole("checkbox", { name: "Face mesh" })

describe("a trend's face masking editor", () => {
  it("offers the face mesh with Faces hidden and Full depth once some environment's engine draws it", () => {
    for (const [initial, source] of [
      [{ mode: "always" }, "faces"],
      [{ mode: "auto", fill: "depth" }, "faces"],
      [{ mode: "always", source: "full-depth" }, "full-depth"],
    ] as const) {
      const { unmount } = render(<Harness initial={initial} source={source} envs={MESH_ENVS} />)
      expect(meshBox(), JSON.stringify(initial)).toBeEnabled()
      expect(meshBox()).not.toBeChecked()
      unmount()
    }
  })

  it("is never shown for Keep people, with the mode Off, or while no engine draws it", () => {
    for (const [initial, source, envs] of [
      [{ mode: "always", source: "keep-people" }, "keep-people", MESH_ENVS],
      [{ mode: "off" }, "faces", MESH_ENVS],
      [{ mode: "always" }, "faces", OLD_ENVS],
      [{ mode: "always" }, "faces", undefined],
    ] as const) {
      const { unmount } = render(<Harness initial={initial} source={source} envs={envs ? [...envs] : undefined} />)
      expect(meshBox(), JSON.stringify([initial, envs?.length])).not.toBeInTheDocument()
      unmount()
    }
  })

  it("ticked writes faceMesh: true; unticked removes the key (never false)", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", fill: "depth" }} envs={MESH_ENVS} onValue={(m) => seen.push(m)} />)
    await user.click(meshBox()!)
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth", faceMesh: true })
    await user.click(meshBox()!)
    expect(seen.at(-1)).toEqual({ mode: "always", fill: "depth" })
    expect(Object.hasOwn(seen.at(-1)!, "faceMesh")).toBe(false)
  })

  it("a face mesh already on stays shown, and can be turned off, while no engine draws it", async () => {
    const user = userEvent.setup()
    const seen: Array<AdminTrendFaceMasking | undefined> = []
    render(<Harness initial={{ mode: "always", faceMesh: true }} envs={OLD_ENVS} onValue={(m) => seen.push(m)} />)
    expect(meshBox()).toBeChecked()
    expect(meshBox()).toBeEnabled()
    expect(screen.getByText(/No environment's Cast Swap engine draws the face mesh yet/)).toBeInTheDocument()
    await user.click(meshBox()!)
    expect(seen.at(-1)).toEqual({ mode: "always" })
  })
})
