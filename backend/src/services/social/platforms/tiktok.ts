import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"

export const tiktokPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest): Promise<PublishResult> {
    const { caption, mediaUrl } = request

    // Step 1: Initialize upload
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption?.slice(0, 150) || "Posted via Nodaro",
          privacy_level: "SELF_ONLY", // TikTok requires app review for PUBLIC_TO_EVERYONE
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: mediaUrl,
        },
      }),
    })

    if (!initRes.ok) {
      const err = await initRes.text()
      throw new Error(`TikTok publish init failed: ${err}`)
    }

    const initData = await initRes.json() as { data?: { publish_id: string } }
    const publishId = initData.data?.publish_id
    if (!publishId) throw new Error("TikTok did not return a publish_id")

    // Step 2: Check publish status (poll)
    let attempts = 0
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 5000))
      const statusRes = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      })
      const statusData = await statusRes.json() as { data?: { status: string } }
      if (statusData.data?.status === "PUBLISH_COMPLETE") {
        return {
          success: true,
          platformPostId: publishId,
        }
      }
      if (statusData.data?.status === "FAILED") {
        throw new Error("TikTok publish failed")
      }
      attempts++
    }

    throw new Error("TikTok publish timed out")
  },
}
