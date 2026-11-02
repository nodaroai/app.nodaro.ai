/**
 * What a world's address answered, in one place: only 404 and 410 are "not
 * found"; any other refusal is an error, never a missing page; a page that
 * came back "answers" — never "exists", since a site can send one page for
 * every address.
 */
import { describe, expect, it } from "vitest"
import { isNotFound, linkFace, linkVerdict, notFoundCount } from "../link-face"
import type { LinkAnswer, WorldLink } from "../types"

const answered = (code: number): LinkAnswer => ({ status: "answered", code })

describe("linkFace", () => {
  it.each([
    [200, "Answers", "newest"],
    [301, "Answers", "newest"],
    [399, "Answers", "newest"],
    [404, "Not found", "bad"],
    [410, "Not found", "bad"],
    [400, "Error", "behind"],
    [403, "Error", "behind"],
    [500, "Error", "behind"],
  ])("HTTP %i is %s", (code, label, tone) => {
    expect(linkFace(answered(code))).toEqual({ label, tone, detail: `HTTP ${code}` })
  })

  it("no answer keeps the reason", () => {
    expect(linkFace({ status: "no_answer", message: "No answer within 8 seconds." })).toEqual({ label: "No answer", tone: "off", detail: "No answer within 8 seconds." })
  })

  it("counts only the addresses that answered not found", () => {
    const world = (id: string, answer: LinkAnswer): WorldLink => ({ id, label: id, href: `https://example.com/${id}`, group: "simple", answer })
    const worlds = [world("a", answered(404)), world("b", answered(410)), world("c", answered(500)), world("d", { status: "no_answer", message: "x" }), world("e", answered(200))]
    expect(notFoundCount(worlds)).toBe(2)
    expect(isNotFound({ status: "no_answer", message: "x" })).toBe(false)
  })
})

describe("linkVerdict", () => {
  const world = (id: string, answer: LinkAnswer): WorldLink => ({ id, label: id, href: `https://example.com/${id}`, group: "simple", answer })

  it("all is well only when every address answered", () => {
    expect(linkVerdict([world("a", answered(200)), world("b", answered(302))])).toEqual({ text: "No address answers “not found”.", tone: "newest" })
  })

  it("addresses never checked are counted, never folded into all is well", () => {
    // A blocked outbound request, or a bot check refusing the server: nothing was learned about those pages.
    expect(linkVerdict([world("a", answered(200)), world("b", answered(403)), world("c", { status: "no_answer", message: "x" })])).toEqual({
      text: "2 of 3 could not be checked.",
      tone: "behind",
    })
  })

  it("not found leads, and the unchecked are said beside it", () => {
    expect(linkVerdict([world("a", answered(404)), world("b", answered(500)), world("c", answered(200))])).toEqual({
      text: "1 of 3 addresses answer “not found”; 1 of 3 could not be checked.",
      tone: "bad",
    })
    expect(linkVerdict([world("a", answered(404)), world("b", answered(200))])).toEqual({ text: "1 of 2 addresses answer “not found”.", tone: "bad" })
  })
})
