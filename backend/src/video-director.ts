/**
 * Video-director worker entry point.
 *
 * Starts the "video-director" BullMQ worker as a standalone process
 * alongside the server, video-worker, orchestrator, and render-worker.
 *
 * In production with Railway the worker is typically started in-process
 * via server.ts (gated by hasCredits()). This standalone entrypoint is
 * for deployments that want to run the director worker in its own container
 * — analogous to orchestrator.ts / render-worker.ts.
 *
 * Usage:
 *   npx tsx src/video-director.ts
 *
 * Note: buildApp() + app.ready() registers all Fastify routes so that
 * defaultDirectorDeps can use fastify.inject() for internal RPC calls
 * (TTS, forced-alignment, render-video/plan) without an HTTP round-trip.
 * The app does NOT call app.listen() — we don't expose an HTTP server here.
 */

import { buildApp } from "./app.js"
import { createVideoDirectorWorker } from "./workers/video-director-worker.js"

process.on("unhandledRejection", (err) => {
  console.error("[video-director] Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("[video-director] Uncaught exception:", err)
  process.exit(1)
})

// Build the Fastify app so all routes are registered for fastify.inject().
// Do NOT call app.listen() — this process is a worker, not an HTTP server.
const app = await buildApp()
await app.ready()

const worker = createVideoDirectorWorker(app)

console.log("[video-director] Worker started, waiting for director jobs...")

// Graceful shutdown
const shutdown = async () => {
  console.log("[video-director] Shutting down...")
  await worker.close()
  await app.close()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
