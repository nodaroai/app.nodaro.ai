# Merge Lists

> Combine multiple upstream lists into one, by concatenation or element-wise zipping.

## Overview

The Merge Lists node takes lists from multiple upstream connections and merges them into a single list. **Concatenate** mode appends the lists in edge order; **Zip** mode merges items element-wise, which is useful for combining parallel lists (for example, injecting a single shared object into every item of a longer list). An optional toggle removes duplicates after merging.

## How it works

- Connect two or more list-producing nodes upstream.
- Pick a **Mode**:
  - **Concatenate** — append upstream lists in edge order. Single-value outputs are treated as one-item lists.
  - **Zip (merge items)** — merge items element-wise. A single-object upstream is injected into every item of a longer list; shorter lists cycle (modulo wrap).
- Optionally turn on **Remove duplicates after merge** to drop duplicate items by value.
- The node returns the merged list, with a preview of the first items.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Toggle | `concat` | Concatenate (append) or Zip (element-wise merge) |
| Remove duplicates after merge | Toggle | off | Drop duplicate items by value after merging |

## Inputs & Outputs

**Inputs:** Two or more lists from upstream nodes.

**Outputs:** The merged list.

## Pricing

Free — no credits charged.
