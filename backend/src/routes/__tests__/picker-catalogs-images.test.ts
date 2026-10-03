/**
 * The picker catalog routes and the MCP tool picture options on THIS
 * installation: absolute imageUrls on its own public address (PUBLIC_URL, the
 * Nodaro Cloud app host when unset), and the rendered look previews (Nodaro
 * CDN) on the Cloud edition only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const env = vi.hoisted(() => ({ edition: "cloud", publicUrl: "" }))

vi.mock("../../lib/config.js", () => ({
  config: {
    get EDITION() {
      return env.edition
    },
    get PUBLIC_URL() {
      return env.publicUrl
    },
  },
  isCloud: () => env.edition === "cloud",
}))

import { pickerCatalogsRoutes } from "../picker-catalogs.js"
import { registerPickerCatalogs } from "../../lib/mcp/tools/picker-catalogs.js"

let app: FastifyInstance
beforeAll(async () => {
  app = Fastify()
  await app.register(pickerCatalogsRoutes)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
beforeEach(() => {
  env.edition = "cloud"
  env.publicUrl = ""
})

interface Option {
  id: string
  imageUrl?: string
}
interface Catalog {
  options?: Option[]
  dimensions?: { field: string; options: Option[] }[]
  sections?: { label: string; fields: string[]; imageUrl?: string }[]
}

async function catalog(nodeType: string): Promise<Catalog> {
  const res = await app.inject({ method: "GET", url: `/v1/picker-catalogs/${nodeType}` })
  expect(res.statusCode).toBe(200)
  return res.json().data as Catalog
}
const allOptions = (c: Catalog): Option[] => [...(c.options ?? []), ...(c.dimensions ?? []).flatMap((d) => d.options)]

describe("picker pictures — Nodaro Cloud", () => {
  it("serves self-hosted pictures on the Cloud app host when PUBLIC_URL is unset", async () => {
    const man = (await catalog("person")).dimensions?.[0]?.options.find((o) => o.id === "man")
    expect(man?.imageUrl).toMatch(/^https:\/\/app\.nodaro\.ai\/picker-art\/character\/person\/man\.[0-9a-f]{8}\.webp$/)
  })

  it("serves the look previews from the Nodaro CDN", async () => {
    const mood = await catalog("mood")
    expect(allOptions(mood).every((o) => o.imageUrl?.startsWith("https://cdn.nodaro.ai/"))).toBe(true)
  })

  it("returns the Person topics with their pictures", async () => {
    const person = await catalog("person")
    expect(person.sections?.[0]).toMatchObject({ label: "Identity", fields: ["type", "age", "ethnicity", "regionalAesthetic"] })
    expect(person.sections?.every((s) => s.imageUrl?.startsWith("https://app.nodaro.ai/picker-art/character/sections/"))).toBe(true)
  })

  it("the directory counts pictured options per picker", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs" })
    const rows = res.json().data as { nodeType: string; imageCount: number; optionCount: number }[]
    const person = rows.find((r) => r.nodeType === "person")!
    expect(person.imageCount).toBeGreaterThan(500)
    expect(person.imageCount).toBeLessThanOrEqual(person.optionCount)
    expect(rows.find((r) => r.nodeType === "mood")!.imageCount).toBeGreaterThan(0)
  })
})

describe("picker pictures — a self-hosted (Community) install", () => {
  beforeEach(() => {
    env.edition = "community"
    env.publicUrl = "http://localhost:3000"
  })

  it("serves every picture on the install's own address, never Nodaro's", async () => {
    for (const nodeType of ["person", "styling", "animal", "music-genre", "voice-character"]) {
      const urls = allOptions(await catalog(nodeType))
        .map((o) => o.imageUrl)
        .filter((u): u is string => u !== undefined)
      expect(urls.length, nodeType).toBeGreaterThan(0)
      expect(urls.filter((u) => !u.startsWith("http://localhost:3000/picker-art/")), nodeType).toEqual([])
    }
  })

  it("serves no look previews (they live on the Nodaro CDN)", async () => {
    const mood = await catalog("mood")
    expect(allOptions(mood).filter((o) => "imageUrl" in o)).toEqual([])
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs" })
    expect((res.json().data as { nodeType: string; imageCount: number }[]).find((r) => r.nodeType === "mood")!.imageCount).toBe(0)
  })

  it("an option without a picture carries no imageUrl", async () => {
    const texture = (await catalog("person")).dimensions?.find((d) => d.field === "skinTexture")?.options.find((o) => o.id === "texture-natural")
    expect(texture).toBeDefined()
    expect(texture && "imageUrl" in texture).toBe(false)
  })
})

describe("get_picker_catalog (MCP) pictures", () => {
  function tool() {
    const tools: { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }[] = []
    const server = { registerTool: (_n: string, _c: unknown, handler: (typeof tools)[number]["handler"]) => tools.push({ handler }) }
    registerPickerCatalogs(server as never, { userId: "u1", scopes: [] } as never)
    return tools[0].handler
  }

  it("returns the same imageUrls and sections as the REST detail call", async () => {
    env.edition = "community"
    env.publicUrl = "https://studio.example.com"
    const res = await tool()({ node_type: "person" })
    const body = JSON.parse(res.content[0].text) as Catalog
    expect(body).toEqual(await catalog("person"))
    expect(body.sections?.[0]?.imageUrl).toMatch(/^https:\/\/studio\.example\.com\/picker-art\/character\/sections\//)
  })

  it("the directory carries imageCount", async () => {
    const res = await tool()({})
    const body = JSON.parse(res.content[0].text) as { pickers: { nodeType: string; imageCount: number }[] }
    expect(body.pickers.find((p) => p.nodeType === "styling")!.imageCount).toBeGreaterThan(200)
  })
})
