# UGC Script
> Writes a UGC video's script, the opening line, the beats and the closing line, from your product name or website and up to 8 screenshots.

**Availability:** Nodaro Cloud only.

## Overview

UGC Script writes what the creator says in a UGC video: the **opening line**, the **beats** and the **closing line**. It reads up to 8 screenshots and the product name or website you give it, checks the script against the video rules, and when the script breaks one, rewrites it from what the check found: three tries in all, the first write and up to two rewrites. It also picks the product category that [UGC Creator](./ugc-creator.md) draws the creator for.

It reads the screenshots as images and never visits the website. Type the product's name, or paste its website: a name of up to 80 characters is used as the brand exactly as typed, and a longer description (up to 300 characters) is read as context, from which the script names the brand.

The node shows the script's lines once it has run. The usual next node is [UGC Clips](./ugc-clips.md), which splits the script into clips.

### Screenshots

- **3 to 8 screenshots:** one beat each, in the order of the Screenshot inputs (Screenshot 1 first). Each one pops up as a card while the creator talks about it ([UGC Cards](./ugc-cards.md) times the cards).
- **1 or 2 screenshots** are dropped: the video is the creator talking, with no cards, and UGC Cards' Notes say so.
- **None:** the same video of the creator talking.

A **Product photo** is optional: with one, the closing line can have the creator hold the product.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Video length (seconds) (`targetDurationSec`) | number | `15` | How long the video should be, 4 to 300 seconds. The script is written to it |
| Keep this script (`keepResult`) | toggle | off | On: the next run hands the last script on without writing again, at no cost. While it is on, the length stays the kept script's own; to change it, turn Keep this script off |

The settings also say in how many rounds the script was written.

### Editing the lines

After a run, the settings show the script's lines: the opening line, each beat, and the closing line. **Edit** lets you change their words. **Save** writes them into the script and turns Keep this script on, so the next run uses your lines; **Cancel** leaves the script as it was. A blank line is refused (for example "Beat 2's line is empty."), and so is a line over the script's character limit ("Beat 2's line is too long. Keep it to … characters or fewer."). Only the lines can be edited.

UGC Clips checks an edited script again before any clip is paid for. A script that breaks a rule fails it with "The script needs changes:" followed by each problem and its fix.

### In a published app

The length can be an app input: **Video length (seconds)**, a slider from 4 to 300, or a choice of the lengths the app allows. The [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) app offers 15, 20 and 25 seconds.

## Inputs & Outputs

- **Input** `site` (**Product name or website**) — text, required. Without it the node fails with "Add the product name or website."
- **Inputs** `screenshot`, `screenshot2` … `screenshot8` (**Screenshot 1** … **Screenshot 8**) — images, optional, in card order. Empty inputs are skipped.
- **Input** `product` (**Product photo**) — an image, optional.
- **Output** `plan` (**Script**) — the script, as JSON, for UGC Clips' **Script** input.
- **Output** `category` (**Category**) — the product category, as plain text, for UGC Creator's **Product category** input, or any text input.

## Credit Cost

20 credits per run, however many rewrites it takes. A run that cannot meet the rules after three tries is refunded. It fails with "The script could not meet the video rules after three tries:" followed by what was still wrong. A run that fails for any other reason is refunded too. The credit id is `ugc-script`.

A kept script is handed on at no cost, and the clips after it are priced at the kept script's own length and screenshot cards: see [Prices in the editor](./ugc-clip.md#prices-in-the-editor).

## Tips

- Upload the screenshots in the order the creator should talk about them: card order is upload order.
- Happy with a script? Turn on **Keep this script** (or edit its lines and save), so the next run of the whole workflow hands it on instead of paying for a new one.

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the five UGC nodes into a finished video
- [UGC Creator](./ugc-creator.md) · [UGC Clips](./ugc-clips.md) · [UGC Clip](./ugc-clip.md) · [UGC Cards](./ugc-cards.md)
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
