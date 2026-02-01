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

export async function buildApp() {
  const app = Fastify({ logger: true })

  await app.register(cors, { origin: true })

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

  return app
}
