# Teleport Receive

> Receive a value from a Teleport Send node on the same channel, without a visible wire.

## Overview

The Teleport Receive node listens on a named **channel** and receives whatever value a matching Teleport Send node broadcasts during execution. No visible edge connects them — the canvas stays clean while values travel across long distances. Multiple Receive nodes can listen on the same channel simultaneously.

Each channel has a fixed color (A=amber, B=emerald, C=violet, D=red, E=cyan, F=pink) matching its paired Send node.

## When to Use

- Receive a shared prompt or image URL broadcasted from a Send node on the other side of a large canvas
- Fan-out a single value to multiple independent branches without drawing crossing edges
- Consume a value inside a deeply nested part of the workflow where a visible edge would be impractical

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Channel | display | `A` | The channel this node listens on. |
| Switch Channel | select (post-add) | — | Choose a different channel (from existing Send nodes on the canvas). Only visible when at least one Send node exists. |
| Channel Name | text | — | Optional human label. Synced with the paired Send node — editing here also updates Send's label. |

The config panel also shows the Send node broadcasting on this channel. Clicking the partner node pans the canvas to it.

## Inputs & Outputs

**Inputs:** `in` — optional; allows wiring a visible edge in addition to the wireless channel (pass-through).

**Outputs:** `out` — the value received from the matching Send node (or from the `in` handle if wired).

## Pricing

Free — no credits charged.

## Pairing with Teleport Send

1. Add a **Teleport Send** node — it starts on channel A.
2. Add a **Teleport Receive** node — it also defaults to channel A (already paired).
3. To use a different channel, open the Receive node's config panel and select a channel from **Switch Channel**.

## Tips

- A Receive node that has no matching Send on its channel will produce an empty value at execution time — make sure channels are paired correctly.
- Use **Switch Channel** to re-point an existing Receive node to a different Send without deleting and recreating it.
- Teleport edges are fully equivalent to visible edges in the DAG execution engine — execution order and data flow are identical.
- Channel names are cosmetic only. Rename them to describe what is being transmitted (e.g., "Hero Prompt", "Reference Image") for readability.
