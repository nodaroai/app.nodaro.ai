/**
 * The ONLY thing that turns an admin's typed text into email HTML.
 *
 * Admins are trusted people, but they are not a sanitizer: the text they type
 * ends up in a stranger's inbox, rendered by a client we do not control, and a
 * pasted fragment from a support ticket can carry anything. So the contract is
 * deliberately tiny and closed:
 *
 *   1. EVERYTHING is HTML-escaped first. There is no path by which a `<` an
 *      admin typed reaches the email as markup — including inside a link's
 *      label, which is where a "we already escaped it" design usually leaks.
 *   2. Then, and only then, the two constructs the spec allows are RE-INTRODUCED
 *      from the escaped text: `[label](url)` links and line breaks.
 *
 * Order is the whole design. Escape-then-build can only ever produce the tags
 * this file writes; build-then-escape would destroy them, and
 * escape-except-for-the-bits-we-like is how every sanitizer bug is born.
 *
 * URLs are scheme-allowlisted to http/https. `javascript:`, `data:` and
 * friends are not "escaped" — the link is dropped and the label survives as
 * plain text, because a support email that silently loses a word is a smaller
 * failure than one that ships a live payload.
 */

/** Escape the five characters that can change HTML meaning. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * A URL we are willing to put behind a link in an email, in its CANONICAL form
 * — or null.
 *
 * Returning the parsed `href` rather than a boolean is the whole point.
 * `new URL()` happily accepts `"`, `<`, `>`, spaces and newlines and quietly
 * percent-encodes them; a predicate that answers "safe" and then throws that
 * normalisation away hands the caller back the RAW string, which is exactly how
 * an attribute-breakout payload (`https://x/"><b>owned</b><a href="`) survives
 * validation intact and reaches a sink that does not escape. Keep the
 * normalised value and there is nothing left to break out with, in any sink —
 * our HTML, the provider's template, or the stored record.
 *
 * Parsed, not pattern-matched: ` javascript:x` and `java\nscript:x` both defeat
 * a regex and neither defeats the URL parser.
 */
export function normalizeLinkUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.href
  } catch {
    return null
  }
}

/** Predicate form, for callers that only need the yes/no — the body renderer,
 *  which HTML-escapes the URL it prints regardless. */
export function isSafeLinkUrl(url: string): boolean {
  return normalizeLinkUrl(url) !== null
}

/**
 * Anything that can end a line, tested by code point rather than written as a
 * regex character class — so no literal control byte ever appears in this file.
 *
 * C0 and DEL are the obvious ones. C1 (U+0080–U+009F) is also Unicode category
 * Cc and includes NEL (U+0085), and U+2028/U+2029 are the LINE SEPARATOR and
 * PARAGRAPH SEPARATOR — the classic pair that slips through a `[\r\n]` check.
 * None of them can forge a header over the JSON-and-HTTPS path this actually
 * travels, but the docstring below promises they are gone, and a comment that
 * overstates its own guard is how the next person stops checking.
 */
function isControlChar(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  )
}

/**
 * A single-line value safe to hand to a mail HEADER (the subject line).
 *
 * Deliberately NOT HTML-escaped: a subject is not markup, and escaping it would
 * show the recipient a literal `&amp;`. What a header cannot survive is a line
 * break — a CR or LF ends the header and turns whatever follows into forged
 * ones — so every control character is replaced by a space and runs are
 * collapsed.
 */
export function sanitizeHeaderText(text: string): string {
  let out = ""
  for (const ch of text) {
    out += isControlChar(ch.codePointAt(0) ?? 0) ? " " : ch
  }
  return out.replace(/\s{2,}/g, " ").trim()
}

/**
 * `[label](url)` — label may not contain `]`; the url runs to the closing paren
 * that BALANCES the opening one, so `(bar)` inside a Wikipedia/Jira address
 * survives. A naive `[^\s)]+` stopped at the first `)` and produced a truncated
 * href plus a stray `)` in the prose — silently, on the most ordinary link an
 * admin might paste.
 *
 * Anything more elaborate is not markdown we support and is left as the literal
 * text that was typed.
 *
 * COMPLEXITY: the two alternatives are disjoint on their first character, so
 * there is no exponential blowup — but matching is O(n²) on a pathological
 * input (measured: 58 ms at n = 10,000, 229 ms at n = 20,000). The Zod
 * `.max(10_000)` on `bodyText` is therefore not a nicety, it is the bound.
 * Raise that cap and this becomes worth re-measuring.
 */
const LINK_PATTERN = /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g

/** Inline style on the anchor: email clients have no stylesheet to inherit. */
const LINK_STYLE = "color:#4f46e5;text-decoration:underline;"

/**
 * Convert the admin's plain text into the HTML fragment we send and store.
 *
 * The output is a fragment, not a document: the Loops template supplies the
 * surrounding email.
 */
export function renderAdminMessageBody(text: string): string {
  const escaped = escapeHtml(text)

  const linked = escaped.replace(LINK_PATTERN, (whole, label: string, url: string) => {
    if (!isSafeLinkUrl(url)) {
      // Refused scheme: keep the words, drop the link. The label is already
      // escaped; so is the url, which is why it is safe to show it inline.
      return `${label} (${url})`
    }
    return `<a href="${url}" style="${LINK_STYLE}">${label}</a>`
  })

  // Paragraph breaks before single breaks, so a blank line does not collapse
  // into two identical <br>s and lose the visual paragraph the admin typed.
  return linked
    .split(/\r?\n\r?\n+/)
    .map((para) => para.replace(/\r?\n/g, "<br />"))
    .filter((para) => para.length > 0)
    .join("<br /><br />")
}

// `renderAdminMessagePlain` used to live here as the fallback for "what if
// Loops escapes HTML in its variables". A live send answered that — it does
// not — so the fallback was dead code hedging against a settled question, and
// dead code beside a security-critical renderer is a thing the next reader has
// to rule out before they can trust the file. Removed with the uncertainty.
