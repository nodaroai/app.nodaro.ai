/**
 * What the MCP lane judges where link imports are off (lib/mcp/tool-addresses.ts,
 * decided 2026-11-11): the caller's own media goes through, the switch's strict
 * reading of a link applies as it does at every other door, text is never
 * judged, and with link imports on a call reaches its tool exactly as sent.
 * `tool-addresses-census.test.ts` holds the derived arguments to every tool.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ALL_SCOPES } from "../../scopes.js"

vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { installToolOffer } = await import("../tool-offer.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __availabilityUniverseReadyForTests } = await import("../../availability-override.js")

const MEDIA = "https://media.example.test"
const OWN_UPLOAD = `${MEDIA}/uploads/u1/portrait.png`
const OWN_GENERATED = `${MEDIA}/images/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.png`
const OUTSIDE = "https://media.outside.example/picture.png"
const AN_ID = "0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b"

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")
const LINK_REFUSAL = /403 link_imports_disabled/

let previousMedia: string | undefined
beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  previousMedia = process.env.R2_PUBLIC_URL
  process.env.R2_PUBLIC_URL = MEDIA
})
afterAll(() => {
  if (previousMedia === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = previousMedia
})
afterEach(() => setProfile(null))

async function linksOff() {
  setProfile({ imports: { links: false } })
  return createMcpInvoker(await buildMcpServer({ userId: "u1", scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify() }))
}

describe("own media stays allowed where link imports are off", () => {
  it.each([
    ["an upload", "modify_image", { image_url: OWN_UPLOAD, prompt: "warmer light" }],
    ["a generated file", "generate_image", { prompt: "a lighthouse", reference_image_urls: [OWN_GENERATED] }],
    ["an asset id", "modify_image", { image_asset_id: AN_ID, prompt: "warmer light" }],
    ["a job id", "animate_image", { image_url: OWN_GENERATED, end_frame_asset_id: AN_ID, prompt: "slow push in" }],
    ["an entity id", "train_character", { character_id: AN_ID, selected_image_urls: [OWN_UPLOAD, OWN_GENERATED] }],
    ["a link inside a prompt (a prompt is text)", "generate_image", { prompt: `in the style of ${OUTSIDE}` }],
  ])("%s (%s)", async (_kind, tool, args) => {
    const res = await (await linksOff()).callTool(tool, args)
    expect(textOf(res)).not.toMatch(LINK_REFUSAL)
  })

  it("a link to another site in the same call is refused", async () => {
    const res = await (await linksOff()).callTool("generate_image", { prompt: "a lighthouse", reference_image_urls: [OWN_GENERATED, OUTSIDE] })
    expect(textOf(res)).toMatch(LINK_REFUSAL)
  })
})

describe("the switch's strict reading applies on the MCP lane", () => {
  it.each([
    ["an uppercase host", `https://MEDIA.example.test/images/a.png`],
    ["a bare origin", MEDIA],
    ["a backslash", `${MEDIA}\\images\\a.png`],
    ["a leading space", ` ${OWN_GENERATED}`],
    ["a tab inside the scheme", `ht\ttps://media.example.test/images/a.png`],
    ["a dot segment", `${MEDIA}/images/../images/a.png`],
    ["a space in the path", `${MEDIA}/images/a b.png`],
    ["a content-network transform of our own host", `${MEDIA}/cdn-cgi/image/width=100/${OUTSIDE}`],
    ["plain http", OWN_GENERATED.replace("https:", "http:")],
    ["our own host with no scheme", "media.example.test/images/a.png"],
  ])("%s is refused", async (_hazard, url) => {
    const res = await (await linksOff()).callTool("modify_image", { image_url: url, prompt: "warmer light" })
    expect(textOf(res)).toMatch(LINK_REFUSAL)
  })

  it("the same file, written in its one normal form, is not", async () => {
    const res = await (await linksOff()).callTool("modify_image", { image_url: OWN_GENERATED, prompt: "warmer light" })
    expect(textOf(res)).not.toMatch(LINK_REFUSAL)
  })
})

describe("a workflow graph is read as the workflow import reads it", () => {
  const node = (data: Record<string, unknown>, type = "upload-image") => ({ id: "n1", type, position: { x: 0, y: 0 }, data: { label: "Picture", ...data } })

  it("a node's input media is judged", async () => {
    const mcp = await linksOff()
    expect(textOf(await mcp.callTool("create_workflow", { name: "x", nodes: [node({ imageUrl: OUTSIDE })], edges: [] }))).toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("update_workflow_json", { workflow_id: AN_ID, delta: { upsert_nodes: [node({ referenceImageUrls: [OUTSIDE] })] } }))).toMatch(LINK_REFUSAL)
  })

  it.each([
    ["a leading space", ` ${OUTSIDE}`],
    ["a backslash", "https:\\\\media.outside.example\\picture.png"],
    ["a host with no scheme", "media.outside.example/picture.png"],
    ["our own host, not in its normal form", `${MEDIA}/images/../images/a.png`],
  ])("a node's media field holding a link with %s is judged as strictly as any argument", async (_hazard, url) => {
    const mcp = await linksOff()
    expect(textOf(await mcp.callTool("create_workflow", { name: "x", nodes: [node({ imageUrl: url })], edges: [] }))).toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("save_node_preset", { nodeType: "upload-image", name: "p", data: { referenceImageUrl: url } }))).toMatch(LINK_REFUSAL)
    const bundle = JSON.stringify({ version: 1, nodes: [], edges: [], assets: { characters: [{ id: AN_ID, name: "Kira", sourceImageUrl: url }] } })
    expect(textOf(await mcp.callTool("import_workflow", { workflow_json: bundle }))).toMatch(LINK_REFUSAL)
  })

  it("a site path and the deployment's own file in its normal form are not", async () => {
    const mcp = await linksOff()
    for (const url of ["/preset-previews/portrait.webp", OWN_UPLOAD]) {
      const res = await mcp.callTool("create_workflow", { name: "x", nodes: [node({ imageUrl: url })], edges: [] })
      expect(textOf(res), url).not.toMatch(LINK_REFUSAL)
    }
  })

  it("a result, an endpoint or a preview is not", async () => {
    const mcp = await linksOff()
    for (const data of [{ generatedImageUrl: OUTSIDE }, { webhookUrl: OUTSIDE }, { thumbnailUrl: OUTSIDE }]) {
      const res = await mcp.callTool("create_workflow", { name: "x", nodes: [node(data)], edges: [] })
      expect(textOf(res), JSON.stringify(data)).not.toMatch(LINK_REFUSAL)
    }
  })

  it("an imported bundle's nodes and entities are judged before it is parsed into rows", async () => {
    const mcp = await linksOff()
    const bundle = (extra: Record<string, unknown>) => JSON.stringify({ version: 1, nodes: [node({ imageUrl: OWN_UPLOAD })], edges: [], ...extra })
    expect(textOf(await mcp.callTool("import_workflow", { workflow_json: bundle({}) }))).not.toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("import_workflow", { workflow_json: bundle({ assets: { characters: [{ id: AN_ID, name: "Kira", sourceImageUrl: OUTSIDE }] } }) }))).toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("import_workflow", { workflow_json: "not json" }))).not.toMatch(LINK_REFUSAL)
  })
})

describe("a list or an object a tool reads from text", () => {
  it("a reference list sent as JSON text is judged inside", async () => {
    const mcp = await linksOff()
    expect(textOf(await mcp.callTool("generate_image", { prompt: "a lighthouse", reference_image_urls: JSON.stringify([OWN_GENERATED, OUTSIDE]) }))).toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("generate_image", { prompt: "a lighthouse", reference_image_urls: JSON.stringify([OWN_GENERATED]) }))).not.toMatch(LINK_REFUSAL)
  })

  it("an edit decision list sent as JSON text is judged inside", async () => {
    const mcp = await linksOff()
    const edl = (url: string) => JSON.stringify({ version: 1, sources: [{ id: "cam1", url }], segments: [] })
    expect(textOf(await mcp.callTool("apply_edl", { edl: edl(OUTSIDE) }))).toMatch(LINK_REFUSAL)
    expect(textOf(await mcp.callTool("apply_edl", { edl: edl(OWN_UPLOAD) }))).not.toMatch(LINK_REFUSAL)
  })
})

describe("with link imports on", () => {
  it("a call reaches its tool exactly as it was sent", async () => {
    setProfile(null)
    const server = new McpServer({ name: "t", version: "1" })
    installToolOffer(server, { userId: "u1", offer: undefined })
    const seen = vi.fn(async (args: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }))
    // `ping` is a declared tool; the schema here is only this test's.
    server.registerTool("ping", { inputSchema: { image_url: z.string(), refs: z.array(z.string()) } }, seen)
    const args = { image_url: OUTSIDE, refs: [` ${OUTSIDE}`, "media.outside.example/a.png"] }
    const res = await createMcpInvoker(server).callTool("ping", args)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0]).toEqual(args)
    expect(textOf(res)).toBe(JSON.stringify(args))
  })

  it("and the same call is refused before the tool runs once they are off", async () => {
    setProfile({ imports: { links: false } })
    const server = new McpServer({ name: "t", version: "1" })
    installToolOffer(server, { userId: "u1", offer: undefined })
    const seen = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ran" }] }))
    server.registerTool("ping", { inputSchema: { image_url: z.string() } }, seen)
    const res = await createMcpInvoker(server).callTool("ping", { image_url: OUTSIDE })
    expect(seen).not.toHaveBeenCalled()
    expect(textOf(res)).toMatch(LINK_REFUSAL)
  })
})
