/**
 * Kling 4.0's long image request (providers/kie/long-image.ts): one body per
 * mode, built whole (the provider refuses another mode's fields), and the
 * prompt's names made the provider's — a product picture renumbered to its
 * place among the pictures sent, every other `@` before a name character
 * written as the full-width `＠`, so no prompt can name something the request
 * does not carry and the text keeps its sign.
 */
import { describe, it, expect } from "vitest"
import { longImageRun } from "@nodaro/render-rules"
import { buildLongImageRequest, longImageResultOf } from "../long-image.js"

const A = "https://r2/a.png"
const B = "https://r2/b.png"
const C = "https://r2/c.png"

const webpage = (over: Record<string, unknown> = {}) => longImageRun({ mode: "webpage", prompt: "a page", ...over })
const product = (over: Record<string, unknown> = {}) => longImageRun({ mode: "ecommerce", prompt: "a page", productImageUrls: [A], ...over })

/** Every `@` the provider would read as a name: before a letter, mark, digit or underscore. */
const namesOnWire = (prompt: string): string[] => [...prompt.matchAll(/@([\p{L}\p{M}\p{N}_]+)/gu)].map((m) => m[1]!)

describe("the body, built whole per mode", () => {
  it("a webpage design sends its skill, prompt, lowercase size and only the pictures it has", () => {
    expect(buildLongImageRequest(webpage()).input).toEqual({ skill: "webpage", prompt: "a page", resolution: "2k" })
    const r = buildLongImageRequest(webpage({ resolution: "1K", styleImageUrl: A, subjectImageUrl: B }))
    expect(r.model).toBe("kling-4-0/long-image")
    expect(r.input).toEqual({ skill: "webpage", prompt: "a page", resolution: "1k", style_image: A, subject_image: B })
    expect(r.inputImages).toBe(2)
  })

  it("a product page sends its skill, prompt, size, pictures and length, never a webpage field", () => {
    const r = buildLongImageRequest(longImageRun({ mode: "ecommerce", prompt: "p", length: "short", resolution: "1k", productImageUrls: [A, B], styleImageUrl: C }))
    expect(r.input).toEqual({ skill: "ecommerce", prompt: "p", resolution: "1k", image_urls: [A, B], length: "short" })
    expect(r.inputImages).toBe(2)
  })

  it("a webpage design never sends a product picture or a length", () => {
    const r = buildLongImageRequest(longImageRun({ mode: "webpage", prompt: "p", productImageUrls: [A], length: "long" }))
    expect(r.input).toEqual({ skill: "webpage", prompt: "p", resolution: "2k" })
  })

  it("sends each picture under the URL it was converted to", () => {
    const r = buildLongImageRequest(product({ productImageUrls: [A, B] }), (u) => `${u}?converted`)
    expect(r.input.image_urls).toEqual([`${A}?converted`, `${B}?converted`])
    const w = buildLongImageRequest(webpage({ styleImageUrl: A }), (u) => `${u}?converted`)
    expect(w.input.style_image).toBe(`${A}?converted`)
  })
})

describe("the product pictures' names", () => {
  it("renumbers each place to its place among the pictures sent (a gap closed)", () => {
    const r = buildLongImageRequest(product({ productImageUrls: [A, null, B], prompt: "@image_1 beside @image_3" }))
    expect(r.input.image_urls).toEqual([A, B])
    expect(r.input.prompt).toBe("@image_1 beside @image_2")
  })

  it("sends a picture given twice once, and both of its names name it", () => {
    const r = buildLongImageRequest(product({ productImageUrls: [A, A, B], prompt: "@image_1 and @image_2, then @image_3" }))
    expect(r.input.image_urls).toEqual([A, B])
    expect(r.input.prompt).toBe("@image_1 and @image_1, then @image_2")
    expect(r.inputImages).toBe(2)
  })

  it("renumbers in one pass: a renamed name is never renamed again", () => {
    const r = buildLongImageRequest(product({ productImageUrls: [null, A, B], prompt: "@image_2 then @image_3" }))
    expect(r.input.prompt).toBe("@image_1 then @image_2")
  })

  it("a name for a place that sends nothing, or one past the pictures, keeps its sign as the full-width ＠", () => {
    const r = buildLongImageRequest(product({ productImageUrls: [A, null, B], prompt: "@image_2 and @image_4 and @image_10" }))
    expect(r.input.prompt).toBe("＠image_2 and ＠image_4 and ＠image_10")
  })

  it("a name followed by a dot is read as the provider reads it: renamed when its place is sent, kept as text when not", () => {
    // Only place 2 is wired: `@image_1` names an empty place, whatever follows it.
    expect(buildLongImageRequest(product({ productImageUrls: [null, A], prompt: "the label on @image_1.png, then @image_2." })).input.prompt)
      .toBe("the label on ＠image_1.png, then @image_1.")
    expect(buildLongImageRequest(product({ productImageUrls: [A, B], prompt: "see @image_2.png" })).input.prompt).toBe("see @image_2.png")
  })

  it("reads a name in any case and writes it as the provider spells it", () => {
    expect(buildLongImageRequest(product({ prompt: "@Image_1, please" })).input.prompt).toBe("@image_1, please")
  })
})

describe("every other @ before a name character becomes the full-width ＠", () => {
  it("an e-mail address and a handle keep their sign", () => {
    const r = buildLongImageRequest(webpage({ prompt: "Contact hello@shop.com or follow @shop" }))
    expect(r.input.prompt).toBe("Contact hello＠shop.com or follow ＠shop")
  })

  it("an e-mail address that spells a declared name is still an address", () => {
    expect(buildLongImageRequest(product({ prompt: "mail bob@image_1.com" })).input.prompt).toBe("mail bob＠image_1.com")
    expect(buildLongImageRequest(webpage({ styleImageUrl: A, prompt: "write to me@style.studio" })).input.prompt).toBe("write to me＠style.studio")
  })

  it("@style and @subject are kept only when the picture is sent", () => {
    expect(buildLongImageRequest(webpage({ prompt: "like @style, with @subject" })).input.prompt).toBe("like ＠style, with ＠subject")
    expect(buildLongImageRequest(webpage({ styleImageUrl: A, prompt: "like @Style, with @subject" })).input.prompt).toBe("like @style, with ＠subject")
    expect(buildLongImageRequest(webpage({ styleImageUrl: A, subjectImageUrl: B, prompt: "like @style, with @subject" })).input.prompt).toBe("like @style, with @subject")
  })

  it("a product page's names are not a webpage's, and the other way round", () => {
    expect(buildLongImageRequest(product({ prompt: "@style @image_1" })).input.prompt).toBe("＠style @image_1")
    expect(buildLongImageRequest(webpage({ styleImageUrl: A, prompt: "@image_1 @style" })).input.prompt).toBe("＠image_1 @style")
  })

  it("an @ before an accented letter, kana, hangul, another digit, or a name run into more letters", () => {
    const r = buildLongImageRequest(webpage({ styleImageUrl: A, prompt: "@élan @カフェ @카페 @٣ @style中 @stylé @style" }))
    expect(r.input.prompt).toBe("＠élan ＠カフェ ＠카페 ＠٣ ＠style中 ＠stylé @style")
  })

  it("an @ with nothing after it, or a space, is left as written", () => {
    expect(buildLongImageRequest(webpage({ prompt: "a @ sign, an @-dash, and @ the end @" })).input.prompt).toBe("a @ sign, an @-dash, and @ the end @")
  })

  it("the shared pass Kling Image 4.0 runs is untouched: it still drops the @", async () => {
    const { neutralizeUndeclaredMentions } = await import("../kling4.js")
    const { KLING_IMAGE_MENTION_RULES } = await import("../kling-image-4.js")
    expect(neutralizeUndeclaredMentions("hello@shop.com @shop", [], KLING_IMAGE_MENTION_RULES)).toBe("helloshop.com shop")
  })

  it("on every prompt, every name left on the wire is one the request declares, and no @ is lost", () => {
    const prompts = [
      "@image_1 @image_2 @image_3 @style @subject @Image_1 @IMAGE_2",
      "hello@shop.com, @shop, @shop_2, @shop.com, x@y, @_x, @1, @一个, @小明在跑, @élan, @naïve, @カフェ, @카페, @image_1の, @image_1中, @image_1.png",
      "\"@image_2\" in quotes, 「@style」, (@subject), [@image_3]",
    ]
    const cases = [
      { run: product({ productImageUrls: [A, null, B] }), declared: ["image_1", "image_2"] },
      { run: product({ productImageUrls: [A, B, C] }), declared: ["image_1", "image_2", "image_3"] },
      { run: product({ productImageUrls: [null, A] }), declared: ["image_1"] },
      { run: webpage({ styleImageUrl: A }), declared: ["style"] },
      { run: webpage({ styleImageUrl: A, subjectImageUrl: B }), declared: ["style", "subject"] },
      { run: webpage(), declared: [] },
    ]
    for (const c of cases) {
      for (const prompt of prompts) {
        const sent = buildLongImageRequest({ ...c.run, prompt }).input.prompt as string
        for (const name of namesOnWire(sent)) expect(c.declared, `${prompt} → ${sent}`).toContain(name)
        // Every sign the prompt had is still there, as @ or ＠.
        expect((sent.match(/[@＠]/g) ?? []).length, sent).toBe((prompt.match(/@/g) ?? []).length)
      }
    }
  })
})

describe("the prompt's length", () => {
  it("a prompt over 20,000 characters is cut, never through a name", () => {
    const long = `${"x".repeat(19995)} @image_1 tail`
    const r = buildLongImageRequest(product({ prompt: long }))
    const prompt = r.input.prompt as string
    expect(prompt.length).toBeLessThanOrEqual(20000)
    expect(prompt.endsWith("@image_")).toBe(false)
    expect(r.notes.join("\n")).toMatch(/cut the prompt/)
  })
})

describe("the result", () => {
  it("the first picture of the task, with what it cost and took", () => {
    expect(longImageResultOf({ taskId: "t1", resultJson: { resultUrls: [" https://kie/page.png ", "https://kie/other.png"] }, kieCredits: 42.5, providerMs: 90000 }))
      .toEqual({ taskId: "t1", url: "https://kie/page.png", kieCredits: 42.5, providerMs: 90000 })
  })

  it("a task with no picture fails, never an empty success", () => {
    expect(() => longImageResultOf({ taskId: "t1", resultJson: { resultUrls: [] } })).toThrow()
    expect(() => longImageResultOf({ taskId: "t1", resultJson: null })).toThrow()
    expect(() => longImageResultOf({ taskId: "t1", resultJson: { resultUrls: ["not a link"] } })).toThrow()
  })
})
