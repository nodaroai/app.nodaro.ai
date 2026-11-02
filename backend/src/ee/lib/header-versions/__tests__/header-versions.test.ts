import { describe, expect, it, vi } from "vitest"
import type { DeploymentRecord, DeploymentStatus } from "../deployed.js"

// The plain summary is a model's to write; here it is a fixed sentence, and no model is asked.
vi.mock("../release-summary.js", () => ({
  createReleaseSummaries: () => (version: string, commits: readonly unknown[]) => (commits.length > 0 ? `Plain words for ${version}.` : null),
}))
import { GitHubError, type CommitSummary, type FetchLike, type GitHubReader } from "../github.js"
import { createHeaderVersions, ranked, type SiteResult } from "../header-versions.js"
import type { HeaderProduct } from "../products.js"

const APP: HeaderProduct = { id: "app", label: "App", repo: "acme/app", hosts: { production: "app.example.com", staging: "next.example.com" }, source: "site-file", icon: "workflow" }
const TOOLS: HeaderProduct = { id: "tools", label: "tools", repo: "acme/tools", hosts: { production: "tools.example.com", staging: "next.tools.example.com" }, source: "lockfile", icon: null }

const lockfile = (version: string) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@acme/header": { version } } })
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString()
const deployment = (id: number, environment: string, sha: string, minute: number): DeploymentRecord => ({ id, environment, sha, createdAt: at(minute) })

interface World {
  deployments: Record<string, DeploymentRecord[]>
  /** Each deployment's statuses, newest first. */
  statuses: Record<number, DeploymentStatus[]>
  files: Record<string, string>
  tags: string[]
  /** The commits between two tags, by `base...head`. */
  compares?: Record<string, CommitSummary[]>
  failRepo?: string
  failStatuses?: boolean
}

function fakeGitHub(world: World) {
  const calls: string[] = []
  const github: GitHubReader = {
    async deployments(repo, { environment, perPage, page = 1 }) {
      calls.push(`deployments ${repo}${environment ? ` env=${environment}` : ""} page=${page}`)
      if (repo === world.failRepo) throw new GitHubError("GitHub answered 404: Not Found", 404)
      const all = world.deployments[repo] ?? []
      const matching = environment ? all.filter((d) => d.environment === environment) : all
      return matching.slice((page - 1) * perPage, page * perPage)
    },
    async statuses(repo, id) {
      calls.push(`status ${repo}#${id}`)
      if (world.failStatuses) throw new GitHubError("GitHub answered 502: Server Error", 502)
      return world.statuses[id] ?? []
    },
    async fileAt(repo, path, ref) {
      calls.push(`file ${repo}@${ref}:${path}`)
      return world.files[`${repo}@${ref}:${path}`] ?? null
    },
    async tags(repo) {
      calls.push(`tags ${repo}`)
      return world.tags
    },
    async commitsBetween(repo, base, head) {
      calls.push(`compare ${repo} ${base}...${head}`)
      return world.compares?.[`${base}...${head}`] ?? []
    },
  }
  return { github, calls }
}

/** Each site's own file, by host; a host not listed answers the SPA shell. */
function sites(files: Record<string, string>) {
  const asked: string[] = []
  const fetch: FetchLike = async (url) => {
    // https://<host>/<path>?t=… → host and path.
    const [host = "", ...path] = url.replace(/^https:\/\//, "").split("?")[0]!.split("/")
    asked.push(`${host}/${path.join("/")}`)
    const body = files[host]
    return body === undefined ? new Response("<!doctype html><title>Nodaro.ai</title>", { headers: { "content-type": "text/html" } }) : new Response(body)
  }
  return { fetch, asked }
}

function world(): World {
  return {
    deployments: {
      "acme/tools": [
        deployment(13, "tools-p / staging", "tStaging2", 30),
        deployment(12, "tools-p / production", "tProd", 20),
        deployment(11, "tools-p / staging", "tStaging1", 10),
      ],
      "acme/app": [deployment(22, "app-p / staging", "aStaging", 25), deployment(21, "app-p / production", "aProd", 5)],
    },
    statuses: {
      13: [{ state: "in_progress", at: at(31) }],
      12: [{ state: "success", at: at(21) }, { state: "in_progress", at: at(20) }],
      11: [{ state: "success", at: at(11) }],
      22: [{ state: "success", at: at(26) }],
      21: [{ state: "success", at: at(6) }],
    },
    files: {
      // The header's own manifest names the package the lockfiles are searched for.
      "nodaroai/shell@HEAD:package.json": JSON.stringify({ name: "@acme/header", version: "0.13.0" }),
      "acme/tools@tProd:package-lock.json": lockfile("0.12.0"),
      "acme/tools@tStaging1:package-lock.json": lockfile("0.13.0"),
      "acme/app@aProd:frontend/src/ee/shell/install-package.sh": 'PIN="0.11.0"\n',
    },
    tags: ["v0.12.0", "v0.13.0", "v0.9.0"],
    compares: {
      "v0.12.0...v0.13.0": [
        { message: "feat: a row that can be turned off (0.13.0)\n\nBody.", parents: 1, committedAt: at(40) },
        { message: "Merge pull request #22 from acme/feat/row-off\n\nfeat: a row that can be turned off (0.13.0)", parents: 2, committedAt: at(41) },
      ],
    },
  }
}

describe("createHeaderVersions", () => {
  it("reads each site's version from what it deployed, beside the newest release", async () => {
    const { github } = fakeGitHub(world())
    const { fetch } = sites({
      "app.example.com": '{"package":"@acme/header","version":"0.12.0","header":false}',
      "next.example.com": '{"package":"@acme/header","version":"0.12.0","header":true}',
    })
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch, products: [APP, TOOLS] }).report({ fresh: false })

    expect(report.configured).toBe(true)
    // The page's title: the name the header's own repository gives, never one written in code.
    expect(report.headerPackage).toBe("@acme/header")
    expect(report.latest).toEqual({ status: "ok", version: "0.13.0", tagsUrl: "https://github.com/nodaroai/shell/tags" })
    const [app, tools] = report.products
    // Each product's picture is the list's to name, passed through as given.
    expect([app?.icon, tools?.icon]).toEqual(["workflow", null])
    expect(tools?.sites.production).toEqual({
      host: "tools.example.com",
      url: "https://tools.example.com",
      result: {
        status: "ok",
        version: "0.12.0",
        header: true,
        source: "lockfile",
        deploy: { sha: "tProd", commitUrl: "https://github.com/acme/tools/commit/tProd", deployedAt: at(21), deploying: false, lastFailed: false },
        standing: "behind",
        releasesBehind: 1,
      },
    })
    // A newer staging deploy is still building: the site serves the last success, and says so.
    expect(tools?.sites.staging.result).toMatchObject({ status: "ok", version: "0.13.0", standing: "newest", deploy: { sha: "tStaging1", deploying: true } })
    // The App says itself what it installed and whether it shows the header.
    expect(app?.sites.production.result).toMatchObject({ status: "ok", version: "0.12.0", header: false, source: "site-file", deploy: { sha: "aProd" } })
    expect(app?.sites.staging.result).toMatchObject({ status: "ok", version: "0.12.0", header: true, source: "site-file", deploy: { sha: "aStaging" } })

    // Every release newer than the oldest version served: what it brought, and the sites without it.
    expect(report.releaseNotes).toEqual({
      status: "ok",
      older: 0,
      compared: 4,
      releases: [
        {
          version: "0.13.0",
          summary: "Plain words for 0.13.0.",
          releasedAt: at(41),
          url: "https://github.com/nodaroai/shell/compare/v0.12.0...v0.13.0",
          changes: [{ title: "a row that can be turned off", kind: "feature", url: "https://github.com/nodaroai/shell/pull/22" }],
          missingOn: [
            { productId: "app", environment: "production" },
            { productId: "app", environment: "staging" },
            { productId: "tools", environment: "production" },
          ],
        },
      ],
    })
  })

  it("an App site that does not publish its file yet: the deployed pin, the header unknown", async () => {
    const { github, calls } = fakeGitHub(world())
    const { fetch } = sites({})
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch, products: [APP] }).report({ fresh: false })
    // A pin is what the commit would install, not what the site did: no release is counted against it.
    // Nothing compared: the page says so, never "every site serves the newest release".
    expect(report.releaseNotes).toEqual({ status: "ok", releases: [], older: 0, compared: 0 })
    expect(calls.some((call) => call.startsWith("compare"))).toBe(false)
    // A pin is not ranked: the environment's build can install another version.
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.11.0", header: null, source: "pin", standing: null, deploy: { sha: "aProd" } })
    // The staging commit has no readable pin: said so, never shown as "no header".
    expect(report.products[0]?.sites.staging.result).toEqual({ status: "error", message: "Could not read the header pin (frontend/src/ee/shell/install-package.sh) at aStagin." })
  })

  it("without the header's own manifest, no lockfile is guessed at", async () => {
    const w = world()
    delete w.files["nodaroai/shell@HEAD:package.json"]
    const { github } = fakeGitHub(w)
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS] }).report({ fresh: false })
    expect(report.products[0]?.sites.production.result).toEqual({ status: "error", message: "Could not read the header's package name from nodaroai/shell." })
    expect(report.headerPackage).toBeNull()
  })

  it("a commit whose package.json cannot be read is an error, not a product without the header", async () => {
    const w = world()
    w.files["acme/tools@tProd:package-lock.json"] = JSON.stringify({ packages: {} })
    const { github } = fakeGitHub(w)
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS] }).report({ fresh: false })
    expect(report.products[0]?.sites.production.result).toEqual({ status: "error", message: "Could not read package.json at tProd." })
  })

  it("GitHub failing to answer a status costs the App only its commit line: its own file still answers", async () => {
    const w = world()
    w.failStatuses = true
    const { github } = fakeGitHub(w)
    const { fetch } = sites({ "app.example.com": '{"version":"0.13.0","header":true}' })
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch, products: [APP] }).report({ fresh: false })
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.13.0", header: true, source: "site-file", deploy: null, standing: "newest" })
    // Without its file, the status failure is what the cell says.
    expect(report.products[0]?.sites.staging.result).toMatchObject({ status: "error", message: expect.stringMatching(/502/) })
  })

  it("a renamed project: a known name that answers nothing is forgotten and the deployments scanned again", async () => {
    const w = world()
    const { github, calls } = fakeGitHub(w)
    let clock = Date.UTC(2026, 10, 1, 13, 0)
    const service = createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS], now: () => clock })
    await service.report({ fresh: false })
    w.deployments["acme/tools"] = [deployment(41, "tools-renamed / production", "tProd", 40), deployment(42, "tools-renamed / staging", "tStaging1", 41)]
    w.statuses[41] = [{ state: "success", at: at(40) }]
    w.statuses[42] = [{ state: "success", at: at(41) }]
    clock += 61_000
    calls.length = 0
    const report = await service.report({ fresh: false })
    expect(calls).toContain("deployments acme/tools page=1")
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.12.0", deploy: { deployedAt: at(40) } })
  })

  it("a lockfile without the header: what package.json declares, said to be a declaration", async () => {
    const w = world()
    w.files["acme/tools@tProd:package-lock.json"] = JSON.stringify({ packages: {} })
    w.files["acme/tools@tProd:package.json"] = JSON.stringify({ dependencies: { "@acme/header": "^0.12.0" } })
    const { github } = fakeGitHub(w)
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS] }).report({ fresh: false })
    // A range is not ranked: it says what may be installed, not what is.
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "^0.12.0", header: true, source: "package-json", standing: null })
  })

  it("reads its products from the deployment's setting, and reports the entries it refused", async () => {
    const { github } = fakeGitHub(world())
    const productsJson = JSON.stringify([
      { id: "tools", label: "tools", repo: "acme/tools", production: "tools.example.com", staging: "next.tools.example.com", source: "lockfile" },
      { id: "bad", label: "bad", repo: "acme/bad", production: "https://bad.example.com", staging: "x.example.com", source: "lockfile" },
    ])
    const report = await createHeaderVersions({ githubToken: "", productsJson }, { github, fetch: sites({}).fetch }).report({ fresh: false })
    expect(report.products.map((p) => p.id)).toEqual(["tools"])
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.12.0" })
    expect(report.invalidProducts).toEqual([{ index: 1, reason: expect.stringMatching(/^production:/) }])
  })

  it("ranks each exact version against the newest release", () => {
    const ok = (version: string | null): SiteResult => ({ status: "ok", version, header: true, source: "lockfile", deploy: null, standing: null, releasesBehind: null })
    expect(ranked(ok("0.13.0"), "0.13.0")).toMatchObject({ standing: "newest" })
    expect(ranked(ok("0.6.2"), "0.13.0")).toMatchObject({ standing: "behind" })
    expect(ranked(ok("0.14.0-rc.1"), "0.13.0")).toMatchObject({ standing: "ahead" })
    expect(ranked(ok(null), "0.13.0")).toMatchObject({ standing: null })
    expect(ranked(ok("0.13.0"), null)).toMatchObject({ standing: null })
    expect(ranked({ status: "no_deploy" }, "0.13.0")).toEqual({ status: "no_deploy" })
  })

  it("a site behind counts the releases it lacks — patch releases too — never the ones it has", () => {
    const ok = (version: string): SiteResult => ({ status: "ok", version, header: true, source: "lockfile", deploy: null, standing: null, releasesBehind: null })
    const releases = ["0.11.0", "0.12.0", "0.12.1", "0.12.2", "0.13.0", "0.13.2"]
    expect(ranked(ok("0.12.0"), "0.13.2", releases)).toMatchObject({ standing: "behind", releasesBehind: 4 })
    expect(ranked(ok("0.13.0"), "0.13.2", releases)).toMatchObject({ standing: "behind", releasesBehind: 1 })
    expect(ranked(ok("0.13.2"), "0.13.2", releases)).toMatchObject({ standing: "newest", releasesBehind: null })
    // A version that is not a tag still counts the tags above it.
    expect(ranked(ok("0.12.5"), "0.13.2", releases)).toMatchObject({ releasesBehind: 2 })
    // Without the release list, behind is said without a count.
    expect(ranked(ok("0.12.0"), "0.13.2")).toMatchObject({ standing: "behind", releasesBehind: null })
  })

  it("without a token: GitHub is never asked, and the App's own file still answers", async () => {
    const { fetch, asked } = sites({ "app.example.com": '{"version":"0.12.0","header":false}' })
    const report = await createHeaderVersions({ githubToken: "  " }, { fetch, products: [APP, TOOLS] }).report({ fresh: false })
    expect(report.configured).toBe(false)
    expect(report.headerPackage).toBeNull()
    expect(report.latest).toEqual({ status: "not_configured" })
    expect(report.releaseNotes).toEqual({ status: "not_configured" })
    // No release to rank against without GitHub.
    expect(report.products[0]?.sites.production.result).toEqual({ status: "ok", version: "0.12.0", header: false, source: "site-file", deploy: null, standing: null, releasesBehind: null })
    expect(report.products[0]?.sites.staging.result).toEqual({ status: "error", message: "next.example.com does not publish /shell-version.json yet." })
    expect(report.products[1]?.sites.production.result).toEqual({ status: "not_configured" })
    expect(asked.every((url) => url.endsWith("/shell-version.json"))).toBe(true)
  })

  it("a repository the token cannot see fails its own row only, with a hint", async () => {
    const w = world()
    w.failRepo = "acme/tools"
    const { github } = fakeGitHub(w)
    const { fetch } = sites({ "app.example.com": '{"version":"0.12.0","header":false}', "next.example.com": '{"version":"0.12.0","header":true}' })
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch, products: [APP, TOOLS] }).report({ fresh: false })
    const tools = report.products[1]?.sites.production.result
    expect(tools).toMatchObject({ status: "error" })
    expect(tools?.status === "error" ? tools.message : "").toMatch(/404.*cannot see this repository/)
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.12.0" })
  })

  it("an environment with no successful deployment says so", async () => {
    const w = world()
    w.deployments["acme/tools"] = [deployment(31, "tools-p / production", "x", 1)]
    w.statuses[31] = [{ state: "failure", at: at(2) }, { state: "in_progress", at: at(1) }]
    const { github } = fakeGitHub(w)
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS] }).report({ fresh: false })
    expect(report.products[0]?.sites.production.result).toEqual({ status: "no_deploy" })
    expect(report.products[0]?.sites.staging.result).toEqual({ status: "no_deploy" })
  })

  it("keeps the answer a minute; Refresh asks again after 15 s; a file at a commit is read once, statuses every time", async () => {
    let clock = Date.UTC(2026, 10, 1, 13, 0)
    const { github, calls } = fakeGitHub(world())
    const service = createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS], now: () => clock })

    await service.report({ fresh: false })
    const first = calls.length
    // The first pass scanned the deployments and learned the environment names.
    expect(calls).toContain("deployments acme/tools page=1")

    // A Refresh within 15 s, and a plain ask within the minute: the answer kept.
    clock += 10_000
    await service.report({ fresh: true })
    clock += 20_000
    await service.report({ fresh: false })
    expect(calls.length).toBe(first)

    clock += 15_000
    calls.length = 0
    await service.report({ fresh: true })
    // Known names: one small query per environment, never a scan.
    expect(calls).toContain("deployments acme/tools env=tools-p / production page=1")
    expect(calls).toContain("deployments acme/tools env=tools-p / staging page=1")
    expect(calls).not.toContain("deployments acme/tools page=1")
    // Files at a commit never change. A status can move at any time (a live deployment can fail on a redeploy),
    // so the walk asks again — conditionally, which GitHub does not count (github.ts).
    expect(calls.filter((c) => c.startsWith("file "))).toEqual([])
    expect(calls.filter((c) => c.startsWith("status ")).sort()).toEqual(["status acme/tools#11", "status acme/tools#12", "status acme/tools#13"])
  })

  it("a live deployment whose redeploy failed is still shown live, with the failure said", async () => {
    const w = world()
    w.statuses[12] = [{ state: "failure", at: at(50) }, { state: "in_progress", at: at(49) }, { state: "success", at: at(21) }]
    const { github } = fakeGitHub(w)
    const report = await createHeaderVersions({ githubToken: "" }, { github, fetch: sites({}).fetch, products: [TOOLS] }).report({ fresh: false })
    expect(report.products[0]?.sites.production.result).toMatchObject({ status: "ok", version: "0.12.0", deploy: { sha: "tProd", deployedAt: at(21), lastFailed: true } })
  })
})
