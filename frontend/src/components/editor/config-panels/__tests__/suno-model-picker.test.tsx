/**
 * Every Suno picker offers every Suno version, current generation first.
 *
 * The product decision (2026-09-11) is that all nine versions stay selectable —
 * each has its own character and saved workflows keep running — with the V6
 * family listed first and V6 as the default. `SUNO_MODELS` in @nodaro/shared is
 * the single source of truth for BOTH membership and order; the dropdown table
 * in model-options.ts is display copy for it. The one narrowing is
 * add-instrumental / add-vocals, whose route accepts `SUNO_ADD_TRACK_MODELS`.
 */
import { createContext, type ReactElement } from "react"
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import {
  SUNO_MODELS as SUNO_MODELS_SHARED,
  SUNO_ADD_TRACK_MODELS,
  DEFAULT_SUNO_MODEL,
} from "@nodaro/shared"

vi.mock("@/components/ui/select", () => ({
  // suno-field.tsx renders through this context; the mocked Select ignores it.
  MappableFieldCtx: createContext<unknown>(null),
  Select: ({ children, value }: any) => <div data-testid="select" data-value={value}>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }))
vi.mock("@/components/ui/label", () => ({ Label: ({ children, ...p }: any) => <label {...p}>{children}</label> }))
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => <input type="checkbox" /> }))
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock("../mappable-field", () => ({ MappableField: ({ children }: any) => <div>{children}</div> }))
vi.mock("../tag-textarea", () => ({ TagTextarea: () => <textarea /> }))
vi.mock("../model-description-hint", () => ({ ModelDescriptionHint: () => null }))
vi.mock("../model-select-option", () => ({
  ModelSelectOption: ({ value, label }: any) => <option value={value}>{label}</option>,
}))
// Four of the panels pull the prompt-snippet pool, which reaches useAuth() →
// useNavigate() and needs a Router. The pool is irrelevant to the model select.
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({ useSnippetPool: () => [] }))

import {
  SunoGenerateConfig,
  SunoCoverConfig,
  SunoExtendConfig,
  SunoMashupConfig,
  SunoAddInstrumentalConfig,
  SunoAddVocalsConfig,
  SunoUploadExtendConfig,
} from "../audio-configs"

const noop = () => {}
const common = { onUpdate: noop, sources: [], fieldMappings: {}, onMapField: noop, nodeRefs: [], refMap: new Map() } as any
const data = (extra: Record<string, unknown> = {}) =>
  ({ label: "Suno", model: DEFAULT_SUNO_MODEL, customMode: false, fieldMappings: {}, ...extra }) as any

/** The MODEL select only — these panels also render vocal-gender selects. */
function modelSelect(container: HTMLElement): HTMLElement {
  const found = [...container.querySelectorAll("[data-testid=select]")].find((s) => s.querySelector('[aria-label="Model"]'))
  if (!found) throw new Error("no Suno model select rendered")
  return found as HTMLElement
}

function optionValues(container: HTMLElement): (string | null)[] {
  return [...modelSelect(container).querySelectorAll("option")].map((o) => o.getAttribute("value"))
}

/** The five Suno panels whose route accepts the FULL version list. */
const FULL_LIST_PANELS: ReadonlyArray<[string, (p: any) => ReactElement]> = [
  ["suno-generate", SunoGenerateConfig],
  ["suno-cover", SunoCoverConfig],
  ["suno-extend", SunoExtendConfig],
  ["suno-mashup", SunoMashupConfig],
  ["suno-upload-extend", SunoUploadExtendConfig],
]

/** add-instrumental / add-vocals — narrowed to SUNO_ADD_TRACK_MODELS. */
const ADD_TRACK_PANELS: ReadonlyArray<[string, (p: any) => ReactElement]> = [
  ["suno-add-instrumental", SunoAddInstrumentalConfig],
  ["suno-add-vocals", SunoAddVocalsConfig],
]

describe("Suno model select — every version, current generation first", () => {
  it.each(FULL_LIST_PANELS)("%s offers exactly SUNO_MODELS, in shared order", (_type, Config) => {
    const { container } = render(<Config {...common} data={data()} />)
    expect(optionValues(container)).toEqual([...SUNO_MODELS_SHARED])
  })

  it("the offered list is nine versions with the V6 family first", () => {
    expect(SUNO_MODELS_SHARED).toHaveLength(9)
    expect(SUNO_MODELS_SHARED.slice(0, 3)).toEqual(["V6", "V6_WILD", "V6_MINI"])
    expect(SUNO_MODELS_SHARED[0]).toBe(DEFAULT_SUNO_MODEL)
  })

  it("a node carrying an earlier version renders it as an ordinary choice", () => {
    const { container } = render(<SunoMashupConfig {...common} data={data({ model: "V5_5" })} />)
    expect(optionValues(container)).toEqual([...SUNO_MODELS_SHARED])
    // The select is driven by the stored value — never silently reset to V6.
    expect(modelSelect(container).getAttribute("data-value")).toBe("V5_5")
  })
})

describe("Suno add-track selects — narrowed to the versions their route accepts", () => {
  // SUNO_MODELS order, filtered — NOT SUNO_ADD_TRACK_MODELS' own declaration
  // order, which lists the earlier versions ascending.
  const expected = SUNO_MODELS_SHARED.filter((m) => (SUNO_ADD_TRACK_MODELS as readonly string[]).includes(m))

  it.each(ADD_TRACK_PANELS)("%s offers exactly SUNO_ADD_TRACK_MODELS", (_type, Config) => {
    const { container } = render(<Config {...common} data={data()} />)
    const values = optionValues(container)
    expect(values).toEqual([...expected])
    expect([...values].sort()).toEqual([...SUNO_ADD_TRACK_MODELS].sort())
  })

  it("drops the versions those routes reject (V4, V4_5, V4_5ALL)", () => {
    const { container } = render(<SunoAddVocalsConfig {...common} data={data()} />)
    for (const rejected of ["V4", "V4_5", "V4_5ALL"]) {
      expect(SUNO_ADD_TRACK_MODELS as readonly string[]).not.toContain(rejected)
      expect(optionValues(container)).not.toContain(rejected)
    }
  })
})

// gen-skills parses NODE_DEFINITIONS textually, so the seven Suno defaults are
// the literal "V6" rather than DEFAULT_SUNO_MODEL. This is the guard that keeps
// the literal and the constant equal.
describe("Suno NODE_DEFINITIONS defaults", () => {
  it("every Suno node with a model field defaults to DEFAULT_SUNO_MODEL", async () => {
    const { NODE_DEFINITIONS } = await import("@/types/nodes")
    const withModel = NODE_DEFINITIONS.filter(
      (d) => d.type.startsWith("suno-") && "model" in ((d.defaultData as Record<string, unknown> | undefined) ?? {}),
    )
    expect(withModel.map((d) => d.type).sort()).toEqual([
      "suno-add-instrumental", "suno-add-vocals", "suno-cover", "suno-extend",
      "suno-generate", "suno-mashup", "suno-upload-extend",
    ])
    for (const d of withModel) {
      expect((d.defaultData as Record<string, unknown>).model, d.type).toBe(DEFAULT_SUNO_MODEL)
    }
  })
})
