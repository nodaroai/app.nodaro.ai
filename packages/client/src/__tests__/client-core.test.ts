/**
 * `NodaroClientCore` — the client without its resources — and the promise
 * that `NodaroClient`, now built on it, did not change for anyone using it.
 *
 * Types: fixtures/client-api-compat.ts is a consumer of the BUILT package
 * (CI builds the packages first; locally run `npm run build:packages`) and is
 * compiled here: it pins NodaroClient's public members, its resource types,
 * that every resource class still takes a NodaroClient, and that the core
 * takes only the resources an app gives it.
 */
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  createClient,
  JobsResource,
  NodaroClient,
  NodaroClientCore,
  NodesResource,
  SessionsResource,
  StaticTokenAuth,
} from "../index.js"

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist")
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "client-api-compat.ts")

const RESOURCES = [
  "workflows", "projects", "sessions", "jobs", "videoPro", "executions", "nodes", "scene3d",
  "developerApps", "oauth", "webhooks", "apps", "characters", "locations", "objects", "creatures",
  "pipelines", "reduce", "promptHelper", "voices", "llm", "media", "audio", "credits", "billing",
  "uploads", "library", "gallery", "presets", "savedPosts", "collections", "palettes", "moodboards",
  "competitors", "pickerCatalogs", "catalogs", "models", "shots", "recast", "studio", "copilot",
  "community", "templates", "tutorials", "organizations", "workspaces", "edit",
]

function okFetch(body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe("NodaroClient on NodaroClientCore", () => {
  it("createClient still builds every resource up front, as own enumerable properties", () => {
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t") })
    expect(c).toBeInstanceOf(NodaroClient)
    expect(c).toBeInstanceOf(NodaroClientCore)
    const own = Object.keys(c)
    for (const name of RESOURCES) {
      expect(own, name).toContain(name)
      expect((c as unknown as Record<string, unknown>)[name], name).toBeTypeOf("object")
    }
    expect(c.sessions).toBeInstanceOf(SessionsResource)
  })

  it("withWorkspace still returns a full NodaroClient with the same config", async () => {
    const { fetch, calls } = okFetch({ data: [] })
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch, timeoutMs: 5_000, clientLabel: "x/1" })
    const w = c.withWorkspace("ws-1")
    expect(w).toBeInstanceOf(NodaroClient)
    expect([w.baseUrl, w.timeoutMs, w.clientLabel, w.workspaceId]).toEqual(["https://api.example.com", 5_000, "x/1", "ws-1"])
    await w.request("GET", "/v1/ping")
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers["X-Nodaro-Workspace"]).toBe("ws-1")
    expect(headers["X-Nodaro-Client"]).toBe("x/1")
    expect(headers.Authorization).toBe("Bearer t")
    expect(c.withWorkspace(null).workspaceId).toBeUndefined()
  })

  // withWorkspace reads the client's settings through `this`, so a wrapped
  // client — a Proxy (Vue/Pinia `reactive()`, `ref()`) or an object whose
  // prototype is the client — still rebuilds, from the source and from the
  // BUILT package in both formats.
  type SdkModule = Pick<typeof import("../index.js"), "createClient" | "StaticTokenAuth" | "NodaroClient">
  const builds: Array<[string, () => Promise<SdkModule>]> = [
    ["source", async () => ({ createClient, StaticTokenAuth, NodaroClient })],
    ["dist ESM", async () => (await import(pathToFileURL(path.join(DIST, "index.js")).href)) as SdkModule],
    ["dist CJS", async () => createRequire(import.meta.url)(path.join(DIST, "index.cjs")) as SdkModule],
  ]
  for (const [build, load] of builds) {
    it.each([
      ["a Proxy", (c: object) => new Proxy(c, {})],
      ["Object.create(client)", (c: object) => Object.create(c) as object],
    ])(`withWorkspace works on a client wrapped in %s (${build})`, async (_label, wrap) => {
      const sdk = await load()
      const { fetch, calls } = okFetch({ data: [] })
      const c = sdk.createClient({ baseUrl: "https://api.example.com", auth: new sdk.StaticTokenAuth("t"), fetch, timeoutMs: 5_000, clientLabel: "x/1" })
      const wrapped = wrap(c) as typeof c
      const w = wrapped.withWorkspace("ws-1")
      expect(w).toBeInstanceOf(sdk.NodaroClient)
      expect([w.baseUrl, w.timeoutMs, w.clientLabel, w.workspaceId]).toEqual(["https://api.example.com", 5_000, "x/1", "ws-1"])
      await w.request("GET", "/v1/ping")
      const headers = calls[0]!.init.headers as Record<string, string>
      expect([headers["X-Nodaro-Workspace"], headers["X-Nodaro-Client"], headers.Authorization]).toEqual(["ws-1", "x/1", "Bearer t"])
    })
  }

  it("a core extended with only some resources sends the same requests", async () => {
    class Slim extends NodaroClientCore {
      readonly jobs = new JobsResource(this)
      readonly nodes = new NodesResource(this)
    }
    const { fetch, calls } = okFetch({ data: { id: "j1", status: "completed" } })
    const slim = new Slim({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch })
    const full = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch })
    await slim.jobs.getStatus("j1")
    await full.jobs.getStatus("j1")
    expect(calls).toHaveLength(2)
    const sent = calls.map(({ url, init }) => ({ url, method: init.method, headers: init.headers, body: init.body }))
    expect(sent[0]).toEqual(sent[1])
    expect(Object.keys(slim)).not.toContain("sessions")
  })

  it("the public API compiles as before against the built package (fixtures/client-api-compat.ts)", () => {
    const program = ts.createProgram([FIXTURE], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    })
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) =>
      `${d.file ? path.basename(d.file.fileName) : "?"}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
    )
    expect(diagnostics).toEqual([])
  }, 60_000)
})
