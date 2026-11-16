/**
 * WHAT A TEXT NAMES THAT THIS SESSION IS NOT OFFERED (decided 2026-11-16).
 *
 * On a deployment that restricts what it offers, the guides, recipes and node
 * skills the MCP lane serves still name tools that are not in the session's
 * tool list and models the deployment withholds: they are written once, for
 * the platform. Their prose is never rewritten piecemeal (a partly rewritten
 * doctrine ends up contradicting itself). Instead a short, generated note at
 * the top of the text says which of the tools it names are not in this
 * session's list and which of the models it names are not offered here, and
 * tells the client to use only what it is offered.
 *
 * BOTH LISTS ARE READ FROM THE TEXT, never written by hand:
 *  - a TOOL is a registered tool name (a key of `TOOL_NEEDS`) written as an
 *    identifier. A name with an underscore (`mix_audio`) counts wherever it
 *    stands; a one-word name (`transcribe`, `dubbing`, `reduce`, `slideshow`)
 *    is also an English word and a node type, so it counts only where the text
 *    writes it as code (`` `transcribe` ``, `` `transcribe(…) ``, `"transcribe"`);
 *  - a MODEL is a gateable model id (`GATEABLE_MODEL_IDS`: the catalog's and the
 *    language models') written as an identifier, or a catalog model's LABEL
 *    ("Gemini Omni", "ElevenLabs v4") — the guides name models both ways. An id
 *    or label that is a plain word (`suno`, `whisper`, "Qwen") counts only as
 *    code, as a one-word tool does. Longer names are read first and a shorter
 *    one never counts inside a longer one ("Gemini Omni" inside "Gemini Omni
 *    Flash", `veo3` inside `veo3.1`, `seedance-2` inside `seedance-2-fast`);
 *  - an id that is also a node type or a tool name is read as that, never as a
 *    model (`NOT_READ_AS_MODELS`, held to the catalog by its test).
 *
 * EACH IS JUDGED BY THE SESSION'S OFFER, never by a rule of its own: a tool by
 * `offer.refusalOf(tool)` (what lists or withholds it), a model by
 * `offer.modelOffered(id)` (the run's own door).
 *
 * The same reading serves the TOOL LIST (`withToolDescriptionNotes`, called
 * by the offer at the `tools/list` exit): a listed tool whose description or
 * arguments name a tool the session is not listed, or a model the deployment
 * withholds (in a description, an enum, a default), ends its description with
 * the note. Its schema stays as registered.
 *
 * WITH NOTHING RESTRICTED there is no offer and nothing here runs: every text
 * is served as it came (`served-documents.ts`), and the tool list leaves as it
 * came (`tool-list-wire.test.ts`). A text that names nothing withheld gets no
 * note.
 *
 * Core code, loaded on every edition: plain text in, text out.
 */
import { createHash } from "node:crypto"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { GATEABLE_MODEL_IDS } from "../availability-override.js"
import type { ToolOffer } from "./tool-offer.js"
import { TOOL_NEEDS } from "./tool-needs.js"

/**
 * Model ids that are ALSO a node type or a tool name: in a served text the
 * name is the node's (a node catalog line, a node's skill), so it is never
 * read as the model. The node and the tool are judged by the offer where they
 * run; the model is still judged wherever a run names it.
 */
export const NOT_READ_AS_MODELS: Readonly<Record<string, string>> = Object.freeze({
  "motion-transfer": "the Motion Transfer node's type; the catalog's Kling 2.6 motion-transfer model carries the same id",
  "video-audit": "the Video Audit node's type; the catalog's audit model carries the same id",
})

/** What a text names: the tools, and the models (each with the label it was named by, when it was). */
export interface NamedInText {
  readonly tools: readonly string[]
  readonly models: readonly NamedModel[]
}

export interface NamedModel {
  readonly id: string
  /** The catalog label the text named it by, when it named it by its label. */
  readonly label?: string
}

/** A word with no separator: also English (or a family's name), so it counts only as code. */
const PLAIN_WORD = /^[A-Za-z]+$/

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Where a plain word counts: inside inline code (`` `x` `` or `` `x(…) ``) or quotes (`"x"`). */
function asCode(term: string): RegExp {
  const e = escaped(term)
  return new RegExp(String.raw`(?<=\`)${e}(?=\`|\()|(?<=")${e}(?=")`, "g")
}

/** A tool name as an identifier: not inside a longer word or a kebab id. */
function asToolIdentifier(name: string): RegExp {
  return new RegExp(String.raw`(?<![\w-])${escaped(name)}(?![\w-])`, "g")
}

/**
 * A model id or label as an identifier: not inside a longer id (`kling-3.0`
 * in `kling-3.0-pro`, `veo3` in `veo3.1`), a path or a host; a full stop after
 * it ends a sentence.
 */
function asModelIdentifier(term: string): RegExp {
  return new RegExp(String.raw`(?<![\w./-])${escaped(term)}(?![\w-]|\.\w)`, "g")
}

interface ModelTerm {
  readonly term: string
  readonly id: string
  readonly label: boolean
  readonly pattern: RegExp
}

let toolPatterns: ReadonlyArray<readonly [string, RegExp]> | null = null
let modelTerms: readonly ModelTerm[] | null = null

function tools(): ReadonlyArray<readonly [string, RegExp]> {
  return (toolPatterns ??= Object.keys(TOOL_NEEDS).map((name) => [name, name.includes("_") ? asToolIdentifier(name) : asCode(name)] as const))
}

/** Every model id and catalog label to look for, longest first (a shorter one never counts inside a longer one). */
function models(): readonly ModelTerm[] {
  if (modelTerms) return modelTerms
  const terms: ModelTerm[] = []
  const pattern = (term: string) => (PLAIN_WORD.test(term) ? asCode(term) : asModelIdentifier(term))
  for (const id of GATEABLE_MODEL_IDS) {
    if (Object.hasOwn(NOT_READ_AS_MODELS, id)) continue
    terms.push({ term: id, id, label: false, pattern: pattern(id) })
  }
  for (const m of Object.values(MODEL_CATALOG)) {
    if (Object.hasOwn(NOT_READ_AS_MODELS, m.id) || m.label === m.id || m.label.trim() === "") continue
    terms.push({ term: m.label, id: m.id, label: true, pattern: pattern(m.label) })
  }
  modelTerms = terms.sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term))
  return modelTerms
}

/** The tools and models `text` names (see the header), each once, in name order. */
export function namedInText(text: string): NamedInText {
  return remembered(`text\u0000${text}`, () => readNames(text))
}

/**
 * What was read from a text, by its digest: the documents and the tool
 * definitions are the same text call after call (the server is rebuilt per
 * request), so each is read once per process. Bounded: past the bound the
 * memory starts over.
 */
const NAMES_REMEMBERED_MAX = 2048
const namesRemembered = new Map<string, NamedInText>()

function remembered(key: string, read: () => NamedInText): NamedInText {
  const digest = createHash("sha256").update(key).digest("base64")
  const known = namesRemembered.get(digest)
  if (known) return known
  const named = read()
  if (namesRemembered.size >= NAMES_REMEMBERED_MAX) namesRemembered.clear()
  namesRemembered.set(digest, named)
  return named
}

function readNames(text: string): NamedInText {
  const named = new Set<string>()
  for (const [name, pattern] of tools()) {
    pattern.lastIndex = 0
    if (pattern.test(text)) named.add(name)
  }
  const taken: Array<readonly [number, number]> = []
  const byId = new Map<string, NamedModel>()
  for (const t of models()) {
    for (const m of text.matchAll(t.pattern)) {
      const start = m.index!
      const end = start + m[0].length
      if (taken.some(([s, e]) => start < e && s < end)) continue
      taken.push([start, end])
      const seen = byId.get(t.id)
      // Named by its label anywhere: the note says the label too.
      if (!seen || (t.label && seen.label === undefined)) byId.set(t.id, t.label ? { id: t.id, label: t.term } : { id: t.id })
    }
  }
  return {
    tools: [...named].sort(),
    models: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/** What `text` names that `offer` does not offer this session. */
export function withheldInText(text: string, offer: ToolOffer): NamedInText {
  const named = namedInText(text)
  return {
    tools: named.tools.filter((t) => offer.refusalOf(t) !== undefined),
    models: named.models.filter((m) => !offer.modelOffered(m.id)),
  }
}

/** A model as the note names it: its label and id where the text used the label, else its id. */
function modelWords(m: NamedModel): string {
  return m.label ? `${m.label} (\`${m.id}\`)` : `\`${m.id}\``
}

/** The note for what a text names that is not offered here, or null when it names nothing withheld. */
export function offerNote(withheld: NamedInText): string | null {
  if (withheld.tools.length === 0 && withheld.models.length === 0) return null
  const lines = ["> **Not offered on this deployment.** This document names tools or models this session cannot use."]
  if (withheld.tools.length > 0) lines.push(`> Tools not in your tool list: ${withheld.tools.map((t) => `\`${t}\``).join(", ")}.`)
  if (withheld.models.length > 0) lines.push(`> Models not offered here: ${withheld.models.map(modelWords).join(", ")}.`)
  lines.push("> Use only the tools in your tool list and the models `list_models` returns; do not plan with, or offer the user, anything named above.")
  return lines.join("\n")
}

// ── tool descriptions ──────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * What a listed tool's definition names: the tools and models its description
 * and its arguments' descriptions name (read as a document is read), and the
 * model ids its arguments offer as values (an enum, a constant, a default).
 */
export function namedInTool(tool: { description?: unknown; inputSchema?: unknown }): NamedInText {
  // A description carries live figures (a price hint), so the whole definition is the key.
  return remembered(`tool\u0000${JSON.stringify([tool.description ?? null, tool.inputSchema ?? null])}`, () => readToolNames(tool))
}

function readToolNames(tool: { description?: unknown; inputSchema?: unknown }): NamedInText {
  const texts: string[] = typeof tool.description === "string" ? [tool.description] : []
  const values = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!isRecord(node)) return
    for (const [key, v] of Object.entries(node)) {
      if (key === "description" && typeof v === "string") {
        texts.push(v)
      } else if (key === "enum" && Array.isArray(v)) {
        for (const e of v) if (typeof e === "string") values.add(e)
      } else if ((key === "default" || key === "const") && typeof v === "string") {
        values.add(v)
      } else {
        visit(v)
      }
    }
  }
  visit(tool.inputSchema)
  const named = namedInText(texts.join("\n"))
  const byId = new Map(named.models.map((m) => [m.id, m]))
  for (const v of values) if (GATEABLE_MODEL_IDS.has(v) && !Object.hasOwn(NOT_READ_AS_MODELS, v) && !byId.has(v)) byId.set(v, { id: v })
  return { tools: named.tools, models: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}

/** The note a tool's description ends with, naming what it names that is not offered here; null when nothing. */
export function offerDescriptionNote(withheld: NamedInText): string | null {
  if (withheld.tools.length === 0 && withheld.models.length === 0) return null
  const parts: string[] = []
  if (withheld.tools.length > 0) parts.push(`the tools ${withheld.tools.map((t) => `\`${t}\``).join(", ")} (not in your tool list)`)
  if (withheld.models.length > 0) parts.push(`the models ${withheld.models.map(modelWords).join(", ")}`)
  return `Not offered on this deployment: ${parts.join(" and ")}. Use only the tools in your tool list and the models \`list_models\` returns.`
}

/**
 * A `tools/list` reply as a session with `offer` reads it: each tool whose
 * definition names a tool it is not listed or a model the deployment withholds
 * ends its description with the note saying which. Its schema is left as it
 * registered it (a call naming a withheld model is refused by the run's model
 * door, as before); a tool that names nothing withheld is returned as it came.
 */
export function withToolDescriptionNotes(reply: unknown, offer: ToolOffer): unknown {
  if (!isRecord(reply) || !Array.isArray(reply.tools)) return reply
  let changed = false
  const tools = reply.tools.map((tool: unknown) => {
    if (!isRecord(tool)) return tool
    const named = namedInTool(tool)
    const note = offerDescriptionNote({
      tools: named.tools.filter((t) => t !== tool.name && offer.refusalOf(t) !== undefined),
      models: named.models.filter((m) => !offer.modelOffered(m.id)),
    })
    if (note === null) return tool
    changed = true
    const description = typeof tool.description === "string" && tool.description.length > 0 ? `${tool.description}\n\n${note}` : note
    return { ...tool, description }
  })
  return changed ? { ...reply, tools } : reply
}

/** YAML frontmatter at the very top of a text: the note goes after it, so the text still opens with it. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

/**
 * `text` with the note at its top (after its frontmatter, when it opens with
 * one), or `text` itself when it names nothing `offer` withholds.
 */
export function withOfferNote(text: string, offer: ToolOffer): string {
  const note = offerNote(withheldInText(text, offer))
  if (note === null) return text
  const head = FRONTMATTER.exec(text)?.[0] ?? ""
  return `${head}${note}\n\n${text.slice(head.length)}`
}
