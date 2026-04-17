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
import { trimAudioRoutes } from "./routes/trim-audio.js"
import { trimVideoRoutes } from "./routes/trim-video.js"
import { extractFrameRoutes } from "./routes/extract-frame.js"
import { resizeVideoRoutes } from "./routes/resize-video.js"
import { adjustVolumeRoutes } from "./routes/adjust-volume.js"
import { speedRampRoutes } from "./routes/speed-ramp.js"
import { loopVideoRoutes } from "./routes/loop-video.js"
import { fadeVideoRoutes } from "./routes/fade-video.js"
import { transcodeVideoRoutes } from "./routes/transcode-video.js"
import { addCaptionsRoutes } from "./routes/add-captions.js"
import { mixAudioRoutes } from "./routes/mix-audio.js"
import { combineAudioRoutes } from "./routes/combine-audio.js"
import { splitMediaRoutes } from "./routes/split-media.js"
import { generateMusicRoutes } from "./routes/generate-music.js"
import { uploadRoutes } from "./routes/upload.js"
import { mediaProcessRoutes } from "./routes/media-process.js"
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
import { adminSettingsRoutes } from "./routes/admin-settings.js"
import { motionTransferRoutes } from "./routes/motion-transfer.js"
import { videoUpscaleRoutes } from "./routes/video-upscale.js"
import { statsRoutes } from "./routes/stats.js"
import { cancelJobsRoutes } from "./routes/cancel-jobs.js"
import { creditsRoutes } from "./routes/credits.js"
import { adminRoutes } from "./routes/admin.js"
import { libraryRoutes } from "./routes/library.js"
import { transcribeRoutes } from "./routes/transcribe.js"
import { adminCreditsRoutes } from "./routes/admin-credits.js"
import { workflowCostRoutes } from "./routes/workflow-costs.js"
import { sunoRoutes } from "./routes/suno.js"
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js"
import { billingRoutes } from "./routes/billing.js"
import { galleryRoutes } from "./routes/gallery.js"
import { userSettingsRoutes } from "./routes/user-settings.js"
import { adminGalleryReportsRoutes } from "./routes/admin-gallery-reports.js"
import { adminCreditAuditRoutes } from "./routes/admin-credit-audit.js"
import { adminCreditAnomalyRoutes } from "./routes/admin-credit-anomalies.js"
import { adminKieCreditsRoutes } from "./routes/admin-kie-credits.js"
import { adminSubscriptionHealthRoutes } from "./routes/admin-subscription-health.js"
import { aiWriterRoutes } from "./routes/ai-writer.js"
import { llmChatRoutes } from "./routes/llm-chat.js"
import { webScrapeRoutes } from "./routes/web-scrape.js"
import { downloadRoutes } from "./routes/download.js"
import { renderVideoRoutes } from "./routes/render-video.js"
import { sceneGraphAIRoutes } from "./routes/scene-graph-ai.js"
import { afterEffectsAIRoutes } from "./routes/after-effects-ai.js"
import { lottieOverlayAIRoutes } from "./routes/lottie-overlay-ai.js"
import { threeDTitleAIRoutes } from "./routes/three-d-title-ai.js"
import { motionGraphicsAIRoutes } from "./routes/motion-graphics-ai.js"
import { audioIsolationRoutes } from "./routes/audio-isolation.js"
import { textToDialogueRoutes } from "./routes/text-to-dialogue.js"
import { imageToTextRoutes } from "./routes/image-to-text.js"
import { voicesRoutes } from "./routes/voices.js"
import { voiceCloneRoutes } from "./routes/voice-clones.js"
import { voiceChangerRoutes } from "./routes/voice-changer.js"
import { dubbingRoutes } from "./routes/dubbing.js"
import { voiceRemixRoutes } from "./routes/voice-remix.js"
import { voiceDesignRoutes } from "./routes/voice-design.js"
import { forcedAlignmentRoutes } from "./routes/forced-alignment.js"
import { subWorkflowRoutes } from "./routes/sub-workflows.js"
import { workflowExecutionRoutes } from "./routes/workflow-execution.js"
import { webhookTriggerRoutes } from "./routes/webhook-triggers.js"
import { extendVideoRoutes } from "./routes/extend-video.js"
import { speechToVideoRoutes } from "./routes/speech-to-video.js"
import { socialMediaFormatRoutes } from "./routes/social-media-format.js"
import { webhookOutputRoutes } from "./routes/webhook-output.js"
import { presentationRoutes } from "./routes/presentation.js"
import { apiTokenRoutes } from "./routes/api-tokens.js"
import { socialAuthRoutes } from "./routes/social-auth.js"
import { socialPublishRoutes } from "./routes/social-publish.js"
import { telegramWebhookRoutes } from "./routes/telegram-webhook.js"
import { publishedAppsRoutes } from "./routes/published-apps.js"
import { workflowTemplatesRoutes } from "./routes/workflow-templates.js"
import { appRunnerRoutes } from "./routes/app-runner.js"
import { componentExecuteRoutes } from "./routes/component-execute.js"
import { ogTagsRoutes } from "./routes/og-tags.js"
import { appAnalyticsRoutes } from "./routes/app-analytics.js"
import { monetizationRoutes } from "./routes/monetization.js"
import { embedRoutes } from "./routes/embed.js"
import { qaCheckRoutes } from "./routes/qa-check.js"
import { saveToStorageRoutes } from "./routes/save-to-storage.js"
import { promptHelperRoutes } from "./routes/prompt-helper.js"
import { adminLlmModelsRoutes } from "./routes/admin-llm-models.js"
import { tutorialsRoutes } from "./routes/tutorials.js"
import { adminTutorialsRoutes } from "./routes/admin-tutorials.js"
import { executionStatsRoutes } from "./routes/execution-stats.js"
import { registerAuthHook } from "./middleware/auth.js"

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 }) // 1 MB for JSON endpoints

  // Build CORS origin whitelist: always include localhost for dev, plus
  // any origins from CORS_ORIGIN env var (comma-separated).
  const allowedOrigins = new Set([
    "http://localhost:3000",
    "https://app.nodaro.ai",
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
  await app.register(trimAudioRoutes)
  await app.register(trimVideoRoutes)
  await app.register(extractFrameRoutes)
  await app.register(resizeVideoRoutes)
  await app.register(adjustVolumeRoutes)
  await app.register(speedRampRoutes)
  await app.register(loopVideoRoutes)
  await app.register(fadeVideoRoutes)
  await app.register(transcodeVideoRoutes)
  await app.register(addCaptionsRoutes)
  await app.register(mixAudioRoutes)
  await app.register(combineAudioRoutes)
  await app.register(splitMediaRoutes)
  await app.register(generateMusicRoutes)
  await app.register(uploadRoutes)
  await app.register(mediaProcessRoutes)
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
  await app.register(adminSettingsRoutes)
  await app.register(motionTransferRoutes)
  await app.register(videoUpscaleRoutes)
  await app.register(statsRoutes)
  await app.register(executionStatsRoutes)
  await app.register(cancelJobsRoutes)
  await app.register(creditsRoutes)
  await app.register(adminRoutes)
  await app.register(libraryRoutes)
  await app.register(transcribeRoutes)
  await app.register(adminCreditsRoutes)
  await app.register(workflowCostRoutes)
  await app.register(sunoRoutes)
  await app.register(stripeWebhookRoutes)
  await app.register(billingRoutes)
  await app.register(galleryRoutes)
  await app.register(userSettingsRoutes)
  await app.register(adminGalleryReportsRoutes)
  await app.register(adminCreditAuditRoutes)
  await app.register(adminCreditAnomalyRoutes)
  await app.register(adminKieCreditsRoutes)
  await app.register(adminSubscriptionHealthRoutes)
  await app.register(aiWriterRoutes)
  await app.register(llmChatRoutes)
  await app.register(webScrapeRoutes)
  await app.register(downloadRoutes)
  await app.register(renderVideoRoutes)
  await app.register(sceneGraphAIRoutes)
  await app.register(afterEffectsAIRoutes)
  await app.register(lottieOverlayAIRoutes)
  await app.register(threeDTitleAIRoutes)
  await app.register(motionGraphicsAIRoutes)
  await app.register(audioIsolationRoutes)
  await app.register(textToDialogueRoutes)
  await app.register(imageToTextRoutes)
  await app.register(voicesRoutes)
  await app.register(voiceCloneRoutes)
  await app.register(voiceChangerRoutes)
  await app.register(dubbingRoutes)
  await app.register(voiceRemixRoutes)
  await app.register(voiceDesignRoutes)
  await app.register(forcedAlignmentRoutes)
  await app.register(subWorkflowRoutes)
  await app.register(workflowExecutionRoutes)
  await app.register(webhookTriggerRoutes)
  await app.register(extendVideoRoutes)
  await app.register(speechToVideoRoutes)
  await app.register(socialMediaFormatRoutes)
  await app.register(webhookOutputRoutes)
  await app.register(presentationRoutes)
  await app.register(apiTokenRoutes)
  await app.register(socialAuthRoutes)
  await app.register(socialPublishRoutes)
  await app.register(telegramWebhookRoutes)
  await app.register(publishedAppsRoutes)
  await app.register(workflowTemplatesRoutes)
  await app.register(appRunnerRoutes)
  await app.register(componentExecuteRoutes)
  await app.register(ogTagsRoutes)
  await app.register(appAnalyticsRoutes)
  await app.register(monetizationRoutes)
  await app.register(embedRoutes)
  await app.register(qaCheckRoutes)
  await app.register(saveToStorageRoutes)
  await app.register(promptHelperRoutes)
  await app.register(adminLlmModelsRoutes)
  await app.register(tutorialsRoutes)
  await app.register(adminTutorialsRoutes)

  return app
}
