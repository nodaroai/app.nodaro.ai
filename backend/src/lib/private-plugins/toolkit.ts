import { directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { ReplicateAudioSeparationProvider } from "../../providers/replicate/audio-separation.js"
import { extractAudio } from "../../providers/video/extract-audio.js"
import {
  runFfmpeg,
  runFfmpegCapture,
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
} from "../../providers/video/ffmpeg-utils.js"
import { mixAudio } from "../../providers/video/mix-audio.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { applyAudioFx } from "../../providers/video/audio-fx.js"
import { applyImageWatermark } from "../../utils/watermark.js"
import { uploadBufferToR2, uploadFileToR2 } from "../storage.js"
import { runPostProcessing } from "../post-processing-error.js"
import { markJobCompleted, setJobProgress, withProgressRamp, commitJobCredits } from "../../workers/shared.js"
import { supabase } from "../supabase.js"
import { videoQueue } from "../queue.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { safeUrlSchema } from "../url-validator.js"
import { safeFetch } from "../safe-fetch.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../request-helpers.js"
import { extractMcpClient } from "../extract-mcp-client.js"
import { buildJobInputData } from "../job-input-data.js"
import { formatZodError } from "../zod-error.js"
import type { PluginToolkit } from "./types.js"

/**
 * Assembles the real `PluginToolkit` dependency-injection surface handed to
 * every private plugin (`@nodaroai/cloud-plugins`, loaded by `load.ts`).
 *
 * Every member below is a direct reference (or, for `separateAudio`, a thin
 * one-line wrap) to this app's own CORE modules — no plugin ever imports an
 * app path directly; it only ever sees the shape declared in `./types.js`.
 * This file is itself core (`backend/src/lib/private-plugins/`) and must
 * never statically import from `ee/` (enforced by
 * `tools/check-ee-imports.mjs`) — `creditGuard`/`reserveCreditsForJob` come
 * from the core `middleware/credit-guard.ts` shim, which only reaches `ee/`
 * via a runtime-gated dynamic `import()`, not a static one.
 *
 * See `.superpowers/sdd/task-9-report.md` for the full member -> source
 * traceability table (mirrors the Task 2 table in
 * `.superpowers/sdd/task-2-report.md` for the plugin repo's structural
 * `contract.ts` copy).
 */
export function buildToolkit(): PluginToolkit {
  return {
    providers: {
      directVoiceChanger,
      // Exposed as a plain function per the contract; the real capability is
      // a class method (`AudioSeparationProvider` interface implementation),
      // so this wraps a fresh instance per call — the class itself carries
      // no per-instance state (concurrency throttling lives in
      // module-level state inside audio-separation.ts).
      separateAudio: (audioUrl, opts, reconcileOpts) =>
        new ReplicateAudioSeparationProvider().separateAudio(audioUrl, opts, reconcileOpts),
    },
    ffmpeg: {
      runFfmpeg,
      runFfmpegCapture,
      createWorkDir,
      cleanupWorkDir,
      downloadFile,
    },
    media: {
      extractAudio,
      mixAudio,
      mergeVideoAudio,
      applyAudioFx,
      applyImageWatermark,
    },
    storage: {
      uploadBufferToR2,
      uploadFileToR2,
      runPostProcessing,
    },
    jobs: {
      markJobCompleted,
      setJobProgress,
      withProgressRamp,
      commitJobCredits,
    },
    http: {
      supabase,
      videoQueue,
      creditGuard,
      reserveCreditsForJob,
      safeUrlSchema,
      extractWorkflowId,
      extractNodeId,
      extractForcePrivate,
      extractMcpClient,
      buildJobInputData,
      formatZodError,
      safeFetch,
    },
  }
}
