/**
 * A share card's picture (card-image/): always 1200 × 630 JPEG under 300 KB
 * (decoded here with sharp), whatever it is drawn from; its key changes with
 * what it shows and is derived from the token without containing it; a title
 * is drawn only when the fonts cover every character.
 */
// @test-watches frontend/public/share-card.jpg
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import sharp from "sharp"
import { renderBrandCard, renderCardImage, type LoadedPicture } from "../render.js"
import { CARD_IMAGE_HEIGHT, CARD_IMAGE_MAX_BYTES, CARD_IMAGE_WIDTH, cardImageKey, cardPictureHash, type CardPicture } from "../plan.js"
import { drawableTitle, escapeMarkup, fontsCover, isRightToLeft } from "../text.js"

const TOKEN = "Tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-ab"

function gradient(w: number, h: number): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f80"/><stop offset="1" stop-color="#08f"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`,
    ),
  )
    .png()
    .toBuffer()
}

async function expectCard(jpeg: Buffer): Promise<void> {
  const meta = await sharp(jpeg).metadata()
  expect(meta.format).toBe("jpeg")
  expect(meta.width).toBe(CARD_IMAGE_WIDTH)
  expect(meta.height).toBe(CARD_IMAGE_HEIGHT)
  expect(jpeg.length).toBeLessThanOrEqual(CARD_IMAGE_MAX_BYTES)
}

describe("renderCardImage", () => {
  it("is 1200 × 630 JPEG under 300 KB for every kind of card", async () => {
    const portrait = await gradient(768, 1344)
    const square = await gradient(360, 360)
    const cases: LoadedPicture[] = [
      { kind: "picture", image: portrait },
      { kind: "picture", image: null },
      { kind: "video", frame: await gradient(1280, 720) },
      { kind: "video", frame: null },
      { kind: "sound", art: square, title: "Lady's on the Loose" },
      { kind: "sound", art: null, title: "שיר על הים" },
      { kind: "sound", art: square, title: "夜明けの歌" },
      { kind: "sound", art: null, title: null },
      { kind: "grid", images: [portrait, square] },
      { kind: "grid", images: [portrait, square, portrait] },
      { kind: "grid", images: [portrait, square, portrait, square] },
      { kind: "grid", images: [] },
      // A source that does not decode is drawn as if absent.
      { kind: "picture", image: Buffer.from("not an image") },
    ]
    for (const picture of cases) await expectCard(await renderCardImage(picture))
  }, 60_000)

  it("keeps to the size budget even for a picture of pure noise", async () => {
    const noise = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma: 120 } } }).png().toBuffer()
    await expectCard(await renderCardImage({ kind: "picture", image: noise }))
  }, 60_000)

  it("the brand's card is the static default the card names before a picture is ready", async () => {
    await expectCard(await renderBrandCard())
    // frontend/public/share-card.jpg is a render of it, served by the app.
    const file = readFileSync(new URL("../../../../../../frontend/public/share-card.jpg", import.meta.url))
    await expectCard(file)
  })
})

describe("the key", () => {
  const sound: CardPicture = { kind: "sound", art: "https://cdn.example/a.jpg", title: "One", work: "song" }

  it("changes with what the picture shows, and only then", () => {
    expect(cardImageKey(TOKEN, sound)).toBe(cardImageKey(TOKEN, { ...sound }))
    expect(cardImageKey(TOKEN, { ...sound, title: "Two" })).not.toBe(cardImageKey(TOKEN, sound))
    expect(cardImageKey(TOKEN, { ...sound, art: "https://cdn.example/b.jpg" })).not.toBe(cardImageKey(TOKEN, sound))
    expect(cardPictureHash({ kind: "grid", sources: ["a", "b"] })).not.toBe(cardPictureHash({ kind: "grid", sources: ["b", "a"] }))
  })

  it("is per link, derived from the token without naming it", () => {
    const key = cardImageKey(TOKEN, sound)
    expect(key).toMatch(/^share-cards\/[0-9a-f]{32}\/[0-9a-f]{24}\.jpg$/)
    expect(key).not.toContain(TOKEN)
    expect(cardImageKey(`${TOKEN.slice(0, -1)}c`, sound)).not.toBe(key)
  })
})

describe("text on the picture", () => {
  it("is drawn only when the fonts cover every character", () => {
    for (const ok of ["Lady's on the Loose", "Ça va — très bien", "Привет мир", "Γειά σου", "שיר על הים", "Café “Noir” — 2€"]) expect(fontsCover(ok), ok).toBe(true)
    for (const no of ["夜明けの歌", "노래", "أغنية", "Party 🎉", "Song ♪ 2"]) expect(fontsCover(no), no).toBe(false)
    expect(drawableTitle("Party 🎉")).toBeNull()
    expect(drawableTitle("  a   b ")).toBe("a b")
    expect(Array.from(drawableTitle("x".repeat(200))!).length).toBe(90)
  })

  it("a Hebrew title is laid out right to left; markup in a title is inert", () => {
    expect(isRightToLeft("שיר · Song")).toBe(true)
    expect(isRightToLeft("Song · שיר")).toBe(false)
    expect(isRightToLeft("2 שירים")).toBe(true)
    expect(escapeMarkup(`<span foreground="red">x</span> & 'y'`)).toBe("&lt;span foreground=&quot;red&quot;&gt;x&lt;/span&gt; &amp; &#39;y&#39;")
  })
})
