/**
 * Pulse's reference audio ("audio in") in the admin screens: per Pulse output
 * resolution (720p, 1080p) Prism's modes and pitch shift, separate from the
 * Pulse audio ("audio out"):
 *
 * - a resolution left out follows the Pulse audio in effect (decided
 *   2026-11-18): the full mix at +4 with the original audio, at 0 with Kling's
 *   audio; only the resolutions off that default are stored, and nothing at
 *   all when none are; every value is `{ mode, semitones }` (`{ mode: "none" }`);
 * - staging and production share one database, so a value off the default is
 *   offered once EVERY environment's engine declares
 *   `castSwap.pulseReferenceAudio` and its platform claims it; a save that
 *   changes a resolution to one before then is held, naming what is missing
 *   (the server's rule: `pulseReferenceAudioChangedFrom`);
 * - a trend saves it only on a Kling 4 draft.
 */
import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { AdminTrendData, CastSwapPulseAudioId, CastSwapPulseReferenceAudioByResolution, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import {
  pulseReferenceAudioChangedResolutions,
  pulseReferenceAudioDefault,
  pulseReferenceAudioHeldIssues,
  pulseReferenceAudioMissing,
  pulseReferenceAudioNotDefault,
  pulseReferenceAudioOf,
  pulseReferenceAudioOfferedEverywhere,
  pulseReferenceAudioPair,
  pulseReferenceAudioSaved,
  pulseReferenceAudioSwitchMode,
} from "../pulse-reference-audio"
import { describeBlocker, fromForm, toForm } from "../model"
import { PulseReferenceAudioSelect } from "../components/PulseReferenceAudioSelect"
import { EngineEditor } from "../components/EngineEditor"

/** An environment: whether its engine declares the flag, and whether its platform claims it (fresh: the server sends a claim only then). */
const at = (env: string, engine = false, claim = engine): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: {
    castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(engine ? { pulseReferenceAudio: true } : {}) },
    ...(claim ? { platform: { pulseReferenceAudio: true } } : {}),
  },
})
const EVERY = [at("production", true), at("staging", true)]
const NONE = [at("production"), at("staging")]

describe("the default follows the Pulse audio", () => {
  it("is the full mix at +4 with the original audio (or none set), at 0 with Kling's audio", () => {
    expect(pulseReferenceAudioDefault("original")).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault(undefined)).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault(null)).toEqual({ mode: "full", semitones: 4 })
    expect(pulseReferenceAudioDefault("generated")).toEqual({ mode: "full", semitones: 0 })
  })

  it("reads a resolution left out as the default of the Pulse audio given", () => {
    expect(pulseReferenceAudioPair(undefined, "original")).toEqual({ "720p": { mode: "full", semitones: 4 }, "1080p": { mode: "full", semitones: 4 } })
    expect(pulseReferenceAudioPair({ "1080p": { mode: "voice", semitones: 2 } }, "generated")).toEqual({
      "720p": { mode: "full", semitones: 0 },
      "1080p": { mode: "voice", semitones: 2 },
    })
  })

  it("stores only the resolutions off that default, nothing at all when none are", () => {
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full", semitones: 4 } }, "original")).toBeUndefined()
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full", semitones: 0 } }, "generated")).toBeUndefined()
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full" } }, "generated")).toBeUndefined()
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full", semitones: 0 } }, "original")).toEqual({ "720p": { mode: "full", semitones: 0 } })
    expect(pulseReferenceAudioNotDefault({ "720p": { mode: "full", semitones: 4 }, "1080p": { mode: "none" } }, "original")).toEqual({ "1080p": { mode: "none" } })
    expect(pulseReferenceAudioSaved(null, "original")).toEqual({})
  })

  it("writes each value as { mode, semitones } ({ mode: \"none\" } silent, absent semitones 0) and drops what it does not know", () => {
    expect(
      pulseReferenceAudioOf({
        "480p": { mode: "voice", semitones: 2 },
        "720p": { mode: "voice-one-tone" },
        "1080p": { mode: "none", semitones: 3 },
      }),
    ).toEqual({ "720p": { mode: "voice-one-tone", semitones: 0 }, "1080p": { mode: "none" } })
    expect(pulseReferenceAudioOf({ "720p": "voice", "1080p": { mode: "full", semitones: 0.3 } })).toEqual({})
    expect(pulseReferenceAudioOf("full")).toEqual({})
  })

  it("starts a picked mode at the default's pitch shift (0 for a one-tone mode), keeping one the admin set", () => {
    const cur = { mode: "full", semitones: 4 } as const
    expect(pulseReferenceAudioSwitchMode(cur, "voice", false, "original").value).toEqual({ mode: "voice", semitones: 4 })
    expect(pulseReferenceAudioSwitchMode({ mode: "full", semitones: 0 }, "voice", false, "generated").value).toEqual({ mode: "voice", semitones: 0 })
    expect(pulseReferenceAudioSwitchMode(cur, "full-one-tone", false, "original").value).toEqual({ mode: "full-one-tone", semitones: 0 })
    expect(pulseReferenceAudioSwitchMode({ mode: "full", semitones: 7 }, "voice", false, "original")).toEqual({ value: { mode: "voice", semitones: 7 }, own: true })
    expect(pulseReferenceAudioSwitchMode(cur, "voice-one-tone", true, "original").value).toEqual({ mode: "voice-one-tone", semitones: 4 })
  })
})

describe("what every environment takes", () => {
  it("offers a value off the default only once every environment's engine declares it and its platform claims it", () => {
    expect(pulseReferenceAudioOfferedEverywhere(undefined)).toBe(false)
    expect(pulseReferenceAudioOfferedEverywhere(EVERY)).toBe(true)
    expect(pulseReferenceAudioOfferedEverywhere([at("production", true), at("staging", true, false)])).toBe(false)
    expect(pulseReferenceAudioOfferedEverywhere([at("production", true)])).toBe(false)
    expect(pulseReferenceAudioMissing([at("production", true, false), at("staging")])).toEqual({ engine: ["staging"], platform: ["staging", "production"] })
    expect(pulseReferenceAudioMissing(undefined)).toBeUndefined()
  })

  it("counts a change as stored, each side against its own Pulse audio (the server's rule)", () => {
    // Nothing set, the Pulse audio changed: nothing stored, nothing changed.
    expect(pulseReferenceAudioChangedResolutions({}, "generated", {}, "original")).toEqual([])
    // The same sound, now stored where it was not: a change.
    expect(pulseReferenceAudioChangedResolutions({ "720p": { mode: "full", semitones: 4 } }, "generated", {}, "original")).toEqual(["720p"])
    // Taken back to the default: not a change a hold waits for.
    expect(pulseReferenceAudioChangedResolutions({}, "original", { "1080p": { mode: "none" } }, "original")).toEqual([])
    expect(pulseReferenceAudioChangedResolutions({ "1080p": { mode: "none" } }, "original", { "1080p": { mode: "none" } }, "generated")).toEqual([])
  })

  it("holds a changed value off the default while not every environment takes it, naming what is missing; never what was not changed", () => {
    const next = { "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "none" } }
    expect(pulseReferenceAudioHeldIssues(next, "original", { "1080p": { mode: "none" } }, "original", [at("production", true, false), at("staging")])).toEqual([
      "Pulse reference audio, 720p: Voice only at +4 semitones cannot be saved yet: the Cast Swap engine of staging cannot take it, and the platform in staging, production does not take it.",
    ])
    expect(pulseReferenceAudioHeldIssues(next, "original", {}, "original", EVERY)).toEqual([])
    expect(pulseReferenceAudioHeldIssues({ "720p": { mode: "full", semitones: 4 } }, "original", {}, "generated", NONE)).toEqual([])
    expect(pulseReferenceAudioHeldIssues(next, "original", {}, "original", undefined, { envsUnreadable: true })).toEqual([
      "Pulse reference audio, 720p: Voice only at +4 semitones cannot be saved yet: the environments could not be read.",
      "Pulse reference audio, 1080p: No audio cannot be saved yet: the environments could not be read.",
    ])
  })

  it("names its publish need", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "pulseReferenceAudio" })).toBe("production: the Pulse reference audio not supported yet")
  })
})

function Harness({
  initial,
  out,
  envs,
  envsUnreadable,
  onChange,
}: {
  initial?: CastSwapPulseReferenceAudioByResolution
  out?: CastSwapPulseAudioId
  envs?: readonly TrendEngineEnvironment[]
  envsUnreadable?: boolean
  onChange?: (v: CastSwapPulseReferenceAudioByResolution) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PulseReferenceAudioSelect
      value={value}
      out={out}
      envs={envs}
      envsUnreadable={envsUnreadable}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

const pitchAt = (r: string) => within(screen.getByRole("group", { name: r })).getByRole("spinbutton", { name: "Pitch shift (semitones)" })

describe("PulseReferenceAudioSelect", () => {
  it("shows each resolution left out as the default of the Pulse audio beside it, and re-reads it when that changes", () => {
    const { rerender } = render(<PulseReferenceAudioSelect value={{ "1080p": { mode: "voice", semitones: 2 } }} out="original" envs={EVERY} onChange={() => {}} />)
    expect(screen.getAllByRole("group", { name: /p$/ }).map((g) => g.getAttribute("aria-label"))).toEqual(["720p", "1080p"])
    expect(screen.getByRole("combobox", { name: "720p" })).toHaveTextContent("Full mix")
    expect(pitchAt("720p")).toHaveValue("4")
    expect(screen.getByRole("combobox", { name: "1080p" })).toHaveTextContent("Voice only")
    expect(pitchAt("1080p")).toHaveValue("2")
    rerender(<PulseReferenceAudioSelect value={{ "1080p": { mode: "voice", semitones: 2 } }} out="generated" envs={EVERY} onChange={() => {}} />)
    expect(pitchAt("720p")).toHaveValue("0")
    expect(pitchAt("1080p")).toHaveValue("2")
  })

  it("once every environment takes it, saves a resolution changed off the default, and leaves it out again when set back", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness out="original" envs={EVERY} onChange={onChange} />)
    expect(screen.queryAllByRole("status")).toEqual([])
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    await user.click(await screen.findByRole("option", { name: "Voice only" }))
    expect(onChange).toHaveBeenLastCalledWith({ "720p": { mode: "voice", semitones: 4 } })
    await user.click(screen.getByRole("combobox", { name: "1080p" }))
    await user.click(await screen.findByRole("option", { name: "No audio" }))
    expect(onChange).toHaveBeenLastCalledWith({ "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "none" } })
    expect(pitchAt("1080p")).toBeDisabled()
    await user.clear(pitchAt("720p"))
    await user.type(pitchAt("720p"), "-3.5{Enter}")
    expect(onChange).toHaveBeenLastCalledWith({ "720p": { mode: "voice", semitones: -3.5 }, "1080p": { mode: "none" } })
    await user.click(screen.getByRole("combobox", { name: "1080p" }))
    await user.click(await screen.findByRole("option", { name: "Full mix" }))
    expect(onChange).toHaveBeenLastCalledWith({ "720p": { mode: "voice", semitones: -3.5 } })
  })

  it("offers only the default while an environment lacks the engine's flag or the platform's claim, naming each", async () => {
    const user = userEvent.setup()
    render(<Harness out="original" envs={[at("production", true, false), at("staging")]} />)
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toEqual([
      "The Cast Swap engine of staging cannot take the Pulse reference audio yet, and this setting is shared by every environment.",
      "The platform in staging, production does not take the Pulse reference audio yet, and this setting is shared by every environment.",
    ])
    expect(pitchAt("720p")).toBeDisabled()
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    expect(await screen.findByRole("option", { name: "Voice only (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Full mix" })).not.toHaveAttribute("aria-disabled")
  })

  it("keeps a value already off the default open while not offered, to be set back", () => {
    render(<Harness initial={{ "720p": { mode: "full", semitones: 9 } }} out="original" envs={NONE} />)
    expect(pitchAt("720p")).toBeEnabled()
    expect(pitchAt("1080p")).toBeDisabled()
  })

  it("says when the environments could not be read, naming none", () => {
    render(<Harness out="original" envsUnreadable />)
    expect(screen.getByRole("status")).toHaveTextContent("The environments could not be read, so the Pulse reference audio can't be changed from its default yet.")
  })
})

function draft(over: Partial<AdminTrendData> = {}): AdminTrendData {
  return {
    name: { en: "Office dance" },
    source: { videoUrl: "https://cdn.test/src.mp4", durationSec: 12 },
    previewStart: 2,
    slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    ...over,
  } as AdminTrendData
}

describe("a trend's Pulse reference audio", () => {
  it("is saved only on a Kling 4 draft, only off the default of the trend's Pulse audio, and read back", () => {
    const stored = { "720p": { mode: "voice", semitones: 0 } } as const
    expect(fromForm(toForm(draft({ engine: "kling-4", pulseReferenceAudio: stored }))).pulseReferenceAudio).toEqual(stored)
    expect(toForm(draft({ engine: "kling-4", pulseReferenceAudio: stored })).pulseReferenceAudio).toEqual(stored)
    expect(fromForm({ ...toForm(draft({ engine: "kling-4", pulseReferenceAudio: stored })), engine: "seedance-2-5" })).not.toHaveProperty("pulseReferenceAudio")
    expect(fromForm(toForm(draft({ pulseReferenceAudio: stored })))).not.toHaveProperty("pulseReferenceAudio")
    expect(fromForm(toForm(draft({ engine: "kling-4" })))).not.toHaveProperty("pulseReferenceAudio")
    expect(toForm(draft({})).pulseReferenceAudio).toBeUndefined()
    // The full mix at 0 is the default with Kling's audio, and off it with the original audio.
    const form = { ...toForm(draft({ engine: "kling-4" })), pulseReferenceAudio: { "1080p": { mode: "full", semitones: 0 } } } as const
    expect(fromForm(form).pulseReferenceAudio).toEqual({ "1080p": { mode: "full", semitones: 0 } })
    expect(fromForm({ ...form, pulseAudio: "generated" })).not.toHaveProperty("pulseReferenceAudio")
  })

  it("shows under the Model only while the model is Pulse, following the trend's Pulse audio", () => {
    const editor = (engine: "kling-4" | "seedance-2-5", pulseAudio?: CastSwapPulseAudioId) => (
      <EngineEditor
        value={engine}
        klingLength={undefined}
        pulseAudio={pulseAudio}
        prismReferenceAudio={undefined}
        pulseReferenceAudio={undefined}
        onChange={() => {}}
        onKlingLengthChange={() => {}}
        onPulseAudioChange={() => {}}
        onPrismReferenceAudioChange={() => {}}
        onPulseReferenceAudioChange={() => {}}
        envs={EVERY}
      />
    )
    const { rerender } = render(editor("seedance-2-5"))
    expect(screen.queryByRole("group", { name: "Pulse reference audio" })).not.toBeInTheDocument()
    rerender(editor("kling-4"))
    const group = screen.getByRole("group", { name: "Pulse reference audio" })
    expect(within(within(group).getByRole("group", { name: "720p" })).getByRole("spinbutton")).toHaveValue("4")
    rerender(editor("kling-4", "generated"))
    expect(within(within(group).getByRole("group", { name: "720p" })).getByRole("spinbutton")).toHaveValue("0")
  })
})
