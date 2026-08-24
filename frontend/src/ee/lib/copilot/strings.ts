/**
 * Every user-visible string in the Copilot panel, in one place.
 *
 * The editor chrome is English regardless of the user's locale (same rule as
 * the rest of the workflow editor), and this file is the single source the
 * design review reads against. Copy is verbatim from the approved design —
 * including the curly quotes — so do not "fix" punctuation here.
 */

export const COPILOT_STRINGS = {
  title: "Copilot",

  modeAsk: "Ask",
  modeAuto: "Auto",
  modeHintAsk: "asks before running",
  modeHintAuto: "runs on its own",
  ceilingPrefix: "up to",
  ceilingSuffix: "cr",
  ceilingLabel: "Auto-run credit limit",
  close: "Close Copilot",

  homeTagline: "describe it, and it gets built on the canvas",
  homePlaceholder: "Describe the workflow you want…",
  homeBuild: "Build it",
  homeCollapse: "Collapse Copilot",
  homeExpand: "Open Copilot",
  homeBuildFailed: "Could not start that — try again.",
  homeTooLong: "That is too long to send — shorten it, or remove a mention.",
  handoffSendFailed: "Could not send that automatically — press send to try again.",
  handoffInterrupted: "You left before this could start — press send when you are ready.",
  handoffFetchFailed: "Could not read what you asked for on the home page. Type it here and send.",

  emptyGreeting: (name: string) => `Hey ${name}`,
  emptyBlurb: "Describe the workflow you want. I build it on the canvas, then ask before spending anything.",

  updatedTitle: "Workflow updated",
  updatedShowOnCanvas: "Show on canvas",

  proposeTitle: "Run this workflow?",
  proposeRun: "Run",
  proposeSkip: "Skip",
  proposeEstimate: (credits: number) => `~${credits} credits`,
  estimatePending: "pricing…",
  autoNotice: (credits: number, ceiling: number) => `Auto mode — running it now, ~${credits} of your ${ceiling} credit limit.`,
  autoNoticePending: (ceiling: number) => `Auto mode — starting it now, within your ${ceiling} credit limit.`,
  autoOverLimit: (credits: number, ceiling: number) =>
    `This run is ~${credits} credits, over your ${ceiling} credit auto limit — asking first.`,

  running: "Running",
  runStop: "Stop",
  runSucceeded: "Run succeeded",
  runFailed: "Run failed",
  runVanished: "That run is no longer available — start it again if you still want it.",
  runFailedAt: (step: number) => `Run failed at step ${step}`,
  fixIt: "Fix it",
  fixItMessage: "Fix it — the run failed.",
  autoFixExhausted: "Auto-fix stopped after two attempts — press Fix it to keep going.",

  composerPlaceholder: "Describe what you want to do — @ to mention",
  composerHintAsk: "nothing runs without your OK",
  turnCeiling: (credits: number) => `up to ~${credits} CR`,
  turnCeilingFull: (credits: number) =>
    `This message costs at most ~${credits} credits. You are billed for what the assistant actually uses, which is usually far less.`,
  composerHintAuto: (ceiling: number) => `auto-runs up to ~${ceiling} credits`,
  send: "Send",
  stop: "Stop",
  mention: "Mention something of yours",
  saving: "Saving…",

  pickerHintInsert: "click to insert",
  pickerNoMatch: (query: string) => `Nothing matches “${query}”`,
  pickerLoading: "Looking…",
  pickerEmptyTitle: "Nothing here yet",
  pickerEmptyBlurb: "Characters, objects, animals and locations show up here once you have some.",
  sectionCharacters: "Characters",
  sectionObjects: "Objects",
  sectionCreatures: "Animals",
  sectionLocations: "Locations",
  kindCharacter: "Character",
  kindObject: "Object",
  kindCreature: "Animal",
  kindLocation: "Location",
  allowPublishing: "Let it build posting steps",
  // Says what it can do AND what it still cannot, because the second half is
  // what makes the first safe to agree to.
  allowPublishingOn: "It can add posting steps. It still cannot choose the account, the channel, or who sees the post.",
  allowPublishingOff: "Posting steps are yours to add on the canvas.",
  sectionFiles: "Files",
  proposeUsingFiles: "Using your files",
  attach: "Attach a file",
  attachFailed: "That file could not be uploaded.",
  attachNoId: "That file uploaded but cannot be attached — add it from your library instead.",
  attachWrongKind: "Only images, videos and audio can be attached.",
  kindImage: "Image",
  kindVideo: "Video",
  kindAudio: "Audio",

  stepsCollapsed: (count: number) => `${count} ${count === 1 ? "step" : "steps"}`,
  /** What the live pill says before the first tool call names a real step. */
  stepStarting: "Reading the workflow",

  readOnlyTitle: "Read-only",
  readOnlyBlurb: "Editing is off for this workflow",
  otherTabTitle: "Copilot is working in another tab",
  stillWorkingTitle: "Still working on your last message",
  stillWorkingBlurb: "The connection dropped but the turn is still running. It will appear here when it lands.",

  a11yWorking: "Copilot is working.",
  a11yDone: "Copilot finished.",
  errorRetry: "Try again",
  cancelled: "Stopped",
  capped: "Reached this turn's budget — send “continue” to keep going.",
  usedCredits: (credits: number) => `${credits} ${credits === 1 ? "credit" : "credits"}`,
} as const

/** Suggestion chips on the empty state. `icon` maps to a lucide component in the view. */
export const COPILOT_SUGGESTIONS: ReadonlyArray<{ text: string; icon: "image" | "sparkles" | "video" | "user" }> = [
  { text: "Create a product shot workflow", icon: "image" },
  { text: "Generate ad creatives for my brand", icon: "sparkles" },
  { text: "Turn a script into a narrated video", icon: "video" },
  { text: "Build a character-consistent image set", icon: "user" },
]
