"use client";

import { ImageIcon, Video, Upload, FolderOpen, Images, LayoutGrid, GraduationCap, ArrowUpRight, ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { SceneNodeType } from "@/types/nodes";

/**
 * Empty-canvas first-run surface. Shown only when the active Flow page has zero
 * nodes; unmounts the moment the first node exists. Pure presentational — all
 * actions are injected so the host wires them to existing features (addNode,
 * the add-node "Input" panel, the My Library / Media Library modals, the
 * Templates / Tutorials dialogs).
 *
 * Design intent (see design discussion): one calm focal point, two hero
 * "create" cards carrying the node color language, a secondary "bring a file"
 * bar, and three tertiary utility pills. Dark leans on glow; light leans on
 * shadow + structure (never pure-white surfaces).
 */

interface HeroCard {
  readonly key: string;
  readonly nodeType: SceneNodeType;
  readonly title: string;
  readonly subtitle: string;
  readonly Icon: typeof ImageIcon;
  /** Tailwind classes for the icon tile — kept per-card so the empty-state
   *  inherits the same color language as the node it spawns. */
  readonly iconWrap: string;
  readonly iconColor: string;
}

// Content list (not hardcoded JSX) so an admin-config layer can drive this later.
const HERO_CARDS: readonly HeroCard[] = [
  {
    key: "image",
    nodeType: "generate-image",
    title: "Image",
    subtitle: "Generate from a prompt",
    Icon: ImageIcon,
    iconWrap: "bg-violet-500/10 dark:bg-violet-500/15",
    iconColor: "text-violet-500 dark:text-violet-400",
  },
  {
    key: "video",
    nodeType: "generate-video",
    title: "Video",
    subtitle: "Generate from a prompt",
    Icon: Video,
    iconWrap: "bg-emerald-500/10 dark:bg-emerald-500/15",
    iconColor: "text-emerald-500 dark:text-emerald-400",
  },
];

const PILL_CLASS =
  "flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm " +
  "transition-colors hover:border-slate-300 hover:text-slate-900 " +
  "dark:border-[#2D2D2D] dark:bg-[#1A1A1A] dark:text-slate-300 dark:shadow-none dark:hover:border-[#3a3a3a] dark:hover:text-white";

export interface EmptyCanvasStateProps {
  readonly onCreate: (type: SceneNodeType) => void;
  /** Opens the add-node popup drilled to the "Input" category. */
  readonly onOpenInputPanel: () => void;
  readonly onOpenMyLibrary: () => void;
  readonly onOpenMediaLibrary: () => void;
  readonly onOpenTemplates: () => void;
  readonly onOpenTutorials: () => void;
}

export function EmptyCanvasState({
  onCreate,
  onOpenInputPanel,
  onOpenMyLibrary,
  onOpenMediaLibrary,
  onOpenTemplates,
  onOpenTutorials,
}: EmptyCanvasStateProps) {
  return (
    // Wrapper is click-through so the empty canvas stays pannable around the
    // content; only the interactive cluster captures pointer events.
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
      {/* Ambient node-graph motif — dark: soft brand glow; light: faint ink dots */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60
                   bg-[radial-gradient(circle,rgba(15,23,42,0.04)_1px,transparent_1px)]
                   dark:bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)]
                   [background-size:22px_22px]
                   [mask-image:radial-gradient(circle,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full
                   bg-[radial-gradient(circle,rgba(255,0,115,0.10),transparent_70%)] blur-2xl dark:block"
      />

      <div className="pointer-events-auto relative flex w-full max-w-[680px] flex-col items-center px-4">
        <span className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          Page 1 · Empty canvas
        </span>

        <h1 className="bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-center text-4xl font-semibold tracking-tight text-transparent">
          Make something
        </h1>
        <p className="mt-2 text-center text-[15px] text-slate-500 dark:text-slate-400">
          Start from a prompt
        </p>

        {/* Hero create cards */}
        <div className="mt-8 grid w-full grid-cols-2 gap-4">
          {HERO_CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => onCreate(card.nodeType)}
              className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm
                         transition-all hover:-translate-y-0.5 hover:border-[#ff0073]/60 hover:shadow-md
                         dark:border-[#2D2D2D] dark:bg-[#1A1A1A] dark:shadow-none dark:hover:border-[#ff0073]/60"
            >
              <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-slate-300 transition-colors group-hover:text-[#ff0073] dark:text-slate-600" />
              <span className={`mb-8 flex h-11 w-11 items-center justify-center rounded-xl ${card.iconWrap}`}>
                <card.Icon className={`h-5 w-5 ${card.iconColor}`} />
              </span>
              <span className="text-[15px] font-semibold text-slate-900 dark:text-white">{card.title}</span>
              <span className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{card.subtitle}</span>
            </button>
          ))}
        </div>

        {/* "Have a file already?" bar → opens the add-node Input panel */}
        <button
          type="button"
          onClick={onOpenInputPanel}
          className="group mt-4 flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-3 text-left
                     transition-colors hover:border-[#ff0073]/50 hover:bg-white
                     dark:border-[#2D2D2D] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <Upload className="h-4 w-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-semibold text-slate-900 dark:text-white">Have a file already?</span>
            <span className="text-[12px] text-slate-500 dark:text-slate-400">Upload or browse your assets</span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 text-slate-300 transition-colors group-hover:text-[#ff0073] dark:text-slate-600" />
        </button>

        {/* Tertiary utility pills */}
        <div className="mt-6 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={PILL_CLASS}>
                <FolderOpen className="h-3.5 w-3.5" />
                Browse assets
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-44">
              <DropdownMenuItem onClick={onOpenMyLibrary}>
                <FolderOpen className="mr-2 h-4 w-4" />
                My Library
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenMediaLibrary}>
                <Images className="mr-2 h-4 w-4" />
                Media Library
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={PILL_CLASS} onClick={onOpenTemplates}>
            <LayoutGrid className="h-3.5 w-3.5" />
            Templates
          </button>
          <button type="button" className={PILL_CLASS} onClick={onOpenTutorials}>
            <GraduationCap className="h-3.5 w-3.5" />
            Tutorials
          </button>
        </div>
      </div>
    </div>
  );
}
