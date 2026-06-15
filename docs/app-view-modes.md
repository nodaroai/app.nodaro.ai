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

## See also

- [Embed a Nodaro app in an external UI](./embed-app-guide.md)
