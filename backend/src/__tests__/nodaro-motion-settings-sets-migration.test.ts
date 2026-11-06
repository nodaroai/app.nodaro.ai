// @test-watches supabase/migrations/606_nodaro_motion_settings_sets.sql
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Migration 606: `nodaro_motion_settings_sets`, Nodaro Motion's stored
 * settings sets (ee/routes/admin-nodaro-motion-settings-sets.ts). An admin
 * table the API alone reads and writes; never `app_settings`, so a set can
 * never be read as a live setting.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(HERE, "../../../supabase/migrations/606_nodaro_motion_settings_sets.sql"), "utf8")
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")

describe("migration 606 — Nodaro Motion settings sets", () => {
  it("creates the table idempotently, with a name, a format version and the settings object", () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.nodaro_motion_settings_sets \(/i)
    expect(code).toMatch(/name\s+TEXT NOT NULL CHECK \(char_length\(btrim\(name\)\) BETWEEN 1 AND 120\)/i)
    expect(code).toMatch(/format_version\s+INTEGER NOT NULL CHECK \(format_version >= 1\)/i)
    expect(code).toMatch(/settings\s+JSONB NOT NULL CHECK \(jsonb_typeof\(settings\) = 'object'\)/i)
    expect(code).toMatch(/created_by\s+UUID REFERENCES public\.profiles\(id\) ON DELETE SET NULL/i)
    expect(code).toMatch(/updated_by\s+UUID REFERENCES public\.profiles\(id\) ON DELETE SET NULL/i)
    expect(code).toMatch(/live_at\s+TIMESTAMPTZ\s*\n/i)
  })

  it("keeps names unique, case aside", () => {
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS nodaro_motion_settings_sets_name_key\s+ON public\.nodaro_motion_settings_sets \(lower\(btrim\(name\)\)\);/i)
  })

  it("is reachable only through the API: RLS on, no client grants, no policy", () => {
    expect(code).toMatch(/ALTER TABLE public\.nodaro_motion_settings_sets ENABLE ROW LEVEL SECURITY;/)
    expect(code).toMatch(/REVOKE ALL ON public\.nodaro_motion_settings_sets FROM PUBLIC, anon, authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.nodaro_motion_settings_sets TO service_role;/)
    expect(code).not.toMatch(/CREATE POLICY/i)
    expect(code).not.toMatch(/app_settings/i)
  })
})
