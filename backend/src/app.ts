import Fastify from "fastify"
import { requestLogSerializer } from "./lib/log-redaction.js"
import { createHash } from "node:crypto"
import cors from "@fastify/cors"
import { isOriginAllowedDynamic } from "./lib/dynamic-origins.js"
import { config, hasAdmin, hasCredits, isCloud, isMultiUser } from "./lib/config.js"
import { CLIENT_HEADER } from "./lib/job-source.js"
import { WORKSPACE_HEADER } from "@nodaro/shared"

/**
 * The CORS options the app registers. Exported so a test can register them on
 * a throwaway instance and assert a real PREFLIGHT, rather than grepping this
 * file for a symbol — a header that is textually present but wrongly resolved
 * still breaks every browser call from that origin.
 *
 * `allowedHeaders` is load-bearing, not cosmetic. `@nodaro/sdk` sends
 * CLIENT_HEADER on every request and WORKSPACE_HEADER once a workspace is
 * selected, and all six Nodaro client apps (studio / person / voice / recast
 * / recut / stitch) are browser SPAs calling this API cross-origin. A custom
 * request header missing from this list fails the preflight — not one
 * endpoint, every call from that origin. Adding a header to the SDK without
 * adding it here is a fleet-wide outage.
 */
export function buildCorsOptions(mcpIframeRe: RegExp) {
  return {
    // Same-origin / curl requests have no Origin header — allow them.
    // Use the async-promise form (NOT callback form) — @fastify/cors invokes
    // both the cb and resolves the promise if you return one, double-firing.
    origin: async (origin: string | undefined) => {
      if (!origin) return true
      if (mcpIframeRe.test(origin)) return true
      return isOriginAllowedDynamic(origin)
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", CLIENT_HEADER, WORKSPACE_HEADER],
    credentials: true,
  }
}
import { loadPrivatePlugins } from "./lib/private-plugins/load.js"
import { healthRoutes } from "./routes/health.js"
import { projectRoutes } from "./routes/projects.js"
import { workflowRoutes } from "./routes/workflows.js"
import { jobRoutes } from "./routes/jobs.js"
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
import { imageCollageRoutes } from "./routes/image-collage.js"
import { assembleNarratedVideoRoutes } from "./routes/assemble-narrated-video.js"
import { referenceSheetRoutes } from "./routes/reference-sheet.js"
import { referenceBoardRoutes } from "./routes/reference-board.js"
import { mergeVideoAudioRoutes } from "./routes/merge-video-audio.js"
import videoSfxRoutes from "./routes/video-sfx.js"
import { trimAudioRoutes } from "./routes/trim-audio.js"
import { trimVideoRoutes } from "./routes/trim-video.js"
import { extractFrameRoutes } from "./routes/extract-frame.js"
import { resizeVideoRoutes } from "./routes/resize-video.js"
import { adjustVolumeRoutes } from "./routes/adjust-volume.js"
import { audioFxRoutes } from "./routes/audio-fx.js"
import { speedRampRoutes } from "./routes/speed-ramp.js"
import { loopVideoRoutes } from "./routes/loop-video.js"
import { fadeVideoRoutes } from "./routes/fade-video.js"
import { stillToVideoRoutes } from "./routes/still-to-video.js"
import { slideshowRoutes } from "./routes/slideshow.js"
import { transcodeVideoRoutes } from "./routes/transcode-video.js"
import { addCaptionsRoutes } from "./routes/add-captions.js"
import { mixAudioRoutes } from "./routes/mix-audio.js"
import { combineAudioRoutes } from "./routes/combine-audio.js"
import { splitMediaRoutes } from "./routes/split-media.js"
import { extractAudioRoutes } from "./routes/extract-audio.js"
import { removeAudioRoutes } from "./routes/remove-audio.js"
import { generateMusicRoutes } from "./routes/generate-music.js"
import { uploadRoutes } from "./routes/upload.js"
import { uploadProxyRoutes } from "./routes/upload-proxy.js"
import { uploadHandoffRoutes } from "./routes/upload-handoff.js"
import { mediaProcessRoutes } from "./routes/media-process.js"
import { youtubeAudioRoutes } from "./routes/youtube-audio.js"
import { developerAppRoutes } from "./routes/developer-apps.js"
import { downloadVideoRoutes } from "./routes/download-video.js"
import { videoMetadataRoutes } from "./routes/video-metadata.js"
import { extractYouTubeAudioRoutes } from "./routes/extract-youtube-audio.js"
import { textToAudioRoutes } from "./routes/text-to-audio.js"
import { imageProxyRoutes } from "./routes/image-proxy.js"
import { generateCharacterRoutes } from "./routes/generate-character.js"
import { generateFaceRoutes } from "./routes/generate-face.js"
import { generateCharacterAssetRoutes } from "./routes/generate-character-asset.js"
import { generateCharacterMotionRoutes } from "./routes/generate-character-motion.js"
import { splitImageRoutes } from "./routes/split-image.js"
import { characterRoutes } from "./routes/characters.js"
import { faceRoutes } from "./routes/faces.js"
import { objectRoutes } from "./routes/objects.js"
import { objectRestoreRoutes } from "./routes/object-restore.js"
import { objectMainImageApprovalRoutes } from "./routes/object-main-image-approval.js"
import { objectLlmCaptionRoutes } from "./routes/object-llm-caption.js"
import { generateObjectAssetRoutes } from "./routes/generate-object-asset.js"
import { generateObjectRoutes } from "./routes/generate-object.js"
import { generateObjectMotionRoutes } from "./routes/generate-object-motion.js"
import { creatureRoutes } from "./routes/creatures.js"
import { creatureRestoreRoutes } from "./routes/creature-restore.js"
import { creatureMainImageApprovalRoutes } from "./routes/creature-main-image-approval.js"
import { creatureLlmCaptionRoutes } from "./routes/creature-llm-caption.js"
import { generateCreatureRoutes } from "./routes/generate-creature.js"
import { generateCreatureAssetRoutes } from "./routes/generate-creature-asset.js"
import { generateCreatureMotionRoutes } from "./routes/generate-creature-motion.js"
import { locationRoutes } from "./routes/locations.js"
import { nodePresetRoutes } from "./routes/node-presets.js"
import { nodePresetGroupRoutes } from "./routes/node-preset-groups.js"
import { promptSnippetRoutes } from "./routes/prompt-snippets.js"
import { locationRestoreRoutes } from "./routes/location-restore.js"
import { locationMainImageApprovalRoutes } from "./routes/location-main-image-approval.js"
import { locationLlmCaptionRoutes } from "./routes/location-llm-caption.js"
import { generateLocationRoutes } from "./routes/generate-location.js"
import { generateLocationAssetRoutes } from "./routes/generate-location-asset.js"
import { generateSurroundContinuationRoutes } from "./routes/generate-surround-continuation.js"
import { generateLocationMotionRoutes } from "./routes/generate-location-motion.js"
import { adminSettingsRoutes } from "./ee/routes/admin-settings.js"
import { motionTransferRoutes } from "./routes/motion-transfer.js"
import { videoUpscaleRoutes } from "./routes/video-upscale.js"
import { faceSwapRoutes } from "./routes/face-swap.js"
import { generateMaskRoutes } from "./routes/generate-mask.js"
import { statsRoutes } from "./routes/stats.js"
import { cancelJobsRoutes } from "./routes/cancel-jobs.js"
import { creditsRoutes } from "./ee/routes/credits.js"
import { registerCreditsBalanceRoutes } from "./ee/routes/credits-balance.js"
import { registerCopilotRoutes } from "./ee/routes/copilot.js"
import { adminRoutes } from "./ee/routes/admin.js"
import { libraryRoutes } from "./routes/library.js"
import { storageStatusRoutes } from "./routes/storage-status.js"
import { profileAttributionRoutes } from "./routes/profile-attribution.js"
import { mediaDeleteRoutes } from "./routes/media-delete.js"
import { mediaImportUrlRoutes } from "./routes/media-import-url.js"
import { transcribeRoutes } from "./routes/transcribe.js"
import { adminCreditsRoutes } from "./ee/routes/admin-credits.js"
import { adminLocationRoutes } from "./ee/routes/admin-locations.js"
import { workflowCostRoutes } from "./routes/workflow-costs.js"
import { sunoRoutes } from "./routes/suno.js"
import { stripeWebhookRoutes } from "./ee/routes/stripe-webhook.js"
import { billingRoutes } from "./ee/routes/billing.js"
import { connectedInstancesRoutes } from "./ee/routes/connected-instances.js"
import { galleryRoutes } from "./routes/gallery.js"
import { runtimeSurfaceProfile } from "./lib/surface-profile.js"
import { userSettingsRoutes } from "./routes/user-settings.js"
import { meRoutes } from "./routes/me.js"
import { adminGalleryReportsRoutes } from "./ee/routes/admin-gallery-reports.js"
import { adminCreditAuditRoutes } from "./ee/routes/admin-credit-audit.js"
import { adminCreditAnomalyRoutes } from "./ee/routes/admin-credit-anomalies.js"
import { adminPickerGapsRoutes } from "./ee/routes/admin-picker-gaps.js"
import { adminAppReportsRoutes } from "./ee/routes/admin-app-reports.js"
import { adminKieCreditsRoutes } from "./ee/routes/admin-kie-credits.js"
import { adminStuckPipelinesRoutes } from "./ee/routes/admin-stuck-pipelines.js"
import { adminSubscriptionHealthRoutes } from "./ee/routes/admin-subscription-health.js"
import { communityRoutes } from "./ee/routes/community.js"
import { adminCommunityRoutes } from "./ee/routes/admin-community.js"
import { aiWriterRoutes } from "./routes/ai-writer.js"
import { llmChatRoutes } from "./routes/llm-chat.js"
import { llmSuggestDescriptionRoutes } from "./routes/llm-suggest-description.js"
import { characterPortraitApprovalRoutes } from "./routes/character-portrait-approval.js"
import { characterTrainingRoutes } from "./routes/character-training.js"
import { replicateTrainingWebhookRoutes } from "./routes/replicate-training-webhook.js"
import { webScrapeRoutes } from "./routes/web-scrape.js"
import { reduceRoutes } from "./routes/reduce.js"
import { downloadRoutes } from "./routes/download.js"
import { renderVideoRoutes } from "./routes/render-video.js"
import { sceneGraphAIRoutes } from "./routes/scene-graph-ai.js"
import { afterEffectsAIRoutes } from "./routes/after-effects-ai.js"
import { lottieOverlayAIRoutes } from "./routes/lottie-overlay-ai.js"
import { threeDTitleAIRoutes } from "./routes/three-d-title-ai.js"
import { motionGraphicsAIRoutes } from "./routes/motion-graphics-ai.js"
import { audioIsolationRoutes } from "./routes/audio-isolation.js"
import { audioSeparationRoutes } from "./routes/audio-separation.js"
import { textToDialogueRoutes } from "./routes/text-to-dialogue.js"
import { imageToTextRoutes } from "./routes/image-to-text.js"
import { describeToPickerRoutes } from "./routes/describe-to-picker.js"
import { textToPickerRoutes } from "./routes/text-to-picker.js"
import { shotsRoutes } from "./routes/shots.js"
import { modelsRoutes } from "./routes/models.js"
import { voicesRoutes } from "./routes/voices.js"
import { heygenCatalogRoutes } from "./routes/heygen-catalog.js"
import { voiceCloneRoutes } from "./routes/voice-clones.js"
import { voiceChangerRoutes } from "./routes/voice-changer.js"
import { dubbingRoutes } from "./routes/dubbing.js"
import { voiceRemixRoutes } from "./routes/voice-remix.js"
import { voiceDesignRoutes } from "./routes/voice-design.js"
import { forcedAlignmentRoutes } from "./routes/forced-alignment.js"
import { shotSequenceRoutes } from "./routes/shot-sequence.js"
import { videoDirectorRoutes } from "./routes/video-director.js"
import { subWorkflowRoutes } from "./routes/sub-workflows.js"
import { workflowExecutionRoutes } from "./routes/workflow-execution.js"
import { webhookTriggerRoutes } from "./routes/webhook-triggers.js"
import { pipelinesRoutes } from "./routes/pipelines.js"
import { sceneHelpersRoutes } from "./routes/scene-helpers.js"
import { extendVideoRoutes } from "./routes/extend-video.js"
import { videoRetakeRoutes } from "./routes/video-retake.js"
import { speechToVideoRoutes } from "./routes/speech-to-video.js"
import { aiAvatarRoutes } from "./routes/ai-avatar.js"
import { switchXRoutes } from "./routes/switchx.js"
import { cinematicAvatarRoutes } from "./routes/cinematic-avatar.js"
import { socialMediaFormatRoutes } from "./routes/social-media-format.js"
import { webhookOutputRoutes } from "./routes/webhook-output.js"
import { presentationRoutes } from "./routes/presentation.js"
import { apiTokenRoutes } from "./routes/api-tokens.js"
import { metaCallbackRoutes } from "./routes/meta-callbacks.js"
import { socialAuthRoutes } from "./routes/social-auth.js"
import { nodaroConnectRoutes } from "./routes/nodaro-connect.js"
import { socialPublishRoutes } from "./routes/social-publish.js"
import { scheduledPostsRoutes } from "./routes/scheduled-posts.js"
import { telegramWebhookRoutes } from "./routes/telegram-webhook.js"
import { telegramChannelRoutes } from "./routes/telegram-channel.js"
import { publishedAppsRoutes } from "./routes/published-apps.js"
import { workflowTemplatesRoutes } from "./routes/workflow-templates.js"
import { appRunnerRoutes } from "./routes/app-runner.js"
import { componentExecuteRoutes } from "./routes/component-execute.js"
import { ogTagsRoutes } from "./routes/og-tags.js"
import { appAnalyticsRoutes } from "./routes/app-analytics.js"
import { monetizationRoutes } from "./ee/routes/monetization.js"
import { freecutExportRoutes } from "./ee/routes/freecut-export.js"
import { embedRoutes } from "./routes/embed.js"
import { qaCheckRoutes } from "./routes/qa-check.js"
import { imageCriticRoutes } from "./routes/image-critic.js"
import { saveToStorageRoutes } from "./routes/save-to-storage.js"
import { promptHelperRoutes } from "./routes/prompt-helper.js"
import { adminLlmModelsRoutes } from "./ee/routes/admin-llm-models.js"
import { nodeDefaultsRoutes } from "./routes/node-defaults.js"
import { nodesRoutes } from "./routes/nodes.js"
import { pickerCatalogsRoutes } from "./routes/picker-catalogs.js"
import { catalogsRoutes } from "./routes/catalogs.js"
import { oauthRoutes } from "./routes/oauth.js"
import { registerOauthRegister } from "./routes/oauth-register.js"
import { registerWellKnown } from "./routes/well-known.js"
import { registerMcpRoute } from "./routes/mcp.js"
import { adminNodeDefaultsRoutes } from "./ee/routes/admin-node-defaults.js"
import { tutorialsRoutes } from "./routes/tutorials.js"
import { adminTutorialsRoutes } from "./ee/routes/admin-tutorials.js"
import { adminTutorialCategoriesRoutes } from "./ee/routes/admin-tutorial-categories.js"
import { adminClientAppsRoutes } from "./ee/routes/admin-client-apps.js"
import { executionStatsRoutes } from "./routes/execution-stats.js"
import { onboardingRoutes } from "./routes/onboarding.js"
import { setupStatusRoutes } from "./routes/setup-status.js"
import { versionRoutes } from "./routes/version.js"
import { nodaroExclusiveRoutes } from "./routes/nodaro-exclusive.js"
import { providerKeysRoutes } from "./routes/provider-keys.js"
import { openapiRoutes } from "./routes/openapi.js"
import { registerAuthHook } from "./middleware/auth.js"
import { registerOrgsContextHook } from "./lib/orgs-context.js"
import { registerMcpHostFilter } from "./middleware/mcp-host-filter.js"
import rateLimit from "@fastify/rate-limit"
import formbody from "@fastify/formbody"
import { installTolerantJsonParser } from "./lib/tolerant-json-parser.js"
import { registerInternalErrorSanitizer, registerErrorTelemetry } from "./lib/http-errors.js"

/**
 * Rate-limit key derivation.
 *
 * SECURITY: authenticated requests are keyed by a hash of the credential
 * (Bearer JWT / `ndr_app_` OAuth token / `ndr_` API token), NOT by the
 * client-supplied `X-Forwarded-For`. The previous XFF-only keyer let any caller
 * escape a per-route limit (e.g. suno `/voice/generate` 5/min, 20 cr each) just
 * by rotating the header — a stolen JWT could drain a balance at full speed.
 * Keying by the credential is unspoofable (the attacker would need the token)
 * and gives a stable per-identity bucket regardless of source IP. We only fall
 * back to IP/XFF for UNauthenticated routes (e.g. OAuth dynamic-client
 * registration), where there is no credential to key on.
 *
 * Exported for unit testing.
 */
export function rateLimitKeyGenerator(req: {
  headers: Record<string, string | string[] | undefined>
  ip?: string
}): string {
  const auth = req.headers["authorization"]
  if (typeof auth === "string" && auth.length > 0) {
    return "cred:" + createHash("sha256").update(auth).digest("hex")
  }
  const xff = req.headers["x-forwarded-for"]
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim()
  return req.ip || "unknown"
}

export async function buildApp() {
  const app = Fastify({
    // Same defaults as `logger: true`, plus a req serializer that redacts
    // OAuth secrets (code/state/access_token query values) out of logged
    // URLs — with the plain default, every /v1/social/callback hit wrote a
    // live authorization code into the deployment logs (lib/log-redaction.ts).
    logger: { serializers: { req: requestLogSerializer } },
    bodyLimit: 1_048_576, // 1 MB for JSON endpoints
    // Default is 100 chars per path param. Our HMAC-signed upload-page
    // tokens (`/v1/upload-page/:token`) are ~330 chars (base64url-encoded
    // JSON payload + signature), and routes with longer params 404 as
    // "Route not found" with the default. Bump to a generous 4 KB so any
    // signed-token route works. Same applies to `:token` in upload-proxy
    // and any future signed-token URLs.
    maxParamLength: 4096,
  })

  // application/x-www-form-urlencoded body parser — required by OAuth-spec
  // clients (Claude.ai etc.) that POST to /v1/oauth/token with form-encoded
  // bodies per RFC 6749 §3.2. Without this, Fastify's default JSON parser
  // drops the body and Zod sees undefined fields.
  await app.register(formbody)

  // Tolerant root-level application/json parser: an empty body with a JSON
  // content-type parses to `undefined` instead of 400 (the SDK sets the header
  // on bodyless writes), and bodied requests parse normally even when the edge
  // forwards them chunked (no content-length). Replaces the old header-stripping
  // onRequest hook, which equated "no content-length" with "no body" and 415'd
  // every JSON write when the edge switched to chunked forwarding (2026-07-17
  // outage). The Stripe/Replicate webhook parsers stay scoped via app.register()
  // and override this only for their own routes. See the helper's doc comment.
  installTolerantJsonParser(app)

  // Global backstop: strip raw error detail from any `internal_error` 500 body
  // (logging the original server-side) unless the route used `sendInternalError`.
  // Guarantees no route can leak a raw DB/provider message just by forgetting
  // the helper. Registered early so it applies to every route below.
  registerInternalErrorSanitizer(app)

  // Server-error telemetry: uncaught route throws (Fastify default handler
  // path) are reported into `app_reports` (kind "internal-error") so they
  // surface at /admin/app-reports; sendInternalError + the sanitizer net
  // report their own paths. Observability only — never alters a response.
  registerErrorTelemetry(app)

  // Claude.ai MCP UI iframes get a per-instance sandbox subdomain on
  // claudemcpcontent.com. Origins look like
  // `https://d603a1e129f461a456764f10cd89c6fb.claudemcpcontent.com` —
  // 32-char hex prefix. Match the whole family with one regex so widgets
  // (e.g. upload-image) can fetch our backend without each iframe origin
  // being separately allowlisted. Only pages served from this domain are
  // legit MCP widgets, so granting CORS broadly is safe — Bearer auth /
  // upload tokens still gate protected routes.
  const CLAUDE_MCP_IFRAME_RE = /^https:\/\/[a-f0-9]+\.claudemcpcontent\.com$/

  await app.register(cors, buildCorsOptions(CLAUDE_MCP_IFRAME_RE))

  // Restrict mcp.*.nodaro.ai to MCP-only paths (404s anything else).
  // Registered BEFORE the auth hook so 404'd requests don't waste a DB lookup.
  registerMcpHostFilter(app)

  // Rate limiter — opt-in per-route via { config: { rateLimit: {...} } }.
  // Currently used by /v1/oauth/register (10/min/IP) to mitigate unauthenticated
  // DCR abuse. Other routes don't apply rate limiting unless they declare it.
  // In-memory store; switch to Redis when we add multi-replica scale.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: rateLimitKeyGenerator,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: {
        code: "rate_limit_exceeded",
        message: `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.`,
      },
    }),
  })

  registerAuthHook(app)

  // Workspace context — AFTER the auth hook, which is what resolves the
  // identity this validates against. A no-op unless organizations are
  // enabled AND a private plugin provides the orgs service.
  registerOrgsContextHook(app)

  await app.register(healthRoutes)
  await app.register(projectRoutes)
  await app.register(workflowRoutes)
  await app.register(jobRoutes)
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
  await app.register(imageCollageRoutes)
  await app.register(assembleNarratedVideoRoutes)
  await app.register(referenceSheetRoutes)
  await app.register(referenceBoardRoutes)
  await app.register(mergeVideoAudioRoutes)
  await app.register(videoSfxRoutes)
  // video-analysis route moved to @nodaroai/cloud-plugins — it registers via
  // loadPrivatePlugins({ app }) below (POST /v1/video-analysis + /probe).
  await app.register(trimAudioRoutes)
  await app.register(trimVideoRoutes)
  await app.register(extractFrameRoutes)
  await app.register(resizeVideoRoutes)
  await app.register(adjustVolumeRoutes)
  await app.register(audioFxRoutes)
  await app.register(speedRampRoutes)
  await app.register(loopVideoRoutes)
  await app.register(fadeVideoRoutes)
  await app.register(stillToVideoRoutes)
  await app.register(slideshowRoutes)
  await app.register(transcodeVideoRoutes)
  await app.register(addCaptionsRoutes)
  await app.register(mixAudioRoutes)
  await app.register(combineAudioRoutes)
  await app.register(splitMediaRoutes)
  await app.register(extractAudioRoutes)
  await app.register(removeAudioRoutes)
  await app.register(generateMusicRoutes)
  await app.register(uploadRoutes)
  await app.register(uploadProxyRoutes)
  await app.register(uploadHandoffRoutes)
  await app.register(mediaProcessRoutes)
  await app.register(youtubeAudioRoutes)
  await app.register(developerAppRoutes)
  await app.register(downloadVideoRoutes)
  await app.register(videoMetadataRoutes)
  await app.register(extractYouTubeAudioRoutes)
  await app.register(textToAudioRoutes)
  await app.register(imageProxyRoutes)
  await app.register(generateCharacterRoutes)
  await app.register(generateFaceRoutes)
  await app.register(generateCharacterAssetRoutes)
  await app.register(generateCharacterMotionRoutes)
  await app.register(splitImageRoutes)
  await app.register(characterRoutes)
  await app.register(faceRoutes)
  await app.register(objectRoutes)
  await app.register(objectRestoreRoutes)
  await app.register(objectMainImageApprovalRoutes)
  await app.register(objectLlmCaptionRoutes)
  await app.register(generateObjectAssetRoutes)
  await app.register(generateObjectRoutes)
  await app.register(generateObjectMotionRoutes)
  await app.register(creatureRoutes)
  await app.register(creatureRestoreRoutes)
  await app.register(creatureMainImageApprovalRoutes)
  await app.register(creatureLlmCaptionRoutes)
  await app.register(generateCreatureRoutes)
  await app.register(generateCreatureAssetRoutes)
  await app.register(generateCreatureMotionRoutes)
  await app.register(locationRoutes)
  await app.register(nodePresetRoutes)
  await app.register(nodePresetGroupRoutes)
  await app.register(promptSnippetRoutes)
  await app.register(locationRestoreRoutes)
  await app.register(locationMainImageApprovalRoutes)
  await app.register(locationLlmCaptionRoutes)
  await app.register(generateLocationRoutes)
  await app.register(generateLocationAssetRoutes)
  await app.register(generateSurroundContinuationRoutes)
  await app.register(generateLocationMotionRoutes)
  if (hasAdmin()) await app.register(adminSettingsRoutes)
  await app.register(motionTransferRoutes)
  await app.register(videoUpscaleRoutes)
  await app.register(faceSwapRoutes)
  await app.register(generateMaskRoutes)
  await app.register(statsRoutes)
  await app.register(executionStatsRoutes)
  await app.register(cancelJobsRoutes)
  if (hasCredits()) await app.register(creditsRoutes)
  if (hasCredits()) await registerCreditsBalanceRoutes(app)
  if (hasCredits()) await registerCopilotRoutes(app)
  if (hasAdmin()) await app.register(adminRoutes)
  if (hasAdmin()) await app.register(adminLocationRoutes)
  await app.register(libraryRoutes)
  await app.register(storageStatusRoutes)
  await app.register(profileAttributionRoutes)
  await app.register(mediaDeleteRoutes)
  await app.register(mediaImportUrlRoutes)
  await app.register(transcribeRoutes)
  if (hasCredits()) await app.register(adminCreditsRoutes)  // CreditsService + TIER_CREDITS
  await app.register(workflowCostRoutes)
  await app.register(sunoRoutes)
  if (hasCredits()) await app.register(stripeWebhookRoutes)
  if (hasCredits()) await app.register(billingRoutes)
  // Community cloud-connect containment surface (Phase 4a) — flag-gated with
  // the DCR branch so the whole feature appears/disappears together.
  if (hasCredits() && config.COMMUNITY_CONNECT_ENABLED) await app.register(connectedInstancesRoutes)
  // Surface profile (B1): a deployment that hides gallery must not register the
  // public /v1/gallery route either — a hidden nav entry over a live public
  // route is a decorative-only deny.
  if (!runtimeSurfaceProfile().nav.hide.includes("gallery")) await app.register(galleryRoutes)
  await app.register(userSettingsRoutes)
  await app.register(meRoutes)
  if (hasAdmin()) await app.register(adminGalleryReportsRoutes)
  if (hasAdmin()) await app.register(adminCreditAuditRoutes)
  if (hasAdmin()) await app.register(adminCreditAnomalyRoutes)
  if (hasAdmin()) await app.register(adminPickerGapsRoutes)
  if (hasAdmin()) await app.register(adminAppReportsRoutes)
  if (hasAdmin()) await app.register(adminKieCreditsRoutes)
  if (hasAdmin()) await app.register(adminStuckPipelinesRoutes)
  if (hasCredits()) await app.register(adminSubscriptionHealthRoutes)  // getStripe + TIER_CREDITS
  if (isMultiUser()) await app.register(communityRoutes)
  if (isMultiUser()) await app.register(adminCommunityRoutes)
  await app.register(aiWriterRoutes)
  await app.register(llmChatRoutes)
  await app.register(llmSuggestDescriptionRoutes)
  await app.register(characterPortraitApprovalRoutes)
  if (hasCredits()) await app.register(characterTrainingRoutes)
  if (hasCredits()) await app.register(replicateTrainingWebhookRoutes)
  await app.register(webScrapeRoutes)
  await app.register(reduceRoutes)
  await app.register(downloadRoutes)
  await app.register(renderVideoRoutes)
  await app.register(sceneGraphAIRoutes)
  await app.register(afterEffectsAIRoutes)
  await app.register(lottieOverlayAIRoutes)
  await app.register(threeDTitleAIRoutes)
  await app.register(motionGraphicsAIRoutes)
  await app.register(audioIsolationRoutes)
  await app.register(audioSeparationRoutes)
  await app.register(textToDialogueRoutes)
  await app.register(imageToTextRoutes)
  await app.register(describeToPickerRoutes)
  await app.register(textToPickerRoutes)
  await app.register(shotsRoutes)
  await app.register(modelsRoutes)
  await app.register(voicesRoutes)
  await app.register(heygenCatalogRoutes)
  await app.register(voiceCloneRoutes)
  await app.register(voiceChangerRoutes)
  await app.register(dubbingRoutes)
  await app.register(voiceRemixRoutes)
  await app.register(voiceDesignRoutes)
  await app.register(forcedAlignmentRoutes)
  await app.register(shotSequenceRoutes)
  await app.register(videoDirectorRoutes)
  await app.register(subWorkflowRoutes)
  await app.register(workflowExecutionRoutes)
  await app.register(webhookTriggerRoutes)
  await app.register(pipelinesRoutes)
  await app.register(sceneHelpersRoutes)
  await app.register(extendVideoRoutes)
  await app.register(videoRetakeRoutes)
  await app.register(speechToVideoRoutes)
  await app.register(aiAvatarRoutes)
  await app.register(switchXRoutes)
  await app.register(cinematicAvatarRoutes)
  await app.register(socialMediaFormatRoutes)
  await app.register(webhookOutputRoutes)
  await app.register(presentationRoutes)
  await app.register(apiTokenRoutes)
  await app.register(socialAuthRoutes)
  // Community cloud-connect, instance side (Phase 4a): self-hosted editions
  // connect to Nodaro Cloud as a provider. Meaningless on cloud itself.
  if (!isCloud()) await app.register(nodaroConnectRoutes)
  await app.register(metaCallbackRoutes)
  await app.register(socialPublishRoutes)
  await app.register(scheduledPostsRoutes)
  await app.register(telegramWebhookRoutes)
  await app.register(telegramChannelRoutes)
  await app.register(publishedAppsRoutes)
  await app.register(workflowTemplatesRoutes)
  await app.register(appRunnerRoutes)
  await app.register(componentExecuteRoutes)
  await app.register(ogTagsRoutes)
  await app.register(appAnalyticsRoutes)
  if (hasCredits()) await app.register(monetizationRoutes)
  if (hasCredits()) await app.register(freecutExportRoutes)
  // Cloud-only proprietary features (e.g. voice-changer-pro), loaded from the
  // private @nodaroai/cloud-plugins package. No-op on community/business
  // (hasCredits() false); on cloud, a load failure is fatal (process.exit(1)
  // inside the loader) unless PRIVATE_MODULES=optional. See
  // backend/src/lib/private-plugins/load.ts.
  await loadPrivatePlugins({ app })
  await app.register(embedRoutes)
  await app.register(qaCheckRoutes)
  await app.register(imageCriticRoutes)
  await app.register(saveToStorageRoutes)
  await app.register(promptHelperRoutes)
  if (hasAdmin()) await app.register(adminLlmModelsRoutes)
  await app.register(nodeDefaultsRoutes)
  await app.register(nodesRoutes)
  await app.register(pickerCatalogsRoutes)
  await app.register(catalogsRoutes)
  await app.register(oauthRoutes)
  await registerOauthRegister(app)
  await registerWellKnown(app)
  await registerMcpRoute(app)
  if (hasAdmin()) await app.register(adminNodeDefaultsRoutes)
  await app.register(tutorialsRoutes)
  if (hasAdmin()) await app.register(adminTutorialsRoutes)
  if (hasAdmin()) await app.register(adminTutorialCategoriesRoutes)
  if (hasAdmin()) await app.register(adminClientAppsRoutes)
  await app.register(onboardingRoutes)
  // Self-host install health screen — deliberately NOT registered on cloud
  // (operators there have the admin panel; no reason to expose config-presence
  // booleans on a public SaaS endpoint).
  if (!isCloud()) await app.register(setupStatusRoutes)
  await app.register(versionRoutes)
  // 4b: the Nodaro-exclusive nodes' relay routes. ONLY when the private
  // plugin lane is absent — on cloud @nodaroai/cloud-plugins registers the
  // SAME wire paths and a double registration is a Fastify boot crash.
  if (!hasCredits()) await app.register(nodaroExclusiveRoutes)
  // The paste field behind the Install-health tiles — self-host only, same
  // reasoning as setup-status; on Cloud provider keys are platform config.
  if (!isCloud()) await app.register(providerKeysRoutes)
  await app.register(openapiRoutes)

  return app
}
