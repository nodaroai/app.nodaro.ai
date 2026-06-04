# Teleport Send

> Broadcast a value on a named channel without a visible wire.

## Overview

The Teleport Send node broadcasts its upstream value on a **channel** (a short label like "A", "B", "C"). Any Teleport Receive node on the same canvas that is tuned to the same channel receives the value automatically — no edge drawn between them. This is a wireless edge: the canvas stays uncluttered while values travel across long distances or around complex subgraphs.

Each channel has a fixed color (A=amber, B=emerald, C=violet, D=red, E=cyan, F=pink) so paired Send/Receive nodes are easy to identify at a glance.

## When to Use

- Carry a text prompt or image URL from one corner of a large canvas to a distant output node without a crossing edge
- Share a single upstream value with multiple Receive nodes (fan-out without visible wires)
- Decouple a trigger node from its consumers across nested sub-workflows

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Channel | display | `A` | The channel this node broadcasts on. Set at creation time; shown with its color. |
| Channel Name | text | — | Optional human label for the channel (synced to all paired Receive nodes). Leave blank to use the channel letter. |

The config panel also shows the list of Receive nodes currently tuned to this channel. Clicking a partner node pans the canvas to it.

## Inputs & Outputs

**Inputs:** `in` — any upstream value (text, image URL, video URL, audio URL, JSON).

**Outputs:** `out` — the same value passed through (so you can also wire a visible edge from Send when needed).

## Pricing

Free — no credits charged.

## Pairing with Teleport Receive

1. Add a **Teleport Send** node and note its channel letter and color.
2. Add one or more **Teleport Receive** nodes.
3. In the Receive node's config panel, use **Switch Channel** to select the matching channel.

All Receive nodes on the same channel receive the value the Send node produces during execution.

## Tips

- Multiple Receive nodes can tune to the same Send channel simultaneously — useful for broadcasting a prompt to several independent generation branches.
- The `out` handle on Send is a pass-through: wire it when you want both a visible edge and the wireless broadcast at the same time.
- Channel names are cosmetic and are synced to all paired Receive nodes automatically.
- Teleport edges behave identically to normal edges during DAG execution; the "teleport" is purely visual.
