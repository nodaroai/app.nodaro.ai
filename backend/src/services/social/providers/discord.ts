import { discordPublisher, fetchDiscordUser } from "../platforms/discord.js"
import type { SocialProvider } from "./types.js"

export const discordProvider: SocialProvider = {
  id: "discord",
  label: "Discord",
  connectKind: "oauth2",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["image", "video", "text"], refresh: "real" },
  requiredEnv: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"],
  setupHint: "oauth-flow#discord",
  oauth: {
    authUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/v10/oauth2/token",
    scopes: ["identify", "guilds", "bot"],
    clientId: () => process.env.DISCORD_CLIENT_ID || "",
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET || "",
    decorateAuthParams: (params) => {
      // Send Messages + Embed Links + Attach Files for the installed bot.
      params.set("permissions", "52224")
    },
  },
  fetchUserInfo: fetchDiscordUser,
  publisher: discordPublisher,
}
