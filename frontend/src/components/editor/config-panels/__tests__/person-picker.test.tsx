import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PersonPicker } from "../person-picker"
import { PersonPickerCompact } from "../person-picker-compact"
import { PersonPickerDetailed } from "../person-picker-detailed"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import * as prefs from "@/lib/parameter-node-prefs"
import { PERSON_DIMENSION_SECTIONS, type PersonValue } from "@nodaro/shared"

// This file renders the FULL PersonPickerDetailed (every dimension + all options)
// dozens of times and leans on getByRole, whose accessible-name computation over
// the large tree is genuinely slow — several tests run 4–6s. The 5s default times
// out on slower CI runners (the ethnicity-tab tests flaked on CI while passing
// locally). Raise the per-file timeout to absorb CI variance. Scoped to this file
// so it can't mask slow tests elsewhere.
vi.setConfig({ testTimeout: 15000 })

/**
 * Characterization tests for the DETAILED person-picker view.
 *
 * These were written BEFORE the Task-3 extraction of `PersonDimensionGrid` +
 * `usePersonDimension`, to pin today's observable behavior so the
 * behavior-preserving refactor can be proven not to regress. After Task 4 the
 * detailed body lives in `PersonPickerDetailed`, so these render it directly
 * (the public `PersonPicker` wrapper now defaults to Compact mode and is
 * covered by its own describe block below).
 *
 * No mock for `useLocalizedCatalog`: the store defaults to locale "en", whose
 * resolvers return the canonical English label/description (same convention as
 * action-fx-picker.test.tsx).
 */
describe("PersonPickerDetailed (characterization)", () => {
  it("renders dimension section labels", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // Section headline labels (the Switch row <label>) for a few dimensions.
    expect(screen.getByText("Build")).toBeInTheDocument()
    expect(screen.getByText("Age")).toBeInTheDocument()
    expect(screen.getByText("Ethnicity")).toBeInTheDocument()
    expect(screen.getByText("Eye Color")).toBeInTheDocument()
  })

  it("renders known options for flat single-pick dimensions", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // Build options (flat radiogroup). Exact-match anchors avoid colliding with
    // body-proportions' "Athletic / Muscular".
    expect(screen.getByRole("radio", { name: /^Petite$/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Athletic$/i })).toBeInTheDocument()
    // Skin-tone options (flat single-pick; "Olive" is unique to this dim).
    expect(screen.getByRole("radio", { name: /^Olive$/i })).toBeInTheDocument()
  })

  it("single-pick: clicking a Build option calls onChange with the scalar field", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{}} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /^Athletic$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ build: "athletic" })
  })

  // NUANCE: a TRUE single-pick dim (maxSelected <= 1) does NOT toggle off — the
  // onPick `maxSelected <= 1` branch always re-commits the id. Toggle-off only
  // exists for multi-capable dims currently held as a scalar (see next test).
  it("single-pick: clicking the already-selected option re-commits the same id (no toggle-off)", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{ build: "athletic" }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /^Athletic$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ build: "athletic" })
  })

  // Multi-capable dim (ethnicity, cap 2) currently stored as a scalar string:
  // clicking the selected option toggles it OFF (clears to undefined).
  it("multi-capable dim in scalar mode: clicking the selected option clears it", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{ ethnicity: "chinese" }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /^Chinese$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ethnicity: undefined })
  })

  it("multi-pick (ethnicity, cap 2): a capped dim writes a ReadonlyArray and never a 3rd", () => {
    const onChange = vi.fn()
    // Ethnicity is grouped/tabbed; default active tab is the first group ("Asian").
    // Start in multi-data mode with two distinct Asian-group ids already picked,
    // so a 3rd click must honour the cap (no growth past 2).
    render(
      <PersonPickerDetailed
        value={{ ethnicity: ["chinese", "japanese"] }}
        onChange={onChange}
      />,
    )
    // A 3rd, currently-unpicked Asian-group option.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Korean$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0][0].ethnicity
    expect(Array.isArray(arg)).toBe(true)
    expect((arg as ReadonlyArray<string>).length).toBeLessThanOrEqual(2)
  })

  it("multi-pick (ethnicity): from a single selection, picking a second yields a 2-element array", () => {
    const onChange = vi.fn()
    // isMultiData = false (scalar) → picking a different option in a multi-capable
    // dim swaps the single value (today's behavior for scalar-stored multi dims).
    // To exercise the array path we start already in array mode with one id.
    render(
      <PersonPickerDetailed value={{ ethnicity: ["chinese"] }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole("checkbox", { name: /^Japanese$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ethnicity: ["chinese", "japanese"] })
  })

  it("age-custom: selecting the custom sentinel surfaces the number input", () => {
    const onChange = vi.fn()
    // Render already in the age-custom state so the number input is mounted.
    render(<PersonPickerDetailed value={{ age: "age-custom" }} onChange={onChange} />)
    expect(
      screen.getByRole("spinbutton", { name: /Custom age in years/i }),
    ).toBeInTheDocument()
  })

  it("age-custom: typing a number writes customAge", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{ age: "age-custom" }} onChange={onChange} />)
    const input = screen.getByRole("spinbutton", { name: /Custom age in years/i })
    fireEvent.change(input, { target: { value: "8" } })
    expect(onChange).toHaveBeenCalledWith({ customAge: 8 })
  })

  it("age-custom is NOT shown for a non-custom age", () => {
    render(<PersonPickerDetailed value={{ age: "age-30s" }} onChange={() => {}} />)
    expect(
      screen.queryByRole("spinbutton", { name: /Custom age in years/i }),
    ).not.toBeInTheDocument()
  })

  it("global search filters across dimensions (fewer options remain)", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // Before search: an unrelated option from another dimension is visible.
    expect(screen.getByRole("radio", { name: /^Petite$/i })).toBeInTheDocument()
    const totalBefore = screen.getAllByRole("radio").length

    const search = screen.getByLabelText("Search person")
    fireEvent.change(search, { target: { value: "athletic" } })

    // After search: the "Athletic" build matches; "Petite" no longer shown.
    expect(screen.getByRole("radio", { name: /^Athletic$/i })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /^Petite$/i })).not.toBeInTheDocument()
    const totalAfter = screen.getAllByRole("radio").length
    expect(totalAfter).toBeLessThan(totalBefore)
  })

  it("global search: ethnicity (tabbed) flattens so a non-default-tab match is visible", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // "Swedish" lives in the European ethnicity group (not the default Asian tab),
    // so it is hidden until search flattens the grouped dims.
    expect(screen.queryByRole("checkbox", { name: /^Swedish$/i })).not.toBeInTheDocument()
    const search = screen.getByLabelText("Search person")
    fireEvent.change(search, { target: { value: "swedish" } })
    expect(screen.getByRole("checkbox", { name: /^Swedish$/i })).toBeInTheDocument()
  })

  it("global search: shows empty-state message when nothing matches", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const search = screen.getByLabelText("Search person")
    fireEvent.change(search, { target: { value: "zzzqqxnomatch" } })
    expect(screen.getByText(/No person attributes match/)).toBeInTheDocument()
  })

  it("enable Switch on a multi dim (ethnicity) marks it checked without forcing a pick", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{}} onChange={onChange} />)
    // Multi dims (cap > 1) toggling ON must NOT call onChange (no forced default);
    // it only flips internal enabled state.
    const ethSwitch = screen.getByRole("switch", { name: /Enable Ethnicity/i })
    fireEvent.click(ethSwitch)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("enable Switch on a single dim (build) toggles ON with the first catalog id", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{}} onChange={onChange} />)
    const buildSwitch = screen.getByRole("switch", { name: /Enable Build/i })
    fireEvent.click(buildSwitch)
    // First Build catalog entry is "petite".
    expect(onChange).toHaveBeenCalledWith({ build: "petite" })
  })

  it("does not mutate the passed value object", () => {
    const value: PersonValue = { build: "athletic", ethnicity: ["chinese"] }
    const snapshot = JSON.stringify(value)
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /Slim/i }))
    // onChange receives a patch; the original object is untouched.
    expect(JSON.stringify(value)).toBe(snapshot)
  })

  it("tabbed dim (ethnicity): switching tabs changes which options are visible", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // Default tab "Asian": Chinese visible, Swedish (European) not.
    expect(screen.getByRole("checkbox", { name: /^Chinese$/i })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /^Swedish$/i })).not.toBeInTheDocument()

    // The ethnicity dim has its own tablist; click the "European" tab within it.
    // (The tablist accessible name embeds the multi-cap suffix.)
    const ethTablist = screen.getByRole("tablist", { name: /^Ethnicity \(pick up to 2\) groups$/i })
    fireEvent.click(within(ethTablist).getByRole("tab", { name: /^European$/i }))

    expect(screen.getByRole("checkbox", { name: /^Swedish$/i })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /^Chinese$/i })).not.toBeInTheDocument()
  })
})

/**
 * Tests for the public `PersonPicker` wrapper (Task 5): it owns the persisted
 * Compact/Detailed view mode + a header toggle, then renders the matching view
 * body. (The Compact view body lands in Task 6 — for now the compact branch
 * renders Detailed, so these tests assert ONLY the toggle's state + persistence,
 * not which body renders.)
 */
describe("PersonPicker (wrapper — Compact/Detailed toggle)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
  })

  /** The header view-mode radiogroup, disambiguated from the per-dimension
   *  radiogroups inside the Detailed body via its accessible name. */
  const getModeGroup = () => screen.getByRole("radiogroup", { name: /Person picker view/i })

  it("renders the Compact/Detailed toggle as a radiogroup with two radios", () => {
    render(<PersonPicker value={{}} onChange={() => {}} />)
    const group = getModeGroup()
    expect(group).toBeInTheDocument()
    expect(within(group).getByRole("radio", { name: /^Compact$/i })).toBeInTheDocument()
    expect(within(group).getByRole("radio", { name: /^Detailed$/i })).toBeInTheDocument()
  })

  it("default mode reflects getStickyPersonPickerMode() (detailed)", () => {
    vi.spyOn(prefs, "getStickyPersonPickerMode").mockReturnValue("detailed")
    render(<PersonPicker value={{}} onChange={() => {}} />)
    const group = getModeGroup()
    expect(within(group).getByRole("radio", { name: /^Detailed$/i })).toHaveAttribute("aria-checked", "true")
    expect(within(group).getByRole("radio", { name: /^Compact$/i })).toHaveAttribute("aria-checked", "false")
  })

  it("default mode reflects getStickyPersonPickerMode() (compact)", () => {
    vi.spyOn(prefs, "getStickyPersonPickerMode").mockReturnValue("compact")
    render(<PersonPicker value={{}} onChange={() => {}} />)
    const group = getModeGroup()
    expect(within(group).getByRole("radio", { name: /^Compact$/i })).toHaveAttribute("aria-checked", "true")
    expect(within(group).getByRole("radio", { name: /^Detailed$/i })).toHaveAttribute("aria-checked", "false")
  })

  it("clicking 'Detailed' sets aria-checked and persists via the guarded helper", () => {
    const setSpy = vi.spyOn(prefs, "setStickyPersonPickerMode")
    // Start from compact so the click is a real transition.
    vi.spyOn(prefs, "getStickyPersonPickerMode").mockReturnValue("compact")
    render(<PersonPicker value={{}} onChange={() => {}} />)
    const group = getModeGroup()

    fireEvent.click(within(group).getByRole("radio", { name: /^Detailed$/i }))

    expect(within(group).getByRole("radio", { name: /^Detailed$/i })).toHaveAttribute("aria-checked", "true")
    expect(within(group).getByRole("radio", { name: /^Compact$/i })).toHaveAttribute("aria-checked", "false")
    expect(setSpy).toHaveBeenCalledWith("detailed")
  })

  it("persists the chosen mode to localStorage key nodaro:person-picker-mode", () => {
    // No helper spy here — exercise the real guarded persistence end-to-end.
    render(<PersonPicker value={{}} onChange={() => {}} />)
    const group = getModeGroup()
    fireEvent.click(within(group).getByRole("radio", { name: /^Detailed$/i }))
    expect(window.localStorage.getItem("nodaro:person-picker-mode")).toBe("detailed")

    fireEvent.click(within(group).getByRole("radio", { name: /^Compact$/i }))
    expect(window.localStorage.getItem("nodaro:person-picker-mode")).toBe("compact")
  })
})

/**
 * Smoke tests for the NEW Compact view (Task 6). The full behavioral suite
 * (popover picks, single-close/multi-open, age-custom, app-card Dialog
 * invariant) lands in Task 8; this only pins the section structure + the
 * collapse/expand-all control so the wrapper's compact default is exercised.
 */
describe("PersonPickerCompact (smoke)", () => {
  it("renders all 6 section headers (each a button with aria-expanded)", () => {
    render(<PersonPickerCompact value={{}} onChange={() => {}} />)
    expect(PERSON_DIMENSION_SECTIONS).toHaveLength(6)
    for (const section of PERSON_DIMENSION_SECTIONS) {
      // Section header is always rendered (only its body is conditional) and
      // carries aria-expanded; its accessible name embeds the English label.
      const header = screen.getByRole("button", {
        name: new RegExp(section.label.replace("&", "\\&")),
      })
      expect(header).toHaveAttribute("aria-expanded")
    }
  })

  it("exposes a Collapse/Expand-all control that toggles every section", () => {
    render(<PersonPickerCompact value={{}} onChange={() => {}} />)
    // With nothing selected, only the first section opens, so the global
    // control starts as "Expand all".
    const expandAll = screen.getByRole("button", { name: /Expand all sections/i })
    fireEvent.click(expandAll)
    // Now every section is open and the control flips to "Collapse all".
    expect(screen.getByRole("button", { name: /Collapse all sections/i })).toBeInTheDocument()
  })

  it("shows a selected pill (field + value) and a clear control when a value is set", () => {
    render(<PersonPickerCompact value={{ build: "athletic" }} onChange={() => {}} />)
    // The Body section auto-opens because it holds a value; its Build pill shows
    // the field + resolved value as its accessible name.
    expect(screen.getByRole("button", { name: /Build:\s*Athletic/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Clear Build/i })).toBeInTheDocument()
  })

  it("clear ✕ clears the dimension without opening the popover", () => {
    const onChange = vi.fn()
    render(<PersonPickerCompact value={{ build: "athletic" }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /Clear Build/i }))
    expect(onChange).toHaveBeenCalledWith({ build: undefined })
  })

  it("custom-age: typing in the number input keeps the popover open (regression — must not commit-close)", () => {
    const onChange = vi.fn()
    // age already in the custom state → Identity section auto-opens + the Age
    // pill's popover renders the custom-age number input on open.
    render(<PersonPickerCompact value={{ age: "age-custom" }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /^Age:/i }))
    const ageInput = screen.getByRole("spinbutton")
    fireEvent.change(ageInput, { target: { value: "8" } })
    expect(onChange).toHaveBeenCalledWith({ customAge: 8 })
    // The popover MUST still be open (a customAge-only patch has no `age` key, so
    // it must not trigger commit-&-close). Before the fix this unmounted the input.
    expect(screen.getByRole("spinbutton")).toBeInTheDocument()
  })
})

/**
 * The headline NEW Compact behaviors (Task 8): opening a pill's popover, picking
 * a tile (single-pick commits & CLOSES; multi-pick stays open + honours the cap),
 * the shared grid + localized labels threading through the popover, and the a11y
 * contract on the pill/clear/section-header.
 *
 * Radix Popover triggers react to the full pointer sequence — `userEvent.click`
 * fires pointerdown + click (mirrors action-fx-picker.test.tsx for Radix Tabs).
 * `findByRole` waits for the portaled PopoverContent to mount.
 */
describe("PersonPickerCompact (popover behaviors)", () => {
  /** Open the pill for a not-yet-selected dimension (its accessible name is
   *  `Choose <Label>` until a value is set, then `<Label>: <value>`). */
  const openChoosePill = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
    await user.click(screen.getByRole("button", { name: new RegExp(`^Choose ${label}$`, "i") }))
  }

  it("1. popover pick writes the dimension field (single-cap Build)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PersonPickerCompact value={{}} onChange={onChange} />)
    // Body section auto-opens (first section is Identity; Body is opened lazily
    // only if it holds a value, so expand-all first to surface the Build pill).
    await user.click(screen.getByRole("button", { name: /Expand all sections/i }))
    await openChoosePill(user, "Build")
    // The popover body is the shared grid — Build is flat single-pick → radios.
    const tile = await screen.findByRole("radio", { name: /^Athletic$/i })
    fireEvent.click(tile)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ build: "athletic" })
  })

  it("2. single-pick commits & CLOSES the popover (Build)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PersonPickerCompact value={{}} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /Expand all sections/i }))
    await openChoosePill(user, "Build")
    // Popover open: its per-dimension search input ("Search build…") is present.
    expect(await screen.findByLabelText(/Search build/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: /^Athletic$/i }))
    // A single-cap (non-age) pick must commit AND close — the popover content
    // (its search input + option tiles) unmounts synchronously with the pick
    // (handleGridChange → onRequestClose → setOpen(false), flushed by act()).
    expect(screen.queryByLabelText(/Search build/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /^Athletic$/i })).not.toBeInTheDocument()
  })

  it("3. multi-pick stays OPEN + respects the cap (eye-color, cap 2)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // Start in array mode with one id so the array-growth + cap path is exercised
    // (a multi-capable dim stored as a scalar SWAPS rather than grows — see the
    // Detailed characterization). eye-color is FLAT (not tabbed), so all options
    // are visible simultaneously without switching a sub-tab.
    const { rerender } = render(
      <PersonPickerCompact value={{ eyeColor: ["eyes-brown"] }} onChange={onChange} />,
    )
    // Skin & Eyes auto-opens (it holds a value); the eye-color pill shows the
    // current value, so open it via its "Eye Color: …" name.
    await user.click(screen.getByRole("button", { name: /^Eye Color:/i }))
    // Multi dim → checkbox tiles.
    const blue = await screen.findByRole("checkbox", { name: /^Blue$/i })
    fireEvent.click(blue)
    // Second pick → 2-element array; popover STILL open (search input present).
    expect(onChange).toHaveBeenLastCalledWith({ eyeColor: ["eyes-brown", "eyes-blue"] })
    expect(screen.getByLabelText(/Search eye color/i)).toBeInTheDocument()

    // Re-render at the cap, then a 3rd pick must NOT exceed the cap.
    rerender(
      <PersonPickerCompact value={{ eyeColor: ["eyes-brown", "eyes-blue"] }} onChange={onChange} />,
    )
    const green = screen.getByRole("checkbox", { name: /^Green$/i })
    fireEvent.click(green)
    // Popover still open after the 3rd pick (multi never commit-closes).
    expect(screen.getByLabelText(/Search eye color/i)).toBeInTheDocument()
    // Every emitted array honours the cap (FIFO eviction allowed; growth past 2 not).
    for (const call of onChange.mock.calls) {
      const arg = call[0].eyeColor
      if (Array.isArray(arg)) expect(arg.length).toBeLessThanOrEqual(2)
    }
  })

  it("4. popover renders the shared PersonDimensionGrid with localized (English) labels", async () => {
    const user = userEvent.setup()
    render(<PersonPickerCompact value={{}} onChange={() => {}} />)
    await user.click(screen.getByRole("button", { name: /Expand all sections/i }))
    await openChoosePill(user, "Build")
    // Real Build option labels resolved through useLocalizedCatalog("person")
    // (locale defaults to "en" → canonical English) prove PersonDimensionGrid +
    // the resolvers are threaded into the popover body, not a placeholder.
    expect(await screen.findByRole("radio", { name: /^Petite$/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Athletic$/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Muscular$/i })).toBeInTheDocument()
    // The popover container carries its accessible "<Dimension> options" name.
    expect(screen.getByLabelText(/Build options/i)).toBeInTheDocument()
  })

  it("4b. the popover's own search filters that dimension's options (independent of any global search)", async () => {
    const user = userEvent.setup()
    render(<PersonPickerCompact value={{}} onChange={() => {}} />)
    await user.click(screen.getByRole("button", { name: /Expand all sections/i }))
    await openChoosePill(user, "Build")
    const search = await screen.findByLabelText(/Search build/i)
    expect(screen.getByRole("radio", { name: /^Petite$/i })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: "athletic" } })
    expect(screen.getByRole("radio", { name: /^Athletic$/i })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /^Petite$/i })).not.toBeInTheDocument()
  })

  describe("a11y", () => {
    it("section header exposes aria-expanded reflecting open state", async () => {
      const user = userEvent.setup()
      render(<PersonPickerCompact value={{}} onChange={() => {}} />)
      // Identity (first) opens by default → aria-expanded="true".
      const identity = screen.getByRole("button", { name: /Identity/i })
      expect(identity).toHaveAttribute("aria-expanded", "true")
      // Body holds no value → collapsed → aria-expanded="false".
      const body = screen.getByRole("button", { name: /^Body/i })
      expect(body).toHaveAttribute("aria-expanded", "false")
      // Toggling flips it.
      await user.click(body)
      expect(body).toHaveAttribute("aria-expanded", "true")
    })

    it("a selected pill exposes field + value as its accessible name; the clear ✕ has an aria-label", () => {
      render(<PersonPickerCompact value={{ build: "athletic" }} onChange={() => {}} />)
      expect(screen.getByRole("button", { name: /Build:\s*Athletic/i })).toBeInTheDocument()
      // Clear control is a separate role=button with its own aria-label.
      expect(screen.getByRole("button", { name: /^Clear Build$/i })).toBeInTheDocument()
    })

    it("an unselected pill exposes a 'Choose <Dimension>' accessible name", () => {
      render(<PersonPickerCompact value={{}} onChange={() => {}} />)
      // Identity is open by default → its Type pill (no value) reads "Choose Type".
      expect(screen.getByRole("button", { name: /^Choose Type$/i })).toBeInTheDocument()
    })
  })
})

/**
 * [IMPORTANT] App-card Dialog-nesting invariant (design §Testing).
 *
 * In published apps the Person input card renders inside a Radix `Dialog`. The
 * compact popover is non-modal and relies on Popover + @radix-ui/react-dialog
 * resolving to ONE hoisted `react-dismissable-layer`, so picking a popover
 * option must dismiss only the popover — NEVER the Dialog underneath. This test
 * renders the realistic `PersonPicker` (compact by default) inside a real
 * Dialog, opens a pill popover, clicks an option, and asserts the Dialog
 * content is still mounted.
 */
describe("PersonPicker inside a Dialog (app-card nesting invariant)", () => {
  beforeEach(() => {
    // Restore any prefs spy a prior describe block left installed so the default
    // compact mode (getStickyPersonPickerMode) genuinely drives this render, then
    // clear the per-device pref key so it falls back to that default.
    vi.restoreAllMocks()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it("picking a popover option does NOT close the surrounding Dialog", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Dialog open>
        <DialogContent aria-label="Person input card">
          {/* default mode is compact (getStickyPersonPickerMode) */}
          <PersonPicker value={{}} onChange={onChange} />
        </DialogContent>
      </Dialog>,
    )

    // Sanity: the Dialog content is present before interacting.
    expect(screen.getByRole("dialog", { name: /Person input card/i })).toBeInTheDocument()

    // Identity section is open by default → the Type pill is reachable. Open it.
    await user.click(screen.getByRole("button", { name: /^Choose Type$/i }))

    // Pick a real Type option. "Type" is a grouped/tabbed single-cap dim, so its
    // tiles are radios; the default tab is the first group ("Realistic"), which
    // contains "Woman".
    const womanTile = await screen.findByRole("radio", { name: /^Woman$/i })
    fireEvent.click(womanTile)

    // The pick wrote the field…
    expect(onChange).toHaveBeenCalledWith({ type: "woman" })
    // …and CRUCIALLY the Dialog is STILL open (only the popover dismissed).
    expect(screen.getByRole("dialog", { name: /Person input card/i })).toBeInTheDocument()
  })
})

/**
 * Detailed-view regression gaps flagged in the PCP3 review (the extraction was
 * byte-identical-preserved but these exact branches were never pinned by a test):
 *  - multi-dim enable-Switch OFF clears the value,
 *  - the age-custom sentinel-drop on picking a normal age,
 *  - the MultiPickBadge promote-to-multi / demote-to-single transitions,
 *  - the age number-input edge cases (empty clears; non-finite is ignored).
 */
describe("PersonPickerDetailed (regression gaps)", () => {
  it("7. enable Switch OFF on a multi dim (ethnicity) clears the value", () => {
    const onChange = vi.fn()
    // Start with a single ethnicity picked so the dim is checked + the Switch ON.
    render(<PersonPickerDetailed value={{ ethnicity: "chinese" }} onChange={onChange} />)
    const ethSwitch = screen.getByRole("switch", { name: /Enable Ethnicity/i })
    // Toggling OFF must clear the dimension value (grid's Switch → toggleOff()).
    fireEvent.click(ethSwitch)
    expect(onChange).toHaveBeenCalledWith({ ethnicity: undefined })
  })

  it("8. picking a normal age preset while age-custom is set drops the customAge sentinel", () => {
    const onChange = vi.fn()
    render(
      <PersonPickerDetailed value={{ age: "age-custom", customAge: 30 }} onChange={onChange} />,
    )
    // Pick a non-custom preset → the age-aware single-pick branch emits BOTH the
    // new age id and customAge:undefined (so the stale number can't linger).
    fireEvent.click(screen.getByRole("radio", { name: /^30s$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ age: "age-30s", customAge: undefined })
  })

  it("9. MultiPickBadge promotes scalar → [id] (the + badge)", () => {
    const onChange = vi.fn()
    // eye-color is multi-capable (cap 2) + FLAT. Held as a scalar → the selected
    // tile shows the `+` badge (mode "single"). Clicking it promotes to an array.
    render(<PersonPickerDetailed value={{ eyeColor: "eyes-brown" }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /activate multi-select/i }))
    expect(onChange).toHaveBeenCalledWith({ eyeColor: ["eyes-brown"] })
  })

  it("9b. MultiPickBadge demotes [id] → scalar id (the numbered badge)", () => {
    const onChange = vi.fn()
    // Held as a 1-element array → the badge is mode "multi" (shows "1"); clicking
    // it demotes back to a scalar string.
    render(<PersonPickerDetailed value={{ eyeColor: ["eyes-brown"] }} onChange={onChange} />)
    fireEvent.click(
      screen.getByRole("button", { name: /multi-select activated, click to disable/i }),
    )
    expect(onChange).toHaveBeenCalledWith({ eyeColor: "eyes-brown" })
  })

  it("10. age number input: clearing the field emits customAge:undefined", () => {
    const onChange = vi.fn()
    render(
      <PersonPickerDetailed value={{ age: "age-custom", customAge: 8 }} onChange={onChange} />,
    )
    const input = screen.getByRole("spinbutton", { name: /Custom age in years/i })
    fireEvent.change(input, { target: { value: "" } })
    expect(onChange).toHaveBeenCalledWith({ customAge: undefined })
  })

  it("10b. age number input: a non-finite value does NOT emit a bogus customAge", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{ age: "age-custom" }} onChange={onChange} />)
    const input = screen.getByRole("spinbutton", { name: /Custom age in years/i })
    // A pure non-numeric string parses to NaN; the guard (`Number.isFinite`) must
    // skip the write entirely (neither a NaN nor any customAge patch is emitted).
    fireEvent.change(input, { target: { value: "abc" } })
    for (const call of onChange.mock.calls) {
      // No call should carry a customAge key at all for a non-finite input.
      expect("customAge" in call[0]).toBe(false)
    }
  })
})
