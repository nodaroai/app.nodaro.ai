// @test-watches backend/src/**/*.ts
/**
 * PRIVATE OUTPUTS — TOTALITY (`outputs.allowPublic` on the surface profile,
 * read by `surfaceAllowsPublicOutputs()` in lib/surface-profile.ts). A
 * deployment that does not allow public work answers every read that hands
 * one person's work to someone else as if nothing were public. A new such
 * read fails this build until someone writes down what it does there.
 *
 * Three nets:
 *  1. every row of the public-route list (middleware/auth.ts — the routes that
 *     take no sign-in) is classified below, live, from the array itself;
 *  2. every MCP tool parameter `scope` that offers more than "mine" (a public
 *     or shared scope: other people's work) is classified by its file;
 *  3. every file that reads other people's work by its publication flag —
 *     `is_public` jobs, `is_listed` apps, `listed_in` templates, a public
 *     shot, the `studio.shared` workflow opt-in, a shared asset, the shared
 *     library, the Keepers shelf — is classified by its file.
 *
 * Kinds:
 *  - `asks`: the read asks the switch (verified: the file calls the predicate
 *    or `lib/public-job-read.ts`, comments stripped);
 *  - `none`: no user's work is served (a catalog of the deployment's own, a
 *    callback, a token exchange, a proxy of an address the caller holds);
 *  - `published`: work published by a mechanism this switch does not govern —
 *    an administrator's curation, or the presentation share links (out of
 *    scope by decision) — named in `why`;
 *  - `judgment`: a read of someone's work left as it is on purpose, awaiting a
 *    product decision (the options are in the PR that added this guard).
 * A file named under a kind other than `asks` that starts asking moves to
 * `asks`, so the census never claims less than the code does.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { __publicRoutesForTest } from "../../middleware/auth.js"

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const read = (rel: string): string => withoutComments(readFileSync(join(SRC_DIR, rel), "utf8"))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === "__characterization__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) out.push(full)
  }
  return out
}

/** Asking the switch: the predicate itself, or the by-id job filter built on it. */
const ASKS_THE_SWITCH = /\b(?:surfaceAllowsPublicOutputs|readableJobsFilter|jobReadableBy)\s*\(/

type Kind = "asks" | "none" | "published" | "judgment"
interface Read {
  readonly kind: Kind
  readonly why: string
  /** The handler files (relative to backend/src). Required for `asks` and `judgment`. */
  readonly files?: readonly string[]
}

const asks = (why: string, ...files: string[]): Read => ({ kind: "asks", why, files })
const none = (why: string, ...files: string[]): Read => ({ kind: "none", why, files })
const published = (why: string, ...files: string[]): Read => ({ kind: "published", why, files })
const judgment = (why: string, ...files: string[]): Read => ({ kind: "judgment", why, files })

const OAUTH = none("an OAuth / plugin-connect step: a code, a token or app metadata, never anyone's work")
const DISCOVERY = none("OAuth discovery metadata for MCP clients: the deployment's own endpoints")
const CATALOG = none("the deployment's own catalog, the same for every caller: no user's work")
const CALLBACK = none("a provider's callback or webhook into this server: it answers no one's work")
const APP_PAGE = judgment(
  "a published app's own page by its slug (its graph, so the app can run) and the caller's own runs of it; whether private outputs close an app's page, or only its listing, awaits a product decision",
  "routes/app-runner.ts",
)

/** `METHOD path` (`*` for any method; a trailing `*` for a prefix row). */
const keyOf = (row: { method?: string; path: string; prefix?: boolean }): string => `${row.method ?? "*"} ${row.path}${row.prefix ? "*" : ""}`

/** Every public-route row, and what it serves on a deployment that does not allow public work. */
const PUBLIC_ROUTE_READS: Readonly<Record<string, Read>> = {
  "* /health": none("a liveness probe"),
  "* /v1/version": none("the server's version and update availability"),
  "GET /v1/setup/status": none("a self-host install's health booleans"),
  "GET /v1/nodaro-connect/callback": OAUTH,
  "GET /v1/gallery": asks("the public gallery: every view but the owner's own answers empty", "routes/gallery.ts"),
  "GET /v1/models": CATALOG,
  "GET /v1/model-makers": CATALOG,
  "GET /v1/content-rights/declaration": none("the rights declaration text, the same for everyone"),
  "GET /v1/content-complaints/statements": none("the complaints form's statements"),
  "POST /v1/content-complaints": none("a complaint submission: it stores one and answers no one's work"),
  "GET /v1/content-complaints/verify": none("a complainant's one-time email proof; answers whether it held"),
  "GET /v1/node-presets/factory": CATALOG,
  "GET /v1/node-presets/factory/groups": CATALOG,
  "GET /v1/keepers/catalog": published("the Keepers shelf: rows an administrator put on it from their own library (ee/routes/keepers.ts), the deployment's curation", "ee/routes/keepers.ts"),
  "GET /v1/trends": published("the trends catalog an administrator published (Admin → Trends), the deployment's own", "ee/routes/trends.ts"),
  "GET /v1/trends/tags": published("the tags of the trends catalog an administrator published", "ee/routes/trends.ts"),
  "GET /v1/trends/:slug": published("a trend page an administrator published, with its examples", "ee/routes/trends.ts"),
  "GET /v1/cast-swap/style-choice": none("one admin switch, the same for everyone"),
  "GET /v1/cast-swap/advanced": none("one admin switch, the same for everyone"),
  "GET /v1/gallery/items": none("no route answers this path today; the gallery is GET /v1/gallery"),
  "* /v1/gallery/report": asks("the gallery's report form: every item answers as not in the gallery", "routes/gallery.ts"),
  "GET /v1/public/workflows/*": asks("a workflow shared with settings.studio.shared: every caller but the signed-in owner gets the unshared 404", "routes/workflows.ts"),
  "GET /v1/shots/*": asks("a Cine shot's share link: a public shot reads as a private one for everyone but its owner", "routes/shots.ts"),
  "* /v1/download*": none(
    "streams a file of this deployment's storage by an address the caller already holds (isOurCdnUrl), which the storage serves without this route; the prefix also covers the download-video routes, which act for the signed-in caller",
    "routes/download.ts",
  ),
  "* /v1/billing/stripe-webhook": CALLBACK,
  "GET /v1/billing/surface": none("the deployment's billing display settings"),
  "GET /v1/billing/plans": CATALOG,
  "POST /v1/accessibility/report": none("an accessibility report submission"),
  "* /v1/image-proxy": none("a proxy of an image address the caller already holds; no row is read", "routes/image-proxy.ts"),
  "GET /v1/fonts*": none("bundled overlay fonts"),
  "GET /v1/site-assets/*": none("past builds' styling files"),
  "HEAD /v1/site-assets/*": none("past builds' styling files"),
  "* /v1/credits/model-cost": CATALOG,
  "* /v1/credits/model-costs": CATALOG,
  "* /v1/download-video/progress*": none("progress events of a download, by its unguessable id; no work is served"),
  "GET /v1/voices": CATALOG,
  "GET /v1/voices/library": CATALOG,
  "GET /v1/voices/library/facets": CATALOG,
  "GET /v1/voices/:voiceId/preview": none("a catalog voice's preview, by a signed address"),
  "HEAD /v1/voices/:voiceId/preview": none("a catalog voice's preview, by a signed address"),
  "GET /v1/heygen/avatars": CATALOG,
  "GET /v1/heygen/avatars/private": none("the avatars private to the deployment's own HeyGen account, for pickers; no user's work"),
  "GET /v1/heygen/voices": CATALOG,
  "* /v1/webhooks*": none("a workflow's trigger, by its token: it starts its owner's run and serves no work"),
  "POST /v1/telegram/webhook/*": CALLBACK,
  "GET /v1/social/callback*": CALLBACK,
  "POST /v1/social/meta/data-deletion": CALLBACK,
  "POST /v1/social/meta/deauthorize": CALLBACK,
  "GET /v1/social/meta/data-deletion/status": none("the status of a data-deletion request, by its signed code"),
  "POST /v1/social/connect/finalize": OAUTH,
  "GET /v1/sso/*": OAUTH,
  "GET /v1/present/*": published(
    "the presentation share links (/v1/present/:token): the owner mints the token for a viewer — a separate feature, out of scope for this switch by decision (2026-11-11)",
    "routes/presentation.ts",
  ),
  "GET /v1/app/*": APP_PAGE,
  "GET /og/app/*": judgment("an app's social card (name, description, picture) by its slug: follows the app page's decision", "routes/og-tags.ts"),
  "GET /v1/embed/*": judgment("an app's embed frame by its slug: follows the app page's decision", "routes/embed.ts"),
  "GET /v1/apps/browse": asks("the app and component marketplace: lists nothing", "routes/published-apps.ts"),
  "GET /v1/templates/browse": asks("the template marketplace: lists nothing", "routes/workflow-templates.ts"),
  "GET /v1/tutorials": published("the tutorial channel: templates and videos an administrator lists (Admin → Tutorials)", "routes/tutorials.ts"),
  "GET /v1/nodes": CATALOG,
  "GET /v1/picker-catalogs": CATALOG,
  "GET /v1/picker-catalogs/*": CATALOG,
  "GET /v1/catalogs": CATALOG,
  "GET /v1/invitations/by-token/*": none("an invitation's preview, by its token: what the invitation email already said"),
  "GET /v1/nodes/*": CATALOG,
  "GET /v1/openapi.json": none("the API description"),
  "GET /v1/templates/*": asks(
    "a template's page: one on the marketplace answers its creator (and an admin's preview) only; the tutorial channel stays",
    "routes/workflow-templates.ts",
  ),
  "POST /v1/oauth/token": OAUTH,
  "POST /v1/oauth/revoke": OAUTH,
  "GET /v1/oauth/app-info": OAUTH,
  "POST /v1/oauth/register": OAUTH,
  "GET /v1/oauth/authorize": OAUTH,
  "POST /v1/oauth/plugin/session": OAUTH,
  "GET /v1/oauth/plugin/session/*": OAUTH,
  "GET /v1/oauth/plugin/callback": OAUTH,
  "POST /v1/oauth/plugin/confirm": OAUTH,
  "GET /.well-known/oauth-authorization-server": DISCOVERY,
  "GET /.well-known/oauth-protected-resource": DISCOVERY,
  "GET /.well-known/oauth-protected-resource/mcp": DISCOVERY,
  "GET /.well-known/oauth-authorization-server/mcp": DISCOVERY,
  "POST /mcp": none("the MCP transport (bearer checked by the route); its tools' public scopes are classified in MCP_PUBLIC_SCOPES"),
  "GET /mcp": none("the MCP transport (bearer checked by the route); its tools' public scopes are classified in MCP_PUBLIC_SCOPES"),
  "PUT /v1/upload-proxy/*": none("receives an upload by its signed token; serves no work"),
  "GET /v1/upload-page/*": none("the upload page for a signed token; serves no work"),
  "POST /v1/upload-page/*": none("receives an upload by its signed token; serves no work"),
  "* /v1/api/*": none("the API-token lane (bearer checked by the routes): the token's owner runs and reads their own workflows"),
}

interface McpScopeRead extends Read {
  /** The tools in the file whose `scope` reaches other people's work. */
  readonly tools: readonly string[]
}

/** Every MCP tool file whose `scope` parameter offers more than "mine". */
const MCP_PUBLIC_SCOPES: Readonly<Record<string, McpScopeRead>> = {
  "lib/mcp/tools/gallery.ts": { ...asks("browse_gallery scope public: lists nothing"), tools: ["browse_gallery"] },
  "lib/mcp/tools/jobs.ts": { ...asks("list_jobs scope public: lists nothing"), tools: ["list_jobs"] },
  "lib/mcp/tools/apps.ts": { ...asks("list_apps scope public: lists nothing"), tools: ["list_apps"] },
  "lib/mcp/tools/components.ts": { ...asks("list_components scope public: lists nothing"), tools: ["list_components"] },
}

/**
 * The reads of other people's work keyed on a publication flag, by spelling:
 * a public job, a listed app, a template's channel, a public shot, the
 * `studio.shared` workflow opt-in.
 */
const PUBLICATION_FLAG_READS: ReadonlyArray<readonly [string, RegExp]> = [
  ["a public job", /\bis_public\.eq\.true\b|\.eq\(\s*["'`]is_public["'`]\s*,\s*true\s*\)|\.filter\(\s*["'`]is_public["'`]\s*,\s*["'`]eq["'`]\s*,\s*true\s*\)|\.match\(\s*\{[^}]*\bis_public\s*:\s*true|\bis_public\s*===\s*true\b/],
  ["a listed app", /\bis_listed\.eq\.true\b|\.eq\(\s*["'`]is_listed["'`]\s*,\s*true\s*\)|\bis_listed\s*===\s*true\b|!\s*\w+\.is_listed\b/],
  ["a template's channel", /\.contains\(\s*["'`]listed_in["'`]/],
  ["a public shot", /\bvisibility\s*[!=]==\s*["'`]public["'`]/],
  ["the studio.shared opt-in", /\.shared\s*[!=]==\s*true\b/],
  ["a shared asset", /\.eq\(\s*["'`]is_shared["'`]\s*,\s*true\s*\)|\bis_shared\.eq\.true\b|\bis_shared\s*===\s*true\b/],
  ["the shared library", /\.eq\(\s*["'`]is_library_item["'`]\s*,\s*true\s*\)|\bis_library_item\.eq\.true\b|\bis_library_item\s*===\s*true\b/],
  ["the Keepers shelf", /\.eq\(\s*["'`]catalog["'`]\s*,\s*true\s*\)|\bcatalog\.eq\.true\b/],
]

/** Every file that reads other people's work by its publication flag. */
const FLAG_READ_FILES: Readonly<Record<string, Read>> = {
  "lib/public-job-read.ts": asks("the one filter for reading another person's job by its id"),
  "lib/gallery-listing.ts": none("the gallery's page reader: GET /v1/gallery asks the switch before calling it, and the admin moderation view is an administrator's"),
  "lib/mcp/tools/gallery.ts": asks("browse_gallery public scope; get_asset, display_asset and list_favorites go through lib/public-job-read.ts"),
  "lib/mcp/tools/jobs.ts": asks("list_jobs public scope"),
  "routes/gallery.ts": asks("the public gallery and its report form"),
  "ee/routes/community.ts": asks("the community listings: browse, favorites, a listing's card, its detail and a clone"),
  "lib/mcp/tools/apps.ts": asks("list_apps public scope; get_app_inputs / run_app by slug are the app-page judgment (APP_PAGE)"),
  "lib/mcp/tools/components.ts": asks("list_components public scope; get_component_inputs / run_component by slug are the app-page judgment (APP_PAGE)"),
  "routes/published-apps.ts": asks("the app and component marketplace"),
  "routes/workflow-templates.ts": asks("the template marketplace, a template's page and its clone"),
  "routes/tutorials.ts": published("the tutorial channel an administrator curates"),
  "routes/shots.ts": asks("a Cine shot's share link"),
  "routes/workflows.ts": asks("the shared-by-link workflow read"),
  "lib/workflow-route-access.ts": asks("the editable copy of a shared workflow"),
  "lib/studio-audience.ts": none("decides who may WRITE the share flag; reads no one's work"),
  "ee/lib/keepers-store.ts": published("the Keepers shelf: rows an administrator put on it from their own library"),
  "routes/library.ts": published("the shared library beside the caller's own: assets only an administrator promotes into it"),
  "ee/copilot/studio-preamble.ts": none("tells the owner's own Copilot that their production is shared; their own work"),
}

const verifyKind = (label: string, entry: Read): void => {
  expect(entry.why.length, `${label}: say why`).toBeGreaterThan(15)
  if (entry.kind === "asks" || entry.kind === "judgment") expect(entry.files?.length ?? 0, `${label}: name the handler file`).toBeGreaterThan(0)
  for (const file of entry.files ?? []) {
    expect(existsSync(join(SRC_DIR, file)), `${label}: ${file} does not exist`).toBe(true)
    const asksHere = ASKS_THE_SWITCH.test(read(file))
    if (entry.kind === "asks") expect(asksHere, `${label} is marked asks but ${file} never asks the switch`).toBe(true)
    else expect(asksHere, `${label}: ${file} now asks the switch — classify it as asks`).toBe(false)
  }
}

describe("the predicate", () => {
  it("recognizes the spellings it counts", () => {
    expect(ASKS_THE_SWITCH.test("if (!surfaceAllowsPublicOutputs()) return")).toBe(true)
    expect(ASKS_THE_SWITCH.test(".or(readableJobsFilter(session.userId))")).toBe(true)
    expect(ASKS_THE_SWITCH.test(withoutComments("// surfaceAllowsPublicOutputs() in a comment"))).toBe(false)
    const [, publicJob] = PUBLICATION_FLAG_READS[0]!
    expect(publicJob.test(`.or(\`user_id.eq.\${id},and(is_public.eq.true,status.eq.completed)\`)`)).toBe(true)
    expect(publicJob.test(`.eq("is_public", true)`)).toBe(true)
    expect(publicJob.test(`row.is_public === true`)).toBe(true)
    expect(publicJob.test(`.update({ is_public: false })`)).toBe(false)
    const [, listedApp] = PUBLICATION_FLAG_READS[1]!
    expect(listedApp.test(`query.eq("is_listed", true)`)).toBe(true)
    expect(listedApp.test(`if (!data.is_listed && x)`)).toBe(true)
  })
})

describe("every public route is classified", () => {
  const rows = __publicRoutesForTest()
  const keys = rows.map(keyOf)

  it("reads the live list", () => {
    expect(rows.length, "found almost no public route: the accessor is wired to nothing").toBeGreaterThan(60)
    expect(new Set(keys).size, "two public-route rows share a key").toBe(keys.length)
  })

  it("no row is unclassified", () => {
    const unclassified = keys.filter((key) => !(key in PUBLIC_ROUTE_READS))
    expect(
      unclassified,
      "a public route (middleware/auth.ts PUBLIC_ROUTES) is not classified: say what it serves on a deployment that does not allow public work. " +
        "If it hands one person's work to anyone else, ask surfaceAllowsPublicOutputs() (lib/surface-profile.ts) and classify it as asks.",
    ).toEqual([])
  })

  it("no classification is stale", () => {
    const stale = Object.keys(PUBLIC_ROUTE_READS).filter((key) => !keys.includes(key))
    expect(stale, "PUBLIC_ROUTE_READS lists a route that is no longer public: remove it").toEqual([])
  })

  it("each says why, an `asks` really asks, and nothing else does", () => {
    for (const [key, read] of Object.entries(PUBLIC_ROUTE_READS)) verifyKind(key, read)
  })
})

describe("every MCP public scope is classified", () => {
  const toolFiles = walk(join(SRC_DIR, "lib", "mcp")).map((file) => ({
    rel: relative(SRC_DIR, file).split("\\").join("/"),
    source: withoutComments(readFileSync(file, "utf8")),
  }))
  /** Each `scope: z.enum([...])` parameter's values; a non-literal enum counts as reaching beyond "mine". */
  const reachesBeyondMine = (source: string): boolean => {
    for (const match of source.matchAll(/\bscope\s*:\s*z\s*\.\s*(?:enum\(\s*([^)]*)\)|literal\(\s*([^)]*)\))/g)) {
      const body = match[1] ?? match[2] ?? ""
      const values = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
      if (values.length === 0 || values.some((value) => value !== "mine")) return true
    }
    return false
  }
  const scoped = toolFiles.filter((f) => reachesBeyondMine(f.source)).map((f) => f.rel).sort()

  it("finds the scopes it counts", () => {
    expect(reachesBeyondMine(`scope: z\n  .enum(["public", "mine"])`)).toBe(true)
    expect(reachesBeyondMine(`scope: z.enum(["mine"])`)).toBe(false)
    expect(reachesBeyondMine(`scope: z.enum(SCOPES)`)).toBe(true)
    expect(scoped.length, "found no MCP public scope: the scan is wired to nothing").toBeGreaterThan(2)
  })

  it("every file with one is classified, and no classification is stale", () => {
    expect(
      scoped.filter((rel) => !(rel in MCP_PUBLIC_SCOPES)),
      "an MCP tool's scope reaches other people's work but is not classified: ask surfaceAllowsPublicOutputs() for that scope and classify it",
    ).toEqual([])
    expect(Object.keys(MCP_PUBLIC_SCOPES).filter((rel) => !scoped.includes(rel)), "MCP_PUBLIC_SCOPES lists a file with no such scope: remove it").toEqual([])
  })

  it("each names its tools, says why, and an `asks` really asks", () => {
    for (const [rel, read] of Object.entries(MCP_PUBLIC_SCOPES)) {
      const source = toolFiles.find((f) => f.rel === rel)!.source
      for (const tool of read.tools) expect(source, `${rel} no longer registers ${tool}`).toMatch(new RegExp(`["'\`]${tool}["'\`]`))
      verifyKind(rel, { ...read, files: [rel] })
    }
  })
})

describe("every read of other people's work by its publication flag is classified", () => {
  const sources = walk(SRC_DIR).map((file) => ({ rel: relative(SRC_DIR, file).split("\\").join("/"), source: withoutComments(readFileSync(file, "utf8")) }))
  const flagged = sources.filter((f) => PUBLICATION_FLAG_READS.some(([, spelling]) => spelling.test(f.source))).map((f) => f.rel).sort()

  it("finds the reads it counts", () => {
    expect(flagged.length, "found almost no flag read: the scan is wired to nothing").toBeGreaterThan(8)
  })

  it("every such file is classified, and no classification is stale", () => {
    expect(
      flagged.filter((rel) => !(rel in FLAG_READ_FILES)),
      "a file reads other people's work by a publication flag but is not classified: ask surfaceAllowsPublicOutputs() " +
        "(or read a job by id through lib/public-job-read.ts) and classify it as asks, or say why it serves no one's work",
    ).toEqual([])
    expect(Object.keys(FLAG_READ_FILES).filter((rel) => !flagged.includes(rel)), "FLAG_READ_FILES lists a file with no such read: remove it").toEqual([])
  })

  it("each says why, an `asks` really asks, and nothing else does", () => {
    for (const [rel, read] of Object.entries(FLAG_READ_FILES)) verifyKind(rel, { ...read, files: [rel] })
  })

  it("another person's job is read by its id only through lib/public-job-read.ts", () => {
    const inline = sources
      .filter((f) => f.rel !== "lib/public-job-read.ts" && /\bis_public\.eq\.true\b|\bis_public\s*===\s*true\b/.test(f.source))
      .map((f) => f.rel)
    expect(inline, "an inline `is_public` read of another person's job: use readableJobsFilter / jobReadableBy (lib/public-job-read.ts)").toEqual([])
  })
})
