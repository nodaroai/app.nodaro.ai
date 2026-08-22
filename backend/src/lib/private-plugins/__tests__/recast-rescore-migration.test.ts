import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  import.meta.dirname,
  "../../../../../supabase/migrations/332_recast_audio_rescore_transactions.sql",
)

function body(): string {
  return readFileSync(migrationPath, "utf8")
}

describe("Recast audio rescore transaction migration", () => {
  it("ships service-role-only claim, scoped-clear, and publish RPCs", () => {
    const sql = body()

    for (const signature of [
      "public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb)",
      "public.clear_recast_rescore_claim(uuid, uuid, uuid)",
      "public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)",
    ]) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
    }
  })

  it("serializes on the parent and checks both revision and live child", () => {
    const sql = body()

    expect(sql).toMatch(/FROM public\.jobs\s+WHERE id = p_recast_id[\s\S]*FOR UPDATE/)
    expect(sql).toContain("v_audio->>'revision' <> p_expected_audio_revision")
    expect(sql).toContain("v_pending_status IN ('pending', 'queued', 'processing')")
    expect(sql).toContain("v_pending_job_id <> p_child_job_id")
  })

  it("publishes parent state and child completion in the same function", () => {
    const sql = body()

    expect(sql).toContain("jsonb_build_object('rescore', p_rescore, 'audio', p_audio)")
    expect(sql).toContain("status = 'completed'")
    expect(sql).toContain("progress = 100")
    expect(sql).toContain("v_updated <> 1")
  })

  it("rejects malformed or policy-unsafe manifests before publication", () => {
    const sql = body()

    expect(sql).toContain("p_audio ? 'pendingRescore'")
    expect(sql).toContain("p_audio ? 'unscoredUrl'")
    expect(sql).toContain("v_present_keys <> v_baked_keys")
    expect(sql).toContain("NOT (v_layer_keys <@ v_present_keys)")
    expect(sql).toContain("p_audio->>'mode' = 'replace' AND p_audio->'present' ? 'video'")
  })
})
