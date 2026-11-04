/**
 * Prism's reference audio in the admin screens: per output resolution a mode
 * (No audio, Full mix, Voice only, Full mix, one tone, Voice only, one tone)
 * and a pitch shift in semitones (-24 to 24 in steps of 0.5, 0 = none;
 * disabled for No audio):
 *
 * - today's stored ids read as the values they always were, and save as they
 *   were (an id where one says the value, else `{ mode, semitones }`);
 * - staging and production share one database, so in a trend's editor and in
 *   Admin → Nodaro Motion's setting alike, what only some environments take is
 *   offered once EVERY environment takes it: the one-tone modes, and the pitch
 *   field, which needs every engine's flag and every platform's claim (a value
 *   no id says is what older code cannot read). Elsewhere it is greyed out,
 *   each reason naming the environments and what they lack, unless a resolution
 *   already has it (it stays, to be set to another);
 * - a save that changes a resolution to what is not offered is held, naming the
 *   same; what was not changed never is;
 * - which engine takes which value is the server's own table
 *   (backend/src/lib/__tests__/cast-swap-prism-reference-audio.test.ts);
 * - its publish needs read as sentences.
 */
import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioValue, TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import {
  prismReferenceAudioByResolutionOf,
  prismReferenceAudioDefaultSemitones,
  prismReferenceAudioHeldIssues,
  prismReferenceAudioMissing,
  prismReferenceAudioNotDefault,
  prismReferenceAudioOfferOfEvery,
  prismReferenceAudioSaved,
  prismReferenceAudioSwitchMode,
  prismReferenceAudioTriple,
} from "../prism-reference-audio"
import { describeBlocker } from "../model"
import { PrismReferenceAudioSelect } from "../components/PrismReferenceAudioSelect"
import { EngineEditor } from "../components/EngineEditor"

const IDS_0426 = ["full", "voice", "none", "one-tone", "octave"] as const
const WITH_PITCH = [...IDS_0426, "full-one-tone", "voice-one-tone"] as const
/** An environment: what its engine lists, whether its engine has the pitch flag, whether its platform claims it (fresh: the server sends a claim only then). */
const at = (env: string, prismReferenceAudioModes?: readonly string[], pitch = false, claim = pitch): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: {
    castSwap: {
      ...ENVIRONMENTS[0]!.supports.castSwap,
      ...(prismReferenceAudioModes ? { prismReferenceAudioModes: [...prismReferenceAudioModes] } : {}),
      ...(pitch ? { prismReferenceAudioPitch: true } : {}),
    } as never,
    ...(claim ? { platform: { prismReferenceAudioPitch: true } } : {}),
  },
})
const v = (mode: CastSwapPrismReferenceAudioValue["mode"], semitones?: number): CastSwapPrismReferenceAudioValue =>
  semitones === undefined ? { mode } : { mode, semitones }
const every = <const T,>(x: T) => ({ "480p": x, "720p": x, "1080p": x })

/** The server's table: which engine takes which value (before the newer ids, at 0.426.0, with the pitch shift). */
const TAKES: ReadonlyArray<readonly [CastSwapPrismReferenceAudioValue, { before: boolean; at0426: boolean; pitch: boolean }]> = [
  [v("full", 4), { before: true, at0426: true, pitch: true }],
  [v("voice", 4), { before: true, at0426: true, pitch: true }],
  [v("none"), { before: true, at0426: true, pitch: true }],
  [v("full-one-tone", 0), { before: false, at0426: true, pitch: true }],
  [v("full", 12), { before: false, at0426: true, pitch: true }],
  [v("full", 7), { before: false, at0426: false, pitch: true }],
  [v("full", -3.5), { before: false, at0426: false, pitch: true }],
  [v("voice", 0), { before: false, at0426: false, pitch: true }],
  [v("full-one-tone", 4), { before: false, at0426: false, pitch: true }],
  [v("voice-one-tone", 0), { before: false, at0426: false, pitch: true }],
  [v("voice-one-tone", 4), { before: false, at0426: false, pitch: true }],
]

describe("the rules", () => {
  it("reads today's ids as the values they always were, and saves them as they were", () => {
    expect(prismReferenceAudioTriple("octave")).toEqual(every({ mode: "full", semitones: 12 }))
    expect(prismReferenceAudioTriple({ "720p": "one-tone", "1080p": "voice" })).toEqual({
      "480p": { mode: "full", semitones: 4 },
      "720p": { mode: "full-one-tone", semitones: 0 },
      "1080p": { mode: "voice", semitones: 4 },
    })
    expect(prismReferenceAudioTriple(null)).toEqual(every({ mode: "full", semitones: 4 }))
    expect(prismReferenceAudioTriple({ "720p": "none" })["720p"]?.mode).toBe("none")
    expect(prismReferenceAudioSaved(prismReferenceAudioTriple({ "480p": "full", "720p": "none", "1080p": "voice" }))).toEqual({
      "480p": "full",
      "720p": "none",
      "1080p": "voice",
    })
    expect(prismReferenceAudioNotDefault({ "480p": "full", "720p": "one-tone", "1080p": "octave" })).toEqual({ "720p": "one-tone", "1080p": "octave" })
    expect(prismReferenceAudioNotDefault(every("full"))).toBeUndefined()
    expect(prismReferenceAudioByResolutionOf("octave")).toEqual(every("octave"))
    expect(prismReferenceAudioByResolutionOf({ "720p": "voice", "4k": "none", "1080p": "loud" })).toEqual({ "720p": "voice" })
  })

  it("says a value as today's id only where the id sounds like it; any other as { mode, semitones }", () => {
    expect(
      prismReferenceAudioNotDefault({ "480p": { mode: "full", semitones: 4 }, "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "full", semitones: 7 } }),
    ).toEqual({ "720p": "voice", "1080p": { mode: "full", semitones: 7 } })
    expect(prismReferenceAudioNotDefault({ "720p": { mode: "none", semitones: 9 } })).toEqual({ "720p": "none" })
    expect(prismReferenceAudioNotDefault({ "720p": { mode: "full-one-tone", semitones: 0 }, "1080p": { mode: "full", semitones: 12 } })).toEqual({
      "720p": "one-tone",
      "1080p": "octave",
    })
    expect(prismReferenceAudioByResolutionOf({ "720p": { mode: "voice-one-tone", semitones: -2.5 }, "1080p": { mode: "full" } })).toEqual({
      "720p": { mode: "voice-one-tone", semitones: -2.5 },
      "1080p": { mode: "full", semitones: 0 },
    })
  })

  it.each(TAKES)("offers %j as the server takes it", (value, expected) => {
    const both = (modes?: readonly string[], pitch = false) => [at("production", modes, pitch), at("staging", modes, pitch)]
    expect(prismReferenceAudioOfferOfEvery(both()).value(value)).toBe(expected.before)
    expect(prismReferenceAudioOfferOfEvery(both(IDS_0426)).value(value)).toBe(expected.at0426)
    expect(prismReferenceAudioOfferOfEvery(both(WITH_PITCH, true)).value(value)).toBe(expected.pitch)
  })

  it("offers what every environment takes, in a trend's editor as on the shared setting", () => {
    const mixed = [at("production", IDS_0426), at("staging", WITH_PITCH, true)]
    const offer = prismReferenceAudioOfferOfEvery(mixed)
    expect(offer.pitch).toBe(false)
    expect(offer.value(v("full", 7))).toBe(false)
    expect(offer.mode("voice-one-tone")).toBe(false)
    expect(offer.mode("full-one-tone")).toBe(true)
    // A missing environment takes nothing beyond what every engine takes.
    const one = prismReferenceAudioOfferOfEvery([at("production", WITH_PITCH, true)])
    expect(one.pitch).toBe(false)
    expect(one.value(v("full", 7))).toBe(false)
    // Unknown while the environments are: only what every engine takes.
    const unknown = prismReferenceAudioOfferOfEvery(undefined)
    expect(unknown.pitch).toBe(false)
    expect(["none", "full", "voice", "full-one-tone", "voice-one-tone"].filter((m) => unknown.mode(m as never))).toEqual(["none", "full", "voice"])
    expect(unknown.value(v("voice", 4))).toBe(true)
    expect(unknown.value(v("full", 12))).toBe(false)
    expect(prismReferenceAudioMissing(undefined)).toBeUndefined()
  })

  it("a value no id says needs every environment's platform claim as well as its engine flag; an id never needs a claim", () => {
    const noClaim = [at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)]
    const offer = prismReferenceAudioOfferOfEvery(noClaim)
    expect(offer.pitch).toBe(false)
    expect(offer.value(v("full", 7))).toBe(false)
    expect(offer.value(v("full-one-tone", 4))).toBe(false)
    expect(offer.mode("voice-one-tone")).toBe(false)
    // What older code reads is every engine's matter alone.
    expect(offer.value(v("full", 12))).toBe(true)
    expect(offer.value(v("full-one-tone", 0))).toBe(true)
    expect(offer.value(v("voice", 4))).toBe(true)
    expect(offer.mode("full-one-tone")).toBe(true)
    // A claim without the engine's flag is not enough either.
    const noFlag = prismReferenceAudioOfferOfEvery([at("production", IDS_0426, false, true), at("staging", IDS_0426, false, true)])
    expect(noFlag.pitch).toBe(false)
    expect(noFlag.value(v("full", 7))).toBe(false)
    expect(noFlag.mode("voice-one-tone")).toBe(false)
    // Both, everywhere.
    const both = prismReferenceAudioOfferOfEvery([at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)])
    expect(both.pitch).toBe(true)
    expect(both.value(v("voice-one-tone", -3.5))).toBe(true)
    expect(both.mode("voice-one-tone")).toBe(true)
  })

  it("names what each environment lacks, apart: the engine's flag, the platform's claim, a one-tone mode's listing", () => {
    expect(prismReferenceAudioMissing([at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)])).toEqual({
      engine: [],
      platform: [],
      modes: { "full-one-tone": [], "voice-one-tone": [] },
    })
    expect(prismReferenceAudioMissing([at("production", WITH_PITCH, true, false), at("staging", IDS_0426, false, true)])).toEqual({
      engine: ["staging"],
      platform: ["production"],
      modes: { "full-one-tone": [], "voice-one-tone": ["staging"] },
    })
    // No row at all: it lacks everything. An engine with the flag that does not list a mode lacks just that.
    expect(prismReferenceAudioMissing([at("production", IDS_0426, true)])).toEqual({
      engine: ["staging"],
      platform: ["staging"],
      modes: { "full-one-tone": ["staging", "production"], "voice-one-tone": ["staging", "production"] },
    })
  })

  describe("what a save holds", () => {
    const LACKING = [at("production", IDS_0426, true), at("staging", IDS_0426)]

    it("only a resolution it changed; never what it leaves as stored", () => {
      const stored = { "480p": { mode: "full", semitones: 7 } } as const
      expect(prismReferenceAudioHeldIssues(stored, stored, LACKING)).toEqual([])
      // Written another way, or as the screens hold it: the same.
      expect(prismReferenceAudioHeldIssues(prismReferenceAudioTriple(stored), stored, LACKING)).toEqual([])
      // Another resolution moved to what every environment takes.
      expect(prismReferenceAudioHeldIssues({ ...stored, "720p": "none" }, stored, LACKING)).toEqual([])
      // The value itself moved.
      expect(prismReferenceAudioHeldIssues({ "480p": { mode: "full", semitones: 8 } }, stored, LACKING)).toEqual([
        "Prism reference audio, 480p: Full mix at +8 semitones cannot be saved yet: the Cast Swap engine of staging cannot take it, and the platform in staging does not take it.",
      ])
    })

    it("says what is missing, the engine's and the platform's apart", () => {
      const next = { "720p": { mode: "voice-one-tone", semitones: -2 } } as const
      expect(prismReferenceAudioHeldIssues(next, undefined, [at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)])).toEqual([
        "Prism reference audio, 720p: Voice only, one tone at -2 semitones cannot be saved yet: the platform in production does not take it.",
      ])
      expect(prismReferenceAudioHeldIssues(next, undefined, [at("production", IDS_0426, true), at("staging", WITH_PITCH, true)])).toEqual([
        "Prism reference audio, 720p: Voice only, one tone at -2 semitones cannot be saved yet: the Cast Swap engine of production cannot take it.",
      ])
      expect(prismReferenceAudioHeldIssues(next, undefined, [at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)])).toEqual([])
    })

    it("with the environments unknown, says so and names none: loading, or a read that failed", () => {
      const next = { "720p": { mode: "full", semitones: 8 } } as const
      const stored = { "720p": { mode: "full", semitones: 7 } } as const
      expect(prismReferenceAudioHeldIssues(next, stored, undefined)).toEqual([
        "Prism reference audio, 720p: Full mix at +8 semitones cannot be saved yet: the environments are still loading.",
      ])
      expect(prismReferenceAudioHeldIssues(next, stored, undefined, { envsUnreadable: true })).toEqual([
        "Prism reference audio, 720p: Full mix at +8 semitones cannot be saved yet: the environments could not be read.",
      ])
      expect(prismReferenceAudioHeldIssues(stored, stored, undefined, { envsUnreadable: true })).toEqual([])
      // Set back to its mode's default: what every engine takes is never held.
      expect(prismReferenceAudioHeldIssues({ "720p": { mode: "full", semitones: 4 } }, stored, undefined, { envsUnreadable: true })).toEqual([])
      // A value an id says: a trend's save takes it even so (publishing does not), the shared setting holds it.
      expect(prismReferenceAudioHeldIssues({ "720p": "octave" }, stored, undefined, { idsToo: false, envsUnreadable: true })).toEqual([])
      expect(prismReferenceAudioHeldIssues({ "720p": "octave" }, stored, undefined, { envsUnreadable: true })).toHaveLength(1)
      // Environments known (a read that failed since they were): what they lack, as ever.
      expect(prismReferenceAudioHeldIssues(next, stored, [at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)], { envsUnreadable: true })).toEqual([
        "Prism reference audio, 720p: Full mix at +8 semitones cannot be saved yet: the platform in production does not take it.",
      ])
    })

    it("with the environments unknown, what a changed value can still save: the sentence's one exception is a trend's Full mix at +12", () => {
      const stored = { "720p": { mode: "full", semitones: 7 } } as const
      const saves = (options: { idsToo?: boolean }) => {
        const out: string[] = []
        for (const mode of ["full", "voice", "full-one-tone", "voice-one-tone"] as const) {
          for (let semitones = -24; semitones <= 24; semitones += 0.5) {
            if (mode === "full" && semitones === 7) continue
            const held = prismReferenceAudioHeldIssues({ "720p": { mode, semitones } }, stored, undefined, { ...options, envsUnreadable: true })
            if (held.length === 0) out.push(`${mode} ${semitones}`)
          }
        }
        return out
      }
      // A mode's default, and on a trend what an id says too; a field reaches the Full mix, one tone at 0 only from a stored one-tone.
      expect(saves({})).toEqual(["full 4", "voice 4"])
      expect(saves({ idsToo: false })).toEqual(["full 4", "full 12", "voice 4", "full-one-tone 0"])
    })

    it("a value an id says: the shared setting holds it while an engine does not list it; a trend's save never does (publishing does)", () => {
      const octave = { "720p": "octave" } as const
      const notListed = [at("production"), at("staging", IDS_0426)]
      expect(prismReferenceAudioHeldIssues(octave, undefined, notListed)).toEqual([
        "Prism reference audio, 720p: Full mix at +12 semitones cannot be saved yet: the Cast Swap engine of production cannot take it.",
      ])
      expect(prismReferenceAudioHeldIssues(octave, undefined, notListed, { idsToo: false })).toEqual([])
      expect(prismReferenceAudioHeldIssues({ "720p": { mode: "full", semitones: 7 } }, undefined, notListed, { idsToo: false })).toHaveLength(1)
    })
  })

  it("starts a one-tone mode at 0 and the others at +4, and moves only a pitch shift the admin has not set", () => {
    expect(["none", "full", "voice", "full-one-tone", "voice-one-tone"].map((m) => prismReferenceAudioDefaultSemitones(m as never))).toEqual([4, 4, 4, 0, 0])
    const at = (mode: CastSwapPrismReferenceAudioValue["mode"], semitones: number) => ({ mode, semitones })
    // At its mode's default, never typed: the new mode's default.
    expect(prismReferenceAudioSwitchMode(at("full", 4), "full-one-tone", false, true)).toEqual({ value: at("full-one-tone", 0), own: false })
    expect(prismReferenceAudioSwitchMode(at("voice-one-tone", 0), "voice", false, true)).toEqual({ value: at("voice", 4), own: false })
    expect(prismReferenceAudioSwitchMode(at("full-one-tone", 0), "voice-one-tone", false, true)).toEqual({ value: at("voice-one-tone", 0), own: false })
    // No audio keeps the pitch it was given, and the next mode starts at its own default.
    expect(prismReferenceAudioSwitchMode(at("full-one-tone", 0), "none", false, true)).toEqual({ value: at("none", 0), own: false })
    expect(prismReferenceAudioSwitchMode(at("none", 0), "full", false, true)).toEqual({ value: at("full", 4), own: false })
    // Typed, even at a default: it stays.
    expect(prismReferenceAudioSwitchMode(at("full", 4), "full-one-tone", true, true)).toEqual({ value: at("full-one-tone", 4), own: true })
    // Off its mode's default as stored (today's octave): it stays, and is the admin's from then on.
    expect(prismReferenceAudioSwitchMode(at("full", 12), "voice", false, true)).toEqual({ value: at("voice", 12), own: true })
    expect(prismReferenceAudioSwitchMode(at("full", 7), "none", false, true)).toEqual({ value: at("none", 7), own: true })
    // The pitch field closed (not on every environment yet): the next mode lands on what every environment takes,
    // not on a value no id says, whatever was stored; what was typed still stays.
    expect(prismReferenceAudioSwitchMode(at("full", 12), "voice", false, false)).toEqual({ value: at("voice", 4), own: false })
    expect(prismReferenceAudioSwitchMode(at("full", 7), "full-one-tone", false, false)).toEqual({ value: at("full-one-tone", 0), own: false })
    expect(prismReferenceAudioSwitchMode(at("full", 7), "voice", true, false)).toEqual({ value: at("voice", 7), own: true })
  })

  it("words its publish needs", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "prismReferenceAudio:one-tone" })).toBe(
      "production: the Prism reference audio one-tone not supported yet",
    )
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "prismReferenceAudio:voice-one-tone" })).toBe(
      "production: the Prism reference audio voice-one-tone not supported yet",
    )
    expect(describeBlocker({ code: "engine_unsupported", env: "staging", need: "prismReferenceAudioPitch" })).toBe(
      "staging: the Prism reference audio pitch shift not supported yet",
    )
  })
})

const EVERYTHING: TrendEngineEnvironment[] = [at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)]
const NOTHING_NEW: TrendEngineEnvironment[] = [at("production"), at("staging")]

function Harness({
  initial,
  envs,
  envsUnreadable,
  sharedBy,
  onChange,
}: {
  initial?: CastSwapPrismReferenceAudioByResolution
  envs?: readonly TrendEngineEnvironment[]
  envsUnreadable?: boolean
  sharedBy?: "setting" | "trend"
  onChange?: (v: CastSwapPrismReferenceAudioByResolution) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PrismReferenceAudioSelect
      value={value}
      envs={envs}
      envsUnreadable={envsUnreadable}
      sharedBy={sharedBy}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const pitchAt = (resolution: string) => within(screen.getByRole("group", { name: resolution })).getByRole("spinbutton", { name: "Pitch shift (semitones)" })

describe("the select", () => {
  it("shows a mode and a pitch shift per output resolution, the default the full mix at +4", () => {
    render(<Harness envs={EVERYTHING} />)
    for (const r of ["480p", "720p", "1080p"]) {
      expect(screen.getByRole("combobox", { name: r })).toHaveTextContent("Full mix")
      const pitch = pitchAt(r)
      expect(pitch).toHaveValue("4")
      expect(pitch).toHaveAttribute("aria-valuemin", "-24")
      expect(pitch).toHaveAttribute("aria-valuemax", "24")
      expect(pitch).toHaveAccessibleDescription(/0 = no pitch shift/)
    }
    expect(screen.getAllByText("0 = no pitch shift")).toHaveLength(1)
  })

  // The real measure is the browser's; jsdom has no layout, so the classes that make it are pinned.
  it("is a 44 px target at phone width, 36 px from 640 px up: the select, the field and each option", async () => {
    const user = userEvent.setup()
    render(<Harness envs={EVERYTHING} />)
    for (const r of ["480p", "720p", "1080p"]) {
      expect(screen.getByRole("combobox", { name: r })).toHaveClass("min-h-11", "sm:min-h-0")
      expect(pitchAt(r)).toHaveClass("h-11", "sm:h-9")
    }
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    await screen.findByRole("listbox")
    for (const option of screen.getAllByRole("option")) expect(option).toHaveClass("min-h-11", "sm:min-h-0")
  })

  const columnsOf = (el: HTMLElement) => el.className.split(/\s+/).filter((c) => c.startsWith("sm:grid-cols-"))

  it("from 640 px up is one row per resolution on one set of column widths; below it, label, select and field stack", () => {
    render(<Harness envs={EVERYTHING} />)
    const rows = ["480p", "720p", "1080p"].map((r) => screen.getByRole("group", { name: r }))
    expect(columnsOf(rows[0]!)).toHaveLength(1)
    // The select takes the room the label and the field leave.
    expect(columnsOf(rows[0]!)[0]).toContain("minmax(0,1fr)")
    for (const [i, row] of rows.entries()) {
      expect(row).toHaveClass("flex", "flex-col", "sm:grid", "sm:items-center")
      expect(columnsOf(row)).toEqual(columnsOf(rows[0]!))
      // In the row's order: its label, the select, then the field.
      const parts = Array.from(row.querySelectorAll("label, [role=combobox], [role=spinbutton]")).map((el) => el.getAttribute("role") ?? el.textContent)
      expect(parts).toEqual([["480p", "720p", "1080p"][i], "combobox", "Pitch shift (semitones)", "spinbutton"])
      expect(within(row).getByRole("combobox")).toHaveClass("w-full", "min-w-0")
    }
  })

  it("names the pitch shift once over its column from 640 px up, each field keeping its own name", () => {
    render(<Harness envs={EVERYTHING} />)
    // The column's heading, for the eye: a screen reader has each field's own label.
    const heading = screen.getAllByText("Pitch shift (semitones)").find((el) => el.closest("[aria-hidden=true]"))!
    const head = heading.closest<HTMLElement>("[aria-hidden=true]")!
    expect(head).toHaveClass("hidden", "sm:grid")
    expect(heading).toHaveClass("sm:col-start-3")
    expect(columnsOf(head)).toEqual(columnsOf(screen.getByRole("group", { name: "480p" })))
    for (const r of ["480p", "720p", "1080p"]) {
      const label = within(screen.getByRole("group", { name: r })).getByText("Pitch shift (semitones)")
      expect(label.tagName).toBe("LABEL")
      // Shown while they stack; from 640 px up the heading says it.
      expect(label).toHaveClass("sm:sr-only")
      expect(pitchAt(r)).toHaveAccessibleName("Pitch shift (semitones)")
    }
  })

  it("lets the longest name end in an ellipsis where the select is too narrow for it, nothing of it lost to a screen reader", () => {
    render(<Harness initial={{ "720p": { mode: "voice-one-tone", semitones: 3 } }} envs={[at("production", IDS_0426), at("staging", IDS_0426)]} />)
    const select = screen.getByRole("combobox", { name: "720p" })
    const name = select.querySelector("[data-slot=select-value] > span")
    expect(name).toHaveClass("min-w-0", "truncate")
    expect(name).toHaveTextContent("Voice only, one tone (not supported yet)")
    expect(select).toHaveTextContent("Voice only, one tone (not supported yet)")
  })

  it("says a resolution's own reason under its select and field, and the group's reasons below the rows", () => {
    render(<Harness initial={{ "720p": { mode: "full", semitones: 7 } }} envs={[at("production", IDS_0426), at("staging", IDS_0426)]} />)
    const row = screen.getByRole("group", { name: "720p" })
    expect(within(row).getByText("This pitch shift is not supported yet.")).toHaveClass("sm:col-span-2", "sm:col-start-2")
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0)
    for (const r of ["480p", "720p", "1080p"]) expect(within(screen.getByRole("group", { name: r })).queryByRole("status")).not.toBeInTheDocument()
    // After the last row, in reading order too.
    const last = screen.getByRole("group", { name: "1080p" })
    for (const status of screen.getAllByRole("status")) expect(last.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("lets a phone type a minus: the field's keyboard is not the decimal pad, which has none on an iPhone", () => {
    render(<Harness envs={EVERYTHING} />)
    expect(pitchAt("480p")).toHaveAttribute("inputmode", "text")
  })

  it("lists the five modes", async () => {
    const user = userEvent.setup()
    render(<Harness envs={EVERYTHING} />)
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["No audio", "Full mix", "Voice only", "Full mix, one tone", "Voice only, one tone"])
  })

  it("chooses a mode and a pitch shift per resolution, each on its own", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness envs={EVERYTHING} onChange={onChange} />)
    await user.click(screen.getByRole("combobox", { name: "720p" }))
    await user.click(await screen.findByRole("option", { name: "Voice only, one tone" }))
    // A one-tone mode starts unpitched, as today's one-tone.
    expect(onChange).toHaveBeenLastCalledWith({
      "480p": { mode: "full", semitones: 4 },
      "720p": { mode: "voice-one-tone", semitones: 0 },
      "1080p": { mode: "full", semitones: 4 },
    })
    await user.clear(pitchAt("720p"))
    await user.type(pitchAt("720p"), "-3.5{Enter}")
    expect(onChange).toHaveBeenLastCalledWith({
      "480p": { mode: "full", semitones: 4 },
      "720p": { mode: "voice-one-tone", semitones: -3.5 },
      "1080p": { mode: "full", semitones: 4 },
    })
    await user.clear(pitchAt("1080p"))
    await user.type(pitchAt("1080p"), "0{Enter}")
    expect(onChange).toHaveBeenLastCalledWith({
      "480p": { mode: "full", semitones: 4 },
      "720p": { mode: "voice-one-tone", semitones: -3.5 },
      "1080p": { mode: "full", semitones: 0 },
    })
  })

  it("moves the pitch shift to the mode's default on a mode switch, never one the admin typed or saved", async () => {
    const user = userEvent.setup()
    render(<Harness envs={EVERYTHING} initial={{ "1080p": "octave" }} />)
    const choose = async (resolution: string, option: string) => {
      await user.click(screen.getByRole("combobox", { name: resolution }))
      await user.click(await screen.findByRole("option", { name: option }))
    }
    // 480p, never typed: each mode's default.
    await choose("480p", "Full mix, one tone")
    expect(pitchAt("480p")).toHaveValue("0")
    await choose("480p", "Voice only")
    expect(pitchAt("480p")).toHaveValue("4")
    await choose("480p", "Voice only, one tone")
    expect(pitchAt("480p")).toHaveValue("0")
    await choose("480p", "No audio")
    await choose("480p", "Full mix")
    expect(pitchAt("480p")).toHaveValue("4")
    // 720p, typed: it stays, through No audio too.
    await user.clear(pitchAt("720p"))
    await user.type(pitchAt("720p"), "7{Enter}")
    await choose("720p", "Full mix, one tone")
    expect(pitchAt("720p")).toHaveValue("7")
    await choose("720p", "No audio")
    await choose("720p", "Voice only")
    expect(pitchAt("720p")).toHaveValue("7")
    // 1080p, saved off the default (today's octave, +12): it stays.
    await choose("1080p", "Voice only")
    expect(pitchAt("1080p")).toHaveValue("12")
  })

  it("keeps a pitch shift within -24 to 24, on the half-semitone steps", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness envs={EVERYTHING} onChange={onChange} />)
    for (const [typed, kept] of [["30", 24], ["-24.4", -24], ["1.3", 1.5], ["7.25", 7.5]] as const) {
      await user.clear(pitchAt("480p"))
      await user.type(pitchAt("480p"), `${typed}{Enter}`)
      expect(onChange.mock.lastCall?.[0]["480p"], typed).toEqual({ mode: "full", semitones: kept })
      expect(pitchAt("480p")).toHaveValue(String(kept))
    }
  })

  it("disables the pitch shift for No audio, and brings it back with the next mode", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness envs={EVERYTHING} onChange={onChange} />)
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    await user.click(await screen.findByRole("option", { name: "No audio" }))
    expect(pitchAt("480p")).toBeDisabled()
    expect(pitchAt("480p")).toHaveValue("")
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    await user.click(await screen.findByRole("option", { name: "Full mix" }))
    expect(pitchAt("480p")).toBeEnabled()
    expect(pitchAt("480p")).toHaveValue("4")
    expect(onChange).toHaveBeenLastCalledWith(every({ mode: "full", semitones: 4 }))
  })

  it("shows what is stored: today's ids as their values, a value no id says as it is", () => {
    render(<Harness envs={EVERYTHING} initial={{ "480p": "octave", "720p": "none", "1080p": { mode: "voice-one-tone", semitones: -2.5 } }} />)
    expect(screen.getByRole("combobox", { name: "480p" })).toHaveTextContent("Full mix")
    expect(pitchAt("480p")).toHaveValue("12")
    expect(screen.getByRole("combobox", { name: "720p" })).toHaveTextContent("No audio")
    expect(pitchAt("720p")).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "1080p" })).toHaveTextContent("Voice only, one tone")
    expect(pitchAt("1080p")).toHaveValue("-2.5")
  })

  it("describes the one-tone modes", () => {
    render(<Harness envs={EVERYTHING} />)
    expect(screen.getByText("The whole mix flattened to one steady tone, after the pitch shift.")).toBeInTheDocument()
    expect(screen.getByText("Only the vocals, flattened to one steady tone, after the pitch shift. With no vocals the reference is silent.")).toBeInTheDocument()
  })

  describe("greyed out until every environment takes it", () => {
    const noted = () => screen.queryAllByRole("status").map((n) => n.textContent)

    it("the pitch field and Voice only, one tone: every engine's flag missing, then every platform's claim, each naming the environments", async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Harness envs={[at("production", IDS_0426, true, false), at("staging", IDS_0426)]} />)
      for (const r of ["480p", "720p", "1080p"]) {
        expect(pitchAt(r)).toBeDisabled()
        expect(pitchAt(r)).toHaveValue("4")
      }
      expect(noted()).toEqual([
        "The Cast Swap engine of staging cannot take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment.",
        "The platform in staging, production does not take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment.",
        "The Cast Swap engine of production cannot take Full mix, one tone yet, and this setting is shared by every environment.",
        "The Cast Swap engine of production cannot take Voice only, one tone yet, and this setting is shared by every environment.",
      ])
      await user.click(screen.getByRole("combobox", { name: "480p" }))
      expect(await screen.findByRole("option", { name: "Voice only, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByRole("option", { name: "Full mix, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByRole("option", { name: "Voice only" })).not.toHaveAttribute("aria-disabled")
      expect(screen.getByRole("option", { name: "No audio" })).not.toHaveAttribute("aria-disabled")
      unmount()
    })

    it("only the platform's claim missing: said alone; a trend says trends are shared", () => {
      render(<Harness sharedBy="trend" envs={[at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)]} />)
      expect(pitchAt("480p")).toBeDisabled()
      expect(noted()).toEqual(["The platform in production does not take a pitch shift or Voice only, one tone yet, and trends are shared by every environment."])
    })

    it("only an engine's flag missing: said alone", () => {
      render(<Harness envs={[at("production", WITH_PITCH, true), at("staging", IDS_0426, false, true)]} />)
      expect(pitchAt("480p")).toBeDisabled()
      expect(noted()).toEqual(["The Cast Swap engine of staging cannot take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment."])
    })

    it("Full mix, one tone greyed where an engine without the flag does not list one-tone: said apart", async () => {
      const user = userEvent.setup()
      render(<Harness envs={[at("production", ["full", "voice", "none"], false, true), at("staging", WITH_PITCH, true)]} />)
      expect(noted()).toEqual([
        "The Cast Swap engine of production cannot take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment.",
        "The Cast Swap engine of production cannot take Full mix, one tone yet, and this setting is shared by every environment.",
      ])
      await user.click(screen.getByRole("combobox", { name: "480p" }))
      expect(await screen.findByRole("option", { name: "Full mix, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    })

    it("a one-tone mode an engine does not list, the flag there: said apart, the pitch field open", async () => {
      const user = userEvent.setup()
      render(<Harness envs={[at("production", IDS_0426, true), at("staging", WITH_PITCH, true)]} />)
      expect(pitchAt("480p")).toBeEnabled()
      expect(noted()).toEqual([
        "The Cast Swap engine of production cannot take Full mix, one tone yet, and this setting is shared by every environment.",
        "The Cast Swap engine of production cannot take Voice only, one tone yet, and this setting is shared by every environment.",
      ])
      await user.click(screen.getByRole("combobox", { name: "480p" }))
      expect(await screen.findByRole("option", { name: "Full mix, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByRole("option", { name: "Voice only, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    })

    it("everything on every environment: nothing greyed, nothing said", async () => {
      const user = userEvent.setup()
      render(<Harness envs={EVERYTHING} />)
      expect(pitchAt("480p")).toBeEnabled()
      expect(noted()).toEqual([])
      await user.click(screen.getByRole("combobox", { name: "480p" }))
      expect(await screen.findByRole("option", { name: "Voice only, one tone" })).not.toHaveAttribute("aria-disabled")
    })

    it("while the environments are unknown: greyed, nothing said yet", () => {
      render(<Harness initial={{ "720p": "octave" }} />)
      expect(pitchAt("480p")).toBeDisabled()
      expect(noted()).toEqual([])
      expect(screen.queryByText("This pitch shift is not supported yet.")).not.toBeInTheDocument()
    })

    it("a value already set stays, to be set back: a value no id says, saying so; a stored Octave too, with nothing to say", async () => {
      const user = userEvent.setup()
      render(<Harness initial={{ "720p": { mode: "full", semitones: 7 }, "1080p": "octave" }} envs={[at("production", IDS_0426), at("staging", IDS_0426)]} />)
      expect(pitchAt("720p")).toBeEnabled()
      expect(pitchAt("720p")).toHaveValue("7")
      expect(within(screen.getByRole("group", { name: "720p" })).getByText("This pitch shift is not supported yet.")).toBeInTheDocument()
      expect(pitchAt("1080p")).toBeEnabled()
      expect(pitchAt("1080p")).toHaveValue("12")
      expect(within(screen.getByRole("group", { name: "1080p" })).queryByText("This pitch shift is not supported yet.")).not.toBeInTheDocument()
      expect(pitchAt("480p")).toBeDisabled()
      // Set back to its mode's default: nothing left to set back, greyed like the others.
      await user.clear(pitchAt("720p"))
      await user.type(pitchAt("720p"), "4{Enter}")
      expect(pitchAt("720p")).toHaveValue("4")
      expect(pitchAt("720p")).toBeDisabled()
    })

    it("never closes on a value that is itself held: a stored Voice only, one tone at +3, typed to 0, takes +3 back", async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Harness initial={{ "720p": { mode: "voice-one-tone", semitones: 3 } }} envs={[at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)]} onChange={onChange} />)
      expect(pitchAt("720p")).toBeEnabled()
      await user.clear(pitchAt("720p"))
      await user.type(pitchAt("720p"), "0{Enter}")
      expect(onChange.mock.lastCall?.[0]["720p"]).toEqual({ mode: "voice-one-tone", semitones: 0 })
      // At its mode's default, and held all the same: still open.
      expect(pitchAt("720p")).toBeEnabled()
      expect(pitchAt("720p")).toHaveValue("0")
      await user.clear(pitchAt("720p"))
      await user.type(pitchAt("720p"), "3{Enter}")
      expect(onChange.mock.lastCall?.[0]["720p"]).toEqual({ mode: "voice-one-tone", semitones: 3 })
      expect(pitchAt("720p")).toHaveValue("3")
    })

    it("a failed read of the environments says so, naming none: still greyed, a set value still open", () => {
      render(<Harness initial={{ "720p": { mode: "full", semitones: 7 } }} envsUnreadable />)
      expect(pitchAt("480p")).toBeDisabled()
      expect(pitchAt("720p")).toBeEnabled()
      expect(noted()).toEqual(["The environments could not be read, so a new pitch shift or one-tone mode can't be saved yet. Reload the page to try again."])
    })

    it("a failed read in a trend's editor names the one new pitch shift a draft still takes", () => {
      render(<Harness initial={{ "720p": { mode: "full", semitones: 7 } }} envsUnreadable sharedBy="trend" />)
      expect(noted()).toEqual(["The environments could not be read, so a new pitch shift (other than Full mix at +12) or one-tone mode can't be saved yet. Reload the page to try again."])
    })

    it("while the environments are unknown it claims nothing unsupported: loading or a failed read, the options stay greyed out", async () => {
      const user = userEvent.setup()
      for (const envsUnreadable of [false, true]) {
        const { unmount } = render(<Harness initial={{ "720p": "one-tone", "1080p": { mode: "voice-one-tone", semitones: 3 } }} envsUnreadable={envsUnreadable} />)
        expect(screen.getByRole("combobox", { name: "720p" }).textContent).toBe("Full mix, one tone")
        expect(screen.getByRole("combobox", { name: "1080p" }).textContent).toBe("Voice only, one tone")
        await user.click(screen.getByRole("combobox", { name: "480p" }))
        expect(await screen.findByRole("option", { name: "Full mix, one tone" })).toHaveAttribute("aria-disabled", "true")
        expect(screen.getByRole("option", { name: "Voice only, one tone" })).toHaveAttribute("aria-disabled", "true")
        expect(screen.getByRole("option", { name: "Voice only" })).not.toHaveAttribute("aria-disabled")
        await user.keyboard("{Escape}")
        unmount()
      }
    })

    it("environments known, from before a read that failed: what they lack, nothing about the read", () => {
      render(<Harness envs={[at("production", WITH_PITCH, true, false), at("staging", WITH_PITCH, true)]} envsUnreadable />)
      expect(noted()).toEqual(["The platform in production does not take a pitch shift or Voice only, one tone yet, and this setting is shared by every environment."])
    })

    it("a mode switch lands on what every environment takes: a stored Octave moved to Voice only is +4, not a value no id says", async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Harness initial={{ "720p": "octave" }} envs={[at("production", IDS_0426), at("staging", IDS_0426)]} onChange={onChange} />)
      await user.click(screen.getByRole("combobox", { name: "720p" }))
      await user.click(await screen.findByRole("option", { name: "Voice only" }))
      expect(onChange.mock.lastCall?.[0]["720p"]).toEqual({ mode: "voice", semitones: 4 })
      expect(pitchAt("720p")).toBeDisabled()
    })

    it("keeps a mode no environment takes choosable where it is already set", async () => {
      const user = userEvent.setup()
      render(<Harness initial={{ "720p": { mode: "voice-one-tone", semitones: 4 } }} envs={NOTHING_NEW} />)
      expect(screen.getByRole("combobox", { name: "720p" })).toHaveTextContent("Voice only, one tone (not supported yet)")
      await user.click(screen.getByRole("combobox", { name: "720p" }))
      expect(await screen.findByRole("option", { name: "Voice only, one tone (not supported yet)" })).not.toHaveAttribute("aria-disabled")
    })
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

  it("gives the reference audio the section's whole width: beside the Model its selects had no room", () => {
    render(editor([at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)]))
    const wrapper = screen.getByRole("group", { name: "Prism reference audio" }).parentElement!
    expect(wrapper).toHaveClass("sm:col-span-2")
    // A phone's one column is held to the card: a long Model name no longer widens what is under it.
    expect(wrapper.parentElement).toHaveClass("grid-cols-1")
  })

  it("offers what every environment takes, not what one does", async () => {
    const user = userEvent.setup()
    const { unmount } = render(editor([at("production", IDS_0426), at("staging", WITH_PITCH, true)]))
    expect(within(screen.getByRole("group", { name: "480p" })).getByRole("spinbutton", { name: "Pitch shift (semitones)" })).toBeDisabled()
    expect(screen.getAllByRole("status").map((n) => n.textContent)).toEqual([
      "The Cast Swap engine of production cannot take a pitch shift or Voice only, one tone yet, and trends are shared by every environment.",
      "The platform in production does not take a pitch shift or Voice only, one tone yet, and trends are shared by every environment.",
    ])
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "Voice only, one tone (not supported yet)" })).toHaveAttribute("aria-disabled", "true")
    // One-tone is listed everywhere: Full mix, one tone is offered (at 0, today's one-tone).
    expect(screen.getByRole("option", { name: "Full mix, one tone" })).not.toHaveAttribute("aria-disabled")
    unmount()
    render(editor([at("production", WITH_PITCH, true), at("staging", WITH_PITCH, true)]))
    expect(within(screen.getByRole("group", { name: "480p" })).getByRole("spinbutton", { name: "Pitch shift (semitones)" })).toBeEnabled()
    await user.click(screen.getByRole("combobox", { name: "480p" }))
    expect(await screen.findByRole("option", { name: "Voice only, one tone" })).not.toHaveAttribute("aria-disabled")
  })
})
