/**
 * THE ONE FUNNEL the platform's name goes through on the MCP lane (decided
 * 2026-11-16).
 *
 * A deployment can run the platform under its own name (`brand.productName` on
 * its surface profile). An MCP client is a language model: it repeats the
 * names and words it reads to the deployment's users. So on a deployment with
 * its own name, nothing the lane says names the platform:
 *
 *  - where a name is needed, the deployment's name (`Nodaro had a server
 *    error` → `Acme had a server error`, `NODARO` in capitals);
 *  - a product built on the platform's name is said as the deployment's own
 *    screens say it: Nodaro Motion is "Motion" and its engines "Motion Prism"
 *    and "Motion Pulse" (the shared header's `whiteLabel.motion`, the tools
 *    app's brand words); a house model is offered under the deployment's own
 *    label ("Acme Image Upscale", as the tools app names it); a product the
 *    screens have no word for is said generically, never as a brand of the
 *    deployment's: Studio, the Video Director, the Film Director, the Workflow
 *    Editor, and the Cloud edition for Nodaro Cloud;
 *  - an id is an id: "a Nodaro job id" is "a job id";
 *  - no sentence sends the user to the platform's site: a phrase naming one of
 *    its hosts is dropped (`… at studio.nodaro.ai`), or said generically where
 *    the host stands for the hosted edition (`nodaro.ai only` → `Cloud edition
 *    only`); an example address on the platform's media host becomes an
 *    example address (`https://example.com/uploads/…`). An address the lane
 *    builds from the deployment's own configuration (`lib/mcp-lane-addresses.ts`)
 *    is the deployment's and is left alone.
 *
 * IDENTIFIERS STAY, as a client stores and sends them: tool names (none
 * carries the name), model ids (`nodaro-image-upscale`), a maker's id
 * (`nodaro`), the widgets' resource URIs (`ui://nodaro/…`), a `_meta` key,
 * error codes (`nodaro_connection_required`), a plan document's kind, package
 * names (`@nodaro/shared`), environment variable names. Every rule below is
 * case-sensitive and whole-word, so none of them is touched.
 *
 * WHERE IT APPLIES — at the exits, so the next tool cannot forget it:
 *
 *  - everything the server answers that the lane writes as a whole: its name
 *    (`mcpServerInfo`), `tools/list`, the resource lists, prompts — every
 *    `title` and `description` in the reply, rewritten as the reply leaves
 *    (`installDeploymentName`);
 *  - a refused call (`isError`): its words are the lane's and the route's about
 *    the call, never content the user stored, so it is rewritten at the same
 *    exit — every refusal, the plugin's routes', the offer's and the SDK's
 *    included;
 *  - a served document: `statedDocument` (`served-documents.ts`), the exit
 *    every document already passes through;
 *  - a widget page: built per session with the name escaped for the page
 *    (`widgetJs` / `widgetHtml`).
 *
 * A SUCCESSFUL call is the one place the funnel is called where the words are
 * written (`statedName`): its reply also relays what the user stored — a
 * workflow, a prompt, a gallery row — which a client may write back
 * (`update_workflow_json`), and a rewrite at the exit would change it. So the
 * lane's own sentences there, and the catalog words it relays (a model's
 * label, maker and family, an engine's name), are stated through `statedName`
 * by the code that writes them. `deployment-name.test.ts` holds both: every
 * reply of the lane on such a deployment, and a workflow that names the
 * platform read and written back byte for byte.
 *
 * WITH THE PLATFORM'S NAME (no profile, or `productName` "Nodaro") every
 * function here is the identity and nothing is wrapped: every reply is byte
 * for byte what it was (`deployment-name-recording.test.ts`,
 * `tool-list-wire.test.ts`, `deployment-documents.test.ts`).
 *
 * Core code, loaded on every edition: it reads the surface profile only.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { SURFACE_PROFILE_DEFAULT, runtimeSurfaceProfile } from "../surface-profile.js"

/** The platform's own name: what every deployment that names none is called. */
const PLATFORM_NAME = SURFACE_PROFILE_DEFAULT.brand.productName

/** The server's name on a deployment that keeps the platform's name — as it always was. */
const PLATFORM_SERVER_NAME = "nodaro-mcp"
const SERVER_VERSION = "1.0.0"

/**
 * The deployment's own name, or null when it keeps the platform's (no
 * profile, an edition that reads none, or `productName` "Nodaro"). Read at
 * call time: the profile is fixed for a process, and tests change it.
 */
export function deploymentName(): string | null {
  const name = runtimeSurfaceProfile().brand.productName.trim()
  return name.length > 0 && name !== PLATFORM_NAME ? name : null
}

// ── the rules ─────────────────────────────────────────────────────────────

/**
 * The words after "Nodaro" that make it an id ("a Nodaro job id", "Nodaro
 * audio or video job id", "Nodaro asset ids", "the Nodaro audio_asset_id"):
 * there the name is dropped, since an id needs none.
 */
const ID_WORDS = String.raw`(?:(?:image|video|audio)(?: or (?:image|video|audio))? )?(?:job|asset|upload)\b|ids?\b|IDs?\b|[a-z]+_asset_id\b|asset_id\b`

/** A host of the platform's: `nodaro.ai` or any name under it. */
const PLATFORM_HOST = String.raw`(?:https?:\/\/)?(?:[a-z0-9-]+\.)*nodaro\.ai`

const vowel = (word: string): boolean => /^[aeiou]/i.test(word)

/** "a"/"an" (in the article's own case) for the word that follows it. */
function article(written: string, next: string): string {
  const an = vowel(next)
  return written[0] === "A" ? (an ? "An" : "A") : an ? "an" : "a"
}

/** True when `offset` starts a sentence of `text` (its start, after a full stop, or a new line). */
function sentenceStart(text: string, offset: number): boolean {
  const before = text.slice(0, offset)
  return before.trim() === "" || /(?:[.!?:]\s+|\n\s*|["'(\[]\s*)$/.test(before)
}

type Replace = (name: string, match: string, groups: string[], offset: number, text: string) => string

/**
 * The rules, in order. Each replacement is built by a function, so a "$" in
 * the deployment's name is the name's own; `name` is already escaped for the
 * text it lands in (JSON text gets a JSON-escaped name).
 */
const RULES: ReadonlyArray<readonly [RegExp, Replace]> = [
  // ── a host of the platform's ──
  // A sentence promising a link on the platform's site (the deployment has no such page).
  [new RegExp(String.raw`\s*Also returns the ${PLATFORM_HOST} deep link[^.]*\.`, "g"), () => ""],
  // "a recast project — visible at recast.nodaro.ai, free to import": the clause goes.
  [new RegExp(String.raw`\s—\s+visible at ${PLATFORM_HOST},`, "g"), () => " —"],
  // "… on their dashboard at studio.nodaro.ai": the place is dropped.
  [new RegExp(String.raw`\s(?:at|on|in) ${PLATFORM_HOST}\b(?:\/[\w\-./%?=&#]*)?(?=[\s.,;:)!?]|$)`, "g"), () => ""],
  // The hosted edition by its host.
  [/\bnodaro\.ai only\b/g, () => "Cloud edition only"],
  [/\bnodaro\.ai(\s+)(connection|account)\b/g, (_n, _m, [space, what]) => `Cloud${space}${what}`],
  // An example picture on the platform's media host (a placeholder a client may copy).
  [/https:\/\/cdn\.nodaro\.ai\/uploads\//g, () => "https://example.com/uploads/"],
  // ── a product built on the name ──
  [/\bNodaro (Motion)\b/g, (_n, _m, [w]) => w!],
  [/\bNODARO (MOTION)\b/g, (_n, _m, [w]) => w!],
  [/\bNodaro (Studio|Video Director|Film Director|Workflow Editor)\b/g, (_n, _m, [w]) => w!],
  [/\b([Aa]n?|[Tt]he) Nodaro Cloud\b/g, (_n, _m, [a]) => `${/^[Tt]/.test(a!) ? a : a![0]} Cloud edition`],
  [/\b([Oo]n|[Ii]n) Nodaro Cloud\b/g, (_n, _m, [p]) => `${p} the Cloud edition`],
  [/\bNodaro Cloud\b/g, () => "Cloud edition"],
  // ── an id needs no name ──
  [new RegExp(String.raw`\b([Aa]n?) Nodaro (?=(${ID_WORDS}))`, "g"), (_n, _m, [a, next]) => `${article(a!, next!)} `],
  [new RegExp(String.raw`\bNodaro (?=(${ID_WORDS}))`, "g"), () => ""],
  // ── the name (never inside an HTTP header's name: `Nodaro-Signature`, `X-Nodaro-Workspace`) ──
  [/\b([Aa]) Nodaro\b(?!-[A-Z])/g, (name, _m, [a]) => `${article(a!, name)} ${name}`],
  [/(?<!X-)\bNodaro\b(?!-[A-Z])/g, (name) => name],
  [/\bNODARO\b/g, (name) => name.toLocaleUpperCase("en")],
]

/**
 * `text` as this deployment says it: the text itself with the platform's name;
 * on a deployment with its own name, the rules above. `json` is set for text
 * that is a JSON document, so the name lands JSON-escaped.
 */
export function statedName(text: string, opts: { json?: boolean } = {}): string {
  const name = deploymentName()
  if (name === null || !/nodaro/i.test(text)) return text
  const written = opts.json ? JSON.stringify(name).slice(1, -1) : name
  // A name that itself holds the platform's word ("Nodaro for Teams") is left
  // as it is where it already stands, so stating a text twice changes nothing.
  if (/nodaro/i.test(name)) {
    const forms = [...new Set([written, written.toLocaleUpperCase("en")])].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    // Split keeping the name's own occurrences (odd parts), which are never rewritten.
    return text
      .split(new RegExp(`(${forms.join("|")})`))
      .map((part, i) => (i % 2 === 1 ? part : rewritten(part, written)))
      .join("")
  }
  return rewritten(text, written)
}

/** The rules applied to `text`, the name already escaped for it. */
function rewritten(text: string, written: string): string {
  if (!/nodaro/i.test(text)) return text
  let out = text
  for (const [pattern, replace] of RULES) {
    out = out.replace(pattern, (...args: unknown[]) => {
      // replace(match, ...groups, offset, whole[, namedGroups])
      const hasNamed = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null
      const whole = args[args.length - (hasNamed ? 2 : 1)] as string
      const offset = args[args.length - (hasNamed ? 3 : 2)] as number
      const match = args[0] as string
      const groups = args.slice(1, args.length - (hasNamed ? 3 : 2)) as string[]
      const replaced = replace(written, match, groups, offset, whole)
      // A dropped name that opened a sentence leaves its id's first word to open it.
      return replaced === "" && /^Nodaro /.test(match) && sentenceStart(whole, offset) ? OPENS : replaced
    })
    out = out.replace(OPENS_NEXT, (_m, c: string) => c.toUpperCase())
  }
  return out
}

/** Where a dropped name opened a sentence: the character after it is capitalized. */
const OPENS = "\u0000"
const OPENS_NEXT = /\u0000(.)/g

/**
 * A copy of `row` with each named key that holds a string stated — the catalog
 * words a successful reply relays (a model's label, an engine's name). With
 * the platform's name the row itself is returned.
 */
export function statedFields<T extends object>(row: T, keys: readonly string[]): T {
  if (deploymentName() === null) return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const key of keys) if (typeof out[key] === "string") out[key] = statedName(out[key] as string)
  return out as T
}

/** True when `text` reads as a JSON document (a refusal relayed as the route wrote it). */
function isJson(text: string): boolean {
  const t = text.trimStart()
  if (t[0] !== "{" && t[0] !== "[") return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** A copy of `value` with every string under a `title` or `description` key stated (a `_meta` holds identifiers only). */
function statedRegistration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(statedRegistration)
  if (value === null || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "_meta") out[key] = v
    else if ((key === "title" || key === "description") && typeof v === "string") out[key] = statedName(v)
    else out[key] = statedRegistration(v)
  }
  return out
}

/**
 * A copy of `value` with every string in it stated: a refusal's structured
 * part, or a catalog example the lane wrote itself (never stored content).
 * With the platform's name the value itself is returned.
 */
export function statedValue<T>(value: T): T {
  if (deploymentName() === null) return value
  return statedDeep(value) as T
}

function statedDeep(value: unknown): unknown {
  if (typeof value === "string") return statedName(value)
  if (Array.isArray(value)) return value.map(statedDeep)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, statedDeep(v)]))
}

type ContentItem = { type?: unknown; text?: unknown; [key: string]: unknown }
type CallReply = { content?: ContentItem[]; structuredContent?: unknown; isError?: unknown; [key: string]: unknown }

/** A refused call as this deployment says it; a successful one exactly as it came (see the header). */
function statedCallReply(reply: unknown): unknown {
  const r = reply as CallReply | null
  if (!r || typeof r !== "object" || r.isError !== true) return reply
  return {
    ...r,
    ...(Array.isArray(r.content)
      ? { content: r.content.map((c) => (typeof c?.text === "string" ? { ...c, text: statedName(c.text, { json: isJson(c.text) }) } : c)) }
      : {}),
    ...(r.structuredContent !== undefined ? { structuredContent: statedDeep(r.structuredContent) } : {}),
  }
}

/** A prompt's messages as this deployment says them (the lane registers none today). */
function statedPrompt(reply: unknown): unknown {
  const r = statedRegistration(reply) as { messages?: Array<{ content?: ContentItem }> } | null
  if (!r || !Array.isArray(r.messages)) return r
  return {
    ...r,
    messages: r.messages.map((m) => (typeof m?.content?.text === "string" ? { ...m, content: { ...m.content, text: statedName(m.content.text) } } : m)),
  }
}

/** A resource read: a page that is not a widget's is stated; a widget's was built with the name (`widgetJs`). */
function statedResource(reply: unknown): unknown {
  const r = reply as { contents?: Array<{ mimeType?: unknown; text?: unknown }> } | null
  if (!r || !Array.isArray(r.contents)) return reply
  return {
    ...r,
    contents: r.contents.map((c) =>
      typeof c?.text === "string" && !(typeof c.mimeType === "string" && c.mimeType.startsWith("text/html")) ? { ...c, text: statedName(c.text) } : c,
    ),
  }
}

/**
 * A task's words: a failed job's failure as `tasks/get` (`statusMessage`) and
 * `tasks/result` (`error`, `message`) state it — the platform's words about the
 * run, never content the user stored (the job's output is left as it is).
 */
function statedTask(reply: unknown): unknown {
  return reply !== null && typeof reply === "object" ? statedFields(reply as Record<string, unknown>, ["statusMessage", "error", "message"]) : reply
}

/**
 * How each request the lane answers leaves it on a deployment with its own
 * name. A request not listed here answers nothing a model reads as prose
 * (`initialize` is built with `mcpServerInfo`; `ping`, `tasks/list` and
 * `tasks/cancel` carry ids and statuses): `deployment-name.test.ts` holds this
 * table to the handlers a server installs, so a new one is looked at.
 */
export const STATED_REQUESTS: ReadonlyMap<unknown, { method: string; stated: (reply: unknown) => unknown }> = new Map<unknown, { method: string; stated: (reply: unknown) => unknown }>([
  [ListToolsRequestSchema, { method: "tools/list", stated: statedRegistration }],
  [CallToolRequestSchema, { method: "tools/call", stated: statedCallReply }],
  [ListResourcesRequestSchema, { method: "resources/list", stated: statedRegistration }],
  [ListResourceTemplatesRequestSchema, { method: "resources/templates/list", stated: statedRegistration }],
  [ReadResourceRequestSchema, { method: "resources/read", stated: statedResource }],
  [ListPromptsRequestSchema, { method: "prompts/list", stated: statedRegistration }],
  [GetPromptRequestSchema, { method: "prompts/get", stated: statedPrompt }],
  [GetTaskRequestSchema, { method: "tasks/get", stated: statedTask }],
  [GetTaskPayloadRequestSchema, { method: "tasks/result", stated: statedTask }],
])

type Handler = (request: unknown, extra: unknown) => unknown

/**
 * Put the deployment's name between the server and what it answers, BEFORE any
 * tool or resource registers (the SDK installs those handlers on the first
 * registration, through the protocol's `setRequestHandler`) and before the
 * offer (`installToolOffer`), so the offer's refusals leave through it too.
 * With the platform's name nothing is wrapped.
 */
export function installDeploymentName(server: McpServer): void {
  if (deploymentName() === null) return
  const inner = server.server as unknown as { setRequestHandler: (schema: unknown, handler: Handler) => void }
  const set = inner.setRequestHandler.bind(inner)
  inner.setRequestHandler = (schema, handler) => {
    const entry = STATED_REQUESTS.get(schema)
    if (!entry) return set(schema, handler)
    return set(schema, async (request, extra) => entry.stated(await handler(request, extra)))
  }
}

/** A name a client can show beside its servers' ids: lower case, words joined by "-". */
function slugOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * What the server calls itself (`initialize`'s `serverInfo`, and the widgets'
 * `appInfo`): `nodaro-mcp` with the platform's name, as always; on a
 * deployment with its own name, that name (`title`) and an id made from it.
 */
export function mcpServerInfo(): { name: string; version: string; title?: string } {
  const name = deploymentName()
  if (name === null) return { name: PLATFORM_SERVER_NAME, version: SERVER_VERSION }
  return { name: `${slugOf(name) || "deployment"}-mcp`, title: name, version: SERVER_VERSION }
}

// ── widget pages ───────────────────────────────────────────────────────────

/** The two line breaks a JavaScript string may not hold raw. */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g")
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g")

/**
 * Words of a widget page as a JavaScript string literal (single-quoted unless
 * `quote` says otherwise), stated for this deployment: `'Open Nodaro library'`
 * with the platform's name, the deployment's name escaped for the script
 * (quotes, backslashes, a `<` that could close it) otherwise.
 */
export function widgetJs(words: string, quote: "'" | '"' = "'"): string {
  const s = statedName(words)
    .replace(/\\/g, "\\\\")
    .replace(quote === "'" ? /'/g : /"/g, `\\${quote}`)
    .replace(/</g, "\\x3c")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029")
  return `${quote}${s}${quote}`
}

/** Words of a widget page as HTML text, stated for this deployment and escaped for the page. */
export function widgetHtml(words: string): string {
  return statedName(words).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
