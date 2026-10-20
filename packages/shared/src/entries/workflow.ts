/**
 * `@nodaro/shared/workflow` — Graph and data-flow helpers that do not depend on the model tables: node refs, selectors, filters, JSON paths, lists, fan-out rows, triggers, schedules, execution state.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  ITER_CLONE_PATTERN,
  isExpandedClone,
  filterCloneNodes,
} from "../clone-utils.js"
export {
  aggregateByType,
  presentTypes,
  isAggregateableType,
  AGGREGATEABLE_TYPES,
  GROUP_HANDLE_PREFIX,
  COLLECT_IN_HANDLE,
  groupHandleId,
  parseGroupHandle,
  isCollectInEdge,
  buildChildrenByParent,
  computeAggregateLanes,
  type AggregateableType,
  type Member,
  type AggregationBuckets,
} from "../group-aggregation.js"
export {
  calculateProgress,
  buildProgressSegments,
  calculateCombinedProgress,
  CATEGORY_DURATION_DEFAULTS,
  type ProgressSegment,
} from "../progress-curve.js"
export { getRouteReachableNodeIds, type MinimalNode, type MinimalEdge } from "../route-filter.js"
export { evaluateJsonPath, stringifyPathResults } from "../json-path.js"
export { variantJobId } from "../variant-job-id.js"
export { evaluateJsonExpression, buildExpressionFromVisual, jsonResultToList, type JsonEvalResult, type JsonFilter, type FilterOperator } from "../json-evaluator.js"
export {
  tryParseJson,
  resolveRelativeWindowToken,
  resolveConditionValue,
  evaluateCondition,
  evaluateConditionGroup,
  type FilterListCondition,
  type FilterListOperator,
  type RouterConditionGroup,
  type EvaluateConditionOptions,
} from "../filter-condition.js"
export {
  resolveIndex,
  applyRange,
  buildRangeLabel,
  migrateEdgeOutputMode,
  resolveListExpression,
  parseListExpression,
  selectListItems,
  describeEdgeBehavior,
  isDefaultSelectorConfig,
  runSelector,
  applyRangeIndices,
  selectRandom,
  selectByModulo,
  selectByPredicate,
  selectByNamedKey,
  resolveSelectorRefs,
} from "../selector.js"
export type {
  SelectorMode,
  OutputMode,
  SelectorFields,
  FullSelectorMode,
  SelectorConfig,
  SelectorPredicateOp,
  SelectorResult,
} from "../selector.js"
export { REPEATABLE_NODE_TYPES, REPEAT_PLACEHOLDER, PROVIDER_PLACEHOLDER_PREFIX, encodeProviderItem, decodeProviderItem, getEffectiveRepeatCount, expandItemsWithRepeat } from "../repeat-types.js"
export {
  NON_PROMPT_TEXT_LANES,
  fanOutTextFeedsPrompt,
  fanOutUrlItemIsText,
  isFanOutUrlItem,
  compactWithRows,
  pickHeldRow,
  liveRowColumn,
  resolveListFanOut,
  planFanOut,
  alignedFieldList,
} from "../fan-out-rows.js"
export type { FanOutCandidate, ListFanOut, FanOutPlan, HeldRowPick } from "../fan-out-rows.js"
export { settledWithLimit } from "../settled-with-limit.js"
export { splitByLoopDelimiter, spliceDelimitedRows, NO_SPLIT_DELIMITER } from "../loop-delimiter.js"
export { splitGeneratedItems, GENERATE_TEXT_DELIMITER } from "../generate-text-items.js"
export {
  SEPARATOR_PRESETS,
  SEPARATOR_DISPLAY,
  resolveSeparator,
  type SeparatorPreset,
  type ResolveSeparatorOptions,
} from "../text-separators.js"
export { sortListItems } from "../list-sort.js"
export type { SortType, SortDirection, SortListOptions } from "../list-sort.js"
export {
  SCHEDULE_TRIGGER_NODE_TYPE,
  WEBHOOK_TRIGGER_NODE_TYPE,
  TELEGRAM_TRIGGER_NODE_TYPE,
  TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE,
  PROJECTED_TRIGGER_NODE_TYPES,
  isProjectedTriggerNodeType,
} from "../trigger-node-types.js"
export { buildFeedMaps, nodeFeedsAnything, type FeedNode, type FeedEdge, type FeedMaps } from "../trigger-feeds.js"
export {
  SCHEDULE_RULE_KINDS,
  SCHEDULE_EVERY_LIMITS,
  isCronExpression,
  isValidTimezone,
  normalizeScheduleRule,
  normalizeScheduleRules,
  legacyScheduleToRules,
  localTimeIn,
  localMinuteKey,
  timezoneOffsetMinutes,
  matchesCronField,
  matchesCron,
  ruleMatches,
  scheduleMatchesAt,
  scheduleOccurrences,
  nextScheduleRuns,
  previewHorizonMs,
  type ScheduleRuleKind,
  type ScheduleRule,
  type ScheduleSpec,
  type LocalTime,
} from "../schedule-rules.js"
export {
  SCHEDULE_RETRY_LIMITS,
  SCHEDULE_RETRY_DEFAULTS,
  normalizeScheduleRetry,
  type ScheduleRetry,
} from "../schedule-retry.js"
export { VARIABLES_HANDLE_ID, buildConditionVariables } from "../condition-variables.js"
export { extractAllGeneratedResults, extractGeneratedJsonAsList, spreadJsonArrayIfSingleton } from "../generated-results.js"
export { resolveFieldMappings, resolveLocationFields, type FieldEdgeSource } from "../resolve-field-mappings.js"
export { resolveNodeRefs, parseNodeRef, canonicalVarName, NODE_REF_PATTERN, RESERVED_TEMPLATE_VARS, extractReferencedLabels, combineSameLabelRefs, refHandleCategory, REF_HANDLE_CATEGORY, REFERENCE_HANDLE_MAP, referenceModalityForHandle, FRAME_TARGET_HANDLES, countRefModalityEdges, REF_TOKEN_NAMESPACE_PREFIXES, classifyRefToken, unresolvedRefTokens } from "../node-refs.js"
export type { RefCandidate, ReferenceModality, RefModalityEdge, RefTokenKind } from "../node-refs.js"
export { resolveSourceThroughConnectedList } from "../list-source-resolver.js"
export { zipMergeLists } from "../list-merge.js"
export type {
  WorkflowExport,
  WorkflowExportCharacter,
  WorkflowExportObject,
  WorkflowExportCreature,
  WorkflowExportLocation,
  WorkflowMediaRef,
  WorkflowPortability,
  WorkflowImportReport,
  WorkflowImportSkippedAsset,
  WorkflowAssetKind,
} from "../workflow-export.js"
export { stripExportContent, stripUnownedRefs } from "../workflow-export.js"
export { validateSubWorkflowRoutes } from "../sub-workflow-validation.js"
export * from "../reduce-strategy-registry.js"
export { isPrivateOrReservedIP, isLocalOrPrivateHostname } from "../private-host.js"
// --- Node presets ---
export { EXECUTION_DATA_KEYS, NODE_TYPE_EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS, executionDataKeysOf, isExecutionDataKey, stripTransientRuntimeData } from "../node-runtime-keys.js"
// --- Execution node state (wire contract) ---
export {
  OUTPUT_BEARING_NODE_STATUSES,
  nodeStateMayCarryOutput,
} from "../node-execution-state.js"
export type {
  NodeExecutionStatus,
  NodeExecutionStateWire,
  NodeSkipReason,
} from "../node-execution-state.js"
export { executionOutcome, countEmptyInputSkips } from "../execution-outcome.js"
export type { ExecutionOutcome } from "../execution-outcome.js"
