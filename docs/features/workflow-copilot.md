---
title: Workflow Copilot
edition: Cloud
---

# Workflow Copilot

> **Rolling out.** The copilot is behind a switch while it ships; if you don't see the panel yet, it isn't enabled on your workspace.

Describe what you want; the workflow gets built on your canvas. The copilot reads your open workflow, adds and rewires nodes while you watch, proposes a run, and — after a run — reads what failed and fixes it.

It lives in the workflow editor as a side panel. Open it from the toolbar or with `Ctrl/Cmd + J`.

## What it can do

- **Build.** "A product shot workflow for a sneaker, three angles." It reads the node catalogue and each node's own documentation before it adds anything, then reports what it changed.
- **Edit.** "Add a video step after the image", "switch the model to VEO 3.1", "delete the second branch." Changes arrive as an incremental edit — your other nodes are untouched.
- **Run — with your permission.** The copilot never starts a run by itself. It proposes one, you see the credit estimate, and you decide. See *Ask or Auto* below.
- **Fix.** After a run it can read the per-node result, diagnose a failure and change the configuration that caused it.

## Ask or Auto

Each conversation has a run mode, in the panel header:

- **Ask** (default) — a run proposal appears as a card with its credit estimate. Nothing runs until you press Run.
- **Auto** — runs start automatically as long as the estimate stays under the credit limit you set on the same card. Anything more expensive still asks.

Either way the run itself is the normal workflow run: the same progress on the canvas, the same history, the same per-node credits.

## What it can see

- The workflow you have open: node types, their configuration and how they are wired, plus the last run's per-node status.
- Nodaro's own documentation: the node catalogue, each node's fields, picker options and model capabilities.
- Your saved building blocks: brand presets, characters, locations and objects — so it can reference the ones you already made.

It does not read your other workflows, and it does not browse the web.

## What it will not do

- **Add nodes that send data out of Nodaro.** Webhook Output and the social publishers have to be added by you. This is deliberate: text inside a workflow (a node label, a description, a provider error) is content someone else may have written, and an assistant that could act on it could be talked into shipping your data somewhere.
- **Type a URL into a node.** Media reaches a node through a connection, a saved character or location, or your own upload.
- **Start a run on its own**, in Ask mode, or above your limit in Auto mode.
- **Delete a workflow, publish anything, or touch another workflow** — it can only edit the one you have open.

## Credits

A copilot message is billed for the assistant's actual model usage. The panel shows an upper bound before you send; the amount actually charged appears under the reply and is usually well below it. A conversation that reaches the ceiling stops and tells you, rather than continuing silently.

Runs the copilot proposes are charged the same way any run is — per node, when you start them.

## Good to know

- **Save first.** The panel waits until your canvas is saved before it sends a message, so you and the copilot are working on the same graph. If you edit while it works, you get a banner and can choose which version wins.
- **A turn ends if you close the tab.** You are only charged for what was already spent. A run that has started keeps going.
- **Stop any time.** The Stop button ends the current message; anything already written to the canvas stays.
- **Cloud only.** The copilot is part of Nodaro Cloud and is not available in the community edition.
