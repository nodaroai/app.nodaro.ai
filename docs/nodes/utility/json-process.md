# JSON Process

> Transform JSON data — filter, project fields, and extract paths — with a visual builder or a raw expression.

## Overview

The JSON Process node takes structured JSON (or a JSON string) from an upstream node and transforms it. It has two modes: a **Visual** builder where you set an input path, add filter conditions, and pick fields to project, and an **Advanced** mode where you write a raw transformation expression directly. The result can be an object, a value, or a list — and when it's a list, downstream list-aware nodes can iterate it. A live preview shows the processed output (or any error).

## How it works

- Connect a node that emits JSON or a JSON string.
- **Visual mode:** set an input path to drill into the payload, add filter conditions to keep matching items, and add projection fields to narrow the output to specific keys.
- **Advanced mode:** write the transformation expression directly for full control.
- The node evaluates the expression against the input and emits the processed result.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Toggle | `visual` | Visual builder vs. raw Advanced expression |
| Input Path | dot-path | `""` | (Visual) Path into the incoming JSON to operate on |
| Filters | List | `[]` | (Visual) Field/operator/value conditions to keep matching items |
| Projections | Tags | `[]` | (Visual) Fields to include in the output |
| Expression | text | `.` | (Advanced) Raw transformation expression |

## Inputs & Outputs

**Inputs:** JSON data or a JSON string from an upstream node.

**Outputs:** The processed JSON result. List-shaped results can be iterated by downstream list-aware nodes.

## Pricing

Free — no credits charged.
