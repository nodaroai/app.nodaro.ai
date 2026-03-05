import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"

export const youtubePublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest): Promise<PublishResult> {
    const { action, caption, mediaUrl, title, description, tags, privacy } = request

    // Download the video first to get its content
    const videoRes = await fetch(mediaUrl!)
    if (!videoRes.ok) throw new Error("Failed to download video for YouTube upload")
    const videoBlob = await videoRes.blob()

    const isShort = action === "upload-short"
    const videoTitle = title || caption?.slice(0, 100) || "Untitled"
    const videoDescription = description || caption || ""

    // YouTube resumable upload
    const metadataBody = {
      snippet: {
        title: isShort ? `#Shorts ${videoTitle}` : videoTitle,
        description: videoDescription,
        tags: tags || [],
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: privacy || "private",
        selfDeclaredMadeForKids: false,
      },
    }

    // Step 1: Initiate resumable upload
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/*",
          "X-Upload-Content-Length": String(videoBlob.size),
        },
        body: JSON.stringify(metadataBody),
      },
    )

    if (!initRes.ok) {
      const err = await initRes.text()
      throw new Error(`YouTube upload init failed: ${err}`)
    }

    const uploadUrl = initRes.headers.get("Location")
    if (!uploadUrl) throw new Error("YouTube did not return upload URL")

    // Step 2: Upload video content
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/*",
        "Content-Length": String(videoBlob.size),
      },
      body: videoBlob,
    })

    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      throw new Error(`YouTube upload failed: ${err}`)
    }

    const uploadData = await uploadRes.json() as { id: string }

    return {
      success: true,
      platformPostId: uploadData.id,
      platformPostUrl: `https://www.youtube.com/watch?v=${uploadData.id}`,
    }
  },
}
