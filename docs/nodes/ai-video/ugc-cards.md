# UGC Cards
> Times a UGC video's screenshot cards and captions to the creator's speech, checks that each clip said its line, and writes the Notes.

**Availability:** Nodaro Cloud only.

## Overview

UGC Cards works on the joined video (the clips of [UGC Clip](./ugc-clip.md), joined by [Combine Videos](../processing-video/combine-videos.md)). It finds when each word is said, and from that it times:

- the **screenshot cards**: each screenshot pops up while the creator talks about it. They leave as a layer plan for [Video Overlay](../processing-video/video-overlay.md#layer-plan-input).
- the **captions**: the opening line, where it ends, and the timed words of the rest. They leave as a caption plan for [Add Captions](../processing-video/add-captions.md#caption-plan-input), which draws the opening line with the Hook Plate look and the rest in its own caption style.

It also checks that each clip said its line, and writes the **Notes**: plain sentences about anything that did not go to plan.

The word timings come from a word alignment of the clips' words against the joined video. If the alignment fails or finds no words, the cards and captions are timed from speech recognition instead. If the transcription fails, the speech check does not run. If nothing can be timed, both plans are empty, and Video Overlay and Add Captions pass the video through unchanged, at no cost. The Notes say which of these happened.

## Configuration

No settings. The settings show the last run's Notes.

## Inputs & Outputs

- **Input** `plan` (**Script**) — UGC Clips' **Script (sized)** output. Anything else fails the node, before either timing job starts, with "Connect the Script (sized) output of UGC Clips."
- **Input** `video` (**Video**) — the joined video. Without it: "Connect the joined video."
- **Input** `transcript` (**Transcript**) — UGC Clips' **Transcript** output. Without it: "Connect the Transcript output of UGC Clips."
- **Input** `notes` (**Clip notes**) — UGC Clip's **Video** output: each clip's warnings and its real length (a clip lengthened to fit its voice moves the speech check's windows).
- **Output** `layerPlan` (**Layer plan**) — the cards, as JSON, for Video Overlay's **Layer plan** input.
- **Output** `captionPlan` (**Caption plan**) — the captions, as JSON, for Add Captions' **Caption plan** input.
- **Output** `report` (**Notes**) — plain text, one sentence per line. In a published app the Notes are a text output; an API run's result gives them as UGC Cards' `text`.

### The Notes

| When | Sentence |
|------|----------|
| No screenshots, or 1 or 2 (which the script drops) | No screenshot cards: the video is the creator talking. Add 3 to 8 screenshots for cards. |
| The word alignment failed or found no words | Captions and cards were timed from speech recognition. |
| The transcription failed | The speech check did not run: the speech could not be transcribed. |
| Nothing could be timed | No cards or captions: the speech could not be timed. |
| A card would have covered the closing line | Card *n* was left out: it would have covered the closing line. |
| A clip failed its check twice | Clip *n* still showed a problem after one re-render (*what the check found*). Re-render it from the UGC Clip node. |
| A clip failed its check with no room left to re-render it | Clip *n* showed a problem (*what the check found*) and there was no room left to re-render it. Re-render it from the UGC Clip node. |
| A clip's re-render failed | Clip *n*'s re-render failed, so the first render is kept. |
| A clip's speech did not match its line | Clip *n* may not say its line exactly: heard "*what was heard*". |
| A clip was lengthened to fit its voice | Clip *n* was lengthened to fit its voice. |
| Nothing went wrong | No issues. |

## Credit Cost

Free of its own. It runs one word-alignment job (33 credits<!-- credits: forced-alignment -->) and one transcription job (25 credits<!-- credits: elevenlabs-stt -->) on the joined video, each billed at its own price.

When your credits cannot cover them, the node stops with the usual credits refusal: the cards are never made without their captions. It first checks that the UGC routes are served, at no cost, so nothing is paid where they are not.

## Tips

- Read the Notes after every run: a clip that may not say its line, or one that still showed a problem, is the one to re-render on UGC Clip.
- Wire UGC Clip into **Clip notes**: without it the Notes say nothing about the clips.
- Publishing ships no cards or Notes — except a template published with **Include this run's results**, which shows the cards and the Notes as an example (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)).

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
- [UGC Creator](./ugc-creator.md) · [UGC Script](./ugc-script.md) · [UGC Clips](./ugc-clips.md) · [UGC Clip](./ugc-clip.md)
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
