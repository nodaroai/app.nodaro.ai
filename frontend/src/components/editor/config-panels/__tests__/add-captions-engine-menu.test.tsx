import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { AddCaptionsConfig } from "../processing-configs"
import type { AddCaptionsData } from "@/types/nodes"
import { __failSurfaceAvailabilityForTests, __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { addCaptionsCreditId } from "../helpers"
import { addCaptionsNemotronQuoteCreditId } from "@nodaro/shared/credits"

/**
 * Add Captions' transcription-engine menu: the engines it offers, the one it
 * shows for a node that names none, and the Nemotron price note — what a
 * deployment that restricts no model sees, and (decided 2026-11-15) what one
 * that restricts models sees: only the engines it offers, the first of them
 * shown for a node that names none, a stored withheld engine kept (the run
 * refuses it, never swaps it), and a note where it offers none. The node's
 * price follows the shown engine.
 */

// Radix's portal listbox cannot be driven in jsdom: flatten each Select into a
// native <select> named by its trigger's aria-label (voice-changer-pro-config.test.tsx).
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      let triggerLabel: string | undefined
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent") {
          React.Children.forEach(child.props?.children, (item: any) => {
            if (item) items.push(item)
          })
        }
        if (child.type?.displayName === "SelectTrigger") triggerLabel = child.props?.["aria-label"]
      })
      return (
        <select role="combobox" aria-label={triggerLabel} value={value ?? ""} onChange={(e: any) => onValueChange?.(e.target.value)}>
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectContent" }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectTrigger" }),
    SelectValue: () => null,
  }
})

afterEach(() => __resetSurfaceAvailabilityForTests(null))

function renderConfig(data: Partial<AddCaptionsData>) {
  const onUpdate = vi.fn()
  render(
    <AddCaptionsConfig
      data={{ label: "Captions", style: "word-highlight", position: "bottom", fontSize: 48, color: "#ffffff", fieldMappings: {}, ...data } as AddCaptionsData}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[]}
    />,
  )
  return onUpdate
}

const engineMenu = () => screen.getByRole("combobox", { name: "Transcription engine" }) as HTMLSelectElement
const offered = () => within(engineMenu()).queryAllByRole("option").map((o) => (o as HTMLOptionElement).value)

describe("with no model restricted, the engine menu is as it always was", () => {
  it("offers every engine, in its order, and shows Incredibly Fast Whisper on a node that names none", () => {
    const onUpdate = renderConfig({})
    expect(offered()).toEqual(["whisper", "incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"])
    expect(engineMenu().value).toBe("incredibly-fast-whisper")
    // Showing the default writes nothing to the node.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("shows the node's own engine, and the per-minute note on Nemotron 3.5 Transcribe", () => {
    renderConfig({ transcribeProvider: "nemotron-3-5-transcribe" })
    expect(engineMenu().value).toBe("nemotron-3-5-transcribe")
    expect(screen.getByText(/minute/i)).toBeInTheDocument()
  })

  it("shows no engine menu on a node whose own text is its subtitle", () => {
    renderConfig({ style: "subtitle", text: "Hello there" })
    expect(screen.queryByRole("combobox", { name: "Transcription engine" })).toBeNull()
  })
})

const ENGINES = ["whisper", "incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"]
/** A deployment that restricts models and withholds `withheld`. */
const withhold = (...withheld: string[]) => __resetSurfaceAvailabilityForTests({ nodes: [], models: withheld, modelsRestricted: true })

describe("on a deployment that restricts models, the engine menu offers what it offers", () => {
  it("lists only the offered engines and shows the first offered for a node that names none, writing nothing", () => {
    withhold("incredibly-fast-whisper")
    const onUpdate = renderConfig({})
    expect(offered()).toEqual(["whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"])
    expect(engineMenu().value).toBe("elevenlabs-stt")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("keeps a stored engine it withholds listed and shown, never swapping it (the run refuses it)", () => {
    withhold("elevenlabs-stt")
    const onUpdate = renderConfig({ transcribeProvider: "elevenlabs-stt" })
    expect(offered()).toEqual(["whisper", "incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"])
    expect(engineMenu().value).toBe("elevenlabs-stt")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("shows the per-minute note where the default it shows is Nemotron 3.5 Transcribe", () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    renderConfig({})
    expect(engineMenu().value).toBe("nemotron-3-5-transcribe")
    expect(screen.getByText(/minute/i)).toBeInTheDocument()
  })

  it("says so where it offers no engine", () => {
    withhold(...ENGINES)
    renderConfig({})
    expect(offered()).toEqual([])
    expect(engineMenu().value).toBe("")
    expect(screen.getByText(/offers no transcription engine/i)).toBeInTheDocument()
  })

  it("a deployment that withholds an engine without restricting models (the admin's model switch) shows today's default", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["incredibly-fast-whisper"], modelsRestricted: false })
    renderConfig({})
    expect(engineMenu().value).toBe("incredibly-fast-whisper")
  })
})

describe("the node's price follows the engine it runs", () => {
  const kinetic = { style: "word-highlight" }

  it("with no model restricted, a node that names no engine is priced on the render", () => {
    expect(addCaptionsCreditId(kinetic, false)).toBe("add-captions:kinetic")
  })

  it("where the first offered engine is Nemotron 3.5 Transcribe, a node that names none is priced per minute", () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(addCaptionsCreditId(kinetic, false)).toBe(addCaptionsNemotronQuoteCreditId(null))
    expect(addCaptionsCreditId({ ...kinetic, transcribeProvider: "whisper" }, false)).toBe("add-captions:kinetic")
  })
})

describe.each([
  ["while the availability answer is awaited", () => __resetSurfaceAvailabilityForTests(null)],
  ["after a read of it failed", () => __failSurfaceAvailabilityForTests()],
])("a deployment that lists its models, %s, is judged by its own lists", (_state, enter) => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("the menu offers only the listed engines and shows the first of them", () => {
    window.__NODARO_RUNTIME__ = { surface: { models: { allow: ["elevenlabs-stt", "whisper"], deny: [] } } } as unknown as typeof window.__NODARO_RUNTIME__
    enter()
    const onUpdate = renderConfig({})
    expect(offered()).toEqual(["whisper", "elevenlabs-stt"])
    expect(engineMenu().value).toBe("elevenlabs-stt")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("a deny list withholds its engine", () => {
    window.__NODARO_RUNTIME__ = { surface: { models: { allow: [], deny: ["incredibly-fast-whisper"] } } } as unknown as typeof window.__NODARO_RUNTIME__
    enter()
    renderConfig({})
    expect(offered()).toEqual(["whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"])
    expect(engineMenu().value).toBe("elevenlabs-stt")
  })
})
