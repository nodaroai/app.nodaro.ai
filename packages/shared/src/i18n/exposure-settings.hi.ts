import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ---------------------------- Aperture ----------------------------
  "aperture-f1-2": { description: "बहुत पतली DOF, स्वप्निल bokeh" },
  "aperture-f1-4": { description: "आक्रामक subject isolation" },
  "aperture-f1-8": { description: "क्लासिक portrait separation" },
  "aperture-f2-8": { description: "Subject तेज़, BG नरम" },
  "aperture-f4": { description: "संतुलित रोज़मर्रा की DOF" },
  "aperture-f5-6": { description: "Subject पर साफ़" },
  "aperture-f8": { description: "Sweet-spot की sharpness" },
  "aperture-f11": { description: "गहरी landscape DOF" },
  "aperture-f16": { description: "Hyperfocal, sun-stars" },

  // ---------------------------- Shutter Speed ----------------------------
  "shutter-1-30": { description: "Handheld motion का संकेत" },
  "shutter-1-60": { description: "मानक रोज़मर्रा का shutter" },
  "shutter-1-200": { description: "अधिकांश subjects पर साफ़" },
  "shutter-1-500": { description: "तेज़ action पर तेज़" },
  "shutter-1-1000": { description: "Frozen sports/wildlife" },
  "shutter-long-1s": { description: "लकीरें और motion trails" },

  // ---------------------------- ISO ----------------------------
  "iso-100": { description: "न्यूनतम noise, बारीक grain" },
  "iso-400": { description: "हल्की texture, daily-driver ISO" },
  "iso-800": { description: "दिखाई देने वाला पर सुखद grain" },
  "iso-1600": { description: "Editorial low-light texture" },
  "iso-3200": { description: "Pushed, gritty documentary एहसास" },
}

export default map
