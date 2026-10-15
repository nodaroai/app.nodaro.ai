import { describe, it, expect, vi, afterEach } from "vitest"
import { table, terminalSafe } from "../output.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("terminalSafe", () => {
  it("keeps ordinary text, Unicode included", () => {
    expect(terminalSafe("orders → 200 OK — ünïcode 😀")).toBe("orders → 200 OK — ünïcode 😀")
  })

  it("replaces every control character a terminal could act on (escape sequences, bells, C1)", () => {
    const out = terminalSafe("a\u001b[2Jb\u001b]8;;https://evil.example\u0007c\u009bd\re\nf\tg\u007f")
    expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(out.replace(/�/g, "")).toBe("a[2Jb]8;;https://evil.examplecdefg")
  })
})

describe("table", () => {
  it("never prints a server's string raw: control characters are replaced", () => {
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    table([{ url: "https://x.example/\u001b]0;pwned\u0007", note: "fine" }], ["url", "note"])
    const printed = lines.join("\n")
    expect(printed).toContain("https://x.example/")
    expect(printed).not.toMatch(/\u001b\]0;pwned/)
    expect(lines.at(-1)).not.toMatch(/[\u0007\u001b]/)
  })
})
