import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "real-time": { label: "Echtzeit", description: "Normale Wiedergabegeschwindigkeit" },
  "slow-motion": { label: "Zeitlupe", description: "Moderat verlangsamtes Material" },
  "super-slow-mo": { label: "Super-Zeitlupe", description: "Extrem langsames Material" },
  "time-lapse": { label: "Zeitraffer", description: "Komprimierte Zeit, schneller Verlauf" },
  "hyper-lapse": { label: "Hyperlapse", description: "Bewegter Zeitraffer" },
  "speed-ramp": { description: "Dynamischer Geschwindigkeitswechsel mitten im Bild" },
  "full-freeze": { label: "Vollständiges Standbild", description: "Alle Bewegung eingefroren" },
  "bullet-time": { description: "Motiv eingefroren, Kamera kreist" },
  "frozen-subject": { label: "Eingefrorenes Motiv", description: "Motiv eingefroren, Welt bewegt sich" },
  "moving-subject": { label: "Bewegtes Motiv", description: "Motiv bewegt sich, Welt eingefroren" },
  "forward": { label: "Vorwärts", description: "Normale Vorwärtswiedergabe" },
  "reverse": { label: "Rückwärts / Zurückspulen", description: "Zeit läuft rückwärts" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "Vorwärts und dann rückwärts" },
  "long-exposure": { label: "Langzeitbelichtung", description: "Bewegungsspuren und Streifen" },
  "crisp-shutter": { label: "Knackiger Verschluss", description: "Scharfe Bewegung, keine Unschärfe" },
  "motion-blur": { label: "Bewegungsunschärfe", description: "Ausgeprägte Richtungsunschärfe" },
  "stutter-strobe": { label: "Stutter / Strobe", description: "Stroboskop-effekt-ruckartige Bewegung" },
  "stop-motion": { label: "Stop-Motion", description: "Schrittweise Bild-für-Bild-Bewegung" },
}

export default map
