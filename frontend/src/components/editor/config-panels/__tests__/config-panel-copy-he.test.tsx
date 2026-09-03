import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import fs from "node:fs"
import path from "node:path"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0, prefetchModelCredits: vi.fn() }))

import { ExtractAudioConfig } from "../processing-configs"
import { EFFORT_LABELS } from "../reasoning-effort-select"
import { TIER_LABELS } from "../llm-model-select"
import { HELPER_LABELS } from "../scene-helper-buttons"
import { GENERATE_TEXT_TEMPLATES } from "@/lib/generate-text-templates"
import { LEGEND_META } from "../prompt-field-final-view"
import { REDUCE_INPUT_KIND_OPTIONS } from "../reduce-strategy-forms"
import { SUNO_FIELD_EDIT_META } from "../suno-field-editor"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"
import { isLocalizedTableKey } from "@/lib/i18n/labels"
import { scanRawEnglish, scanBootFrozenTables, listSourceFiles, BRAND_ALLOW, ALLOW_SINGLE } from "@/test-utils/raw-english-scan"

const SRC = path.resolve(__dirname, "../../../..")
/** Surfaces outside config-panels/ that render inside the panels (or share their copy). */
const EXTRA_COPY_FILES = [
  "components/editor/save-to-library-button.tsx",
  "components/editor/asset-selection-modal.tsx",
]

const setLocale = (l: "he" | "en") => act(() => useLocaleStore.getState().setLocale(l))
afterEach(() => {
  cleanup()
  setLocale("en")
})

/**
 * The config panels' own copy ("No settings — connect a video…", option
 * labels, hints) was raw English in a Hebrew UI. Two guards:
 *  1. a render: a panel reads Hebrew, including a node NAME inside prose,
 *     which goes through the node-label table, not a key;
 *  2. label TABLES that used to be module constants (frozen to the boot
 *     locale) are live getters now — they must follow a locale switch.
 */
describe("config-panel copy in Hebrew", () => {
  beforeEach(() => setLocale("he"))

  it("a settings-free panel explains itself in Hebrew, node name included", () => {
    render(
      <ExtractAudioConfig
        data={{ label: "Extract Audio", fieldMappings: {} }}
        onUpdate={() => {}}
        sources={[]}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={[]}
        nodeRefs={[]}
      />,
    )
    // The node name is spliced INTO the localized sentence now (the key owns
    // the whole hint), so assert the resolved sentence rather than a bare
    // text node — same guarantee, resolved through the dict instead of a
    // hand-copied literal.
    expect(document.body.textContent).toContain(
      translate("he", "proccfg.noSettingsConnectAVideoTo", { node: "הסרת אודיו" }),
    )
    expect(screen.queryByText("Remove Audio")).toBeNull()
    expect(document.body.textContent).not.toMatch(/No settings/)
  })

  it("label tables follow a locale switch instead of freezing at boot", () => {
    // Every sampled value is a STRING (an object identity would differ between
    // two getter calls whatever the copy says), and each table is sampled at
    // both ends so a half-localized table is caught.
    const first = <T,>(o: Record<string, T>) => Object.values(o)[0]
    const last = <T,>(o: Record<string, T>) => Object.values(o)[Object.values(o).length - 1]
    const read = (): Record<string, string> => ({
      effortFirst: first(EFFORT_LABELS()),
      effortLast: last(EFFORT_LABELS()),
      tierFirst: first(TIER_LABELS()),
      tierLast: last(TIER_LABELS()),
      tplFirst: GENERATE_TEXT_TEMPLATES()[0].label,
      tplLast: GENERATE_TEXT_TEMPLATES().at(-1)!.label,
      helperLabel: first(HELPER_LABELS()).label,
      helperTooltip: first(HELPER_LABELS()).tooltip,
      helperLastLabel: last(HELPER_LABELS()).label,
      legendFirst: LEGEND_META()[0].label,
      legendLast: LEGEND_META().at(-1)!.label,
      reduceKindFirst: REDUCE_INPUT_KIND_OPTIONS()[0].label,
      sunoTitle: SUNO_FIELD_EDIT_META().title.label,
      sunoPlaceholder: SUNO_FIELD_EDIT_META().lyrics.placeholder,
    })
    const he = read()
    setLocale("en")
    const en = read()
    for (const k of Object.keys(he)) {
      expect(typeof he[k], `${k} is not a string`).toBe("string")
      expect(en[k], `${k} en is not English`).toMatch(/[A-Za-z]/)
      expect(he[k], `${k} he is not Hebrew`).toMatch(/[\u0590-\u05FF]/)
      expect(he[k], `${k} froze at boot`).not.toBe(en[k])
    }
  })
})

/**
 * Nothing in the config panels may render a raw English text node, string
 * prop or data-module label. Source scan (test-utils/raw-english-scan) over
 * the whole directory — recursive, .ts included — plus the surfaces that live
 * outside it but render inside every generate panel (the Save-to-Library
 * button, the asset picker modal) and the node-card toolbar that shares the
 * panels' copy. Strings that a runtime localizer translates by lookup
 * (node/handle names, model descriptions, option labels) are not leaks.
 */
describe("config panels render no raw English", () => {
  // The node CARDS (components/nodes/) share the panels' copy and render on
  // the same canvas — covered by the same scan since the node-cards round.
  const files = [
    ...listSourceFiles([path.join(SRC, "components/editor/config-panels"), path.join(SRC, "components/nodes")]),
    ...EXTRA_COPY_FILES.map((rel) => path.join(SRC, rel)),
  ]
  expect(files.length).toBeGreaterThan(300)
  for (const f of files) {
    const rel = path.relative(SRC, f)
    it(`${rel} has no raw English text, string props or data labels`, () => {
      const hits = scanRawEnglish(fs.readFileSync(f, "utf8"), { file: rel, isLocalizedData: isLocalizedTableKey })
      expect(hits, `raw English in ${rel}:\n${hits.map((h) => `${h.line} ${h.kind}: ${h.snippet}`).join("\n")}`).toEqual([])
    })
  }
})

/**
 * A module-scope label table whose initializer calls t()/tx() resolves its
 * copy at IMPORT time and freezes on the boot locale — the class the PR
 * turned into getter functions. Source scan over both directories (and the
 * shared template module) so a table converted back to a constant fails
 * here, whichever of the ~55 it is.
 */
describe("no label table resolves its copy at import time", () => {
  const files = [
    ...listSourceFiles([path.join(SRC, "components/editor/config-panels"), path.join(SRC, "components/nodes")]),
    path.join(SRC, "lib/generate-text-templates.ts"),
  ]
  it("covers the panels and the node components", () => {
    expect(files.length).toBeGreaterThan(150)
  })
  it("reports nothing in the current tree", () => {
    const hits = files.flatMap((f) => scanBootFrozenTables(fs.readFileSync(f, "utf8"), path.relative(SRC, f)))
    expect(hits.map((h) => `${h.file}:${h.line} ${h.snippet}`)).toEqual([])
  })
  it("fires on a frozen table and stays quiet on a getter (self-check)", () => {
    const frozen = `import { tx } from "@/lib/i18n"\nexport const LABELS = {\n  a: tx("x.a"),\n}\n`
    expect(scanBootFrozenTables(frozen).map((h) => h.snippet)).toEqual(["LABELS"])
    const array = `const ROWS = [\n  { label: tx("x.a") },\n]\n`
    expect(scanBootFrozenTables(array).map((h) => h.snippet)).toEqual(["ROWS"])
    const getter = `export function LABELS() {\n  return { a: tx("x.a") }\n}\nconst SET = new Set(["a"])\nconst PLAIN = { a: "x" }\n`
    expect(scanBootFrozenTables(getter)).toEqual([])
    // An indented const is function-local, not module scope.
    expect(scanBootFrozenTables(`function f() {\n  const T = { a: tx("k") }\n}\n`)).toEqual([])
  })
})

describe("the raw-English scan (self-check)", () => {
  it("catches the shapes the old regexes missed", () => {
    const src = [
      `<p>Are you sure?</p>`,
      `<span>Note: connect a video</span>`,
      `<div>Image 1 carries the look</div>`,
      `<p>Some text {name}</p>`,
      `<Label>\n  Two words\n</Label>`,
      `<b>Duration</b>`,
      `<Input placeholder={"Describe it"} />`,
      `<Input placeholder={cond ? "Yes please" : "No thanks"} />`,
      `<Button title={\`Open log\`} />`,
      `const ROWS = [{ label: "Judge by" }]`,
      `<SelectTrigger title="AI model" />`,
    ].join("\n")
    const kinds = scanRawEnglish(src).map((h) => `${h.kind}:${h.snippet}`)
    for (const want of ["jsx-text:Are you sure?", "jsx-text:Note: connect a video", "jsx-text:Image 1 carries the look", "jsx-text:Some text", "jsx-text:Two words", "single-word:Duration", "prop:Describe it", "prop:Yes please", "prop:No thanks", "prop:Open log", "object-prop:Judge by", "prop:AI model"]) {
      expect(kinds, want).toContain(want)
    }
  })
  it("exercises the brand and token allowlists", () => {
    const src = `<p>Nano Banana Pro</p><b>Pro</b><b>Beta</b><Input placeholder="Kling 3.0 only" /><span>{t("x")}</span>`
    expect(scanRawEnglish(src)).toEqual([])
    expect(BRAND_ALLOW.test("Nano Banana Pro")).toBe(true)
    expect(BRAND_ALLOW.test("Banana bread is not a brand")).toBe(false)
    expect(ALLOW_SINGLE.has("Pro")).toBe(true)
  })
  it("catches a mode id rendered as the segment's visible text", () => {
    const leak = `{(["edit", "final", "both"] as const).map((m) => (\n  <button key={m} title={t("x")}>\n    {m}\n  </button>\n))}`
    expect(scanRawEnglish(leak).map((h) => `${h.kind}:${h.snippet}`)).toEqual(["id-as-text:m"])
    const keyed = `{(["edit", "final"] as const).map((m) => (<button key={m}>{m === "edit" ? t("a") : t("b")}</button>))}`
    expect(scanRawEnglish(keyed)).toEqual([])
  })
  it("spares a handle pip's label= only when the handle-label table knows it", () => {
    const known = `<HandleWithPopover nodeId={id} label="Start Frame" color={c} />`
    const unknown = `<HandleWithPopover nodeId={id} label="Some New Pip" color={c} />`
    const plain = `<Button label="Start Frame" />`
    expect(scanRawEnglish(known, { isLocalizedData: isLocalizedTableKey })).toEqual([])
    expect(scanRawEnglish(unknown, { isLocalizedData: isLocalizedTableKey }).map((h) => h.snippet)).toEqual(["Some New Pip"])
    expect(scanRawEnglish(plain, { isLocalizedData: isLocalizedTableKey }).map((h) => h.snippet)).toEqual(["Start Frame"])
  })
  it("spares a data label that a runtime localizer translates", () => {
    const src = `const OPTS = [{ label: "From image" }, { label: "Photorealistic, high detail" }]`
    expect(scanRawEnglish(src).length).toBe(2)
    expect(scanRawEnglish(src, { isLocalizedData: isLocalizedTableKey })).toEqual([])
  })
})
