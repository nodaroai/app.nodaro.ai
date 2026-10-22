# QA Check

> Evaluate text content with an LLM and produce a quality score, pass/fail decision, and reason.

## Overview

The QA Check node sends upstream text to an LLM (default Gemini 3.6 Flash) and asks it to score the content from 0.0 to 1.0 against a chosen evaluation type. It returns a numeric score, an `approved` boolean (score ≥ threshold), and a short reason. Use it as an automated quality gate inside workflows — for example, to validate generated scripts or captions before they continue downstream.

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
| Model | Select | Gemini 3.6 Flash | LLM used for the evaluation |
| Advanced mode | `boolean` | `false` | Gemini and Claude models. Runs the model on the provider's own API so **Temperature**, **Max Tokens** and the full reasoning-depth range actually apply — those controls appear once it is on. The call is charged at that lane's per-token rate ([LLM model rates](../../pricing/llm-models.md)); the node's cost badge updates immediately. Disabled with an inline reason on other models |

## Inputs & Outputs

**Inputs:** Text content (required).

**Outputs:** Evaluation result — `score` (0.0–1.0), `approved` (boolean), and `reason` (short explanation).

## Pricing

A check is charged for the tokens its call actually used — the content, your criteria and the verdict — at the selected model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)), with a hold first, as on [Generate Text](../ai-text/llm-chat.md#credit-pricing). The Run button shows an estimate of a typical check: **~4 credits<!-- credits: qa-check:gemini-3.6-flash -->** on the default, Gemini 3.6 Flash, and ~6<!-- credits: qa-check:claude-sonnet-5.5 --> on Claude Sonnet 5.5. A failure the provider billed is charged for that usage; one it did not bill is refunded.
