# Combine Audio

> Concatenate multiple audio tracks end-to-end into a single file.

## Overview

The Combine Audio node joins connected audio tracks sequentially — they play one after another in the configured order. Each segment can optionally be trimmed to a start and end time before it is appended. The output is a single combined audio file. For layering tracks on top of each other with volume control, use [Mix Audio](./mix-audio.md) instead.

## How it works

- Connect audio nodes to the Combine Audio node's input. Each connection becomes a segment.
- Reorder segments by dragging them in the config panel — segments play top-to-bottom. New connections append to the end.
- Optionally set a **Start (s)** and **End (s)** on any segment to trim it before concatenation.
- The node returns the concatenated audio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Segment Order | Drag list | connection order | Reorder connected audio segments |
| Start (s) | Number | — | Per-segment trim start, in seconds (optional) |
| End (s) | Number | — | Per-segment trim end, in seconds (optional) |

## Inputs & Outputs

**Inputs:** 1+ audio tracks (connected via the input handle).

**Outputs:** A single combined audio file.

## Pricing

Costs **1 credit** per run.
