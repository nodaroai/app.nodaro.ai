import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { LLM_MODELS, VOICE_CHANGER_MODELS } from "@nodaro/shared"
import { LABEL_TABLES, localizeModelDescription } from "../labels"

/**
 * Model DESCRIPTIONS ("Higher detail, production images") are marketing
 * micro-copy that ships as `desc:` strings in config-panels/model-options.ts
 * and in @nodaro/shared's LLM / voice-changer tables. They render under the
 * model name in every provider dropdown and in the description hint below
 * it, and were the last English left in a translated config panel. Like node
 * labels, they are looked up by their English string — an unmapped one
 * silently renders English, so coverage is asserted here for every locale
 * registered in LABEL_TABLES.
 */
const SRC = path.resolve(__dirname, "../../..")
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8")

function shippedDescriptions(): string[] {
  const options = read("components/editor/config-panels/model-options.ts")
  // `desc:` AND `description:` — the upscale / modify tables use the long form.
  // Read as source text, so a `–` escape is decoded to the character the
  // runtime string (and the tables' keys) actually hold.
  const fromOptions = [...options.matchAll(/\bdesc(?:ription)?:\s*"([^"]+)"/g)].map((m) =>
    m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  )
  const fromShared = [...LLM_MODELS.map((m) => m.desc), ...VOICE_CHANGER_MODELS.map((m) => m.desc)]
  return [...fromOptions, ...fromShared]
}

describe("model-description tables coverage", () => {
  it("every shipped model description has an entry in every locale", () => {
    const shipped = [...new Set(shippedDescriptions())]
    // Floor so a reshaped model-options.ts fails loudly instead of extracting
    // nothing and passing for free.
    expect(shipped.length).toBeGreaterThan(100)
    const missing = Object.entries(LABEL_TABLES).flatMap(([locale, tables]) =>
      shipped.filter((d) => !(d in (tables?.modelDescription ?? {}))).map((d) => `${locale}: ${d}`),
    )
    expect(missing, `untranslated model descriptions: ${missing.join(" | ")}`).toEqual([])
  })

  it("localizes a known description and passes an unknown one through", () => {
    expect(localizeModelDescription("Higher detail, production images", "he")).not.toBe("Higher detail, production images")
    expect(localizeModelDescription("Higher detail, production images", "en")).toBe("Higher detail, production images")
    expect(localizeModelDescription("Some brand-new model copy", "he")).toBe("Some brand-new model copy")
  })
})
