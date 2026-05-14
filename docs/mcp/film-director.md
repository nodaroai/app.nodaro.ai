# Film Director Skill

Make a cinematic video through conversation. The Film Director is a Claude Skill that drives a 10-stage director workflow — script, shot list, characters, locations, storyboard, animation, audio, final cut — and assembles a fully editable Nodaro workflow on your canvas as you talk.

You watch the workflow fill up stage-by-stage. The result is both a finished video AND a 50-150 node Nodaro graph you can keep refining forever.

## What you'll need

- A Nodaro account with enough credits for the film you have in mind (typical 30-second short: 200-500 credits)
- Claude (Claude.ai or Claude Code) connected to Nodaro per [Connecting Claude.ai](./connecting-claude.md)
- The skill installed in your Claude environment (see [Installing the skill](#installing-the-skill) below)
- A browser tab open to your Nodaro editor — keep it visible

## Quick start

1. Open your Claude client with the skill installed
2. Open `https://app.nodaro.ai` in another browser tab
3. In Claude, describe your film:

   > "Make a 30-second action trailer about a fighter pilot's last mission over the Pacific."

4. Claude creates a workflow on your canvas (Stage 0), then walks you through Stages 1-9, pausing at each for your approval
5. At every stage you can: approve, ask Claude to refine, or describe specific changes

## The 10 stages

| Stage | What happens | Typical time |
|-------|--------------|-------------|
| 0 — Initialize | Workflow created on your canvas | <5 sec |
| 1 — Script | Claude drafts a screenplay | 1-2 min |
| 2 — Shot list | Per-shot table with duration, camera, continuity | 1-2 min |
| 3 — Characters | Main image + angle variants + emotion variants + voice | 2-5 min per character |
| 4 — Locations | Main image + time-of-day / weather variants | 1-3 min per location |
| 5 — Storyboard | One scene image per shot, using character + location refs | ~30 sec per shot |
| 6 — Animation | Sequential video per shot with engineered continuity | 1-3 min per shot |
| 7 — Audio | Narration, dialogue, lip-sync, music, SFX, cut plan | 2-5 min |
| 8 — Final cut | Trims, transitions, audio merge | 1-2 min |
| 9 — Wrap-up | Verify graph, deliver final video | <30 sec |

A 30-second short film typically takes 20-40 minutes from prompt to delivery.

## What makes this different

- **Built live on your canvas.** Nodes appear as Claude works. The final state is an editable Nodaro graph — every step preserved.
- **Approval gates everywhere.** You're the director; Claude is the assistant. Nothing renders to "final" without your sign-off.
- **Multi-shot continuity engineering.** Where the shot list calls for it, Claude extracts the last frame of shot N and uses it as the start frame for shot N+1, so action chains plausibly across cuts. Otherwise it anchors continuity via the motion script.
- **You keep the workflow.** Regenerate any scene, swap any model, branch from any stage. The graph is yours — Claude doesn't need to be re-summoned to edit it.

## Installing the skill

The skill is open-source and lives at `.claude/skills/nodaro-film-director/SKILL.md` in the [Nodaro repo](https://github.com/nodaroai/app.nodaro.ai).

For local use:

1. Clone or fetch the `SKILL.md` file
2. Drop it into your Claude Code skills directory (`.claude/skills/nodaro-film-director/SKILL.md`)
3. The skill auto-activates when you describe a video, short film, trailer, music video, reel, or commercial idea

For Claude.ai (web) users: skill distribution via a public skills registry is on the roadmap. Until then, the skill is most useful in Claude Code.

## After your film is finished

- **Edit any node on the canvas** — click a scene image, animation, or audio node to swap models, change prompts, or regenerate
- **Publish as a Nodaro app** — turn the finished workflow into a parameterized app others can run with different inputs
- **Export the workflow** — `export_workflow` returns a portable JSON bundle ([Tool reference](./tools.md#export_workflow))
- **Re-summon Claude** — start a new chat, point at the workflow URL, and ask for changes ("add a scene", "swap the music", "regenerate shot 3")

## Client support

The skill works in any MCP-enabled Claude client. Tested support:

| Client | Status | Notes |
|--------|--------|-------|
| Claude Code | Tested | Best local skill loading; full canvas integration |
| Claude.ai (web) | Tested | Image and video previews render inline |
| Other MCP clients (Cursor, Cline, Continue, Goose) | Untested with this skill | The underlying MCP tools work; the skill itself targets Claude |

Connection guides: [Claude.ai](./connecting-claude.md), [Cursor](./connecting-cursor.md), [Cline](./connecting-cline.md), [Continue.dev](./connecting-continue.md), [Goose](./connecting-goose.md).

## Troubleshooting

See the general [MCP troubleshooting guide](./troubleshooting.md). Skill-specific issues:

- **Canvas stays empty after I approve a stage** — The skill batches nodes per stage and writes them in one `update_workflow_json` call after your approval. Wait for Claude to say "added to your canvas" before refreshing.
- **The editor URL Claude shared doesn't open** — Confirm it matches your Nodaro instance. The skill constructs `<base_url>/editor/<workflowId>`; if you're on a non-default deployment, tell Claude the correct base URL up front.
- **Out of credits mid-session** — Top up via the [pricing page](https://nodaro.ai/pricing). The skill notes the credit cost before each generation, but won't pre-check the full session budget.
- **Claude offers [redacted-reference] Soul identity training but I don't see it** — Soul integration is instance-dependent and not enabled by default. If unavailable, the skill falls back to Nodaro's built-in identity-lock prompts (still good quality, just not LoRA-level fidelity).
- **A shot's animation is rejected 3 times** — The skill caps retries at 3 per shot. After that it pauses for your choice: continue and revisit later via the canvas, or stop here. The unapproved shot is left as an editable node so you can iterate manually.

## Under the hood

The skill is a single markdown file (`SKILL.md`) that orchestrates calls to the Nodaro MCP tools listed in the [Tool reference](./tools.md). It uses no private APIs — every action Claude takes is something you can do yourself via MCP, the dashboard, or the [SDK](../sdk-reference.md).

***REDACTED-OSS-SCRUB***

## Related

- [Connecting Claude.ai](./connecting-claude.md)
- [MCP Tools Reference](./tools.md)
- [Build your own MCP client](./build-your-own-client.md)
- [Troubleshooting](./troubleshooting.md)
