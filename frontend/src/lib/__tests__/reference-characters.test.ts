import { describe, expect, it } from "vitest"
import type { ConnectedReference } from "@nodaro/shared/types"
import { referenceCharactersForRun } from "../reference-characters"

const ref = (url: string, slug?: string): ConnectedReference => ({ id: url, defaultName: slug ?? "x", source: "wired-character", url, ...(slug ? { characterSlug: slug } : {}) }) as ConnectedReference

describe("the editor Run names each reference's character, on Kling Image 4.0 only", () => {
  it("only references the Run sends, each once, in order", () => {
    const refs = [ref("a", "kira"), ref("b", "kira"), ref("p"), ref("c", "max"), ref("a", "kira")]
    expect(referenceCharactersForRun("kling-image-4", refs, ["a", "b", "p"]).map((r) => r.url)).toEqual(["a", "b"])
  })

  it("nothing for another model or no references", () => {
    expect(referenceCharactersForRun("seedream-5-5", [ref("a", "kira")], ["a"])).toEqual([])
    expect(referenceCharactersForRun("kling-image-4", [ref("a", "kira")], undefined)).toEqual([])
  })
})

