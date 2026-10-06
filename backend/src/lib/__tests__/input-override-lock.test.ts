/**
 * The run-request override lock (issue #1555): a run's `inputOverrides` may set
 * ordinary fields anywhere and destination fields on ordinary nodes, but never
 * a destination on an outbound node.
 */
import { describe, expect, it } from "vitest"
import {
  LockedOverrideError,
  assertNoLockedOverrides,
  describeLockedOverrides,
  findLockedOverrides,
} from "../input-override-lock.js"
import { isLockedField, lockedFieldPaths } from "../outbound-node-lock.js"

const GRAPH = [
  { id: "hook-1", type: "webhook-output" },
  { id: "tg-1", type: "telegram-post" },
  { id: "scrape-1", type: "web-scrape" },
  { id: "img-1", type: "upload-image" },
  { id: "gen-1", type: "generate-image" },
  { id: "untyped" },
]

describe("findLockedOverrides — what a run request may not re-point", () => {
  it("refuses the url of a Webhook Output (the published-app exfiltration path)", () => {
    expect(findLockedOverrides(GRAPH, { "hook-1": { url: "https://attacker.example/collect" } })).toEqual([
      { nodeId: "hook-1", nodeType: "webhook-output", field: "url", kind: "outbound" },
    ])
  })

  it("refuses a publisher's destination and a fetcher's target alike", () => {
    expect(findLockedOverrides(GRAPH, { "tg-1": { chatId: "@attacker" } })).toEqual([
      { nodeId: "tg-1", nodeType: "telegram-post", field: "chatId", kind: "outbound" },
    ])
    expect(findLockedOverrides(GRAPH, { "scrape-1": { target: "https://attacker.example/?q=x" } })).toEqual([
      { nodeId: "scrape-1", nodeType: "web-scrape", field: "target", kind: "outbound" },
    ])
  })

  it("refuses the stored-credential reference the HTTP-credentials plan adds", () => {
    // `credentialId` is not `*Url`-shaped; it decides WHOSE key travels with
    // the request, so it is locked by name (plan D9).
    expect(isLockedField("credentialId")).toBe(true)
    expect(findLockedOverrides(GRAPH, { "hook-1": { credentialId: "11111111-1111-4111-8111-111111111111" } })).toEqual([
      { nodeId: "hook-1", nodeType: "webhook-output", field: "credentialId", kind: "outbound" },
    ])
  })

  it("walks nested objects and lists — a destination hidden one level down still counts", () => {
    expect(
      findLockedOverrides(GRAPH, {
        "hook-1": { probedVideo: { url: "https://attacker.example/x.mp4" } },
      }),
    ).toEqual([{ nodeId: "hook-1", nodeType: "webhook-output", field: "probedVideo.url", kind: "outbound" }])
    expect(
      findLockedOverrides(GRAPH, {
        "tg-1": { extraRefs: [{ kind: "image" }, { url: "https://attacker.example/a.png" }] },
      }),
    ).toEqual([{ nodeId: "tg-1", nodeType: "telegram-post", field: "extraRefs[1].url", kind: "outbound" }])
  })

  it("reports a locked list field once, whatever it holds", () => {
    expect(findLockedOverrides(GRAPH, { "tg-1": { imageUrls: ["https://a.example/1.png", "https://a.example/2.png"] } })).toEqual([
      { nodeId: "tg-1", nodeType: "telegram-post", field: "imageUrls", kind: "outbound" },
    ])
  })

  it("leaves ordinary fields on an outbound node alone — a caption or a limit is a legitimate input", () => {
    expect(findLockedOverrides(GRAPH, { "tg-1": { text: "hello world" }, "scrape-1": { maxItems: 5 } })).toEqual([])
  })

  it("leaves destination-shaped fields on ORDINARY nodes alone — an upload's url IS the app input", () => {
    expect(
      findLockedOverrides(GRAPH, {
        "img-1": { url: "https://cdn.example/runner-photo.png" },
        "gen-1": { referenceImageUrls: ["https://cdn.example/ref.png"], prompt: "a cat" },
      }),
    ).toEqual([])
  })

  it("refuses a BLANKED destination too — the merge writes the empty value, and a fetcher then reads the upstream text", () => {
    // `{ ...data, ...overrides }` with `url: ""` erases the author's URL; every
    // outbound fetcher falls back to the upstream text for an empty field, and
    // a run request can supply that text. Presence is the violation.
    expect(
      findLockedOverrides(GRAPH, { "scrape-1": { url: "", target: null, query: "" } }).map((f) => f.field).sort(),
    ).toEqual(["query", "target", "url"])
    expect(findLockedOverrides(GRAPH, { "tg-1": { imageUrls: [] } })).toEqual([
      { nodeId: "tg-1", nodeType: "telegram-post", field: "imageUrls", kind: "outbound" },
    ])
  })

  it("ignores node ids that are not in the graph, untyped nodes and non-object entries", () => {
    expect(
      findLockedOverrides(GRAPH, {
        ghost: { url: "https://attacker.example/" },
        untyped: { url: "https://attacker.example/" },
        "hook-1": "https://attacker.example/" as unknown as Record<string, unknown>,
      }),
    ).toEqual([])
  })

  it("is total over the whole map — every violation is reported, none is dropped", () => {
    const found = findLockedOverrides(GRAPH, {
      "hook-1": { url: "https://attacker.example/a" },
      "tg-1": { chatId: "@attacker", text: "fine" },
      "img-1": { url: "https://cdn.example/fine.png" },
    })
    expect(found.map((f) => `${f.nodeId}.${f.field}`).sort()).toEqual(["hook-1.url", "tg-1.chatId"])
  })

  it("handles absent inputs", () => {
    expect(findLockedOverrides(GRAPH, undefined)).toEqual([])
    expect(findLockedOverrides(undefined, { "hook-1": { url: "https://attacker.example/" } })).toEqual([])
  })
})

describe("findLockedOverrides — review follow-ups", () => {
  it("refuses Instagram Scrape's plural targets list", () => {
    // `data.targets` (profiles / hashtags) — plural, so neither `*Url` nor
    // `target` matched it; the derivation test now holds the field lock to
    // every destination key an executor reads.
    expect(isLockedField("targets")).toBe(true)
    expect(findLockedOverrides([{ id: "ig-1", type: "instagram-scrape" }], { "ig-1": { targets: "victimprofile" } })).toEqual([
      { nodeId: "ig-1", nodeType: "instagram-scrape", field: "targets", kind: "outbound" },
    ])
  })

  it("refuses the selector keys that pick WHICH destination field a fetcher reads — on outbound nodes only", () => {
    // Flipping `actor` to a branch whose own field is empty aims the fetch at
    // the upstream text (each branch falls back to it).
    expect(findLockedOverrides([{ id: "ws-1", type: "web-scrape" }], { "ws-1": { actor: "content-crawler" } })).toEqual([
      { nodeId: "ws-1", nodeType: "web-scrape", field: "actor", kind: "outbound" },
    ])
    expect(findLockedOverrides([{ id: "ads-1", type: "meta-ads-scrape" }], { "ads-1": { mode: "search" } })).toEqual([
      { nodeId: "ads-1", nodeType: "meta-ads-scrape", field: "mode", kind: "outbound" },
    ])
    // `mode` is an ordinary key everywhere else — not part of the copilot-wide
    // field lock, and free on a node that is not outbound.
    expect(isLockedField("mode")).toBe(false)
    expect(findLockedOverrides([{ id: "v-1", type: "generate-video" }], { "v-1": { mode: "i2v", actor: "x" } })).toEqual([])
  })

  it("looks nodes up exactly as the merge does — a numeric id coerces the same way on both sides", () => {
    const nodes = [{ id: 7 as unknown as string, type: "webhook-output" }]
    expect(findLockedOverrides(nodes, { "7": { url: "https://attacker.example/" } })).toEqual([
      { nodeId: "7", nodeType: "webhook-output", field: "url", kind: "outbound" },
    ])
  })

  it("checks EVERY node that carries a duplicated id, because the merge writes to every one of them", () => {
    const nodes = [
      { id: "dup", type: "text-prompt" },
      { id: "dup", type: "webhook-output" },
    ]
    expect(findLockedOverrides(nodes, { dup: { url: "https://attacker.example/" } })).toEqual([
      { nodeId: "dup", nodeType: "webhook-output", field: "url", kind: "outbound" },
    ])
    // Two outbound holders of one id report once, not twice.
    const twice = [
      { id: "dup", type: "webhook-output" },
      { id: "dup", type: "webhook-output" },
    ]
    expect(findLockedOverrides(twice, { dup: { url: "https://attacker.example/" } })).toHaveLength(1)
  })

  it("walks lists nested inside lists", () => {
    expect(lockedFieldPaths({ refs: [[{ url: "https://attacker.example/x.png" }]] })).toEqual(["refs[0][0].url"])
  })

  it("refuses Meta Ads' advertisers LIST whatever it holds — the empty list is the blanking lever", () => {
    // Blank the picks and the executor resolves the names in the upstream text
    // (`metaAdsScrapeWireSources`, "advertiser" mode) — a container is a
    // destination, not just the urls inside it.
    const node = [{ id: "ads-1", type: "meta-ads-scrape" }]
    for (const value of [[], null, [{ pageId: "1", name: "x" }], [{ name: "x", url: "https://attacker.example/p" }]]) {
      expect(findLockedOverrides(node, { "ads-1": { advertisers: value } }), JSON.stringify(value)).toEqual([
        { nodeId: "ads-1", nodeType: "meta-ads-scrape", field: "advertisers", kind: "outbound" },
      ])
    }
    // Ordinary keys on that node stay free.
    expect(findLockedOverrides(node, { "ads-1": { limit: 5 } })).toEqual([])
  })

  it("clips a path without cutting inside a character", () => {
    const emoji = "😀".repeat(300) + ".url"
    const message = describeLockedOverrides([{ nodeId: "hook-1", nodeType: "webhook-output", field: emoji }])
    expect(message).not.toMatch(/[�-�](?![�-�])/)
  })

  it("refuses a destination or a selector reached through fieldMappings — the run-time wire that rewrites node data", () => {
    // `node-executor` copies a source node's output onto `data.<field>` for
    // every key in `fieldMappings` before the executor reads the destination.
    expect(
      findLockedOverrides([{ id: "ads-1", type: "meta-ads-scrape" }], {
        "ads-1": { fieldMappings: { url: { sourceNodeId: "text-1" }, mode: { sourceNodeId: "text-1" } } },
      }).map((f) => f.field).sort(),
    ).toEqual(["fieldMappings.mode", "fieldMappings.url"])
    // A selector nested anywhere is refused like a nested url.
    expect(findLockedOverrides([{ id: "ws-1", type: "web-scrape" }], { "ws-1": { config: { actor: "rss" } } })).toEqual([
      { nodeId: "ws-1", nodeType: "web-scrape", field: "config.actor", kind: "outbound" },
    ])
  })

  it("keeps the refusal message bounded — ten spelled out, the rest counted, paths clipped", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      nodeId: "hook-1",
      nodeType: "webhook-output",
      field: `cfg${i}.url`,
    }))
    const message = describeLockedOverrides(many)
    expect(message).toContain('"cfg9.url" on webhook-output node "hook-1"')
    expect(message).not.toContain("cfg10.url")
    expect(message).toContain("and 2 more")
    const longPath = { nodeId: "hook-1", nodeType: "webhook-output", field: "x".repeat(500) + ".url" }
    expect(describeLockedOverrides([longPath]).length).toBeLessThan(400)
  })

  it("refuses instead of overflowing on a pathologically deep override", () => {
    let deep: Record<string, unknown> = { prompt: "innocent" }
    for (let i = 0; i < 200; i++) deep = { wrap: deep }
    let found: ReturnType<typeof findLockedOverrides> = []
    expect(() => {
      found = findLockedOverrides([{ id: "hook-1", type: "webhook-output" }], { "hook-1": deep })
    }).not.toThrow()
    expect(found).toHaveLength(1)
    expect(found[0]!.field.startsWith("wrap.wrap.")).toBe(true)
  })
})

describe("assertNoLockedOverrides / the message", () => {
  it("throws a LockedOverrideError carrying code locked_field and every violation", () => {
    let caught: unknown
    try {
      assertNoLockedOverrides(GRAPH, { "hook-1": { url: "https://attacker.example/" } })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LockedOverrideError)
    const error = caught as LockedOverrideError
    expect(error.code).toBe("locked_field")
    expect(error.locked).toEqual([{ nodeId: "hook-1", nodeType: "webhook-output", field: "url", kind: "outbound" }])
  })

  it("does not throw when nothing is locked", () => {
    expect(() => assertNoLockedOverrides(GRAPH, { "img-1": { url: "https://cdn.example/x.png" } })).not.toThrow()
  })

  it("names the field, node type and node id — and never the value", () => {
    const message = describeLockedOverrides([{ nodeId: "hook-1", nodeType: "webhook-output", field: "url", kind: "outbound" }])
    expect(message).toContain('"url" on webhook-output node "hook-1"')
    expect(message).not.toContain("attacker")
    expect(message).not.toContain("http")
  })
})

describe("lockedFieldPaths", () => {
  it("returns dotted paths for nested destinations and indexes for lists of objects", () => {
    expect(
      lockedFieldPaths({
        prompt: "fine",
        config: { endpoint: "https://a.example", nested: { chatId: "@x" } },
        refs: [{ label: "a" }, { url: "https://a.example/b" }],
      }).sort(),
    ).toEqual(["config.endpoint", "config.nested.chatId", "refs[1].url"])
  })

  it("does not descend into a locked key's own value", () => {
    expect(lockedFieldPaths({ webhook: { url: "https://a.example" } })).toEqual(["webhook"])
  })
})
