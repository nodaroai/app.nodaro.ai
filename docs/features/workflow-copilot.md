---
title: Workflow Copilot
edition: Cloud
---

# Workflow Copilot

> **Rolling out.** The copilot is behind a switch while it ships; if you don't see the panel yet, it isn't enabled on your workspace.

Describe what you want; the workflow gets built on your canvas. The copilot reads your open workflow, adds and rewires nodes while you watch, proposes a run, and — after a run — reads what failed and fixes it.

There are two ways in.

**From the home page** — a box at the top of the page: describe what you want, press **Build it**, and you land in a new workflow with the copilot already building it. It can be dismissed and stays dismissed.

**From the editor** — it lives as a side panel on the left of the canvas. Open it from the **Copilot** button in the editor toolbar, from the narrow tab beside the canvas, or with `Ctrl/Cmd + J`. Closing the panel does not stop a message that is still being written.

## What it can do

- **Build.** "A product shot workflow for a sneaker, three angles." It reads the node catalogue and each node's own documentation before it adds anything, then reports what it changed. A big workflow arrives in stages rather than all at once, so you can watch it take shape, and the canvas tidies itself when the copilot is done — the same arrangement the **Tidy Up** button produces.
- **Edit.** "Add a video step after the image", "switch the model to VEO 3.1", "delete the second branch." Changes arrive as an incremental edit — your other nodes are untouched.
- **Run — with your permission.** The copilot never starts a run by itself. It proposes one, you see the credit estimate, and you decide. See *Ask or Auto* below.
- **Fix.** After a run it can read the per-node result, diagnose a failure and change the configuration that caused it.

## Point at your own saved things

Type `@` in the message box (or press the `@` button) to pick from the characters, objects, animals and locations you have already made. The name is written into your sentence, where you were typing it — because where you put it is part of what you meant: "@Emma walks in while @George raises the bottle" says who does what, which a list of names beside the box does not. The copilot looks each one up and can wire it into the workflow it builds.

Mentions travel as names, never as file addresses — the same rule as *What it will not do* below. Mentioning your uploaded media files and attaching a file from your computer are not available yet.

A character the copilot places this way arrives complete: the picture and the saved variants are read from your library when the workflow runs, so the run uses the right likeness even if the node was added a moment ago and you have not reloaded the page.

## Ask or Auto

Each conversation has a run mode, in the panel header:

- **Ask** (default) — a run proposal appears as a card with its credit estimate. Nothing runs until you press Run.
- **Auto** — runs start automatically as long as the estimate stays under the credit limit you set on the same card. Anything more expensive still asks, and so does anything whose price is still being worked out.

Auto starts **one** run per message, and only when the price for the workflow on screen is already known — while it is being worked out, or if a run is already going, it asks instead.

In Auto mode a failed run is retried on its own: the copilot reads the failure, changes what caused it, and runs again. It does this **twice** and then stops and waits for you — a run that keeps failing cannot quietly spend your balance overnight. Press **Fix it** to give it another two attempts.

Either way the run itself is the normal workflow run: the same progress on the canvas, the same history, the same per-node credits.

## What it can see

- The workflow you have open: node types, their configuration and how they are wired, plus the last run's per-node status.
- Nodaro's own documentation: the node catalogue, each node's fields, picker options and model capabilities.
- Your saved building blocks: brand presets, characters, objects, animals and locations — so it can reference the ones you already made.
- Media you already have: your own gallery results and your uploads, plus the voices and saved components available to you.
- Your other workflows, by name and shape — so it can learn from a flow of yours that already works.

It only ever sees things that are yours: the public gallery is out of reach, and so is anyone else's work. It does not browse the web.

## What it will not do

- **Add nodes that send data out of Nodaro.** Webhook Output and the social publishers have to be added by you. This is deliberate: text inside a workflow (a node label, a description, a provider error) is content someone else may have written, and an assistant that could act on it could be talked into shipping your data somewhere.
- **Type a URL into a node.** Media reaches a node through a connection, a saved character or location, or your own upload.
- **Start a run on its own**, in Ask mode, or above your limit in Auto mode.
- **Delete a workflow, publish anything, or touch another workflow** — it can only edit the one you have open.

## Credits

A copilot message is billed for the assistant's actual model usage. The panel shows an upper bound before you send; the amount actually charged appears under the reply and is usually well below it. A conversation that reaches the ceiling stops and tells you, rather than continuing silently.

Runs the copilot proposes are charged the same way any run is — per node, when you start them.

## Good to know

- **Save first.** The panel saves your canvas before it sends a message, so you and the copilot are working on the same graph. If it cannot save, it refuses to send rather than risk your edits.
- **If you edit while it works,** your unsaved changes win: the copilot's edit is written to the workflow but is not pulled onto your canvas, and the panel says so instead of pretending. Reload to see its version.
- **A turn ends if you close the tab.** You are only charged for what was already spent. A run that has started keeps going.
- **Stop any time.** The Stop button in the composer ends the current message; anything already written to the canvas stays. **Stop** on a run card really stops the run — results that were already produced are saved to My Library.
- **Cloud only.** The copilot is part of Nodaro Cloud and is not available in the community edition.
