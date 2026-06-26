/**
 * Required brand attribution for Beeble SwitchX outputs.
 *
 * Per developer.beeble.ai/docs/brand-attribution: any public-facing app using
 * the SwitchX API MUST display a "Powered by SwitchX" logo + text in the primary
 * UI where the output is shown (not burned into the file). On a video result
 * (a complex background) the brand guide calls for the monotone-white logo on a
 * safe area — here a dark backdrop-blur pill, matching the node's other on-video
 * controls. Always visible (not hover-gated) so the attribution is never hidden.
 */
export function SwitchXAttribution({ className }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/45 px-1.5 py-0.5 backdrop-blur-sm ${className ?? ""}`}
      title="Powered by SwitchX · Beeble"
    >
      <span className="text-[9px] font-medium leading-none text-white/70">Powered by</span>
      {/* Black wordmark inverted to monotone white for the dark safe-area pill. */}
      <img src="/switchx-wordmark.png" alt="SwitchX" className="h-2.5 w-auto" style={{ filter: "invert(1)" }} />
    </div>
  )
}
