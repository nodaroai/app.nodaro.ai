# UGC Clips
> Splits a UGC script into clips, one per take, and shows what the clips will cost.

**Availability:** Nodaro Cloud only.

## Overview

UGC Clips takes the script from [UGC Script](./ugc-script.md) and the creator from [UGC Creator](./ugc-creator.md), checks the script again, and splits it into clips, one per take. Each clip goes to [UGC Clip](./ugc-clip.md), which renders it; how many clips a video has depends on its length and its lines. The node shows the clips and the length of each.

A script that breaks a rule (possible only after you edit its lines) fails the node before any clip is paid for: "The script needs changes:" followed by each problem and its fix.

A Hebrew script is first recorded as one speech with the chosen voice, its words are timed, and it is split at its pauses; UGC Clips then hands on one clip per piece (each up to 7 seconds). These three steps are charged at their own prices. Hebrew voices: Maya and Shira (woman), Itai and Omer (man).

### What the clips will cost

After you run UGC Clips with its own ▶, it shows what its clips will cost: a line for each clip, and for each step after the clips (joining them when there are several, the word timings, the speech check, the screenshot cards when there are any, and the captions), then the **Expected** total and what is **Held while clips render**. Running the nodes one at a time this way, you see the figure before any clip renders. A run of the workflow goes straight on to the clips and shows no figure here; the run's own price is in [Prices in the editor](./ugc-clip.md#prices-in-the-editor).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Voice (`voiceId`) | voice | Default voice | The voice the creator speaks with. **Default voice** picks one to suit the creator; or choose any voice from the voice browser |

## Inputs & Outputs

- **Input** `plan` (**Script**) — UGC Script's **Script** output. Without it the node fails with "Connect the Script output of UGC Script."
- **Input** `creator` (**Creator**) — UGC Creator's **Creator** output. While UGC Creator has none (it has not run, or its options wait for your pick), the node fails with "UGC Creator has no creator yet. Run it, or pick one of its options."
- **Output** `clips` (**Clips**) — the clips, one per take. An edge from it is **Each** by default, so UGC Clip runs once per clip ([Edge Modes](../../edge-modes.md#mode-2-each-fan-out)); a video of one clip hands UGC Clip that clip.
- **Output** `plan-out` (**Script (sized)**) — the script with its clips marked, as JSON, for UGC Cards' **Script** input. One value.
- **Output** `transcript` (**Transcript**) — plain text: every word the clips say, in order, for UGC Cards' **Transcript** input. One value.

Only **Clips** fans out; the other two outputs pass one value, whatever their edges say.

## Credit Cost

Free. The figures it shows are what UGC Clip and the steps after it will cost: see [UGC Clip](./ugc-clip.md#credit-cost).

## Tips

- Run UGC Script, UGC Creator and UGC Clips one at a time (each with its own ▶) to see what the clips will cost before you render them.
- Check the clip lengths here before rendering: a longer video makes more clips.

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
- [UGC Creator](./ugc-creator.md) · [UGC Script](./ugc-script.md) · [UGC Clip](./ugc-clip.md) · [UGC Cards](./ugc-cards.md)
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
