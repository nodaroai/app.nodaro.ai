---
title: Character High-Fidelity Training (LoRA)
edition: Cloud
---

# Character High-Fidelity Training

Train a custom model on a character's reference photos for the highest-fidelity
identity match in image generations. Available on the **Cloud edition only**.

## How it works

1. Open a character in the **Character Studio** modal (click the character node).
2. Make sure the character has at least **4 reference photos** — any mix of:
   - The approved portrait (`source_image_url`)
   - Reference photos (front face, sides, three-quarter, full body, etc.)
   - Expressions / poses / angles / lighting variations
3. In the Main tab, find the **High-fidelity model** section and click **Train high-fidelity model**.
4. Wait ~15 minutes. The character's canvas card shows a **Training…** pill;
   you can navigate away. The Modal also shows the live status (polling every 8s).
5. Once trained, the character is marked **Trained** in:
   - The canvas card (green corner badge)
   - The character modal Main tab
   - (Coming soon) the `@mention` autocomplete and character gallery

## What changes after training

When you `@mention` a single trained character in a `generate-image` node, the
backend automatically routes that generation through the trained Flux LoRA on
Replicate instead of the default `nano-banana` + reference-image injection.

- The trained model lives on the `nodaroai/char-<characterId>` Replicate model.
- Only Nodaro can submit inference requests to it (your API token).
- A unique trigger word (e.g. `TOK_kira_a1b2c3`) is prepended to every prompt
  automatically — you do NOT need to type it.

If your prompt mentions **2 or more trained characters**, the system falls back
to standard reference-image injection. Multi-character LoRA composition is
on the roadmap (Phase 2).

## Pricing

| Action | Credits | Notes |
|--------|---------|-------|
| Training | **150 cr** (~$3) | Refunded if Replicate reports failure or cancel. |
| Inference per image | **2 cr** | Applied when the trained model is used. The dropdown's provider price (typically nano-banana, 1cr) is replaced. |
| Re-training | 150 cr | Full re-training price every time. |

## Limits

- **Min 4** / **max 20** training photos per character (route enforces).
- Inference is **`generate-image` only** in Phase 1. Other consumer nodes
  (`image-to-image`, `modify-image`, video nodes) use the existing
  reference-injection path regardless of training state.
- **Re-training replaces the previous model.** The old version on Replicate
  is retained briefly so in-flight generations don't break; ops can prune
  it later.
- Cancelling mid-training refunds your credits.

## Lifecycle

- **Re-train**: allowed any time after a successful (or failed/cancelled) training.
- **Remove**: deletes the Replicate model and clears the LoRA fields on your
  character row. Generations fall back to reference-image injection.
- **Delete the character**: also cancels in-flight training, refunds the
  reservation, and deletes the trained Replicate model.

## API reference

The training routes are documented in [API Integration](../api-integration.md#character-lora-training) and the SDK in [SDK Reference](../sdk-reference.md#character-training).

## Deployment notes (self-hosted Cloud)

The webhook signature uses Replicate's [Standard Webhooks](https://standardwebhooks.com/) spec. Set `REPLICATE_WEBHOOK_SECRET` to the secret returned by `replicate.webhooks.default.secret` (see [deployment.md](../deployment.md)) — without it, the webhook fast-fails 503 `webhook_not_configured`.

`PUBLIC_URL` must point to a publicly-reachable URL (e.g. `https://app.nodaro.ai`)
so Replicate can deliver completion webhooks. The route fast-fails 503
`public_url_not_configured` otherwise.
