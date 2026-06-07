import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import { safeFetch } from "../../../lib/safe-fetch.js"

export const xPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest): Promise<PublishResult> {
    const { caption, mediaUrl } = request

    let mediaId: string | undefined

    // Upload media if present
    if (mediaUrl) {
      // Download media. safeFetch: mediaUrl is user-supplied — block SSRF to
      // internal/metadata hosts (validated again at connect time for DNS-rebind).
      const mediaRes = await safeFetch(mediaUrl)
      if (!mediaRes.ok) throw new Error("Failed to download media for X")
      const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer())
      const contentType = mediaRes.headers.get("content-type") || "image/jpeg"
      const isVideo = contentType.startsWith("video/")

      if (isVideo) {
        // X v1.1 chunked upload for video
        // Step 1: INIT
        const initRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            command: "INIT",
            total_bytes: String(mediaBuffer.length),
            media_type: contentType,
            media_category: "tweet_video",
          }).toString(),
        })
        if (!initRes.ok) throw new Error(`X media INIT failed: ${await initRes.text()}`)
        const initData = await initRes.json() as { media_id_string: string }
        mediaId = initData.media_id_string

        // Step 2: APPEND (single chunk for simplicity)
        const formData = new FormData()
        formData.append("command", "APPEND")
        formData.append("media_id", mediaId)
        formData.append("segment_index", "0")
        formData.append("media_data", mediaBuffer.toString("base64"))

        const appendRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        if (!appendRes.ok) throw new Error(`X media APPEND failed`)

        // Step 3: FINALIZE
        const finalRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            command: "FINALIZE",
            media_id: mediaId,
          }).toString(),
        })
        if (!finalRes.ok) throw new Error(`X media FINALIZE failed`)

        // Wait for processing
        let processing = true
        let attempts = 0
        while (processing && attempts < 60) {
          const statusRes = await fetch(
            `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          )
          const statusData = await statusRes.json() as { processing_info?: { state: string; check_after_secs?: number } }
          if (!statusData.processing_info || statusData.processing_info.state === "succeeded") {
            processing = false
          } else if (statusData.processing_info.state === "failed") {
            throw new Error("X video processing failed")
          } else {
            await new Promise((r) => setTimeout(r, (statusData.processing_info?.check_after_secs ?? 5) * 1000))
          }
          attempts++
        }
      } else {
        // Image upload (simpler)
        const formData = new FormData()
        formData.append("media_data", mediaBuffer.toString("base64"))

        const uploadRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        if (!uploadRes.ok) throw new Error(`X image upload failed: ${await uploadRes.text()}`)
        const uploadData = await uploadRes.json() as { media_id_string: string }
        mediaId = uploadData.media_id_string
      }
    }

    // Create tweet
    const tweetBody: Record<string, unknown> = {
      text: caption || "",
    }
    if (mediaId) {
      tweetBody.media = { media_ids: [mediaId] }
    }

    const tweetRes = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tweetBody),
    })

    if (!tweetRes.ok) {
      const err = await tweetRes.text()
      throw new Error(`X tweet failed: ${err}`)
    }

    const tweetData = await tweetRes.json() as { data: { id: string } }
    return {
      success: true,
      platformPostId: tweetData.data.id,
      platformPostUrl: `https://x.com/i/status/${tweetData.data.id}`,
    }
  },
}
