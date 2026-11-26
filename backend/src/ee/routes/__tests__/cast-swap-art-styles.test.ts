// @test-watches backend/src/**/*.ts packages/prompts/src/**/*.ts packages/shared/src/i18n/style.*.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { getPickerCatalog } from "@nodaro/prompts/picker-catalogs"
import { RESTYLE_PREVIEWS, restylePreviewStillUrl } from "@nodaro/prompts/picker-art"

/**
 * `GET /v1/video-remake/art-styles` — the art styles Video Remake's picker
 * offers, for a menu that lists them: `{ data: [{ id, label, clipUrl, stillUrl }] }`.
 *
 * What must hold:
 *  - the list is the `style` catalog's options offered for video, not left
 *    out of restyle lists, with an approved restyle preview, in the catalog's
 *    order: today exactly the eleven below;
 *  - a style a catalog pack denies, one offered for images only, one marked
 *    `restyle: false` and one with no approved preview are left out;
 *  - `label` is the style's name in `?locale=`, English for a language that
 *    does not name it, for an unknown language and for none;
 *  - both addresses are absolute https, the still cut from the clip;
 *  - nothing is listed where the platform's previews are not shown, where
 *    Video Remake is withheld, or where the engine takes no art style;
 *  - no credential, cacheable for five minutes.
 */
const env = vi.hoisted(() => ({ edition: "cloud" }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  isCloud: () => env.edition === "cloud",
}))

const { castSwapArtStylesRoutes, ART_STYLES_MAX_AGE_SECONDS } = await import("../cast-swap-art-styles.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
const { setPluginSupports, _resetPluginSupportsForTests } = await import("../../../lib/private-plugins/supports-registry.js")
const { __resetAvailabilityOverridesForTests } = await import("../../../lib/availability-override.js")

const URL = "/v1/video-remake/art-styles"

/** The list on Nodaro's own deployment today, in the catalog's order. */
const OFFERED = [
  "anime",
  "comic-book",
  "oil-painting",
  "pop-art",
  "watercolor",
  "cyberpunk",
  "low-poly",
  "claymation",
  "pixar-3d",
  "felt-puppet",
  "toy-figure-3d",
]

interface ArtStyle {
  id: string
  label: string
  clipUrl: string
  stillUrl: string
}

const savedProfile = process.env.NODARO_SURFACE_PROFILE
let app: FastifyInstance

function profile(value: unknown): void {
  if (value === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(value)
  __resetSurfaceProfileCacheForTests()
}

async function list(url = URL): Promise<ArtStyle[]> {
  const res = await app.inject({ method: "GET", url })
  expect(res.statusCode, url).toBe(200)
  const body = res.json() as { data: ArtStyle[] }
  expect(Object.keys(body)).toEqual(["data"])
  return body.data
}
const ids = (styles: ArtStyle[]) => styles.map((s) => s.id)
const labels = (styles: ArtStyle[]) => Object.fromEntries(styles.map((s) => [s.id, s.label]))

beforeEach(async () => {
  env.edition = "cloud"
  profile(undefined)
  __resetAvailabilityOverridesForTests()
  setPluginSupports({ castSwap: { artStyle: true } } as never)
  app = Fastify({ logger: false })
  await app.register(castSwapArtStylesRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  resetCatalogPacks()
  _resetPluginSupportsForTests()
  profile(savedProfile === undefined ? undefined : JSON.parse(savedProfile))
})

describe("GET /v1/video-remake/art-styles", () => {
  it("lists the styles the picker offers, in the catalog's order, with no credential, cacheable for five minutes", async () => {
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe(`public, max-age=${ART_STYLES_MAX_AGE_SECONDS}`)
    expect(ART_STYLES_MAX_AGE_SECONDS).toBe(300)
    const data = (res.json() as { data: ArtStyle[] }).data
    expect(ids(data)).toEqual(OFFERED)
    for (const style of data) expect(Object.keys(style)).toEqual(["id", "label", "clipUrl", "stillUrl"])
  })

  it("is every style with an approved preview, and each one's clip and still, absolute", async () => {
    const data = await list()
    expect([...ids(data)].sort()).toEqual(Object.keys(RESTYLE_PREVIEWS).sort())
    const options = getPickerCatalog("style")!.options!
    for (const style of data) {
      const preview = RESTYLE_PREVIEWS[style.id]!
      expect(style.clipUrl).toBe(preview.url)
      expect(style.stillUrl).toBe(restylePreviewStillUrl(preview))
      expect(style.clipUrl).toMatch(/^https:\/\/[^/]+\/picker-renders\/[\w-]+\.mp4$/)
      expect(style.stillUrl).toMatch(/^https:\/\/[^/]+\/cdn-cgi\/media\/mode=frame,time=\d+s,width=\d+\/picker-renders\/[\w-]+\.mp4$/)
      expect(style.label).toBe(options.find((o) => o.id === style.id)!.label)
    }
  })

  it("answers the same at its /v1/cast-swap alias", async () => {
    expect(await list("/v1/cast-swap/art-styles?locale=he")).toEqual(await list(`${URL}?locale=he`))
  })

  it("leaves out a style with no approved preview, one for images only, one marked restyle: false and one a pack denies", async () => {
    const base = getPickerCatalog("style")!
    const option = (id: string) => base.options!.find((o) => o.id === id)!
    // Unapproved styles of the catalog are offered for video and for restyles, and still left out.
    const unapproved = base.options!.filter((o) => !RESTYLE_PREVIEWS[o.id] && o.restyle !== false && (o.media === undefined || o.media.includes("video")))
    expect(unapproved.length).toBeGreaterThan(10)
    registerCatalogPack({
      id: "art-styles-test-replace",
      catalogId: "style",
      mode: "replace",
      catalog: {
        ...base,
        options: [
          option("watercolor"),
          option("3d-render"),
          { ...option("anime"), restyle: false },
          { ...option("claymation"), media: ["image"] },
          { ...option("low-poly"), media: ["video"] },
          option("comic-book"),
          { ...option("pop-art"), media: ["image", "video"] },
        ],
      },
    })
    registerCatalogPack({ id: "art-styles-test-deny", catalogId: "style", mode: "deny", denyIds: ["comic-book"] })
    expect(ids(await list())).toEqual(["watercolor", "low-poly", "pop-art"])
  })

  it("names each style in the language asked for", async () => {
    expect(labels(await list(`${URL}?locale=he`))).toEqual({
      anime: "אנימה",
      "comic-book": "קומיקס",
      "oil-painting": "ציור שמן",
      "pop-art": "פופ ארט",
      watercolor: "צבעי מים",
      cyberpunk: "Cyberpunk",
      "low-poly": "Low Poly",
      claymation: "אנימציית חימר",
      "pixar-3d": "סרט אנימציה בתלת־ממד",
      "felt-puppet": "בובות לבד",
      "toy-figure-3d": "בובת צעצוע בתלת־ממד",
    })
    expect(labels(await list(`${URL}?locale=ja`))).toMatchObject({ anime: "アニメ", "oil-painting": "油絵", "felt-puppet": "フェルト人形" })
    expect(labels(await list(`${URL}?locale=ko`))).toMatchObject({ anime: "애니메이션", "oil-painting": "유화", "felt-puppet": "펠트 인형" })
    expect(labels(await list(`${URL}?locale=pt-BR`))).toMatchObject({ "comic-book": "Quadrinhos", "oil-painting": "Pintura a óleo", "felt-puppet": "Boneco de feltro" })
    expect(labels(await list(`${URL}?locale=es`))).toMatchObject({ "comic-book": "Cómic", "oil-painting": "Pintura al óleo", "felt-puppet": "Títere de fieltro" })
    // The language's id in another letter case is the same language.
    expect(await list(`${URL}?locale=pt-br`)).toEqual(await list(`${URL}?locale=pt-BR`))
    // Only the label follows the language.
    const strip = (styles: ArtStyle[]) => styles.map(({ label: _label, ...rest }) => rest)
    expect(strip(await list(`${URL}?locale=he`))).toEqual(strip(await list()))
  })

  it("answers English for English, for no language and for one it does not know", async () => {
    const english = await list(`${URL}?locale=en`)
    expect(labels(english)).toMatchObject({ anime: "Anime", "oil-painting": "Oil Painting", watercolor: "Watercolor" })
    expect(await list()).toEqual(english)
    expect(await list(`${URL}?locale=xx`)).toEqual(english)
    expect(await list(`${URL}?locale=`)).toEqual(english)
    expect(await list(`${URL}?locale=he&locale=ja`)).toEqual(english)
  })

  it("names a style its language's sidecar leaves out in English, and a pack's own style from the pack's sidecar", async () => {
    registerCatalogPack({
      id: "art-styles-test-extend",
      catalogId: "style",
      mode: "extend",
      options: [{ id: "art-styles-test-own", label: "Own Style", promptHint: "own style" }],
      sidecars: { he: { "art-styles-test-own": { label: "סגנון משלנו", description: "" } } },
    })
    // A pack's style has no approved preview, so it is never listed: the resolver is asked directly.
    const { styleLabelsIn } = await import("../../../lib/style-labels.js")
    const hebrew = await styleLabelsIn("he")
    expect(hebrew("art-styles-test-own", "Own Style")).toBe("סגנון משלנו")
    expect(hebrew("art-styles-test-unnamed", "Unnamed")).toBe("Unnamed")
    expect(hebrew("anime", "Anime")).toBe("אנימה")
    expect((await styleLabelsIn("en"))("anime", "Anime")).toBe("Anime")
  })

  it("lists nothing where the deployment does not show the platform's pictures", async () => {
    for (const images of ["none", "own", "reviewed"]) {
      profile({ catalogs: { images } })
      expect(await list(), images).toEqual([])
    }
    profile({ catalogs: { images: "default" } })
    expect(ids(await list())).toEqual(OFFERED)
    // The rendered previews are Nodaro Cloud's, as every look preview is.
    env.edition = "business"
    expect(await list()).toEqual([])
  })

  it("lists nothing where Video Remake is withheld, or where the engine takes no art style", async () => {
    profile({ nodes: { deny: ["cast-swap"] } })
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ data: [] })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${ART_STYLES_MAX_AGE_SECONDS}`)
    profile(undefined)
    expect(ids(await list())).toEqual(OFFERED)
    setPluginSupports({ castSwap: {} } as never)
    expect(await list()).toEqual([])
    _resetPluginSupportsForTests()
    expect(await list()).toEqual([])
  })
})
