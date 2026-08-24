/**
 * The one denial a user is allowed to lift, and everything that stays.
 *
 * A publisher posts under an account the user already connected, so the harm
 * ceiling is unwanted content on their own timeline — recoverable, and theirs to
 * accept. A webhook or a scraper names an arbitrary host in node data, so the
 * harm ceiling is their private media arriving at someone else's server. Those
 * are different in kind, and no toggle should be able to blur them.
 */
import { describe, expect, it } from "vitest"
import {
  DENIED_NODE_TYPES,
  SOCIAL_PUBLISHER_TYPES,
  changedLockedUrlFields,
  isDeniedNodeType,
} from "../tools/deny-lists.js"

/** Denied types that name their own destination — never liftable. */
const NEVER_LIFTABLE = [
  "webhook-output",
  "web-scrape",
  "rss-feed",
  "telegram-channel-feed",
  "youtube-video",
]

describe("the publishing exemption", () => {
  it("changes nothing until the user turns it on", () => {
    for (const type of SOCIAL_PUBLISHER_TYPES) {
      expect(isDeniedNodeType(type), `${type} should be denied by default`).toBe(true)
      expect(isDeniedNodeType(type, {})).toBe(true)
      expect(isDeniedNodeType(type, { allowPublishing: false })).toBe(true)
    }
  })

  it("lets a publisher through once they do", () => {
    for (const type of SOCIAL_PUBLISHER_TYPES) {
      expect(isDeniedNodeType(type, { allowPublishing: true }), `${type} should be allowed`).toBe(false)
    }
  })

  it.each(NEVER_LIFTABLE)("%s stays denied even with the toggle on", (type) => {
    // These name an arbitrary host in node data. That is exfiltration, not
    // embarrassment, and no per-thread choice reaches it.
    expect(isDeniedNodeType(type, { allowPublishing: true })).toBe(true)
  })

  it("the publishers are a SUBSET of the denied set, not a replacement for it", () => {
    // `DENIED_NODE_TYPES` is derived from the orchestrator's executor by
    // `deny-lists.test.ts`. Shrinking it would mean a genuinely outbound node
    // had quietly stopped being covered — so the exemption is a second set.
    for (const type of SOCIAL_PUBLISHER_TYPES) {
      expect(DENIED_NODE_TYPES.has(type), `${type} missing from DENIED_NODE_TYPES`).toBe(true)
    }
    expect(SOCIAL_PUBLISHER_TYPES.has("webhook-output")).toBe(false)
    expect(SOCIAL_PUBLISHER_TYPES.size).toBeLessThan(DENIED_NODE_TYPES.size)
  })
})

describe("what the copilot still may not write on a publisher", () => {
  const before = undefined

  it.each(["connectionId", "chatId", "channel", "platform"])("%s — where it goes", (field) => {
    expect(changedLockedUrlFields(before, { [field]: "somewhere-else" })).toContain(field)
  })

  it("privacy — who can see it", () => {
    // Not a destination, and locked anyway. Publishing nodes default to
    // `private`, so once the copilot can author one, this single word is the
    // difference between a draft the user reviews and a post the world sees.
    expect(changedLockedUrlFields(before, { privacy: "public" })).toContain("privacy")
  })

  it("but the content IS the copilot's to write", () => {
    // The whole point: it builds the post, the user owns where it goes.
    expect(changedLockedUrlFields(before, { caption: "a new drop", title: "Ep 4", tags: ["x"] })).toEqual([])
  })

  it("preserves a destination the user already set", () => {
    // Echoing back what is already on the node is not a change, or the model
    // could never patch a publisher the user configured.
    const stored = { connectionId: "conn-1", chatId: "@mychannel", privacy: "private" }
    expect(changedLockedUrlFields(stored, { ...stored, caption: "new words" })).toEqual([])
  })
})
