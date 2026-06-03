# QA Check

> Evaluate text content with an LLM and produce a quality score, pass/fail decision, and reason.

## Overview

The QA Check node sends upstream text to an LLM (default Gemini Flash) and asks it to score the content from 0.0 to 1.0 against a chosen evaluation type. It returns a numeric score, an `approved` boolean (score ≥ threshold), and a short reason. Use it as an automated quality gate inside workflows — for example, to validate generated scripts or captions before they continue downstream.

## How it works

- Connect text to the node's input.
- Pick a **Check Type** (see below) and a **Threshold** (0.0–1.0, default 0.7).
- Optionally select the LLM model.
- The node calls the model, which returns strict JSON: `{ score, approved, reason }`.

## Check Types

| Type | Evaluates |
|------|-----------|
| Content | Completeness, coherence, and structure |
| Quality | Clarity, grammar, and professionalism |
| Consistency | Internal consistency — no contradictions or logical errors |
| Safety | Whether the content is safe and appropriate (no harmful or offensive material) |

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Check Type | Select | `content` | Evaluation dimension (content / quality / consistency / safety) |
| Threshold | Number | `0.7` | Score at or above which `approved` is `true` |
| Model | Select | Gemini Flash | LLM used for the evaluation |

## Inputs & Outputs

**Inputs:** Text content (required).

**Outputs:** Evaluation result — `score` (0.0–1.0), `approved` (boolean), and `reason` (short explanation).

## Pricing

Costs **1 credit** per check, regardless of the LLM tier selected.
