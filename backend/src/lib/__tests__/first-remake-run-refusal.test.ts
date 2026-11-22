/**
 * A running first Remake run (or the workflow/project holding it) the database
 * refused to trash or delete answers 409 with its own code and a fixed
 * sentence, from every route that hands the error to `sendInternalError`
 * (the job trash, the workflow and project deletes) — never a 500, never the
 * database's text.
 */
import { describe, expect, it, vi } from "vitest"
import { firstRemakeRunRefusal } from "../first-remake-run-refusal.js"
import { sendInternalError } from "../http-errors.js"

function reply() {
  const sent: Array<{ status: number; body: unknown }> = []
  const r = { status: (code: number) => ({ send: (body: unknown) => { sent.push({ status: code, body }); return r } }) }
  return { r, sent }
}
const req = { log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, id: "req-1", url: "/x", method: "DELETE" }

describe("firstRemakeRunRefusal", () => {
  it("maps the trash / direct delete refusal", () => {
    expect(firstRemakeRunRefusal({ message: "FIRST_REMAKE_RUN_ACTIVE: job 123 is a running first Remake" })).toEqual({
      statusCode: 409,
      body: { error: { code: "first_remake_run_active", message: expect.stringContaining("first Remake") } },
    })
  })
  it("maps the cascade refusal, behind the delete helpers' lead", () => {
    expect(firstRemakeRunRefusal(new Error("Failed to delete workflow: FIRST_REMAKE_RUN_HELD: this holds the running first Remake run 123"))?.body.error.code).toBe(
      "first_remake_run_held",
    )
  })
  it("never forwards the database's text, and matches nothing else", () => {
    const r = firstRemakeRunRefusal({ message: "FIRST_REMAKE_RUN_ACTIVE: job 1234-secret" })
    expect(JSON.stringify(r)).not.toContain("1234-secret")
    expect(firstRemakeRunRefusal({ message: "something FIRST_REMAKE_RUN_ACTIVE: x" })).toBeNull()
    expect(firstRemakeRunRefusal(new Error("boom"))).toBeNull()
    expect(firstRemakeRunRefusal(undefined)).toBeNull()
  })
})

describe("sendInternalError", () => {
  it("answers the refusal as a 409", () => {
    const { r, sent } = reply()
    sendInternalError(r as never, req as never, new Error("Failed to delete project: FIRST_REMAKE_RUN_HELD: x"), "Failed to delete project")
    expect(sent).toEqual([{ status: 409, body: { error: { code: "first_remake_run_held", message: expect.any(String) } } }])
  })
})
