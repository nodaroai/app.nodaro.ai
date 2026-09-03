/**
 * The registry's job is that four things agree: the preview, the Loops
 * dataVariables, the stored record, and the Loops template. Three of those are
 * produced here; these tests pin the ones that can drift silently.
 */
import { describe, it, expect } from "vitest"
import { escapeHtml } from "../admin-message-markdown.js"
import {
  ADMIN_MESSAGE_TEMPLATES,
  getAdminMessageTemplate,
  parseAdminMessage,
} from "../admin-message-templates.js"

const ISSUE = {
  whatHappened: "Your video job failed partway through.",
  whatWeDid: "We refunded the credits.",
  nextStep: "Try again with a shorter clip.",
}

describe("registry shape", () => {
  it("carries exactly the three spec templates", () => {
    expect(ADMIN_MESSAGE_TEMPLATES.map((t) => t.id)).toEqual([
      "issue_detected",
      "credits_refunded",
      "general_followup",
    ])
  })

  it("every template has a distinct, non-placeholder Loops transactional id", () => {
    const ids = ADMIN_MESSAGE_TEMPLATES.map((t) => t.transactionalId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]{20,}$/)
    }
  })

  it("only general_followup accepts a screenshot (the others have no image block)", () => {
    expect(ADMIN_MESSAGE_TEMPLATES.filter((t) => t.supportsImage).map((t) => t.id)).toEqual([
      "general_followup",
    ])
  })

  it("only general_followup lets the admin write the subject", () => {
    expect(
      ADMIN_MESSAGE_TEMPLATES.filter((t) => t.subjectIsAuthored).map((t) => t.id),
    ).toEqual(["general_followup"])
  })
})

describe("issue_detected", () => {
  it("renders three plain paragraphs and sends all three variables", () => {
    const r = parseAdminMessage("issue_detected", ISSUE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.value.dataVariables).sort()).toEqual([
      "nextStep",
      "whatHappened",
      "whatWeDid",
    ])
    // Three plain paragraphs and no invented headings: the Loops template
    // structures these three variables itself, so a "What happened" label here
    // would appear in the preview and the stored record and in no actual email.
    expect(r.value.bodyHtml).not.toContain("What happened")
    expect(r.value.bodyHtml.match(/<p /g)).toHaveLength(3)
    expect(r.value.bodyHtml).toContain("Your video job failed partway through.")
    expect(r.value.subject.length).toBeGreaterThan(0)
  })

  it("refuses a blank field rather than emailing an empty section", () => {
    const r = parseAdminMessage("issue_detected", { ...ISSUE, whatWeDid: "   " })
    expect(r.ok).toBe(false)
  })

  it("escapes pasted markup in every variable, not just the body", () => {
    const r = parseAdminMessage("issue_detected", { ...ISSUE, nextStep: "<b>x</b>" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dataVariables.nextStep).not.toContain("<b>")
    expect(r.value.bodyHtml).not.toContain("<b>x</b>")
  })
})

describe("credits_refunded", () => {
  it("sends the amount WITH its unit — the template supplies no noun", () => {
    // The template reads "We've credited {amount} back to your Nodaro account",
    // so a bare "1500" arrives as "credited 1500 back to your Nodaro account".
    const r = parseAdminMessage("credits_refunded", { amount: 1500, reason: "A failed run." })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dataVariables.amount).toBe("1500 credits")
    expect(r.value.bodyHtml).toContain("1500 credits back to your Nodaro account")
  })

  it("says '1 credit', not '1 credits'", () => {
    const r = parseAdminMessage("credits_refunded", { amount: 1, reason: "x" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dataVariables.amount).toBe("1 credit")
  })

  it("refuses a fractional or negative amount", () => {
    expect(parseAdminMessage("credits_refunded", { amount: 1.5, reason: "x" }).ok).toBe(false)
    expect(parseAdminMessage("credits_refunded", { amount: -5, reason: "x" }).ok).toBe(false)
    expect(parseAdminMessage("credits_refunded", { amount: 0, reason: "x" }).ok).toBe(false)
  })

  it("accepts a numeric string from a form field", () => {
    const r = parseAdminMessage("credits_refunded", { amount: "250", reason: "x" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dataVariables.amount).toBe("250 credits")
  })
})

describe("general_followup", () => {
  const BASE = { subjectLine: "About your account", bodyText: "Hello there." }

  it("uses the admin's subject verbatim", () => {
    const r = parseAdminMessage("general_followup", BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.subject).toBe("About your account")
  })

  it("sends every optional variable as an empty string when unused", () => {
    // Loops renders an ABSENT variable as a literal {{ctaLabel}} in the email,
    // so "no button" must be present-and-empty, never omitted.
    const r = parseAdminMessage("general_followup", BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const k of ["ctaLabel", "ctaUrl", "imageUrl", "imageLabel"]) {
      expect(r.value.dataVariables[k]).toBe("")
    }
  })

  it("renders a CTA button when both halves are given", () => {
    const r = parseAdminMessage("general_followup", {
      ...BASE,
      ctaLabel: "Open your run",
      ctaUrl: "https://app.nodaro.ai/r/1",
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.bodyHtml).toContain("Open your run")
    expect(r.value.dataVariables.ctaUrl).toBe("https://app.nodaro.ai/r/1")
    expect(r.value.dataVariables.ctaLabel).toBe("Open your run")
  })

  it("refuses half a CTA — a button with no destination reaches the customer broken", () => {
    expect(parseAdminMessage("general_followup", { ...BASE, ctaLabel: "Go" }).ok).toBe(false)
    expect(
      parseAdminMessage("general_followup", { ...BASE, ctaUrl: "https://a.test" }).ok,
    ).toBe(false)
  })

  it("refuses a screenshot with no link text (the alt-text rule)", () => {
    const r = parseAdminMessage("general_followup", {
      ...BASE,
      imageUrl: "https://cdn.test/uploads/a.png",
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain("link text")
  })

  it("renders the screenshot as a labelled link, never an <img>", () => {
    const r = parseAdminMessage("general_followup", {
      ...BASE,
      imageUrl: "https://cdn.test/uploads/a.png",
      imageLabel: "See the screenshot",
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.bodyHtml).not.toContain("<img")
    expect(r.value.bodyHtml).toContain("See the screenshot")
    expect(r.value.dataVariables.imageLabel).toBe("See the screenshot")
  })

  it("refuses a non-http CTA or image URL", () => {
    expect(
      parseAdminMessage("general_followup", {
        ...BASE,
        ctaLabel: "x",
        ctaUrl: "javascript:alert(1)",
      }).ok,
    ).toBe(false)
    expect(
      parseAdminMessage("general_followup", {
        ...BASE,
        imageUrl: "javascript:alert(1)",
        imageLabel: "x",
      }).ok,
    ).toBe(false)
  })
})

describe("parseAdminMessage", () => {
  it("refuses an unknown template id", () => {
    const r = parseAdminMessage("nope", {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain("Unknown template")
  })

  it("names the offending field so the admin can fix it", () => {
    const r = parseAdminMessage("issue_detected", { ...ISSUE, whatHappened: "" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain("whatHappened")
  })

  it("returns the validated input for storage, not the raw body", () => {
    const r = parseAdminMessage("credits_refunded", { amount: "42", reason: "  spaced  " })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Coerced + trimmed: what we store is what we sent, not what was typed.
    expect(r.value.input).toEqual({ amount: 42, reason: "spaced" })
  })

  it("strips unknown fields so a stray form key cannot ride into the record", () => {
    const r = parseAdminMessage("credits_refunded", { amount: 1, reason: "x", sneaky: "y" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.input).not.toHaveProperty("sneaky")
  })
})

describe("getAdminMessageTemplate", () => {
  it("resolves each id and nothing else", () => {
    expect(getAdminMessageTemplate("issue_detected")?.id).toBe("issue_detected")
    expect(getAdminMessageTemplate("__proto__")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The escaping policy — one rule for every value that reaches Loops
// ---------------------------------------------------------------------------

/**
 * The invariant, stated once and checked for EVERY template rather than for the
 * one that happened to be convenient.
 *
 * The original version of this file asserted "escapes pasted markup in every
 * variable" while exercising only `issue_detected` — the template whose fields
 * all happen to run through the body renderer. `general_followup` passed
 * `ctaLabel` and `imageLabel` through raw, so an admin approved `&lt;b&gt;` in
 * the preview and the recipient got bold text. Iterating the registry is what
 * makes that class of bug impossible to reintroduce quietly: a fourth template
 * is covered the moment it is added.
 */
const HOSTILE = '<img src=x onerror=alert(1)>"><b>x</b>'

const HOSTILE_INPUT: Record<string, Record<string, unknown>> = {
  issue_detected: { whatHappened: HOSTILE, whatWeDid: HOSTILE, nextStep: HOSTILE },
  credits_refunded: { amount: 10, reason: HOSTILE },
  general_followup: {
    subjectLine: `subject ${HOSTILE}`,
    bodyText: HOSTILE,
    ctaLabel: HOSTILE,
    // The `&` is load-bearing. Without one, `escapeHtml` is a no-op on the
    // normalised URL and the "appears in bodyHtml verbatim" assertion below
    // holds by luck rather than by contract — the same "only the convenient
    // fixture was exercised" trap this whole block exists to close.
    ctaUrl: 'https://ok.test/a"><b>owned</b><a href="?x=1&y=2',
    imageUrl: 'https://cdn.test/uploads/a.png?x="><b>y</b>&z=3',
    imageLabel: HOSTILE,
  },
}

describe("every template, one escaping policy", () => {
  for (const template of ADMIN_MESSAGE_TEMPLATES) {
    describe(template.id, () => {
      const parsed = () => {
        const r = parseAdminMessage(template.id, HOSTILE_INPUT[template.id])
        if (!r.ok) throw new Error(`fixture rejected: ${r.message}`)
        return r.value
      }

      it("lets no raw '<' reach Loops in any variable that lands in HTML", () => {
        for (const [key, value] of Object.entries(parsed().dataVariables)) {
          // `subjectLine` is exempt BY KIND, not by oversight: it becomes a mail
          // header, where markup is inert and displays as the literal text it
          // is. HTML-escaping it would show the recipient "&amp;" in their
          // inbox. Its own invariant — no line breaks — is asserted separately.
          if (key === "subjectLine") continue
          // The body renderer emits its own <a>/<br /> tags; what must never
          // appear is markup the ADMIN typed.
          expect(value, `${key} carries a raw <img`).not.toContain("<img")
          expect(value, `${key} carries a raw <b>`).not.toContain("<b>")
        }
      })

      it("agrees with bodyHtml — the preview cannot differ from the send", () => {
        const { bodyHtml, dataVariables } = parsed()
        expect(bodyHtml).not.toContain("<img")
        expect(bodyHtml).not.toContain("<b>x</b>")
        // What the preview shows and what Loops receives must be the same
        // string — with ONE transformation, stated rather than skipped past.
        // A URL is sent canonical and printed inside an href, where `&` becomes
        // `&amp;`; every other variable appears byte-identical. Asserting the
        // relationship instead of `toContain(value)` is what stops this passing
        // on a fixture that happens to contain no `&`.
        for (const [key, value] of Object.entries(dataVariables)) {
          // `subjectLine` is the subject line; bodyHtml is the body.
          if (!value || key === "subjectLine") continue
          const expected = key.toLowerCase().includes("url") ? escapeHtml(value) : value
          expect(bodyHtml, `${key} is not in bodyHtml as sent`).toContain(expected)
        }
      })

      it("carries no attribute-breakout payload in any URL variable", () => {
        for (const [key, value] of Object.entries(parsed().dataVariables)) {
          if (!key.toLowerCase().includes("url") || !value) continue
          expect(value, `${key} still contains a raw quote`).not.toContain('"')
          expect(value, `${key} still contains a raw <`).not.toContain("<")
        }
      })
    })
  }
})

describe("URL normalisation", () => {
  it("percent-encodes a breakout attempt rather than passing it through", () => {
    const r = parseAdminMessage("general_followup", {
      subjectLine: "s",
      bodyText: "b",
      ctaLabel: "Go",
      ctaUrl: 'https://ok.test/a"><b>owned</b><a href="',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const url = r.value.dataVariables.ctaUrl
    expect(url).toContain("%22")
    expect(url).not.toContain('"')
    // And it is the SAME canonical string in the stored input.
    expect(r.value.input.ctaUrl).toBe(url)
  })
})

describe("subject lines are headers, not markup", () => {
  it("strips the line breaks that would forge a header", () => {
    const r = parseAdminMessage("general_followup", {
      subjectLine: "Hello\r\nBcc: victim@x.test",
      bodyText: "b",
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.subject).not.toMatch(/[\r\n]/)
    expect(r.value.dataVariables.subjectLine).not.toMatch(/[\r\n]/)
    expect(r.value.subject).toBe("Hello Bcc: victim@x.test")
  })

  it("does NOT html-escape a subject — an ampersand is not '&amp;' in an inbox", () => {
    const r = parseAdminMessage("general_followup", {
      subjectLine: "Nodaro & you",
      bodyText: "b",
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.subject).toBe("Nodaro & you")
  })
})

describe("paired optional fields", () => {
  it("refuses link text with no screenshot — the pair is symmetric", () => {
    // Not symmetric before: the label was accepted, vanished from the preview
    // and the stored copy, and was still handed to Loops with an empty target.
    const r = parseAdminMessage("general_followup", {
      subjectLine: "s",
      bodyText: "b",
      imageLabel: "See the screenshot",
    })
    expect(r.ok).toBe(false)
  })
})

describe("template capability, checked in the shared path", () => {
  it("refuses a screenshot on a template that cannot show one", () => {
    const r = parseAdminMessage("issue_detected", {
      whatHappened: "a",
      whatWeDid: "b",
      nextStep: "c",
      imageUrl: "https://cdn.test/uploads/a.png",
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain("cannot carry a screenshot")
  })
})

describe("credits_refunded amount", () => {
  it("shows the same digits in bodyHtml as it sends — no phantom separator", () => {
    // bodyHtml is stored as "what the recipient saw", and the SAME string is
    // sent, so a grouped "1,500" on one side only would put a number in the
    // record that nobody ever read.
    const r = parseAdminMessage("credits_refunded", { amount: 1500, reason: "x" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dataVariables.amount).toBe("1500 credits")
    expect(r.value.bodyHtml).toContain("1500 credits")
    expect(r.value.bodyHtml).not.toContain("1,500")
  })
})
