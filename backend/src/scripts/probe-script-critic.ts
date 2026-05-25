/**
 * Diagnostic — direct-calls the Script Critic against three controlled
 * ShowrunnerPlan fixtures so we can observe the critic's actual severity
 * classification end-to-end against the live LLM. Useful as a regression
 * check whenever the critic prompt or model is changed: re-run this and
 * verify the clean plan returns 0 blocking issues.
 *
 * Fixtures:
 *   1. cleanPlan        — well-formed by every spec rule; should be 0 blocking
 *   2. brokenRosterPlan — scene references a missing cast_key; should be 1 blocking (consistency)
 *   3. badDurationPlan  — sum 30s vs target 60s; should be 1 blocking (duration)
 *
 * Critic verdicts aren't persisted server-side today (llm_calls stores
 * metadata + tokens only, not response body), so this script is the
 * fastest way to see what the critic actually returns without spinning up
 * Redis + worker + API or browser-testing a full pipeline.
 *
 * Usage:  cd backend && npx tsx src/scripts/probe-script-critic.ts
 *
 * Hard-requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in backend/.env
 * (loaded transitively via lib/config.js). Also requires the LLM provider
 * env (ANTHROPIC_API_KEY etc.) since callLLM hits Anthropic for real.
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { runScriptCritic } from "../ee/pipelines/llms/script-critic.js"

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

// ── Find a real (pipeline_id, stage_id, user_id) triple so the llm_calls
//    INSERT satisfies FK constraints. Picks the latest existing stage row.
async function loadFkTriple(): Promise<{
  pipelineId: string
  stageId: string
  userId: string
}> {
  const { data: stages, error: e1 } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline_id")
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(1)
  if (e1 || !stages || stages.length === 0) {
    throw new Error(
      `no pipeline_stages row available for FK; query error=${e1?.message}`,
    )
  }
  const stageId = stages[0]!.id as string
  const pipelineId = stages[0]!.pipeline_id as string

  const { data: p, error: e2 } = await supabase
    .from("pipelines")
    .select("user_id")
    .eq("id", pipelineId)
    .single()
  if (e2 || !p) {
    throw new Error(`could not fetch pipeline user_id; query error=${e2?.message}`)
  }
  return { pipelineId, stageId, userId: p.user_id as string }
}

// ── A well-formed plan that satisfies every spec rule the Showrunner is
//    supposed to honor: roster refs all resolve, durations sum within ±10%
//    of target, shot_count_hint_sum ∈ [3,40], beats progress monotonically,
//    dialogue feasible (≤3 words/sec), descriptions externally depictable.
//    If the critic FAILS this plan, the critic prompt is the problem.
function cleanPlan(): ShowrunnerPlan {
  return {
    title: "The Last Letter",
    logline: "An elderly veteran finds a long-lost letter from his wartime love.",
    target_duration_seconds: 30,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["intimate", "nostalgic"],
    cast: [
      {
        key: "veteran",
        name: "Old Veteran",
        role: "protagonist",
        visual_description:
          "Late-70s man, weathered face, neat military-cut grey hair, blue cardigan.",
        voice_profile: "Gentle, gravelly, slow",
        has_dialogue: false,
        angle_count_hint: 3,
        expression_set_hint: ["neutral", "sad", "thoughtful"],
      },
    ],
    locations: [
      {
        key: "study",
        name: "Cozy Study",
        visual_description:
          "Walnut bookcase, dim brass lamp, oak desk, soft afternoon light.",
        variants_needed: [],
      },
      {
        key: "garden",
        name: "Autumn Garden",
        visual_description:
          "Maple tree, gravel path, golden leaves drifting in still air.",
        variants_needed: [],
      },
    ],
    objects: [
      {
        key: "letter",
        name: "Yellowed Letter",
        visual_description:
          "Hand-written letter on yellowed paper, faint cursive ink.",
        narrative_significance:
          "The central artifact — triggers the protagonist's reverie.",
      },
    ],
    scenes: [
      {
        scene_index: 1,
        description:
          "The veteran's hand opens an oak drawer and lifts out a yellowed envelope.",
        duration_seconds: 10,
        cast_keys: ["veteran"],
        location_key: "study",
        object_keys: ["letter"],
        dialogue: [],
        narration: null,
        emotional_beat: "setup",
        shot_count_hint: 2,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 2,
        description:
          "He unfolds the letter slowly; his hands tremble as the ink catches the light.",
        duration_seconds: 10,
        cast_keys: ["veteran"],
        location_key: "study",
        object_keys: ["letter"],
        dialogue: [],
        narration: null,
        emotional_beat: "rising",
        shot_count_hint: 2,
        continuity_from_prev: "match_last_frame",
      },
      {
        scene_index: 3,
        description:
          "He stands in the garden, the letter pressed to his chest, looking up at the maple tree.",
        duration_seconds: 10,
        cast_keys: ["veteran"],
        location_key: "garden",
        object_keys: ["letter"],
        dialogue: [],
        narration: null,
        emotional_beat: "release",
        shot_count_hint: 2,
        continuity_from_prev: "dissolve",
      },
    ],
    beats: [
      { type: "hook", scene_indices: [1] },
      { type: "rising", scene_indices: [2] },
      { type: "resolution", scene_indices: [3] },
    ],
    has_narrator: false,
    narrator_profile: null,
    music_plan: {
      mood: "wistful",
      bpm_target: 65,
      genre_hints: ["solo piano", "strings"],
    },
    global_style: {
      visual_style: "intimate cinematic realism with soft window light",
      color_palette: "warm amber, soft sepia, deep walnut brown",
      lighting: "warm key, low backfill, occasional rim light",
      camera_language: "still close-ups, slow handheld, gentle dolly-ins",
    },
    total_duration_seconds: 30,
    estimated_scene_count: 3,
    warnings: [],
  } as ShowrunnerPlan
}

// ── A plan with a HARD structural flaw: a scene references a cast_key that
//    doesn't exist in the cast roster. This violates the critic's check #2
//    (CONSISTENCY) which is the prototypical "blocking" failure mode. If the
//    critic returns `severity: "blocking"` here, severity classification
//    works on hard structural violations. If it returns `warning`, the
//    blocking-vs-warning decision is completely unguided.
function brokenRosterPlan(): ShowrunnerPlan {
  const plan = cleanPlan()
  // Reference a cast_key that doesn't exist anywhere in plan.cast.
  plan.scenes[1]!.cast_keys = ["veteran", "nonexistent_character"]
  return plan
}

// ── A plan that violates check #1 (duration ±10%) — the ONE check the
//    prompt explicitly tags as "HARD failure". Critical validation: does
//    the critic correctly classify this as blocking?
function badDurationPlan(): ShowrunnerPlan {
  const plan = cleanPlan()
  plan.target_duration_seconds = 60 // plan still sums to 30 → 50% under
  return plan
}

async function probe(
  label: string,
  plan: ShowrunnerPlan,
  fk: { pipelineId: string; stageId: string; userId: string },
) {
  const total = plan.scenes.reduce((s, sc) => s + sc.duration_seconds, 0)
  const hintSum = plan.scenes.reduce((s, sc) => s + sc.shot_count_hint, 0)
  console.log(`\n\n[probe] ============================================`)
  console.log(`[probe] CASE: ${label}`)
  console.log(`[probe] plan summary:`, {
    title: plan.title,
    scenes: plan.scenes.length,
    total_duration: total,
    target_duration: plan.target_duration_seconds,
    duration_delta_pct: ((total - plan.target_duration_seconds) / plan.target_duration_seconds) * 100,
    shot_count_hint_sum: hintSum,
    beats: plan.scenes.map((sc) => sc.emotional_beat),
  })

  const t0 = Date.now()
  const verdict = await runScriptCritic({
    supabase,
    pipelineId: fk.pipelineId,
    stageId: fk.stageId,
    userId: fk.userId,
    plan,
  })
  const elapsed = Date.now() - t0
  console.log(`[probe] critic returned in ${elapsed}ms`)

  const blocking = verdict.issues.filter((i) => i.severity === "blocking")
  const warnings = verdict.issues.filter((i) => i.severity === "warning")
  console.log(
    `[probe] verdict=${verdict.verdict} blocking=${blocking.length} warning=${warnings.length}`,
  )

  if (blocking.length > 0) {
    console.log("[probe] BLOCKING:")
    for (const b of blocking) {
      console.log(`  - [${b.issue_type ?? "?"}] s=${b.scene_index ?? "n/a"}: ${b.description}`)
    }
  }
  if (warnings.length > 0) {
    console.log("[probe] WARNING:")
    for (const w of warnings) {
      console.log(`  - [${w.issue_type ?? "?"}] s=${w.scene_index ?? "n/a"}: ${w.description}`)
    }
  }
}

async function main() {
  console.log("[probe] loading FK triple from DB…")
  const fk = await loadFkTriple()
  console.log(
    `[probe] using pipelineId=${fk.pipelineId} stageId=${fk.stageId} userId=${fk.userId}`,
  )

  await probe("CLEAN PLAN (no real violations)", cleanPlan(), fk)
  await probe("BROKEN ROSTER (scene refs nonexistent cast_key — check #2)", brokenRosterPlan(), fk)
  await probe("BAD DURATION (sum 30s vs target 60s — check #1, 'HARD failure')", badDurationPlan(), fk)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[probe] FAILED:", err)
    process.exit(1)
  },
)
