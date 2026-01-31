import { config } from "./lib/config.js"
import { buildApp } from "./app.js"

async function main() {
  const app = await buildApp()

  await app.listen({ port: config.PORT, host: config.HOST })
}

main().catch((err) => {
  console.error("Failed to start server:", err)
  process.exit(1)
})
