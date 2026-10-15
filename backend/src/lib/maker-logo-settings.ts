import { MODEL_MAKERS, isModelMakerId, type ModelMakerId } from "@nodaro/shared/model-catalog"

/**
 * The `app_settings` row that declares which makers' marks this deployment
 * publishes: an array of maker ids (`MODEL_MAKERS` in `@nodaro/shared`), e.g.
 * `["google", "openai"]`. Absent = none, so no migration seeds it.
 *
 * Declaring is the operator's decision to show a company's mark; it is not
 * enough on its own — `maker-logos.ts` publishes an address only once storage
 * holds the file too. Read by `app-settings.ts`, written through
 * `PUT /v1/admin/settings/model_maker_logos` (Business / Cloud) or SQL
 * (Community). Operator steps: docs/deployment.md, "Model maker marks".
 */
export const MODEL_MAKER_LOGOS_KEY = "model_maker_logos"

/**
 * The tolerant read (the row may have been written by hand): the known maker
 * ids it lists, once each, in the order given. Anything that is not an array
 * reads as nothing declared, and an entry that names no maker is dropped.
 */
export function parseModelMakerLogos(value: unknown): ModelMakerId[] {
  if (!Array.isArray(value)) return []
  const ids: ModelMakerId[] = []
  for (const entry of value) {
    if (isModelMakerId(entry) && !ids.includes(entry)) ids.push(entry)
  }
  return ids
}

/**
 * The admin write's check: null for a list of known maker ids (the empty list
 * withdraws every mark), otherwise the message to refuse it with. Refuses
 * exactly what the reader would silently drop, so a typo cannot pass as
 * "declared".
 */
export function modelMakerLogosError(value: unknown): string | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return `${MODEL_MAKER_LOGOS_KEY} must be an array of maker ids, e.g. ["google", "openai"]`
  }
  const unknown = value.filter((entry) => !isModelMakerId(entry))
  if (unknown.length === 0) return null
  return `${MODEL_MAKER_LOGOS_KEY}: unknown maker id: ${unknown.join(", ")}. Known ids: ${Object.keys(MODEL_MAKERS).join(", ")}`
}
