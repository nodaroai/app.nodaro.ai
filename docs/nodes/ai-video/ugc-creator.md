# UGC Creator
> Who presents a UGC video: an AI creator, or your own photo.

**Availability:** Nodaro Cloud only.

## Overview

UGC Creator decides who talks to camera in a UGC video: an **AI creator**, drawn for your product, or **your own photo**. The creator goes on to [UGC Clips](./ugc-clips.md), and every clip of the video shows this person.

Creators are adults only. A Person picker wired into **Creator look** that sets an age under 20, or a type that implies a minor with no adult age set, is refused with "That age can't be used: UGC creators are adults only.", and a photo must show exactly one adult with the face clearly visible.

An AI creator is drawn for the product category ([UGC Script](./ugc-script.md) picks it, unless you choose one on the node), the gender you choose, and whatever the pickers wired into **Creator look** set. Each new draw is a different person: it differs from the last creator you saw in at least two of age, hair colour, hairstyle and build, unless the pickers you wired fix them.

In the editor, an AI creator is drawn as a few options shown side by side, and the run stops at UGC Creator until you pick one. In a published app or an API run, one creator is drawn and the run goes straight on. So does a UGC Creator inside a sub-workflow, or one that runs once per item of a list. When only one of the options comes out, it is used without asking.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Creator (`source`) | select | AI creator (`sampled`) | **AI creator**, or **My photo** (`photo`) |
| Gender (`gender`) | select | Woman (`woman`) | **Woman** or **Man**. An AI creator is drawn as that gender, and each image is checked for it |
| Product category (`categoryOverride`) | select | From the script | AI creator only. **From the script** uses the category UGC Script picked; or pick one from the list (Skincare, Tech, Food and others) |
| Seed (`seed`) | number | — | AI creator only, optional: fixes the random choice of the creator's look |
| Keep this creator (`keepResult`) | toggle | off | On: the next run hands the last creator on without drawing again, at no cost |
| Your photo (`photoUrl`) | image URL | — | My photo only: the photo used when nothing is wired into **Your photo** (a wired photo wins). A published app's creator card sets it; the settings show it, with **Remove image**. Publishing never ships it in the app's graph (only as a preview you choose yourself) |

In the editor, give **My photo** its photo by wiring an image (an Upload Image) into **Your photo**. Without one, the node fails with "Connect or upload a photo of yourself."

### Picking a creator

The options wait on the node, side by side, labelled Option 1, Option 2 and so on. **Use this one** keeps the option you pick (Keep this creator turns on), so the next run hands it on without drawing again. Then press **Run from here** on UGC Creator to make the video. While options wait, a run that includes UGC Creator is refused with "Pick a creator first."; **Show new options** draws again, and the new options differ from the ones you saw. If an option can't be made, the others are still shown, with a note.

**Show new options** also draws again over a kept creator: it turns Keep this creator off and runs the node.

## Inputs & Outputs

- **Input** `photo` (**Your photo**) — an image: your photo, for **My photo**.
- **Input** `category` (**Product category**) — UGC Script's **Category** output. A category chosen on the node wins.
- **Input** `pickers` (**Creator look**) — Person, Styling, Setting and Lighting pickers, several on one input. Only the fields you set on them are used; the node lists the pickers wired in.
- **Output** `creator` (**Creator**) — the creator, as JSON, for UGC Clips' **Creator** input.
- **Output** `image` (**Image**) — the creator's image, for any image input.

Nothing leaves the node while its options wait for your pick.

## Credit Cost

Free of its own. Each image it draws is a normal image job, billed at that image model's price, and each is checked with one image reading — an [Image to Text](../ai-image/image-to-text.md) call charged for the tokens it used at its model's rate (~6 credits<!-- credits: image-to-text:claude-sonnet-5.5 --> typical on Claude Sonnet 5.5) — to confirm the person matches the gender you chose. In the editor every option is drawn and checked; in a published app or an API run one creator is drawn and checked. If moderation blocks every image of a draw, one more image is drawn in their place, at its own price, and checked the same way. If no option passes the check, the creator is drawn once more, at the same price again; if that fails too, the run stops before any clip renders, with "The AI creator did not come out as the person you chose. Run UGC Creator again.", and the script already written is still charged. If your credits run out while it draws, it stops; in the editor the buy-credits dialog opens, and the options already checked stay on the node for you to pick. For example, with two options drawn on GPT Image 2.5 Flare and Seedream 5 Pro, priced at 17<!-- credits: gpt-image-2-5-flare --> and 20 credits<!-- credits: seedream-5-pro -->, picking a creator in the editor costs about 17 + 20 + 6 + 6 = ~49 credits<!-- credits: gpt-image-2-5-flare + seedream-5-pro + 2*image-to-text:claude-sonnet-5.5 -->, and the same creator in an app about 17 + 6 = ~23<!-- credits: gpt-image-2-5-flare + image-to-text:claude-sonnet-5.5 --> (each reading is charged what it used). A photo is checked with one image reading (~6 credits<!-- credits: image-to-text:claude-sonnet-5.5 --> typical); a photo that fails it is refused with "This photo can't be used: it must show exactly one adult with the face clearly visible."

A kept creator is handed on at no cost. Before a run, the editor prices the creator with the rest of the video: see [Prices in the editor](./ugc-clip.md#prices-in-the-editor).

## Tips

- Wire pickers into **Creator look** to steer an AI creator: Person for age, hair and build, Styling for makeup, hair and outfit, Setting for where they film, Lighting for the light. Leave it empty for a creator drawn for the product category.
- A published app's graph never carries your photo or your creator's image (it shows one only as a preview you choose yourself) — except a template published with **Include this run's results**, which shows an AI creator's image as an example — and an app set to **My photo** needs the runner's own photo: see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template). Your photo is never included.

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
- [UGC Script](./ugc-script.md) · [UGC Clips](./ugc-clips.md) · [UGC Clip](./ugc-clip.md) · [UGC Cards](./ugc-cards.md)
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
