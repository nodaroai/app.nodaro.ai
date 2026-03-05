import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, ExternalLink } from "lucide-react"
import type { SocialPostData, SocialPlatformType, SocialConnection } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { getSocialConnections } from "@/lib/api"

const PLATFORM_ACTIONS: Record<SocialPlatformType, Array<{ value: string; label: string }>> = {
  instagram: [
    { value: "post-image", label: "Post Image" },
    { value: "post-reel", label: "Post Reel" },
    { value: "post-story", label: "Post Story" },
    { value: "post-carousel", label: "Post Carousel" },
  ],
  tiktok: [
    { value: "post-video", label: "Post Video" },
  ],
  youtube: [
    { value: "upload-video", label: "Upload Video" },
    { value: "upload-short", label: "Upload Short" },
  ],
  linkedin: [
    { value: "post-text", label: "Post Text" },
    { value: "post-image", label: "Post Image" },
    { value: "post-video", label: "Post Video" },
  ],
  x: [
    { value: "post-tweet", label: "Post Tweet" },
  ],
  facebook: [
    { value: "post-text", label: "Post Text" },
    { value: "post-image", label: "Post Image" },
    { value: "post-video", label: "Post Video" },
    { value: "post-story", label: "Post Story" },
  ],
}

const CAPTION_LIMITS: Record<SocialPlatformType, number> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  linkedin: 3000,
  x: 280,
  facebook: 63206,
}

function useSocialConnections(platform: SocialPlatformType) {
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getSocialConnections()
      .then((data) => {
        if (cancelled) return
        setConnections(
          data.connections.filter((c) => c.platform === platform)
        )
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [platform])

  return { connections, loading }
}

function SocialConfigBase({ data, onUpdate, platform }: ConfigProps<SocialPostData> & { platform: SocialPlatformType }) {
  const d = data as SocialPostData
  const { connections, loading } = useSocialConnections(platform)
  const actions = PLATFORM_ACTIONS[platform]
  const charLimit = CAPTION_LIMITS[platform]
  const captionLen = (d.caption || "").length

  // Auto-select first connection if none selected
  useEffect(() => {
    if (!d.connectionId && connections.length > 0) {
      onUpdate({ connectionId: connections[0].id })
    }
  }, [connections, d.connectionId, onUpdate])

  const selectedConnection = connections.find((c) => c.id === d.connectionId)

  return (
    <div className="space-y-4">
      {/* Connection status */}
      {!loading && connections.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-700 dark:text-amber-400">
            <p className="font-medium">Account not connected</p>
            <a href="/integrations" className="underline inline-flex items-center gap-1 mt-1">
              Connect in Integrations <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* Account selector */}
      {!loading && connections.length > 0 && (
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Account</Label>
          <Select
            value={d.connectionId || ""}
            onValueChange={(v) => onUpdate({ connectionId: v })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select account">
                {selectedConnection && (
                  <div className="flex items-center gap-2">
                    {selectedConnection.platform_avatar_url && (
                      <img src={selectedConnection.platform_avatar_url} alt="" className="h-4 w-4 rounded-full" />
                    )}
                    <span>{selectedConnection.display_name || selectedConnection.platform_username || "Connected"}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  <div className="flex items-center gap-2">
                    {conn.platform_avatar_url && (
                      <img src={conn.platform_avatar_url} alt="" className="h-4 w-4 rounded-full" />
                    )}
                    <span>{conn.display_name || conn.platform_username || "Connected"}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Action selector */}
      {actions.length > 1 && (
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Action</Label>
          <Select value={d.action} onValueChange={(v) => onUpdate({ action: v })}>
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Caption */}
      <div>
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
          {platform === "youtube" ? "Description" : "Caption"}
        </Label>
        <Textarea
          value={d.caption || ""}
          onChange={(e) => onUpdate({ caption: e.target.value })}
          placeholder={`Write your ${platform === "x" ? "tweet" : "caption"}...`}
          className="mt-1.5 min-h-[80px]"
          maxLength={charLimit}
        />
        <p className={`text-[10px] mt-1 ${captionLen > charLimit * 0.9 ? "text-amber-500" : "text-muted-foreground"}`}>
          {captionLen}/{charLimit}
        </p>
      </div>

      {/* YouTube-specific fields */}
      {platform === "youtube" && (
        <>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Title</Label>
            <Input
              value={d.title || ""}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="Video title..."
              className="mt-1.5"
              maxLength={100}
            />
          </div>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Tags</Label>
            <Input
              value={(d.tags || []).join(", ")}
              onChange={(e) => onUpdate({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
              placeholder="tag1, tag2, tag3..."
              className="mt-1.5"
            />
          </div>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Privacy</Label>
            <Select value={d.privacy || "private"} onValueChange={(v) => onUpdate({ privacy: v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Published result */}
      {d.executionStatus === "completed" && d.platformPostUrl && (
        <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <a
            href={d.platformPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-700 dark:text-green-400 underline inline-flex items-center gap-1"
          >
            View post <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {d.executionStatus === "failed" && d.errorMessage && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <p className="text-xs text-red-700 dark:text-red-400">{d.errorMessage}</p>
        </div>
      )}
    </div>
  )
}

export function InstagramPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="instagram" />
}

export function TiktokPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="tiktok" />
}

export function YoutubeUploadConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="youtube" />
}

export function LinkedinPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="linkedin" />
}

export function XPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="x" />
}

export function FacebookPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="facebook" />
}
