import { getModel } from "@nodaro/shared/model-catalog"
import { getNodeTypeLabel } from "@/lib/template-utils"
import { surfaceBrandName } from "@/lib/surface-selectors"

/**
 * Who a marketplace template is "by". The marketplace is curated by the
 * deployment — the hero calls it "{brand} templates" — and every listed
 * template is published by the team, so the credit line names the brand
 * rather than the team member who happened to press Publish. When community
 * publishing arrives, an "official" flag on the row is what should decide
 * this; until then a personal name here is the wrong answer.
 */
export function templateCreatorName(): string {
  return surfaceBrandName()
}

/**
 * The facts the Templates page derives from a template row — badges, model
 * chips, the flow strip — kept out of the components so each rule is one
 * tested function rather than a repeated inline expression.
 */

/** A template published within this many days wears the "New" badge. */
export const NEW_WINDOW_DAYS = 14
/** Cloned at least this often, a template wears the "Popular" badge. */
export const POPULAR_MIN_CLONES = 10

const DAY_MS = 24 * 60 * 60 * 1000

export type TemplateBadge = "new" | "popular"

/** New wins over popular: recency is the rarer, more useful signal. */
export function templateBadge(
  template: { readonly createdAt: string; readonly cloneCount: number },
  now: number,
): TemplateBadge | null {
  const created = Date.parse(template.createdAt)
  if (Number.isFinite(created) && now - created <= NEW_WINDOW_DAYS * DAY_MS) return "new"
  if (template.cloneCount >= POPULAR_MIN_CLONES) return "popular"
  return null
}

/**
 * Display names for the models a template runs, from the catalog when the id is
 * known and the raw id otherwise — a provider the catalog has not met yet is
 * still named rather than dropped. Duplicate names collapse.
 */
export function modelChipLabels(providers: readonly string[], max = 3): string[] {
  const labels = providers.map((id) => getModel(id)?.label ?? id)
  return [...new Set(labels)].slice(0, max)
}

export interface FlowStep {
  readonly type: string
  readonly label: string
  readonly count: number
}

/** Structural nodes that are not steps of the flow. */
const NON_STEP_TYPES: ReadonlySet<string> = new Set(["sticky-note", "group"])

function stepSource(node: unknown): { type: string; x: number } | null {
  if (typeof node !== "object" || node === null) return null
  const { type, position } = node as { type?: unknown; position?: unknown }
  if (typeof type !== "string" || NON_STEP_TYPES.has(type)) return null
  const x = typeof position === "object" && position !== null ? (position as { x?: unknown }).x : undefined
  return { type, x: typeof x === "number" && Number.isFinite(x) ? x : Number.MAX_SAFE_INTEGER }
}

/**
 * The flow strip: the template's node types in canvas order (left to right),
 * each once, with how many nodes of that type the template has. Read straight
 * off the snapshot so it can never disagree with the canvas preview.
 */
export function flowSteps(snapshotNodes: readonly unknown[]): FlowStep[] {
  const ordered = snapshotNodes
    .map(stepSource)
    .filter((source): source is { type: string; x: number } => source !== null)
    .sort((a, b) => a.x - b.x)
  return ordered.reduce<FlowStep[]>((steps, { type }) => {
    const index = steps.findIndex((step) => step.type === type)
    if (index === -1) return [...steps, { type, label: getNodeTypeLabel(type), count: 1 }]
    return steps.map((step, i) => (i === index ? { ...step, count: step.count + 1 } : step))
  }, [])
}

/** "More like this": the same list minus the template itself, capped. */
export function relatedTemplates<T extends { readonly id: string }>(list: readonly T[], selfId: string, max: number): T[] {
  return list.filter((template) => template.id !== selfId).slice(0, max)
}
