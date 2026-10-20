# Reframe

> Follow the speaker — turn a recording of people talking into a vertical clip that shows whoever is speaking. One entry in the add-node menu drops the three nodes that do it, wired and grouped.

**Not a node.** Reframe is a menu entry that inserts three ordinary nodes — [Transcribe](../ai-text/transcribe.md) with speaker detection, [Speaker Frames](./speaker-frames.md) and [Speaker View](./speaker-view.md) — inside a group. There is no *Reframe* node type: a workflow that was exported, imported or written by an agent holds those three nodes, never a node called `reframe`. To build the same thing through the API or MCP, create the three nodes and wire them as below.

**Priced by its three nodes.** Reframe feeds Speaker View a video, and [a Speaker View fed a video](./speaker-view.md#a-video-instead-of-an-edit) runs because both Speaker View and Speaker Frames have a credit price. Reframe has no price of its own to add: it inherits theirs (see [Credit Cost](#credit-cost)). Should either price ever be withdrawn, the Reframe entry is hidden from the add-node popup, the sidebar and the suggestions after a wire is dragged from a video, and its group on a canvas shows no estimate.

**Cloud feature.** Speaker Frames and Speaker View run on Nodaro Cloud; on a self-hosted install connected to nodaro.ai they relay to the cloud, as described on their pages.

## What it inserts

Choosing **Reframe** (*Follow the speaker*) in the add-node popup or the sidebar — under its own **Reframe** header in the Video tab — drops one group, labelled **Reframe**, holding:

| Node | Wired from | Seeded with |
|------|------------|-------------|
| [Transcribe](../ai-text/transcribe.md) | the video, into **Audio** | speaker detection on |
| [Speaker Frames](./speaker-frames.md) | the video, into **Video**; Transcribe's transcript (`json`) output, into **Transcript** | the node's defaults |
| [Speaker View](./speaker-view.md) | the video, into **Video**; Transcribe's transcript (`json`) output, into **Transcript**; Speaker Frames' **Face tracks**, into **Face tracks** | **9:16**, **Cut**, **Glide**, and **Preview** quality |

Speaker View is fed a plain video, so it needs no Edit Plan and no Camera Switch — see [A video instead of an edit](./speaker-view.md#a-video-instead-of-an-edit). Speaker View starts at **Preview** quality, so the first run is the cheap one; switch it to Final, or use **Render final**, when the framing is right. The three are inserted in one step: a single undo removes the whole group.

Because these are the real nodes, everything they do still works as it does on their own pages — the **Preview** and the stop rule, **Render final**, **Edit framing…**, and **Correcting a track**, which is the repair path when a face is attributed to the wrong speaker. The group is a frame, not a wrapper: open any of the three and change its settings in its own panel.

## Wiring the video

One video feeds three inputs. The macro wires it when it knows which video you mean:

- **Dragged from a video output.** Drop a wire from a video output onto the canvas and pick **Reframe** from the menu: that video is wired into all three.
- **A video node is selected.** Add Reframe from the popup or the sidebar with exactly one node selected that has a video output: that video is wired into all three. With none selected, or several, nothing is guessed. Pressing **Tab** to add a node after the focused one behaves the same: Reframe skips the *Connect* dialog and wires the video only if the focused node is also the single selected node that has a video output.

Otherwise the group lands with a **Wire a video** badge. Connect a video to any one of the three — Transcribe's **Audio**, Speaker Frames' **Video** or Speaker View's **Video** — and it is wired to all three at once. Only a node that outputs a video does this: an audio source wired into Transcribe's **Audio** is just that wire, and it does not count as a video — the badge stays, and a video wired later into Speaker Frames' or Speaker View's **Video** still wires the other video input, leaving Transcribe's audio wire as it is. This happens once, while no input has a video yet: wiring a second video later changes only the input you connected.

A video wire into Transcribe's **Audio** is how the shipped podcast templates feed a clip to Transcribe; the audio is read from the video.

## Where it is offered

Reframe is offered wherever all three nodes are, while Speaker View and Speaker Frames are both priced. A deployment that hides any one of them hides Reframe too. From a wire it is offered only for a **video output** (dragging from an input asks for a producer, which Reframe is not).

**Groups do not nest.** Dropping Reframe inside an existing group lands the new group right beside it (to its right, on the nearest free spot) instead; the existing group is left as it was. Reframe is refused while a run is in progress, and on a read-only canvas.

## Credit Cost

Reframe has no credit id of its own. Each of its three nodes charges its own price when it runs, as on its own page:

- **Reframe = Transcribe + Speaker Frames + Speaker View**, where Speaker Frames is charged per started block of 1,000 sampled frames — the whole clip at 2 frames per second, 2.2<!-- credits-rate: speaker-frames --> credits a block ([Speaker Frames: Credit Cost](./speaker-frames.md#credit-cost)) — and Speaker View per minute of the clip at its rate and tier ([Speaker View: Credit Cost](./speaker-view.md#credit-cost)).

For example, Speaker Frames on a 14-second clip samples 28 frames: one block, 3<!-- credits: speaker-frames -->.

Wherever the editor quotes a price it shows **one summed estimate for the group**:

- on the group itself, a chip with the total of its three nodes. The chip updates when anything upstream of the group changes, not only the nodes wired straight into it;
- in every run confirm — Run, Run selected, Run from here, Run up to here, a single node's run, Render final and Update preview — a **Reframe** row with the group's sum above the run's total (Render final and Update preview also list each node's own row beneath it);
- in the run totals — the Execute button, the run confirm, the credit check before a run, a published app's quote and listing — the total simply counts all three nodes once. A group is a frame and changes no figure.

The group's figure is the sum of its nodes' own lines from the run's estimate, never a second calculation, so it cannot differ from what the run is gated on. Each line leans high as its node's page describes: before the run, Speaker Frames quotes the clip at its recorded length, as Speaker View does (a 14-second upload: one block, 3<!-- credits: speaker-frames -->), and at 180 minutes on its one camera (22 blocks, 49<!-- credits: speaker-frames@22 -->) only when the clip's length is not known before the run; the run then reserves the clip's own measured frames and charges the frames it sampled.

## Notes

- **A failed leg keeps what was charged.** Each node is its own job: a run that fails at Speaker Frames has already charged Transcribe, and none of the later nodes reserve. Run-start checks — a video already as narrow as the target, an edit and a video wired together, a missing transcript — are made before any node runs, so Transcribe is not charged for a run that cannot succeed.
- **A group is the user's to edit.** Move, rename, recolour or ungroup it like any group; deleting a node leaves the rest as ordinary nodes.
