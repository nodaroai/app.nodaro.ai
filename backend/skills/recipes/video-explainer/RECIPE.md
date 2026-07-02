---
name: video-explainer
description: Narrated non-photoreal animated explainer video on Nodaro — style-key lock, per-block clips, one voice, audio-led assembly
triggers: ["explainer video", "explain X in a video", "animated explainer", "narrated explainer", "explain this in a video", "make a video explaining", "how-it-works video", "concept video"]
version: 1
---

# Video Explainer

You are producing ONE narrated, non-photoreal animated explainer video. The method is
a fixed pipeline: lock a single **style key** image, write N narration blocks, render
one silent clip per block in the SAME engine + key, voice every block in ONE picked
voice, then hand the ordered pairs to `assemble_narrated_video` — which fits voice to
clip automatically. You author the words, the style, and the shots; the assembler owns
the fit policy. Do not re-implement it by hand.

## Hard rules (read first — violating any one breaks the pipeline)

- **NO speech or lip-sync inside any clip.** Clips are speech-free by construction. The
  spoken narration lives ONLY in the per-block voice takes. This invariant is what makes
  the assembler's slow-to-fit safe — a talking mouth in a retimed clip desyncs. Ban
  lip-sync in every `NEGATIVE:`.
- **ONE engine for the whole video.** Do not mix `gemini-omni-video` and `seedance-2`
  across blocks — mixing models is style-drift bait even with the key attached.
- **ONE style key for the whole video.** The single Phase-1 image is the reference input
  for every subsequent generation (every t2v call, or every keyframe). It is what locks
  the look. Never regenerate the key mid-run.
- **ONE voice for the whole video.** Same `voice_id` on all N takes. Never auto-pick it.
- **You MUST finish in `assemble_narrated_video`.** Delivering loose clips or loose voice
  takes is a failure. The moment clips + takes are done, assemble automatically.
- **Non-photoreal, always.** Every clip prompt ends with the negation clause (see
  `references/prompts.md`). This is an illustrated/animated explainer, never live-action.

---

## Phase 0 — Ask first (never assume)

Before generating anything, ask the user for all four. Do not guess a default for any of
them except language:

1. **Duration** in minutes, 1–10. This fixes the block count: **N = minutes × 6** blocks
   of 10 seconds each. (1 min → 6 blocks; 10 min → 60 blocks. 60 is the assembler's cap.)
2. **Narration language** — default **English** if the user does not say. For any other
   language, use `elevenlabs-multilingual` in Phase 5.
3. **Mascot vs faceless** — a recurring in-style character/mascot that appears across
   clips, or purely abstract/faceless visuals. NEVER assume; a mascot changes both the
   style key (Phase 1) and every SCENE.
4. **Aspect ratio** — `16:9` (landscape) or `9:16` (vertical). Applies to the style key
   and every clip.

## Phase R — Research before writing

If the topic is a real subject (a product, a scientific concept, a company, an event),
run a web search FIRST and script from verified facts — invent nothing factual. If the
topic is a **personal story**, use only the details the user gives you; do not fabricate
names, dates, or events to fill gaps. Ask instead. Skip research only when the content is
entirely user-supplied.

## Phase 1 — The style key (ONE image + a MANDATORY quality gate)

Generate exactly one reference image with `generate_image` (≈5cr). It is either an
abstract **style swatch** (the render style, palette, line grammar, and finish shown on a
representative composition) or, in mascot mode, the mascot rendered in that exact style.
Follow the non-photoreal STYLE-descriptor guidance in `references/prompts.md`.

**Quality gate — you MUST pass it before generating ANY clip:**

With `gemini-omni-video` the reference image DOMINATES the prompt text — a weak key
silently degrades all N clips at once. So present the key to the user, or self-check it
against these swatch criteria:

- **Clean finished plate** — no muddy artifacts, no half-rendered regions, no
  compression mush.
- **Crisp line grammar** — the line weight / edge treatment is consistent and legible.
- **Exact palette** — the intended colors are present and saturated as described.

If the key fails ANY criterion, regenerate it until it passes. This is not optional: one
extra ≈5cr image beats N bad ≈45cr clips. (Root-caused from the 2026-07-02 AC-explainer
comparison: same prompt, different key → visibly different clip quality.)

## Phase 2 — Narration (N labeled blocks)

Write **N** labeled narration blocks (`Block 1 … Block N`), one plain spoken line each —
the words a narrator says, no stage directions. Target **~8–9 seconds / ~20–24 words per
line**, but treat that as a TARGET ONLY.

**You do not need to re-voice a take for length.** `assemble_narrated_video` fits the
video to the REAL take length: a short take centers the voice over the clip with silence
padding; a long take slows the clip to fit (capped at 1.5×, then the last frame holds);
audio is NEVER cropped. So write the line the topic needs and let the assembler fit it.
This removes the fragility for languages whose take length is hard to pre-size (e.g.
Hebrew).

## Phases 3 + 4 — Clips (two engines, ONE per video)

Render one **10-second, speech-free** clip per block, all in the same engine with the
style key attached. The block-prompt template + richness rule live in
`references/prompts.md` — a flat brief renders a flat clip even on the same model + key.

**Default (look-first): `gemini-omni-video`, text-to-video.** Call `generate_video` with
`model: "gemini-omni-video"`, `duration: 10`, `resolution: "720p"`, the chosen aspect
ratio, and the **style key attached as the reference image** (via `connected_references`
— the wired-reference shape; only image-reference-capable models attach it, and
gemini-omni does). This collapses keyframe + animate into one call per block ([redacted-reference]
parity). Cost anchor: **45cr/block** (`gemini-omni-video:10`), i.e. 270cr of clips per
output minute. **`gemini-omni-video` output is SILENT on Nodaro** — the voice carries
the block alone; do not rely on clip audio.

**Budget / continuity: `seedance-2` or `seedance-2-fast`, image-to-video.** For each
block: `generate_image` a keyframe (style key as reference) → `animate_image` with that
keyframe as `image_url`, `model: "seedance-2"` (or `"seedance-2-fast"`), `duration: 10`.
This is the ONLY engine compatible with continuity mode (§3.1). Consult the model's
`pricing` array via `list_models { kind: "video", mode: "i2v" }` for the exact 10s cost
(seedance scales with duration/resolution; `seedance-2-fast` at 480p is the cheapest
anchor). If you want ambient audio, `animate_image` has a `sound` toggle (Seedance 2
included) — but the narration still carries the block; keep clips speech-free
regardless.

Either engine: **10s clips, no speech, style key on every clip.** Re-verify model ids
against `list_models` if this recipe's `version` looks stale.

## Phase 5 — Voice (ONE, user-picked)

Ask the user to pick ONE voice — **never auto-pick**. Then voice every block with
`generate_speech`, passing the SAME `voice_id` (a premade voice name) on all N takes.
Default model `elevenlabs-v3`; use `elevenlabs-multilingual` when the Phase-0 language is
not English. Block N's line → take N.

## Phase 6 — Assemble (mandatory, automatic)

The moment all clips + all takes exist, call `assemble_narrated_video` with the N ordered
pairs. **Block N's voice lands on clip N** — order is the contract. Deliver the single
returned MP4; delivering loose clips is a failure.

Assembler credit cost is `3 + ceil(N / 6)`: 6 blocks → 4cr, 24 blocks → 7cr, 60 blocks →
13cr.

**Parameter shape** (`assemble_narrated_video`):

| Field | Type | Meaning |
|-------|------|---------|
| `blocks[]` | array, 1–60, in play order | one entry per block |
| `blocks[].video_url` / `blocks[].video_asset_id` | one required | clip N (URL or Nodaro asset/job id) |
| `blocks[].audio_url` / `blocks[].audio_asset_id` | optional | voice take N (omit → block passes through untouched) |
| `voice_volume` | 0–200, default 100 | voice loudness % |
| `clip_audio_volume` | 0–200, default 40 | clip's ambient bed % under the voice (irrelevant for silent gemini-omni clips) |
| `max_slowdown` | 1–2, default 1.5 | cap on the slow-to-fit factor; beyond it the last frame holds |
| `trim_end_frames` | 0–120, default 0 | frames trimmed off the end of each non-final block (interior joins only) |
| `trim_start_frames` | 0–120, default 0 | frames trimmed off the start of each non-first block (interior joins only) |

Leave `trim_end_frames` / `trim_start_frames` at 0 for plain hard-cut explainers (the
default; trimming eats content from clean cuts). Set them only in continuity mode (§3.1).

---

## 3.1 Continuity mode (optional, per scene group)

For consecutive beats INSIDE the same scene, you may generate clip N+1 as a
*continuation* of clip N instead of from a fresh keyframe — motion flows unbroken across
the join. Continuity mode **requires the seedance engine for the WHOLE video**:
`gemini-omni-video` is not in `EXTEND_VIDEO_PROVIDERS`, and its `:vref` path is
video-*edit* semantics, not continuation — do NOT substitute it.

Per continuation join:

1. `trim_video` the **last ~2 seconds** of clip N and feed only that tail — never the
   whole clip. (Seedance video input bills input + output duration; 2s in + 10s out ≪
   10s + 10s.)
2. Continue with `extend_video`, `model: "seedance-2-extend"`, block N+1's prompt as the
   continuation (describe only what happens next). `extend_video` has **no
   image-reference input** — the look carries forward only through the trimmed source
   tail from step 1, so there is nothing to re-attach on an extend. This is exactly why
   chained extends drift over multiple joins, and why scene breaks (below) MUST restart
   from a fresh style-key keyframe — that is the only re-anchor point.
3. The extend output contains ONLY the continuation — there is no overlap to cut. At
   assembly, set **`trim_end_frames: 4, trim_start_frames: 3`** (the "seamless merge"
   setting) to hide the boundary flash at these interior joins.

**Scene breaks always restart from a fresh keyframe.** A fresh keyframe re-anchors the
look AND restores parallelism: clips within different scene groups render in parallel,
whereas a fully chained 60-block video serializes (one clip at a time, each waiting on
its predecessor's tail). Use continuity within a scene; break to a fresh keyframe between
scenes.
