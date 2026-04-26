import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "Ultraweitwinkel (14mm)", description: "Extremes Weitwinkel, übertriebene Perspektive" },
  "wide-24mm": { label: "Weitwinkel (24mm)", description: "Breites Sichtfeld, environmental" },
  "standard-35mm": { label: "Standard (35mm)", description: "Natürliche Perspektive, dokumentarisches Gefühl" },
  "normal-50mm": { label: "Normal (50mm)", description: "Am nächsten an der menschlichen Augenwahrnehmung" },
  "portrait-85mm": { label: "Porträt (85mm)", description: "Schmeichelhafte Kompression, cremiges Bokeh" },
  "telephoto-135mm": { label: "Tele (135mm)", description: "Komprimierte Tiefe, isoliertes Motiv" },
  "super-telephoto-400mm": { label: "Super-Tele (400mm)", description: "Extreme Kompression, weit entferntes Motiv" },
  "fisheye": { label: "Fischauge", description: "Halbkugelförmige 180°-Verzerrung" },
  "anamorphic": { description: "Cinematic Widescreen, ovales Bokeh" },
  "macro": { label: "Makro", description: "Extreme Nahaufnahme von kleinem Detail" },
  "tilt-shift": { description: "Selektiver Fokus, Miniatureffekt" },
  "shallow-dof": { label: "Geringe Schärfentiefe", description: "Hauchdünner Fokus, traumhaftes Bokeh" },
  "canon-k35": { description: "Vintage-Cinematic, warme sanfte Hauttöne" },
  "cooke-s4": { description: "Der Cooke-Look — cremig-malerische Hauttöne" },
  "helios-44": { description: "Vintage-sowjetisches Wirbelbokeh" },
  "petzval": { description: "Ultra-Vintage-Wirbel, dramatischer Falloff" },
}

export default map
