// backend/src/lib/concurrency-lanes/settings-keys.ts — the app_settings keys
// of concurrency lanes, in one import-free module: the generic settings route
// refuses them (they have dedicated routes) without loading the gate, whose
// instance opens a Redis connection.

/** A map of runtime environment → boolean (migration 568); written by PUT /v1/admin/lanes/enforced. */
export const LANES_ENFORCED_KEY = "lanes_enforced"
/** Minutes a queued job may wait for a slot; written by PUT /v1/admin/lanes/settings. */
export const LANE_QUEUE_TIMEOUT_KEY = "lane_queue_timeout_minutes"
/** Minutes a live request may wait for a slot; written by PUT /v1/admin/lanes/settings. */
export const LANE_LIVE_WAIT_KEY = "lane_live_wait_minutes"
