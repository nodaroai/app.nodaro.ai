import Fastify from "fastify"
import cors from "@fastify/cors"
import { healthRoutes } from "./routes/health.js"
import { projectRoutes } from "./routes/projects.js"
import { workflowRoutes } from "./routes/workflows.js"
import { jobRoutes } from "./routes/jobs.js"
import { renderRoutes } from "./routes/render.js"
import { generateImageRoutes } from "./routes/generate-image.js"
import { generateVideoRoutes } from "./routes/generate-video.js"
import { videoToVideoRoutes } from "./routes/video-to-video.js"
import { textToVideoRoutes } from "./routes/text-to-video.js"
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
import { extractYouTubeAudioRoutes } from "./routes/extract-youtube-audio.js"
import { textToAudioRoutes } from "./routes/text-to-audio.js"
import { imageProxyRoutes } from "./routes/image-proxy.js"
import { generateCharacterRoutes } from "./routes/generate-character.js"
import { generateCharacterAssetRoutes } from "./routes/generate-character-asset.js"
import { splitImageRoutes } from "./routes/split-image.js"
import { characterRoutes } from "./routes/characters.js"
import { objectRoutes } from "./routes/objects.js"
import { generateObjectAssetRoutes } from "./routes/generate-object-asset.js"
import { generateObjectRoutes } from "./routes/generate-object.js"
import { locationRoutes } from "./routes/locations.js"
import { generateLocationRoutes } from "./routes/generate-location.js"
import { generateLocationAssetRoutes } from "./routes/generate-location-asset.js"
import { predictionsRoutes } from "./routes/predictions.js"

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })

  await app.register(healthRoutes)
  await app.register(projectRoutes)
  await app.register(workflowRoutes)
  await app.register(jobRoutes)
  await app.register(renderRoutes)
  await app.register(generateImageRoutes)
  await app.register(generateVideoRoutes)
  await app.register(videoToVideoRoutes)
  await app.register(textToVideoRoutes)
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
  await app.register(extractYouTubeAudioRoutes)
  await app.register(textToAudioRoutes)
  await app.register(imageProxyRoutes)
  await app.register(generateCharacterRoutes)
  await app.register(generateCharacterAssetRoutes)
  await app.register(splitImageRoutes)
  await app.register(characterRoutes)
  await app.register(objectRoutes)
  await app.register(generateObjectAssetRoutes)
  await app.register(generateObjectRoutes)
  await app.register(locationRoutes)
  await app.register(generateLocationRoutes)
  await app.register(generateLocationAssetRoutes)
  await app.register(predictionsRoutes)

  return app
}
