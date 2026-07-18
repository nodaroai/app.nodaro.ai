import { blueskyPublisher, createBlueskySession } from "../platforms/bluesky.js"
import type { SocialProvider } from "./types.js"

export const blueskyProvider: SocialProvider = {
  id: "bluesky",
  label: "Bluesky",
  connectKind: "custom_fields",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "text"],
    refresh: "none", // app passwords don't expire; sessions are created per publish
  },
  requiredEnv: [],
  maxConcurrentJob: 2,
  customFields: () => [
    {
      key: "service",
      label: "Service",
      type: "text",
      defaultValue: "https://bsky.social",
      validation: "^https?://.+",
    },
    { key: "identifier", label: "Handle or email", type: "text", validation: "^.{3,}$" },
    {
      key: "password",
      label: "App password",
      type: "password",
      hint: "Create one in Bluesky: Settings → App Passwords",
      validation: "^.{8,}$",
    },
  ],
  async connectWithFields(fields) {
    const service = (fields.service || "https://bsky.social").replace(/\/+$/, "")
    const session = await createBlueskySession(service, fields.identifier ?? "", fields.password ?? "")
    return {
      userInfo: {
        id: session.did,
        username: `@${session.handle}`,
        metadata: { service, identifier: fields.identifier, did: session.did },
      },
      accessToken: fields.password ?? "",
    }
  },
  publisher: blueskyPublisher,
}
