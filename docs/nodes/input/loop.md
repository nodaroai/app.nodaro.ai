# Loop

> Table-based loop with columns and rows for structured batch iteration.

## Overview

The Loop node provides a spreadsheet-like interface for structured batch data. Define columns (variables) and rows (iterations), and each row is processed through the workflow independently. More powerful than List when you need multiple variables per iteration.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Columns | Dynamic list | — | Named columns representing different variables |
| Rows | Dynamic table | — | Each row contains values for all columns |

Displays row x column count. Add/remove columns and rows via buttons. Cell editing inline.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Per-column outputs — each column value is available as a separate output per iteration

## Credit Cost

0 credits — always free.

## Best Practices

- Name columns descriptively (e.g., "character_name", "prompt", "style")
- Keep the table manageable — very large tables increase total credit consumption
- Test with 1-2 rows before running the full batch

## Common Use Cases

- Generate character images with different names and descriptions per row
- Create videos with varying prompts and style combinations
- Batch social media posts with different captions per platform
- Process multiple subjects with different parameter combinations

## Tips

- Each row triggers a full execution of all connected downstream nodes
- Total credits = per-execution cost x number of rows
- Use columns to map to different input fields on downstream nodes
