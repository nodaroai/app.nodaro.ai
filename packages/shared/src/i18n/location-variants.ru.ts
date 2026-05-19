// TODO(translator): translate values into Russian (ru). Keys are stable —
// do NOT translate them. Reference English source-of-truth at `location-variants.en.ts`.
//
// 46 keys total: 9 timeOfDay + 9 weather + 4 seasons + 8 angles + 8 lighting + 8 motion.
import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Time of Day (9) ──
  "timeOfDay.dawn":          { label: "Dawn" },
  "timeOfDay.morning":       { label: "Morning" },
  "timeOfDay.noon":          { label: "Noon" },
  "timeOfDay.afternoon":     { label: "Afternoon" },
  "timeOfDay.golden hour":   { label: "Golden Hour" },
  "timeOfDay.dusk":          { label: "Dusk" },
  "timeOfDay.blue hour":     { label: "Blue Hour" },
  "timeOfDay.night":         { label: "Night" },
  "timeOfDay.midnight":      { label: "Midnight" },

  // ── Weather (9) ──
  "weather.clear":           { label: "Clear" },
  "weather.cloudy":          { label: "Cloudy" },
  "weather.light rain":      { label: "Light Rain" },
  "weather.heavy rain":      { label: "Heavy Rain" },
  "weather.storm":           { label: "Storm" },
  "weather.snow":            { label: "Snow" },
  "weather.blizzard":        { label: "Blizzard" },
  "weather.fog":             { label: "Fog" },
  "weather.mist":            { label: "Mist" },

  // ── Seasons (4) ──
  "seasons.spring":          { label: "Spring" },
  "seasons.summer":          { label: "Summer" },
  "seasons.autumn":          { label: "Autumn" },
  "seasons.winter":          { label: "Winter" },

  // ── Angles (8) ──
  "angles.wide":             { label: "Wide" },
  "angles.medium":           { label: "Medium" },
  "angles.closeup":          { label: "Close-up" },
  "angles.aerial":           { label: "Aerial" },
  "angles.low-angle":        { label: "Low Angle" },
  "angles.eye-level":        { label: "Eye-level" },
  "angles.bird's-eye":       { label: "Bird's-eye" },
  "angles.dutch tilt":       { label: "Dutch Tilt" },

  // ── Lighting (8) ──
  "lighting.soft natural":         { label: "Soft Natural" },
  "lighting.harsh sunlight":       { label: "Harsh Sunlight" },
  "lighting.golden":               { label: "Golden" },
  "lighting.blue hour":            { label: "Blue Hour" },
  "lighting.neon":                 { label: "Neon" },
  "lighting.candlelit":            { label: "Candlelit" },
  "lighting.cinematic":            { label: "Cinematic" },
  "lighting.dramatic chiaroscuro": { label: "Dramatic Chiaroscuro" },

  // ── Motion (8) ──
  "motion.slow dolly-in":      { label: "Slow Dolly-in" },
  "motion.slow pan-left":      { label: "Slow Pan-left" },
  "motion.slow pan-right":     { label: "Slow Pan-right" },
  "motion.push up":            { label: "Push Up" },
  "motion.drone fly-over":     { label: "Drone Fly-over" },
  "motion.gentle drift":       { label: "Gentle Drift" },
  "motion.parallax":           { label: "Parallax" },
  "motion.static atmospheric": { label: "Static Atmospheric" },
}

export default map
