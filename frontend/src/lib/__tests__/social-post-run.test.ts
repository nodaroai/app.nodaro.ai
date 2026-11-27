// @vitest-environment node
import { describe, expect, it } from "vitest"
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared/social"
import { isSocialPostNodeType, socialPostRunFields } from "../social-post-run"

const POST = { platformPostId: "17890001", platformPostUrl: "https://www.instagram.com/p/ABC123/" }

describe("socialPostRunFields", () => {
  it.each([...SOCIAL_POST_NODE_TYPES])("lands the post's link and id on a %s node", (type) => {
    expect(socialPostRunFields(type, POST)).toEqual(POST)
  })

  it("writes nothing on a node that is not a social post", () => {
    expect(socialPostRunFields("generate-image", POST)).toEqual({})
    expect(socialPostRunFields(undefined, POST)).toEqual({})
  })

  it("clears an earlier run's link when this run's post has none (a platform that gives only an id)", () => {
    expect(socialPostRunFields("telegram-post", { platformPostId: "42" })).toEqual({ platformPostId: "42", platformPostUrl: undefined })
  })

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "not a url"])("never writes %s as the link", (link) => {
    expect(socialPostRunFields("publish-social", { platformPostId: "9", platformPostUrl: link })).toEqual({
      platformPostId: "9",
      platformPostUrl: undefined,
    })
  })

  it("reads no link out of what is not a string", () => {
    expect(socialPostRunFields("facebook-post", { platformPostId: 7, platformPostUrl: { href: "x" } })).toEqual({
      platformPostId: undefined,
      platformPostUrl: undefined,
    })
    expect(socialPostRunFields("facebook-post", null)).toEqual({})
  })
})

describe("isSocialPostNodeType", () => {
  it("is the shared list of nodes that publish", () => {
    expect(isSocialPostNodeType("instagram-post")).toBe(true)
    expect(isSocialPostNodeType("publish-social")).toBe(true)
    expect(isSocialPostNodeType("instagram-scrape")).toBe(false)
  })
})
