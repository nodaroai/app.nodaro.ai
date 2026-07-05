# Nodaro Film Director — Claude Skill

**Status:** Draft v3
**Target:** Ship in Phase 0 (2-3 weeks), before any Story-to-Video pipeline engineering
**Last Updated:** 2026-05-14

**Related specs:**
- `[internal spec reference removed]` — the native pipeline alternative (deferred or descoped if skill succeeds)
- `[internal spec reference removed]` — the deterministic LLM stack the skill replaces
- `[internal spec reference removed]` — the wizard UX the skill replaces with conversational UX

---

## 1. Vision

A Claude (and ChatGPT / Gemini / Cursor) skill that drives a proven manual film-making workflow as a repeatable, callable capability. The user invokes the skill in any MCP-enabled chat client, has a conversation about their story, and watches a fully editable Nodaro workflow assemble on their canvas in real-time as the conversation progresses.

**Strategic positioning:**

> "Watch your film studio build itself on your canvas while you talk to Claude."

The skill replaces the conversational Interactive Mode of the native pipeline (architecture §3.3 + §5.1) — entirely. The native pipeline feature is descoped to handle only **Programmatic Mode** (upstream-driven automation: RSS → video → auto-post) if/when that use case proves out.

---

## 2. Why a Skill Beats the Native Pipeline

This compares against the spec in `[internal spec reference removed]` and `[internal spec reference removed]`.

### What the skill does better

| Dimension | Native pipeline | Skill |
|-----------|-----------------|-------|
| Engineering cost | 8–12 weeks | 2–3 weeks (skill markdown + 3 reusable canvas animations) |
| Quality fidelity | Misses 8 refinements that produced the reference test film (see §6) | Replicates the manual workflow exactly |
| Conversational refinement | Hard to retrofit | Native to LLM chat |
| Storyboard cohesion review | New specialist LLM + UI required | "Claude looks at images and flags drift" — built in |
| Shot-to-shot continuity engineering | Complex state tracking | Claude reads last frame, plans next shot |
| Motion script refinement loop | New per-shot approval gate UI | Natural conversation |
| Provider-specific rules (Seedance multishot, no bg music) | New config field + plumbing | One line in the skill |
| Iteration speed | Code → deploy → test (days) | Edit markdown (minutes) |
| **Live canvas construction** | Pipeline builds canvas opaquely via automation | **Canvas builds during dialog — user watches their AI director work in real-time** |
| Cross-platform | Nodaro-only | Anywhere MCP runs (Claude desktop/code, ChatGPT, Gemini, Cursor) |

### What the skill loses

| Loss | Mitigation |
|------|-----------|
| Programmatic Mode (RSS → video → auto-post) | Still build the native pipeline node for programmatic-only — much smaller scope |
| Users without an MCP-enabled chat client | Acceptable — MCP is the future and the marketing story is Claude-first |
| Approval-button preference | Acceptable — Auto Mode in the native pipeline still serves "walk away" users |

### Decision: ship the skill in Phase 0, descope Interactive Mode of the native pipeline, build only Programmatic Mode if needed.

---

## 3. Skill Content (the actual markdown)

This is the literal content Claude (or any MCP-enabled LLM) reads when invoked.

```markdown
---
name: nodaro-film-director
version: 1.0.0
description: Use when the user wants to make a cinematic video, short film, trailer, music video, reel, or commercial using Nodaro. Guides them through a director-quality workflow that assembles an editable Nodaro workflow on the user's canvas in real-time during conversation.
---

# Nodaro Film Director

You are a film director helping the user create a cinematic video using Nodaro's MCP tools. You drive a 10-stage workflow (Stages 0–9) that assembles a fully editable Nodaro workflow on the user's canvas in real-time as you talk with them. The user watches the canvas fill up during the conversation — you do not save the result for the end.

## Operating principles

1. **Conversational, not transactional.** Ask questions. Show your work. Iterate based on feedback. Never produce a final artifact without showing a draft first.
2. **One shot at a time.** Animate shots sequentially, not in parallel. Each shot's last frame anchors the next shot's first frame.
3. **Continuity is engineered, not hoped for.** When planning shot N+1, you must explicitly account for shot N's ending state.
4. **Storyboard cohesion is reviewed.** After scene images are generated, examine them as a sequence and flag drift before any animation runs.
5. **Audio comes last.** Generate music and dialogue after the user has seen and approved the silent assembled video.
6. **The workflow is built live, on the user's canvas, as you talk.** At the start of the session, call `create_workflow` and tell the user to open it in their browser. Every generation MCP call passes the `workflowId` so nodes appear on the user's canvas in real-time. The user watches the workflow assemble during conversation — not at the end.
7. **The end state is already there.** By the time the conversation ends, the user already has the complete editable graph on their canvas. No final import step needed — just a wrap-up message.
8. **Show costs as you go.** Before any generation MCP call, briefly note the credit cost. The user has a budget.

## Stage 0 — Initialize the live workspace

Before any creative work, call `create_workflow({ name: "<user's working title or 'Untitled Film'>" })` and capture the returned `workflowId`. Tell the user:

> "I've started your workflow. Open the editor URL in another tab — you'll watch your film assemble on the canvas as we work together."

Share the canonical editor URL from `create_workflow`'s response (the MCP server returns it). If the response does not include one, construct it from the Nodaro instance's editor pattern (e.g., `<base_url>/editor/<workflowId>`).

**Every subsequent MCP generation call MUST include this `workflowId`** so the resulting nodes attach to the user's canvas in real-time. The user is co-watching: chat on one side, canvas filling up on the other.

## Stage 1 — Story & Script

Ask the user for:
- Story idea (free text)
- Target duration (5–600 seconds)
- Format: trailer | short_film | music_video | reel | commercial
- Optional: style preferences (visual style, color palette, tone, camera language)

Then:
1. Write a screenplay (scene-by-scene narrative, with rough shot count matching the format and duration)
2. Show it to the user
3. Ask: "What would you change?"
4. Iterate via Q&A until the user approves
5. When approved: `update_workflow_json` to add a Script display node — script appears on the user's canvas as the conversation's first artifact
6. **Do not move on without explicit approval.**

## Stage 2 — Shot List

Convert the approved screenplay into a shot list. Each row has:

- shot_id, scene_ref, shot_type, camera_angle, camera_motion
- characters_in_shot, location_ref, objects_in_shot
- action_in_shot (one sentence, visual-only)
- duration_seconds (sum across all shots must be within ±10% of target)
- dialogue_in_shot, narration_in_shot
- **continuity_in (string)** — how this shot continues from the previous: "Hero finishes the stride begun in shot 4 — front-on framing"
- **continuity_out (string)** — what this shot leaves for the next: "Hero raises rifle, beat ends mid-motion"
- **start_frame_strategy**: one of three values:
  - `first_shot` — this is shot 1; no anchoring needed; animate freely from the scene image
  - `match_previous_last_frame` — extract the last frame of the previous shot and use it as this shot's first frame (literal pixel-level continuity)
  - `fresh_subject_continues_action` — same subject continues the action but from a different camera position (e.g., "running from behind" → "finishing from front"); the scene image is fresh, but the motion script's start state must plausibly continue from the previous shot's `continuity_out`

Show the shot list as a table. Iterate via Q&A until approved.

**Continuity rules:**
- Two adjacent shots with the same character: explicitly chain action ("running from behind" → "finishing from front")
- Location changes need a transition device or establishing shot
- A shot's `start_frame_strategy = match_previous_last_frame` means at animation time you must call `extract_frame` on the previous video and pass that frame as the start frame

## Stage 3 — Characters

For each character in the script:

1. Call `generate_character` for the main reference (frontal, neutral expression, full body)
2. Show to user. Iterate (modify_image or regenerate) until approved.
3. Generate angle variants needed by the shot list, drawn from this set of 5: 3/4 left, profile left, profile right, 3/4 right, back. Use `image_to_image` with the main as reference. Only generate the angles that actually appear in the shot list (typically 3–5 per character — don't pre-generate all 5 if the shot list only references 3).
4. Generate emotion variants needed by the script: neutral, smiling, angry, sad, shocked, determined. Use `image_to_image` with the main as reference. Only generate emotions that appear in the script.
5. Show all variants. User approves or asks for regenerations.
6. For characters with dialogue: pick a voice. Either match an ElevenLabs premade voice (Rachel, Roger, Charlie, etc.) or call `voice_design` to create a custom one. Generate a short sample line; play it for the user.

**Optional — external identity training (provider integration TBD).** *Trigger point: after step 2 (main image approved), before step 3.* If an identity-training integration is enabled for this Nodaro instance (check the user's connected providers), train an identity via the provider's MCP tools (exact endpoints TBD in integration design — see §10 #9) and persist the returned `reference_id` on the character node. Use that `reference_id` as the primary character reference for steps 3–4 and for all downstream scene-image generation (Stage 5). Identity training typically yields 80–90% facial fidelity versus 70–80% for reference-image conditioning alone — worth the extra step for any character that appears in 5+ shots. The fallback when identity training is unavailable or disabled is Nodaro's existing **identity-lock** mechanism (`packages/shared/src/identity-lock.ts`) — natural-language prompt clauses that Nano Banana Pro and GPT Image respect for facial preservation at inference time.

**Pass `workflowId` to every generation MCP call** so the resulting nodes attach directly to the user's canvas as they appear. Track asset URLs/IDs as backup so you can repair via `update_workflow_json` if any node fails to auto-attach.

## Stage 4 — Locations

For each location in the script:

1. Call `generate_location` for the main reference
2. Show to user, iterate
3. Generate variants needed by the shot list: time-of-day (sunrise, noon, golden hour, night), weather (clear, rain, fog), angles (wide establishing, interior detail). Use `image_to_image` with the main as reference.
4. Show variants, user approves

## Stage 5 — Storyboard (scene images)

For each shot in the shot list:

1. Call `image_to_image` with:
   - Character refs (the right angle + expression variant)
   - Location ref (the right variant)
   - Object refs (if any)
   - Prompt: action_in_shot + style directives
2. Show to user

After ALL scene images are generated:

3. **Storyboard cohesion review pass:**
   - Compare all images as a sequence
   - Check: character consistency (same face/clothes across shots), location consistency, lighting/style consistency, story flow (do the images tell the story?)
   - Flag any drift
   - Propose targeted regenerations for problematic shots
4. User approves the storyboard before moving to animation

## Stage 6 — Shot Animation (sequential, one at a time)

For each shot in the shot list, in order:

1. **Start-frame anchoring** (per the shot's `start_frame_strategy`):
   - If this is shot 1, or `start_frame_strategy = first_shot`: skip extraction; animate freely from the scene image
   - If `start_frame_strategy = match_previous_last_frame`: call `extract_frame` on the previous shot's video at position = last; use that frame as the start frame for this shot's animation
   - If `start_frame_strategy = fresh_subject_continues_action`: no extraction needed; the scene image is the start frame, but ensure the motion script's start state plausibly continues from the previous shot's `continuity_out`
2. Plan the motion script (a structured description of camera motion + action across the shot duration):
   - Camera motion (match shot_list's camera_motion exactly)
   - Action progression (start state → mid state → end state)
   - End-state alignment with `continuity_out`
3. Show the motion script to the user
4. Iterate via Q&A until approved
5. Call `animate_image` with:
   - The scene image as the start frame (or anchored to previous shot's last frame per #1)
   - Motion prompt = approved motion script
   - Duration = shot_list.duration_seconds
   - **Provider-specific rules** (see below)
6. Show the resulting video to the user
7. If user rejects: ask why, refine motion script, re-animate. **Max 3 retries.** If still rejected after 3: tell the user "we've hit the retry limit on this shot — the result isn't ideal. We can continue and revisit this shot later via Nodaro's canvas, or pause here." Wait for explicit user choice.
8. **Only proceed to next shot after this one is approved.**

**Provider-specific rules:**
- **Seedance 2**: always multishot mode. Pass `multishot: true`, `disable_internal_music: true`, `allow_sfx: true`. Use 3 reference images per shot (main scene image + 2 anchor frames if available).
- **Kling Avatar / Kling Avatar Pro**: only for shots with dialogue lip-sync — defer to Stage 7.
- **Veo / Veo 3.1**: when motion is camera-heavy and dialogue isn't needed.

## Stage 7 — Audio (after all videos approved)

This stage runs only after every shot's video is approved.

1. **Narration** (if script has narration):
   - For each narration line: `generate_speech` (ElevenLabs, narrator profile from Stage 1)
   - Show, iterate
2. **Dialogue** (per character with lines):
   - `generate_speech` per dialogue line, using the character's voice from Stage 3
   - Show, iterate
3. **Lip sync**:
   - For each shot with dialogue: `lip_sync` the dialogue audio onto the character's scene video
4. **Music**:
   - Determine mood + BPM from the script's emotional arc
   - `suno_generate` (or `generate_music`) for the soundtrack
   - Show, iterate
5. **SFX** (if script implies any):
   - `text_to_audio` for specific SFX cues (gunshots, explosions, ambient)
6. **Editor cut decisions**:
   - For each shot, decide: in_point, out_point, transition to next (cut / fade / dissolve / dip-to-black)
   - Snap cuts to music beat grid for high-energy formats (trailer, reel)
   - Use fades/dissolves for emotional/slow sequences
   - Show the cut plan to the user
   - Iterate
7. **Audio package approval gate.** Before moving to Stage 8, get explicit user approval that the full audio package (narration + dialogue + lip-sync + music + SFX where applicable + cut plan) is correct. **Do not proceed without it.**

## Stage 8 — Final Assembly

1. Apply each shot's cut decisions:
   - For shots needing trim: `trim_video` to in_point/out_point
2. Combine all shots:
   - `combine_videos` with transition parameters from cut plan
3. Merge with audio:
   - `merge_video_audio` (final video + music track)
4. Show the final video
5. **User approves or requests changes** (regenerate specific shots, swap music, etc.). **Do not move to wrap-up without explicit approval.** If user requests changes, route back to the appropriate stage (regenerate scene → Stage 5/6; swap music → Stage 7 step 4; re-cut → Stage 7 step 6) and re-run only the affected nodes — don't restart the whole pipeline.

## Stage 9 — Deliver (wrap-up)

The workflow is already on the user's canvas — it was assembled incrementally throughout the conversation. Final wrap-up:

1. Verify all nodes are wired correctly (`get_workflow` to inspect). If any edges are missing — for instance, the final merge isn't connected to the combine node — fix via `update_workflow_json`.
2. Confirm the final video node is the terminal output.
3. Tell the user:
   > "Your film is ready. Every step you saw appear on your canvas — script, characters, locations, scenes, animations, audio — is a real Nodaro node. Regenerate any one, swap models, branch from any stage. The graph is yours."
4. Offer next steps:
   - Publish as a Nodaro app (existing feature — turns the workflow into a runnable app others can use)
   - Share via link (existing workflow sharing)
   - Export as a starting point for the next film (`export_workflow`)
   - Continue editing on the canvas — you can be summoned again any time
   - (Future, when SubWorkflowNode templates ship) Save the per-scene containers as parameterized templates for reuse

## Failure handling

- MCP call fails → show error to user, ask if they want to retry or skip
- User uncertain → offer 2-3 specific options to choose between
- Cost budget exceeded → pause and ask if they want to continue or stop
- Critical asset missing (e.g., character ref didn't generate) → don't proceed; resolve with user first
- Identity training fails (when the integration is enabled) → fall back to the default identity-lock path; use the main reference image only; tell the user once and continue. **Do not retry identity training in this session.**

## What you do NOT do

- Generate without showing the draft first
- Animate shots in parallel
- Skip the storyboard cohesion review
- Add background music inside Seedance 2 generations (the model is told to skip it)
- Move to next stage without explicit user approval
- Forget to pass `workflowId` to a generation call — the resulting node will not attach to the user's canvas
- Save the workflow only at the end — every approved artifact should attach incrementally so the user watches the canvas build
- Retry a failing `update_workflow_json` more than once — if a manual JSON write fails twice with validation errors, **abandon manual construction and fall back to the equivalent generation MCP tool** (which knows its own schema). Do not loop on Zod errors.
```

---

## 4. MCP Tool Dependencies

The skill relies on these MCP tools that already exist in Nodaro:

### Tools used per stage

| Stage | MCP tools used |
|-------|----------------|
| 0. Initialize workspace | `create_workflow` |
| 1. Script | `update_workflow_json` (attach Script display node on approval) |
| 2. Shot list | `update_workflow_json` (attach shot-list metadata) |
| 3. Characters | `generate_character`, `image_to_image`, `voice_design` (or premade ElevenLabs voices); `update_workflow_json` for any nodes the generation tools don't auto-attach. **Optional:** external identity-training MCP tools when integration is enabled (specific endpoints TBD — see Stage 3 escape hatch + §10 #9) |
| 4. Locations | `generate_location`, `image_to_image`; `update_workflow_json` |
| 5. Storyboard | `image_to_image` (with character + location refs); `update_workflow_json` |
| 6. Shot animation | `extract_frame`, `animate_image`; `update_workflow_json` |
| 7. Audio | `generate_speech`, `lip_sync`, `suno_generate` / `generate_music`, `text_to_audio`; `update_workflow_json` |
| 8. Final assembly | `trim_video`, `combine_videos`, `merge_video_audio`; `update_workflow_json` |
| 9. Wrap-up | `get_workflow` (verify wiring); `update_workflow_json` (repair any missing edges) |
| Fallback only | `import_workflow` — used only if the session ran in Pattern A (no live canvas) |

**Every call to a generation tool passes the session's `workflowId`** so the resulting node attaches to the user's canvas in real-time. `update_workflow_json` is the primary glue tool — it attaches non-generative nodes (Script, shot-list metadata) and repairs any edges the generation tools don't auto-wire.

### Optional tools

- `get_workflow_json` — fetch a reference workflow to use as a template structure
- `browse_gallery` / `browse_uploads` — let user pick existing assets instead of generating
- `prepare_image_upload` / `upload_image_widget` — let user upload reference images mid-flow
- `face_swap`, `modify_image`, `edit_image` — for post-generation refinements
- `add_captions` — for captioned reels/shorts
- **External identity-training MCP tools (optional, instance-dependent)** — when integration is enabled, used in Stage 3 to train a face-faithful identity model and persist a `reference_id` reusable across scene-image generation. Specific endpoints TBD in integration design. See Stage 3 escape hatch for usage; see §10 #9 for integration decisions still pending.

**All exist today.** No new MCP tools need building.

---

## 5. Workflow JSON Composition Strategy

The skill builds the workflow incrementally as the user watches, ending with a complete editable graph on the user's canvas. Two viable composition patterns:

### Pattern B — Build incrementally with `create_workflow` + `update_workflow_json` (primary)

1. **Stage 0:** `create_workflow` returns `workflowId`. User opens it in browser.
2. **Stage 1 (Script approved):** `update_workflow_json` adds a Script display node.
3. **Stage 2 (Shot List approved):** `update_workflow_json` attaches shot-list metadata to the root node (or a dedicated Shot List node) so the storyboarding structure is visible on the canvas.
4. **Stage 3 (each character approved):** generation MCP tools attach character nodes + variant nodes to the workflow when called with `workflowId`. (For tools that don't auto-attach, follow up with `update_workflow_json`.)
5. **Stage 4 (each location approved):** same pattern for location nodes.
6. **Stage 5 (storyboard):** scene_image nodes attached as they're generated; edges drawn from character/location refs.
7. **Stage 6 (each shot animated):** animate nodes attached; edges from scene_image to animate.
8. **Stage 7 (audio):** speech, lip_sync, music, sfx nodes attached; edges to relevant shots.
9. **Stage 8 (final assembly):** trim, combine, merge nodes attached; final video node is the terminal output.

**Pros:**
- User watches the workflow assemble in real-time — the "live canvas construction" experience that's positioned as a key product differentiator
- Resumable mid-session if chat is interrupted (workflow always exists in a partial state)
- User can inspect intermediate state on the canvas while talking to Claude
- Conversation and canvas reinforce each other: "I just generated Hero's profile angle — see it on your canvas?"

**Cons:** More MCP calls than Pattern A; requires user to have a Nodaro browser tab open alongside chat.

### Pattern A — Compose JSON at the end (fallback only)

1. Throughout the conversation, track every asset URL/ID in working memory
2. At the end, compose the full workflow JSON in-memory
3. Single `import_workflow` call to deliver the graph

**Pros:** Works in MCP clients without a live Nodaro UI alongside (no browser tab needed).
**Cons:** User doesn't see the canvas build — the live wow-factor is lost. No partial recovery if the session ends abruptly.

**Recommendation:** Ship **Pattern B** as the primary pattern. Live canvas construction is a core feature, not a v2 enhancement. Pattern A becomes a fallback only for users who can't (or choose not to) keep a Nodaro tab open during the conversation.

### JSON schema reference

The skill needs to know the exact Nodaro workflow JSON shape. Two ways to handle this:

1. **Embed the schema** in the skill markdown (verbose but self-contained)
2. **Reference `get_workflow_json`** of a template workflow that demonstrates the structure (lean but requires a maintained template)

**Recommendation:** Option 2. Maintain a "template" workflow in a known location (e.g., `nodaro-internal/film-template`); the skill instructs Claude to fetch it first as a structural reference.

### How Claude constructs and edits workflows (4-layer model)

Claude is genuinely bad at constructing valid JSON for systems with 40+ node types, each with its own data shape, handle names, and reference semantics. The strategy is **don't make Claude do that** — push as much JSON construction as possible into Nodaro's existing tools and template references. Use four layers, in priority order:

#### Layer 1 — Generation tools auto-attach nodes (~80% of writes)

When Claude calls a generation MCP tool with a `workflowId`, **the tool itself creates the node, places it on the canvas, assigns handle IDs, and updates the workflow JSON server-side.** Claude just calls the tool and forgets about it.

Examples:
- `generate_character(workflowId, ...)` → character node appears on canvas
- `image_to_image(workflowId, refNodeIds: [...], prompt: ...)` → scene-image node + edges from refs
- `animate_image(workflowId, sourceNodeId: ..., prompt: ...)` → animate node + edge from source
- `suno_generate(workflowId, ...)` → music node
- `lip_sync(workflowId, videoNodeId, audioNodeId)` → lip-sync node + edges
- `combine_videos(workflowId, sourceNodeIds: [...])` → combine node + edges
- `merge_video_audio(workflowId, videoId, audioId)` → merge node + edges

**Claude's mental model:** "Pass `workflowId` and the right `refNodeIds`. The tool handles the rest." Zero schema knowledge required.

#### Layer 2 — Template workflow as schema reference (~15% of writes)

For nodes that don't have a dedicated generation tool — Script display node, shot-list metadata node, sticky notes — Claude needs to know the JSON shape to construct manually.

**Mechanism:**
1. Maintain a hand-curated reference workflow at a known location (e.g., `nodaro-internal/film-template`) containing one example of every node type Claude might construct manually
2. Stage 0 of the skill prepends a call to `get_workflow_json("nodaro-internal/film-template")` so Claude has every node template in its context
3. When Claude needs to add a Script display node, it copies the template structure, adjusts the `data` fields and `id`, sends via `update_workflow_json`

**Mental model:** "Look at the template. Mirror the shape. Change only what you need to."

#### Layer 3 — `update_workflow_json` for glue work (~5% of writes)

Direct JSON manipulation for:
- Adding edges that the generation tools didn't auto-wire
- Repairing missing connections in Stage 9 wrap-up
- Updating a node's `data` field (e.g., persisting the identity-training `reference_id` on the character node)
- Moving nodes around (rare; ELK.js auto-layout handles most placement)

Supports optimistic concurrency via `expected_updated_at` — Claude reads first, modifies, writes back with a freshness check.

**Mental model:** "Last-resort surgical edit. Used after `get_workflow` reveals an issue."

#### Layer 4 — Higher-level edit tools (future, do not build speculatively)

If Layers 1-3 produce too many failed JSON writes in production, add:
- `add_node(workflowId, type, data, refs)` — generic node creation
- `connect_nodes(workflowId, sourceId, sourceHandle, targetId, targetHandle)` — explicit edge
- `update_node_data(workflowId, nodeId, data)` — patch a node's data
- `describe_node_type(type)` — return JSON schema for one node type

**Do not build these speculatively.** Ship Layers 1-3 first, see what fails, then build the missing tool.

### What Claude needs to know — and what catches mistakes

| Concept | How Claude learns it | Fallback if Claude gets it wrong |
|---------|---------------------|----------------------------------|
| Workflow JSON shape (root) | Template workflow via `get_workflow_json` | `update_workflow_json` Zod validation rejects → Claude retries |
| Node `type` strings | Template workflow examples (one per type) | Same |
| Node `data` shape per type | Template + the node type's own MCP tool schema | Same |
| Handle IDs per node type | Template workflow examples | Edge insertion fails → re-read template |
| Position coordinates | Use defaults (0,0); ELK.js re-layouts | Visually messy briefly, functionally fine |
| Node IDs | Generate UUIDs or use tool-returned IDs | Conflicts caught by Zod / unique constraint |
| Edge wiring intent (scene-image refs character + location) | Generation tool's `refs` parameter does this implicitly | If tool doesn't auto-wire, Claude adds edges in Layer 3 |

### Error-handling fallback rule (in the skill content)

If `update_workflow_json` fails twice in a row with validation errors, **abandon manual JSON construction and fall back to the equivalent generation MCP tool** — the tool knows its own schema and won't drift. This rule is encoded in the skill's `What you do NOT do` block: never retry a failing JSON write more than once before falling back to Layer 1.

### Audit checklist (must verify before Phase 0 launch)

Several assumptions about Nodaro's current tool behavior need to be confirmed. Each is HIGH-severity blocker:

| Item | Owner note |
|------|-------------|
| Confirm every generation MCP tool actually auto-attaches a node when passed `workflowId` (some may not) | Audit each tool listed in §4 stage table; document gaps |
| Confirm tools accept `refNodeIds` (or equivalent) for edge wiring at creation time | Audit; if any tool requires post-hoc edge wiring, document the Layer 3 follow-up |
| Confirm `update_workflow_json` returns Claude-readable Zod errors (not just HTTP 400) | Test; if not, wrap errors in a friendlier shape for MCP responses |
| Create and seed the `nodaro-internal/film-template` reference workflow with one example of every manually-constructed node type (Script display, sticky notes, etc.) | One-time curation (~2 hours) |
| Test that `get_workflow_json` response size doesn't exceed MCP client context limits for a typical 50-node workflow | Test in Phase 0 Week 3 |

These belong in the Week 1 deliverables of Phase 0 §11.

---

## 6. Quality Patterns (How the 8 Gaps Get Closed)

These map back to the gaps identified in the prior analysis of the manual workflow vs. the native pipeline spec:

| Gap | How the skill closes it |
|-----|-------------------------|
| 1. Conversational refinement per stage | Built into every stage's "iterate via Q&A" instruction |
| 2. Character expression variants | Stage 3 step 4 explicitly lists emotion variants |
| 3. Storyboard cohesion pass | Stage 5 step 3 mandates the full-sequence review |
| 4. Motion script refinement loop | Stage 6 steps 2-7 add per-shot motion script with iteration |
| 5. Sequential shot generation | Stage 6 is explicitly "one at a time, in order" |
| 6. First/last frame continuity engineering | Stage 2's `start_frame_strategy` + Stage 6 step 1's `extract_frame` |
| 7. Audio added last | Stage 7 runs only after all videos approved |
| 8. Provider-specific rules (Seedance, etc.) | Stage 6 "Provider-specific rules" subsection |

*Optional enhancement (not a gap):* the identity-training integration (Stage 3 escape hatch) raises identity fidelity from ~70–80% (default identity-lock path) to ~80–90% — pairs with gap #2 (character variants) to harden character consistency across scenes. See §10 #9 for integration questions still pending.

---

## 7. Edge Cases & Fallbacks

### User wants to start from a partial spec

User uploads a script they wrote themselves, or starts from existing characters. Skill should detect and skip to the appropriate stage:

- "I already have a script" → start at Stage 2 (Shot List)
- "Use these characters" (uploads images via `upload_image_widget`) → register as refs, skip Stage 3 generation

### User wants to abort mid-session

At any point: "I'm done for now" → the workflow is already preserved on the user's canvas (Pattern B saves throughout, so there's no extra save step). Give the user the workflow URL, summarize where they stopped and what's left to do, exit gracefully.

### Context window pressure

Long sessions (especially big shot lists × per-shot refinement) may strain Claude's context window. Mitigations:

- Track only asset IDs/URLs + shot list structure in working memory
- Drop generated image data from conversation after they're approved (they're persisted via Nodaro)
- Summarize approved stages tersely in subsequent stage prompts

### User runs out of credits mid-session

The skill should check balance via `check_balance` before expensive stages (e.g., before animating all shots). Show user the estimated remaining cost, let them top up or stop.

### MCP server unreachable

Show clear error. Save conversation state. Suggest user retry when MCP is back.

### Identity training fails or times out

If the identity-training integration is enabled and training fails (timeout, API error, unsupported face, or `reference_id` never returns): tell the user once, fall back gracefully to the default identity-lock path, continue Stage 3 with the main reference image only. Do not retry identity training in the same session — the user can re-attempt it in a later session once the integration's retry-from-character-node UX is available (Phase 2+).

---

## 8. Versioning & Iteration

### How to ship updates

The skill is one markdown file. Iteration cycle:

1. Edit `nodaro-film-director.md`
2. Test in a Claude chat session
3. Publish (commit + deploy to the skills directory)

Compare to the native pipeline: code → typecheck → deploy → test → fix → redeploy. Days vs. minutes.

### Version tracking

Frontmatter includes a `version` field:

```yaml
---
name: nodaro-film-director
version: 1.0.0
description: ...
---
```

Each release also gets an entry in `CHANGELOG.md` under the skill's directory.

### A/B testing

Run two versions side-by-side with subsets of users; track outcomes:
- Session completion rate
- Final video user approval rate
- Average session credit cost
- Average session duration

The skill's instructions are the single source of variability — easy to attribute outcome to instruction changes.

### Personalization

Future: per-user overrides via a `user_preferences` MCP tool. Examples:
- "I prefer dialogue-heavy scripts" → Stage 1 generates more dialogue
- "Always use Veo for animation" → Stage 6 hardcodes provider
- "Skip music — I add my own" → Stage 7 skips music generation

---

## 9. Marketing & Positioning

### The pitch

> **"Watch your film studio build itself on your canvas while you talk to Claude."**

The visceral demo: split-screen video — Claude chat on the left, Nodaro canvas on the right filling up with nodes as the conversation progresses. Conversation drives canvas; canvas confirms conversation.

Secondary pitch: **"Nodaro is the only platform where AI is your director, not your generator."**

### Distribution channels

- **[reference removed]** — [reference removed]
- **Cross-platform** — works in ChatGPT, Gemini CLI, Cursor (anywhere with MCP)
- **Demo video** — the actual reference test film, narrated as a screen recording showing the conversation
- **Documentation** in `docs/mcp/` — public-facing how-to

### Positioning

Differentiators, stated without the head-to-head: chat-driven direction that
produces an **editable workflow you keep** (not a black box), **multi-shot
films up to 600s** with continuity engineering, characters with identity
consistency, music and lip-sync — and an optional external identity-training
escape hatch (Stage 3).

---

## 10. Open Questions

1. **Skill discoverability inside Nodaro.** Should the Nodaro UI surface "Open this in Claude" buttons that pre-load the skill? (Could deep-link via a `claude://` URL or similar.) Recommended: yes — ship a "Make a film with Claude" CTA in the editor that deep-links into Claude with the skill pre-invoked; lifts discoverability for users not already familiar with skills.
2. **Authentication.** The skill needs the user's Nodaro MCP credentials. How is this set up — one-time OAuth, paste API token, or via Anthropic's official Nodaro MCP integration? Recommended: rely on the existing Nodaro MCP OAuth flow (already wired for the `mcp__claude_ai_Nodaro__*` tool surface). No new auth path is needed for the skill itself.
3. **Multi-language support.** The target market includes Hebrew speakers. Should the skill respond in user's language? Recommended: yes for dialogue/narration text generated by `generate_speech` (ElevenLabs supports many languages), conversation tone matches user, but JSON keys + tool calls stay English.
4. **Cost transparency mid-session.** When to show running totals? Recommended: after each stage feels right; mid-stage may be too noisy. Always show estimated cost BEFORE expensive batches (animation, music, lip-sync).
5. **Approval UX in non-Claude clients.** Claude Desktop renders rich previews well. ChatGPT and others may render image attachments differently. Recommended: ship and test in Claude first; document known rendering quirks per platform in `docs/mcp/film-director.md` as we encounter them.
6. **Should the skill be open-source?** Could be a separate npm/GitHub repo. Pros: community-extensible, Anthropic skill registry visibility. Cons: [reference removed]. Recommended: yes — publish as open-source (MIT or similar) under a `nodaro-skills` repo; the value is in Nodaro's MCP + credits + canvas, not the skill markdown itself. Community contributions add film genres / ad templates we wouldn't ship ourselves.
7. **Programmatic mode coexistence.** If the native pipeline ships only Programmatic Mode (per the recommendation), how do these two interact? Recommended: keep them separate. Skill = interactive, Pipeline node = programmatic. No need to unify.
8. **Backward compatibility.** When the skill is updated, old conversations don't auto-upgrade. Should ongoing sessions pin to the version that started them? Recommended: yes, version-pin per session.
9. **External identity-training integration.** Several decisions deferred for the Stage 3 escape hatch: per-user opt-in vs instance-wide enablement? Cost-share / billing pass-through model for the provider's usage? Persistence of `reference_id` — per character node, per user library, or per workspace? Auto-trigger threshold (e.g., always offer it for characters in 5+ shots, or only on explicit user request)? Recommended: defer all of these to a Phase 2+ integration design; the escape hatch in Stage 3 keeps the door open without committing.

---

## 11. Phased Rollout

### Phase 0 (2-3 weeks): Ship the skill + live canvas animations

Week 1 — Skill content + §5.4 Layer 1-3 audit:
- Author `nodaro-film-director.md` (the skill content from Section 3)
- **Audit MCP tools** per the §5.4 checklist (all are HIGH-severity gates for launch):
  - Confirm every generation MCP tool listed in §4 actually auto-attaches a node when passed `workflowId`; document any gaps as Layer 3 follow-ups (manual edge wiring required)
  - Confirm generation tools accept `refNodeIds` (or equivalent) for edge wiring at creation time
  - Confirm `update_workflow_json` returns Claude-readable Zod errors (not just HTTP 400); wrap errors in a friendlier shape for MCP responses if not
- **Create and seed the reference template workflow** at `nodaro-internal/film-template` — one example of every manually-constructed node type (Script display, shot-list metadata, sticky notes, etc.). ~2 hours of one-time curation.
- Test end-to-end with the original successful reference workflow as the validation case
- Document MCP tool requirements

Week 2 — Live canvas infrastructure (reusable):
- Implement node fade-in + scale-up animation on insert (~300ms)
- Implement edge stretch animation on insert (~500ms)
- Implement camera auto-pan to follow newly-added nodes
- Verify Pattern B incremental workflow updates render smoothly with these animations
- These three animations were already specced in `[internal spec reference removed]` §7.1 — they become reusable for both the skill and any future Programmatic Mode pipeline

Week 3 — Polish + launch:
- Refine skill based on test results
- Add cost transparency hooks (`check_balance` checkpoints before expensive stages)
- **Verify context-window headroom** (final §5.4 audit item): test that `get_workflow_json` response size doesn't exceed MCP client context limits for a typical 50-node workflow across Claude Desktop, Claude Code, ChatGPT, Gemini, Cursor
- Write public docs in `docs/mcp/film-director.md`
- Record the demo — split-screen (Claude chat ↔ Nodaro canvas) for the marketing pitch
- Soft launch to test users

**Ship criteria:** The skill produces a film of similar quality to the manual reference test, in a single conversation, with the editable Nodaro workflow visibly assembling on the canvas in real-time as the conversation progresses.

### Phase 1 (future, if needed): Programmatic-mode pipeline node

Only if RSS-to-video / scheduled-trigger use cases prove out:

- Build the `GenerativePipelineNode` from the existing architecture spec, **scoped only to Programmatic Mode**
- Drop Interactive Mode from the spec entirely (the skill replaces it)
- Drop Auto Mode toggle (Programmatic is always auto)
- ~3-4 weeks scope instead of 8-12

**Total roadmap if Phase 1 ships: ~5-7 weeks (Phase 0 + Phase 1).**

### Phase 2+: Skill evolution

- Multi-language support
- Personalization
- Skill marketplace (other film genres, advertising templates, etc.)
- Tighter Nodaro UI integration ("Open in Claude" deep links)
- **Evaluate the identity-training integration:** if the default identity-lock path proves insufficient in production (visible face drift on characters in 5+ shots), wire up the external provider's MCP and activate the Stage 3 escape hatch. Resolve the open questions in §10 first.

---

## 12. Decision Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Ship skill before pipeline? | **Yes — Phase 0** | 2-3 weeks vs 8-12; captures the proven manual workflow |
| Descope native pipeline's Interactive Mode? | **Yes** | Skill replaces it more faithfully |
| Keep native pipeline's Programmatic Mode? | **Conditional** | Build only if RSS-style automation is a real customer ask |
| Workflow JSON composition pattern | **B (incremental via `create_workflow` + `update_workflow_json`)** | Enables live canvas construction during conversation — preserves the wow-factor |
| Schema reference strategy | **Template workflow + `get_workflow_json`** | Lean, no schema duplication |
| Marketing positioning | **"Watch your film studio build itself on your canvas while you talk to Claude"** | Live-canvas visceral demo + Anthropic partnership angle |
| Cross-platform support | **Yes — anywhere MCP runs** | Maximize distribution |
| External identity-training integration | **Escape hatch only (evaluate in Phase 2+)** | Stage 3 keeps a conditional path; default uses identity-lock at inference; open questions in §10 must be resolved before activation |

---

## 13. Embedded Chat UX (Phase 2+)

By default the user has two windows side-by-side: a Claude chat client (left) and Nodaro canvas (right). This works on day one with zero integration. But the long-term UX play is tighter.

### Three integration options

| Option | Description | Trade-off |
|--------|-------------|-----------|
| **A. Side-by-side (default, Phase 0)** | User opens two windows manually | Zero work; works for every MCP-enabled client |
| **B. Embedded Claude in Nodaro** | A Claude chat panel docks inside the Nodaro UI alongside the canvas | Tightest UX; requires Nodaro to host an MCP client; flagship demo |
| **C. Embedded canvas in Claude** | Mini Nodaro canvas widget shown inside Claude chat via existing MCP UI widgets | Already partially possible (Nodaro MCP returns widgets); embedded canvas is small |

### Recommendation

- **Phase 0:** Ship Option A. No integration work. The skill is the value.
- **Phase 1:** If usage proves out, evaluate Option C as a low-cost enhancement using existing MCP widget infrastructure.
- **Phase 2+:** Build Option B as a flagship integration. Position as "Nodaro Studio with Claude built in." [reference removed].

ChatGPT / Gemini / Cursor users always get Option A regardless, so it stays viable cross-platform.

---

## TL;DR

A 2-3 week skill + 3 reusable canvas animations replaces 8-12 weeks of pipeline engineering, captures the proven manual workflow more faithfully, and ships as a single markdown file editable in minutes. The **"live canvas construction" wow-factor is preserved** via Pattern B incremental workflow updates — the user watches their workflow assemble in real-time while talking to Claude (chat in one window, canvas filling up in another). The skill matches or exceeds the native pipeline on every consumer-facing UX dimension while costing 80% less to build; the only deliberate trade-offs (Programmatic Mode and non-MCP clients) are out-of-scope for v1 and addressed by a much smaller Phase 1 pipeline node if/when needed. Ship this in Phase 0 and descope the native pipeline's Interactive Mode entirely.
