/**
 * A deployment's own picture that is a path on its site (decided 2026-11-15,
 * lib/site-picture-path.ts), on every reply that hands out a picker picture or
 * a preset picture, beside the two other kinds — the platform's own picture and
 * a deployment picture on the media host — on a deployment that serves the app
 * on TWO hosts of its own (`PUBLIC_URL` and a `CORS_ORIGIN` entry):
 *
 * - the REST replies (`/v1/picker-catalogs`, `/v1/catalogs`, the factory preset
 *   routes) carry the path as registered, so it resolves on whichever host the
 *   page was served from — the reply is the same bytes on both hosts;
 * - the MCP tools (`get_picker_catalog`, `list_node_presets`, `get_node_preset`)
 *   carry it absolute on the lane's pictures base: `PUBLIC_URL` on the dedicated
 *   lane, the declared host the client connected through on the path lane;
 * - the platform's pictures and a media-host picture are exactly what they were.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.PUBLIC_URL = "https://a.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  process.env.CORS_ORIGIN = "https://b.example.com"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  process.env.R2_PUBLIC_URL = "https://media.example.com"
  process.env.R2_PUBLIC_FALLBACK_DOMAIN = ""
})

vi.mock("../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  return { supabase: { from: () => chain, auth: { getUser: vi.fn() } } }
})
vi.mock("../../lib/presets/preview-url.js", () => ({ PREVIEW_URL_MAX_LENGTH: 2048, previewUrlProblem: async () => null, previewStorageKey: () => null }))
vi.mock("../../lib/presets/preview-copy.js", () => ({ storePresetPreviews: async () => new Map(), releasePresetPreviews: async () => {} }))

import Fastify, { type FastifyInstance } from "fastify"
import { FACTORY_PRESET_PREVIEW_FILES } from "@nodaro/prompts/presets"
import { pickerCatalogsRoutes } from "../picker-catalogs.js"
import { catalogsRoutes } from "../catalogs.js"
import { nodePresetRoutes } from "../node-presets.js"
import { registerPickerCatalogs } from "../../lib/mcp/tools/picker-catalogs.js"
import { registerPresets } from "../../lib/mcp/tools/node-presets.js"
import { buildServer, callTool } from "../../lib/mcp/tools/__tests__/_helpers.js"
import { newSession } from "../../lib/mcp/session.js"
import type { Scope } from "../../lib/scopes.js"
import { mcpLaneAddresses, type McpLane } from "../../lib/mcp-lane-addresses.js"
import { registerPickerPictures, resetPickerPicturesForTests } from "../../lib/picker-pictures.js"
import { registerPresetPack, resetPresetPacks } from "../../lib/presets/app-presets.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const A = "https://a.example.com"
const B = "https://b.example.com"
const MEDIA = "https://media.example.com/pictures"

const SITE = { url: "/brand/style/cinematic.webp", large: "/brand/style/cinematic.large.webp" }
const MEDIA_PERSON = `${MEDIA}/person/man.webp`

/** The first bundled generate-image preset that has a committed picture: a platform picture. */
const BUNDLED = Object.keys(FACTORY_PRESET_PREVIEW_FILES).find((id) => id.startsWith("generate-image/"))!
const PACK_ON_SITE = { id: "generate-image/harbor-at-dawn", previewUrl: "/brand/presets/harbor-at-dawn.webp" }
const PACK_MEDIA = { id: "generate-image/quiet-street", previewUrl: `${MEDIA}/presets/quiet-street.webp` }

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  await app.register(pickerCatalogsRoutes)
  await app.register(catalogsRoutes)
  await app.register(nodePresetRoutes)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => {
  resetPickerPicturesForTests()
  resetPresetPacks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function deploy(profile: Record<string, unknown>): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function registerOwn(): void {
  registerPickerPictures([
    { catalogId: "style", optionId: "cinematic", pictureUrl: SITE.url, enlargedPictureUrl: SITE.large },
    { catalogId: "person", optionId: "man", pictureUrl: MEDIA_PERSON },
  ])
}

function registerPacks(): void {
  const data = { provider: "gpt-image-2", prompt: "a calm harbor at dawn" }
  registerPresetPack({
    nodeType: "generate-image",
    presets: [
      { id: PACK_ON_SITE.id, name: "Harbor at dawn", group: "Deployment", data, previewUrl: PACK_ON_SITE.previewUrl },
      { id: PACK_MEDIA.id, name: "Quiet street", group: "Deployment", data, previewUrl: PACK_MEDIA.previewUrl },
    ],
  })
}

async function rest(url: string, host: string): Promise<string> {
  const res = await app.inject({ method: "GET", url, headers: { host } })
  expect(res.statusCode, `${host}${url}`).toBe(200)
  return res.body
}

/** An MCP session as the lane states it for a client that connected through `host`. */
function session(lane: McpLane, host: string) {
  return newSession({
    userId: "00000000-0000-4000-8000-000000000001",
    scopes: ["presets:read"] as Scope[],
    clientName: "Claude",
    addresses: mcpLaneAddresses({ headers: { host } }, lane),
  })
}

async function pickerTool(lane: McpLane, host: string, args: Record<string, unknown>): Promise<string> {
  const tools: Array<(a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>> = []
  const server = { registerTool: (_n: string, _c: unknown, handler: (typeof tools)[number]) => tools.push(handler) }
  registerPickerCatalogs(server as never, session(lane, host))
  return (await tools[0]!(args)).content.map((c) => c.text).join("\n")
}

async function presetTool(lane: McpLane, host: string, name: string, args: Record<string, unknown>): Promise<string> {
  const server = buildServer()
  registerPresets({ server, session: session(lane, host), fastify: Fastify() })
  const res = await callTool(server, name, args)
  expect(res.isError, res.content[0]?.text).toBeFalsy()
  return res.content[0]?.text ?? ""
}

type Option = { id: string; imageUrl?: string; imageLargeUrl?: string }
const optionIn = (catalog: { options?: Option[]; dimensions?: { options: Option[] }[] }, id: string): Option | undefined =>
  [...(catalog.options ?? []), ...(catalog.dimensions ?? []).flatMap((d) => d.options)].find((o) => o.id === id)

describe("picker pictures: the three kinds, on REST and on both MCP lanes", () => {
  it("the platform's picture: absolute on PUBLIC_URL over REST, on the lane's pictures base over MCP (unchanged)", async () => {
    deploy({ catalogs: { images: "default" } })
    const platform = /^\/picker-art\/character\/person\/man\.[0-9a-f]{8}\.webp$/
    for (const host of ["a.example.com", "b.example.com"]) {
      const man = optionIn(JSON.parse(await rest("/v1/picker-catalogs/person", host)).data, "man")!
      expect(man.imageUrl!.slice(A.length)).toMatch(platform)
      expect(man.imageUrl!.startsWith(A)).toBe(true)
    }
    const dedicated = optionIn(JSON.parse(await pickerTool("dedicated", "b.example.com", { node_type: "person" })), "man")!
    expect(dedicated.imageUrl!.startsWith(`${A}/picker-art/`)).toBe(true)
    deploy({ catalogs: { images: "default" }, mcp: { byPath: true } })
    const viaB = optionIn(JSON.parse(await pickerTool("path", "b.example.com", { node_type: "person" })), "man")!
    expect(viaB.imageUrl!.startsWith(`${B}/picker-art/`)).toBe(true)
  })

  it("a media-host picture: the address as registered, everywhere", async () => {
    deploy({ catalogs: { images: "own" }, mcp: { byPath: true } })
    registerOwn()
    for (const host of ["a.example.com", "b.example.com"]) {
      expect(optionIn(JSON.parse(await rest("/v1/picker-catalogs/person", host)).data, "man")?.imageUrl).toBe(MEDIA_PERSON)
      expect(optionIn(JSON.parse(await pickerTool("path", host, { node_type: "person" })), "man")?.imageUrl).toBe(MEDIA_PERSON)
    }
    expect(optionIn(JSON.parse(await pickerTool("dedicated", "a.example.com", { node_type: "person" })), "man")?.imageUrl).toBe(MEDIA_PERSON)
  })

  it("a path on the site, over REST: the path as registered, the same reply on both hosts", async () => {
    deploy({ catalogs: { images: "own" } })
    registerOwn()
    for (const url of ["/v1/picker-catalogs/style", "/v1/picker-catalogs/style?detail=full", "/v1/catalogs", "/v1/catalogs?detail=full"]) {
      const onA = await rest(url, "a.example.com")
      expect(await rest(url, "b.example.com"), url).toBe(onA)
      const body = JSON.parse(onA).data
      const style = Array.isArray(body) ? body.find((c: { catalogId: string }) => c.catalogId === "style") : body
      expect(optionIn(style, "cinematic"), url).toMatchObject({ imageUrl: SITE.url, imageLargeUrl: SITE.large })
      expect(onA, url).not.toContain(`${A}/brand/`)
    }
    const directory = JSON.parse(await rest("/v1/picker-catalogs", "b.example.com")).data as { catalogId: string; imageCount: number }[]
    expect(directory.find((r) => r.catalogId === "style")?.imageCount).toBe(1)
  })

  it("a path on the site, over MCP: absolute on PUBLIC_URL on the dedicated lane", async () => {
    deploy({ catalogs: { images: "own" } })
    registerOwn()
    const body = await pickerTool("dedicated", "b.example.com", { node_type: "style" })
    expect(optionIn(JSON.parse(body), "cinematic")?.imageUrl).toBe(`${A}${SITE.url}`)
    expect(body).not.toContain("imageLargeUrl")
  })

  it("a path on the site, over MCP by path: absolute on the declared host the client connected through; any other host gets PUBLIC_URL's", async () => {
    deploy({ catalogs: { images: "own" }, mcp: { byPath: true } })
    registerOwn()
    const expected: Record<string, string> = { "a.example.com": A, "b.example.com": B, "evil.example.org": A }
    for (const [host, origin] of Object.entries(expected)) {
      expect(optionIn(JSON.parse(await pickerTool("path", host, { node_type: "style" })), "cinematic")?.imageUrl, host).toBe(`${origin}${SITE.url}`)
    }
  })
})

type PresetView = { id: string; previewUrl: string | null; previewSrcSet?: string }

describe("preset pictures: the three kinds, on REST and on both MCP lanes", () => {
  it("REST: the bundled picture absolute on PUBLIC_URL, a media-host picture as registered, a path on the site as registered — the same reply on both hosts", async () => {
    deploy({ mcp: { byPath: true } })
    registerPacks()
    const url = "/v1/node-presets/factory?nodeType=generate-image"
    const onA = await rest(url, "a.example.com")
    expect(await rest(url, "b.example.com")).toBe(onA)
    const byId = new Map((JSON.parse(onA).data as PresetView[]).map((p) => [p.id, p]))
    expect(byId.get(BUNDLED)!.previewUrl).toBe(`${A}/preset-previews/${FACTORY_PRESET_PREVIEW_FILES[BUNDLED]}`)
    expect(byId.get(PACK_MEDIA.id)!.previewUrl).toBe(PACK_MEDIA.previewUrl)
    expect(byId.get(PACK_ON_SITE.id)!.previewUrl).toBe(PACK_ON_SITE.previewUrl)
    expect(byId.get(PACK_ON_SITE.id)!.previewSrcSet).toBeUndefined()

    const groups = await rest("/v1/node-presets/factory/groups?nodeType=generate-image", "a.example.com")
    expect(await rest("/v1/node-presets/factory/groups?nodeType=generate-image", "b.example.com")).toBe(groups)
    const deployment = (JSON.parse(groups).data as { group: string; previewUrl: string | null; previewUrls: string[] }[]).find((g) => g.group === "Deployment")!
    expect(deployment.previewUrl).toBe(PACK_ON_SITE.previewUrl)
    expect(deployment.previewUrls).toEqual([PACK_ON_SITE.previewUrl, PACK_MEDIA.previewUrl])
  })

  it("MCP: a path on the site absolute on the lane's pictures base; the other kinds as before", async () => {
    deploy({ mcp: { byPath: true } })
    registerPacks()
    const cases: Array<readonly [McpLane, string, string]> = [
      ["dedicated", "b.example.com", A],
      ["path", "a.example.com", A],
      ["path", "b.example.com", B],
    ]
    for (const [lane, host, origin] of cases) {
      const listed = JSON.parse(await presetTool(lane, host, "list_node_presets", { nodeType: "generate-image", source: "factory" })).factory as PresetView[]
      const byId = new Map(listed.map((p) => [p.id, p]))
      expect(byId.get(PACK_ON_SITE.id)!.previewUrl, `${lane} via ${host}`).toBe(`${origin}${PACK_ON_SITE.previewUrl}`)
      expect(byId.get(PACK_MEDIA.id)!.previewUrl).toBe(PACK_MEDIA.previewUrl)
      expect(byId.get(BUNDLED)!.previewUrl).toBe(`${origin}/preset-previews/${FACTORY_PRESET_PREVIEW_FILES[BUNDLED]}`)
      const one = JSON.parse(await presetTool(lane, host, "get_node_preset", { nodeType: "generate-image", presetId: PACK_ON_SITE.id }))
      expect(one.previewUrl, `get_node_preset ${lane} via ${host}`).toBe(`${origin}${PACK_ON_SITE.previewUrl}`)
    }
  })
})
