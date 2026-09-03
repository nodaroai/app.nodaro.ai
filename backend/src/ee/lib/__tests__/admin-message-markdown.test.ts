/**
 * The escape-then-build contract. Every case here is a way an admin's typed
 * text could otherwise have reached a stranger's inbox as live markup.
 */
import { describe, it, expect } from "vitest"
import {
  escapeHtml,
  isSafeLinkUrl,
  normalizeLinkUrl,
  renderAdminMessageBody,
  sanitizeHeaderText,
} from "../admin-message-markdown.js"

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;")
  })

  it("escapes the ampersand FIRST so escapes are not double-encoded into nonsense", () => {
    // If & were escaped last, "<" would become "&lt;" and then "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;")
  })
})

describe("isSafeLinkUrl", () => {
  it.each(["https://nodaro.ai", "http://localhost:3000/x?a=1&b=2"])("allows %s", (u) => {
    expect(isSafeLinkUrl(u)).toBe(true)
  })

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("refuses %s", (u) => {
    expect(isSafeLinkUrl(u)).toBe(false)
  })

  it("refuses a scheme split across a newline (defeats a regex, not a parser)", () => {
    expect(isSafeLinkUrl("java\nscript:alert(1)")).toBe(false)
  })
})

describe("renderAdminMessageBody", () => {
  it("escapes markup an admin pasted", () => {
    const out = renderAdminMessageBody('<script>alert("x")</script>')
    expect(out).not.toContain("<script>")
    expect(out).toContain("&lt;script&gt;")
  })

  it("turns [label](url) into an anchor", () => {
    const out = renderAdminMessageBody("See [your run](https://app.nodaro.ai/runs/1) please")
    expect(out).toContain('<a href="https://app.nodaro.ai/runs/1"')
    expect(out).toContain(">your run</a>")
  })

  it("escapes the LABEL too — a link is not a hole in the escaping", () => {
    const out = renderAdminMessageBody("[<img onerror=x>](https://nodaro.ai)")
    expect(out).not.toContain("<img")
    expect(out).toContain("&lt;img")
  })

  it("drops the link but keeps the words for a refused scheme", () => {
    const out = renderAdminMessageBody("[click me](javascript:alert(1))")
    expect(out).not.toContain("<a ")
    expect(out).toContain("click me")
  })

  it("cannot be tricked into an attribute break via a quote in the URL", () => {
    // The quote was escaped to &quot; before the anchor was built, so it can
    // never close href="" — this is escape-then-build doing its job.
    const out = renderAdminMessageBody('[x](https://nodaro.ai/a"onmouseover="alert(1))')
    expect(out).not.toContain('onmouseover="alert(1)"')
    expect(out).toContain("&quot;")
  })

  it("renders single newlines as <br /> and blank lines as a paragraph gap", () => {
    expect(renderAdminMessageBody("a\nb")).toBe("a<br />b")
    expect(renderAdminMessageBody("a\n\nb")).toBe("a<br /><br />b")
  })

  it("handles CRLF the same as LF (admins paste from Windows)", () => {
    expect(renderAdminMessageBody("a\r\nb")).toBe("a<br />b")
    expect(renderAdminMessageBody("a\r\n\r\nb")).toBe("a<br /><br />b")
  })

  it("collapses a run of blank lines rather than emitting empty paragraphs", () => {
    expect(renderAdminMessageBody("a\n\n\n\nb")).toBe("a<br /><br />b")
  })

  it("leaves an unmatched bracket as literal text", () => {
    expect(renderAdminMessageBody("costs [50] credits")).toBe("costs [50] credits")
  })

  it("renders several links in one paragraph", () => {
    const out = renderAdminMessageBody("[a](https://a.test) and [b](https://b.test)")
    expect(out.match(/<a /g)).toHaveLength(2)
  })
})


describe("normalizeLinkUrl", () => {
  it("returns the CANONICAL url, not the string it was handed", () => {
    // The whole reason this is not a predicate. `new URL()` accepts a quote and
    // percent-encodes it; a boolean answer would let the raw form through to a
    // sink that does not escape.
    const out = normalizeLinkUrl('https://ok.test/a"><b>owned</b><a href="')
    expect(out).not.toBeNull()
    expect(out).not.toContain('"')
    expect(out).not.toContain("<")
    expect(out).toContain("%22")
  })

  it("encodes a space rather than accepting it", () => {
    expect(normalizeLinkUrl("https://ok.test/a b")).toBe("https://ok.test/a%20b")
  })

  it("returns null for every non-http scheme", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "nope"]) {
      expect(normalizeLinkUrl(u), u).toBeNull()
    }
  })

  it("is what isSafeLinkUrl is built on, so the two can never disagree", () => {
    for (const u of ["https://a.test", "javascript:x", "", "http://b.test/x?y=1&z=2"]) {
      expect(isSafeLinkUrl(u), u).toBe(normalizeLinkUrl(u) !== null)
    }
  })
})

describe("sanitizeHeaderText", () => {
  const CR = String.fromCharCode(13)
  const LF = String.fromCharCode(10)
  const NUL = String.fromCharCode(0)
  const DEL = String.fromCharCode(127)

  it("removes the CRLF that would forge a mail header", () => {
    expect(sanitizeHeaderText(`Hello${CR}${LF}Bcc: victim@x.test`)).toBe("Hello Bcc: victim@x.test")
  })

  it("removes every other control character too, including NUL and DEL", () => {
    expect(sanitizeHeaderText(`a${NUL}b${DEL}c`)).toBe("a b c")
  })

  it("does NOT escape html — a subject line is not markup", () => {
    expect(sanitizeHeaderText("Nodaro & you <3")).toBe("Nodaro & you <3")
  })

  it("collapses the runs it creates and trims the edges", () => {
    expect(sanitizeHeaderText(`  a${LF}${LF}${LF}b  `)).toBe("a b")
  })

  it("leaves ordinary text untouched", () => {
    expect(sanitizeHeaderText("About your recent run")).toBe("About your recent run")
  })
})

describe("links containing parentheses", () => {
  it("keeps a balanced pair inside the URL instead of truncating at the first )", () => {
    const out = renderAdminMessageBody("See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) for more")
    expect(out).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"')
    expect(out).toContain(">wiki</a>")
    // ...and no orphan paren left behind in the prose.
    expect(out).toContain("</a> for more")
  })

  it("still handles an ordinary URL with no parens", () => {
    const out = renderAdminMessageBody("[a](https://a.test/x) done")
    expect(out).toContain('href="https://a.test/x"')
    expect(out).toContain("</a> done")
  })
})
