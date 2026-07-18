import { describe, it, expect } from "vitest"
import { parseJsonOrThrow } from "../safe-json.js"

function res(body: string, status = 200): Response {
  return {
    status,
    text: async () => body,
  } as unknown as Response
}

describe("parseJsonOrThrow", () => {
  it("parses valid JSON", async () => {
    expect(await parseJsonOrThrow<{ a: number }>(res('{"a":1}'), "X")).toEqual({ a: 1 })
  })

  it("NEVER leaks a raw parser error on an HTML body — the connect/publish bug", async () => {
    const html = "<!DOCTYPE html><html><body>error</body></html>"
    await expect(parseJsonOrThrow(res(html, 500), "Hashnode")).rejects.toThrow(/Hashnode returned an unexpected/i)
    // The raw 'Unexpected token' must not reach the caller.
    await expect(parseJsonOrThrow(res(html, 500), "Hashnode")).rejects.not.toThrow(/Unexpected token/i)
  })

  it("maps auth failures to a credential message", async () => {
    await expect(parseJsonOrThrow(res("<html>401</html>", 401), "Dev.to")).rejects.toThrow(/rejected the credential/i)
  })

  it("maps rate limits to a retry message", async () => {
    await expect(parseJsonOrThrow(res("<html>429</html>", 429), "Lemmy")).rejects.toThrow(/rate/i)
  })
})
