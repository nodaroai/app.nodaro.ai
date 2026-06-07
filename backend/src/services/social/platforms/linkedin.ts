import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import { safeFetch } from "../../../lib/safe-fetch.js"

export const linkedinPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
    const personUrn = metadata.person_urn as string
    if (!personUrn) throw new Error("LinkedIn person URN not found in connection metadata")

    const { action, caption, mediaUrl } = request

    if (action === "post-text") {
      const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author: personUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: caption || "" },
              shareMediaCategory: "NONE",
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`LinkedIn post failed: ${err}`)
      }

      const data = await res.json() as { id: string }
      return { success: true, platformPostId: data.id }
    }

    if (action === "post-image" || action === "post-video") {
      // Step 1: Register upload
      const mediaType = action === "post-image" ? "image" : "video"
      const registerRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: [mediaType === "image"
              ? "urn:li:digitalmediaRecipe:feedshare-image"
              : "urn:li:digitalmediaRecipe:feedshare-video"],
            owner: personUrn,
          },
        }),
      })

      if (!registerRes.ok) {
        const err = await registerRes.text()
        throw new Error(`LinkedIn register upload failed: ${err}`)
      }

      const registerData = await registerRes.json() as {
        value: {
          uploadMechanism: {
            "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: string }
          }
          asset: string
        }
      }

      const uploadUrl = registerData.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl
      const asset = registerData.value.asset

      // Step 2: Upload media. safeFetch: mediaUrl is user-supplied — block SSRF
      // to internal/metadata hosts (re-validated at connect time for DNS-rebind).
      const mediaResponse = await safeFetch(mediaUrl!)
      if (!mediaResponse.ok) throw new Error("Failed to download media for LinkedIn")
      const mediaBlob = await mediaResponse.blob()

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: mediaBlob,
      })

      if (!uploadRes.ok) throw new Error("LinkedIn media upload failed")

      // Step 3: Create post with media
      const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author: personUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: caption || "" },
              shareMediaCategory: mediaType === "image" ? "IMAGE" : "VIDEO",
              media: [{
                status: "READY",
                media: asset,
              }],
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      })

      if (!postRes.ok) {
        const err = await postRes.text()
        throw new Error(`LinkedIn post with media failed: ${err}`)
      }

      const postData = await postRes.json() as { id: string }
      return { success: true, platformPostId: postData.id }
    }

    throw new Error(`Unsupported LinkedIn action: ${action}`)
  },
}
