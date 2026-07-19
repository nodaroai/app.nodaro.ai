import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, ExternalLink } from "lucide-react"
import { TagTextarea } from "./tag-textarea"
import { MappableField } from "./mappable-field"
import type { SocialPostData, SocialPlatformType, SocialConnection } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { getSocialConnections } from "@/lib/api"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"

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
  telegram: [
    { value: "send-message", label: "Send Message" },
    { value: "send-photo", label: "Send Photo" },
    { value: "send-video", label: "Send Video" },
    { value: "send-audio", label: "Send Audio" },
  ],
}

const CAPTION_LIMITS: Record<SocialPlatformType, number> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  linkedin: 3000,
  x: 280,
  facebook: 63206,
  telegram: 4096,
}

/** Pass a platform to filter; pass undefined ("all") to list every account —
 *  the unified Publish-to-Social node uses the all-accounts form. */
export function useSocialConnections(platform?: SocialPlatformType) {
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getSocialConnections()
      .then((data) => {
        if (cancelled) return
        setConnections(
          platform ? data.connections.filter((c) => c.platform === platform) : data.connections
        )
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [platform])

  return { connections, loading }
}

/** First action for a platform. Networks without a defined action list (the
 *  Phase-2 additions: bluesky, reddit, devto, …) publish text+media via
 *  "post-text". */
function defaultActionFor(platform: string): string {
  return PLATFORM_ACTIONS[platform as SocialPlatformType]?.[0]?.value ?? "post-text"
}

/** Human label for any of the 19 networks (falls back to a capitalized id). */
function platformLabel(platform: string): string {
  return (PLATFORM_LABELS as Record<string, string>)[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1)
}

function SocialConfigBase({ data, onUpdate, platform, allAccounts, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SocialPostData> & { platform?: SocialPlatformType; allAccounts?: boolean }) {
  const [chatIdHelpOpen, setChatIdHelpOpen] = useState(false)
  const d = data as SocialPostData
  // Unified node: list ALL accounts and derive the platform from the chosen
  // connection (data.platform). Legacy per-platform nodes: fixed prop platform.
  const { connections, loading } = useSocialConnections(allAccounts ? undefined : platform)
  // For the unified node effectivePlatform can be ANY of the 19 networks (a
  // string), not just the original 7 SocialPlatformType — guard the 7-keyed
  // maps below.
  const effectivePlatform: string | undefined = allAccounts ? d.platform : platform
  const actions = (effectivePlatform && effectivePlatform in PLATFORM_ACTIONS)
    ? PLATFORM_ACTIONS[effectivePlatform as SocialPlatformType]
    : []
  const charLimit = (effectivePlatform && effectivePlatform in CAPTION_LIMITS)
    ? CAPTION_LIMITS[effectivePlatform as SocialPlatformType]
    : 4096
  const captionLen = (d.caption || "").length

  // Auto-select first connection if none selected. For the unified node this
  // also seeds platform + a sensible default action from that connection.
  useEffect(() => {
    if (!d.connectionId && connections.length > 0) {
      const first = connections[0]
      if (allAccounts) {
        onUpdate({ connectionId: first.id, platform: first.platform, action: defaultActionFor(first.platform) })
      } else {
        onUpdate({ connectionId: first.id })
      }
    }
  }, [connections, d.connectionId, onUpdate, allAccounts])

  const selectedConnection = connections.find((c) => c.id === d.connectionId)

  // Unified account change: write connectionId + derived platform + reset the
  // action to that platform's default (the old action may not exist there).
  const onSelectConnection = (id: string) => {
    const conn = connections.find((c) => c.id === id)
    if (allAccounts && conn) {
      onUpdate({ connectionId: id, platform: conn.platform, action: defaultActionFor(conn.platform) })
    } else {
      onUpdate({ connectionId: id })
    }
  }

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
            onValueChange={onSelectConnection}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select account">
                {selectedConnection && (
                  <div className="flex items-center gap-2">
                    {selectedConnection.platform_avatar_url && (
                      <img src={selectedConnection.platform_avatar_url} alt="" className="h-4 w-4 rounded-full" />
                    )}
                    <span>{selectedConnection.display_name || selectedConnection.platform_username || "Connected"}</span>
                    {allAccounts && <span className="text-[10px] text-muted-foreground">· {platformLabel(selectedConnection.platform)}</span>}
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
                    {allAccounts && <span className="text-[10px] text-muted-foreground">· {platformLabel(conn.platform)}</span>}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Action selector (hidden for Telegram — auto-detected from connected media) */}
      {actions.length > 1 && effectivePlatform !== "telegram" && (
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

      {/* Telegram-specific: Chat ID (required — a bot can sit in many chats,
          so every send needs an explicit target) */}
      {effectivePlatform === "telegram" && (
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            Chat ID <span className="text-red-500">*</span>
          </Label>
          <Input
            value={d.chatId || ""}
            onChange={(e) => onUpdate({ chatId: e.target.value })}
            placeholder="@channelname or -100..."
            className={`mt-1.5${(d.chatId || "").trim() ? "" : " border-red-400 dark:border-red-500 focus-visible:ring-red-400"}`}
          />
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className={`text-[10px] ${(d.chatId || "").trim() ? "text-muted-foreground" : "text-red-500 dark:text-red-400"}`}>
              {(d.chatId || "").trim()
                ? "Channel: @username or -100xxx. Group/DM: numeric ID."
                : "Required — e.g. @yourchannel."}
            </p>
            <button
              type="button"
              onClick={() => setChatIdHelpOpen((v) => !v)}
              className="text-[10px] text-[#ff0073] hover:text-[#e0005f] underline underline-offset-2 shrink-0"
            >
              How to find your Chat ID
            </button>
          </div>
          {chatIdHelpOpen && (
            <div className="mt-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#252525] p-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 space-y-2">
              <p>
                <b>Public channel:</b> use its <code>@username</code> — the part after{" "}
                <code>t.me/</code>. Example: <code>t.me/mychannel</code> → <code>@mychannel</code>.
              </p>
              <p>
                <b>Private channel / group:</b> you need the numeric <code>-100…</code> id. Add
                your bot to the chat, post any message there, then open{" "}
                <code className="break-all">api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> in
                a browser and copy <code>"chat":&#123;"id":-100…&#125;</code>. (Or forward a
                message from the chat to <code>@getidsbot</code>.)
              </p>
              <p className="text-amber-600 dark:text-amber-400">
                Either way, the bot must be added to that channel/group — for channels, as an{" "}
                <b>admin</b> with permission to post.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Caption */}
      <MappableField
        field="caption"
        label={effectivePlatform === "youtube" ? "Description" : "Caption"}
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <TagTextarea
          value={d.caption || ""}
          onChange={(v) => onUpdate({ caption: v })}
          placeholder={`Write your ${platform === "x" ? "tweet" : "caption"}...`}
          className="min-h-[80px]"
          maxLength={charLimit}
          rows={3}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className={`text-[10px] mt-1 ${captionLen > charLimit * 0.9 ? "text-amber-500" : "text-muted-foreground"}`}>
          {captionLen}/{charLimit}
        </p>
      </MappableField>

      {/* YouTube-specific fields */}
      {effectivePlatform === "youtube" && (
        <>
          <MappableField
            field="title"
            label="Title"
            sources={sources}
            fieldMappings={fieldMappings}
            onMapField={onMapField}
          >
            <TagTextarea
              value={d.title || ""}
              onChange={(v) => onUpdate({ title: v })}
              placeholder="Video title..."
              className="mt-1.5"
              maxLength={100}
              rows={1}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
            />
          </MappableField>
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

export function TelegramPostConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} platform="telegram" />
}

/** Unified node — one account picker across ALL connected networks; the
 *  platform follows the chosen connection. */
export function PublishSocialConfig(props: ConfigProps<SocialPostData>) {
  return <SocialConfigBase {...props} allAccounts />
}
