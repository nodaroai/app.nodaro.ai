// @test-watches backend/src/providers/kie/__tests__/fixtures/kling-mentions-dev.json
/**
 * The mention pass Kling 4.0 video and Kling Image 4.0 share. Video (no
 * rules) reads every prompt exactly as origin/dev did, its outputs recorded in
 * the fixture, with no exception. Kling Image 4.0 (`KLING_IMAGE_MENTION_RULES`)
 * differs only where intended: an e-mail-shaped token (a word character before
 * `@` and a dotted domain after the name) is no longer a mention, a Chinese
 * name followed directly by Chinese text binds, and a name run straight into
 * another letter (kana, hangul, an accented letter, a combining mark) loses its `@`.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { neutralizeUndeclaredMentions } from "../kling4.js"
import { KLING_IMAGE_MENTION_RULES } from "../kling-image-4.js"

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "kling-mentions-dev.json"), "utf8")) as {
  corpus: Array<{ prompt: string; declared: string[]; dev: string }>
}

const INTENDED: Record<string, string> = {
  "write to bob@image_1.com": "write to bobimage_1.com",
  "mail kira@Kira.io now": "mail kiraKira.io now",
  "@小明在跑": "@小明在跑",
  "@小明跳舞 @小明": "@小明跳舞 @小明",
  // A name run straight into another letter loses its @ (the provider may read it as part of the name).
  "@image_1の女性": "image_1の女性",
  "@Kiraの笑顔": "Kiraの笑顔",
  "@Kira한테": "Kira한테",
  "@Kiraé": "Kiraé",
  "@小明の顔": "小明の顔",
  "@image_1é": "image_1é",
  // A combining accent straight after the name counts as a letter.
  "@Kira\u0301 smiles": "Kira\u0301 smiles",
  "@image_1\u0301": "image_1\u0301",
}

describe("Kling 4.0 video reads mentions exactly as on dev", () => {
  it("no prompt of the corpus differs", () => {
    const differ = fixture.corpus
      .filter(({ prompt, declared, dev }) => neutralizeUndeclaredMentions(prompt, declared) !== dev)
      .map(({ prompt }) => prompt)
    expect(differ).toEqual([])
  })
})

describe("Kling Image 4.0 reads mentions as on dev, but for the intended cases", () => {
  it("differs from dev only where intended", () => {
    const differ: string[] = []
    for (const { prompt, declared, dev } of fixture.corpus) {
      const now = neutralizeUndeclaredMentions(prompt, declared, KLING_IMAGE_MENTION_RULES)
      if (prompt in INTENDED) {
        expect(now, prompt).toBe(INTENDED[prompt])
        expect(now, `${prompt} was meant to change`).not.toBe(dev)
      } else if (now !== dev) differ.push(`${prompt}: dev ${JSON.stringify(dev)}, now ${JSON.stringify(now)}`)
    }
    expect(differ).toEqual([])
  })

  it("keeps dev's binding around punctuation and joined mentions", () => {
    const declared = ["Kira", "Ann", "image_1"]
    for (const p of ["x@Kira", ".@Kira", "-@Kira", "+@Kira", "_@Kira", "1@Kira"]) {
      expect(neutralizeUndeclaredMentions(p, declared, KLING_IMAGE_MENTION_RULES), p).toContain("@Kira")
    }
    expect(neutralizeUndeclaredMentions("@Kira@Ann", declared, KLING_IMAGE_MENTION_RULES)).toBe("@Kira@Ann")
    // An ASCII name run straight into Chinese loses its @, as on dev.
    expect(neutralizeUndeclaredMentions("@image_1中的女孩", declared, KLING_IMAGE_MENTION_RULES)).toBe("image_1中的女孩")
  })
})
