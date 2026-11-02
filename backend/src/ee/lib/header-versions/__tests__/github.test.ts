import { describe, expect, it } from "vitest"
import { createGitHubReader, GitHubError, type FetchLike } from "../github.js"

function recorder(answer: (url: URL) => Response) {
  const seen: Array<{ url: URL; headers: Headers }> = []
  const fetch: FetchLike = async (url, init) => {
    // A parsed request URL, not a module path (URL.parse never throws; every URL here is absolute).
    const parsed = URL.parse(url)!
    seen.push({ url: parsed, headers: new Headers(init?.headers) })
    return answer(parsed)
  }
  return { fetch, seen }
}

describe("createGitHubReader", () => {
  it("sends the token, and reads deployments into plain records", async () => {
    const { fetch, seen } = recorder(() =>
      Response.json([
        { id: 7, environment: "tools-p / production", sha: "abc", created_at: "2026-11-01T12:00:00Z", creator: { login: "bot" } },
        { id: "bad" },
      ]),
    )
    const records = await createGitHubReader("tok", { fetch }).deployments("acme/tools", { environment: "tools-p / production", perPage: 10 })
    expect(records).toEqual([{ id: 7, environment: "tools-p / production", sha: "abc", createdAt: "2026-11-01T12:00:00Z" }])
    expect(seen[0]?.url.pathname).toBe("/repos/acme/tools/deployments")
    expect(seen[0]?.url.searchParams.get("environment")).toBe("tools-p / production")
    expect(seen[0]?.url.searchParams.get("per_page")).toBe("10")
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok")
  })

  it("reads a deployment's whole status history, newest first; an unheard-of state is unknown", async () => {
    const { fetch, seen } = recorder(() =>
      Response.json([
        { state: "success", created_at: "2026-11-01T12:01:00Z" },
        { state: "failure", created_at: "2026-11-01T12:09:00Z" },
        { state: "exploded" },
      ]),
    )
    expect(await createGitHubReader("tok", { fetch }).statuses("acme/tools", 7)).toEqual([
      { state: "failure", at: "2026-11-01T12:09:00Z" },
      { state: "success", at: "2026-11-01T12:01:00Z" },
      { state: "unknown", at: null },
    ])
    expect(seen[0]?.url.pathname).toBe("/repos/acme/tools/deployments/7/statuses")
    expect(seen[0]?.url.searchParams.get("per_page")).toBe("100")
  })

  it("reads the commits between two tags: message, parents and commit time; a malformed row is skipped", async () => {
    const { fetch, seen } = recorder(() =>
      Response.json({
        files: [{ filename: "src/a.ts" }],
        commits: [
          { commit: { message: "feat: a", committer: { date: "2026-11-01T10:00:00Z" } }, parents: [{ sha: "p1" }] },
          { commit: { message: "Merge pull request #2 from a/b\n\nfeat: a" }, parents: [{ sha: "p1" }, { sha: "p2" }] },
          { commit: null },
        ],
      }),
    )
    expect(await createGitHubReader("tok", { fetch }).commitsBetween("acme/shell", "v0.12.0", "v0.13.0")).toEqual([
      { message: "feat: a", parents: 1, committedAt: "2026-11-01T10:00:00Z" },
      { message: "Merge pull request #2 from a/b\n\nfeat: a", parents: 2, committedAt: null },
    ])
    expect(seen[0]?.url.pathname).toBe("/repos/acme/shell/compare/v0.12.0...v0.13.0")
    expect(seen[0]?.url.searchParams.get("per_page")).toBe("100")
  })

  it("a comparison longer than a page is read to its newest commit, never kept for an ETag", async () => {
    const row = (n: number) => ({ commit: { message: `feat: change ${n}`, committer: { date: `2026-11-01T10:${String(n % 60).padStart(2, "0")}:00Z` } }, parents: [{ sha: "p" }] })
    const { fetch, seen } = recorder((url) => {
      const page = Number(url.searchParams.get("page"))
      const rows = page === 1 ? Array.from({ length: 100 }, (_, i) => row(i)) : Array.from({ length: 50 }, (_, i) => row(100 + i))
      return Response.json({ total_commits: 150, commits: rows }, { headers: { etag: 'W/"cmp"' } })
    })
    const reader = createGitHubReader("tok", { fetch })
    const commits = await reader.commitsBetween("acme/shell", "v0.1.0", "v0.2.0")
    expect(commits).toHaveLength(150)
    expect(commits.at(-1)?.message).toBe("feat: change 149")
    expect(seen.map((s) => s.url.searchParams.get("page"))).toEqual(["1", "2"])
    await reader.commitsBetween("acme/shell", "v0.1.0", "v0.2.0")
    expect(seen[2]?.headers.get("if-none-match")).toBeNull()
  })

  it("asks again with the last answer's ETag, and a 304 hands back that answer", async () => {
    let calls = 0
    const { fetch, seen } = recorder(() => {
      calls++
      if (calls === 1) return Response.json([{ name: "v0.12.0" }], { headers: { etag: 'W/"abc"' } })
      if (calls === 2) return new Response(null, { status: 304 })
      return Response.json([{ name: "v0.13.0" }], { headers: { etag: 'W/"def"' } })
    })
    const reader = createGitHubReader("tok", { fetch })
    expect(await reader.tags("acme/shell")).toEqual(["v0.12.0"])
    expect(seen[0]?.headers.get("if-none-match")).toBeNull()
    expect(await reader.tags("acme/shell")).toEqual(["v0.12.0"])
    expect(seen[1]?.headers.get("if-none-match")).toBe('W/"abc"')
    expect(await reader.tags("acme/shell")).toEqual(["v0.13.0"])
    expect(seen[2]?.headers.get("if-none-match")).toBe('W/"abc"')
    // A file at a commit is not a list: never asked conditionally.
    await reader.fileAt("acme/shell", "package.json", "abc")
    expect(seen[3]?.headers.get("if-none-match")).toBeNull()
  })

  it("reads a file's raw text at a commit; a missing file is null", async () => {
    const { fetch, seen } = recorder((url) => (url.pathname.endsWith("package-lock.json") ? new Response('{"x":1}') : new Response("{}", { status: 404 })))
    const reader = createGitHubReader("tok", { fetch })
    expect(await reader.fileAt("acme/tools", "package-lock.json", "abc")).toBe('{"x":1}')
    expect(seen[0]?.url.searchParams.get("ref")).toBe("abc")
    expect(seen[0]?.headers.get("accept")).toBe("application/vnd.github.raw+json")
    expect(await reader.fileAt("acme/tools", "package.json", "abc")).toBeNull()
  })

  it("reads a file as it stands on the default branch, conditionally; a missing file is null", async () => {
    const encoded = Buffer.from('{"asOf":"1.0.0"}', "utf8").toString("base64")
    let calls = 0
    const { fetch, seen } = recorder((url) => {
      if (url.pathname.endsWith("missing.json")) return Response.json({ message: "Not Found" }, { status: 404 })
      calls++
      return calls === 1 ? Response.json({ type: "file", encoding: "base64", content: encoded }, { headers: { etag: 'W/"m1"' } }) : new Response(null, { status: 304 })
    })
    const reader = createGitHubReader("tok", { fetch })
    expect(await reader.currentFile("acme/shell", "docs/map.json")).toBe('{"asOf":"1.0.0"}')
    expect(seen[0]?.url.pathname).toBe("/repos/acme/shell/contents/docs/map.json")
    // No commit named: the default branch as it stands.
    expect(seen[0]?.url.searchParams.has("ref")).toBe(false)
    // Unchanged since: GitHub's 304 hands back the text it sent before.
    expect(await reader.currentFile("acme/shell", "docs/map.json")).toBe('{"asOf":"1.0.0"}')
    expect(seen[1]?.headers.get("if-none-match")).toBe('W/"m1"')
    expect(await reader.currentFile("acme/shell", "docs/missing.json")).toBeNull()
  })

  it("decodes GitHub's base64 as it sends it: wrapped in lines, carrying UTF-8 beyond ASCII", async () => {
    const text = JSON.stringify({ note: "Explore, Image, Video… and “More”", padding: "x".repeat(120) })
    const wrapped = Buffer.from(text, "utf8").toString("base64").replace(/(.{60})/g, "$1\n")
    const reader = createGitHubReader("tok", { fetch: async () => Response.json({ type: "file", encoding: "base64", content: wrapped }) })
    expect(await reader.currentFile("acme/shell", "docs/map.json")).toBe(text)
  })

  it("a file sent in a form it cannot decode is a refusal, never empty text", async () => {
    const reader = createGitHubReader("tok", { fetch: async () => Response.json({ type: "file", encoding: "none", content: "" }) })
    await expect(reader.currentFile("acme/shell", "docs/map.json")).rejects.toBeInstanceOf(GitHubError)
  })

  it("a refusal carries GitHub's words and status; no connection is said plainly", async () => {
    const refused = createGitHubReader("tok", { fetch: async () => Response.json({ message: "Bad credentials" }, { status: 401 }) })
    await expect(refused.tags("acme/shell")).rejects.toMatchObject({ status: 401, message: "GitHub answered 401: Bad credentials" })
    const offline = createGitHubReader("tok", {
      fetch: async () => {
        throw new TypeError("fetch failed")
      },
    })
    const error = await offline.tags("acme/shell").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ status: null, message: "Could not reach GitHub." })
  })
})
