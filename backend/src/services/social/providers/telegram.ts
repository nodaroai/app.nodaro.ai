import { telegramPublisher } from "../platforms/telegram.js"
import type { SocialProvider } from "./types.js"

/**
 * Telegram connects via a user-supplied bot token
 * (`POST /v1/social/telegram/connect`), not OAuth — deliberately different
 * from Postiz's global-bot model so self-hosted deployments need no bot infra.
 */
export const telegramProvider: SocialProvider = {
  id: "telegram",
  label: "Telegram",
  connectKind: "bot_token",
  editor: "html", // captions support parseMode Markdown/HTML
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video", "text"],
    refresh: "none", // bot tokens don't expire
  },
  requiredEnv: [],
  publisher: telegramPublisher,
}
