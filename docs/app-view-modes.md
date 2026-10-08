# App view modes

When you publish a workflow as an app, viewers can run it in one of several
**view modes**. The creator chooses which modes an app exposes (and its default)
when sharing or publishing — in the share/publish dialog under *Allowed view
modes* and *Default view mode*.

| Mode | What it looks like |
|------|--------------------|
| **Horizontal split** | Inputs on the left, results on the right (the classic layout). |
| **Vertical stack** | Inputs on top, results below — good for narrow screens. |
| **Gallery grid** | Inputs and outputs as a responsive grid of cards. |
| **Fullscreen slideshow** | One result at a time, full-bleed. |
| **Compare** | Two results side by side. |
| **Chat** | A chat-style layout: a composer docked at the bottom holds the app's inputs, and each run appears as a message in a scrolling thread above it. |

## Chat mode

Chat mode reframes an app as a conversation. You fill in the app's inputs in the
**composer** at the bottom and press **Launch**; the run appears as a message in
the **thread**, showing its result and — for multi-step workflows — an inline row
of **step chips** that tick off as each step completes. Each past run stays in the
thread, so you can scroll back, **Re-use inputs** to run again with the same
values, **See steps** to inspect an intermediate step's output, or **Download** a
result.

A few things to know:

- **Enable it per app.** Chat is opt-in. A viewer only sees it if the creator
  added *Chat* to the app's allowed view modes (or set it as the default).
- **The composer is a chip bar.** Each input is a compact pill: click it to edit
  the value in a small popover (text and option pickers) or a dialog (lists,
  avatars). Uploads keep their label and show a thumbnail once you add a file.
  The composer always holds the inputs for your **next** run — there's no
  separate "New Run" button; **Launch** creates the run for you, and your values
  stay in the composer so you can tweak and fire again.
- **Launch shows the cost.** When an app charges credits, the **Launch** button
  shows the credit cost for the run.
- **One run at a time.** While a run is in progress the composer is locked; it
  re-opens when the run finishes, ready for your next message.
- **Tap a result to open it full-screen.** From there, **←/→** step through that
  run's items (inputs, then outputs) and **↑/↓** move to the previous/next run.
  Press **Esc** to close.

Chat mode works on both desktop and mobile.

## Render final

*Rolled out under a flag:* the stop at a preview applies only on a
deployment that sets `PREVIEW_STOP_RULE_ENABLED` (see
[deployment](./deployment.md)). Where it is off, an app runs its whole
workflow as before and no card waits; a render whose result is a preview
still shows its **Render final** button, as the editor's node does, and
Render final re-renders it at Final and runs the nodes after it again (the
[API](./api-integration.md#render-final-of-an-app-run) does the same).

When an app's [Apply EDL](./nodes/processing-video/apply-edl.md#render-final)
render is set to **Preview**, a run started on the app's page **stops at a
720p preview** for you to review, as it would in the editor: the nodes after
the render do not run yet, and are not billed.

- **The render's card** shows the preview with the **Preview** label, and a
  **Render final** button with its price. Render final asks before it starts
  (`Render final · ≈530 credits`). It renders the cut at full quality and then
  runs every node after the render, once.
- **Charged to you, outside the app run.** The final and the nodes after it are
  billed to you at their own price, as a second run that is not part of the app
  run: the app creator's fee does not apply to it, and it does not count toward
  the app's daily run limit. Like the app run, it draws on your app credits.
- **The app's listed price** counts both steps: the whole workflow at its
  saved settings (each render at the preview rate), with the creator's fee,
  plus each Render final and the nodes after it, without the fee. A step
  after two renders set to Preview is counted in each of their finals. When
  the price follows the length of the recording you give the app (an Edit
  Plan's pass, the render of a whole episode), it is listed as a fixed
  figure plus a figure per minute of the recording, for example
  **82 + 14/min**. A Trim, Loop or Combine Videos node on the recording you
  give, or on a render or another such step whose length follows it, is
  listed per minute of it too; a Video SFX node on any recording you give, or
  on a step whose length follows it, is listed at its fixed 300-second price,
  since it refuses a video over 5 minutes. On a generated video (Generate
  Video, Image to Video or Text to Video) each of the four is listed at the
  generation's configured duration (8 seconds when none is set, as a run of
  the step after it counts it), or the length the model renders when that is
  longer (its longest clip on auto). On the output of any other step that delivers a video, each of the four is listed at the length that step passes on: a step that keeps its input whole its input's length, a lip sync or an avatar its audio's (at most what its model takes), an extension its input plus the seconds it adds. A voice made from a script the listing can read (a literal script, one fed from an input with a character limit, or one written by a Prompt or AI Writer node) is listed at the seconds that script takes to read, at 12 characters a second (slower for a slower voice speed, and for Chinese, Japanese and Korean text) and at most 300. A Prompt or AI Writer node's script is counted at 8 characters for each token the node can write: its Max Tokens (the node's default when it has none), raised to the model's own minimum when the model shares its output with its thinking, and at the most the node allows when an app exposes that setting or another node writes it. Because that script's language is not known in advance, it is read at the Latin-script rate (with the voice's speed), not the slower rate for Chinese, Japanese and Korean text. A voice whose own text holds a {Reference} is not bounded this way, since the reference can resolve to any length. A script from any other source is not bounded, so the step after it is listed as above. A video link (YouTube or any other) the user replaces counts as the episode, like an uploaded recording. A list you fill is
  listed at the items the creator saved plus a figure per further item, for
  example **82 + 14/min + 30/item**. The creator's flat fee is added once to
  the fixed figure, and the percentage to every figure. The listed price never quotes less than a run
  is charged, whether or not the deployment stops at previews, except for
  Edit Plan's pass on a server that still charges it on the length step the
  recording rounds up to rather than per started minute (see
  [Edit Plan](nodes/processing-video/edit-plan.md#credit-cost)), and a step
  priced by its input's length on a video other than the episode whose length is not known before the run (a second recording such as an intro card, or the output of a step with no length before the run: a YouTube or other video link the user cannot replace, a GIF to Video, the output of Render Video or Manual Edit, a VEO or Runway extension, a Suno music video, a narrated step whose audio is wired in or is a generated voice whose script comes from a source the listing cannot bound (not a literal text, an input with a character limit, or a Prompt or AI Writer node), or a list or sub-workflow), which is listed at a default length;
  where the deployment stops at previews, it can quote more, because a run
  leaves the nodes after the preview to the final, and a step after two
  previews runs only in the later final. It counts every run the editor's
  estimate counts: a node's Repeat count, each of several providers on one
  node at its own price, and the runs a List, Content Ideas or other Each wire
  fans out (a Content Ideas that makes fresh ideas at its idea count, 5 when
  none is set). The app's **Run** button shows the run's part of that listed
  price, for example **82 + 14/min**, until you choose your recording: the
  listed price less its Render final part, which is run and charged on its
  own. Once you have chosen it, and the browser has read its length, the
  button shows the exact figure of the run for that length. If
  the length cannot be read, the button keeps the listed price, and the
  balance check assumes the longest recording (180 minutes) for every node
  priced by its length: Edit Plan, the render, and a Trim, Loop, Combine
  Videos or Video SFX on that recording. The exact figure prices Edit Plan the
  way the server charges it, per started minute or at the length step. A
  template lists the same way,
  without a fee. An app published before this was priced on its whole
  workflow alone; its price changes to this on its next publish.
- **While it renders**, the card reads `Rendering final… 42%` and the preview
  stays playable. Once it is done the card shows the **Final**, with
  **Show preview** to switch back to the preview it replaced; the cards after
  the render show their own results.
- **The cards after the render** read **Waits for Render final** until then.
  They never show the creator's sample output in its place.
- **One final at a time** per run. A final that failed can be started again
  from the same button: the card shows the preview again, even when the
  final got as far as rendering it before a later step failed.
- **Your edits of the preview** stay until the final is done: a final that
  fails keeps the preview on show, and your edit of it.
- **A second render set to Preview** after the first stops the final at its own
  preview. That preview is shown with its own **Render final** button, and
  the cards after it wait for it. Its final continues from the first one, so
  nothing the first final rendered runs or is billed again. One render at a
  time: each later render's final starts once the one before it is done.

It works the same in the horizontal and vertical layouts, the gallery,
fullscreen, compare and on mobile, and in an embedded app. In chat mode the run
on show — the one you launched or selected last — carries it.

Only a run started on the app's page can stop for a review. A run of the app
from the SDK, the CLI, MCP or an API token has nobody there to press Render
final, so it is refused (`preview_review_required`) unless the creator sets
the render to **Final**. A [component](./nodes/workflow/component.md) never
stops for a review. The API is in
[API integration](./api-integration.md#render-final-of-an-app-run).

## See also

- [Embed a Nodaro app in an external UI](./embed-app-guide.md)
