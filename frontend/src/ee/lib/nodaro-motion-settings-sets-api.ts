import { getAuthHeaders } from "@/lib/api"

/**
 * Admin → Nodaro Motion's stored settings sets: the client of
 * `/v1/admin/nodaro-motion/settings-sets` (backend
 * `ee/routes/admin-nodaro-motion-settings-sets.ts`), typed. The wire types
 * mirror the server's; keep them in step.
 *
 * Nothing here writes a live setting: a set is loaded into the page as a
 * draft, and the page saves each section through that section's own route.
 * A failure becomes a `SettingsSetsApiError` with the server's code, sentence
 * and, for a refused set, every problem (`issues`).
 */

/** A set's settings: section key → that section's PUT body. */
export type MotionSettings = Record<string, unknown>

export interface MotionSettingsSectionInfo {
  key: string
  label: string
  path: string
  /** Fields of the body (dot paths) left out of an exported file: people's data. */
  privateFields: string[]
}

export interface MotionSettingsSet {
  id: string
  name: string
  settings: MotionSettings
  /** Why the stored settings cannot be read any more; its settings are then empty. */
  unreadable: string | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
  /** When the live settings last matched this set; null: never. */
  liveAt: string | null
}

export interface MotionSettingsSetsList {
  sets: MotionSettingsSet[]
  /** Every section a set holds, in the order a draft saves them. */
  sections: MotionSettingsSectionInfo[]
  format: string
  version: number
}

export interface MotionSettingsProblem {
  path: string
  message: string
}

/** What a section of a set cannot be saved with yet: its route's own refusal. */
export interface MotionSettingsWarning {
  section: string
  label: string
  message: string
}

export interface MotionSettingsCheck {
  valid: boolean
  name: string | null
  /** The file's settings as each route stores them (only when valid). */
  settings: MotionSettings
  errors: MotionSettingsProblem[]
  warnings: MotionSettingsWarning[]
  notes: string[]
}

/** The exported file. */
export interface MotionSettingsDocument {
  format: string
  version: number
  exportedAt: string
  name: string
  settings: MotionSettings
  omitted?: string[]
}

export class SettingsSetsApiError extends Error {
  readonly code: string
  readonly status: number
  readonly issues: MotionSettingsProblem[]

  constructor(code: string, message: string, status: number, issues: MotionSettingsProblem[]) {
    super(message)
    this.name = "SettingsSetsApiError"
    this.code = code
    this.status = status
    this.issues = issues
  }
}

const BASE = "/v1/admin/nodaro-motion/settings-sets"

async function failureFrom(res: Response): Promise<SettingsSetsApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown; issues?: unknown } } | null
  const code = payload?.error?.code
  const message = payload?.error?.message
  const issues = Array.isArray(payload?.error?.issues) ? (payload!.error!.issues as MotionSettingsProblem[]) : []
  return new SettingsSetsApiError(
    typeof code === "string" && code !== "" ? code : "http_error",
    typeof message === "string" && message !== "" ? message : `The request failed (HTTP ${res.status}).`,
    res.status,
    issues,
  )
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: object): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(await getAuthHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw await failureFrom(res)
  return ((await res.json()) as { data: T }).data
}

export function fetchMotionSettingsSets(): Promise<MotionSettingsSetsList> {
  return call("GET", BASE)
}

export function createMotionSettingsSet(name: string, settings: MotionSettings): Promise<{ set: MotionSettingsSet; warnings: MotionSettingsWarning[] }> {
  return call("POST", BASE, { name, settings })
}

export function updateMotionSettingsSet(
  id: string,
  change: { name?: string; settings?: MotionSettings },
): Promise<{ set: MotionSettingsSet; warnings: MotionSettingsWarning[] }> {
  return call("PUT", `${BASE}/${encodeURIComponent(id)}`, change)
}

export function deleteMotionSettingsSet(id: string): Promise<{ id: string }> {
  return call("DELETE", `${BASE}/${encodeURIComponent(id)}`)
}

export function markMotionSettingsSetLive(id: string): Promise<{ set: MotionSettingsSet }> {
  return call("POST", `${BASE}/${encodeURIComponent(id)}/live`, {})
}

export function checkMotionSettingsDocument(document: unknown): Promise<MotionSettingsCheck> {
  return call("POST", `${BASE}/check`, { document })
}

export function exportMotionSettings(name: string, settings: MotionSettings): Promise<MotionSettingsDocument> {
  return call("POST", `${BASE}/export`, { name, settings })
}
