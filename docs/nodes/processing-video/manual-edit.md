# Manual Edit

> Open video in a browser-based web editor for manual adjustments.

## Overview

The Manual Edit node pauses workflow execution and opens the video in a web-based editor. Make manual adjustments (cuts, trims, overlays) in the browser, then confirm to continue the workflow. Useful when automated processing isn't sufficient and human judgment is needed.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Status | Display | — | Shows "Waiting for your edit" when paused |
| Input Video URL | Display | — | URL of the video being edited |

No configurable parameters — click "Open Editor" on the node during workflow execution.

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Edited video

## Edit with AI

On Nodaro Cloud the editor's header has an **Edit with AI** button. It opens a panel beside the editor where you write what you want in your own words, for example "cut the pauses and the ums, add captions and put upbeat music under it". The agents do the steps you name. A general request such as "edit it for me" gets all four. A team of agents then edits the video on the editor's own timeline while you watch, and the timeline scrolls to each change as it lands:

- **Assistant** listens to the video and reads your request. It transcribes the speech with word timings and decides which steps you asked for.
- **Cutter** removes filler sounds ("um", "uh") and cuts the silent pauses between sentences. It keeps a short breath at each cut, so speech never sounds clipped.
- **Captions** writes captions along with the voice, a few words at a time, on a caption track. The captions use the editor's own caption style.
- **Sound** composes instrumental background music for the video. It lays the music on its own track, lowered under the voice and faded out at the end.

Each step is an ordinary edit. You can undo any one of them in the editor, or all of them from the panel with **Undo all**, which never undoes an edit you made yourself. **Stop** ends the run, and whatever the agents already did stays on the timeline.

**Credits.** Edit with AI has no price of its own. You pay for the parts it runs, at their usual prices:

- the transcription ([Transcribe](../ai-text/transcribe.md), ElevenLabs STT);
- the planning (one short text call to Gemini 3.6 Flash, priced like any call to that model);
- the music, when the request asks for it (one [Suno Create Music](../suno-music/suno-generate.md) track).

**What it does not do yet:** b-roll, color grading, reframing to another aspect ratio, and zoom effects. If you ask for one of them, it is left out and the panel says so.

## Best Practices

- Place Manual Edit nodes at points where human review is essential
- Be aware that workflows with Manual Edit nodes cannot run fully autonomously
- Complete your edits promptly — the workflow pauses until you confirm

## Common Use Cases

- Fine-tune AI-generated video before final delivery
- Make precise cuts that automated trimming can't handle
- Add manual annotations or adjustments
- Review and approve content before social media publishing

## Tips

- Manual Edit breaks fully automated pipelines — use only when human input is genuinely needed
- For automated workflows triggered by webhooks or schedules, avoid this node
- The web editor opens in your browser — ensure you have a stable connection
