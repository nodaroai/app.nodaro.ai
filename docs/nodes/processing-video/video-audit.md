# AI Audit

> Re-watch a finished analysis against the actual footage, apply only the
> corrections the video itself confirms, and disclose every change — and every
> declined change — in a report.

## Overview

**Availability.** Native on Nodaro Cloud. On a self-hosted install the node
appears with a **NODARO** mark and runs through your
[nodaro.ai connection](../../community-cloud-connect.md) — OAuth Connect or a
pasted API key — billed to the connected nodaro.ai account. Without a
connection the node card shows a **Connect nodaro.ai** CTA and a run refuses
with `503 nodaro_connection_required`.

The AI Audit node (`video-audit`) is a fix-and-disclose quality pass for a
[Video Analysis](./video-analysis.md) result. It re-watches the clip and
cross-checks every claim in the analysis against what is actually in the
footage. Corrections are applied only when the video itself confirms them,
under conservative guards — the audit is never allowed to silently rewrite the
analysis. Every outcome of that re-watch is disclosed in a report: what was
fixed, what was proposed but declined, and what was merely flagged for a human
to look at.

- **Fix-and-disclose, not silent rewrite.** Nothing in the corrected analysis
  changes without a matching entry in the report explaining why.
- **Reuses the Video Analysis contract.** The corrected analysis it returns is
  the exact same shape as [Video Analysis's output](./video-analysis.md#output)
  — `meta` + `slots` + `scenes[]` — so every node that already consumes a
  Video Analysis result (for example [Generate Video
  Pro](../ai-video/generate-video-pro.md)'s auto-cast) consumes an audited one
  identically. No adapter, no re-wiring.
- **Knob-free.** There is no quality tier or option to configure — the audit
  follows the footage. The only lever is whether you wire in a finished
  analysis.

## Inputs & Outputs

**Inputs:**

| Handle | Required | Description |
|--------|----------|-------------|
| Video | Yes | A wired upstream video. The audit re-watches this footage, so it cannot run without one. Unlike Video Analysis, there is no YouTube URL alternative on this node — wire an actual video producer or an [Upload Video](../input/upload-video.md) / [Video URL](../input/youtube-video.md) input ahead of it. |
| Analysis | No | The JSON result from a [Video Analysis](./video-analysis.md) node — or another AI Audit node's corrected output — passed through verbatim. Wiring this tells the audit to re-verify that specific analysis against the footage. Leave it unwired and the node runs its own fast analysis first, then audits that. |

**Outputs:**

| Handle | Description |
|--------|-------------|
| `json` | The corrected analysis, in the exact same shape as [Video Analysis's output](./video-analysis.md#output) (`meta` + `slots` + `scenes[]`). Wire it anywhere a Video Analysis result is accepted. |
| `text` | The same corrected analysis as a plain string — wire directly into a prompt/text input (for example Generate Video Pro's prompt) the same way you would Video Analysis's `text` output. |

The disclosure report (below) is not a graph output — it rides alongside the
job's result, rendered on the node itself, and available as
`output_data.report` through the API and MCP (`get_job` after a `video_audit`
call).

**Wired but not yet run.** If an analysis is wired into the Analysis handle
but that upstream node hasn't produced a result yet, the run is refused rather
than silently falling back to auto-running its own analysis at the higher
price. Run the upstream analysis first, or disconnect the handle to let AI
Audit analyze the clip itself.

## Configuration

AI Audit has no configuration fields — no quality tier, no options to pick.
The single fact that changes its behavior and its price is structural, not a
setting: whether an analysis is wired into the Analysis handle. The node (and
its config panel) state this plainly on canvas rather than exposing a knob for
it.

## Output

### The Disclosure Report

Every re-watch verdict lands in the report as exactly one of three kinds — the
audit's fix-and-disclose contract means nothing in the corrected analysis
changes without one of these being recorded:

| Kind | Meaning |
|------|---------|
| **Corrected** | The footage contradicted the analysis and the audit fixed it. Applied under conservative guards, so this only fires when the video itself confirms the change. |
| **Refused** | The audit considered a change but its guards declined to apply it — not enough evidence in the footage to safely act on it. The analysis is left as-is; the concern is disclosed here so you can judge it yourself. |
| **Watch** | Something worth a human look, with no proposed change at all — for example, a state that might have silently dropped between scenes. Purely informational. |

Each finding names the scene number it concerns (matching the corrected
analysis's own scene numbering), optionally the specific field it's about, and
a plain-language reason. The report also carries a one-line summary — the
audit's overall verdict, shown first — and a flag for whether the run had to
analyze the clip itself before auditing it (matching the credit family the run
actually billed — see [Credit Cost](#credit-cost)).

A clean audit — nothing to correct, refuse, or watch — is a valid, common
result: it means the wired analysis held up against the footage.

## Credit Cost

AI Audit is **dynamically priced** by duration bucket, on the same bucket
ladder as [Video Analysis](./video-analysis.md#credit-cost) — the bucket is
the smallest of **60s / 180s / 360s / 600s** that fits the video's probed
duration — but split into two **families** selected by whether an analysis
was wired in, not by a quality tier. The table below is published as
`VIDEO_AUDIT_BUCKET_CREDITS` in `packages/shared/src/video-analysis-pricing.ts`
(the credit prices users are charged) — generated and drift-guarded
internally, never hand-written.

| Family | ≤60s | ≤180s | ≤360s | ≤600s |
|--------|------|-------|-------|-------|
| Analysis wired (`video-audit`) | 213 | 289 | 659 | 1066 |
| No analysis wired (`video-audit:auto`) | 393 | 474 | 1173 | 1912 |

**Worked example.** A 72-second clip falls in the ≤180s bucket. Wire a
finished analysis into the Analysis handle and the audit — a re-check only —
costs **289 credits**. Leave that handle unwired and the node must run its own
fast analysis before it can audit anything, so the same 72-second clip costs
**474 credits** instead.

Wiring an analysis whenever you already have one is always the cheaper path —
the `video-audit:auto` family's extra cost is the fast analysis pass it runs
on your behalf before auditing, on top of the audit itself.

## Limits

- **Maximum duration:** 600 seconds (10 minutes), same cap as Video Analysis.
- **No YouTube source.** Unlike Video Analysis, AI Audit takes a video URL
  only — there is no `youtubeUrl` config field. Wire a video producer or an
  [Upload Video](../input/upload-video.md) / [Video URL](../input/youtube-video.md)
  input node ahead of it.
- **Video is mandatory.** A run with nothing wired into the Video handle is
  refused before any credits are reserved.

## Best Practices

- **Wire the analysis whenever you have one.** It's both cheaper and more
  targeted — the audit re-checks a specific analysis rather than having to
  produce and then immediately re-verify its own.
- **Chaining is supported.** An AI Audit node's own corrected output is a
  valid Analysis input to another AI Audit node — useful for a second,
  independent re-watch pass.
- **Read the report even on a "clean" result.** A summary of "nothing changed"
  alongside `watch` findings still means something is worth a human look, even
  though the audit didn't touch the analysis itself.

## Common Use Cases

- Sanity-check a Video Analysis result before spending downstream generation
  credits recreating scenes from it.
- Catch analysis mistakes a single pass can miss — a misread camera movement,
  an unattributed line of dialogue, a slot description that drifts from what's
  actually on screen.
- Re-verify a saved analysis against the source footage after re-editing or
  re-uploading the clip.

## See Also

- [Video Analysis](./video-analysis.md) — produces the analysis this node
  audits; also the node whose output shape AI Audit's corrected result matches
  exactly.
