"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Unlink, Plus, Instagram, Video, Youtube, Linkedin, Twitter, Facebook } from "lucide-react"
import { getSocialAuthUrl, disconnectSocial } from "@/lib/api"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"
import { toast } from "sonner"
import type { SocialPlatformType, SocialConnection } from "@/types/nodes"

const PLATFORM_ICONS: Record<SocialPlatformType, React.ReactNode> = {
  instagram: <Instagram className="h-6 w-6" />,
  tiktok: <Video className="h-6 w-6" />,
  youtube: <Youtube className="h-6 w-6" />,
  linkedin: <Linkedin className="h-6 w-6" />,
  x: <Twitter className="h-6 w-6" />,
  facebook: <Facebook className="h-6 w-6" />,
}

const PLATFORM_DESCRIPTIONS: Record<SocialPlatformType, string> = {
  instagram: "Post images, reels, and stories (uses Facebook Login)",
  tiktok: "Upload videos directly",
  youtube: "Upload videos and shorts",
  linkedin: "Share posts with text, images, or video",
  x: "Post tweets with media",
  facebook: "Post to your page",
}

interface PlatformCardProps {
  readonly platform: SocialPlatformType
  readonly connections: readonly SocialConnection[]
  readonly onConnectionChange: () => void
}

export function PlatformCard({ platform, connections, onConnectionChange }: PlatformCardProps) {
  const [connecting, setConnecting] = useState(false)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    try {
      const { url } = await getSocialAuthUrl(platform)
      const popup = window.open(url, `social-auth-${platform}`, "width=600,height=700,scrollbars=yes")

      let interval: ReturnType<typeof setInterval>
      const cleanup = () => {
        clearInterval(interval)
        window.removeEventListener("message", handler)
      }
      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        if (e.data?.type === "social-auth-success" && e.data.platform === platform) {
          cleanup()
          toast.success(`Connected to ${PLATFORM_LABELS[platform]}!`)
          onConnectionChange()
          setConnecting(false)
        } else if (e.data?.type === "social-auth-error") {
          cleanup()
          toast.error(e.data.message || "Connection failed")
          setConnecting(false)
        }
      }
      window.addEventListener("message", handler)

      interval = setInterval(() => {
        if (popup?.closed) {
          cleanup()
          setConnecting(false)
          onConnectionChange()
        }
      }, 1000)
    } catch (err) {
      toast.error("Failed to start connection")
      setConnecting(false)
    }
  }, [platform, onConnectionChange])

  const handleDisconnect = useCallback(async (connectionId: string) => {
    setDisconnectingId(connectionId)
    try {
      await disconnectSocial(connectionId)
      toast.success(`Disconnected from ${PLATFORM_LABELS[platform]}`)
      onConnectionChange()
    } catch {
      toast.error("Failed to disconnect")
    } finally {
      setDisconnectingId(null)
    }
  }, [platform, onConnectionChange])

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="text-gray-600 dark:text-gray-400">
          {PLATFORM_ICONS[platform]}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            {PLATFORM_LABELS[platform]}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {PLATFORM_DESCRIPTIONS[platform]}
          </p>
        </div>
      </div>

      {/* Connected accounts */}
      {connections.length > 0 && (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div key={conn.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-[#252525]">
              <div className="flex items-center gap-2 min-w-0">
                {conn.platform_avatar_url && (
                  <img src={conn.platform_avatar_url} alt="" className="h-7 w-7 rounded-full shrink-0" />
                )}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                  {conn.display_name || conn.platform_username || "Connected"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisconnect(conn.id)}
                disabled={disconnectingId === conn.id}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 shrink-0 ml-2"
              >
                {disconnectingId === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add account button */}
      <Button
        onClick={handleConnect}
        disabled={connecting}
        variant={connections.length > 0 ? "outline" : "default"}
        className={connections.length > 0
          ? "w-full"
          : "w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
        }
      >
        {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {connections.length > 0 ? (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Add another account
          </>
        ) : (
          "Connect"
        )}
      </Button>
    </div>
  )
}
