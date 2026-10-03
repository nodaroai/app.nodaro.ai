/**
 * An incremental JSON parser that reports every value the moment it is
 * COMPLETE, never a prefix of one.
 *
 * Built for streamed structured output: a forced tool call arrives as
 * `input_json_delta` fragments that split anywhere (mid-key, mid-string,
 * mid-escape, mid-number), and a consumer that wants to act on each finished
 * value has to know exactly when one is finished. The SDK's own partial-JSON
 * snapshot cannot say that: it closes an open string for you, so
 * `"handsome-m` and `"handsome-man"` look alike.
 *
 * A value is reported when the text proves it can no longer change:
 * - a string at its closing quote;
 * - a number when the character after it arrives (`12` may still become `123`);
 * - `true` / `false` / `null` once spelled out in full;
 * - an object or array when it closes, carrying the whole value.
 *
 * So children are always reported before the container that holds them, and
 * every value is reported exactly once, whatever the chunking.
 *
 * Input that stops being valid JSON marks the parser `failed`: it reports
 * nothing after the fault and never throws. That keeps a stream consumer
 * safe to run inside a provider's event callback. The finished document is
 * still parsed by the caller, so a failed parser can only cost the early
 * reports, never the result.
 */

export type JsonPath = readonly (string | number)[]

export interface IncrementalJsonParser {
  /** Feed the next slice of the document. */
  push(chunk: string): void
  /** True once the input stopped being valid JSON; nothing is reported after. */
  readonly failed: boolean
}

type ObjectState = "key-or-end" | "key" | "colon" | "value" | "comma-or-end"
type ArrayState = "value-or-end" | "value" | "comma-or-end"

interface ObjectFrame {
  kind: "object"
  path: JsonPath
  value: Record<string, unknown>
  key: string
  state: ObjectState
}

interface ArrayFrame {
  kind: "array"
  path: JsonPath
  value: unknown[]
  state: ArrayState
}

type Frame = ObjectFrame | ArrayFrame

interface StringToken {
  kind: "string"
  isKey: boolean
  text: string
  escape: boolean
  /** Hex digits of a `\u` escape collected so far; null outside one. */
  unicode: string | null
}

interface NumberToken {
  kind: "number"
  text: string
}

interface LiteralToken {
  kind: "literal"
  target: "true" | "false" | "null"
  text: string
}

type Token = StringToken | NumberToken | LiteralToken

const LITERAL_BY_FIRST_CHAR: Readonly<Record<string, LiteralToken["target"]>> = { t: "true", f: "false", n: "null" }
const LITERAL_VALUE: Readonly<Record<LiteralToken["target"], boolean | null>> = { true: true, false: false, null: null }
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
}
const NUMBER_CHARS = new Set("0123456789+-.eE")
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const HEX_RE = /^[0-9a-fA-F]$/
const WHITESPACE = new Set([" ", "\n", "\r", "\t"])

/**
 * A parser that calls `onValue(path, value)` once for every value in the
 * document, the moment that value is complete (see the module comment).
 */
export function createIncrementalJsonParser(
  onValue: (path: JsonPath, value: unknown) => void,
): IncrementalJsonParser {
  return new StreamingJsonParser(onValue)
}

/** A string token opening at the current position. */
function stringToken(isKey: boolean): StringToken {
  return { kind: "string", isKey, text: "", escape: false, unicode: null }
}

/** The state machine behind {@link createIncrementalJsonParser}. */
class StreamingJsonParser implements IncrementalJsonParser {
  private readonly stack: Frame[] = []
  private token: Token | null = null
  private rootDone = false
  private hasFailed = false

  constructor(private readonly onValue: (path: JsonPath, value: unknown) => void) {}

  get failed(): boolean {
    return this.hasFailed
  }

  push(chunk: string): void {
    if (this.hasFailed) return
    for (const c of chunk) {
      this.step(c)
      if (this.hasFailed) return
    }
  }

  private fail(): void {
    this.hasFailed = true
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1]
  }

  /** The path of the value starting (or finishing) at the current position. */
  private slotPath(): JsonPath {
    const top = this.top()
    if (!top) return []
    return top.kind === "object" ? [...top.path, top.key] : [...top.path, top.value.length]
  }

  /** Store a finished value in its container, then report it. */
  private complete(value: unknown, path: JsonPath): void {
    const top = this.top()
    if (!top) {
      this.rootDone = true
    } else if (top.kind === "object") {
      // An own property, as JSON.parse makes: plain assignment would run the
      // `__proto__` setter and re-parent the object instead.
      Object.defineProperty(top.value, top.key, { value, enumerable: true, writable: true, configurable: true })
      top.state = "comma-or-end"
    } else {
      top.value.push(value)
      top.state = "comma-or-end"
    }
    this.onValue(path, value)
  }

  private closeContainer(): void {
    const frame = this.stack.pop() as Frame
    this.complete(frame.value, frame.path)
  }

  private beginValue(c: string): void {
    if (c === "{") {
      this.stack.push({ kind: "object", path: this.slotPath(), value: {}, key: "", state: "key-or-end" })
      return
    }
    if (c === "[") {
      this.stack.push({ kind: "array", path: this.slotPath(), value: [], state: "value-or-end" })
      return
    }
    if (c === '"') {
      this.token = stringToken(false)
      return
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      this.token = { kind: "number", text: c }
      return
    }
    const literal = LITERAL_BY_FIRST_CHAR[c]
    if (literal) {
      this.token = { kind: "literal", target: literal, text: c }
      return
    }
    this.fail()
  }

  private stringChar(t: StringToken, c: string): void {
    if (t.unicode !== null) return this.unicodeChar(t, c)
    if (t.escape) return this.escapeChar(t, c)
    if (c === "\\") {
      t.escape = true
      return
    }
    if (c === '"') return this.closeString(t)
    // A raw control character is never valid inside a JSON string.
    if (c < " ") return this.fail()
    t.text += c
  }

  private unicodeChar(t: StringToken, c: string): void {
    if (!HEX_RE.test(c)) return this.fail()
    const digits = (t.unicode ?? "") + c
    if (digits.length < 4) {
      t.unicode = digits
      return
    }
    t.text += String.fromCharCode(parseInt(digits, 16))
    t.unicode = null
  }

  private escapeChar(t: StringToken, c: string): void {
    t.escape = false
    if (c === "u") {
      t.unicode = ""
      return
    }
    const decoded = SIMPLE_ESCAPES[c]
    if (decoded === undefined) return this.fail()
    t.text += decoded
  }

  private closeString(t: StringToken): void {
    this.token = null
    if (!t.isKey) return this.complete(t.text, this.slotPath())
    const top = this.top() as ObjectFrame
    top.key = t.text
    top.state = "colon"
  }

  private literalChar(t: LiteralToken, c: string): void {
    t.text += c
    if (!t.target.startsWith(t.text)) return this.fail()
    if (t.text === t.target) {
      this.token = null
      this.complete(LITERAL_VALUE[t.target], this.slotPath())
    }
  }

  private objectChar(top: ObjectFrame, c: string): void {
    switch (top.state) {
      case "key-or-end":
        if (c === "}") return this.closeContainer()
        return this.openKey(c)
      case "key":
        return this.openKey(c)
      case "colon":
        if (c !== ":") return this.fail()
        top.state = "value"
        return
      case "value":
        return this.beginValue(c)
      case "comma-or-end":
        if (c === "}") return this.closeContainer()
        if (c !== ",") return this.fail()
        top.state = "key"
        return
    }
  }

  private openKey(c: string): void {
    if (c !== '"') return this.fail()
    this.token = stringToken(true)
  }

  private arrayChar(top: ArrayFrame, c: string): void {
    switch (top.state) {
      case "value-or-end":
        if (c === "]") return this.closeContainer()
        return this.beginValue(c)
      case "value":
        return this.beginValue(c)
      case "comma-or-end":
        if (c === "]") return this.closeContainer()
        if (c !== ",") return this.fail()
        top.state = "value"
        return
    }
  }

  /** A number ends at the first character that cannot continue it. */
  private numberChar(t: NumberToken, c: string): boolean {
    if (NUMBER_CHARS.has(c)) {
      t.text += c
      return true
    }
    this.token = null
    if (!NUMBER_RE.test(t.text)) {
      this.fail()
      return true
    }
    this.complete(Number(t.text), this.slotPath())
    return false
  }

  private step(c: string): void {
    const token = this.token
    if (token?.kind === "string") return this.stringChar(token, c)
    if (token?.kind === "literal") return this.literalChar(token, c)
    // `c` either continues the number, or ends it and is read as the delimiter it is.
    if (token?.kind === "number" && this.numberChar(token, c)) return
    if (WHITESPACE.has(c)) return
    const top = this.top()
    if (!top) return this.rootDone ? this.fail() : this.beginValue(c)
    if (top.kind === "object") return this.objectChar(top, c)
    return this.arrayChar(top, c)
  }
}
