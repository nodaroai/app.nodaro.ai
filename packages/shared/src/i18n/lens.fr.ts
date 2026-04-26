import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "Ultra grand-angle (14mm)", description: "Grand-angle extrême, perspective exagérée" },
  "wide-24mm": { label: "Grand-angle (24mm)", description: "Large champ de vision, environnemental" },
  "standard-35mm": { label: "Standard (35mm)", description: "Perspective naturelle, ambiance documentaire" },
  "normal-50mm": { label: "Normal (50mm)", description: "Perception la plus proche de l'œil humain" },
  "portrait-85mm": { label: "Portrait (85mm)", description: "Compression flatteuse, bokeh crémeux" },
  "telephoto-135mm": { label: "Téléobjectif (135mm)", description: "Profondeur compressée, sujet isolé" },
  "super-telephoto-400mm": { label: "Super téléobjectif (400mm)", description: "Compression extrême, sujet lointain" },
  "fisheye": { description: "Distorsion hémisphérique 180°" },
  "anamorphic": { description: "Cinéma widescreen, bokeh ovale" },
  "macro": { description: "Très gros plan d'un petit détail" },
  "tilt-shift": { description: "Mise au point sélective, effet miniature" },
  "shallow-dof": { label: "Profondeur de champ réduite", description: "Mise au point ultra-fine, bokeh onirique" },
  "canon-k35": { description: "Cinéma vintage, peau chaude et douce" },
  "cooke-s4": { description: "Le \"Cooke look\" — peau crémeuse et picturale" },
  "helios-44": { description: "Bokeh tourbillonnant soviétique vintage" },
  "petzval": { label: "Portrait Petzval", description: "Tourbillon ultra-vintage, chute de mise au point dramatique" },
}

export default map
