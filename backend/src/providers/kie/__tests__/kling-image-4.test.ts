import { describe, expect, it } from "vitest"
import { buildKlingImage4Request, klingImage4SeatNames } from "../kling-image-4.js"
import { kling4Mentions } from "../kling4.js"

const IMG = (n: number) => `https://cdn.example.com/ref-${n}.png`
/** The input keys the provider's schema declares (`additionalProperties: false`). */
const SCHEMA_KEYS = new Set(["prompt", "image_urls", "elements", "mode", "resolution", "aspect_ratio", "count"])

describe("buildKlingImage4Request: an allow-listed body", () => {
  it("a prompt alone sends the prompt and the size, lowercase, and nothing else", () => {
    const r = buildKlingImage4Request({ prompt: "A red apple", resolution: "8K" })
    expect(r.model).toBe("kling-4-0/image")
    expect(r.input).toEqual({ prompt: "A red apple", resolution: "8k" })
    expect(r.inputItems).toBe(0)
    expect(r.imagesAsked).toBe(1)
  })

  it("never sends a key the schema does not declare, whatever is asked", () => {
    const r = buildKlingImage4Request({
      prompt: "x",
      referenceImageUrls: [IMG(1)],
      resolution: "4K",
      aspectRatio: "16:9",
      setCount: 4,
    })
    for (const key of Object.keys(r.input)) expect(SCHEMA_KEYS.has(key), key).toBe(true)
    expect(r.input).toEqual({ prompt: "x", resolution: "4k", aspect_ratio: "16:9", image_urls: [IMG(1)], mode: "series", count: 4 })
  })

  it("a size off its grid is sent as its default, 2K; a ratio it does not take is not sent", () => {
    const r = buildKlingImage4Request({ prompt: "x", resolution: "1K", aspectRatio: "5:4" })
    expect(r.input.resolution).toBe("2k")
    expect(r.input.aspect_ratio).toBeUndefined()
    expect(r.notes.join(" ")).toContain("5:4")
    expect(buildKlingImage4Request({ prompt: "x", aspectRatio: "auto" }).input.aspect_ratio).toBe("auto")
  })

  it("one image is the default mode: no mode and no count are sent", () => {
    for (const setCount of [undefined, 0, 1, "1"]) {
      const r = buildKlingImage4Request({ prompt: "x", setCount })
      expect(r.input.mode).toBeUndefined()
      expect(r.input.count).toBeUndefined()
    }
  })

  it("a set sends series mode with its count, at most 10", () => {
    expect(buildKlingImage4Request({ prompt: "x", setCount: 10 }).input).toMatchObject({ mode: "series", count: 10 })
    expect(buildKlingImage4Request({ prompt: "x", setCount: 25 }).imagesAsked).toBe(10)
  })

  it("sends at most 10 images, the first ones, each once", () => {
    const urls = Array.from({ length: 12 }, (_, i) => IMG(i + 1))
    const r = buildKlingImage4Request({ prompt: "x", referenceImageUrls: [IMG(1), ...urls] })
    expect(r.input.image_urls).toEqual(urls.slice(0, 10))
    expect(r.inputItems).toBe(10)
  })
})

describe("buildKlingImage4Request: names and mentions", () => {
  it("the platform's legacy `Image N` becomes `@image_N` for an image sent", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1 (Maya) stands beside Image 2.", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("@image_1 (Maya) stands beside @image_2.")
  })

  it("the hybrid `reference image A` becomes `@image_1`", () => {
    const r = buildKlingImage4Request({ prompt: "the person from reference image A, the jacket from reference image B", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("the person from @image_1, the jacket from @image_2")
  })

  it("a name for an image that is not sent loses its `@` and stays plain words", () => {
    const r = buildKlingImage4Request({ prompt: "@image_1 and @image_3, Image 4, reference image C", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("@image_1 and image_3, Image 4, reference image C")
    expect(kling4Mentions(r.input.prompt as string)).toEqual(["image_1"])
  })

  it("a prompt with no image declares nothing: every `@` mention loses its `@`", () => {
    const r = buildKlingImage4Request({ prompt: "Poster for @nodaro: write to hello@example.com, see @image_1" })
    expect(kling4Mentions(r.input.prompt as string)).toEqual([])
    expect(r.input.prompt).toBe("Poster for nodaro: write to helloexample.com, see image_1")
  })

  it("an e-mail address or a handle beside real images never leaves an undeclared mention", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1 holds a sign: \"team@studio.io\" and \"@maya_l\"", referenceImageUrls: [IMG(1)] })
    expect(kling4Mentions(r.input.prompt as string)).toEqual(["image_1"])
  })

  it("prose that only looks like a name is left alone", () => {
    const r = buildKlingImage4Request({ prompt: "an image 3 times larger, the 2nd Image", referenceImageUrls: [IMG(1), IMG(2), IMG(3)] })
    expect(r.input.prompt).toBe("an image 3 times larger, the 2nd Image")
  })

  it("a prompt cut to 20,000 characters never ends in a half mention", () => {
    const tail = " @image_1"
    const prompt = "a".repeat(20_000 - 4) + tail
    const r = buildKlingImage4Request({ prompt, referenceImageUrls: [IMG(1)] })
    const sent = r.input.prompt as string
    expect(sent.length).toBeLessThanOrEqual(20_000)
    expect(kling4Mentions(sent).every((m) => m === "image_1")).toBe(true)
    // " @image_1" would be cut after "@im": the half-written mention is left out whole.
    expect(sent.endsWith("a ")).toBe(true)
    expect(sent).not.toContain("@")
  })

  it("klingImage4SeatNames rewrites only the seats it is given", () => {
    expect(klingImage4SeatNames("Image 2 and reference image A", (n) => (n === 2 ? "Hero" : undefined))).toBe("@Hero and reference image A")
  })
})

describe("buildKlingImage4Request: named subjects", () => {
  const KIRA = [IMG(1), IMG(2), IMG(3)]

  it("a subject's seats become its @Name, the other images renumber, and it goes as one element", () => {
    const r = buildKlingImage4Request({
      prompt: "Image 1 (Kira) in the jacket from Image 4, beside Image 2 (Kira, side) and Image 3 (Kira, back)",
      referenceImageUrls: [...KIRA, IMG(4)],
      subjects: [{ name: "Kira", imageUrls: KIRA, description: "a woman with short red hair" }],
    })
    expect(r.input.prompt).toBe("@Kira (Kira) in the jacket from @image_1, beside @Kira (Kira, side) and @Kira (Kira, back)")
    expect(r.input.image_urls).toEqual([IMG(4)])
    expect(r.input.elements).toEqual([{ name: "Kira", image_urls: KIRA, tag: "character", description: "a woman with short red hair" }])
    expect(r.inputItems).toBe(2)
    expect(kling4Mentions(r.input.prompt as string).sort()).toEqual(["Kira", "Kira", "Kira", "image_1"].sort())
  })

  it("the hybrid letters name the subject too", () => {
    const r = buildKlingImage4Request({
      prompt: "the person from reference image B wearing the hat from reference image C",
      referenceImageUrls: [IMG(9), ...KIRA.slice(0, 2), IMG(5)].slice(0, 3),
      subjects: [{ name: "Kira", imageUrls: KIRA.slice(0, 2) }],
    })
    expect(r.input.prompt).toBe("the person from @Kira wearing the hat from @Kira")
    expect(r.input.image_urls).toEqual([IMG(9)])
  })

  it("a subject keeps at most 4 views; a fifth stays a plain image", () => {
    const five = [IMG(1), IMG(2), IMG(3), IMG(4), IMG(5)]
    const r = buildKlingImage4Request({ prompt: "Image 5", referenceImageUrls: five, subjects: [{ name: "Kira", imageUrls: five }] })
    expect((r.input.elements as Array<{ image_urls: string[] }>)[0]!.image_urls).toEqual(five.slice(0, 4))
    expect(r.input.image_urls).toEqual([IMG(5)])
    expect(r.input.prompt).toBe("@image_1")
  })

  it("a subject with fewer than 2 views it sends is none: its image stays a reference", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1", referenceImageUrls: [IMG(1)], subjects: [{ name: "Kira", imageUrls: [IMG(1), IMG(7)] }] })
    expect(r.input.elements).toBeUndefined()
    expect(r.input.image_urls).toEqual([IMG(1)])
    expect(r.input.prompt).toBe("@image_1")
  })

  it("a name is made Kling's: letters, digits and underscore, never reserved, unique; a description at most 100 characters", () => {
    const r = buildKlingImage4Request({
      prompt: "x",
      referenceImageUrls: [IMG(1), IMG(2), IMG(3), IMG(4), IMG(5), IMG(6)],
      subjects: [
        { name: "Maya Lee!", imageUrls: [IMG(1), IMG(2)], description: "d".repeat(150) },
        { name: "image_2", imageUrls: [IMG(3), IMG(4)] },
        { name: "maya lee", imageUrls: [IMG(5), IMG(6)] },
      ],
    })
    const names = (r.input.elements as Array<{ name: string; description?: string }>).map((e) => e.name)
    expect(names).toEqual(["Maya_Lee", "image_2_x", "maya_lee2"])
    expect((r.input.elements as Array<{ description?: string }>)[0]!.description).toHaveLength(100)
  })

  it("images and subjects together stay within 10 items", () => {
    const urls = Array.from({ length: 11 }, (_, i) => IMG(i + 1))
    const r = buildKlingImage4Request({ prompt: "x", referenceImageUrls: urls, subjects: [{ name: "Kira", imageUrls: [IMG(1), IMG(2)] }] })
    expect(r.inputItems).toBe(10)
    expect((r.input.image_urls as string[]).length).toBe(9)
  })

  it("a subject's name typed with @ is declared; an undeclared name loses its @", () => {
    const r = buildKlingImage4Request({ prompt: "@kira meets @Bob", referenceImageUrls: KIRA, subjects: [{ name: "Kira", imageUrls: KIRA }] })
    expect(r.input.prompt).toBe("@Kira meets Bob")
  })
})

describe("buildKlingImage4Request: the prompt's numbers when a base or source is sent first", () => {
  it("a base sent first is not Image 1: the prompt's Image N is the Nth reference", () => {
    const BASE = IMG(0)
    const r = buildKlingImage4Request({
      prompt: "Image 1 holds the cup from Image 2",
      referenceImageUrls: [BASE, IMG(1), IMG(2)],
      promptOrder: [IMG(1), IMG(2)],
    })
    expect(r.input.image_urls).toEqual([BASE, IMG(1), IMG(2)])
    expect(r.input.prompt).toBe("@image_2 holds the cup from @image_3")
  })

  it("without an order the sent order is the prompt's", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("@image_1")
  })
})

describe("buildKlingImage4Request: the person's own words", () => {
  it("text in quotation marks is drawn as written: never rewritten", () => {
    const r = buildKlingImage4Request({
      prompt: 'Image 1 holds a sign that reads "Image 2 of 3", a card \u201creference image A\u201d and \u300cImage 1\u300d',
      referenceImageUrls: [IMG(1), IMG(2), IMG(3)],
      subjects: [{ name: "Hero", imageUrls: [IMG(1), IMG(2)] }],
    })
    expect(r.input.prompt).toBe('@Hero holds a sign that reads "Image 2 of 3", a card \u201creference image A\u201d and \u300cImage 1\u300d')
  })

  it("a ratio or a decimal is not a name", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1:1 crop, Image 2.5x zoom, then Image 1.", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("Image 1:1 crop, Image 2.5x zoom, then @image_1.")
  })

  it("an e-mail address is never a live mention, even one that spells a name", () => {
    const r = buildKlingImage4Request({ prompt: "write to bob@image_1.com about @image_1", referenceImageUrls: [IMG(1)] })
    expect(r.input.prompt).toBe("write to bobimage_1.com about @image_1")
    expect(kling4Mentions(r.input.prompt as string)).toEqual(["image_1"])
  })

  it("a cut never turns @image_10 into @image_1", () => {
    const urls = Array.from({ length: 10 }, (_, i) => IMG(i + 1))
    const prompt = "a".repeat(20_000 - 8) + " @image_10 rest"
    const r = buildKlingImage4Request({ prompt, referenceImageUrls: urls })
    const sent = r.input.prompt as string
    expect(sent.length).toBeLessThanOrEqual(20_000)
    expect(sent).not.toContain("@image_1")
  })

  it("a Chinese subject name followed directly by Chinese text is still that subject", () => {
    const r = buildKlingImage4Request({ prompt: "@小明在跑, @小明跳", referenceImageUrls: [IMG(1), IMG(2)], subjects: [{ name: "小明", imageUrls: [IMG(1), IMG(2)] }] })
    expect(r.input.prompt).toBe("@小明在跑, @小明跳")
    expect((r.input.elements as Array<{ name: string }>)[0]!.name).toBe("小明")
  })

  it("the longest declared name wins, and an English name followed by a letter is no match", () => {
    const r = buildKlingImage4Request({
      prompt: "@Hero2 and @Hero and @Heroic",
      referenceImageUrls: [IMG(1), IMG(2), IMG(3), IMG(4)],
      subjects: [{ name: "Hero", imageUrls: [IMG(1), IMG(2)] }, { name: "Hero2", imageUrls: [IMG(3), IMG(4)] }],
    })
    expect(r.input.prompt).toBe("@Hero2 and @Hero and Heroic")
  })
})

describe("buildKlingImage4Request: a repeated reference", () => {
  it("is sent once, and its own number still names it: Image 2 does not move to the next image", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1, Image 2 and Image 3", referenceImageUrls: [IMG(1), IMG(1), IMG(2)] })
    expect(r.input.image_urls).toEqual([IMG(1), IMG(2)])
    expect(r.inputItems).toBe(2)
    expect(r.input.prompt).toBe("@image_1, @image_1 and @image_2")
  })
})

describe("buildKlingImage4Request: what counts as a quote", () => {
  it("an inch mark opens nothing, white-corner quotes are quotes, and a mention inside quotes is kept only when declared", () => {
    const r = buildKlingImage4Request({
      prompt: 'a 5" frame around Image 1, \u300eImage 2\u300f, "@image_1 and @nobody"',
      referenceImageUrls: [IMG(1), IMG(2)],
    })
    expect(r.input.prompt).toBe('a 5" frame around @image_1, \u300eImage 2\u300f, "@image_1 and nobody"')
  })
})

describe("buildKlingImage4Request: a name run straight into another letter", () => {
  it("Japanese, Korean or an accented letter right after an image name: not renamed, no live mention", () => {
    const r = buildKlingImage4Request({ prompt: "Image 1の女性, Image 2한테, Image 1é and Image 2 here", referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe("Image 1の女性, Image 2한테, Image 1é and @image_2 here")
    expect(kling4Mentions(r.input.prompt as string)).toEqual(["image_2"])
  })
})

describe("a combining mark straight after a name counts as a letter", () => {
  it("Image 1 followed by a combining accent is not renamed; a typed @Kira with one loses its @", () => {
    const acute = "\u0301"
    const r = buildKlingImage4Request({ prompt: `Image 1${acute} and @Kira${acute} and Image 2`, referenceImageUrls: [IMG(1), IMG(2)] })
    expect(r.input.prompt).toBe(`Image 1${acute} and Kira${acute} and @image_2`)
  })
})
