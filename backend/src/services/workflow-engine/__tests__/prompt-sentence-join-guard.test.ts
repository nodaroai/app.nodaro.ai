/**
 * Prompt pieces join through `joinSentences` / `appendPromptHints`
 * (@nodaro/prompts), never a hand-written `${a}. ${b}`: a typed prompt that
 * already ends with a period came out as "no watermark.. butterfly portrait
 * lighting" on every picker run. This keeps a new composer site from bringing
 * the double period back.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(join(__dirname, "..", "payload-builder.ts"), "utf8")

describe("payload-builder prompt joins", () => {
  // It also fires on a non-prompt template such as `${code}. ${detail}`. That
  // is deliberate: reach for joinSentences there too, never loosen the pattern.
  it("glues no two values with a hand-written '. ' (use joinSentences / appendPromptHints)", () => {
    expect(SRC.match(/`\$\{[^`]*?\}\. \$\{/g) ?? []).toEqual([])
  })
})
