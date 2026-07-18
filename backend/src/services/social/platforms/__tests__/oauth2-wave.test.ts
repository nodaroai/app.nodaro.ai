import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

const SAVED = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "DISCORD_BOT_TOKEN", "TWITCH_CLIENT_ID", "MASTODON_URL"] as const
const savedEnv: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of SAVED) savedEnv[k] = process.env[k]
})
afterEach(() => {
  for (const k of SAVED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

import { exchangeCodeForTokens } from "../../oauth.js"
import { discordProvider } from "../../providers/discord.js"
import { mastodonProvider } from "../../providers/mastodon.js"
import { pinterestProvider } from "../../providers/pinterest.js"
import { redditProvider } from "../../providers/reddit.js"
import { threadsProvider } from "../../providers/threads.js"
import { twitchProvider } from "../../providers/twitch.js"

describe("reddit", () => {
  it("token exchange sends client creds as HTTP Basic (tokenAuth: basic)", async () => {
    process.env.REDDIT_CLIENT_ID = "rid"
    process.env.REDDIT_CLIENT_SECRET = "rsec"
    script = [{ match: "access_token", json: { access_token: "at", refresh_token: "rt", expires_in: 3600 } }]

    await exchangeCodeForTokens(redditProvider, "code-1")
    const init = calls.at(-1)!.init!
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("rid:rsec").toString("base64")}`)
    expect(String(init.body)).not.toContain("client_secret")
  })

  it("submits a self post to the first-tag subreddit", async () => {
    script = [{ match: "api/submit", json: { json: { errors: [], data: { id: "t3_1", url: "https://reddit.com/r/test/1" } } } }]
    const res = await redditPublisherPublish({ action: "post-text", title: "T", caption: "body", tags: ["test"] })
    expect(res).toMatchObject({ success: true, platformPostId: "t3_1" })
    const body = String(calls.at(-1)!.init?.body)
    expect(body).toContain("sr=test")
    expect(body).toContain("kind=self")
  })

  it("fails definitively without a subreddit", async () => {
    const res = await redditPublisherPublish({ action: "post-text", title: "T" })
    expect(res.success).toBe(false)
  })
})

function redditPublisherPublish(request: Parameters<typeof redditProvider.publisher.publish>[1]) {
  return redditProvider.publisher.publish("tok", request, {})
}

describe("pinterest", () => {
  it("resolves the first board at connect and pins onto it", async () => {
    script = [
      { match: "user_account", json: { id: "u1", username: "pin" } },
      { match: "boards?page_size=1", json: { items: [{ id: "board-1" }] } },
      { match: "/v5/pins", json: { id: "pin-1" } },
    ]
    const info = await pinterestProvider.fetchUserInfo!("tok")
    expect(info.metadata?.default_board).toBe("board-1")

    const res = await pinterestProvider.publisher.publish(
      "tok",
      { action: "post-image", mediaUrl: "https://cdn.test/i.png", title: "T" },
      { default_board: "board-1" },
    )
    expect(res).toMatchObject({ success: true, platformPostUrl: "https://www.pinterest.com/pin/pin-1/" })
  })

  it("refuses to pin without an image", async () => {
    const res = await pinterestProvider.publisher.publish("tok", { action: "post-text", caption: "x" }, { default_board: "b" })
    expect(res.success).toBe(false)
  })
})

describe("discord", () => {
  it("sends AS THE BOT into the chatId channel", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot-tok"
    script = [{ match: "/channels/chan-1/messages", json: { id: "m1", channel_id: "chan-1" } }]

    const res = await discordProvider.publisher.publish(
      "user-oauth-token",
      { action: "send-message", caption: "hello" },
      { chatId: "chan-1" },
    )
    expect(res.success).toBe(true)
    const headers = calls.at(-1)!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bot bot-tok")
  })

  it("fails clearly when the bot token env is missing", async () => {
    delete process.env.DISCORD_BOT_TOKEN
    const res = await discordProvider.publisher.publish("t", { action: "send-message", caption: "x" }, { chatId: "c" })
    expect(res.success).toBe(false)
    expect(res.error).toContain("DISCORD_BOT_TOKEN")
  })
})

describe("twitch", () => {
  it("sends a chat message to the user's own channel with the Client-Id header", async () => {
    process.env.TWITCH_CLIENT_ID = "tcid"
    script = [{ match: "chat/messages", json: { data: [{ message_id: "mm", is_sent: true }] } }]

    const res = await twitchProvider.publisher.publish(
      "tok",
      { action: "send-message", caption: "live now!" },
      { broadcaster_id: "b-1" },
    )
    expect(res).toMatchObject({ success: true, platformPostId: "mm" })
    const headers = calls.at(-1)!.init?.headers as Record<string, string>
    expect(headers["Client-Id"]).toBe("tcid")
  })
})

describe("threads", () => {
  it("container -> publish flow", async () => {
    script = [
      { match: "/threads?", json: { id: "cont-1" } },
      { match: "threads_publish", json: { id: "post-1" } },
    ]
    const res = await threadsProvider.publisher.publish(
      "tok",
      { action: "post-text", caption: "hi threads" },
      { threads_user_id: "tu-1" },
    )
    expect(res).toMatchObject({ success: true, platformPostId: "post-1" })
  })

  it("customRefresh hits th_refresh_token and reuses the token as its own refresh credential", async () => {
    script = [{ match: "th_refresh_token", json: { access_token: "fresh", expires_in: 100 } }]
    const refreshed = await threadsProvider.oauth!.customRefresh!("old-token")
    expect(refreshed).toEqual({ accessToken: "fresh", refreshToken: "fresh", expiresIn: 100 })
  })
})

describe("mastodon", () => {
  it("auth/token URLs derive from MASTODON_URL at call time", async () => {
    process.env.MASTODON_URL = "https://fosstodon.org"
    const authUrl = mastodonProvider.oauth!.authUrl as () => string
    expect(authUrl()).toBe("https://fosstodon.org/oauth/authorize")
  })

  it("publishes a status to the CONNECTION's service host, not env", async () => {
    process.env.MASTODON_URL = "https://mastodon.social"
    script = [{ match: "myinstance.dev/api/v1/statuses", json: { id: "s1", url: "https://myinstance.dev/@u/1" } }]

    const res = await mastodonProvider.publisher.publish(
      "tok",
      { action: "post-text", caption: "toot" },
      { service: "https://myinstance.dev" },
    )
    expect(res).toMatchObject({ success: true, platformPostId: "s1" })
  })
})
