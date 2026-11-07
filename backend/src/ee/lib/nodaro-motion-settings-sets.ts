/**
 * Nodaro Motion's stored settings sets, the rules (pure, beside the sections'
 * own reads): what a set holds, how an exported file is written and read
 * back, and what an imported or stored set is checked against.
 *
 * A set's `settings` is keyed by section (`NODARO_MOTION_SETTINGS_SECTIONS`,
 * admin-nodaro-motion.ts), each value the very body that section's PUT takes,
 * as that PUT stores it (`prepare`). So loading a set fills the page with
 * those bodies, and saving it sends each through its own route: the same
 * validation, engine checks and audit as a hand save. A section a set does
 * not name is not in that set: the page keeps the live value.
 *
 * The exported file is `{ format: "nodaro-motion-settings", version, exportedAt,
 * name, settings, omitted }`. `version` is the shape of `settings`; a file of an
 * older version is read through `SETTINGS_UPGRADES` (none yet), a newer one is
 * refused. `omitted` names the fields left out because they hold people's data
 * (a section's `privateFields`: the accounts that skip the Precise art-style
 * route); loading such a file keeps the live value of each field it names.
 */
import { z } from "zod"
import type { AnyNodaroMotionSettingsSection } from "./nodaro-motion-settings-section.js"

export const NODARO_MOTION_SETTINGS_FORMAT = "nodaro-motion-settings"

/** The shape of `settings` written today. Raise it only with an entry in `SETTINGS_UPGRADES` from the version before. */
export const NODARO_MOTION_SETTINGS_VERSION = 1

/**
 * How an older `settings` becomes the next version's, by the version it is read at. A file or a stored set of version
 * n is passed through n → n+1 → … → `NODARO_MOTION_SETTINGS_VERSION`. Pure; new objects.
 */
export const SETTINGS_UPGRADES: Readonly<Record<number, (settings: Readonly<Record<string, unknown>>) => Record<string, unknown>>> = {}

/** A set's settings: section key → that section's PUT body. */
export type NodaroMotionSettings = Record<string, unknown>

/** One thing wrong with a set or a file, at a path inside it. */
export interface SettingsProblem {
  path: string
  message: string
}

/** What a section of a set cannot be saved with yet (its route would refuse it), said on loading it. */
export interface SettingsWarning {
  section: string
  label: string
  message: string
}

/** A set's name: what the list shows and an exported file is named after. */
export const settingsSetNameSchema = z.string().trim().min(1, "Give the set a name.").max(120, "A set's name is at most 120 characters.")

const documentSchema = z.strictObject({
  format: z.literal(NODARO_MOTION_SETTINGS_FORMAT, { error: `Not a Nodaro Motion settings file (its "format" is not "${NODARO_MOTION_SETTINGS_FORMAT}").` }),
  version: z.int().min(1),
  exportedAt: z.string().optional(),
  name: z.string().optional(),
  settings: z.record(z.string(), z.unknown()),
  omitted: z.array(z.string()).optional(),
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** `settings` of `version` brought to today's version, or why it cannot be. */
export function upgradeSettings(settings: Readonly<Record<string, unknown>>, version: number): { settings: NodaroMotionSettings } | { error: string } {
  if (!Number.isInteger(version) || version < 1) return { error: `Unknown settings version ${version}.` }
  if (version > NODARO_MOTION_SETTINGS_VERSION) {
    return { error: `These settings are version ${version}, newer than this app reads (${NODARO_MOTION_SETTINGS_VERSION}): update the app first.` }
  }
  let out: NodaroMotionSettings = { ...settings }
  for (let v = version; v < NODARO_MOTION_SETTINGS_VERSION; v++) {
    const step = SETTINGS_UPGRADES[v]
    if (!step) return { error: `No way to read settings version ${v}.` }
    out = step(out)
  }
  return { settings: out }
}

/** An exported file read back: its name and today's settings (unchecked), or what is wrong with the file itself. */
export function readSettingsDocument(raw: unknown): { name: string | null; settings: NodaroMotionSettings; omitted: string[] } | { errors: SettingsProblem[] } {
  const parsed = documentSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => ({ path: i.path.length > 0 ? i.path.map(String).join(".") : "(file)", message: i.message })) }
  }
  const upgraded = upgradeSettings(parsed.data.settings, parsed.data.version)
  if ("error" in upgraded) return { errors: [{ path: "version", message: upgraded.error }] }
  const name = parsed.data.name?.trim()
  return { name: name ? name : null, settings: upgraded.settings, omitted: parsed.data.omitted ?? [] }
}

/**
 * Each section of `raw` parsed with its route's own body and stored form (`prepare`). A key that names no section, a
 * body its route would refuse, or a value it would never store is a problem at `settings.<key>…`; the sections that
 * pass are returned as their routes store them. Reads nothing.
 */
export function checkSettings(
  sections: readonly AnyNodaroMotionSettingsSection[],
  raw: unknown,
): { settings: NodaroMotionSettings; errors: SettingsProblem[] } {
  if (!isRecord(raw)) return { settings: {}, errors: [{ path: "settings", message: "Expected an object of settings, one per section." }] }
  const byKey = new Map(sections.map((s) => [s.key, s]))
  const settings: NodaroMotionSettings = {}
  const errors: SettingsProblem[] = []
  for (const [key, body] of Object.entries(raw)) {
    const section = byKey.get(key)
    if (!section) {
      errors.push({ path: `settings.${key}`, message: `Not a Nodaro Motion setting (the sections are ${sections.map((s) => s.key).join(", ")}).` })
      continue
    }
    const parsed = section.body.safeParse(body)
    if (!parsed.success) {
      for (const i of parsed.error.issues) errors.push({ path: [`settings.${key}`, ...i.path.map(String)].join("."), message: i.message })
      continue
    }
    const prepared = section.prepare(parsed.data)
    if ("refusal" in prepared) {
      const issues = prepared.refusal.error.issues
      if (issues && issues.length > 0) for (const i of issues) errors.push({ path: `settings.${key}.${i.path}`, message: i.message })
      else errors.push({ path: `settings.${key}`, message: prepared.refusal.error.message })
      continue
    }
    settings[key] = prepared.value
  }
  return { settings, errors }
}

/** The sections `settings` does not name, by label: loading it keeps their live values. */
export function sectionsLeftOut(sections: readonly AnyNodaroMotionSettingsSection[], settings: Readonly<NodaroMotionSettings>): string[] {
  return sections.filter((s) => !Object.hasOwn(settings, s.key)).map((s) => s.label)
}

function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur = obj
  for (const p of path) {
    if (!isRecord(cur) || !Object.hasOwn(cur, p)) return undefined
    cur = cur[p]
  }
  return cur
}

/** `obj` with the value at `path` set (`value` undefined: removed). New objects along the path; nothing else copied. */
function setAt(obj: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return obj
  const out = { ...obj }
  if (rest.length === 0) {
    if (value === undefined) delete out[head]
    else out[head] = value
    return out
  }
  const child = isRecord(out[head]) ? (out[head] as Record<string, unknown>) : {}
  out[head] = setAt(child, rest, value)
  return out
}

/** `settings` without any section's `privateFields`, and the ones it left out (`<section>.<field>`). New objects. */
export function withoutPrivateFields(
  sections: readonly AnyNodaroMotionSettingsSection[],
  settings: Readonly<NodaroMotionSettings>,
): { settings: NodaroMotionSettings; omitted: string[] } {
  const out: NodaroMotionSettings = { ...settings }
  const omitted: string[] = []
  for (const section of sections) {
    const body = out[section.key]
    if (!isRecord(body)) continue
    for (const field of section.privateFields ?? []) {
      const path = field.split(".")
      if (getAt(body, path) === undefined) continue
      out[section.key] = setAt(out[section.key] as Record<string, unknown>, path, undefined)
      omitted.push(`${section.key}.${field}`)
    }
  }
  return { settings: out, omitted }
}

/**
 * `settings` with each `privateFields` value its file left out (`omitted`, as the export named them) taken from the
 * live setting (`live`, by section key; null = never saved), and the fields so kept (`<section>.<field>`). A field
 * the file does not name as omitted is the file's own (absent: none), and a section it does not name stays out.
 */
export function withLivePrivateFields(
  sections: readonly AnyNodaroMotionSettingsSection[],
  settings: Readonly<NodaroMotionSettings>,
  live: Readonly<Record<string, unknown>>,
  omitted: readonly string[],
): { settings: NodaroMotionSettings; kept: string[] } {
  const out: NodaroMotionSettings = { ...settings }
  const kept: string[] = []
  for (const section of sections) {
    const body = out[section.key]
    if (!isRecord(body)) continue
    for (const field of section.privateFields ?? []) {
      const path = field.split(".")
      if (!omitted.includes(`${section.key}.${field}`) || getAt(body, path) !== undefined) continue
      const value = getAt(live[section.key], path)
      if (value === undefined) continue
      out[section.key] = setAt(out[section.key] as Record<string, unknown>, path, structuredClone(value))
      kept.push(`${section.key}.${field}`)
    }
  }
  return { settings: out, kept }
}

/** The file an export writes: `settings` without people's data, named, dated, versioned. */
export function settingsDocument(
  sections: readonly AnyNodaroMotionSettingsSection[],
  name: string,
  settings: Readonly<NodaroMotionSettings>,
  now: Date = new Date(),
) {
  const { settings: shared, omitted } = withoutPrivateFields(sections, settings)
  return {
    format: NODARO_MOTION_SETTINGS_FORMAT,
    version: NODARO_MOTION_SETTINGS_VERSION,
    exportedAt: now.toISOString(),
    name,
    settings: shared,
    ...(omitted.length > 0 ? { omitted } : {}),
  }
}

/**
 * What each section of `settings` would be refused for by its route today (the environments' engines), against the
 * live settings as the route's own check reads them (`live`, by section key). Writes nothing.
 */
export async function engineWarnings(
  sections: readonly AnyNodaroMotionSettingsSection[],
  settings: Readonly<NodaroMotionSettings>,
  live: Readonly<Record<string, unknown>>,
): Promise<SettingsWarning[]> {
  const out: SettingsWarning[] = []
  for (const section of sections) {
    if (!section.engineRefusal || !Object.hasOwn(settings, section.key)) continue
    const refusal = await section.engineRefusal(settings[section.key], live[section.key] ?? null)
    if (refusal) out.push({ section: section.key, label: section.label, message: refusal.error.message })
  }
  return out
}

/** Every section's live body (null: never saved), by key. */
export async function readLiveSettings(sections: readonly AnyNodaroMotionSettingsSection[]): Promise<Record<string, unknown>> {
  const entries = await Promise.all(sections.map(async (s) => [s.key, await s.readLive()] as const))
  return Object.fromEntries(entries)
}
