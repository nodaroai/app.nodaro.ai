/**
 * Guard: nothing decides anything by comparing a provider id to the `"elevenlabs-v3"`
 * or `"elevenlabs-v4"` literal, and a source file cannot start naming either id
 * without a reviewer seeing it.
 *
 * Which tags, settings, languages and length a speech model takes is its capability
 * sheet (`MODEL_CATALOG[id].tts`, read through the lookups in `@nodaro/shared`);
 * which ElevenLabs model it runs on is its row in `providers/elevenlabs/tts-models.ts`.
 * A check written against one of those ids is how the next model quietly gets the
 * wrong behaviour — a check for v3 that nobody finds when v4 arrives. If this test
 * fails, read the sheet instead; if the model really needs a new fact, add it to
 * the sheet.
 *
 * THREE CHECKS, over every non-test source file of the repo (comments stripped first):
 *  1. NO COMPARISON, anywhere. A comparison against either literal (`===`, `!==`,
 *     `==`, `!=` on either side, `case`, `Object.is`) or a membership test on an
 *     array / `Set` literal that holds it. Split across lines is seen too.
 *  2. A REVIEWED LIST of the files that may name either id at all, each with its
 *     reason. Every other file must not contain the literal. This catches the
 *     shapes check 1 cannot parse — `const V3_MODELS = ["elevenlabs-v3"]` and then
 *     `V3_MODELS.includes(provider)` (the exact shape this change removed), a regex,
 *     a map lookup, a const alias — in a file that has no business naming a model.
 *     The list is checked for rot the other way too: an entry whose file no longer
 *     names an id must be removed.
 *  3. NO DEFAULTING TO AN ID outside `DEFAULT_TTS_PROVIDER`'s definition: `?? "…"`,
 *     `|| "…"`, `provider: "…"`, `{ provider = "…" }`, `const DEFAULT_X = "…"`. "The
 *     model when none is chosen" is that one constant, so a new lane cannot spell its
 *     own default and drift when the default moves (it moved to v4, decided 2026-10-05).
 *
 * WHAT IT CANNOT SEE: a comparison dressed up inside one of the listed files (an
 * alias constant, a lookup in a local map). Review owns those; the listed files are
 * few on purpose. Assigning or listing an id is fine for checks 1 and 2; defaulting
 * to one is check 3's business.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const ROOTS = [
  "backend/src",
  "backend/scripts",
  "frontend/src",
  "packages/shared/src",
  "packages/prompts/src",
  "packages/client/src",
  "packages/cli/src",
  "packages/picker-ui/src",
  "packages/remotion/src",
  "tools",
  "scripts",
]

/** The files that may name either id, and why. Add one only when the file must; the reason is what a reviewer reads. */
const MAY_NAME_THE_IDS: Readonly<Record<string, string>> = {
  "backend/src/ee/billing/credits.ts": "STATIC_CREDIT_COSTS — the price table",
  "backend/src/ee/billing/voice-changer-pro-credits.ts": "RESPEAK_ENGINE_MODELS — the Re-speak engine → text-to-speech model table (which model's unit row prices each Re-speak engine; its default is the ENGINE v3, the plugin's contract, not the speech default model)",
  "backend/src/lib/mcp/tools/verbs-audio.ts": "generate_speech's tool copy describes each model (its default is DEFAULT_TTS_PROVIDER)",
  "backend/src/providers/elevenlabs/dialogue-models.ts": "the dialogue wire-model table: each dialogue model's text-to-speech twin",
  "backend/src/lib/pricing/elevenlabs-speech-cost.ts": "ELEVENLABS_SPEECH_USD_PER_1K_CHARS — the per-model rate table the :per-100-chars rows are re-derived from",
  "backend/src/providers/elevenlabs/tts-models.ts": "the wire-model table",
  "backend/src/routes/voices.ts": "the Voice Library's verified-provider order",
  "frontend/src/components/editor/config-panels/audio-configs.tsx": "the panel shows the legacy `elevenlabs` id as v3 (a known display mismatch, unchanged), and Voice Design's v3 model reads the v3 sheet",
  "frontend/src/components/editor/config-panels/model-options.ts": "the picker's model list",
  "frontend/src/types/nodes.ts": "the text-to-speech node's exposable Model options (its default data reads DEFAULT_TTS_PROVIDER)",
  "packages/shared/src/model-catalog.ts": "the catalog entries and the narration recommendation",
  "packages/shared/src/model-constants.ts": "TTS_PROVIDERS, and DEFAULT_TTS_PROVIDER — the one place the default model is spelled",
}

/**
 * The files that may DEFAULT to either id, and why. Every lane that needs "the model when
 * none is chosen" imports `DEFAULT_TTS_PROVIDER`, so moving the default cannot leave a lane
 * behind (the default flip, decided 2026-10-05, found eight sites spelling the literal).
 * The node definition is the one exception the gen:skills parser forces: it reads
 * `defaultData` statically and cannot follow an imported constant, so the literal stays
 * there and a frontend test pins it equal to the constant.
 */
const MAY_DEFAULT_TO_AN_ID: Readonly<Record<string, string>> = {
  "packages/shared/src/model-constants.ts": "DEFAULT_TTS_PROVIDER's definition",
  "frontend/src/types/nodes.ts":
    "the text-to-speech node's defaultData (static for gen:skills; text-to-speech-default-model.test.ts pins it to DEFAULT_TTS_PROVIDER)",
}

const LITERAL = String.raw`["'\x60]elevenlabs-v[34]["'\x60]`
const DEFAULTING: readonly RegExp[] = [
  // `provider ?? "elevenlabs-v4"`, `data.provider || "elevenlabs-v3"`
  new RegExp(String.raw`(?:\?\?|\|\|)\s*${LITERAL}`),
  // `provider: "elevenlabs-v3"` (node default data, a request body), `{ provider = "elevenlabs-v4" } = args`
  new RegExp(String.raw`\b(?:provider|model|modelId|ttsProvider)\s*[:=]\s*${LITERAL}`),
  // `const DEFAULT_MODEL = "elevenlabs-v4"`, `defaultModel: "elevenlabs-v3"`
  new RegExp(String.raw`\b\w*default\w*\s*(?::\s*[\w.<>[\]| ]+)?[:=]\s*${LITERAL}`, "i"),
]
const COMPARISONS: readonly RegExp[] = [
  // `=== "elevenlabs-v3"`, `case "elevenlabs-v4":` (whitespace may include newlines)
  new RegExp(String.raw`(?:[!=]==?|\bcase\b)\s*${LITERAL}`),
  // `"elevenlabs-v3" === x`
  new RegExp(String.raw`${LITERAL}\s*[!=]==?`),
  // `Object.is(x, "elevenlabs-v3")`
  new RegExp(String.raw`Object\.is\([^)]*${LITERAL}`),
  // `["elevenlabs-v3"].includes(x)`, `(["elevenlabs-v3"] as const).includes(x)`, `.some(` …
  new RegExp(String.raw`\[[^\]]*${LITERAL}[^\]]*\]\s*(?:as\s+(?:const|readonly\s+string\[\]))?\s*\)?\s*\.(?:includes|indexOf|some|every|find)\(`),
  // `new Set(["elevenlabs-v3"])`, `new Set<string>([...])`
  new RegExp(String.raw`new\s+Set(?:<[^>]*>)?\(\s*\[[^\]]*${LITERAL}`),
]
const ANY_ID = new RegExp(LITERAL)

/** Drop block and line comments (a line comment starts a line or follows whitespace, so a URL's `//` stays). */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1))
  return noBlocks.replace(/(^|\s)\/\/[^\n]*/g, "$1")
}

function isTestFile(path: string): boolean {
  return /(^|[\\/])(__tests__|__mocks__|test)[\\/]/.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "generated") continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (/\.[cm]?[jt]sx?$/.test(entry) && !entry.endsWith(".d.ts") && !isTestFile(p)) out.push(p)
  }
  return out
}

function sources(): Array<{ rel: string; code: string }> {
  return ROOTS.flatMap((root) => walk(join(REPO_ROOT, root))).map((file) => ({
    rel: relative(REPO_ROOT, file).split(sep).join("/"),
    code: stripComments(readFileSync(file, "utf8")),
  }))
}

const isComparison = (code: string) => COMPARISONS.some((re) => re.test(code))

describe("no comparison against a v3 / v4 provider id", () => {
  it("the comparison patterns match what they are meant to catch", () => {
    for (const bad of [
      'if (provider === "elevenlabs-v3") {',
      "if (provider !== 'elevenlabs-v4') {",
      'return "elevenlabs-v3" == provider',
      'case "elevenlabs-v3":',
      "provider === `elevenlabs-v4`",
      'provider ===\n    "elevenlabs-v3"',
      'Object.is(provider, "elevenlabs-v3")',
      '["elevenlabs-v3"].includes(provider)',
      '(["elevenlabs-v3", "elevenlabs-v4"] as const).includes(provider)',
      'new Set(["elevenlabs-v3"]).has(provider)',
      'new Set<string>(["elevenlabs-v3", "elevenlabs-v4"])',
    ]) {
      expect(isComparison(stripComments(bad)), bad).toBe(true)
    }
  })

  it("…and leave assigning, listing and defaulting alone, and a comment that quotes the old shape", () => {
    for (const fine of [
      'provider: "elevenlabs-v3",',
      'const DEFAULT = "elevenlabs-v3"',
      'STATIC_CREDIT_COSTS["elevenlabs-v3"] = 30',
      'if (provider === "elevenlabs-turbo") {',
      'provider ?? "elevenlabs-v3"',
      'const TTS_PROVIDERS = ["elevenlabs-v3", "elevenlabs-v4"] as const\nexport type T = typeof TTS_PROVIDERS[number]\nTTS_PROVIDERS.includes(x)',
      '// was: provider === "elevenlabs-v3"',
      '/* case "elevenlabs-v3": */ const x = 1',
      '/**\n * the old code read `provider === "elevenlabs-v3"` here\n */\nconst x = 1',
    ]) {
      expect(isComparison(stripComments(fine)), fine).toBe(false)
    }
  })

  it("scans the whole repo's source, not three directories", () => {
    const files = sources()
    expect(files.length).toBeGreaterThan(1000)
    for (const must of ["backend/src/workers/handlers/audio-ai.ts", "frontend/src/lib/audio-tags.ts", "packages/shared/src/tts-capabilities.ts"]) {
      expect(files.map((f) => f.rel), must).toContain(must)
    }
  })

  it("no source file compares a provider id to the v3 or v4 literal", () => {
    const offenders = sources().filter((f) => isComparison(f.code)).map((f) => f.rel)
    expect(offenders, `Read the model's capability sheet instead of comparing its id:\n${offenders.join("\n")}`).toEqual([])
  })

  it("only the reviewed files name either id at all", () => {
    const naming = sources().filter((f) => ANY_ID.test(f.code)).map((f) => f.rel)
    const unreviewed = naming.filter((rel) => !(rel in MAY_NAME_THE_IDS))
    expect(
      unreviewed,
      `These files name "elevenlabs-v3" / "elevenlabs-v4" but are not on the reviewed list. Read the model's capability sheet; if the file must name an id, add it to MAY_NAME_THE_IDS with the reason:\n${unreviewed.join("\n")}`,
    ).toEqual([])
    const stale = Object.keys(MAY_NAME_THE_IDS).filter((rel) => !naming.includes(rel))
    expect(stale, `Listed in MAY_NAME_THE_IDS but no longer naming an id (or gone) — remove the entry:\n${stale.join("\n")}`).toEqual([])
  })
})

const isDefaulting = (code: string) => DEFAULTING.some((re) => re.test(code))

describe("no lane spells the default speech model", () => {
  it("the defaulting patterns match what they are meant to catch", () => {
    for (const bad of [
      'const provider = rawProvider ?? "elevenlabs-v3"',
      "const p = data.provider || 'elevenlabs-v4'",
      "modelId ?? `elevenlabs-v4`",
      'injectJob("/v1/text-to-speech", { text, provider: "elevenlabs-v3", userId })',
      'defaultData: { label: "Text to Speech", provider: "elevenlabs-v4", voiceId: "Rachel" }',
      'const { provider = "elevenlabs-v4" } = args',
      'const DEFAULT_SPEECH_MODEL = "elevenlabs-v4"',
      'const defaultModel: string = "elevenlabs-v3"',
      'defaultValue: "elevenlabs-v4",',
    ]) {
      expect(isDefaulting(stripComments(bad)), bad).toBe(true)
    }
  })

  it("…and leave listing, pricing, mapping and reading the constant alone", () => {
    for (const fine of [
      'options: [{ value: "elevenlabs-v4", label: "ElevenLabs v4 (recommended)" }]',
      'id: "elevenlabs-v3",',
      'pricing: [{ identifier: "elevenlabs-v4", credits: 30 }]',
      '"elevenlabs-v3": 30,',
      '"elevenlabs-v4": "eleven_v4",',
      'verified.push("elevenlabs-v3")',
      'const provider = rawProvider ?? DEFAULT_TTS_PROVIDER',
      'provider: DEFAULT_TTS_PROVIDER,',
      'modelIds: ["elevenlabs-v4", "elevenlabs-v3", "elevenlabs-turbo"]',
      '"**Picking a model**: `elevenlabs-v4` (default) supports tags"',
      '// was: provider ?? "elevenlabs-v3"',
    ]) {
      expect(isDefaulting(stripComments(fine)), fine).toBe(false)
    }
  })

  it("no source file outside the constant's definition defaults to the v3 or v4 literal", () => {
    const offenders = sources()
      .filter((f) => !(f.rel in MAY_DEFAULT_TO_AN_ID) && isDefaulting(f.code))
      .map((f) => f.rel)
    expect(
      offenders,
      `Read DEFAULT_TTS_PROVIDER (@nodaro/shared) instead of spelling the default model:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("the constant's definition is where the default literal actually lives", () => {
    const constants = sources().find((f) => f.rel === "packages/shared/src/model-constants.ts")
    expect(constants?.code).toMatch(new RegExp(String.raw`DEFAULT_TTS_PROVIDER\s*:\s*TtsProvider\s*=\s*${LITERAL}`))
  })

  it("each file allowed to default still does (an exemption that no longer applies must go)", () => {
    const all = sources()
    const stale = Object.keys(MAY_DEFAULT_TO_AN_ID).filter((rel) => !isDefaulting(all.find((f) => f.rel === rel)?.code ?? ""))
    expect(stale, `Listed in MAY_DEFAULT_TO_AN_ID but no longer defaulting to an id — remove the entry:\n${stale.join("\n")}`).toEqual([])
  })

  it("the node definition defaults to exactly one id, and only for the text-to-speech node", () => {
    const nodes = sources().find((f) => f.rel === "frontend/src/types/nodes.ts")!.code
    const hits = [...nodes.matchAll(new RegExp(DEFAULTING.map((re) => re.source).join("|"), "gi"))]
    expect(hits).toHaveLength(1)
    expect(nodes.slice(Math.max(0, hits[0]!.index! - 200), hits[0]!.index!)).toMatch(/defaultData: \{ label: "Text to Speech", $/)
  })
})
