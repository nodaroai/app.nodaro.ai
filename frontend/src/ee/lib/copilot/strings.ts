/**
 * Every user-visible string in the Copilot panel, indexed in one place.
 *
 * The copy itself lives in the chrome dictionaries, under `copilot.*` plus a
 * few shared words (`common.*`, the product name): `lib/i18n/en.ts` holds the
 * English verbatim from the approved design — including the curly quotes, so
 * do not "fix" punctuation there — and `he.ts` the Hebrew. This index is what
 * the design review reads against: one name per string, each typed as a real
 * dictionary key, so a typo or a deleted key fails the type check.
 *
 * Nothing here is translated. Components resolve a key at render with
 * `useT()`; the turn engine and the home-page handoff resolve it at the moment
 * they write a notice, with `tx()`. Never resolve one at module load — that
 * freezes whatever language the page happened to start in.
 *
 * Counted strings come in `…One` / `…Other` pairs with `{n}` in both forms.
 * Credit figures are converted by the caller (`creditUnits`, and
 * `creditUnitLabel(t("credits.unitShort"))` for the short unit) before they are
 * interpolated, so this file carries no credit math.
 */

import type { MessageKey } from "@/lib/i18n"

export const COPILOT_KEYS = {
  title: "editor.copilotName",

  modeAsk: "copilot.modeAsk",
  modeAuto: "common.auto",
  modeHintAsk: "copilot.modeHintAsk",
  modeHintAuto: "copilot.modeHintAuto",
  runModeLabel: "copilot.runModeLabel",
  ceilingPrefix: "copilot.ceilingPrefix",
  ceilingSuffix: "copilot.ceilingSuffix",
  ceilingLabel: "copilot.ceilingLabel",
  tierLabel: "copilot.tierLabel",
  tierEconomy: "copilot.tierEconomy",
  tierStandard: "copilot.tierStandard",
  tierPremium: "copilot.tierPremium",
  tierHintEconomy: "copilot.tierHintEconomy",
  tierHintStandard: "copilot.tierHintStandard",
  tierHintPremium: "copilot.tierHintPremium",
  close: "copilot.close",
  // Both halves name Copilot as the subject and state the guarantee from the
  // USER's side ("you still choose…"). That reads as product, not as docs, and
  // the control the user keeps is what makes the toggle safe to turn on — which
  // is why the on-copy leads with what it does and closes with what stays
  // theirs.
  allowPublishing: "copilot.allowPublishing",
  allowPublishingOn: "copilot.allowPublishingOn",
  allowPublishingOff: "copilot.allowPublishingOff",

  homeTagline: "copilot.homeTagline",
  homePlaceholder: "copilot.homePlaceholder",
  homeBuild: "copilot.homeBuild",
  homeCollapse: "copilot.homeCollapse",
  homeExpand: "copilot.homeExpand",
  homeBuildFailed: "copilot.homeBuildFailed",
  homeTooLong: "copilot.homeTooLong",
  handoffSendFailed: "copilot.handoffSendFailed",
  handoffInterrupted: "copilot.handoffInterrupted",
  handoffFetchFailed: "copilot.handoffFetchFailed",
  chipProductShot: "copilot.chipProductShot",
  chipAdCreatives: "copilot.chipAdCreatives",
  chipScriptVideo: "copilot.chipScriptVideo",
  chipCharacterSet: "copilot.chipCharacterSet",

  emptyGreeting: "copilot.emptyGreeting",
  /** The greeting when no first name can be derived — its own sentence, not an English word in a slot. */
  emptyGreetingAnon: "copilot.emptyGreetingAnon",
  emptyBlurb: "copilot.emptyBlurb",
  suggestProductShot: "copilot.suggestProductShot",
  suggestAdCreatives: "copilot.suggestAdCreatives",
  suggestScriptVideo: "copilot.suggestScriptVideo",
  suggestCharacterSet: "copilot.suggestCharacterSet",

  updatedTitle: "copilot.updatedTitle",
  updatedShowOnCanvas: "copilot.updatedShowOnCanvas",
  addedNodesOne: "copilot.addedNodesOne",
  addedNodesOther: "copilot.addedNodesOther",
  updatedNodes: "copilot.updatedNodes",
  removedNodes: "copilot.removedNodes",
  connectionsOne: "copilot.connectionsOne",
  connectionsOther: "copilot.connectionsOther",

  proposeTitle: "copilot.proposeTitle",
  proposeRun: "common.run",
  proposeSkip: "common.skip",
  proposeEstimate: "copilot.proposeEstimate",
  proposeBalance: "copilot.proposeBalance",
  estimatePending: "copilot.estimatePending",
  proposeUsingFiles: "copilot.proposeUsingFiles",
  autoNotice: "copilot.autoNotice",
  autoNoticePending: "copilot.autoNoticePending",
  autoOverLimit: "copilot.autoOverLimit",

  running: "copilot.running",
  runProgress: "copilot.runProgress",
  runStarting: "copilot.runStarting",
  runStop: "common.stop",
  runSucceeded: "copilot.runSucceeded",
  runFailed: "copilot.runFailed",
  runFailedAt: "copilot.runFailedAt",
  creditsOne: "copilot.creditsOne",
  creditsOther: "copilot.creditsOther",
  nodeRunStale: "copilot.nodeRunStale",
  nodeRunStarted: "copilot.nodeRunStarted",
  nodeRunFailed: "copilot.nodeRunFailed",
  estimateStale: "copilot.estimateStale",
  runVanished: "copilot.runVanished",
  fixIt: "copilot.fixIt",
  /**
   * Posted AS THE USER, in the user's language. It must never carry a link:
   * the backend's URL-provenance harvest treats every user-role text block as
   * user-authored (pinned in `turn-engine.test.ts`, for every locale).
   */
  fixItMessage: "copilot.fixItMessage",
  autoFixExhausted: "copilot.autoFixExhausted",

  composerPlaceholder: "copilot.composerPlaceholder",
  composerHintAsk: "copilot.composerHintAsk",
  composerHintAuto: "copilot.composerHintAuto",
  turnCeiling: "copilot.turnCeiling",
  /** The `{unit}` of `turnCeiling`: pass it through `creditUnitLabel()` so a configured display unit wins. */
  unitShort: "credits.unitShort",
  turnCeilingFull: "copilot.turnCeilingFull",
  send: "copilot.send",
  stop: "common.stop",
  mention: "copilot.mention",
  removeMention: "copilot.removeMention",
  saving: "common.saving",

  pickerHintInsert: "copilot.pickerHintInsert",
  pickerExpand: "copilot.pickerExpand",
  pickerBack: "common.back",
  pickerVariantDefault: "copilot.pickerVariantDefault",
  pickerVariantsHint: "copilot.pickerVariantsHint",
  pickerVariantsOf: "copilot.pickerVariantsOf",
  pickerOtherTabs: "copilot.pickerOtherTabs",
  pickerPreviewOf: "copilot.pickerPreviewOf",
  previewInsert: "common.insert",
  previewClose: "copilot.previewClose",
  pickerModalTitle: "copilot.pickerModalTitle",
  pickerModalBlurb: "copilot.pickerModalBlurb",
  pickerModalSearch: "copilot.pickerModalSearch",
  pickerNoMatch: "copilot.pickerNoMatch",
  pickerLoading: "copilot.pickerLoading",
  pickerEmptyTitle: "copilot.pickerEmptyTitle",
  pickerEmptyBlurb: "copilot.pickerEmptyBlurb",
  sectionCharacters: "copilot.sectionCharacters",
  sectionObjects: "copilot.sectionObjects",
  sectionCreatures: "copilot.sectionCreatures",
  sectionLocations: "copilot.sectionLocations",
  sectionFiles: "copilot.sectionFiles",
  kindCharacter: "copilot.kindCharacter",
  kindObject: "copilot.kindObject",
  kindCreature: "copilot.kindCreature",
  kindLocation: "copilot.kindLocation",
  kindImage: "common.image",
  kindVideo: "common.video",
  kindAudio: "copilot.kindAudio",

  attach: "copilot.attach",
  attachFailed: "copilot.attachFailed",
  attachNoId: "copilot.attachNoId",
  attachWrongKind: "copilot.attachWrongKind",

  stepsOne: "copilot.stepsOne",
  stepsOther: "copilot.stepsOther",
  /** What the live pill says before the first tool call names a real step. */
  stepStarting: "copilot.stepStarting",

  readOnlyTitle: "copilot.readOnlyTitle",
  readOnlyBlurb: "copilot.readOnlyBlurb",
  otherTabTitle: "copilot.otherTabTitle",
  stillWorkingTitle: "copilot.stillWorkingTitle",
  stillWorkingBlurb: "copilot.stillWorkingBlurb",

  memoryRemembered: "copilot.memoryRemembered",
  memoryUndo: "copilot.memoryUndo",
  memoryUndoFailed: "copilot.memoryUndoFailed",
  memoriesOpen: "copilot.memoriesTitle",
  memoriesTitle: "copilot.memoriesTitle",
  memoriesBlurb: "copilot.memoriesBlurb",
  memoriesEmpty: "copilot.memoriesEmpty",
  memoriesDelete: "copilot.memoriesDelete",
  memoriesLoadFailed: "copilot.memoriesLoadFailed",
  workflowCreated: "copilot.workflowCreated",
  workflowCreatedOpen: "common.open",

  a11yWorking: "copilot.a11yWorking",
  a11yDone: "copilot.a11yDone",
  errorRetry: "common.tryAgain",
  cancelled: "copilot.cancelled",
  capped: "copilot.capped",
  notEnoughCredits: "copilot.notEnoughCredits",
  usedTotalOne: "copilot.usedTotalOne",
  usedTotalOther: "copilot.usedTotalOther",

  openEditorToSave: "copilot.openEditorToSave",
  saveFailed: "copilot.saveFailed",
  changedWhileSaving: "copilot.changedWhileSaving",
  saveFirst: "copilot.saveFirst",
  saveRemoteConflict: "copilot.saveRemoteConflict",
  saveNotWritable: "copilot.saveNotWritable",
  saveEmptyWorkflow: "copilot.saveEmptyWorkflow",
  saveNoProject: "copilot.saveNoProject",
  canvasBehind: "copilot.canvasBehind",
  turnStartFailed: "copilot.turnStartFailed",
  connectionLost: "copilot.connectionLost",
  threadStartFailed: "copilot.threadStartFailed",
  requestFailed: "copilot.requestFailed",
} as const satisfies Record<string, MessageKey>

/**
 * Suggestion chips on the empty state. `icon` maps to a lucide component in the
 * view; the text is resolved at render, and what a click sends is that same
 * resolved text.
 */
export const COPILOT_SUGGESTIONS: ReadonlyArray<{ textKey: MessageKey; icon: "image" | "sparkles" | "video" | "user" }> = [
  { textKey: COPILOT_KEYS.suggestProductShot, icon: "image" },
  { textKey: COPILOT_KEYS.suggestAdCreatives, icon: "sparkles" },
  { textKey: COPILOT_KEYS.suggestScriptVideo, icon: "video" },
  { textKey: COPILOT_KEYS.suggestCharacterSet, icon: "user" },
]
