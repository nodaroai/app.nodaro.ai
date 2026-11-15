/**
 * THE ADDRESSES AN MCP CALL CARRIES, HELD TO THE SCHEMAS (lib/mcp/tool-addresses.ts,
 * decided 2026-11-11).
 *
 *  1. TOTALITY: every tool the server registers — Nodaro Cloud and a
 *     self-hosted Community install with every scope, and a build with
 *     organizations and 3D Render Pro on — has the arguments that can carry an
 *     address derived from its listed schema. A JSON text the tool parses has
 *     a reader; every entry of ADDRESS_JUDGMENTS is an argument its tool's
 *     schema derives (no stale entry).
 *  2. PROOF: where link imports are off, a call that carries a link to another
 *     site in ANY judged argument is refused with the switch's one refusal,
 *     before a single request or read; at an argument judged not to carry
 *     content, it is not.
 *
 * `TOOL_ADDRESSES_TABLE=<file>` writes the derived table (tool, path, form, judgment).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { writeFileSync } from "node:fs"
import { ALL_SCOPES } from "../../scopes.js"

const h = vi.hoisted(() => ({ cloud: true, orgs: false, from: null as unknown as ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>> }))
vi.mock("../../supabase.js", () => {
  h.from = vi.fn<(...args: unknown[]) => unknown>()
  return { supabase: { from: (...args: unknown[]) => h.from(...args) } }
})
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.cloud, hasOrganizations: () => h.orgs }
})
// The session's workspace is read from the organizations service: none here.
vi.mock("../workspace-session.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveSessionWorkspace: async () => undefined,
}))

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { ADDRESS_JUDGMENTS, addressArguments, readsAsAddress } = await import("../tool-addresses.js")
const { config } = await import("../../config.js")
const { setPluginEngines } = await import("../../private-plugins/engine-registry.js")
const { setPluginServices } = await import("../../private-plugins/services-registry.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __availabilityUniverseReadyForTests } = await import("../../availability-override.js")

type AddressArgument = ReturnType<typeof addressArguments>[number]
type Build = "cloud" | "community" | "extras"

const OUTSIDE = "https://media.outside.example/picture.png"
const REFUSED = /\(403 link_imports_disabled\): Importing media from a link to another site is turned off on this deployment\. Upload the file instead\./

/** A 3D engine that implements Pro Render, so pro_3d_render registers. */
const PRO_ENGINE = { capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn(), proRender: vi.fn(), quoteProRender: vi.fn() }
/** An organizations service, so the workspace tools register. */
const ORGS = { me: vi.fn(async () => ({ organizations: [], workspaces: [], lastWorkspaceId: null })), resolveRequestContext: vi.fn(async () => ({})) }

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function useBuild(build: Build): void {
  h.cloud = build !== "community"
  h.orgs = build === "extras"
  const cfg = config as unknown as { SCENE3D_ADVANCED_ENABLED: boolean }
  cfg.SCENE3D_ADVANCED_ENABLED = build === "extras"
  setPluginEngines(build === "extras" ? ({ scene3d: PRO_ENGINE } as never) : {})
  setPluginServices(build === "extras" ? ({ orgs: ORGS } as never) : {})
}

/** A Fastify that counts every request a tool makes to it. */
function countingApp(): { app: FastifyInstance; hits: () => number } {
  const app = Fastify()
  let hits = 0
  app.addHook("onRequest", async () => {
    hits++
  })
  return { app, hits: () => hits }
}

async function invokerFor(build: Build, app: FastifyInstance = Fastify()) {
  useBuild(build)
  return createMcpInvoker(await buildMcpServer({ userId: "u1", scopes: [...ALL_SCOPES], clientName: "Claude", fastify: app }))
}

// ── Every tool's derived address arguments ──────────────────────────────────
// Read before the suites are collected: the proof below is one case per argument.

const derived = new Map<string, { build: Build; args: AddressArgument[] }>()
await __availabilityUniverseReadyForTests()
setProfile(null)
for (const build of ["cloud", "community", "extras"] as const) {
  for (const tool of await (await invokerFor(build)).listTools()) {
    if (!derived.has(tool.name)) derived.set(tool.name, { build, args: addressArguments(tool.inputSchema) })
  }
}
useBuild("cloud")

afterAll(() => {
  setProfile(null)
  useBuild("cloud")
  const out = process.env.TOOL_ADDRESSES_TABLE
  if (!out) return
  const rows = [...derived].flatMap(([tool, { build, args }]) =>
    args.map((a) => {
      const j = ADDRESS_JUDGMENTS[tool]?.[a.path]
      return { tool, build, path: a.path, form: a.form, judgment: j ? ("reader" in j ? `reader ${j.reader}` : "not content") : "judged" }
    }),
  )
  writeFileSync(out, JSON.stringify(rows, null, 2))
})

const judgmentOf = (tool: string, path: string) => (Object.hasOwn(ADDRESS_JUDGMENTS, tool) ? ADDRESS_JUDGMENTS[tool]![path] : undefined)

describe("the address arguments, derived from every tool's schema", () => {
  it("covers every tool the server registers, including the organizations and 3D Render Pro tools", () => {
    expect(derived.size).toBeGreaterThan(260)
    for (const t of ["list_workspaces", "select_workspace", "pro_3d_render", "capture_site", "download_youtube_audio"]) expect(derived.has(t), t).toBe(true)
    const withAddresses = [...derived.values()].filter((d) => d.args.length > 0)
    expect(withAddresses.length, "the derivation is wired to nothing").toBeGreaterThan(110)
  })

  it("finds the address arguments a name, a format, a description or an open shape gives away", () => {
    const has = (tool: string, path: string, form: string) => derived.get(tool)?.args.some((a) => a.path === path && a.form === form)
    expect(has("generate_image", "reference_image_urls[]", "address")).toBe(true)
    expect(has("generate_video", "character_references[].extra_image_urls[]", "address")).toBe(true)
    expect(has("cast_swap", "roles[].images[]", "address")).toBe(true)
    expect(has("build_ugc_clips", "identity_images[]", "text")).toBe(true)
    expect(has("add_competitor", "website", "address")).toBe(true)
    expect(has("add_competitor", "accounts.instagram", "text")).toBe(true)
    expect(has("social_search", "query", "text")).toBe(true)
    expect(has("run_app", "inputs", "subtree")).toBe(true)
    expect(has("apply_edl", "edl", "subtree")).toBe(true)
    expect(has("import_workflow", "workflow_json", "json")).toBe(true)
    expect(has("suno_mashup", "audio_url_1", "address")).toBe(true)
  })

  it("reads a name by its last word, so an id, a fixed vocabulary or a word that merely ends the same is no address", () => {
    const fields = (properties: Record<string, unknown>) => addressArguments({ type: "object", properties }).map((a) => `${a.path}:${a.form}`)
    expect(
      fields({
        audio_profile: { type: "string", description: "who is speaking, in words" },
        candidate_job_id: { type: "string", format: "uuid", description: "a job whose image URL is used" },
        detail: { type: "string", enum: ["summary", "full"], description: "full = every result URL" },
        thumbnailUrl: { type: "string" },
        sourceFiles: { type: "array", items: { type: "string" } },
        bundle_json: { type: "string" },
        notes: { type: "string", description: "Free text; may mention a link." },
        meta: { type: "object", additionalProperties: {} },
        anything: { description: "any value" },
        loose: { type: "object" },
        list: { type: "array" },
      }),
    ).toEqual(["anything:subtree", "bundle_json:json", "list:subtree", "loose:subtree", "meta:subtree", "notes:text", "sourceFiles[]:text", "thumbnailUrl:address"])
  })

  it("every JSON text a tool parses has a reader", () => {
    const unread = [...derived].flatMap(([tool, { args }]) =>
      args.filter((a) => a.form === "json" && !(judgmentOf(tool, a.path) && "reader" in judgmentOf(tool, a.path)!)).map((a) => `${tool}.${a.path}`),
    )
    expect(unread, "a tool takes a JSON text: give it a reader in ADDRESS_JUDGMENTS (lib/mcp/tool-addresses.ts)").toEqual([])
  })

  it("every judgment names an argument its tool's schema derives, and says why", () => {
    const stale: string[] = []
    for (const [tool, paths] of Object.entries(ADDRESS_JUDGMENTS)) {
      for (const [path, judgment] of Object.entries(paths)) {
        if (!derived.get(tool)?.args.some((a) => a.path === path)) stale.push(`${tool}.${path}`)
        const why = "notContent" in judgment ? judgment.notContent : judgment.why
        expect(why.length, `${tool}.${path}: say why`).toBeGreaterThan(30)
      }
    }
    expect(stale, "ADDRESS_JUDGMENTS names an argument no tool's schema derives: remove it").toEqual([])
  })
})

// ── The proof: links off, every judged argument refused ────────────────────

/** Arguments carrying `value` at `path` and nothing else (the funnel reads them before the SDK validates). */
function argsAt(path: string, value: unknown): Record<string, unknown> {
  if (path === "") return { an_extra_argument: value }
  const segments = path.split(".")
  const build = (i: number): unknown => {
    if (i === segments.length) return value
    const segment = segments[i]!
    const items = segment.endsWith("[]")
    const key = items ? segment.slice(0, -2) : segment
    const inner = build(i + 1)
    const v = items ? [inner] : inner
    return key === "*" ? { a_key: v } : { [key]: v }
  }
  return build(0) as Record<string, unknown>
}

/** What an argument holds in the test: a link, an object holding one, or the shape its reader reads. */
function sampleFor(tool: string, arg: AddressArgument, link: string): unknown {
  const judgment = judgmentOf(tool, arg.path)
  if (judgment && "reader" in judgment) {
    const node = { id: "n1", type: "upload-image", data: { label: "Picture", imageUrl: link } }
    if (judgment.reader === "workflow-node") return node
    if (judgment.reader === "media-fields") return { referenceImageUrl: link }
    return JSON.stringify({ version: 1, nodes: [node], edges: [] })
  }
  return arg.form === "subtree" ? { a_field: link } : link
}

/** One case per tool and path: a path may be derived in more than one form. */
function cases(filter: (tool: string, arg: AddressArgument) => boolean): Array<[string, string, Build, AddressArgument]> {
  const out: Array<[string, string, Build, AddressArgument]> = []
  for (const [tool, { build, args }] of derived) {
    const seen = new Set<string>()
    for (const arg of args) {
      if (seen.has(arg.path) || !filter(tool, arg)) continue
      seen.add(arg.path)
      out.push([tool, arg.path || "(the arguments)", build, arg])
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
}

const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")

describe("where link imports are off", () => {
  const invokers = new Map<Build, { mcp: Awaited<ReturnType<typeof invokerFor>>; hits: () => number }>()
  beforeAll(async () => {
    setProfile({ imports: { links: false } })
    for (const build of ["cloud", "community", "extras"] as const) {
      const { app, hits } = countingApp()
      invokers.set(build, { mcp: await invokerFor(build, app), hits })
    }
  }, 180_000)
  afterAll(() => setProfile(null))

  const judged = cases((tool, arg) => !(judgmentOf(tool, arg.path) && "notContent" in judgmentOf(tool, arg.path)!))

  it("judges a link in every derived argument but the ones listed as no content", () => {
    expect(judged.length).toBeGreaterThan(230)
  })

  it.each(judged)("%s %s: a link to another site is refused before anything happens", async (tool, _label, build, arg) => {
    const { mcp, hits } = invokers.get(build)!
    useBuild(build)
    h.from.mockClear()
    const before = hits()
    const res = await mcp.callTool(tool, argsAt(arg.path, sampleFor(tool, arg, OUTSIDE)))
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(REFUSED)
    // The refusal names nothing the caller did not send.
    expect(textOf(res)).not.toContain("outside.example")
    expect(hits() - before, "a request reached a route").toBe(0)
    expect(h.from, "a read reached the database").not.toHaveBeenCalled()
  })

  it.each(cases((tool, arg) => !!judgmentOf(tool, arg.path) && "notContent" in judgmentOf(tool, arg.path)!))(
    "%s %s carries no content: a link there is not judged",
    async (tool, _label, build, arg) => {
      const { mcp } = invokers.get(build)!
      useBuild(build)
      h.from.mockReturnValue(undefined)
      const res = await mcp.callTool(tool, argsAt(arg.path, sampleFor(tool, arg, OUTSIDE)))
      expect(textOf(res)).not.toMatch(/link_imports_disabled/)
    },
  )
})

describe("which values read as an address", () => {
  it.each([
    ["https://a.example/x.png", "text", true],
    ["HTTP://a.example/x.png", "text", true],
    ["  https://a.example/x.png", "text", true],
    ["ht\ttps://a.example/x.png", "text", true],
    ["ftp://a.example/x.png", "text", true],
    ["file:///etc/passwd", "text", true],
    ["a.example/x.png", "text", false],
    ["a.example/x.png", "address", true],
    ["//a.example/x.png", "address", true],
    ["203.0.113.7/x.png", "address", true],
    ["0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b", "address", false],
    ["a calm piano piece", "text", false],
    ["Note: keep it short", "text", false],
    ["node.js tips", "text", false],
    ["data:image/png;base64,AAAA", "address", false],
  ] as const)("%j as %s → %s", (value, form, expected) => {
    expect(readsAsAddress(value, form)).toBe(expected)
  })
})
