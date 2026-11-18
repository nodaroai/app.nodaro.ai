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

On Nodaro Cloud the editor opens with the **Edit with AI** panel beside it, wherever the window has room for both (the **Edit with AI** button in the editor's header closes and opens it). It starts with one question, *What do you want from this video?*, and what it can do as rows in two tabs:

- **Edit this video**
  - *Tidy up:* **Cut the pauses**, **Remove filler words**, **Remove mistakes and repeats**
  - *Add:* **Add captions**, **Add music**, **Visuals that follow the talk (b-roll)**, **Titles and key words on screen**
  - *Look:* **Change the picture**, **Color**, **Zoom on key lines**
  - *Format:* **Phone version 9:16**, and **Switch cameras** once two or more cameras of the same moment are on the timeline
- **Make from it:** **Short clips**, **Trailer**, **Chapters**

Tap a row to write it into your request, or say what you want in your own words, for example "cut the pauses, add captions and make a phone version". Under the field the panel says what it will do. The footer shows what the request costs before anything starts (tap the price to see its parts), and the one button that starts it. A request made only of the rows' own words starts at once; one in your own words is read by the assistant first. While a run is on, the line at the top of the panel says what is happening: reading your request, listening to the video, working (how many steps are done, and who is at work), done, or stopped.

### The agents

A team of agents edits the video on the editor's own timeline while you watch. Each has a name and a color, and its cursor works where its change lands: the razor and the cuts on the timeline, the Text tool and the captions, the media bin, the properties, the player.

- **Assistant** reads your request, listens to the video once (a transcript with word timings and speakers), and makes the clips, the trailer and the chapters.
- **Cutter** cuts the pauses (keeping a short breath at each cut, so speech never sounds clipped) and the filler sounds of the video's language. On a second pass it cuts the mistakes and repeats that an [Edit Plan](./edit-plan.md) finds in what was said: restarts, false starts, repeated takes and off-topic parts.
- **Captions** writes captions along with the voice, a few words at a time, with the spoken word lit up as it is said. They are laid as one edit, so later cuts keep them on their words. Asked again, new captions take the place of the old ones.
- **Sound** composes instrumental music for the video, finds its beat, and lays it on its own track (one that cuts leave alone) so a beat lands on the first spoken word. It is lowered under the voice, comes up where nobody speaks, and fades out at the end; after any cut it is fitted to the new length.
- **Visuals that follow the talk (b-roll)** makes a picture about every seven and a half seconds (four for half a minute, eight for a minute, at most twenty) for the moments the assistant picks; under the row you can ask for fewer or more, from 1 to 40, and the price follows. Pictures come at least two seconds apart, each an image made for its words. Each is laid a moment before the words it belongs to (the few words inside the sentence, not the sentence's start), above the video and under the captions. It shows **beside the speaker**: the frame is split in two for those seconds (left and right in a wide video, top and bottom in a phone video), the picture in one half and the speaker in the other; the footage itself is not changed. Where the speaker layout already shows the video in several parts, the picture fills the frame instead. When the words are about a named public figure, company, product or place, the image shows it by name. After the run the panel lists the pictures in order under **Pictures on the words**: a row takes the playhead there, and **Change** opens it to choose where it shows (**Beside the speaker**, **In a window**, where it keeps its own shape and has rounded corners, or **Full frame**, where it moves a little), set how long it stays (half a second shorter or longer at a tap, from one second to ten, never into the next picture), make the picture again from other words (one more image, at the same price), use a picture of your own, or remove it. **Add a picture here** lays one more picture where the playhead is, made from words you write (one image, at the same price) or from a picture of your own; it stays two and a half seconds beside the speaker, and is refused where a picture already shows. A picture the image model would not make stays in the list with the reason it gave, and is not charged; you can give it a picture of your own, try other words, or leave the moment without one.
- **Titles and key words on screen** puts short texts on the screen as they are said, about one every fifteen seconds (two for half a minute, four for a minute, at most ten); under the row you choose the look every text takes (**Outline**, **Clean** or **Sticker**) and can ask for fewer or more, from 1 to 20. The assistant picks the moments and writes each text in the language of the video: a **headline** at the start, a strong line with its **key words** in color, a big **number** over what it counts, or a short **list** whose lines come in one after another. Each text comes in on its own words, stays two to four seconds, and sits in the top of the frame, clear of the captions. They are not the captions, which stay as they are. A text never lies on a picture: while a picture shows beside the speaker or in a window, the text keeps to the speaker's part of the frame, and while a picture fills the frame there is no text. They are the editor's own text clips, on one track above everything. After the run the panel lists them under **Text on screen**: a row takes the playhead there, and **Change** opens it to edit the text and the words in color, choose where it shows (**Top**, **Middle** or **Above the captions**), how it comes in (**Pop**, **Rise**, **Type** or **Blur in**) and its colors, or remove it. Each of the three colors (the text, the key words, and the background, which can also be none) is picked from a few offered colors or from the full color picker, and one button puts the same colors on every text. Asked again, new texts take the place of the earlier ones.
- **Picture** changes anything in the picture (the background, someone's clothes, a car, the sky, the style) on one shot. Video models edit up to ten seconds at a time, so it takes the shot under the playhead (the first one when the playhead is at the start) and never crosses a cut, which keeps the lips on the voice. It says which seconds before anything is charged, and lays the changed shot over the original, with the original sound.
- **Color** gives the video a warm, cool, vivid or black-and-white look with the editor's own color effect. Asked again, the new look replaces the old one.
- **Framer** punches in on up to six key lines, and makes the phone version: the picture is cropped to 9:16 and the crop follows the face (whoever is speaking, when the speakers are told apart). The captions are laid again in the new frame.
- **Director** switches between the cameras to whoever is speaking.

The first cuts are shown one at a time, with a moment of play across each join; the rest go faster. **1× | 2×** sets the pace, **Skip to the end** lands everything left at once (only the show is skipped, never the work), and **Stop** ends the run, keeping what the agents already did.

### After a run

One line says what the edit did ("3:02 → 2:31 · 23 cuts · 148 captions · music 112 BPM"). **Original | Split | Edited** compares the edit with the original in the editor's own player, side by side in **Split**; a run ends on Split, playing. Once there is a phone version, **Wide | Phone** switches between the two formats. **Undo all** undoes every step the panel's runs made, newest first, but never an edit you made yourself.

What is made from the video waits under **Made from this video**. Each clip and the trailer is a timeline tab of its own (**Open its tab**), with its pauses cut and its captions inside it, and each clip is framed for the phone on the face. The chapters are marked on the ruler, and **Copy** copies their list for the video's description. What is made stays when the edit is undone.

Each step is an ordinary edit, and its row says what it did ("23 pauses cut", "148 captions"). Asked again, a step behaves the way it should for what it is:

- the cuts and the phone version are done once per video, and are not offered again;
- captions, music, b-roll, the texts on screen, the look and the chapters are redone in place of the last;
- a picture change, clips and a trailer are made again, as more.

When the panel is offered more than one video, it asks which one to edit, and keeps what it did on each one apart.

### Credits

Editing on the timeline is free: cutting the pauses and the filler words, laying the captions and the texts on screen, the color look and the zooms add nothing. You pay for what a run asks of the platform, at the same prices as anywhere else, shown before you start:

- **Reading your request**, when it is in your own words: one structured text call to Gemini 3.6 Flash, priced like any call to that model. A request made only of the rows' own words is not read.
- **Listening to the video**: one [Transcribe](../ai-text/transcribe.md) with ElevenLabs STT, 25 credits<!-- credits: elevenlabs-stt -->, once per video while the editor stays open, and only for a step that reads the speech.
- **Choosing the moments** for b-roll, the texts on screen and zooms: one short text call to Claude Sonnet 5.5, priced like any call to that model.
- **Remove mistakes and repeats**: an [Edit Plan](./edit-plan.md) in Tighten mode at the economy tier, 2.2<!-- credits-rate: edit-plan:tighten:economy:per-minute --> credits per minute of the video.
- **Add music**: one [Suno Create Music](../suno-music/suno-generate.md) track.
- **Visuals that follow the talk (b-roll)**: one Nano Banana 2 Lite image per cutaway, 11 credits<!-- credits: nano-banana-2-lite --> each.
- **Change the picture**: a [Trim Video](./trim-video.md) of the shot (22 credits<!-- credits: trim-video@2 --> for ten seconds) and one [Video to Video](../ai-video/video-to-video.md) edit with Wan 2.7 VideoEdit, priced by the shot's length: 352 credits<!-- credits: wan-videoedit --> up to five seconds, 660 credits<!-- credits: wan-videoedit:1080p:per-4s@2.5 --> for ten.
- **Phone version**: [Speaker Frames](./speaker-frames.md) face tracking, 2.2<!-- credits-rate: speaker-frames --> credits per started block of 1,000 sampled frames (two a second), the run's blocks priced together and rounded up once.
- **Switch cameras**: one [Camera Switch](./camera-switch.md), 11 credits<!-- credits: camera-switch -->.
- **Short clips, Trailer, Chapters**: each is priced like its own node. That is its Edit Plan at the economy tier (in Clips or Trailer mode, 11<!-- credits-rate: edit-plan:clips:economy:flat --> credits plus 2.2<!-- credits-rate: edit-plan:tighten:economy:per-minute --> per minute; in Chapters mode, 2.2<!-- credits-rate: edit-plan:tighten:economy:per-minute --> per minute), plus the node's per-run fee: 11 credits<!-- credits: use-case-fee:clip-pack --> for [Clip Pack](./clip-pack.md), 11 credits<!-- credits: use-case-fee:episode-trailer --> for [Trailer](./episode-trailer.md) and 11 credits<!-- credits: use-case-fee:episode-chapters --> for [Chapters](./episode-chapters.md). Short clips add the face tracking that frames them. Where the platform does not plan trailers yet, the assistant picks the trailer's moments in the choosing call instead of an Edit Plan. The fee is charged once the result is made, so a run that makes nothing is not charged it.

When the plan the assistant makes does more than the price shown (a request in your own words can bring more steps), the panel lists each paid part it adds, with its price, and what the whole plan is charged. Nothing more is charged until you choose.

### What it cannot do

Something that is not in the video, or that needs an ability the editor does not have yet (an editor that has not been updated offers only the cuts and the captions), is said plainly:

- **A request for only such things** stops right after it is read. The panel says what cannot be done and what it can do. Nothing is edited, and only the reading is charged.
- **A request that mixes them with what it can do** stops before anything else is charged. The panel names what it would leave out and asks first. You can run the part it can do, or change your request.

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
