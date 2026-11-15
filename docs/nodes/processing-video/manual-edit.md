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

On Nodaro Cloud the editor opens with the **Edit with AI** panel beside it, wherever the window has room for both (the **Edit with AI** button in the editor's header closes and opens it). The line at the top of the panel always says what is happening: ready, reading your request, listening to the video, working (with how many steps are done and who is at work), done, or stopped.

What it can do is shown as cards, in two groups: **Tidy up** (Cut the pauses, Remove filler words) and **Add** (Add captions, Add music). Tap a card to write it into your request, or write what you want in your own words, for example "cut the pauses and the ums, add captions and put upbeat music under it". Under the request the panel says what it will do and what it will be charged, before you start. A general request such as "edit it for me" can get all four steps: when the plan the assistant makes does more than the price shown (it also needs to listen to the video, or to make music), the panel asks first, with what it adds and the new total, and nothing more is charged until you choose. A team of agents then edits the video on the editor's own timeline while you watch, and the timeline scrolls to each change as it lands:

- **Assistant** reads your request first and decides which steps you asked for. Only then does it listen to the video, transcribing the speech with word timings.
- **Cutter** removes filler sounds ("um", "uh") and cuts the silent pauses between sentences. It keeps a short breath at each cut, so speech never sounds clipped.
- **Captions** writes captions along with the voice, a few words at a time, on a caption track. The captions use the editor's own caption style.
- **Sound** composes instrumental background music for the video. It lays the music on its own track, lowered under the voice and faded out at the end.

Each step is an ordinary edit. When the run is done, each card says what it did ("7 pauses cut", "19 captions"), and you can keep going: tap another card and run it. A step already done on this video is not done again. **Play the result** plays the edit from the start, **Compare** shows the original video in place of the editor (the edit stays in the editor; **Back to the edit** returns to it), and **Undo all** undoes every step the panel's runs made, newest first, but never an edit you made yourself. **Stop** ends a run, and whatever the agents already did stays on the timeline.

When the panel is offered more than one video, it asks which one to edit, and keeps what it did on each one apart.

**Credits.** Edit with AI has no price of its own. You pay for the parts it runs, at their usual prices:

- the transcription ([Transcribe](../ai-text/transcribe.md), ElevenLabs STT), once per video while the editor stays open, and only for a step that reads the speech (music alone does not need it);
- the planning, each time you start (one short text call to Gemini 3.6 Flash, priced like any call to that model);
- the music, when the request asks for it (one [Suno Create Music](../suno-music/suno-generate.md) track).

Cutting the pauses and the filler words and adding the captions are the editor's own work and add nothing to that.

**What it does not do yet:** changes inside the picture (such as the color of someone's shirt or the background), b-roll, color grading, reframing to another aspect ratio, and zoom effects.

- **A request for only these** stops right after it is read. The panel says what cannot be done yet and what it can do. Nothing is edited, and only the planning call is charged.
- **A request that mixes them with the four steps** stops before anything else is charged. The panel names what it would leave out and asks first. You can run the steps it can do, or change your request.

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
