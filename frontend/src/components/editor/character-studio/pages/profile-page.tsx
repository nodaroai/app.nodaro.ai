import { useContext, useState } from "react"
import { Link as LinkIcon, Maximize2 } from "lucide-react"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { copyToClipboard } from "@/lib/utils"
import { optimizedImageUrl } from "@/lib/image"
import { MultiImageLightbox } from "@/components/ui/multi-image-lightbox"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "../expressions-tab"
import { PortraitCandidateGrid } from "../portrait-candidate-grid"
import { PreviousCandidatesStrip } from "../previous-candidates-strip"
import { CanonicalDescriptionExpander } from "../canonical-description-expander"
import { SeedPromptTextarea } from "../seed-prompt-textarea"
import { PortraitCandidatesContext } from "../portrait-candidates-context"

/**
 * Profile page — the character's portrait + base-identity form controls (name,
 * description, gender, style, base outfit, reference-image URL, provider, seed
 * prompt). Split out of the old `appearance-tab.tsx`; the Head/Body Angles +
 * Lighting reference-image sub-sections now live on the Appearance page, and
 * the reference-photo uploader lives on the References page.
 *
 * Presentational for the portrait grid/approve flow: the multi-candidate state
 * + polling now lives at MODAL scope (`usePortraitCandidates`, provided via
 * `PortraitCandidatesContext`) so in-flight candidates survive
 * Profile↔Appearance navigation. The identity form fields below still read/write
 * `state` directly.
 */
export function ProfilePage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const portrait = useContext(PortraitCandidatesContext)
  if (!portrait) {
    throw new Error("ProfilePage must render within a PortraitCandidatesContext provider")
  }
  const [portraitLightboxOpen, setPortraitLightboxOpen] = useState(false)
  const s = state.staged
  const portraitProvider = s.provider ?? DEFAULT_IMAGE_MODEL
  const portraitCost = useModelCredits(portraitProvider, 0)

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div className="space-y-2.5">
        <div className="text-[9px] uppercase tracking-wide text-slate-500">Portrait</div>
        {s.sourceImageUrl ? (
          <ApprovedPortrait
            url={s.sourceImageUrl}
            onEnlarge={() => setPortraitLightboxOpen(true)}
          />
        ) : (
          <div className="w-40 h-52 rounded-md border border-dashed border-[#334155] flex items-center justify-center text-[10px] text-slate-500">
            generate a portrait below
          </div>
        )}

        <PortraitCandidateGrid
          characterId={s.characterDbId ?? ""}
          candidates={portrait.candidates}
          onGenerate={(count) => void portrait.generate(count)}
          onApprove={(jobId) => void portrait.approve(jobId)}
          onCancelCandidate={portrait.cancelCandidate}
          cost={portraitCost}
          busy={portrait.busy}
        />

        <PreviousCandidatesStrip
          candidates={portrait.previousCandidates}
          onReApprove={(jobId) => void portrait.approve(jobId)}
        />

        {s.characterDbId && (
          <CanonicalDescriptionExpander
            characterId={s.characterDbId}
            value={s.canonicalDescription ?? ""}
            onChange={(next) => state.patch({ canonicalDescription: next })}
          />
        )}

        <NameInput
          name={s.characterName}
          onChange={(v) => state.patch({ characterName: v })}
        />
        <textarea
          value={s.description}
          onChange={(e) => state.patch({ description: e.target.value })}
          placeholder="Appearance description"
          rows={3}
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <div className="flex gap-2 max-w-sm">
          <select
            value={s.gender}
            onChange={(e) => state.patch({ gender: e.target.value as typeof s.gender })}
            className="text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          >
            <option value="male">male</option>
            <option value="female">female</option>
            <option value="other">other</option>
          </select>
          <select
            value={s.style}
            onChange={(e) => state.patch({ style: e.target.value as typeof s.style })}
            className="text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          >
            <option value="realistic">realistic</option>
            <option value="anime">anime</option>
            <option value="3d-pixar">3d-pixar</option>
            <option value="illustration">illustration</option>
          </select>
        </div>
        <input
          value={s.baseOutfit}
          onChange={(e) => state.patch({ baseOutfit: e.target.value })}
          placeholder="Base outfit"
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <input
          value={s.sourceImageUrl}
          onChange={(e) => state.patch({ sourceImageUrl: e.target.value })}
          placeholder="Reference image URL (optional)"
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <select
          value={portraitProvider}
          onChange={(e) => state.patch({ provider: e.target.value })}
          className="block text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <SeedPromptTextarea
          value={s.seedPrompt ?? ""}
          onChange={(next) => state.patch({ seedPrompt: next })}
          suggestContext={{
            referencePhotos: s.referencePhotos,
            gender: s.gender,
            style: s.style,
            baseOutfit: s.baseOutfit,
          }}
        />
      </div>

      {/* Portrait lightbox — single-image set. Angles and Lighting (now on the
          Appearance page) render their own lightboxes via ImageAssetTab. */}
      <MultiImageLightbox
        items={s.sourceImageUrl ? [{ url: s.sourceImageUrl, alt: "Portrait" }] : []}
        startIndex={portraitLightboxOpen && s.sourceImageUrl ? 0 : null}
        onClose={() => setPortraitLightboxOpen(false)}
      />
    </div>
  )
}

/**
 * Approved-portrait tile with hover overlay (Enlarge + Copy URL). Extracted as
 * its own component for clarity now that the portrait section also renders the
 * candidate grid + previous-candidates strip below.
 */
function ApprovedPortrait({ url, onEnlarge }: { url: string; onEnlarge: () => void }) {
  return (
    <div className="relative w-40 h-52 group">
      <img
        src={optimizedImageUrl(url, { width: 800 })}
        alt="portrait"
        className="w-full h-full object-cover rounded-md border border-[#334155]"
      />
      <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label="Enlarge"
          title="Enlarge"
          className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={onEnlarge}
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        <button
          type="button"
          aria-label="Copy URL"
          title="Copy URL"
          className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={() => copyToClipboard(url, "URL copied")}
        >
          <LinkIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

/**
 * Name input with a rename cue when the character is using the auto-assigned
 * placeholder. The input renders the placeholder name in dimmed text + shows
 * a "↻ Click to rename" microcopy beneath; once the user starts typing, the
 * field switches to normal styling. The actual value is cleared from the
 * input visually when it matches the placeholder so users see an empty field
 * to type into (the placeholder string remains in state — that's what flows
 * to the DB and prompts).
 */
function NameInput({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const isPlaceholder = name === PLACEHOLDER_CHARACTER_NAME
  return (
    <div className="space-y-1 max-w-sm">
      <input
        value={isPlaceholder ? "" : name}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isPlaceholder ? `${PLACEHOLDER_CHARACTER_NAME} — click to rename` : "Character name"}
        className={`block w-full text-[11px] bg-[#13161f] border rounded px-2 py-1 text-slate-200 ${
          isPlaceholder ? "border-[#3b82f644] placeholder:text-[#3b82f699]" : "border-[#334155]"
        }`}
      />
      {isPlaceholder && (
        <div className="text-[9px] text-[#3b82f699]">↻ Give your character a name — it'll also clean up the gallery.</div>
      )}
    </div>
  )
}
