// @test-watches backend/src/__tests__/route-path-parity.test.ts backend/src/lib/mcp/tools/characters.ts docs/mcp/tools.md
/**
 * The surface checker (`npm run check:surfaces`, scripts/check-surfaces.ts).
 *
 * Three kinds of guard:
 *  - the feature map is total: every SDK property, CLI group and route first
 *    segment is accounted for in scripts/lib/check-surfaces/features.ts, so a
 *    new one is a decision, not a silent `route:<x>` row;
 *  - golden extractor cases: each way a surface spells a route that the
 *    extractors must render (a reformatting or a refactor that breaks one
 *    shows up here, not as a quietly emptier report);
 *  - exemptions only shrink: one that matches no gap is reported stale.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { beforeAll, describe, expect, it } from "vitest"
import { extractCli, type CliInventory } from "../../../scripts/lib/check-surfaces/cli.js"
import { parseApiDoc, parseSdkReference } from "../../../scripts/lib/check-surfaces/docs.js"
import { NODE_RUN_ROUTES, NODE_TYPES_WITHOUT_RUN_ROUTE, nodeRunRoute } from "@nodaro/shared/nodes"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import { USE_CASE_NODE_TYPES, usecaseContinuePath } from "@nodaro/render-rules"
import {
  FEATURE_ALIASES,
  MCP_DIRECT_TOOL_ROUTES,
  PLUGIN_ROUTE_PREFIXES,
  isPluginPath,
  samePath,
  underPrefix,
} from "../../../scripts/lib/check-surfaces/features.js"
import { joinMcp, routesOf as mcpRoutesOf, scanToolFiles, scanToolSources, type McpInventory } from "../../../scripts/lib/check-surfaces/mcp.js"
import { ENGINE_ONLY_CATEGORIES, buildModel, strictFails, type ModelInputs } from "../../../scripts/lib/check-surfaces/model.js"
import { joinCapturedRoutes } from "../../../scripts/lib/check-surfaces/runtime-routes.js"
import { renderExpr, type Scope } from "../../../scripts/lib/check-surfaces/render-path.js"
import { makeClassifier, staticRoutes, type RouteEntry } from "../../../scripts/lib/check-surfaces/routes.js"
import { extractSdk, type SdkInventory } from "../../../scripts/lib/check-surfaces/sdk.js"
import { moduleScope } from "../../../scripts/lib/check-surfaces/ts-scope.js"
import { toolsDocEntries } from "../../../scripts/lib/gen-skills/render-mcp-tools.js"
import type { ToolSurface } from "../../../scripts/lib/gen-skills/tool-surface.js"
import { cliInvocations } from "../docs-inventory.js"
import { NODE_REGISTRY } from "../node-registry.js"
import { extractRouteRegistrations } from "../route-inventory.js"
import { SYNC_HTTP_NODES } from "../../services/workflow-engine/node-executor.js"
import { SCAN_TIMEOUT_MS } from "./source-ast.js"
import { parseAnnotations } from "../../../../tools/test-select/annotations.mjs"
import { matchesAny } from "../../../../tools/test-select/glob.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
/** The files this test reads itself (the scripts it drives declare their own `@reads`). */
const OWN_READS = {
  parityTest: "backend/src/__tests__/route-path-parity.test.ts",
  charactersTools: "backend/src/lib/mcp/tools/characters.ts",
  toolsDoc: "docs/mcp/tools.md",
} as const

let sdk: SdkInventory
let cli: CliInventory
let mcp: McpInventory
let routes: RouteEntry[]
let classify: ModelInputs["classify"]

beforeAll(async () => {
  sdk = extractSdk(REPO_ROOT)
  cli = await extractCli(REPO_ROOT, new Set(sdk.methods.keys()))
  // Every tool the source registers, as one edition: no child process here.
  const names = scanToolSources(REPO_ROOT).registrations.map((r) => r.name).filter((n) => !n.includes(":p"))
  const surface: ToolSurface = { edition: "cloud", scopes: [], tools: Object.fromEntries(names.map((n) => [n, { gate: null, input: {} }])) }
  mcp = joinMcp(REPO_ROOT, surface, surface)
  ;({ routes, classify } = await staticRoutes(REPO_ROOT))
}, SCAN_TIMEOUT_MS)

function realInputs(overrides: Partial<ModelInputs> = {}): ModelInputs {
  return {
    edition: "static",
    sha: "test",
    routes,
    classify,
    openapi: null,
    sdk,
    sdkDocs: { methods: new Map(), duplicateSections: [] },
    cli,
    cliDocs: new Map(),
    mcp,
    mcpDocs: new Map(),
    apiDocs: new Map(),
    nodes: NODE_REGISTRY.map((n) => ({ type: n.type, category: n.category })),
    nodeTools: {},
    parameterTypes: new Set(),
    nodeDocs: { pages: new Map(), live: new Set() },
    exemptions: [],
    ...overrides,
  }
}

describe("this file's own reads", () => {
  it("are named by its @test-watches, so a change to one selects it", () => {
    const own = parseAnnotations(readFileSync(fileURLToPath(import.meta.url), "utf8")).watches
    expect(Object.values(OWN_READS).filter((path) => !matchesAny(path, own))).toEqual([])
  })
})

describe("the feature map is total", () => {
  it("maps every SDK property, CLI group and route first segment", () => {
    const report = buildModel(realInputs())
    expect(
      report.unmapped,
      "Add the new SDK property / CLI group to FEATURE_ALIASES, or the route segment to an alias row's routePrefixes or to ROUTE_ONLY_FAMILIES, in backend/scripts/lib/check-surfaces/features.ts",
    ).toEqual({ sdkProps: [], cliGroups: [], routePrefixes: [] })
  })

  it("has no alias row for an SDK property that no longer exists", () => {
    const props = new Set(sdk.props)
    expect(FEATURE_ALIASES.map((a) => a.id).filter((id) => !props.has(id))).toEqual([])
  })

  it("names only CLI groups the CLI has", () => {
    const groups = new Set(cli.groups)
    expect(FEATURE_ALIASES.flatMap((a) => a.cli).filter((g) => !groups.has(g))).toEqual([])
  })

  it("buckets every plugin route the frontend parity test allowlists as plugin-registered", () => {
    const src = readFileSync(join(REPO_ROOT, OWN_READS.parityTest), "utf8")
    const block = src.slice(src.indexOf("KNOWN_FRONTEND_ARTIFACTS: ReadonlySet<string> = new Set<string>(["), src.indexOf("])", src.indexOf("KNOWN_FRONTEND_ARTIFACTS")))
    const paths = [...block.matchAll(/^\s*"(\/v1\/[^"]+)",/gm)].map((m) => m[1]!)
    expect(paths.length).toBeGreaterThan(10)
    expect(paths.filter((p) => !isPluginPath(p))).toEqual([])
  })

  it("routes every NODE_RUN_ROUTES node to a registered POST route", () => {
    // A legacy type the engine still runs over HTTP (ai-writer) has no registry row.
    const types = new Set([...NODE_REGISTRY.map((n) => n.type), ...SYNC_HTTP_NODES])
    expect(Object.keys(NODE_RUN_ROUTES).filter((t) => !types.has(t))).toEqual([])
    const posts = new Set(routes.filter((r) => r.method === "POST").map((r) => r.path))
    expect(Object.values(NODE_RUN_ROUTES).filter((p) => !posts.has(p) && !isPluginPath(p))).toEqual([])
  })

  it("gives every node that runs on its own a registered route, or lists it as route-less", () => {
    const posts = new Set(routes.filter((r) => r.method === "POST").map((r) => r.path))
    const unrouted = NODE_REGISTRY.filter((n) => {
      if (ENGINE_ONLY_CATEGORIES.has(n.category) || PARAMETER_NODE_TYPES.has(n.type)) return false
      const route = nodeRunRoute(n.type)
      return route !== null && !posts.has(route) && !isPluginPath(route)
    }).map((n) => n.type)
    expect(
      unrouted,
      "nodes.run(type) would post to a route that does not exist: add the type's real route to NODE_RUN_ROUTES, or the type to NODE_TYPES_WITHOUT_RUN_ROUTE (packages/shared/src/node-run-routes.ts)",
    ).toEqual([])
  })

  it("lists as route-less only real node types that truly have no /v1/<type> route", () => {
    const types = new Set(NODE_REGISTRY.map((n) => n.type))
    const posts = new Set(routes.filter((r) => r.method === "POST").map((r) => r.path))
    const listed = Object.keys(NODE_TYPES_WITHOUT_RUN_ROUTE)
    expect(listed.filter((t) => !types.has(t))).toEqual([])
    expect(listed.filter((t) => posts.has(`/v1/${t}`))).toEqual([])
  })

  it("matches prefixes by segment, `:p` standing for one", () => {
    expect(underPrefix("/v1/workflows/abc/collaborators/x", "/v1/workflows/:p/collaborators")).toBe(true)
    expect(underPrefix("/v1/upload-json", "/v1/upload")).toBe(false)
    expect(samePath("/v1/jobs/:p", "/v1/jobs/123")).toBe(true)
    expect(samePath("/v1/jobs/:p/status", "/v1/jobs/:p")).toBe(false)
    expect(PLUGIN_ROUTE_PREFIXES.every((p) => p.startsWith("/v1/"))).toBe(true)
  })
})

describe("SDK extraction", () => {
  const routesOf = (key: string) => sdk.methods.get(key)?.routes.map((r) => `${r.method} ${r.path}`)

  it("finds every resource, nested ones included", () => {
    expect(sdk.props).toEqual(expect.arrayContaining(["characters", "workflows.collaborators", "studio", "studio.productions", "client"]))
    expect(sdk.methods.size).toBeGreaterThan(300)
  })

  it("renders a route table picked from at run time (edit.continueUseCase → every use-case type's continue route)", () => {
    expect(routesOf("edit.continueUseCase")?.filter((r) => r.startsWith("POST")).sort()).toEqual(
      USE_CASE_NODE_TYPES.map((t) => `POST ${usecaseContinuePath(t)}`).sort(),
    )
  })

  it("renders module consts and helpers (studio's root and path(id))", () => {
    expect(routesOf("studio.get")).toEqual(["GET /v1/studio/productions/:p"])
    expect(routesOf("studio.capabilities")).toEqual(["GET /v1/studio/productions/capabilities"])
  })

  it("renders a private helper with its arguments bound (this.path(id, \"/ops\"))", () => {
    expect(routesOf("studio.productions.ops")).toEqual(["POST /v1/studio/productions/:p/ops"])
  })

  it("resolves a raw fetch's URL built on baseUrl (copilot.stream)", () => {
    expect(routesOf("copilot.stream")).toEqual(["POST /v1/copilot/threads/:p/messages"])
    expect(routesOf("media.downloadVideoProgress")).toEqual(["GET /v1/download-video/progress/:p"])
  })

  it("follows a delegation to another resource with its literal bound (scene3d → nodes.run)", () => {
    expect(routesOf("scene3d.generate")).toEqual(["POST /v1/3d-scene/generate"])
  })

  it("expands nodes.run per node type, its special cases included", () => {
    expect(sdk.nodeRunRoutes("generate-image")).toEqual(["/v1/generate-image"])
    expect(sdk.nodeRunRoutes("edit-3d-scene")).toEqual(["/v1/3d-scene/edit"])
    expect(sdk.nodeRunRoutes("render-video").sort()).toEqual(["/v1/render-video", "/v1/render-video/plan"])
  })

  it("evaluates the shared route table nodes.run reads, for nested routes and route-less types", () => {
    expect(sdk.nodeRunRoutes("llm-chat")).toEqual(["/v1/llm-chat/generate"])
    expect(sdk.nodeRunRoutes("x-post")).toEqual(["/v1/social/publish"])
    expect(sdk.nodeRunRoutes("suno-generate")).toEqual(["/v1/suno/generate"])
    expect(sdk.nodeRunRoutes("modify-image")).toEqual([])
  })

  it("leaves a method that calls nothing with no route (edit.remapTranscript is local)", () => {
    expect(routesOf("edit.remapTranscript")).toEqual([])
  })

  it("reads the client's own methods (client.me)", () => {
    expect(routesOf("client.me")).toEqual(["GET /v1/me"])
  })
})

describe("CLI extraction", () => {
  const cmd = (path: string) => cli.commands.find((c) => c.path === path)

  it("builds the command tree as index.ts registers it", () => {
    expect(cli.groups).toEqual(expect.arrayContaining(["characters", "locations", "objects", "org", "workspace"]))
    expect(cli.commands.length).toBeGreaterThan(150)
    expect(cli.commands.filter((c) => !c.ref)).toEqual([])
  })

  it("links a command to the SDK methods its action calls", () => {
    expect(cmd("characters list")?.sdk).toEqual(["characters.list"])
    expect(cmd("workflows collaborators add")?.sdk).toEqual(["workflows.collaborators.add"])
  })

  it("sees through a wrapper around .command() (withAccountFlags)", () => {
    expect(cmd("competitors update")?.sdk).toEqual(expect.arrayContaining(["competitors.update"]))
  })

  it("follows a same-file helper the action calls", () => {
    expect(cmd("apps run")?.sdk).toEqual(expect.arrayContaining(["apps.run", "apps.list"]))
  })

  it("leaves local-only commands with no SDK call", () => {
    expect(cmd("auth login")?.sdk).toEqual([])
    expect(cmd("workspace current")?.sdk).toEqual([])
  })
})

describe("MCP extraction", () => {
  it("skips comments: characters.ts names DELETE /v1/characters/:id only in comments", () => {
    const src = readFileSync(join(REPO_ROOT, OWN_READS.charactersTools), "utf8")
    expect(src).toMatch(/DELETE \/v1\/characters\/:id/)
    const calls = [...mcp.tools.values()].flatMap((t) => t.routes.map((r) => `${t.name} ${r.method} ${r.path}`))
    expect(calls.filter((c) => c.endsWith("DELETE /v1/characters/:p"))).toEqual([])
  })

  it("takes the method beside the URL, and POST for dispatchJob", () => {
    expect(mcp.tools.get("generate_image")?.routes).toEqual([{ method: "POST", path: "/v1/generate-image" }])
  })

  it("credits continue_use_case with every use-case type's continue route (the type is the run's, read at run time)", () => {
    const of = (n: string) => mcp.tools.get(n)?.routes.map((r) => `${r.method} ${r.path}`)
    expect(of("tighten_episode")).toEqual(["POST /v1/tighten-episode"])
    expect(of("continue_use_case")?.sort()).toEqual(
      ["GET /v1/jobs/:p", ...USE_CASE_NODE_TYPES.map((t) => `POST ${usecaseContinuePath(t)}`)].sort(),
    )
  })

  it("binds a helper's parameters to each call's arguments", () => {
    const text = [
      "export function registerX({ server, fastify, session }) {",
      "  const post = async (id: string, path: string) =>",
      '    mcpInject(fastify, session, { method: "POST", url: `/v1/x/${encodeURIComponent(id)}/${path}` })',
      '  server.registerTool("x_generate", {}, async (args) => post(args.id, "generate"))',
      '  server.registerTool("x_voice", {}, async (args) => post(args.id, "voice"))',
      "}",
    ].join("\n")
    const { registrations, functions } = scanToolFiles([{ rel: "backend/src/lib/mcp/tools/x.ts", text }])
    const byName = Object.fromEntries(registrations.map((r) => [r.name, mcpRoutesOf(r, functions).map((x) => `${x.method} ${x.path}`)]))
    expect(byName).toEqual({ x_generate: ["POST /v1/x/:p/generate"], x_voice: ["POST /v1/x/:p/voice"] })
  })

  it("renders the studio run tools' sub-routes through their shared post helper", () => {
    const of = (n: string) => mcp.tools.get(n)?.routes.map((r) => `${r.method} ${r.path}`)
    expect(of("generate_studio_still")).toEqual(["POST /v1/studio/productions/:p/generate"])
    expect(of("voice_studio_shot")).toEqual(["POST /v1/studio/productions/:p/voice"])
    expect(of("describe_studio_production")).toEqual(["POST /v1/studio/productions/:p/describe"])
  })

  it("credits a tool that reads the database itself with the route it stands in for", () => {
    expect(mcp.tools.get("list_characters")?.serves).toEqual([{ method: "GET", path: "/v1/characters" }])
    const report = buildModel(realInputs())
    const atom = report.features.find((f) => f.id === "characters")!.atoms.find((a) => a.key === "GET /v1/characters/:p")!
    expect(atom.surfaces.mcp).toMatchObject({ status: "present" })
    expect(atom.surfaces.mcp?.ref).toContain("get_character")
  })

  it("lists in MCP_DIRECT_TOOL_ROUTES only tools that exist, each on a registered route", () => {
    // tools.md has an entry for every registered tool (gen:skills:check), the
    // templated `list_objects` / `get_creature` included.
    const documented = new Set(toolsDocEntries(readFileSync(join(REPO_ROOT, OWN_READS.toolsDoc), "utf8")).keys())
    expect(Object.keys(MCP_DIRECT_TOOL_ROUTES).filter((t) => !documented.has(t))).toEqual([])
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`))
    const bad = Object.entries(MCP_DIRECT_TOOL_ROUTES).flatMap(([tool, served]) =>
      served.filter((k) => !keys.has(k) && !isPluginPath(k.slice(k.indexOf(" ") + 1))).map((k) => `${tool} → ${k}`),
    )
    expect(bad, "every entry must be a registered route spelled as the checker normalizes it (`GET /v1/characters/:p`)").toEqual([])
  })

  it("classifies a tool that calls no route as direct-service or content-only", () => {
    const routeless = [...mcp.tools.values()].filter((t) => !t.routes.length)
    expect(routeless.length).toBeGreaterThan(0)
    expect(routeless.every((t) => t.kind !== "route")).toBe(true)
  })
})

describe("path rendering", () => {
  const scopeOf = (src: string): { scope: Scope; expr: (name: string) => ts.Expression } => {
    const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    const scope = moduleScope(sf)
    return {
      scope,
      expr: (name) => {
        const b = scope.lookup(name)
        if (!b || !("expr" in b)) throw new Error(name)
        return b.expr
      },
    }
  }

  it("takes both branches of a conditional it cannot decide, one when it can", () => {
    const { scope, expr } = scopeOf('const kind = "a"\nconst both = flag ? "/v1/x" : "/v1/y"\nconst one = kind === "a" ? "/v1/a" : "/v1/b"')
    expect(renderExpr(expr("both"), scope)).toEqual(["/v1/x", "/v1/y"])
    expect(renderExpr(expr("one"), scope)).toEqual(["/v1/a"])
  })

  it("reads a const route table: the entry its key names, every entry for an unknown key", () => {
    const { scope, expr } = scopeOf(
      'const PATHS = { "a-b": "/v1/a-b/continue", c: "/v1/c/continue" } as const\nconst k = "c"\n' +
        "const any = PATHS[type]\nconst one = PATHS[k]\nconst none = OTHER[type]",
    )
    expect(renderExpr(expr("any"), scope)).toEqual(["/v1/a-b/continue", "/v1/c/continue"])
    expect(renderExpr(expr("one"), scope)).toEqual(["/v1/c/continue"])
    expect(renderExpr(expr("none"), scope)).toEqual([":p"])
  })

  it("turns an unknown interpolation into :p", () => {
    const { scope, expr } = scopeOf("const u = `/v1/jobs/${encodeURIComponent(id)}/status`")
    expect(renderExpr(expr("u"), scope)).toEqual(["/v1/jobs/:p/status"])
  })
})

describe("docs parsing", () => {
  it("reads method headings and table rows per client section, a nested section and the client's own methods", () => {
    const doc = [
      "### `client.me()`",
      "### `client.jobs`",
      "#### `get(id)`",
      "| `cancel(id)` | Cancel |",
      "```ts",
      "collaborators.add(workflowId)",
      "```",
      "### `client.studio`",
      "",
      "`client.studio.productions.*` — the production document.",
      "#### `ops(id, input)`",
      "### `client.jobs`",
    ].join("\n")
    const parsed = parseSdkReference(doc, "ref.md")
    expect([...parsed.methods.keys()].sort()).toEqual(
      ["client.me", "jobs.cancel", "jobs.collaborators.add", "jobs.get", "studio.productions.ops"].sort(),
    )
    expect(parsed.duplicateSections).toEqual(["client.jobs"])
  })

  it("reads a bare `#### \\`name\\`` heading and a fenced list of bare signatures", () => {
    const doc = [
      "### `client.pickerCatalogs`",
      "#### `analyzeText`",
      "### `client.shots`",
      "```ts",
      "create(input)",
      "get(id, opts?)",
      "```",
    ].join("\n")
    expect([...parseSdkReference(doc, "ref.md").methods.keys()].sort()).toEqual(
      ["pickerCatalogs.analyzeText", "shots.create", "shots.get"].sort(),
    )
  })

  it("reads REST mentions in prose and in the reference tables' cells", () => {
    const doc = [
      "## Things",
      "| `GET` | `/v1/x/:id` | desc |",
      "Call GET `/v1/x` to list them, or POST /v1/x.",
      "| `DELETE`|`/v1/x/{id}/y` |",
    ].join("\n")
    expect([...parseApiDoc(doc, "a.md").entries()]).toEqual([
      ["GET /v1/x/:p", { ref: "a.md:2", section: "Things" }],
      ["GET /v1/x", { ref: "a.md:3", section: "Things" }],
      ["POST /v1/x", { ref: "a.md:3", section: "Things" }],
      ["DELETE /v1/x/:p/y", { ref: "a.md:4", section: "Things" }],
    ])
  })

  it("reads `/x/*` as a family of sub-routes (no atom) and `/x*` as the route `/x`", () => {
    const doc = "POST /v1/p/:id/helpers/* and POST /v1/upload* both"
    expect([...parseApiDoc(doc, "a.md").keys()]).toEqual(["POST /v1/upload"])
  })

  it("reads each subcommand of a compact CLI alternation, not a shell pipe's command", () => {
    const words = cliInvocations("nodaro things show <id> [--json] | update <id> [--x a|b] | delete <id>\nnodaro jobs list | jq .")
      .map((i) => `${i.words.join(" ")}:${i.line}`)
    expect(words).toEqual(["things show:1", "things update:1", "things delete:1", "jobs list:2", "jobs jq:2"])
  })

  it("gives each tools.md entry its line", () => {
    const doc = "# Tools\n\n### `get_job`\n\n| Tool | Description |\n|---|---|\n| `list_jobs` | List |\n"
    expect([...toolsDocEntries(doc)]).toEqual([
      ["get_job", 3],
      ["list_jobs", 7],
    ])
  })
})

describe("exemptions", () => {
  // A one-route world: GET /v1/things, with only an SDK method calling it.
  const tiny = (): ModelInputs => ({
    ...realInputs(),
    routes: [{ method: "GET", path: "/v1/things", ref: "backend/src/routes/things.ts:1", bucket: "public", anonymous: false }],
    classify: makeClassifier(new Set()),
    sdk: {
      props: ["things"],
      methods: new Map([["things.list", { key: "things.list", prop: "things", name: "list", ref: "x.ts:1", routes: [{ method: "GET", path: "/v1/things" }] }]]),
      nodeRunRoutes: () => [],
    },
    cli: { commands: [], groups: [] },
    mcp: { tools: new Map(), astOnly: [], notFoundInSource: [] },
    nodes: [],
  })

  it("turns a matching gap into n/a with the reason", () => {
    const report = buildModel({ ...tiny(), exemptions: [{ feature: "things", surface: "mcp", reason: "not offered to agents" }] })
    const atom = report.features.find((f) => f.id === "things")!.atoms[0]!
    expect(atom.surfaces.mcp).toEqual({ status: "na", reason: "exempt: not offered to agents" })
    expect(report.staleExemptions).toEqual([])
    expect(report.features.find((f) => f.id === "things")!.summary.exempt).toBe(1)
  })

  it("reports an exemption that matches no gap as stale", () => {
    const report = buildModel({
      ...tiny(),
      exemptions: [{ feature: "things", surface: "sdk", reason: "the SDK method exists, so this is stale" }],
    })
    expect(report.staleExemptions).toEqual(["things · sdk"])
  })
})

describe("route registrations", () => {
  it("takes the path from the call's first argument, never across an unrelated .get(", () => {
    const src = [
      "const price = pricingMap.get(id)",
      "if (x) foo()",
      'app.patch("/v1/admin/things/:modelId", async () => {})',
    ].join("\n")
    expect(extractRouteRegistrations(src)).toEqual([{ method: "PATCH", path: "/v1/admin/things/:p", line: 3 }])
  })

  it("reads through a generic, quotes and nested generics included", () => {
    const src = [
      'app.patch<{ Params: { id: string }; Body: { mode: "manual" } }>("/v1/things/:id", h)',
      'app.get<{ Params: { "*": string } }>("/v1/assets/*", h)',
      "app.get<{ Querystring: z.infer<typeof Q> }>(",
      '  "/v1/q",',
      "  h)",
    ].join("\n")
    expect(extractRouteRegistrations(src).map((r) => `${r.method} ${r.path}:${r.line}`)).toEqual([
      "PATCH /v1/things/:p:1",
      "GET /v1/assets/*:2",
      "GET /v1/q:3",
    ])
  })
})

describe("joining callers to routes", () => {
  // Two SDK methods on a prefix no route file registers.
  const world = (order: Array<"cap" | "get">): ModelInputs => {
    const m = {
      cap: { key: "x.capabilities", prop: "x", name: "capabilities", ref: "x.ts:1", routes: [{ method: "GET", path: "/v1/zz/capabilities" }] },
      get: { key: "x.get", prop: "x", name: "get", ref: "x.ts:2", routes: [{ method: "GET", path: "/v1/zz/:p" }] },
    }
    return {
      ...realInputs(),
      routes: [],
      classify: makeClassifier(new Set()),
      sdk: { props: ["x"], methods: new Map(order.map((o) => [m[o].key, m[o]])), nodeRunRoutes: () => [] },
      cli: { commands: [], groups: [] },
      mcp: { tools: new Map(), astOnly: [], notFoundInSource: [] },
      nodes: [],
    }
  }

  it.each([[["cap", "get"]], [["get", "cap"]]] as const)("keeps a literal and a :p sibling apart (order %j)", (order) => {
    const report = buildModel(world([...order]))
    const atoms = report.features.flatMap((f) => f.atoms).filter((a) => a.key.includes("/v1/zz/"))
    const sdkOf = Object.fromEntries(atoms.map((a) => [a.key, a.surfaces.sdk?.ref]))
    expect(sdkOf).toEqual({ "GET /v1/zz/capabilities": "x.capabilities x.ts:1", "GET /v1/zz/:p": "x.get x.ts:2" })
  })

  it("joins a caller's literal to a registered route's :p segment, never a caller's :p to a literal", () => {
    const inputs = world(["cap"])
    const report = buildModel({
      ...inputs,
      routes: [{ method: "GET", path: "/v1/zz/:p", ref: "r.ts:1", bucket: "public", anonymous: false }],
    })
    const atoms = report.features.flatMap((f) => f.atoms).filter((a) => a.key.includes("/v1/zz/"))
    expect(atoms.map((a) => [a.key, a.surfaces.sdk?.ref])).toEqual([["GET /v1/zz/:p", "x.capabilities x.ts:1"]])
  })
})

describe("--runtime and --strict", () => {
  it("scores a plugin-prefixed route the booted app registered", () => {
    const classify = makeClassifier(new Set())
    const plugin = PLUGIN_ROUTE_PREFIXES[0]!
    expect(classify("GET", plugin)).toBe("plugin")
    const [r] = joinCapturedRoutes([{ method: "GET", url: plugin }], "cloud", classify, [])
    expect(r?.bucket).toBe("public")
  })

  it("fails --strict only on gaps in the shown surfaces, or on a stale exemption", () => {
    const f = {
      id: "f",
      aliases: {},
      summary: { atoms: 1, complete: 0, gaps: 1, gapsBySurface: { cli: 1 }, exempt: 0 },
      atoms: [{ key: "GET /v1/f", kind: "route" as const, bucket: "public" as const, surfaces: { sdk: { status: "present" as const, ref: "f.get" }, cli: { status: "missing" as const } } }],
    }
    expect(strictFails([f], [])).toBe(true)
    expect(strictFails([f], [], ["sdk"])).toBe(false)
    expect(strictFails([f], ["g · cli"], ["sdk"])).toBe(true)
  })
})
