"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Loader2, Unlink, Plus, Instagram, Video, Youtube, Linkedin, Twitter, Facebook, Send } from "lucide-react"
import { getSocialAuthUrl, disconnectSocial, connectTelegram } from "@/lib/api"
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
  telegram: <Send className="h-6 w-6" />,
}

const PLATFORM_DESCRIPTIONS: Record<SocialPlatformType, string> = {
  instagram: "Post images, reels, and stories (uses Facebook Login)",
  tiktok: "Upload videos directly",
  youtube: "Upload videos and shorts",
  linkedin: "Share posts with text, images, or video",
  x: "Post tweets with media",
  facebook: "Post to your page",
  telegram: "Send messages to channels and chats",
}

interface PlatformCardProps {
  readonly platform: SocialPlatformType
  readonly connections: readonly SocialConnection[]
  readonly onConnectionChange: () => void
  readonly comingSoon?: boolean
}

export function PlatformCard({ platform, connections, onConnectionChange, comingSoon }: PlatformCardProps) {
  const [connecting, setConnecting] = useState(false)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false)
  const [botToken, setBotToken] = useState("")
  const [telegramConnecting, setTelegramConnecting] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)

  const handleConnect = useCallback(async () => {
    if (platform === "telegram") {
      setTelegramDialogOpen(true)
      return
    }

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

  const handleTelegramConnect = useCallback(async () => {
    setTelegramError(null)
    setTelegramConnecting(true)
    try {
      await connectTelegram(botToken)
      toast.success("Connected to Telegram!")
      setTelegramDialogOpen(false)
      setBotToken("")
      onConnectionChange()
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : "Failed to connect bot")
    } finally {
      setTelegramConnecting(false)
    }
  }, [botToken, onConnectionChange])

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4 relative${comingSoon ? " opacity-60" : ""}`}>
      {comingSoon && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#333] text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Coming Soon
        </div>
      )}
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
      {!comingSoon && connections.length > 0 && (
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
        disabled={connecting || comingSoon}
        variant={connections.length > 0 && !comingSoon ? "outline" : "default"}
        className={comingSoon
          ? "w-full bg-gray-200 dark:bg-[#333] text-gray-400 dark:text-gray-500 cursor-not-allowed"
          : connections.length > 0
            ? "w-full"
            : "w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
        }
      >
        {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {comingSoon ? (
          "Coming Soon"
        ) : connections.length > 0 ? (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Add another account
          </>
        ) : (
          "Connect"
        )}
      </Button>

      <Dialog open={telegramDialogOpen} onOpenChange={(open) => {
        setTelegramDialogOpen(open)
        if (!open) {
          setBotToken("")
          setTelegramError(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Telegram Bot</DialogTitle>
            <DialogDescription>
              Create a bot via @BotFather on Telegram, then paste the bot token below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={telegramConnecting}
            />
            {telegramError && (
              <p className="text-sm text-red-500 dark:text-red-400">{telegramError}</p>
            )}
            <Button
              onClick={handleTelegramConnect}
              disabled={telegramConnecting || !botToken.trim()}
              className="w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
            >
              {telegramConnecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Connect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
