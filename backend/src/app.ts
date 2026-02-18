import Fastify from "fastify"
import cors from "@fastify/cors"
import { config } from "./lib/config.js"
import { healthRoutes } from "./routes/health.js"
import { projectRoutes } from "./routes/projects.js"
import { workflowRoutes } from "./routes/workflows.js"
import { jobRoutes } from "./routes/jobs.js"
import { renderRoutes } from "./routes/render.js"
import { generateImageRoutes } from "./routes/generate-image.js"
import { editImageRoutes } from "./routes/edit-image.js"
import { imageToImageRoutes } from "./routes/image-to-image.js"
import { generateVideoRoutes } from "./routes/generate-video.js"
import { videoToVideoRoutes } from "./routes/video-to-video.js"
import { textToVideoRoutes } from "./routes/text-to-video.js"
import { lipSyncRoutes } from "./routes/lip-sync.js"
import { textToSpeechRoutes } from "./routes/text-to-speech.js"
import { generateScriptRoutes } from "./routes/generate-script.js"
import { combineVideosRoutes } from "./routes/combine-videos.js"
import { mergeVideoAudioRoutes } from "./routes/merge-video-audio.js"
import { extractAudioRoutes } from "./routes/extract-audio.js"
import { trimVideoRoutes } from "./routes/trim-video.js"
import { resizeVideoRoutes } from "./routes/resize-video.js"
import { adjustVolumeRoutes } from "./routes/adjust-volume.js"
import { addCaptionsRoutes } from "./routes/add-captions.js"
import { mixAudioRoutes } from "./routes/mix-audio.js"
import { generateMusicRoutes } from "./routes/generate-music.js"
import { uploadRoutes } from "./routes/upload.js"
import { youtubeAudioRoutes } from "./routes/youtube-audio.js"
import { downloadVideoRoutes } from "./routes/download-video.js"
import { extractYouTubeAudioRoutes } from "./routes/extract-youtube-audio.js"
import { textToAudioRoutes } from "./routes/text-to-audio.js"
import { imageProxyRoutes } from "./routes/image-proxy.js"
import { generateCharacterRoutes } from "./routes/generate-character.js"
import { generateFaceRoutes } from "./routes/generate-face.js"
import { generateCharacterAssetRoutes } from "./routes/generate-character-asset.js"
import { splitImageRoutes } from "./routes/split-image.js"
import { characterRoutes } from "./routes/characters.js"
import { faceRoutes } from "./routes/faces.js"
import { objectRoutes } from "./routes/objects.js"
import { generateObjectAssetRoutes } from "./routes/generate-object-asset.js"
import { generateObjectRoutes } from "./routes/generate-object.js"
import { locationRoutes } from "./routes/locations.js"
import { generateLocationRoutes } from "./routes/generate-location.js"
import { generateLocationAssetRoutes } from "./routes/generate-location-asset.js"
import { predictionsRoutes } from "./routes/predictions.js"
import { adminSettingsRoutes } from "./routes/admin-settings.js"
import { motionTransferRoutes } from "./routes/motion-transfer.js"
import { videoUpscaleRoutes } from "./routes/video-upscale.js"
import { statsRoutes } from "./routes/stats.js"
import { cancelJobsRoutes } from "./routes/cancel-jobs.js"
import { creditsRoutes } from "./billing/routes.js"
import { adminRoutes } from "./routes/admin.js"
import { libraryRoutes } from "./routes/library.js"
import { transcribeRoutes } from "./routes/transcribe.js"
import { adminCreditsRoutes } from "./routes/admin-credits.js"
import { workflowCostRoutes } from "./routes/workflow-costs.js"
import { sunoRoutes } from "./routes/suno.js"
import { paddleWebhookRoutes } from "./routes/paddle-webhook.js"
import { billingRoutes } from "./routes/billing.js"
import { galleryRoutes } from "./routes/gallery.js"
import { userSettingsRoutes } from "./routes/user-settings.js"
import { adminGalleryReportsRoutes } from "./routes/admin-gallery-reports.js"
import { aiWriterRoutes } from "./routes/ai-writer.js"
import { downloadRoutes } from "./routes/download.js"
import { renderVideoRoutes } from "./routes/render-video.js"
import { registerAuthHook } from "./middleware/auth.js"

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 }) // 1 MB for JSON endpoints

  // Build CORS origin whitelist: always include localhost for dev, plus
  // any origins from CORS_ORIGIN env var (comma-separated).
  const allowedOrigins = new Set([
    "http://localhost:3000",
    "https://app.scenenode.ai",
  ])
  if (config.CORS_ORIGIN) {
    for (const o of config.CORS_ORIGIN.split(",")) {
      const trimmed = o.trim()
      if (trimmed) allowedOrigins.add(trimmed)
    }
  }

  await app.register(cors, {
    origin: [...allowedOrigins],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })

  registerAuthHook(app)

  await app.register(healthRoutes)
  await app.register(projectRoutes)
  await app.register(workflowRoutes)
  await app.register(jobRoutes)
  await app.register(renderRoutes)
  await app.register(generateImageRoutes)
  await app.register(editImageRoutes)
  await app.register(imageToImageRoutes)
  await app.register(generateVideoRoutes)
  await app.register(videoToVideoRoutes)
  await app.register(textToVideoRoutes)
  await app.register(lipSyncRoutes)
  await app.register(textToSpeechRoutes)
  await app.register(generateScriptRoutes)
  await app.register(combineVideosRoutes)
  await app.register(mergeVideoAudioRoutes)
  await app.register(extractAudioRoutes)
  await app.register(trimVideoRoutes)
  await app.register(resizeVideoRoutes)
  await app.register(adjustVolumeRoutes)
  await app.register(addCaptionsRoutes)
  await app.register(mixAudioRoutes)
  await app.register(generateMusicRoutes)
  await app.register(uploadRoutes)
  await app.register(youtubeAudioRoutes)
  await app.register(downloadVideoRoutes)
  await app.register(extractYouTubeAudioRoutes)
  await app.register(textToAudioRoutes)
  await app.register(imageProxyRoutes)
  await app.register(generateCharacterRoutes)
  await app.register(generateFaceRoutes)
  await app.register(generateCharacterAssetRoutes)
  await app.register(splitImageRoutes)
  await app.register(characterRoutes)
  await app.register(faceRoutes)
  await app.register(objectRoutes)
  await app.register(generateObjectAssetRoutes)
  await app.register(generateObjectRoutes)
  await app.register(locationRoutes)
  await app.register(generateLocationRoutes)
  await app.register(generateLocationAssetRoutes)
  await app.register(predictionsRoutes)
  await app.register(adminSettingsRoutes)
  await app.register(motionTransferRoutes)
  await app.register(videoUpscaleRoutes)
  await app.register(statsRoutes)
  await app.register(cancelJobsRoutes)
  await app.register(creditsRoutes)
  await app.register(adminRoutes)
  await app.register(libraryRoutes)
  await app.register(transcribeRoutes)
  await app.register(adminCreditsRoutes)
  await app.register(workflowCostRoutes)
  await app.register(sunoRoutes)
  await app.register(paddleWebhookRoutes)
  await app.register(billingRoutes)
  await app.register(galleryRoutes)
  await app.register(userSettingsRoutes)
  await app.register(adminGalleryReportsRoutes)
  await app.register(aiWriterRoutes)
  await app.register(downloadRoutes)
  await app.register(renderVideoRoutes)

  return app
}
