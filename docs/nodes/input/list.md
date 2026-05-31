# List

> Define a list of items — or a multi-column typed table — for batch iteration.

## Overview

The List node is a fan-out source: every downstream node connected to it runs **once per row** in the list. It is a data node — it makes no API call, produces no job, and costs **0 credits**.

By default it is a simple single-column list of text items ("Items") — paste or add one value per row, and each value is emitted to downstream nodes in turn. When you need more than one variable per iteration, the same node **grows into a multi-column typed table**: connect a producer to the node's bottom-left **"+"** handle and a new column is added. Each column is typed and gets its own input handle (to receive values from upstream) and output handle (to feed a downstream node).

The config panel adapts to the column count: it shows the single-column **List** editor at one column and the multi-column **Table** editor once you have more than one. The node's view mode (list / gallery / packed) is chosen automatically from the column types.

> The legacy `loop` node (UI label "Table") was merged into this node. `loop` is now a deprecated alias that auto-migrates to `list` on load — existing workflows keep working.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Items / Columns | Dynamic table | One text column ("Items") | Rows of values. Starts as a single text column; add columns by connecting producers to the bottom-left "+" handle |
| Column type | text / image-url / video-url / audio-url / json | text | Per-column data type. Determines the column's handle type and the node's auto-selected view mode |

Each row is one iteration. The item/row counter shows the total number of entries.

## Inputs & Outputs

**Inputs:**
- Bottom-left **"+"** handle — connect a producer to add a new typed column
- Per-column input handles (`col_<id>_in`) — receive values into a specific column from upstream

**Outputs:**
- Single-column mode: each item is emitted in turn to downstream nodes
- Multi-column mode: per-column outputs (`col_<id>`) — each column's value is available as a separate output per iteration

## Best Practices

- Keep single-column list items consistent in format for predictable downstream behavior
- Use one concept per item — each item should be a complete, standalone prompt or value
- Add a column (via the "+" handle) only when you genuinely need a second variable per iteration — typed columns map cleanly to different input fields on downstream nodes
- Set each column's type to match its content (image-url, video-url, etc.) so the view mode and downstream wiring resolve correctly

## Common Use Cases

- Batch-generate images from a list of prompts (single column)
- Process multiple subjects through the same video generation pipeline
- Generate TTS audio for multiple text entries
- Generate character images with different names and descriptions per row (multi-column)
- Drive videos with varying prompts and reference-media URLs per row (multi-column)

## Tips

- Press Enter to add a new row quickly
- Rows are processed in order from top to bottom
- Each row triggers a separate downstream execution — more rows means longer total runtime
- For very large batches, consider breaking into smaller lists to manage workflow size
- To close a fan-out (pick the best variant, count survivors, or merge results), feed the downstream output into a [Reduce](../utility/reduce.md) node
