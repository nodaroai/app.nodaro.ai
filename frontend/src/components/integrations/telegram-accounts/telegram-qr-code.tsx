import { useEffect, useState } from "react"
import QRCode from "qrcode"

const SIZE = 232

/**
 * The login token as a QR code. Always dark-on-white with a quiet zone,
 * whatever the theme: a phone camera reads contrast, not the app's palette.
 * Re-rendered only when the URL changes — the server hands out a new token
 * about every half minute, and the image must follow it.
 */
export function TelegramQrCode({ loginUrl, alt }: { loginUrl: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    QRCode.toDataURL(loginUrl, { margin: 2, width: SIZE, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => {
        if (live) setSrc(url)
      })
      .catch(() => {
        if (live) setSrc(null)
      })
    return () => {
      live = false
    }
  }, [loginUrl])

  return src ? (
    <img src={src} alt={alt} width={SIZE} height={SIZE} className="rounded-lg border bg-white" />
  ) : (
    <div role="img" aria-label={alt} className="animate-pulse rounded-lg bg-muted" style={{ width: SIZE, height: SIZE }} />
  )
}
