import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The 2a wave: connect (connectWithFields) + publish shapes for every
 * custom_fields network, against a scripted global fetch. Each script entry
 * matches a URL substring and returns { status, json }.
 */

type FetchScript = Array<{ match: string; status?: number; json: unknown }>
let script: FetchScript = []
const calls: Array<{ url: string; init?: RequestInit }> = []

const realFetch = globalThis.fetch
beforeEach(() => {
  script = []
  calls.length = 0
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const entry = script.find((s) => url.includes(s.match))
    if (!entry) throw new Error(`Unscripted fetch: ${url}`)
    return {
      ok: (entry.status ?? 200) < 400,
      status: entry.status ?? 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => entry.json,
      text: async () => JSON.stringify(entry.json),
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

import { blueskyProvider } from "../../providers/bluesky.js"
import { devtoProvider } from "../../providers/devto.js"
import { hashnodeProvider } from "../../providers/hashnode.js"
import { lemmyProvider } from "../../providers/lemmy.js"
import { mediumProvider } from "../../providers/medium.js"
import { wordpressProvider } from "../../providers/wordpress.js"

describe("bluesky", () => {
  it("connect validates the app password via createSession", async () => {
    script = [{ match: "createSession", json: { accessJwt: "jwt", did: "did:plc:1", handle: "me.bsky.social" } }]
    const res = await blueskyProvider.connectWithFields!({
      service: "https://bsky.social",
      identifier: "me.bsky.social",
      password: "app-pass-123",
    })
    expect(res.userInfo.id).toBe("did:plc:1")
    expect(res.userInfo.metadata?.did).toBe("did:plc:1")
    expect(res.accessToken).toBe("app-pass-123")
  })

  it("publishes a text post and builds the web URL", async () => {
    script = [
      { match: "createSession", json: { accessJwt: "jwt", did: "did:plc:1", handle: "me.bsky.social" } },
      { match: "createRecord", json: { uri: "at://did:plc:1/app.bsky.feed.post/abc123" } },
    ]
    const res = await blueskyProvider.publisher.publish(
      "app-pass-123",
      { action: "post-text", caption: "hello sky" },
      { service: "https://bsky.social", identifier: "me.bsky.social" },
    )
    expect(res.success).toBe(true)
    expect(res.platformPostUrl).toBe("https://bsky.app/profile/me.bsky.social/post/abc123")
  })

  it("rejects a bad login with a clear error", async () => {
    script = [{ match: "createSession", status: 401, json: { message: "Invalid identifier or password" } }]
    await expect(
      blueskyProvider.connectWithFields!({ service: "https://bsky.social", identifier: "x", password: "bad" }),
    ).rejects.toThrow("Invalid identifier or password")
  })
})

describe("devto", () => {
  it("connects with the api key and publishes an article", async () => {
    script = [
      { match: "/api/users/me", json: { id: 7, username: "dev" } },
      { match: "/api/articles", json: { id: 99, url: "https://dev.to/dev/x-99" } },
    ]
    const conn = await devtoProvider.connectWithFields!({ apiKey: "key-123456789" }) // gitleaks:allow — fake fixture
    expect(conn.userInfo.username).toBe("dev")

    const res = await devtoProvider.publisher.publish("key-123456789", {
      action: "post-text",
      title: "Hello",
      caption: "Body text",
      tags: ["Type Script", "ai"],
    }, {})
    expect(res).toMatchObject({ success: true, platformPostId: "99" })
    const body = JSON.parse(String(calls.at(-1)!.init?.body)) as { article: Record<string, unknown> }
    expect(body.article.tags).toEqual(["typescript", "ai"])
  })

  it("fails definitively without a title", async () => {
    const res = await devtoProvider.publisher.publish("k", { action: "post-text" }, {})
    expect(res.success).toBe(false)
  })
})

describe("hashnode", () => {
  it("connect resolves the publication id and refuses accounts without one", async () => {
    script = [{ match: "gql.hashnode.com", json: { data: { me: { id: "u1", username: "h", publications: { edges: [{ node: { id: "pub-1" } }] } } } } }]
    const conn = await hashnodeProvider.connectWithFields!({ apiKey: "tok-123456789" }) // gitleaks:allow — fake fixture
    expect(conn.userInfo.metadata?.publication_id).toBe("pub-1")

    script = [{ match: "gql.hashnode.com", json: { data: { me: { id: "u1", username: "h", publications: { edges: [] } } } } }]
    await expect(hashnodeProvider.connectWithFields!({ apiKey: "tok-123456789" })).rejects.toThrow(/no publication/) // gitleaks:allow — fake fixture
  })

  it("publishes via publishPost with the stored publication id", async () => {
    script = [{ match: "gql.hashnode.com", json: { data: { publishPost: { post: { id: "p1", url: "https://h.dev/p1" } } } } }]
    const res = await hashnodeProvider.publisher.publish(
      "tok",
      { action: "post-text", title: "T", caption: "body" },
      { publication_id: "pub-1" },
    )
    expect(res).toMatchObject({ success: true, platformPostUrl: "https://h.dev/p1" })
  })
})

describe("medium", () => {
  it("connects and publishes under the stored author id", async () => {
    script = [
      { match: "/v1/me", json: { data: { id: "au-1", username: "med" } } },
      { match: "/v1/users/au-1/posts", json: { data: { id: "po-1", url: "https://medium.com/p/po-1" } } },
    ]
    const conn = await mediumProvider.connectWithFields!({ apiKey: "integration-token" })
    expect(conn.userInfo.metadata?.author_id).toBe("au-1")

    const res = await mediumProvider.publisher.publish(
      "integration-token",
      { action: "post-text", title: "T", caption: "body" },
      { author_id: "au-1" },
    )
    expect(res).toMatchObject({ success: true, platformPostId: "po-1" })
  })
})

describe("wordpress", () => {
  it("connects with basic auth and publishes", async () => {
    script = [
      { match: "/wp-json/wp/v2/users/me", json: { id: 3, name: "Admin" } },
      { match: "/wp-json/wp/v2/posts", json: { id: 11, link: "https://blog.example/11" } },
    ]
    const conn = await wordpressProvider.connectWithFields!({
      domain: "https://blog.example",
      username: "admin",
      password: "app pass word",
    })
    expect(conn.userInfo.id).toBe("blog.example:3")

    const res = await wordpressProvider.publisher.publish(
      "app pass word",
      { action: "post-text", title: "T", caption: "body" },
      { domain: "https://blog.example", username: "admin" },
    )
    expect(res).toMatchObject({ success: true, platformPostUrl: "https://blog.example/11" })
    const auth = (calls.at(-1)!.init?.headers as Record<string, string>).Authorization
    expect(auth.startsWith("Basic ")).toBe(true)
  })
})

describe("lemmy", () => {
  it("connect validates login AND that the community exists", async () => {
    script = [
      { match: "/api/v3/user/login", json: { jwt: "jwt-1" } },
      { match: "/api/v3/community?name=technology", json: { community_view: { community: { id: 42 } } } },
    ]
    const conn = await lemmyProvider.connectWithFields!({
      service: "https://lemmy.world",
      identifier: "user",
      password: "pw-123",
      community: "technology",
    })
    expect(conn.userInfo.metadata?.community).toBe("technology")
  })

  it("publishes into the resolved community", async () => {
    script = [
      { match: "/api/v3/user/login", json: { jwt: "jwt-1" } },
      { match: "/api/v3/community?name=technology", json: { community_view: { community: { id: 42 } } } },
      { match: "/api/v3/post", json: { post_view: { post: { id: 7 } } } },
    ]
    const res = await lemmyProvider.publisher.publish(
      "pw-123",
      { action: "post-text", title: "T", caption: "body" },
      { service: "https://lemmy.world", identifier: "user", community: "technology" },
    )
    expect(res).toMatchObject({ success: true, platformPostUrl: "https://lemmy.world/post/7" })
    const postBody = JSON.parse(String(calls.at(-1)!.init?.body)) as Record<string, unknown>
    expect(postBody.community_id).toBe(42)
  })
})
