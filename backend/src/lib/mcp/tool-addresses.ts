import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import { linkImportRefusal } from "../link-imports.js"
import { collectAssetMediaUrls, collectInputMediaUrls, collectNodeInputMediaUrls, type BundleAssets } from "../media-portability.js"

/**
 * THE ADDRESSES IN AN MCP TOOL CALL (decided 2026-11-11). Where a deployment
 * turns link imports off (`imports.links: false`, `lib/link-imports.ts`), a
 * call whose arguments carry an address outside the deployment's own storage
 * is refused with the switch's one refusal, before the tool runs: before
 * anything is created, reserved, fetched or sent to a provider. With link
 * imports on, nothing here runs (`tool-offer.ts` asks the switch first).
 *
 * WHICH ARGUMENTS. Read from each tool's own input schema — the JSON Schema
 * the server lists, made by the same converter (`addressArguments`): a string
 * whose format is a URI or whose name says address (`…url`, `…link`,
 * `website`) is an ADDRESS; a string whose name says media (`…image`,
 * `…video`, `…source`) or whose description mentions a URL or a link is TEXT
 * that may hold one; an object that takes any keys, or a value of any type, is
 * a SUBTREE, walked to every string inside; a string named `…json` is a JSON
 * text the tool parses, and needs a reader below. A fixed vocabulary (an enum)
 * and an id, date or time format are never an address.
 *
 * WHICH VALUES. A value is judged when it reads as a web address: a scheme a
 * URL parser fetches from (http, https, ws, wss, ftp, file) after the tabs and
 * line breaks a parser drops; in an ADDRESS also a host written without its
 * scheme (`example.com/a.png`) and a `//host` start. An asset id, a job id or
 * an entity id never reads as one, so it reaches the tool as before; so does a
 * prompt, which is text (an address inside a prompt is not judged). A judged
 * value is handed to `linkImportRefusal` AS SENT, so the strict reading of
 * `isOutsideLink` applies unchanged: parser hazards, any form but the one
 * normal form, a content-network transform.
 *
 * WHAT IS NOT JUDGED, OR JUDGED ANOTHER WAY: `ADDRESS_JUDGMENTS`, each with
 * why. `__tests__/tool-addresses-census.test.ts` holds it to the schemas both
 * ways and proves every judged argument refused.
 */

export type AddressForm = "address" | "text" | "subtree" | "json"

export interface AddressArgument {
  /** Where it sits: `a.b`, `a[]` (each item), `a.*` (each value of a record); "" is the arguments themselves. */
  readonly path: string
  readonly form: AddressForm
}

/** How a reader finds the addresses in one value it is given. */
export type AddressReader = "workflow-node" | "media-fields" | "workflow-bundle"

export type AddressJudgment =
  /** Never judged: why it carries no content. */
  | { readonly notContent: string }
  /** Judged by a reader instead of the default walk: why that reader. */
  | { readonly reader: AddressReader; readonly why: string }

const GRAPH_NODE: AddressJudgment = {
  reader: "workflow-node",
  why: "a node of the workflow: its input media are judged as the workflow import reads them (lib/media-portability.ts) — never a run's result, an endpoint (a webhook) or a preview",
}
const GRAPH_SETTINGS: AddressJudgment = {
  reader: "media-fields",
  why: "the workflow's settings: their media fields are judged as a node's are (a run reads character definitions from them)",
}
const TRANSCRIPT: AddressJudgment = { notContent: "a transcript: the words and times of a recording, handed back as data; nothing in it is fetched" }

/**
 * The arguments the funnel does not judge by default, by tool and path. A
 * `notContent` entry says why the argument carries no content (a search text, a
 * code drawn on a picture); a `reader` entry says how the funnel reads it
 * instead. Every entry is an argument the tool's schema derives, and every
 * `json` argument has a reader (`tool-addresses-census.test.ts`).
 */
export const ADDRESS_JUDGMENTS: Readonly<Record<string, Readonly<Record<string, AddressJudgment>>>> = Object.freeze({
  create_workflow: { "nodes[]": GRAPH_NODE, settings: GRAPH_SETTINGS },
  update_workflow_json: {
    "nodes[]": GRAPH_NODE,
    settings: GRAPH_SETTINGS,
    "delta.upsert_nodes[]": GRAPH_NODE,
    "delta.set.settings": GRAPH_SETTINGS,
  },
  import_workflow: {
    workflow_json: {
      reader: "workflow-bundle",
      why: "the bundle export_workflow wrote, as text the tool parses: its nodes, settings and bundled entities are judged as the workflow import reads them",
    },
  },
  save_node_preset: {
    data: { reader: "media-fields", why: "a node's settings, which seed the node the preset is applied to: their media fields are judged as a node's are" },
  },
  read_collection: { q: { notContent: "words to find in the caller's own records; a link here is search text, never fetched" } },
  add_collection_record: {
    dedupe_key: { notContent: "the text a record is told apart by in the caller's collection; compared, never fetched" },
  },
  image_overlay: { qr_text: { notContent: "the text a QR code on the picture encodes (often a link): drawn into the picture, never fetched" } },
  video_audit: {
    analysis: { notContent: "the findings of an earlier analysis (descriptions, on-screen text, times), passed back as data; the audit reads the video from video_url, nothing named in them" },
  },
  apply_edl: { transcript: TRANSCRIPT },
  plan_edit: { transcript: TRANSCRIPT },
  speaker_map: { transcript: TRANSCRIPT },
  speaker_view: { transcript: TRANSCRIPT },
  switch_cameras: { transcript: TRANSCRIPT },
})

// ── Deriving the arguments from a schema ───────────────────────────────────

/** A name's last word, as snake_case or camelCase writes it, a trailing number skipped (`audio_url_1` → `url`). */
function lastWord(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s]+/)
    .filter((w) => w && !/^\d+$/.test(w))
  return (words.at(-1) ?? "").toLowerCase()
}

const ADDRESS_WORDS = new Set(["url", "urls", "uri", "uris", "href", "link", "links", "website", "homepage"])
const MEDIA_WORDS = new Set([
  "image", "images", "photo", "photos", "picture", "pictures", "video", "videos", "audio", "audios", "clip", "clips",
  "media", "logo", "logos", "avatar", "avatars", "poster", "posters", "thumbnail", "thumbnails", "source", "sources", "file", "files",
])
const MENTIONS_ADDRESS = /\bURLs?\b|\blinks?\b|https?:/i
/** String formats that can never hold an address. */
const NOT_AN_ADDRESS_FORMAT = new Set(["uuid", "date-time", "date", "time", "email", "duration", "ipv4", "ipv6"])

type JsonSchema = Readonly<Record<string, unknown>>

const isSchema = (v: unknown): v is JsonSchema => typeof v === "object" && v !== null && !Array.isArray(v)
const at = (path: string, key: string) => (path ? `${path}.${key}` : key)

/** A schema that says nothing of its value's shape: a value of any kind, an object of any keys, a list of anything. */
function isUntyped(s: JsonSchema): boolean {
  if (["type", "anyOf", "oneOf", "allOf", "enum", "const", "properties", "items", "not", "additionalProperties"].every((k) => s[k] === undefined)) return true
  if (s.type === "object" && s.properties === undefined && s.additionalProperties === undefined) return true
  return s.type === "array" && s.items === undefined && s.prefixItems === undefined
}

function stringTypes(s: JsonSchema): boolean {
  return s.type === "string" || (Array.isArray(s.type) && s.type.includes("string"))
}

/**
 * The arguments of one tool that can carry an address, from its JSON input
 * schema (as `tools/list` answers it). Sorted, one entry per path and form.
 */
export function addressArguments(schema: unknown): AddressArgument[] {
  const found = new Map<string, AddressArgument>()
  const add = (path: string, form: AddressForm) => found.set(`${form} ${path}`, { path, form })
  const visit = (s: JsonSchema, path: string, name: string, description: string): void => {
    const desc = typeof s.description === "string" ? s.description : description
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = s[key]
      if (Array.isArray(branches)) for (const b of branches) if (isSchema(b)) visit(b, path, name, desc)
    }
    if (stringTypes(s) && s.enum === undefined && s.const === undefined && !NOT_AN_ADDRESS_FORMAT.has(String(s.format))) {
      const word = lastWord(name)
      if (s.format === "uri" || ADDRESS_WORDS.has(word)) add(path, "address")
      else if (word === "json") add(path, "json")
      else if (MEDIA_WORDS.has(word) || MENTIONS_ADDRESS.test(desc)) add(path, "text")
    }
    // An item keeps its array's name and description.
    if (isSchema(s.items)) visit(s.items, `${path}[]`, name, desc)
    if (Array.isArray(s.prefixItems)) for (const item of s.prefixItems) if (isSchema(item)) visit(item, `${path}[]`, name, desc)
    // A property with no description of its own reads its object's (`accounts`: "handles or links").
    const own = typeof s.description === "string" ? s.description : ""
    if (isSchema(s.properties)) for (const [key, child] of Object.entries(s.properties)) if (isSchema(child)) visit(child, at(path, key), key, own)
    const extra = s.additionalProperties
    if (extra === true || (isSchema(extra) && Object.keys(extra).length === 0)) add(path, "subtree")
    else if (isSchema(extra)) visit(extra, at(path, "*"), name, desc)
    if (path !== "" && isUntyped(s)) add(path, "subtree")
  }
  if (isSchema(schema)) visit(schema, "", "", "")
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path) || a.form.localeCompare(b.form))
}

// ── Which values are judged ────────────────────────────────────────────────

const FETCHED_SCHEME = /^(?:https?|wss?|ftp|file):/i
const SCHEMELESS_HOST = /^(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#\\]|$)/i

/** The value as a URL parser starts reading it: tabs and line breaks dropped, leading spaces and controls skipped. */
function asParsed(value: string): string {
  return value.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "")
}

/** Whether a string value of an argument of this form reads as a web address, and is judged. */
export function readsAsAddress(value: string, form: AddressForm): boolean {
  const v = asParsed(value)
  if (FETCHED_SCHEME.test(v)) return true
  return form === "address" && (/^[\\/]{2}/.test(v) || SCHEMELESS_HOST.test(v))
}

// ── Judging a call ─────────────────────────────────────────────────────────

/** Every value at `path` in `args` (`[]` each item, `*` each value; missing → none). */
function valuesAt(args: unknown, path: string): unknown[] {
  let current: unknown[] = [args]
  if (path === "") return current
  for (const segment of path.split(".")) {
    const isItems = segment.endsWith("[]")
    const key = isItems ? segment.slice(0, -2) : segment
    const next: unknown[] = []
    for (const v of current) {
      if (!isSchema(v)) continue
      const children = key === "*" ? Object.values(v) : Object.hasOwn(v, key) ? [v[key]] : []
      for (const child of children) {
        if (!isItems) next.push(child)
        else if (Array.isArray(child)) next.push(...child)
      }
    }
    current = next
  }
  return current
}

/**
 * The value a string holds when a tool may read it as JSON — an array or an
 * object written as text (a reference list, an edit decision list); undefined
 * when it is not one.
 */
function asJsonText(value: string): unknown {
  const t = value.trim()
  if (!t.startsWith("[") && !t.startsWith("{")) return undefined
  try {
    return JSON.parse(t) as unknown
  } catch {
    return undefined
  }
}

/** Every string anywhere inside `value`, the value itself included, and inside any JSON text among them. */
function stringsIn(value: unknown): string[] {
  const out: string[] = []
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === "string") {
      out.push(v)
      const parsed = asJsonText(v)
      if (parsed !== undefined) stack.push(parsed)
    } else if (Array.isArray(v)) stack.push(...v)
    else if (isSchema(v)) stack.push(...Object.values(v))
  }
  return out
}

/** A media field's value is judged as an address argument's is (schemeless and `//` forms included), not only an `http(s)://` one. */
const inMediaField = (value: string): boolean => readsAsAddress(value, "address")

/** Only arrays of entities: a bundle the tool has not validated yet is read as far as it has the shape. */
function bundleAssets(assets: unknown): BundleAssets | undefined {
  if (!isSchema(assets)) return undefined
  const out: Record<string, unknown[]> = {}
  for (const [arm, entities] of Object.entries(assets)) if (Array.isArray(entities)) out[arm] = entities.filter(isSchema)
  return out as BundleAssets
}

/** The addresses a reader finds in one value (each is judged as sent). */
function readAddresses(reader: AddressReader, value: unknown): string[] {
  if (reader === "workflow-node") return collectNodeInputMediaUrls([value], inMediaField).map((ref) => ref.url)
  if (reader === "media-fields") return collectInputMediaUrls(value, inMediaField)
  if (typeof value !== "string") return []
  let bundle: unknown
  try {
    bundle = JSON.parse(value)
  } catch {
    // Not JSON: the tool answers that itself.
    return []
  }
  if (!isSchema(bundle)) return []
  const nodes = Array.isArray(bundle.nodes) ? bundle.nodes : []
  return [
    ...collectNodeInputMediaUrls(nodes, inMediaField).map((ref) => ref.url),
    ...collectInputMediaUrls(bundle.settings, inMediaField),
    ...collectAssetMediaUrls(bundleAssets(bundle.assets), inMediaField).map((ref) => ref.url),
  ]
}

/** The refusal of the first outside address one argument carries, or null. */
function argumentRefusal(arg: AddressArgument, judgment: AddressJudgment | undefined, args: unknown) {
  if (judgment && "notContent" in judgment) return null
  for (const value of valuesAt(args, arg.path)) {
    const candidates =
      judgment && "reader" in judgment
        ? readAddresses(judgment.reader, value)
        : arg.form === "subtree"
          ? stringsIn(value).filter((s) => readsAsAddress(s, "text"))
          : typeof value === "string"
            ? // A list or an object the tool reads from text (`coerceStringArray`) is judged inside too.
              [value, ...stringsIn(asJsonText(value))].filter((s) => readsAsAddress(s, arg.form))
            : []
    for (const address of candidates) {
      const refusal = linkImportRefusal(address)
      if (refusal) return refusal
    }
  }
  return null
}

const derivedOf = new WeakMap<object, AddressArgument[]>()

/** The JSON input schema of a registered tool's schema (a Zod object or a raw shape), as `tools/list` makes it. */
export function jsonInputSchema(inputSchema: unknown): unknown {
  const obj = normalizeObjectSchema(inputSchema as Parameters<typeof normalizeObjectSchema>[0])
  return obj ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: "input" }) : undefined
}

function argumentsOf(inputSchema: unknown): AddressArgument[] {
  if (!isSchema(inputSchema)) return []
  let derived = derivedOf.get(inputSchema)
  if (!derived) {
    derived = addressArguments(jsonInputSchema(inputSchema))
    derivedOf.set(inputSchema, derived)
  }
  return derived
}

/**
 * The switch's refusal of a call to `tool` whose arguments carry an address
 * outside this deployment's storage, or null. `inputSchema` is the schema the
 * tool registered. The caller asks the switch first; this reads the arguments
 * as sent, before the SDK validates them, and never echoes what it found.
 */
export function outsideAddressRefusal(tool: string, args: unknown, inputSchema: unknown): { code: "link_imports_disabled"; message: string } | null {
  const judgments = Object.hasOwn(ADDRESS_JUDGMENTS, tool) ? ADDRESS_JUDGMENTS[tool] : undefined
  for (const arg of argumentsOf(inputSchema)) {
    const judgment = judgments && Object.hasOwn(judgments, arg.path) ? judgments[arg.path] : undefined
    const refusal = argumentRefusal(arg, judgment, args)
    if (refusal) return refusal
  }
  return null
}
