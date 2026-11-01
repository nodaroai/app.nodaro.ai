/**
 * Model product lines — the admin Jobs page's Model filter.
 *
 * A line is a `series` ("Kling", "Claude"): every model catalog entry and
 * every LLM model names one, and a catalog line and an LLM line of the same
 * name are one line (Grok, Gemini). The server's `models` list is matched
 * against `coalesce(resolvedModel, provider, llmModel, model)` of a row's
 * `input_data` (`resolvedModel`: the model the job ran, which every new job
 * records), so a
 * model is sent as every value a row stores for it (`modelValuesOf`): its
 * catalog id and, where it differs, the node's stored value (`dataValue`,
 * Suno's "V5"). `modelsOfLine` is those values for every model of the line,
 * retired LLMs included, which old rows still name.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"

interface ModelLine {
  readonly line: string
  readonly models: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

interface Lines {
  readonly list: readonly ModelLine[]
  readonly matches: ReadonlyMap<string, readonly string[]>
  /** A model id's stored values, for the ids that store more than their id. */
  readonly values: ReadonlyMap<string, readonly string[]>
}

let cache: Lines | null = null

function lines(): Lines {
  if (cache) return cache
  const listed = new Map<string, Array<{ id: string; label: string }>>()
  const matches = new Map<string, Set<string>>()
  const match = (line: string, value: string) => {
    const set = matches.get(line) ?? new Set<string>()
    set.add(value)
    matches.set(line, set)
  }
  const list = (line: string, id: string, label: string) => {
    listed.set(line, [...(listed.get(line) ?? []), { id, label }])
  }
  const values = new Map<string, string[]>()
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.dataValue && m.dataValue !== m.id) values.set(m.id, [m.id, m.dataValue])
  }
  const valuesOf = (id: string): readonly string[] => values.get(id) ?? [id]
  for (const m of Object.values(MODEL_CATALOG)) {
    list(m.series, m.id, m.label)
    for (const v of valuesOf(m.id)) match(m.series, v)
  }
  for (const m of LLM_MODELS) {
    for (const v of valuesOf(m.id)) match(m.series, v)
    if (!m.retired) list(m.series, m.id, m.displayName)
  }
  cache = {
    list: [...listed]
      .map(([line, models]) => ({ line, models }))
      .sort((a, b) => a.line.localeCompare(b.line)),
    matches: new Map([...matches].map(([line, set]) => [line, [...set].sort()])),
    values,
  }
  return cache
}

/** Every product line with its models (retired LLMs left out), by line name. */
export function modelLines(): Array<{ line: string; models: Array<{ id: string; label: string }> }> {
  return lines().list.map((l) => ({ line: l.line, models: l.models.map((m) => ({ id: m.id, label: m.label })) }))
}

/** Every value a row stores for model `id`: the id, and the node's stored value where it differs. An id the catalog does not know is itself. */
export function modelValuesOf(id: string): string[] {
  return [...(lines().values.get(id) ?? [id])]
}

/** How many values beyond their own id all models together store — what an exact pick can grow by on its way to the server. */
export const MODEL_EXTRA_VALUES: number = [...lines().values.values()].reduce((sum, v) => sum + v.length - 1, 0)

/** Every stored model value of `line`, sorted — the server's `models` list. */
export function modelsOfLine(line: string): string[] {
  return [...(lines().matches.get(line) ?? [])]
}
