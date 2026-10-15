import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * What the SERVER needs to know about a HAND-DECLARED app field (NODE_DEFINITIONS `exposableFields`) whose
 * values are a known set: a select or an aspect-ratio card (its option values, as the field stores them — the
 * option string, `exposedOptionValue`), or a toggle (true / false). The backend cannot import the node
 * definitions, and several compute their options (`MODIFY_IMAGE_MODELS.map(...)`), which a textual parse cannot
 * read — so this is rendered into a generated table (`backend/src/lib/mcp/generated/exposable-declared-fields.ts`,
 * held to this by `__tests__/exposable-declared-fields-table.test.ts`), as the strip-derived fields are.
 *
 * The server types such a field by it in `get_app_inputs`, and prices a published app's "up to" figure over
 * every value it can take. Sliders have their own table (gen:skills' `exposable-sliders.ts`); free text has no
 * set of values.
 */
export interface ExposableDeclaredFieldSpec {
  readonly kind: "select" | "toggle"
  readonly values: ReadonlyArray<string | boolean>
}

/** Node type → declared field key → its values, for every node type with such a field. */
export function exposableDeclaredFieldSpecs(): Record<string, Record<string, ExposableDeclaredFieldSpec>> {
  const out: Record<string, Record<string, ExposableDeclaredFieldSpec>> = {}
  for (const def of [...NODE_DEFINITIONS].sort((a, b) => (a.type < b.type ? -1 : 1))) {
    const specs: Record<string, ExposableDeclaredFieldSpec> = {}
    for (const field of [...(def.exposableFields ?? [])].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      if (field.type === "toggle") {
        specs[field.key] = { kind: "toggle", values: [true, false] }
      } else if ((field.type === "select" || field.type === "aspect-ratio") && field.options && field.options.length > 0) {
        specs[field.key] = { kind: "select", values: field.options.map((o) => o.value) }
      }
    }
    if (Object.keys(specs).length > 0) out[def.type as string] = specs
  }
  return out
}

/** The generated backend module's source. Deterministic: sorted keys, values in declared order, no labels. */
export function renderExposableDeclaredFieldsModule(specs: Record<string, Record<string, ExposableDeclaredFieldSpec>>): string {
  const lines: string[] = [
    "// GENERATED from the frontend's NODE_DEFINITIONS exposableFields (through",
    "// frontend/src/components/presentation/exposable-declared-field-spec.ts) — do NOT hand-edit.",
    "// Held to them by frontend/src/components/presentation/__tests__/exposable-declared-fields-table.test.ts; regenerate with",
    "//   cd frontend && npx vitest run src/components/presentation/__tests__/exposable-declared-fields-table.test.ts -u",
    "// Values only (what a hand-declared select / aspect-ratio / toggle field stores), no labels and no prices.",
    "",
    "export interface ExposableDeclaredFieldSpec {",
    "  /** A select (or aspect-ratio) card, or a toggle. */",
    '  readonly kind: "select" | "toggle"',
    "  /** Every value the field can take. */",
    "  readonly values: ReadonlyArray<string | boolean>",
    "}",
    "",
    "/** Node type → hand-declared app field → what it takes. */",
    "export const EXPOSABLE_DECLARED_FIELDS: Readonly<Record<string, Readonly<Record<string, ExposableDeclaredFieldSpec>>>> = {",
  ]
  for (const [type, fields] of Object.entries(specs)) {
    lines.push(`  ${JSON.stringify(type)}: {`)
    for (const [key, s] of Object.entries(fields)) {
      lines.push(`    ${JSON.stringify(key)}: { kind: ${JSON.stringify(s.kind)}, values: ${JSON.stringify(s.values)} },`)
    }
    lines.push("  },")
  }
  lines.push("}", "")
  return lines.join("\n")
}
