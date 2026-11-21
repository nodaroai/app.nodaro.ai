// @test-watches backend/src/**/*.ts packages/prompts/src/**/*.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/video-remake/previews` — Video Remake's before-and-after previews,
 * for the pages and menus that show what it does:
 * `{ data: [{ id, kind, title, caption, sourceUrl, resultUrl, sweepUrl,
 * stackedUrl, posterUrl, stackedPosterUrl, href }] }`.
 *
 * What must hold:
 *  - the list is the table's entries, in its order, with every wire field;
 *  - `title` / `caption` are in `?locale=`, English where that language has
 *    no copy for the entry, for an unknown language and for none;
 *  - each poster is a frame of its clip, cut at the entry's poster moment;
 *  - nothing is listed where Video Remake is withheld from users or where the
 *    deployment does not show the platform's pictures;
 *  - the same at its /v1/cast-swap alias, cacheable for five minutes;
 *  - over the real table: every entry has English copy, and every copy key
 *    names an entry.
 */
const env = vi.hoisted(() => ({ edition: "cloud" }))

const table = vi.hoisted(() => ({
  previews: [
    {
      id: "restyle-street",
      kind: "restyle",
      sourceUrl: "https://cdn.nodaro.ai/remake-previews/restyle-street-source.mp4",
      resultUrl: "https://cdn.nodaro.ai/remake-previews/restyle-street-result.mp4",
      sweepUrl: "https://cdn.nodaro.ai/remake-previews/restyle-street-sweep.mp4",
      stackedUrl: "https://cdn.nodaro.ai/remake-previews/restyle-street-stacked.mp4",
      posterAtSeconds: 2,
      href: "/video/remake?art-style=anime",
    },
    {
      id: "motion-skate",
      kind: "motion",
      sourceUrl: "https://cdn.nodaro.ai/remake-previews/motion-skate-source.mp4",
      resultUrl: "https://cdn.nodaro.ai/remake-previews/motion-skate-result.mp4",
      sweepUrl: "https://cdn.nodaro.ai/remake-previews/motion-skate-sweep.mp4",
      stackedUrl: "https://cdn.nodaro.ai/remake-previews/motion-skate-stacked.mp4",
      posterAtSeconds: 1.5,
      href: "/video/remake",
    },
  ],
  copy: {
    en: {
      "restyle-street": { title: "Street, restyled", caption: "The same walk, as anime." },
      "motion-skate": { title: "New skater", caption: "Someone else takes the run." },
    },
    he: {
      "restyle-street": { title: "רחוב בסגנון חדש", caption: "אותה הליכה, כאנימה." },
    },
  },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  isCloud: () => env.edition === "cloud",
}))
vi.mock("../../lib/video-remake-previews.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/video-remake-previews.js")>()),
  VIDEO_REMAKE_PREVIEWS: table.previews,
  VIDEO_REMAKE_PREVIEW_COPY: table.copy,
}))

const { videoRemakePreviewsRoutes, PREVIEWS_MAX_AGE_SECONDS } = await import("../video-remake-previews.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
const { __resetAvailabilityOverridesForTests } = await import("../../../lib/availability-override.js")

const URL = "/v1/video-remake/previews"
const WIRE_FIELDS = ["id", "kind", "title", "caption", "sourceUrl", "resultUrl", "sweepUrl", "stackedUrl", "posterUrl", "stackedPosterUrl", "href"]

interface Preview {
  id: string
  kind: string
  title: string
  caption: string
  sourceUrl: string
  resultUrl: string
  sweepUrl: string
  stackedUrl: string
  posterUrl: string
  stackedPosterUrl: string
  href: string
}

const savedProfile = process.env.NODARO_SURFACE_PROFILE
let app: FastifyInstance

function profile(value: unknown): void {
  if (value === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(value)
  __resetSurfaceProfileCacheForTests()
}

async function list(url = URL): Promise<Preview[]> {
  const res = await app.inject({ method: "GET", url })
  expect(res.statusCode, url).toBe(200)
  const body = res.json() as { data: Preview[] }
  expect(Object.keys(body)).toEqual(["data"])
  return body.data
}
const copyOf = (previews: Preview[]) => Object.fromEntries(previews.map((p) => [p.id, { title: p.title, caption: p.caption }]))

beforeEach(async () => {
  env.edition = "cloud"
  profile(undefined)
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  await app.register(videoRemakePreviewsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  profile(savedProfile === undefined ? undefined : JSON.parse(savedProfile))
})

describe("GET /v1/video-remake/previews", () => {
  it("lists the table's previews in its order with every field, cacheable for five minutes", async () => {
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe(`public, max-age=${PREVIEWS_MAX_AGE_SECONDS}`)
    expect(PREVIEWS_MAX_AGE_SECONDS).toBe(300)
    const data = (res.json() as { data: Preview[] }).data
    expect(data.map((p) => p.id)).toEqual(["restyle-street", "motion-skate"])
    for (const preview of data) expect(Object.keys(preview)).toEqual(WIRE_FIELDS)
    const [restyle, motion] = data
    expect(restyle).toMatchObject({
      kind: "restyle",
      title: "Street, restyled",
      caption: "The same walk, as anime.",
      sourceUrl: table.previews[0]!.sourceUrl,
      resultUrl: table.previews[0]!.resultUrl,
      sweepUrl: table.previews[0]!.sweepUrl,
      stackedUrl: table.previews[0]!.stackedUrl,
      href: "/video/remake?art-style=anime",
    })
    expect(motion).toMatchObject({ kind: "motion", href: "/video/remake" })
  })

  it("cuts each poster from its clip at the entry's poster moment", async () => {
    const [restyle, motion] = await list()
    expect(restyle!.posterUrl).toMatch(/^https:\/\/cdn\.nodaro\.ai\/cdn-cgi\/media\/mode=frame,time=2s,width=\d+\/remake-previews\/restyle-street-sweep\.mp4$/)
    expect(restyle!.stackedPosterUrl).toMatch(/^https:\/\/cdn\.nodaro\.ai\/cdn-cgi\/media\/mode=frame,time=2s,width=\d+\/remake-previews\/restyle-street-stacked\.mp4$/)
    expect(motion!.posterUrl).toMatch(/^https:\/\/cdn\.nodaro\.ai\/cdn-cgi\/media\/mode=frame,time=1\.5s,width=\d+\/remake-previews\/motion-skate-sweep\.mp4$/)
    expect(motion!.stackedPosterUrl).toMatch(/^https:\/\/cdn\.nodaro\.ai\/cdn-cgi\/media\/mode=frame,time=1\.5s,width=\d+\/remake-previews\/motion-skate-stacked\.mp4$/)
  })

  it("answers the same at its /v1/cast-swap alias", async () => {
    expect(await list("/v1/cast-swap/previews?locale=he")).toEqual(await list(`${URL}?locale=he`))
  })

  it("takes the copy in the language asked for, English where that language has none for an entry", async () => {
    expect(copyOf(await list(`${URL}?locale=he`))).toEqual({
      "restyle-street": { title: "רחוב בסגנון חדש", caption: "אותה הליכה, כאנימה." },
      "motion-skate": { title: "New skater", caption: "Someone else takes the run." },
    })
    // Only the copy follows the language.
    const strip = (previews: Preview[]) => previews.map(({ title: _t, caption: _c, ...rest }) => rest)
    expect(strip(await list(`${URL}?locale=he`))).toEqual(strip(await list()))
  })

  it("answers English for English, for no language and for one it does not know", async () => {
    const english = await list(`${URL}?locale=en`)
    expect(copyOf(english)).toEqual(table.copy.en)
    expect(await list()).toEqual(english)
    expect(await list(`${URL}?locale=ja`)).toEqual(english)
    expect(await list(`${URL}?locale=xx`)).toEqual(english)
    expect(await list(`${URL}?locale=`)).toEqual(english)
  })

  it("lists nothing where Video Remake is withheld from users", async () => {
    profile({ nodes: { deny: ["cast-swap"] } })
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ data: [] })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${PREVIEWS_MAX_AGE_SECONDS}`)
    profile(undefined)
    expect(await list()).toHaveLength(2)
  })

  it("lists nothing where the deployment does not show the platform's pictures", async () => {
    for (const images of ["none", "own", "reviewed"]) {
      profile({ catalogs: { images } })
      const res = await app.inject({ method: "GET", url: URL })
      expect(res.json(), images).toEqual({ data: [] })
      expect(res.headers["cache-control"]).toBe(`public, max-age=${PREVIEWS_MAX_AGE_SECONDS}`)
    }
    profile({ catalogs: { images: "default" } })
    expect(await list()).toHaveLength(2)
    // The previews live on Nodaro Cloud's CDN, as every rendered preview does.
    env.edition = "business"
    expect(await list()).toEqual([])
  })
})

describe("the previews table", () => {
  it("gives every entry English copy, and names only entries in its copy", async () => {
    const real = await vi.importActual<typeof import("../../lib/video-remake-previews.js")>("../../lib/video-remake-previews.js")
    const ids = real.VIDEO_REMAKE_PREVIEWS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(real.VIDEO_REMAKE_PREVIEW_COPY.en?.[id], id).toBeDefined()
    for (const [locale, copy] of Object.entries(real.VIDEO_REMAKE_PREVIEW_COPY)) {
      for (const id of Object.keys(copy ?? {})) expect(ids, `${locale}: ${id}`).toContain(id)
    }
  })
})
