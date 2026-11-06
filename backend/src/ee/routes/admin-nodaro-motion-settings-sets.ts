/**
 * Nodaro Motion's stored settings sets (registered by `adminNodaroMotionRoutes`,
 * admin-nodaro-motion.ts, so they share its edition gate). Admin-only.
 *
 *   GET    /v1/admin/nodaro-motion/settings-sets              every set, and the sections a set holds
 *   POST   /v1/admin/nodaro-motion/settings-sets              { name, settings }: store a new set (201)
 *   PUT    /v1/admin/nodaro-motion/settings-sets/:id          { name?, settings? }: rename and/or overwrite it
 *   DELETE /v1/admin/nodaro-motion/settings-sets/:id          delete it
 *   POST   /v1/admin/nodaro-motion/settings-sets/:id/live     the live settings match it now (the page saw it)
 *   POST   /v1/admin/nodaro-motion/settings-sets/check        { document }: an exported file, checked as an import
 *   POST   /v1/admin/nodaro-motion/settings-sets/export       { name, settings }: the file to export
 *
 * A set is a named copy of every setting the page edits (`NODARO_MOTION_SETTINGS_SECTIONS`):
 * `settings` keyed by section, each value the body of that section's PUT, as it
 * stores it (lib/nodaro-motion-settings-sets.ts). NOTHING here writes a live
 * setting: the page loads a set as a draft, and its Save sends each section
 * that differs through that section's own PUT (validation, engine checks,
 * audit). These settings are shared by every environment (one database), so
 * a set is never applied by itself.
 *
 * A set, a rename and an import are checked with each section's own body and
 * stored form: a key that names no section, or a value its route refuses, is
 * 400 `validation_error` with every problem listed (`issues`). What the
 * environments' engines cannot run yet is never a reason to refuse a set: it
 * is answered as `warnings` (the route's own refusal, said in its words), and
 * Save is refused then by that route.
 *
 * Each write leaves an `admin_actions` row (`create_`, `update_`,
 * `delete_nodaro_motion_settings_set`) under the set's id.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { requireAdmin } from "../middleware/require-admin.js"
import type { AnyNodaroMotionSettingsSection } from "../lib/nodaro-motion-settings-section.js"
import {
  NODARO_MOTION_SETTINGS_FORMAT,
  NODARO_MOTION_SETTINGS_VERSION,
  checkSettings,
  engineWarnings,
  readLiveSettings,
  readSettingsDocument,
  sectionsLeftOut,
  settingsDocument,
  settingsSetNameSchema,
  upgradeSettings,
  withLivePrivateFields,
  type SettingsProblem,
} from "../lib/nodaro-motion-settings-sets.js"
import {
  SettingsSetNameTakenError,
  adminEmails,
  createSettingsSet,
  deleteSettingsSet,
  getSettingsSet,
  listSettingsSets,
  markSettingsSetLive,
  updateSettingsSet,
  type NodaroMotionSettingsSetRow,
} from "../lib/nodaro-motion-settings-sets-store.js"
import { audit } from "./admin-trends-lifecycle.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const createBody = z.strictObject({ name: settingsSetNameSchema, settings: z.record(z.string(), z.unknown()) })
const updateBody = z
  .strictObject({ name: settingsSetNameSchema.optional(), settings: z.record(z.string(), z.unknown()).optional() })
  .refine((b) => b.name !== undefined || b.settings !== undefined, { message: "Send a new name, new settings, or both." })
const checkBody = z.strictObject({ document: z.unknown() })
const exportBody = z.strictObject({ name: settingsSetNameSchema, settings: z.record(z.string(), z.unknown()) })

export interface NodaroMotionSettingsSetView {
  id: string
  name: string
  /** Today's shape of the stored settings (an older set is read through the upgrades). */
  settings: Record<string, unknown>
  /** Why the stored settings cannot be read any more (a version this app has no way to read); its settings are then empty. */
  unreadable: string | null
  createdAt: string
  /** The admin's email; null when unknown. */
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
  /** When the live settings last matched this set (the page marks it); null: never. */
  liveAt: string | null
}

function viewOf(row: NodaroMotionSettingsSetRow, emails: ReadonlyMap<string, string>): NodaroMotionSettingsSetView {
  const upgraded = upgradeSettings(row.settings ?? {}, row.format_version)
  return {
    id: row.id,
    name: row.name,
    settings: "settings" in upgraded ? upgraded.settings : {},
    unreadable: "error" in upgraded ? upgraded.error : null,
    createdAt: row.created_at,
    createdBy: row.created_by ? (emails.get(row.created_by) ?? null) : null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ? (emails.get(row.updated_by) ?? null) : null,
    liveAt: row.live_at,
  }
}

async function viewsOf(rows: readonly NodaroMotionSettingsSetRow[]): Promise<NodaroMotionSettingsSetView[]> {
  const emails = await adminEmails(rows.flatMap((r) => [r.created_by, r.updated_by].filter((id): id is string => !!id)))
  return rows.map((r) => viewOf(r, emails))
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

/** 400 naming every problem of a set's settings (`formatZodError`'s message style). */
function settingsRefused(reply: FastifyReply, problems: readonly SettingsProblem[]) {
  const first = problems[0]!
  const head = `${first.path}: ${first.message}`
  return reply.status(400).send({
    error: { code: "validation_error", message: problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head, issues: problems },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "not_found", message: "No stored set with that id." } })
}

function nameTaken(reply: FastifyReply, e: SettingsSetNameTakenError) {
  return reply.status(409).send({ error: { code: "name_taken", message: e.message } })
}

export function registerNodaroMotionSettingsSetsRoutes(app: FastifyInstance, sections: readonly AnyNodaroMotionSettingsSection[]): void {
  const sectionList = sections.map((s) => ({ key: s.key, label: s.label, path: s.path, privateFields: [...(s.privateFields ?? [])] }))

  app.get("/v1/admin/nodaro-motion/settings-sets", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return {
        data: {
          sets: await viewsOf(await listSettingsSets()),
          sections: sectionList.map((s) => ({ ...s, privateFields: [...s.privateFields] })),
          format: NODARO_MOTION_SETTINGS_FORMAT,
          version: NODARO_MOTION_SETTINGS_VERSION,
        },
      }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion settings sets")
    }
  })

  app.post("/v1/admin/nodaro-motion/settings-sets", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const checked = checkSettings(sections, parsed.data.settings)
    if (checked.errors.length > 0) return settingsRefused(reply, checked.errors)
    try {
      const row = await createSettingsSet({
        name: parsed.data.name,
        settings: checked.settings,
        formatVersion: NODARO_MOTION_SETTINGS_VERSION,
        adminId: req.userId!,
      })
      await audit(req, "create_nodaro_motion_settings_set", "nodaro_motion_settings_set", row.id, { name: row.name, sections: Object.keys(row.settings) })
      const warnings = await engineWarnings(sections, checked.settings, await readLiveSettings(sections))
      return reply.status(201).send({ data: { set: (await viewsOf([row]))[0], warnings } })
    } catch (e) {
      if (e instanceof SettingsSetNameTakenError) return nameTaken(reply, e)
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion settings set")
    }
  })

  app.put("/v1/admin/nodaro-motion/settings-sets/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const checked = parsed.data.settings === undefined ? null : checkSettings(sections, parsed.data.settings)
    if (checked && checked.errors.length > 0) return settingsRefused(reply, checked.errors)
    try {
      const before = await getSettingsSet(id)
      if (!before) return notFound(reply)
      const row = await updateSettingsSet(id, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(checked ? { settings: checked.settings, formatVersion: NODARO_MOTION_SETTINGS_VERSION } : {}),
        adminId: req.userId!,
      })
      if (!row) return notFound(reply)
      await audit(req, "update_nodaro_motion_settings_set", "nodaro_motion_settings_set", id, {
        name: row.name,
        ...(parsed.data.name !== undefined && before.name !== row.name ? { renamedFrom: before.name } : {}),
        ...(checked ? { before: before.settings, after: row.settings } : {}),
      })
      const warnings = checked ? await engineWarnings(sections, checked.settings, await readLiveSettings(sections)) : []
      return { data: { set: (await viewsOf([row]))[0], warnings } }
    } catch (e) {
      if (e instanceof SettingsSetNameTakenError) return nameTaken(reply, e)
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion settings set")
    }
  })

  app.delete("/v1/admin/nodaro-motion/settings-sets/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    try {
      const row = await deleteSettingsSet(id)
      if (!row) return notFound(reply)
      // The whole set in the audit row: a deleted set can be put back from it.
      await audit(req, "delete_nodaro_motion_settings_set", "nodaro_motion_settings_set", id, {
        name: row.name,
        formatVersion: row.format_version,
        settings: row.settings,
      })
      return { data: { id } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to delete the Nodaro Motion settings set")
    }
  })

  app.post("/v1/admin/nodaro-motion/settings-sets/:id/live", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    try {
      const row = await markSettingsSetLive(id)
      if (!row) return notFound(reply)
      return { data: { set: (await viewsOf([row]))[0] } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to mark the Nodaro Motion settings set")
    }
  })

  // An imported file, checked: the page loads it as a draft or stores it only after this. Writes nothing.
  app.post("/v1/admin/nodaro-motion/settings-sets/check", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = checkBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const doc = readSettingsDocument(parsed.data.document)
      if ("errors" in doc) return { data: { valid: false, name: null, settings: {}, errors: doc.errors, warnings: [], notes: [] } }
      const checked = checkSettings(sections, doc.settings)
      if (checked.errors.length > 0) return { data: { valid: false, name: doc.name, settings: {}, errors: checked.errors, warnings: [], notes: [] } }
      const live = await readLiveSettings(sections)
      const { settings, kept } = withLivePrivateFields(sections, checked.settings, live, doc.omitted)
      const label = (key: string) => sections.find((s) => s.key === key)?.label ?? key
      const notes = [
        ...sectionsLeftOut(sections, settings).map((l) => `${l}: not in this file, the live setting is kept.`),
        ...kept.map((field) => `${label(field.split(".")[0]!)}: ${field.split(".").slice(2).join(".")} is not exported, the live value is kept.`),
      ]
      const warnings = await engineWarnings(sections, settings, live)
      return { data: { valid: true, name: doc.name, settings, errors: [], warnings, notes } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to check the Nodaro Motion settings file")
    }
  })

  // The file of a set (or of the page's live settings): people's data left out. Writes nothing.
  app.post("/v1/admin/nodaro-motion/settings-sets/export", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = exportBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const checked = checkSettings(sections, parsed.data.settings)
    if (checked.errors.length > 0) return settingsRefused(reply, checked.errors)
    return { data: settingsDocument(sections, parsed.data.name, checked.settings) }
  })
}
