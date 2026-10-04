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
 * TWO CHECKS, over every non-test source file of the repo (comments stripped first):
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
 *
 * WHAT IT CANNOT SEE: a comparison dressed up inside one of the listed files (an
 * alias constant, a lookup in a local map). Review owns those; the listed files are
 * few on purpose. Assigning, listing or defaulting to an id is fine.
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
  "backend/src/ee/pipelines/services/pipeline-generate-narration.ts": "narration's default model (pinned to v3 by decision until the default flip)",
  "backend/src/ee/video-director/orchestrate.ts": "the video director's default narration model (same decision)",
  "backend/src/lib/mcp/tools/verbs-audio.ts": "generate_speech's default model and its tool copy",
  "backend/src/providers/elevenlabs/direct-dialogue.ts": "dialogue resolves its language code through the v3 sheet (its own lane, until it moves onto the sheet)",
  "backend/src/providers/elevenlabs/tts-models.ts": "the wire-model table",
  "backend/src/routes/text-to-speech.ts": "the omitted-provider default (v3 up to its cap) and the route's schema default",
  "backend/src/routes/voices.ts": "the Voice Library's verified-provider order",
  "backend/src/services/workflow-engine/payload-builder.ts": "the text-to-speech node's dispatch default",
  "backend/src/workers/handlers/audio-ai.ts": "the worker's defensive default",
  "frontend/src/components/editor/config-panels/audio-configs.tsx": "the panel's default selection and the Voice Library snap",
  "frontend/src/components/editor/config-panels/model-options.ts": "the picker's model list",
  "frontend/src/types/nodes.ts": "the text-to-speech node's default data",
  "packages/shared/src/model-catalog.ts": "the catalog entries",
  "packages/shared/src/model-constants.ts": "TTS_PROVIDERS",
}

const LITERAL = String.raw`["'\x60]elevenlabs-v[34]["'\x60]`
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
