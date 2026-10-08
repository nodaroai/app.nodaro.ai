/**
 * The public speech docs state each model's capability sheet in prose and
 * table cells: the Providers table (audio tags, continuity, languages, cap),
 * the "models that stitch" lists on the MCP and SDK pages, the timings sentence
 * and the changeset's cap. Each cell here is read from `MODEL_CATALOG` through
 * the same `@nodaro/shared` lookups the runtime uses, so a sheet value that
 * changes (the v4 Turbo probe, a later model) fails the build naming the cell
 * that now lies — a `(Task 0)` marker in the docs is not needed, and none exists.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  TTS_PROVIDERS,
  getTtsCapabilities,
  ttsSupportsAudioTags,
  ttsSupportsStitching,
  ttsSupportsTimestamps,
} from "@nodaro/shared"

const ROOT = join(__dirname, "..", "..", "..", "..")
const ttsDoc = readFileSync(join(ROOT, "docs/nodes/ai-audio/text-to-speech.md"), "utf8")
const mcpTools = readFileSync(join(ROOT, "docs/mcp/tools.md"), "utf8")
const sdkReference = readFileSync(join(ROOT, "docs/sdk-reference.md"), "utf8")

/**
 * How the docs name each speech model, in the Providers table's row order. The
 * key set must be every TTS provider that has a catalog sheet (the legacy
 * `elevenlabs` id is an alias of turbo with no row of its own).
 */
const DOC_NAMES: Record<string, { short: string; sdk: string }> = {
  "elevenlabs-v4": { short: "v4", sdk: "ElevenLabs v4" },
  "elevenlabs-v3": { short: "v3", sdk: "v3" },
  "elevenlabs-v4-turbo": { short: "v4 Turbo", sdk: "v4 Turbo" },
  "elevenlabs-turbo": { short: "Turbo v2.5", sdk: "Turbo v2.5" },
  "elevenlabs-multilingual": { short: "Multilingual v2", sdk: "Multilingual v2" },
}
const SHEET_IDS = TTS_PROVIDERS.filter((id) => MODEL_CATALOG[id]?.tts)
const DOC_IDS = Object.keys(DOC_NAMES)

const joinList = (names: string[], last: string) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")}${last}${names.at(-1)}`

function providersRow(id: string): string[] {
  const line = ttsDoc.split("\n").find((l) => l.startsWith(`| \`${id}\` |`))
  expect(line, `text-to-speech.md Providers table has no row for \`${id}\``).toBeDefined()
  return line!.split("|").map((c) => c.trim()).slice(1, -1)
}

describe("text-to-speech.md Providers table reads each model's sheet", () => {
  it("names every speech model that has a sheet, and no other", () => {
    expect([...DOC_IDS].sort()).toEqual([...SHEET_IDS].sort())
  })

  it.each(DOC_IDS)("%s: audio tags, continuity, languages and cap are the sheet's", (id) => {
    const sheet = getTtsCapabilities(id)
    const [, , languages, audioTags, continuity, cap] = providersRow(id)
    expect(languages, `${id} Languages`).toBe(String(sheet.languages.length))
    expect(audioTags, `${id} Audio Tags`).toBe(ttsSupportsAudioTags(id) ? "Yes" : "No (stripped)")
    expect(continuity, `${id} Continuity`).toBe(ttsSupportsStitching(id) ? "**Yes**" : "No")
    expect(cap, `${id} Per-request character cap`).toBe(sheet.maxChars.toLocaleString("en-US"))
  })
})

describe("the models that stitch are listed from the sheet on every page that lists them", () => {
  const stitchers = DOC_IDS.filter((id) => ttsSupportsStitching(id))
  const nonStitchers = DOC_IDS.filter((id) => !ttsSupportsStitching(id))

  it("docs/mcp/tools.md generate_speech row", () => {
    const list = `on models that stitch (${stitchers.map((id) => DOC_NAMES[id]!.short).join(", ")}; not ${nonStitchers.map((id) => DOC_NAMES[id]!.short).join(", ")})`
    expect(mcpTools).toContain(list)
  })

  it("docs/sdk-reference.md continuity note", () => {
    const list = `a model that stitches\n> (${joinList(stitchers.map((id) => DOC_NAMES[id]!.sdk), " and ")}; not ${joinList(nonStitchers.map((id) => DOC_NAMES[id]!.sdk), " and ")})`
    expect(sdkReference).toContain(list)
  })
})

describe("the timings sentence under Inputs & Outputs", () => {
  it("says every speech model returns timings only while every sheet says so", () => {
    const timed = DOC_IDS.filter((id) => ttsSupportsTimestamps(id))
    const untimed = DOC_IDS.filter((id) => !ttsSupportsTimestamps(id))
    const sentence = "every speech model (ElevenLabs v3, v4, v4 Turbo, Turbo v2.5 and Multilingual v2) returns its timings"
    if (untimed.length === 0) {
      expect(timed.sort()).toEqual([...DOC_IDS].sort())
      expect(ttsDoc).toContain(sentence)
    } else {
      // Rewrite the sentence to name the models that return timings (and the
      // ones that do not), then pin the new wording here.
      expect(ttsDoc, `${untimed.join(", ")} say timestamps: false — the "every speech model" sentence must name only ${timed.join(", ")}`).not.toContain(sentence)
    }
  })
})

describe("the v4 Turbo changeset states the sheet's cap", () => {
  const changeset = join(ROOT, ".changeset/elevenlabs-v4-turbo.md")
  it.skipIf(!existsSync(changeset))("up to <maxChars> characters per request", () => {
    const cap = getTtsCapabilities("elevenlabs-v4-turbo").maxChars.toLocaleString("en-US")
    expect(readFileSync(changeset, "utf8")).toContain(`up to ${cap} characters per request`)
  })
})
