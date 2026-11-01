/**
 * Prism's newer reference audio modes, One-tone and Octave (cast-swap
 * 0.426.0), in the admin screens:
 *
 * - offered only where an engine lists them (`castSwap.prismReferenceAudioModes`):
 *   a trend's editor once SOME environment's engine does, Admin → Nodaro
 *   Motion's shared setting once EVERY environment's does; elsewhere greyed
 *   out ("not supported yet"), unless a resolution already has one;
 * - each says what it does; the stored value reads and saves as it is;
 * - its publish need reads as a sentence.
 */
import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import {
  prismReferenceAudioByResolutionOf,
  prismReferenceAudioModesEveryEngineTakes,
  prismReferenceAudioModesSomeEngineTakes,
  prismReferenceAudioNotFull,
} from "../prism-reference-audio"
import { describeBlocker } from "../model"
import { PrismReferenceAudioSelect } from "../components/PrismReferenceAudioSelect"
import { EngineEditor } from "../components/EngineEditor"

const at = (env: string, prismReferenceAudioModes?: CastSwapPrismReferenceAudioId[]): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(prismReferenceAudioModes ? { prismReferenceAudioModes } : {}) } },
})
const ALL: CastSwapPrismReferenceAudioId[] = ["full", "voice", "none", "one-tone", "octave"]

describe("the rules", () => {
  it("a trend's editor offers a mode some environment's engine lists; the shared setting one every environment's lists", () => {
    expect(prismReferenceAudioModesSomeEngineTakes(undefined)).toEqual([])
    expect(prismReferenceAudioModesSomeEngineTakes([at("production"), at("staging")])).toEqual([])
    expect(prismReferenceAudioModesSomeEngineTakes([at("production"), at("staging", ["full", "one-tone"])])).toEqual(["one-tone"])
    expect(prismReferenceAudioModesEveryEngineTakes(undefined)).toEqual([])
    expect(prismReferenceAudioModesEveryEngineTakes([at("production", ALL), at("staging", ["one-tone"])])).toEqual(["one-tone"])
    expect(prismReferenceAudioModesEveryEngineTakes([at("production", ALL)])).toEqual([])
    expect(prismReferenceAudioModesEveryEngineTakes([at("production", ALL), at("staging", ALL)])).toEqual(["one-tone", "octave"])
  })

  it("reads and saves one-tone and octave as they are", () => {
    expect(prismReferenceAudioByResolutionOf("octave")).toEqual({ "480p": "octave", "720p": "octave", "1080p": "octave" })
    expect(prismReferenceAudioNotFull({ "480p": "full", "720p": "one-tone", "1080p": "octave" })).toEqual({ "720p": "one-tone", "1080p": "octave" })
    expect(prismReferenceAudioNotFull({ "480p": "voice" })).toEqual({ "480p": "voice" })
  })

  it("words its publish need", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "prismReferenceAudio:one-tone" })).toBe(
      "production: the Prism reference audio one-tone not supported yet",
    )
  })
})

function Harness({ initial, offered, onChange }: { initial?: CastSwapPrismReferenceAudioByResolution; offered?: CastSwapPrismReferenceAudioId[]; onChange?: (v: CastSwapPrismReferenceAudioByResolution) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <PrismReferenceAudioSelect
      value={value}
      offered={offered}
      unofferedNote="Greyed out: not on the engine yet."
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

describe("the select", () => {
  it("lists One-tone and Octave with what each does", () => {
    render(<Harness offered={["one-tone", "octave"]} />)
    expect(screen.getByText(/flattened to one steady tone: keeps the words' rhythm for lip sync without the melody/)).toBeInTheDocument()
    expect(screen.getByText(/raised one octave: keeps the melody and the words for lip sync/)).toBeInTheDocument()
    expect(screen.queryByText("Greyed out: not on the engine yet.")).not.toBeInTheDocument()
  })

  it("chooses an offered mode per resolution", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness offered={["one-tone", "octave"]} onChange={onChange} />)
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    await user.click(await screen.findByRole("option", { name: "Octave (+12, one octave up)" }))
    expect(onChange).toHaveBeenLastCalledWith({ "480p": "full", "720p": "octave", "1080p": "full" })
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    await user.click(await screen.findByRole("option", { name: "One-tone (flattened, no melody)" }))
    expect(onChange).toHaveBeenLastCalledWith({ "480p": "one-tone", "720p": "octave", "1080p": "full" })
  })

  it("greys out a mode no engine takes, saying so, but keeps one already set", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ "1080p": "octave" }} offered={[]} />)
    expect(screen.getByText("Greyed out: not on the engine yet.")).toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "One-tone (flattened, no melody) (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Octave (+12, one octave up) (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Voice only" })).not.toHaveAttribute("aria-disabled")
    await user.keyboard("{Escape}")
    // 1080p already has Octave: it stays shown and choosable there, to be set to another mode.
    expect(within(screen.getByRole("combobox", { name: "1080p" })).getByText(/Octave/)).toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "1080p" }))
    expect(await screen.findByRole("option", { name: "Octave (+12, one octave up) (not supported yet)" })).not.toHaveAttribute("aria-disabled")
  })
})

describe("a trend's Model section", () => {
  const editor = (envs?: TrendEngineEnvironment[]) => (
    <EngineEditor
      value={undefined}
      klingLength={undefined}
      pulseAudio={undefined}
      prismReferenceAudio={undefined}
      onChange={() => {}}
      onKlingLengthChange={() => {}}
      onPulseAudioChange={() => {}}
      onPrismReferenceAudioChange={() => {}}
      envs={envs}
    />
  )

  it("offers One-tone once some environment's engine lists it", async () => {
    const user = userEvent.setup()
    const { unmount } = render(editor([at("production"), at("staging", ["full", "voice", "none", "one-tone"])]))
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "One-tone (flattened, no melody)" })).not.toHaveAttribute("aria-disabled")
    expect(screen.getByRole("option", { name: "Octave (+12, one octave up) (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    unmount()
    render(editor(undefined))
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "One-tone (flattened, no melody) (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
  })
})
