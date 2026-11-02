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
