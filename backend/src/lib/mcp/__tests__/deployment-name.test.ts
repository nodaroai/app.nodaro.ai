// @test-watches backend/skills/** .claude/skills/nodaro-film-director/SKILL.md backend/src/lib/mcp/**/*.ts
/**
 * TOTALITY: on a deployment with its own name (`brand.productName`), nothing
 * the MCP lane says names the platform (decided 2026-11-16,
 * `lib/mcp/deployment-name.ts`).
 *
 * The lane is built under such a profile — alone, and with the deployment's
 * own terms (a unit with an English word, no self-serve billing) — on both
 * editions, the way a client meets it, and EVERYTHING it says is read:
 * `initialize`, `tools/list` for every grant `tool-list-wire.test.ts` records,
 * the resource lists and every widget page, a call to every tool against
 * routes answering each status in turn (`_name-sweep.ts`), and every document
 * a document tool serves (the plugin's guides as its routes answer them).
 * Every mention of the platform left in all of it is one of the identifiers
 * pinned below, each with its reason — held both ways, so a pin nothing
 * matches any more is removed.
 *
 * Beside it: the rules themselves, the table of requests the exit handles,
 * the server's name, the widgets' pages under a name that would break a
 * script, and the census of every file of the lane that writes the name
 * (held both ways, by count, like the amounts census): a new mention moves a
 * count until someone has said how it reaches a client.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import vm from "node:vm"
import Fastify, { type FastifyInstance } from "fastify"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

vi.hoisted(() => {
  for (const key of [
    "FLOW_PUBLIC_URL", "FLOW_UI_ORIGIN", "LEGACY_UI_HOSTS", "CORS_ORIGIN", "R2_PUBLIC_FALLBACK_DOMAIN",
    "ORGS_ENABLED", "SCENE3D_ADVANCED_ENABLED", "SITE_CAPTURE_ENABLED", "NODARO_PRICE_ANNOTATIONS", "NODARO_SURFACE_PROFILE",
    "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER",
  ]) {
    process.env[key] = ""
  }
  // The deployment's own addresses: what a deployment with its own name serves
  // from. The lane builds its links from them (lib/mcp-lane-addresses.ts).
  process.env.PUBLIC_URL = "https://studio.acme.example"
  process.env.MCP_PUBLIC_URL = "https://mcp.acme.example"
  process.env.R2_PUBLIC_URL = "https://media.acme.example"
})
vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => ({})), rpc: async () => ({ data: null, error: null }) } }
})
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
vi.stubGlobal("fetch", async () => {
  throw new Error("no network in the sweep")
})

const { buildMcpServer } = await import("../server.js")
const { sweepLane } = await import("./_name-sweep.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { listAvailableNodeTypes } = await import("../tools/skill-loaders.js")
const { loadRecipeCatalog } = await import("../tools/recipes.js")
const { BLUEPRINT_IDS } = await import("../../../services/shot-sequence/blueprint-params.js")
const { summarizePickerCatalogs } = await import("@nodaro/prompts/picker-catalogs")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { STATED_REQUESTS, deploymentName, mcpServerInfo, statedName, widgetHtml, widgetJs } = await import("../deployment-name.js")
const { amountWord, amountAbbreviation, amountsNote, unitFields } = await import("../amounts.js")
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"
import { ALL_SCOPES, type Scope } from "../../scopes.js"
setLlmMeteredSchemaReadyForTesting(true)

const here = dirname(fileURLToPath(import.meta.url))
const MCP_DIR = resolve(here, "..")
const RECIPES_DIR = resolve(here, "../../../../skills/recipes")

const NAME = "Acme Studio"
const BRAND = { brand: { productName: NAME } }
/** The deployment's own terms too: a unit whose English word differs from its label, and no self-serve billing. */
const BRAND_AND_TERMS = {
  brand: { productName: NAME },
  billing: { unitLabel: "pts", unitLabels: { en: "points", he: "נקודות" }, unitRate: 0.25, unitDecimals: 2, selfServe: false },
}

function setProfile(profile: unknown) {
  process.env.NODARO_SURFACE_PROFILE = profile === undefined ? "" : JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}
afterEach(() => setProfile(undefined))

/** The grants `tool-list-wire.test.ts` records. */
const GRANTS: ReadonlyArray<readonly Scope[]> = [
  ALL_SCOPES,
  ["workflows:read", "workflows:write", "workflows:execute", "jobs:read", "assets:read", "assets:write", "credits:read", "apps:read"],
  ["jobs:read"],
  [],
]

// ── what may still say it ──────────────────────────────────────────────────

/**
 * Every mention of the platform a client may still read on such a deployment,
 * by class. Each is an identifier a client stores or sends, or an address a
 * page loads from — none is a sentence. Held both ways: a class nothing
 * matches is removed.
 */
const PINNED: ReadonlyArray<{ id: string; token: RegExp; why: string; followedBy?: RegExp }> = [
  { id: "engine id", token: /^nodaro-(?:prism|pulse)$/, why: "a Video Remake engine's public id, which a client sends as `engine` and reads back" },
  { id: "engine name", token: /^(?:Nodaro|NODARO)$/, followedBy: /^\s+(?:Prism|Pulse|PRISM|PULSE)\b/, why: "a Video Remake engine's name (Nodaro Prism, Nodaro Pulse), the same on every deployment" },
  { id: "widget resource URI", token: /^ui:\/\/nodaro\/widget\/(?:v[234]\/)?[a-z-]+$/, why: "the resource a tool's `_meta.ui.resourceUri` names: an id the host stores with the tool list and asks for by name" },
  { id: "house model id", token: /^nodaro-(?:image|video)-upscale$/, why: "a model id a client passes as `model` (its label is the deployment's: \"Acme Studio Image Upscale\")" },
  { id: "maker id", token: /^nodaro$/, why: "`maker.id` of the platform's own models in list_models, and the `_meta.nodaro` key of the Studio tools: ids, beside a maker name that says the deployment's" },
  { id: "package name", token: /^@nodaro\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/, why: "a public package's name, where a document points at the contract or type it publishes (`@nodaro/shared` `Edl`)" },
  { id: "plan document kind", token: /^nodaro-studio-production$/, why: "the kind a Studio plan document declares and the validator checks" },
  { id: "error code", token: /^nodaro_connection_required$/, why: "a refusal's code, which a client matches on" },
  { id: "skill name", token: /^nodaro-film-director$/, why: "the Film Director skill's `name` in its front matter: the id a client files the skill under" },
  { id: "widget script identifier", token: /^(?:window\.)?NodaroMCP(?:\.[A-Za-z]+)?$|^\[NodaroMCP\.[A-Za-z]+\]$|^\[nodaro-widget\]$/, why: "names inside a widget page's script (its bridge object and a console tag): code, never text the page shows" },
  { id: "picker picture", token: /^https:\/\/cdn\.nodaro\.ai\/(?:cdn-cgi\/(?:image|media)\/[\w=,]+\/)?picker-renders\/[\w./%-]+$/, why: "a picker option's picture where the deployment shows the platform's pictures (`catalogs.images` \"default\"): the picture its own editor shows, an image address and never a link a sentence offers (`none` or `own` serves none of them)" },
  { id: "media host", token: /^https:\/\/(?:cdn|assets)\.nodaro\.ai$/, why: "the hosts a widget may load media from (`_meta.ui.csp.resourceDomains`, the page's own allowlist): where media is served, not a link a sentence offers; dropping them would blank media a deployment serves from them" },
]

/** Every token of `text` that mentions the platform, as a whole (a URI, an id, a word), with where it starts. */
function mentions(text: string): Array<{ token: string; at: number }> {
  return [...text.matchAll(/[\w@./:[\]=,%?&#~+-]*nodaro[\w@./:[\]=,%?&#~+-]*/gi)].map((m) => ({ token: m[0], at: m.index! }))
}

/** A token as the identifier it holds: JSON text's escapes and a sentence's punctuation around it dropped. */
function bare(token: string): string {
  return token.replace(/^[\s"'`(\\]+|[\s"'`),.;:\\]+$/g, "").replace(/\\+n?$/, "")
}

interface Found {
  pinned: Set<string>
  leaks: Map<string, string[]>
}

function classify(found: Found, where: string, text: string) {
  for (const { token: raw, at } of mentions(text)) {
    const token = bare(raw)
    const after = text.slice(at + raw.length)
    const pin = PINNED.find((p) => p.token.test(token) && (!p.followedBy || p.followedBy.test(after)))
    if (pin) {
      found.pinned.add(pin.id)
      continue
    }
    const context = text.slice(Math.max(0, at - 60), at + raw.length + 40).replace(/\s+/g, " ")
    const list = found.leaks.get(where) ?? []
    list.push(context)
    found.leaks.set(where, list)
  }
}

/** The plugin's guides as its routes answer them, naming the platform the way the source text does. */
const PLUGIN_MARKDOWN = {
  recast: "## Budget\n\nOn Nodaro Cloud a 60 s movie is about 2970 credits. Open it at recast.nodaro.ai.\n",
  studioSkill: "# Nodaro Studio plan\n\nA Nodaro job id goes in `jobId`.\n",
  studioCatalog: "# Catalog\n\n| Model | Credits |\n|---|---|\n| Nodaro Prism | 83 |\n",
  studioOperating: "# Operating\n\nNodaro renders each take.\n",
} as const

async function pluginRoutes(): Promise<FastifyInstance> {
  const fastify = Fastify()
  fastify.get("/v1/video-analysis/authoring-skill", async () => ({ markdown: PLUGIN_MARKDOWN.recast }))
  fastify.get("/v1/studio/productions/skill", async () => ({
    data: { skill: PLUGIN_MARKDOWN.studioSkill, catalog: PLUGIN_MARKDOWN.studioCatalog, operating: PLUGIN_MARKDOWN.studioOperating, schema: { type: "object", title: "Plan" } },
  }))
  await fastify.ready()
  return fastify
}

function recipeFiles(name: string): string[] {
  const base = resolve(RECIPES_DIR, name)
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]))
  return walk(base).map((p) => relative(base, p)).filter((p) => p !== "RECIPE.md").sort()
}

/** Every document a client can be served, by the call that serves it. */
async function everyDocument(): Promise<Array<{ call: string; text: string }>> {
  const s = await buildMcpServer({ userId: "c0000000-0000-4000-8000-00000000000c", scopes: [...ALL_SCOPES], clientName: "Claude", fastify: await pluginRoutes(), conversation: { client: "claude", key: null } })
  const out: Array<{ call: string; text: string }> = []
  const serve = async (call: string, tool: string, args: Record<string, unknown>) => out.push({ call, text: JSON.stringify(await callTool(s, tool, args)) })
  for (const type of listAvailableNodeTypes()) await serve(`get_node_skill ${type}`, "get_node_skill", { node_type: type })
  await serve("get_recipe", "get_recipe", {})
  for (const { name } of loadRecipeCatalog()) {
    await serve(`get_recipe ${name}`, "get_recipe", { recipe: name })
    for (const file of recipeFiles(name)) await serve(`get_recipe ${name} ${file}`, "get_recipe", { recipe: name, file })
  }
  for (const tool of ["start_workflow_editor", "start_video_director", "start_film_director", "get_recast_authoring_skill", "list_shot_shapes"]) await serve(tool, tool, {})
  for (const part of ["operating", "authoring", "catalog"]) await serve(`get_studio_production_skill ${part}`, "get_studio_production_skill", { part })
  for (const id of BLUEPRINT_IDS) await serve(`get_shot_shape ${id}`, "get_shot_shape", { id })
  await serve("get_picker_catalog", "get_picker_catalog", {})
  for (const { nodeType } of summarizePickerCatalogs()) await serve(`get_picker_catalog ${nodeType}`, "get_picker_catalog", { node_type: nodeType, detail: "full" })
  return out
}

/** Everything the lane says under the current profile, on the current edition. */
async function readEverything(found: Found, label: string) {
  for (const [i, scopes] of GRANTS.entries()) {
    const s = await buildMcpServer({ userId: "c0000000-0000-4000-8000-00000000000c", scopes: [...scopes], clientName: "Claude", fastify: Fastify(), conversation: { client: "claude", key: null } })
    const inner = (s as unknown as { server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<unknown>> } }).server
    classify(found, `${label} tools/list grant ${i}`, JSON.stringify(await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})))
  }
  const surface = await sweepLane({ buildMcpServer: buildMcpServer as never, scopes: ALL_SCOPES })
  classify(found, `${label} initialize`, surface.initialize)
  classify(found, `${label} resources/list`, surface.resourcesList + surface.resourceTemplates)
  for (const [uri, page] of Object.entries(surface.resources)) classify(found, `${label} resources/read ${uri}`, page)
  for (const [call, reply] of Object.entries(surface.calls)) classify(found, `${label} call ${call.replace(/^\d+ /, "")}`, reply)
  for (const { call, text } of await everyDocument()) classify(found, `${label} document ${call}`, text)
}

describe("on a deployment with its own name, nothing the lane says names the platform", () => {
  it("every reply, list, page and document: only the pinned identifiers remain (held both ways)", async () => {
    const found: Found = { pinned: new Set(), leaks: new Map() }
    for (const [profileLabel, profile] of [["name", BRAND], ["name+terms", BRAND_AND_TERMS]] as const) {
      setProfile(profile)
      for (const cloud of [true, false]) {
        credits = cloud
        await readEverything(found, `${profileLabel}/${cloud ? "cloud" : "community"}`)
      }
    }
    credits = true
    const leaks = Object.fromEntries([...found.leaks.entries()].map(([where, cs]) => [where, [...new Set(cs)]]))
    if (process.env.NAME_LEAKS_OUT) writeFileSync(process.env.NAME_LEAKS_OUT, JSON.stringify(leaks, null, 1))
    expect(leaks).toEqual({})
    expect([...found.pinned].sort()).toEqual(PINNED.map((p) => p.id).sort())
  }, 600_000)
})

// ── the rules ───────────────────────────────────────────────────────────────

describe("the rules: what a sentence says instead", () => {
  it("with the platform's name every text is itself", () => {
    setProfile(undefined)
    for (const text of ["Nodaro rejected the request (403): x", "a Nodaro job id", "Nodaro Prism", "visible at recast.nodaro.ai, free"]) expect(statedName(text)).toBe(text)
    setProfile({ brand: { productName: "Nodaro" } })
    expect(deploymentName()).toBeNull()
    expect(statedName("Nodaro had a server error")).toBe("Nodaro had a server error")
    expect(mcpServerInfo()).toEqual({ name: "nodaro-mcp", version: "1.0.0" })
  })

  const CASES: ReadonlyArray<readonly [string, string]> = [
    // the name
    ["Nodaro rejected the request (403 x): no", "Acme Studio rejected the request (403 x): no"],
    ["Error from Nodaro: 404", "Error from Acme Studio: 404"],
    ["via Nodaro's models", "via Acme Studio's models"],
    ["Publish as a Nodaro app", "Publish as an Acme Studio app"],
    ["{ \"brand\": \"NODARO\" }", "{ \"brand\": \"ACME STUDIO\" }"],
    // products, as the deployment's screens say them
    ["Video Remake: replace the people", "Video Remake: replace the people"],
    // Video Remake's engines keep their names on every deployment
    ["\"nodaro-prism\" (Nodaro Prism) or \"nodaro-pulse\" (Nodaro Pulse)", "\"nodaro-prism\" (Nodaro Prism) or \"nodaro-pulse\" (Nodaro Pulse)"],
    ["This Nodaro Prism run is quoted by Nodaro.", "This Nodaro Prism run is quoted by Acme Studio."],
    ["NODARO PULSE, by NODARO", "NODARO PULSE, by ACME STUDIO"],
    ["`nodaro-image-upscale` — Nodaro Image Upscale", "`nodaro-image-upscale` — Acme Studio Image Upscale"],
    ["a Nodaro Studio production", "a Studio production"],
    ["# Nodaro Video Director — Motion Director Skill", "# Video Director — Motion Director Skill"],
    ["Studio productions are a Nodaro Cloud feature", "Studio productions are a Cloud edition feature"],
    ["refunded if it fails. Nodaro Cloud only.", "refunded if it fails. Cloud edition only."],
    ["On Nodaro Cloud the listing also includes", "On the Cloud edition the listing also includes"],
    ["`55` charged on Nodaro Cloud — the price", "`55` charged on the Cloud edition — the price"],
    // ids need no name
    ["Nodaro image job id.", "Image job id."],
    ["Base image as a Nodaro image job id.", "Base image as an image job id."],
    ["(a Nodaro job id whose output is a video)", "(a job id whose output is a video)"],
    ["URLs or Nodaro asset IDs", "URLs or asset IDs"],
    ["each a link or a Nodaro id", "each a link or an id"],
    ["Pass the Nodaro audio_asset_id of a Suno track.", "Pass the audio_asset_id of a Suno track."],
    ["Nodaro audio or video job id, or an uploaded asset id.", "Audio or video job id, or an uploaded asset id."],
    // hosts
    ["a recast project — visible at recast.nodaro.ai, free to import.", "a recast project — free to import."],
    ["it appears on their dashboard at studio.nodaro.ai immediately.", "it appears on their dashboard immediately."],
    ["scenes they can edit afterwards at studio.nodaro.ai. `part`", "scenes they can edit afterwards. `part`"],
    ["(failed). Also returns the recast.nodaro.ai deep link — the full editor for casting.", "(failed)."],
    ["frame counts. nodaro.ai only (self-hosted editions return x).", "frame counts. Cloud edition only (self-hosted editions return x)."],
    ["Self-hosted installs need the nodaro.ai connection.", "Self-hosted installs need the Cloud connection."],
    ["or a connected nodaro.ai\naccount", "or a connected Cloud\naccount"],
    ["\"https://cdn.nodaro.ai/uploads/device.png\"", "\"https://example.com/uploads/device.png\""],
    // identifiers stay
    ["`nodaro-video-upscale`, nodaro_connection_required, @nodaro/shared, ui://nodaro/widget/v4/job-auto, window.NodaroMCP", "`nodaro-video-upscale`, nodaro_connection_required, @nodaro/shared, ui://nodaro/widget/v4/job-auto, window.NodaroMCP"],
    ["the `Nodaro-Signature` header and `X-Nodaro-Workspace`", "the `Nodaro-Signature` header and `X-Nodaro-Workspace`"],
    // an address the deployment's configuration gives is its own
    ["open it in the editor: https://studio.acme.example/editor/w1", "open it in the editor: https://studio.acme.example/editor/w1"],
  ]

  it.each(CASES)("%s", (text, stated) => {
    setProfile(BRAND)
    expect(statedName(text)).toBe(stated)
  })

  it("stating a text twice changes nothing, even for a name that holds the platform's word", () => {
    for (const productName of [NAME, "Nodaro for Teams"]) {
      setProfile({ brand: { productName } })
      for (const [text] of CASES) expect(statedName(statedName(text)), `${productName}: ${text}`).toBe(statedName(text))
    }
    expect(statedName("Nodaro had a server error")).toBe("Nodaro for Teams had a server error")
  })

  it("a name that a replacement pattern would read is the name's own ($&, $1)", () => {
    setProfile({ brand: { productName: "A$&B $1" } })
    expect(statedName("Nodaro rejected it")).toBe("A$&B $1 rejected it")
  })

  it("JSON text gets the name JSON-escaped, so it stays JSON", () => {
    setProfile({ brand: { productName: 'Acme "Q" \\ Studio' } })
    const json = JSON.stringify({ error: { message: "Nodaro rejected the request" } })
    const stated = statedName(json, { json: true })
    expect(JSON.parse(stated)).toEqual({ error: { message: 'Acme "Q" \\ Studio rejected the request' } })
  })
})

describe("the exit: every request the lane answers is handled or reasoned", () => {
  /** Requests that answer no prose, by why. */
  const UNSTATED: Readonly<Record<string, string>> = {
    initialize: "the server's name comes from mcpServerInfo, built with the deployment's name",
    ping: "answers nothing",
    "tasks/list": "tasks' ids and statuses",
    "tasks/cancel": "a task's id and status",
  }

  it("the handlers a server installs are the stated ones and the reasoned ones (held both ways)", async () => {
    setProfile(BRAND)
    const s = await buildMcpServer({ userId: "c0000000-0000-4000-8000-00000000000c", scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify(), conversation: { client: "claude", key: null } })
    const installed = [...(s as unknown as { server: { _requestHandlers: Map<string, unknown> } }).server._requestHandlers.keys()].sort()
    const stated = [...STATED_REQUESTS.values()].map((e) => e.method)
    for (const method of installed) expect(stated.includes(method) || Object.hasOwn(UNSTATED, method), `${method}: say how it leaves on a deployment with its own name`).toBe(true)
    for (const method of Object.keys(UNSTATED)) if (!installed.includes(method)) expect.soft(installed, `${method} is no longer installed: drop it from UNSTATED`).toContain(method)
  })

  it("the server names itself as the deployment", () => {
    setProfile(BRAND)
    expect(mcpServerInfo()).toEqual({ name: "acme-studio-mcp", title: "Acme Studio", version: "1.0.0" })
    setProfile({ brand: { productName: "Café Ü" } })
    expect(mcpServerInfo().name).toBe("cafe-u-mcp")
  })
})

describe("the widgets' pages under a name that would break a script", () => {
  const TRICKY = `Acme's "Studio" </script> \\ <b>`

  function scriptBlocks(html: string): string[] {
    return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => (m[1] ?? "").trim()).filter(Boolean)
  }

  it("every page still compiles, shows the name, and keeps the platform's off the page", async () => {
    setProfile({ brand: { productName: TRICKY } })
    const surface = await sweepLane({ buildMcpServer: buildMcpServer as never, scopes: ALL_SCOPES, statuses: [] })
    const pages = Object.entries(surface.resources)
    expect(pages.length).toBeGreaterThan(10)
    let named = 0
    for (const [uri, reply] of pages) {
      const html = (JSON.parse(reply) as { contents: Array<{ text: string }> }).contents[0]!.text
      // The name's `</script>` is escaped in a script and in the page's text alike, so the page has only its own.
      for (const code of scriptBlocks(html)) expect(() => new vm.Script(code), uri).not.toThrow()
      if (html.includes("Acme")) named++
      expect(html, uri).not.toMatch(/\bNodaro\b(?!MCP)/)
    }
    expect(named).toBeGreaterThan(0)
  })

  it("a page's words as literals and text", () => {
    setProfile({ brand: { productName: TRICKY } })
    expect(widgetJs("Open Nodaro library")).toBe(`'Open Acme\\'s "Studio" \\x3c/script> \\\\ \\x3cb> library'`)
    expect(widgetHtml("Open in Nodaro")).toBe("Open in Acme's &quot;Studio&quot; &lt;/script&gt; \\ &lt;b&gt;")
    setProfile(undefined)
    expect(widgetJs("Open Nodaro library")).toBe("'Open Nodaro library'")
    expect(widgetJs(" more in your Nodaro library", '"')).toBe('" more in your Nodaro library"')
    expect(widgetHtml("Open in Nodaro")).toBe("Open in Nodaro")
  })
})

describe("the unit's English word", () => {
  it("a sentence states amounts with `unitLabels.en`; the fields keep the label and the map", () => {
    setProfile(BRAND_AND_TERMS)
    expect(amountWord()).toBe("points")
    expect(amountAbbreviation()).toBe("points")
    expect(amountsNote()).toContain("is in points, the deployment's own unit")
    expect(unitFields()).toEqual({ unit: "pts", unitLabels: { en: "points", he: "נקודות" }, decimals: 2 })
  })

  it("without an English word, the label", () => {
    setProfile({ billing: { unitLabel: "pts", unitLabels: { he: "נקודות" }, unitRate: 0.25, unitDecimals: 2 } })
    expect(amountWord()).toBe("pts")
    expect(amountAbbreviation()).toBe("pts")
  })
})

// ── the census ──────────────────────────────────────────────────────────────

const FUNNEL = "deployment-name.ts"
/** The platform's name or one of its hosts, as code writes it. */
const NAME_IN_CODE = /\bNodaro\b|\bNODARO\b|nodaro\.ai\b/g

const LIST = "titles and descriptions: stated as tools/list leaves (installDeploymentName)"
const REFUSALS = "refusals (isError): stated as the call leaves (installDeploymentName)"
const LIST_AND_REFUSALS = `${LIST}; ${REFUSALS}`
const DOCUMENT = "a served document's text: stated by statedDocument (served-documents.ts) where the tool serves it"
const WIDGET = "a widget page's words: through widgetJs / widgetHtml, built per session"

/**
 * Every file of the lane whose code writes the platform's name or one of its
 * hosts: how many times, and how each reaches a client. `funnel: true` — a
 * sentence a SUCCESSFUL call states is written here, and the file states it
 * through deployment-name.ts (it imports it). Held both ways by count, like the
 * amounts census: a new mention moves a count until someone has said how it
 * leaves.
 */
const NAME_FILES: Readonly<Record<string, { count: number; how: string; funnel?: true }>> = {
  "amounts.ts": { count: 2, how: `the balance refusals; ${REFUSALS}` },
  "flows/record.ts": { count: 1, how: "the flow's link sentence on a successful call: through statedName", funnel: true },
  "server.ts": { count: 1, how: LIST },
  "tools/_studio-helpers.ts": { count: 1, how: REFUSALS },
  "tools/_verb-helpers.ts": { count: 7, how: `the route refusals (${REFUSALS}); the card sentence of a started job through statedName`, funnel: true },
  "tools/apps.ts": { count: 4, how: LIST_AND_REFUSALS },
  "tools/cast-swap-full-quality.ts": { count: 1, how: LIST_AND_REFUSALS },
  "tools/cast-swap.ts": { count: 7, how: `${LIST_AND_REFUSALS}; the quote's engine and the started sentence through statedName`, funnel: true },
  "tools/characters.ts": { count: 1, how: LIST },
  "tools/components.ts": { count: 2, how: LIST_AND_REFUSALS },
  "tools/film-director.ts": { count: 16, how: `the doctrine's fallback (${DOCUMENT}); ${LIST}` },
  "tools/models.ts": { count: 1, how: `${LIST}; the catalog's family, label, description and maker through statedName / statedFields`, funnel: true },
  "tools/node-presets.ts": { count: 1, how: LIST },
  "tools/palettes-moodboards.ts": { count: 1, how: LIST },
  "tools/recast.ts": { count: 4, how: `${LIST}; the Recast app's origin, which recastAppUrl answers only with the platform's name (null on a deployment with its own)`, funnel: true },
  "tools/recipes.ts": { count: 2, how: LIST },
  "tools/shot-shapes.ts": { count: 10, how: "the worked examples get_shot_shape answers: through statedValue", funnel: true },
  "tools/skill-loaders.ts": { count: 4, how: `the editor's fallback (${DOCUMENT}); ${LIST}` },
  "tools/studio-production.ts": { count: 3, how: LIST },
  "tools/trends.ts": { count: 2, how: `${REFUSALS}; the engine's name through statedName`, funnel: true },
  "tools/ugc.ts": { count: 3, how: LIST_AND_REFUSALS },
  "tools/upload.ts": { count: 2, how: LIST },
  "tools/verbs-audio.ts": { count: 29, how: LIST_AND_REFUSALS },
  "tools/verbs-generate-text.ts": { count: 4, how: LIST },
  "tools/verbs-image.ts": { count: 14, how: LIST },
  "tools/verbs-scene3d.ts": { count: 1, how: LIST },
  "tools/verbs-shot-cuts.ts": { count: 1, how: LIST },
  "tools/verbs-shot-sequence.ts": { count: 2, how: LIST },
  "tools/verbs-split-into-layers.ts": { count: 1, how: LIST },
  "tools/verbs-split-media.ts": { count: 2, how: LIST },
  "tools/verbs-use-case.ts": { count: 4, how: REFUSALS },
  "tools/verbs-video-mask.ts": { count: 4, how: LIST },
  "tools/verbs-video-overlay.ts": { count: 1, how: LIST },
  "tools/verbs-video.ts": { count: 23, how: LIST },
  "tools/video-director-tools.ts": { count: 1, how: LIST },
  "tools/video-director.ts": { count: 18, how: `the doctrine's header and fallback: ${DOCUMENT}` },
  "tools/workflows.ts": { count: 2, how: REFUSALS },
  "widgets/csp-origins.ts": { count: 2, how: "the media hosts a widget may load from (pinned above: not a sentence)" },
  "widgets/job-auto.ts": { count: 6, how: WIDGET },
  "widgets/single-job.ts": { count: 5, how: WIDGET },
  "widgets/workflow.ts": { count: 2, how: WIDGET },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path)
  }
  return out
}

describe("every file of the lane that writes the platform's name says how it leaves", () => {
  it("is listed with its exact count (held both ways), and a file that states a success sentence imports the funnel", () => {
    const found: Record<string, number> = {}
    const imports = new Set<string>()
    for (const path of sourceFiles(MCP_DIR)) {
      const file = relative(MCP_DIR, path)
      if (file === FUNNEL) continue
      const raw = readFileSync(path, "utf8")
      const code = raw.split("\n").filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join("\n")
      const n = code.match(NAME_IN_CODE)?.length ?? 0
      if (n > 0) found[file] = n
      if (/from\s+["'](?:\.\.?\/)+deployment-name\.js["']/.test(raw)) imports.add(file)
    }
    if (process.env.PRINT_NAME_CENSUS === "1") console.log(JSON.stringify(found, null, 2))
    expect(found).toEqual(Object.fromEntries(Object.entries(NAME_FILES).map(([f, e]) => [f, e.count])))
    for (const [file, e] of Object.entries(NAME_FILES)) {
      if (e.funnel) expect(imports.has(file), `${file} states a success sentence: it imports deployment-name.js`).toBe(true)
      expect(e.how.length, `${file} needs a reason`).toBeGreaterThan(20)
    }
  })
})
