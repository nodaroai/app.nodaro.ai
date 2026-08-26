---
title: Workflow Copilot
edition: Cloud
---

# Workflow Copilot

> **Rolling out.** The copilot is behind a switch while it ships; if you don't see the panel yet, it isn't enabled on your workspace.

Describe what you want; the workflow gets built on your canvas. The copilot reads your open workflow, adds and rewires nodes while you watch, proposes a run, and — after a run — reads what failed and fixes it.

There are two ways in.

**From the home page** — a box at the top of the page: describe what you want, press **Build it**, and you land in a new workflow with the copilot already building it. It can be dismissed and stays dismissed.

In both boxes **Enter** sends and **Shift + Enter** starts a new line, so a description can run to several lines and a pasted link can sit on its own. If a hand-off from the home page fails before the copilot answers — a lost connection, a closed tab — your sentence comes back into the box so you can send it again, and the empty workflow it had opened for you is cleared away on its own a few hours later.

**From the editor** — it lives as a side panel on the left of the canvas. Open it from the **Copilot** button in the editor toolbar, from the narrow tab beside the canvas, or with `Ctrl/Cmd + J`. Closing the panel does not stop a message that is still being written.

## What it can do

- **Build.** "A product shot workflow for a sneaker, three angles." It reads the node catalogue and each node's own documentation before it adds anything, then reports what it changed. A big workflow arrives in stages rather than all at once, so you can watch it take shape, and the canvas tidies itself when the copilot is done — the same arrangement the **Tidy Up** button produces.
- **Edit.** "Add a video step after the image", "switch the model to VEO 3.1", "delete the second branch." Changes arrive as an incremental edit — your other nodes are untouched.
- **Run — with your permission.** The copilot never starts a run by itself. It proposes one, you see the credit estimate, and you decide. See *Ask or Auto* below.
- **Re-run one step.** When it changed a single step, it can propose running just that one — the card names the step and prices that step, not the whole flow. If the canvas changed between the proposal and your click, it refuses and asks you to say so again rather than run something the card no longer describes. A single-step run shows its progress on the node itself, and the copilot's automatic fix loop stays with whole-flow runs.
- **Fix.** After a run it can read the per-node result, diagnose a failure and change the configuration that caused it.
- **Borrow from a flow you already have.** "Build it like my product one." It can read another of your workflows *in the same project* and follow its shape. Reading is all it does there — it cannot edit or run a workflow other than the one you have open.
- **Start a separate flow.** "Also make me an ads version." It creates a new workflow in the same project and builds it in one go; a line in the conversation links straight to it. One new workflow per message. Your open canvas is untouched, and the run it proposes is still the flow you are looking at — never the one it just made.

## Point at your own saved things

Type `@` in the message box (or press the `@` button) to pick from the characters, objects, animals and locations you have already made — and from your own images, videos and audio, under **Files**. The picker is organized in tabs, one per kind, each with its count; typing narrows the current tab, and a match on another tab shows up as a one-click hint so nothing you own is ever invisible. Characters, objects, animals and locations are all loaded, so typing filters them instantly. **Files** are searched across your whole library rather than only the ones on screen — the tab's number is how many you have, not how many loaded — so a filename you remember will find its file however long ago you uploaded it. The expand button opens a full-size browser with large previews when you want to see what you are choosing. The name is written into your sentence, where you were typing it — because where you put it is part of what you meant: "@Emma walks in while @George raises the bottle" says who does what, which a list of names beside the box does not. The copilot looks each one up and can wire it into the workflow it builds.

A character row with saved looks carries a small arrow: open it to pick a specific **angle, expression, pose or outfit** instead of the default portrait. The pick lands in your sentence as plain words — `@Iris (the "back" angle)` — and the copilot turns that into the right configuration when it builds.

To use a file that is not in your library yet, press the paperclip and pick it from your computer. It uploads to your library and is attached to the message in one step, exactly as if you had mentioned it.

**An attached image is one the copilot can actually see.** Attach a screenshot, a sketch or a reference photo and ask for "something like this" — it reads the image itself: the layout of a template, the style of a shot, the text in a mock-up — and builds from what it sees. Up to four images per message.

Mentions travel as names and ids, never as file addresses — the same rule as *What it will not do* below. When the copilot uses one of your files it puts the **id** on the node and Nodaro fills in the address, so the rule that it can never type a URL holds even while it is wiring your own media.

**A link you paste in chat is one it may place for you.** Paste a YouTube link and ask for "a song similar to this", and the copilot can put that exact link into the node built to hold one (a Reference Audio source, for example) — the node then fetches the audio on its own. This is the single exception to the no-URLs rule, and it only ever covers links **you yourself pasted**, copied character for character: the copilot still cannot invent a link, modify one, or write one anywhere else.

A character the copilot places this way arrives complete: the picture and the saved variants are read from your library when the workflow runs, so the run uses the right likeness even if the node was added a moment ago and you have not reloaded the page.

**Before a run starts, the card lists every file that was attached to it, by name.** Approving a run is the moment you agree to spend credits on that workflow, so anything the copilot wired in while building it is named there for you to check first.

## Ask or Auto

Each conversation has a run mode, in the panel header:

- **Ask** (default) — a run proposal appears as a card with its credit estimate. Nothing runs until you press Run.
- **Auto** — runs start automatically as long as the estimate stays under the credit limit you set on the same card. Anything more expensive still asks, and so does anything whose price is still being worked out.

Auto starts **one** run per message, and only when the price for the workflow on screen is already known — while it is being worked out, or if a run is already going, it asks instead.

In Auto mode a failed run is retried on its own: the copilot reads the failure, changes what caused it, and runs again. It does this **twice** and then stops and waits for you — a run that keeps failing cannot quietly spend your balance overnight. Press **Fix it** to give it another two attempts.

Either way the run itself is the normal workflow run: the same progress on the canvas, the same history, the same per-node credits.

## What it can see

- The workflow you have open: node types, their configuration and how they are wired, plus the last run's per-node status.
- Images you attach to a message — it sees the picture itself, not just the file name.
- Nodaro's own documentation: the node catalogue, each node's fields, picker options and model capabilities.
- Your saved building blocks: brand presets, characters, objects, animals and locations — so it can reference the ones you already made.
- Media you already have: your own gallery results and your uploads, plus the voices and saved components available to you.
- Your other workflows, by name and shape — so it can learn from a flow of yours that already works.

It only ever sees things that are yours: the public gallery is out of reach, and so is anyone else's work. It does not browse the web.

## What it will not do

- **Add a Webhook Output node, or any node that fetches from a web address.** Those send to, or read from, an address written inside the node — so an assistant that could add one could be talked into sending your media somewhere you never chose. They are yours to add, always, and no setting changes that.
- **Type a URL into a node.** Media reaches a node through a connection, a saved character or location, or one of your own files — which the copilot names by id, never by address.
- **Use a file that is not yours.** It can only reach what is in your own library, and a file it cannot find is refused rather than guessed at.
- **Start a run on its own**, in Ask mode, or above your limit in Auto mode.
- **Choose where a post goes.** Even with posting turned on (below), the account, the channel, the platform and who can see the result stay yours to set.
- **Delete a workflow or touch another one** — it can only edit the one you have open.

## Letting it build posting steps

By default the copilot cannot add a step that posts to TikTok, YouTube, Telegram, X, LinkedIn, Facebook or Instagram. Turn on **"Let it build posting steps"** in the panel and it can — for that conversation only, and off again whenever you like.

What it can do with that on: add a posting step and wire it into the workflow it just built, so a flow that makes a video can end by publishing it.

**What it still cannot do, with it on or off:**

- Choose **which account** it posts to. A posting step it builds names no account, and the run uses your default for that platform.
- Choose the **channel**, the **platform**, or **who can see the post**. Posts start private; only you change that.
- Add a **Webhook Output** node or a web fetcher. Those stay refused for every conversation — see above.

The reason for the split: a posting step publishes to an account you already connected, so the worst case is something on your own timeline that you did not want, which you can delete. A webhook sends your media to an address written in the node, which is a different kind of thing entirely.

### Choosing the default account

If you have connected more than one account on the same platform, **Integrations** lets you mark which one is the default. That is the account a posting step uses when it does not name one — which is every step the copilot builds.

With one account there is nothing to choose and no control is shown. If you have several and have not marked one, the oldest is used.

## What it remembers

Tell the copilot a lasting preference — "always 9:16", "never add background music" — and it saves it, once, for every future conversation. Memory is deliberately narrow and fully visible:

- **Every save shows.** The moment something is remembered, a pinned "Remembered" line appears in the conversation with an **Undo** button. There is no silent remembering.
- **You hold the list.** The bookmark button in the panel header opens **What the Copilot remembers** — every saved preference, each with a **Forget** button. Deleting one takes effect from your next message.
- **Per user, and only yours.** Memories never cross accounts and are not shared with a workspace.
- **Short and safe by construction.** A memory is one short statement (up to 400 characters, at most 50 saved). It can never contain a link, and the copilot is instructed never to save secrets or one-off task details.

## Choosing a model

Each conversation runs on one of three models, switchable in the panel header:

- **Fast** — the cheapest and quickest. Good for small edits and questions; noticeably weaker at building large workflows.
- **Smart** — the default. Builds well at a fair price.
- **Max** — the strongest model, for complex builds. Costs the most per message, and is allowed to work longer within a single message before it pauses — so a large, multi-step build that Smart would stop partway through can finish in one turn.

The choice is per conversation, and the "up to" price under the message box follows it. Switching models mid-conversation is fine — the next message simply runs on the new one.

## Credits

A copilot message is billed for the assistant's actual model usage. The panel shows an upper bound before you send; the amount actually charged appears under the reply and is usually well below it. A conversation that reaches the ceiling stops and tells you, rather than continuing silently.

Runs the copilot proposes are charged the same way any run is — per node, when you start them.

## Good to know

- **Save first.** The panel saves your canvas before it sends a message, so you and the copilot are working on the same graph. If it cannot save, it refuses to send rather than risk your edits.
- **If you edit while it works,** your unsaved changes win: the copilot's edit is written to the workflow but is not pulled onto your canvas, and the panel says so instead of pretending. Reload to see its version.
- **A turn ends if you close the tab.** You are only charged for what was already spent. A run that has started keeps going.
- **Stop any time.** The Stop button in the composer ends the current message; anything already written to the canvas stays. **Stop** on a run card really stops the run — results that were already produced are saved to My Library.
- **Cloud only.** The copilot is part of Nodaro Cloud and is not available in the community edition.
