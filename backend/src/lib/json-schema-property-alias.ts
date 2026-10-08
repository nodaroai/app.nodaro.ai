/**
 * A caller's JSON Schema → the one sent to a validator that reads some
 * PROPERTY NAMES as JSON-Schema keywords, and that schema's answers back.
 *
 * KIE's chat-completions endpoint validates `response_format.json_schema`
 * before it forwards the request, and its validator takes an object property
 * called `type` for the `type` keyword. The Person analyzer — whose first
 * dimension is named `type` — is refused outright:
 *
 *     (code 422) $.response_format.json_schema.schema.properties.person.properties.type
 *     must be string or array
 *
 * The schema is valid; the name is just one that validator cannot tell from a
 * keyword. So such a property travels under a wire name, and the answer's keys
 * are mapped back before anything reads the answer — the caller's Zod
 * validation included.
 *
 * Done here rather than per schema so no caller has to know this about one
 * lane (the split `gemini/response-schema.ts` makes for the direct Google
 * lane): a schema is also its request fingerprint and its contract on every
 * other lane. A schema with no such name is returned AS IS — the same object,
 * byte for byte.
 */

/**
 * Property names the KIE chat-completions validator misreads as keywords.
 * Closed and observed — extend it with a repro, not a guess. (The client sends
 * KIE's responses lane the same wire form: `kieWireSchema` in llm-client.)
 */
const MISREAD_PROPERTY_NAMES: ReadonlySet<string> = new Set(["type"])

/**
 * Keywords whose value maps a caller's PROPERTY names — the names an answer is
 * keyed by — to a subschema, or (`dependencies`, `dependentRequired`) to a list
 * of property names. Their keys are renamed.
 */
const PROPERTY_NAME_MAPS: ReadonlySet<string> = new Set([
  "properties",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
])

/** Property-name maps whose values may be lists of property names. */
const NAME_LIST_VALUED: ReadonlySet<string> = new Set(["dependencies", "dependentRequired"])

/**
 * Keywords whose value maps some OTHER identifier to a subschema: a
 * definition's name (never an answer key) or a pattern (renaming one would
 * change what it matches). Walked into, never renamed.
 */
const OTHER_NAME_MAPS: ReadonlySet<string> = new Set(["$defs", "definitions", "patternProperties"])

/** Keywords whose value is a list of property names. */
const PROPERTY_NAME_LISTS: ReadonlySet<string> = new Set(["required"])

/** The keyword whose subschema constrains an object's KEYS: its `enum` and `const` values are property names. */
const KEY_SCHEMA = "propertyNames"

/** Keywords whose value is DATA — an answer, not a schema. Never walked. */
const DATA_KEYWORDS: ReadonlySet<string> = new Set(["enum", "const", "default", "examples"])

export interface AliasedSchema {
  /** The schema to send: the caller's own object when no name needed a wire name. */
  readonly schema: Record<string, unknown>
  /** Caller's name → wire name, for each name sent under one. Empty = nothing changed. */
  readonly aliases: ReadonlyMap<string, string>
  /**
   * An answer to the wire schema → the same answer under the caller's names:
   * a wire name is renamed back wherever it is a key, at any depth. That is
   * exact for every key the schema names, since no wire name is one of them;
   * only a free-form map key spelled the same could be taken for one. A key is
   * left alone where its object also carries the caller's name, so an answer
   * already written in the caller's names passes through unchanged.
   */
  restore(value: unknown): unknown
}

export function aliasKeywordPropertyNames(schema: Record<string, unknown>): AliasedSchema {
  const keyed = new Set<string>()
  const all = new Set<string>()
  collectNames(schema, keyed, all)

  const aliases = new Map<string, string>()
  for (const name of MISREAD_PROPERTY_NAMES) {
    if (!keyed.has(name)) continue
    // A wire name none of the caller's names uses — anywhere in the schema —
    // so restoring an answer can never rename one of the caller's own keys.
    let alias = `${name}_`
    while (all.has(alias)) alias += "_"
    all.add(alias)
    aliases.set(name, alias)
  }
  if (aliases.size === 0) return { schema, aliases, restore: (value) => value }

  const originals = new Map([...aliases].map(([name, alias]) => [alias, name]))
  return {
    schema: rewrite(schema, aliases, schema) as Record<string, unknown>,
    aliases,
    restore: (value) => restoreKeys(value, originals),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Assigns even a key spelled `__proto__` as an own property, never a prototype. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function renamed(name: unknown, aliases: ReadonlyMap<string, string>): unknown {
  return typeof name === "string" ? aliases.get(name) ?? name : name
}

/** `keyed`: the keys of every property-name map. `all`: those plus every listed property name. */
function collectNames(node: unknown, keyed: Set<string>, all: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectNames(entry, keyed, all)
    return
  }
  if (!isRecord(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.has(key)) continue
    if (PROPERTY_NAME_LISTS.has(key) && Array.isArray(value)) {
      for (const name of value) if (typeof name === "string") all.add(name)
      continue
    }
    if (key === KEY_SCHEMA && isRecord(value)) {
      const allowed = Array.isArray(value.enum) ? value.enum : [value.const]
      for (const name of allowed) if (typeof name === "string") all.add(name)
    }
    const propertyNames = PROPERTY_NAME_MAPS.has(key)
    if ((propertyNames || OTHER_NAME_MAPS.has(key)) && isRecord(value)) {
      for (const [name, sub] of Object.entries(value)) {
        if (propertyNames) {
          keyed.add(name)
          all.add(name)
        }
        if (Array.isArray(sub) && NAME_LIST_VALUED.has(key)) {
          for (const listed of sub) if (typeof listed === "string") all.add(listed)
        } else {
          collectNames(sub, keyed, all)
        }
      }
      continue
    }
    collectNames(value, keyed, all)
  }
}

/** A deep copy of `node` with every aliased property name renamed; the input is never touched. */
function rewrite(node: unknown, aliases: ReadonlyMap<string, string>, root: unknown): unknown {
  if (Array.isArray(node)) return node.map((entry) => rewrite(entry, aliases, root))
  if (!isRecord(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    let next: unknown
    if (DATA_KEYWORDS.has(key)) next = structuredClone(value)
    else if (PROPERTY_NAME_LISTS.has(key) && Array.isArray(value)) next = value.map((name) => renamed(name, aliases))
    else if (key === "$ref" && typeof value === "string") next = rewritePointer(value, root, aliases)
    else if ((PROPERTY_NAME_MAPS.has(key) || OTHER_NAME_MAPS.has(key)) && isRecord(value)) next = rewriteMap(key, value, aliases, root)
    else if (key === KEY_SCHEMA && isRecord(value)) next = rewriteKeySchema(value, aliases, root)
    else next = rewrite(value, aliases, root)
    define(out, key, next)
  }
  return out
}

/** A `propertyNames` subschema: the key names it allows follow the rename, so a renamed property stays allowed. */
function rewriteKeySchema(
  node: Record<string, unknown>,
  aliases: ReadonlyMap<string, string>,
  root: unknown,
): Record<string, unknown> {
  const out = rewrite(node, aliases, root) as Record<string, unknown>
  if (Array.isArray(out.enum)) out.enum = out.enum.map((name) => renamed(name, aliases))
  if (typeof out.const === "string") out.const = renamed(out.const, aliases)
  return out
}

function rewriteMap(
  keyword: string,
  map: Record<string, unknown>,
  aliases: ReadonlyMap<string, string>,
  root: unknown,
): Record<string, unknown> {
  const propertyNames = PROPERTY_NAME_MAPS.has(keyword)
  const out: Record<string, unknown> = {}
  for (const [name, sub] of Object.entries(map)) {
    const next = Array.isArray(sub) && NAME_LIST_VALUED.has(keyword)
      ? sub.map((listed) => renamed(listed, aliases))
      : rewrite(sub, aliases, root)
    define(out, propertyNames ? (renamed(name, aliases) as string) : name, next)
  }
  return out
}

/**
 * A local `$ref` that passes through a renamed property (`#/properties/type`)
 * names it by its wire name too. The pointer is walked against the caller's
 * schema, so a segment is renamed only where it really is a property name —
 * never a keyword, a definition name or a pattern that happens to match.
 */
function rewritePointer(ref: string, root: unknown, aliases: ReadonlyMap<string, string>): string {
  if (!ref.startsWith("#/")) return ref
  const segments = ref.slice(2).split("/")
  const out: string[] = []
  let node: unknown = root
  /** The next segment is a key of a name map; `renameable` when that map holds property names. */
  let atName = false
  let renameable = false
  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i]!
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~")
    if (atName) {
      const alias = renameable && isRecord(node) && Object.hasOwn(node, segment) ? aliases.get(segment) : undefined
      out.push(alias === undefined ? raw : alias.replace(/~/g, "~0").replace(/\//g, "~1"))
      atName = false
    } else {
      out.push(raw)
      if (isRecord(node)) {
        // A pointer into data (`#/default/...`) addresses an answer, not a schema.
        if (DATA_KEYWORDS.has(segment)) return `#/${[...out, ...segments.slice(i + 1)].join("/")}`
        atName = PROPERTY_NAME_MAPS.has(segment) || OTHER_NAME_MAPS.has(segment)
        renameable = PROPERTY_NAME_MAPS.has(segment)
      }
    }
    node = isRecord(node) || Array.isArray(node) ? (node as Record<string, unknown>)[segment] : undefined
  }
  return `#/${out.join("/")}`
}

function restoreKeys(value: unknown, originals: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => restoreKeys(entry, originals))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const original = originals.get(key)
    // Both names in one object: the caller's stays, and the wire name is left
    // for the caller's validation to judge rather than silently dropped.
    const name = original !== undefined && !Object.hasOwn(value, original) ? original : key
    define(out, name, restoreKeys(entry, originals))
  }
  return out
}
