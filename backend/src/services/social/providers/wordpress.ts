import { fetchWordpressUser, wordpressPublisher } from "../platforms/wordpress.js"
import type { SocialProvider } from "./types.js"

export const wordpressProvider: SocialProvider = {
  id: "wordpress",
  label: "WordPress",
  connectKind: "custom_fields",
  editor: "html",
  capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "none" },
  requiredEnv: [],
  customFields: () => [
    {
      key: "domain",
      label: "Site URL",
      type: "text",
      hint: "e.g. https://myblog.com",
      validation: "^https?://.+",
    },
    { key: "username", label: "Username", type: "text", validation: "^.{2,}$" },
    {
      key: "password",
      label: "Application password",
      type: "password",
      hint: "WP Admin → Users → Profile → Application Passwords",
      validation: "^.{8,}$",
    },
  ],
  async connectWithFields(fields) {
    const domain = (fields.domain ?? "").replace(/\/+$/, "")
    const user = await fetchWordpressUser(domain, fields.username ?? "", fields.password ?? "")
    return {
      userInfo: {
        id: `${new URL(domain).hostname}:${user.id}`,
        username: user.username,
        metadata: { domain, username: fields.username },
      },
      accessToken: fields.password ?? "",
    }
  },
  publisher: wordpressPublisher,
}
