import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  import.meta.dirname,
  "../../../../../supabase/migrations/334_recast_audio_rescore_transactions.sql",
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

  it("keeps private remux bases outside owner-readable jobs JSON", () => {
    const sql = body()

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.recast_audio_bases")
    expect(sql).toContain("ALTER TABLE public.recast_audio_bases ENABLE ROW LEVEL SECURITY")
    expect(sql).toContain("REVOKE ALL ON TABLE public.recast_audio_bases FROM anon")
    expect(sql).toContain("REVOKE ALL ON TABLE public.recast_audio_bases FROM authenticated")
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recast_audio_bases TO service_role")
    expect(sql).toContain("output_data->'pro'->>'unscoredUrl'")
    expect(sql).toContain("(output_data->'pro') - 'unscoredUrl'")
    expect(sql).toContain("CREATE OR REPLACE FUNCTION pg_temp.strip_recast_private_audio_url")
    expect(sql).toContain("SET input_data = pg_temp.strip_recast_private_audio_url(input_data)")
    expect(sql).toContain("SET output_data = pg_temp.strip_recast_private_audio_url(output_data)")
    expect(sql).toContain("CONSTRAINT jobs_no_private_recast_audio_url")
    expect(sql).toContain("jsonb_path_exists(coalesce(input_data, '{}'::jsonb), '$.**.unscoredUrl')")
    expect(sql).toContain("jsonb_path_exists(coalesce(output_data, '{}'::jsonb), '$.**.unscoredUrl')")
  })

  it("serializes on the parent and checks both revision and live child", () => {
    const sql = body()

    expect(sql).toMatch(/FROM public\.jobs\s+WHERE id = p_recast_id[\s\S]*FOR UPDATE/)
    expect(sql).toContain("v_audio->>'revision' <> p_expected_audio_revision")
    expect(sql).toContain("v_pending_status IN ('pending', 'queued', 'processing')")
    expect(sql).toContain("v_pending_job_id <> p_child_job_id")
    expect(sql).toMatch(/SELECT \* INTO v_child[\s\S]*WHERE id = p_child_job_id[\s\S]*FOR UPDATE/)
  })

  it("fails closed for nullable ownership/status fields", () => {
    const sql = body()

    expect(sql).toContain("v_parent.user_id IS DISTINCT FROM p_user_id")
    expect(sql).toContain("v_parent.status IS DISTINCT FROM 'completed'")
    expect(sql).toContain("v_gvp.user_id IS DISTINCT FROM p_user_id")
    expect(sql).toContain("v_child.user_id IS DISTINCT FROM p_user_id")
    expect(sql.match(/v_gvp\.status IS DISTINCT FROM 'completed'/g)).toHaveLength(3)
    expect(sql.match(/WHERE id = p_gvp_job_id\s+FOR SHARE/g)).toHaveLength(3)
    expect(sql).not.toContain("v_parent.user_id <> p_user_id")
    expect(sql).not.toContain("v_child.user_id <> p_user_id")
  })

  it("selects audio from the current GVP run instead of a stale parent take", () => {
    const sql = body()

    expect(sql).toContain("v_audio := v_gvp.output_data->'pro'->'audio'")
    expect(sql).toContain("v_parent.output_data->'rescore'->>'gvpJobId' = p_gvp_job_id::text")
    expect(sql).toContain("v_pending_recast_id IS NOT DISTINCT FROM p_recast_id::text")
    expect(sql).toContain("v_pending_gvp_job_id IS NOT DISTINCT FROM p_gvp_job_id::text")
  })

  it("publishes parent state and child completion in the same function", () => {
    const sql = body()

    expect(sql).toContain("jsonb_build_object('rescore', p_rescore, 'audio', p_audio)")
    expect(sql).toContain("status = 'completed'")
    expect(sql).toContain("progress = 100")
    expect(sql).toContain("v_updated <> 1")
  })

  it("treats an exact completed publication as an idempotent retry", () => {
    const sql = body()

    expect(sql).toContain("IF v_child.status = 'completed' THEN")
    expect(sql).toContain("v_parent.output_data->'audio' IS NOT DISTINCT FROM p_audio")
    expect(sql).toContain("v_parent.output_data->'rescore' IS NOT DISTINCT FROM p_rescore")
    expect(sql).toContain("v_child.output_data->'audio' IS NOT DISTINCT FROM p_audio")
  })

  it("gives legacy clients the same atomic parent-and-child publication boundary", () => {
    const sql = body()
    const signature = "public.publish_legacy_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb)"

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.publish_legacy_recast_rescore")
    expect(sql).toMatch(/publish_legacy_recast_rescore[\s\S]*FROM public\.jobs[\s\S]*FOR UPDATE/)
    expect(sql).toContain("jsonb_build_object('rescore', p_rescore)")
    expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
  })

  it("rejects malformed or policy-unsafe manifests before publication", () => {
    const sql = body()

    expect(sql).toContain("p_audio ? 'pendingRescore'")
    expect(sql).toContain("jsonb_path_exists(p_pending_rescore, '$.**.unscoredUrl')")
    expect(sql).toContain("jsonb_path_exists(p_audio, '$.**.unscoredUrl')")
    expect(sql).toContain("jsonb_path_exists(p_rescore, '$.**.unscoredUrl')")
    expect(sql).not.toContain("p_audio ? 'unscoredUrl'")
    expect(sql).not.toContain("p_rescore ? 'unscoredUrl'")
    expect(sql).toContain("jsonb_typeof(p_pending_rescore) IS DISTINCT FROM 'object'")
    expect(sql).toContain("key NOT IN ('version', 'revision', 'mode', 'present', 'layers', 'bakedEffectiveGain')")
    expect(sql).toContain("split_part(p_result_url, '?', 1)")
    expect(sql).toContain("split_part(value->>'url', '?', 1)")
    expect(sql).toContain("split_part(v_private_base, '?', 1)")
    expect(sql).toContain("v_present_keys <> v_baked_keys")
    expect(sql).toContain("NOT (v_layer_keys <@ v_present_keys)")
    expect(sql).toContain("p_audio->>'mode' = 'replace' AND p_audio->'present' ? 'video'")
    expect(sql).toContain("jsonb_typeof(p_audio->'version') IS DISTINCT FROM 'number'")
    expect(sql).toContain("jsonb_typeof(p_audio->'revision') IS DISTINCT FROM 'string'")
    expect(sql).toContain("jsonb_typeof(value->'url') IS DISTINCT FROM 'string'")
    expect(sql).toContain("jsonb_typeof(p_rescore->'tracks') IS DISTINCT FROM 'array'")
    expect(sql).toContain("key NOT IN ('videoUrl', 'gvpJobId', 'tracks', 'preparedMusicUrl', 'audioUrl', 'at')")
    expect(sql).toContain("p_rescore->>'preparedMusicUrl' IS DISTINCT FROM p_audio->'layers'->'music'->>'url'")
    expect(sql).toContain("invalid Recast audio provenance invariants")
  })

  it("validates the public pending stamp and its child snapshot as one contract", () => {
    const sql = body()

    expect(sql).toContain("v_child.input_data->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision")
    expect(sql).toContain("v_child.input_data->>'requestId' IS DISTINCT FROM p_pending_rescore->>'requestId'")
    expect(sql).toContain("v_private_base")
    expect(sql).toContain("FROM public.recast_audio_bases")
    expect(sql).not.toContain("v_child.input_data->>'unscoredUrl'")
    expect(sql).toContain("jsonb_typeof(p_pending_rescore->'requestId') IS DISTINCT FROM 'string'")
    expect(sql).toContain("key NOT IN ('jobId', 'requestId', 'state', 'expectedAudioRevision', 'requestedEffectiveGain')")
    expect(sql).toContain("gain_key NOT IN ('music', 'video')")
    expect(sql).toContain("jsonb_typeof(gain_value) <> 'number'")
    expect(sql).toContain("p_audio->'bakedEffectiveGain' IS DISTINCT FROM v_current_audio->'pendingRescore'->'requestedEffectiveGain'")
    expect(sql).toContain("p_audio->>'mode' IS DISTINCT FROM v_current_audio->>'mode'")
  })

  it("atomically captures private bases before a workflow cascade deletes their rows", () => {
    const sql = body()
    const signature = "public.delete_workflow_with_recast_cleanup(uuid, uuid)"

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_workflow_with_recast_cleanup")
    expect(sql).toMatch(/FROM public\.workflows[\s\S]*FOR UPDATE/)
    expect(sql).toContain("LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE")
    expect(sql).toMatch(/FROM public\.recast_audio_bases[\s\S]*JOIN public\.jobs/)
    expect(sql).toContain("DELETE FROM public.workflows")
    expect(sql).toContain("'baseUrls', v_base_urls")
    expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
  })

  it("captures private bases when deleting a project that cascades workflows", () => {
    const sql = body()
    const signature = "public.delete_project_with_recast_cleanup(uuid, uuid)"

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_project_with_recast_cleanup")
    expect(sql).toMatch(/FROM public\.projects[\s\S]*FOR UPDATE/)
    expect(sql).toContain("LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE")
    expect(sql).toMatch(/JOIN public\.workflows[\s\S]*project_id = p_project_id/)
    expect(sql).toContain("DELETE FROM public.projects")
    expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
  })

  it("captures private bases when an owner or admin deletes a job subtree", () => {
    const sql = body()
    const signature = "public.delete_job_with_recast_cleanup(uuid, uuid, boolean)"

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_job_with_recast_cleanup")
    expect(sql).toContain("p_is_admin OR user_id = p_actor_user_id")
    expect(sql).toContain("WITH RECURSIVE deleting_jobs(id) AS")
    expect(sql).not.toMatch(/WITH RECURSIVE deleting_jobs\(id\) AS \([\s\S]*?UNION ALL/)
    expect(sql).toContain("child.parent_job_id = deleting_jobs.id")
    expect(sql).toContain("DELETE FROM public.jobs")
    expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
  })
})
