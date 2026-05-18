# Suno Voice
> Create a custom voice persona from a short recording, for use as a singer on Suno music generation.

## Overview

Suno Voice is a **setup-time** node — it does not execute as part of a workflow run. Instead, you configure it once via a 3-step modal that walks you through KIE.ai's `/voice/validate` → `/voice/generate` flow. Once setup completes, the node stores a `voiceId` and emits it at workflow runtime as the `personaId` input to Suno Generate / Suno Cover / Suno Extend, so any music those nodes produce sings in your custom voice.

The validation phrase is generated server-side per submission, so the verification recording cannot be prepared ahead of time — you must record yourself reading the exact phrase the server returns in Step 2.

## Setup flow

The 3-step modal opens when you click **Configure Voice** on the node card.

1. **Source recording** — upload an audio file (or paste a URL) and select the vocal segment to analyse with start/end seconds. Pick the phrase language. This kicks off `/api/v1/voice/validate` and polls `/api/v1/voice/validate-info` until KIE returns the verification phrase.
2. **Read & record** — the modal displays a short phrase like *"Harmonies fill the air with joyful melodies tonight"*. Record yourself singing or speaking it, then upload the recording. Use the **Regenerate phrase** button if you want a different one.
3. **Voice details** — fill in voice name, optional style ("Pop, female vocal"), description, and singer skill level. Click **Create voice** to call `/api/v1/voice/generate` and poll `/api/v1/voice/record-info` for the final `voiceId`.

The 20-credit charge is reserved when you click **Create voice** in Step 3, committed on success, and refunded on failure or timeout.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Source recording URL | url | — | Hosted audio clip or uploaded file containing your voice. |
| Vocal segment start | integer (≥0) | `0` | Start time (seconds) of the vocal slice to analyse. |
| Vocal segment end | integer (>start) | `10` | End time (seconds) of the vocal slice. |
| Language | enum | `en` | Language for the validation phrase. One of `en`, `zh`, `es`, `fr`, `pt`, `de`, `ja`, `ko`, `hi`, `ru`. |
| Verify recording URL | url | — | Your reading of the validation phrase, uploaded to your library. |
| Voice name | string (max 200) | `""` | Display name for the voice. |
| Style | string (max 500) | `""` | Free-form description, e.g. "Pop, female vocal". |
| Description | string (max 500) | `""` | Notes about the voice. |
| Singer skill level | enum | `beginner` | `beginner`, `intermediate`, `advanced`, `professional`. |

## Inputs & outputs

- **Inputs:** none. All configuration happens in the modal.
- **Outputs:** `voicePersona` — a structured payload `{ voiceId, voiceName, style, personaId, personaModel: "voice_persona" }`. Wire this output into a Suno Generate / Suno Cover / Suno Extend node's `in` handle; the workflow editor's input resolver maps `voiceId` → `personaId` automatically.

## Credits

| Step | Cost |
|------|------|
| `/voice/validate`, `/voice/validate-info`, `/voice/regenerate` | **0** credits |
| **`/voice/generate`** (Step 3 "Create voice") | **20** credits |

The 20-credit charge covers KIE's validate + generate calls combined. KIE.ai does not publish per-call pricing for this flow, so the value is a conservative one-time default and may be tuned later via the `model_pricing` table.

Credits are reserved on `POST /v1/suno/voice/generate` and committed by the polling endpoint (`GET /v1/suno/voice/record-info`) when KIE reports `status="success"`. On `status="fail"`, credits are refunded to the original pools.

## Best practices

- **Sing rather than speak** the validation phrase. KIE explicitly notes that sung recordings produce a richer voice persona for music generation.
- Pick a **clean vocal segment** with minimal background music for Step 1 — the model uses this slice to characterise your voice.
- The verification recording should be short (5–15 seconds) and contain only your voice reading the displayed phrase.
- Configure once, reuse across many music nodes by wiring the `voicePersona` output. The `voiceId` persists with the node and is reusable across workflow runs without re-paying.
- If the modal times out polling validate-info or record-info, click the relevant button again — KIE often completes the generation server-side even after our 2-minute poll budget expires.

## Common use cases

- Create a custom singing voice from a personal vocal sample and use it as the singer on Suno Generate.
- Build a small library of voice personas for a podcast, ad campaign, or game soundtrack.
- A/B test the same lyrics across multiple custom voices.

## Limitations

- KIE's voice/* API is **available on Suno V3 and newer** (V3, V4, V4.5, V5, V5.5). The Suno music nodes default to V5_5 — keep the model at V5/V5.5 for best persona quality.
- Voice generation is **asynchronous** — typical end-to-end completion is 30–90 seconds. The modal polls for up to ~4 minutes before timing out.
- A voice persona is bound to your KIE.ai account. We do not expose any cross-account sharing primitive.
- The validation phrase is generated per submission and **must be read verbatim** — the verify step does an acoustic match. Mumbling, skipping words, or adding extra speech will fail Step 3.

## Related nodes

- [Suno Generate](./suno-generate.md) — accepts `personaId` to apply the persona to a freshly generated song.
- [Suno Cover](./suno-cover.md) — applies the persona to a cover of an existing track.
- [Suno Extend](./suno-extend.md) — extends a previously generated track using the persona.
