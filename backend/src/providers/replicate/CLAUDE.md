# Replicate Provider — Claude Code Reference

API docs: https://replicate.com/docs/reference/http

Replicate covers a narrow set of models that fall outside the KIE.ai chain — uncensored Flux 2 family, multi-image Kontext, character LoRA training, plus a few legacy models (lip-sync, face-swap) kept for compatibility.

## API Patterns

- `predictions.create()` + `replicate.wait()` (NOT `replicate.run()`) so we can attribute `predictTime` for cost tracking.
- Cost: `predictTime * 0.000225` USD/sec.
- Pinned model versions live in `image.ts` / `video.ts` — never use floating `owner/name` references in production.

## Files in this directory

| File | Purpose |
|------|---------|
| `client.ts` | Replicate SDK setup + `replicate.predictions.create()` + `replicate.wait()` wrapper. |
| `image.ts` | `ImageGenerationProvider` + `ImageEditingProvider`. Handles per-request version resolution for `flux-lora-character` (reads `extraParams.lora_version`). |
| `video.ts` | `ImageToVideoProvider` + `TextToVideoProvider` for Replicate-hosted video models (runway, pika). |
| `lip-sync.ts` | Legacy lip-sync (KIE preferred). |
| `face-swap.ts` | Face-swap provider. |
| `grounded-sam.ts` | Grounded-SAM segmentation (helper for masking). |
| `training.ts` | LoRA training wrapper — `createCharacterLoraTraining()` calls `trainings.create()` with `ostris/flux-dev-lora-trainer`, 1000 steps, pinned version. |
| `index.ts` | `registerReplicateProviders()` + `replicateInfo` with `supportedModels`. |

## Routing

Replicate sits AFTER KIE in `routes/<capability>` provider chains. For image-generation / image-editing the chain is `[kie, replicate]` — KIE wins for every model id it declares; Replicate only sees requests for ids unique to its `supportedModels` array (no overlap allowed).

Current Replicate-only model ids:
- **`flux-2-klein`** — BFL Flux 2 9B Klein (`black-forest-labs/flux-2-klein-9b`), 2 cr. Refs go in the `images` array (max 5), NOT a single `image` string.
- **`flux-2-pro`** — BFL Flux 2 Pro, flat 4 cr, refs in the `input_images` array (schema max 8; frontend caps at 4)
- **`flux-2-max`** — BFL Flux 2 Max, variable pricing 3–18 cr via composite identifier (`flux-2-max:Nref`), refs in the `input_images` array (max 8), `safety_tolerance: 5` pinned (max)
- **`kontext-multi`** — multi-image Flux Kontext Pro (`flux-kontext-apps/multi-image-kontext-pro`), i2i / modify-image. The model exposes ONLY `input_image_1` + `input_image_2`, so the ref cap is **2** (not 4), 4 cr
- **`flux-lora-character`** — synthetic id; version resolved per-request from `extraParams.lora_version` (the character's stored `lora_replicate_version`), 3 cr/image

## Character LoRA Training (Cloud only)

Migration 126 adds 7 `lora_*` columns to `characters` + partial index on in-flight statuses. Migration 127 seeds `model_pricing` for `flux-lora-character` (3 cr/image inference) + `character-lora-training` (150 cr/training).

### Routes
- `POST /v1/characters/:id/train` — kick off training (Cloud-gated, scope-gated, rate-limited 3/min/token)
- `GET /v1/characters/:id/training` — poll status (modal calls every 8s while in-flight)
- `DELETE /v1/characters/:id/lora` — delete the trained model
- `POST /v1/webhooks/replicate-training` — public, called by Replicate when training completes (~15 min)

### Training mechanics
- `ostris/flux-dev-lora-trainer`, 1000 steps, **pinned version**
- Webhook delivers ONE `completed` event via `webhook_events_filter`
- Signature verification: SDK `validateWebhook` top-level export, **second overload** with explicit `{id, timestamp, signature, body, secret}` — Fastify `req.raw` is `IncomingMessage`, NOT a Fetch `Request`
- Raw body capture via in-plugin `addContentTypeParser` mirroring `stripe-webhook.ts:42-53` (this repo has NO `fastify-raw-body` plugin)

### Concurrency + state machine
- Atomic CAS slot claim in the train route uses Supabase JS `.or("lora_training_status.is.null,lora_training_status.in.(succeeded,failed,cancelled)")` — `.in()` does NOT match NULL on its own
- All webhook UPDATEs include `.not("lora_training_status","in","(succeeded,cancelled)")` for monotonic state
- Try/catch covers steps 1–6 + checks `reply.sent` after `reserveCreditsForJob` so a 503 from creditGuard still triggers CAS rollback + R2 zip cleanup
- R2 zip cleanup via `s3.send(new DeleteObjectCommand(...))` on dispatch failure (cleanup-cron does NOT cover the `character-training/` prefix)

### Model deletion
- Replicate SDK has NO `models.delete` method — `deleteCharacterLora(modelDestination)` uses raw `DELETE /v1/models/{owner}/{name}` REST with `Authorization: Bearer ${REPLICATE_API_TOKEN}`, 404 swallowed for idempotency
- Soft-delete handler in `routes/characters.ts` cancels in-flight training, refunds reserved credits, deletes the Replicate model BEFORE flipping `deleted_at`

### 4-edge field propagation
`ConnectedReference` + `CharacterNodeData` + backend `expandWiredCharacterRefs` + frontend `expandCharacterNodeIntoRefs` ALL carry `loraReplicateVersion` / `loraTriggerWord` / `loraTrainingStatus` for the routing decision.

### Single-LoRA routing rule
`selectLoraRoutingForMentions` (in `packages/shared/src/lora-routing.ts`) requires EXACTLY ONE distinct trained character; 2+ → fall back to ref injection (multi-LoRA = Phase 2).

### Required env
- `REPLICATE_WEBHOOK_SECRET` — strict envSchema, default `""` → 503 `webhook_not_configured`
- `PUBLIC_URL` — must be non-empty (else 503 `public_url_not_configured`)

## Flux 2 Safety Tolerance

`flux-2-max` (and `flux-2-pro`) pin `safety_tolerance: 5` (family max) so the BFL safety filter is at its loosest. KIE's filter never sees these requests because the routing chain falls through to Replicate before reaching any KIE endpoint.

## Trigger Word Convention

Trained character LoRAs use `TOK_<slug>_<6hex>` as the trigger word (helper in `backend/src/lib/character-lora.ts`). This shows up in the inference prompt as the literal trigger token; `expandCharacterNodeIntoRefs` injects it when a `@character` mention resolves to a trained LoRA.

---

*Last updated: 2026-05-19*
