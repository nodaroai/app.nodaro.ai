// Runtime config placeholder. In the published image start.sh overwrites this
// file at boot with the container's PUBLIC_URL / browser Supabase URL / anon
// key; a dev server or a plain build serves this empty object and the app
// falls back to its build-time values. See src/lib/runtime-config.ts.
window.__NODARO_RUNTIME__ = {};
