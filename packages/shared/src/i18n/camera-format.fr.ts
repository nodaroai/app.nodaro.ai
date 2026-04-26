import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "35mm-film": { label: "Pellicule 35mm", description: "Grain de pellicule cinéma classique" },
  "16mm-film": { label: "Pellicule 16mm", description: "Grain indé / documentaire" },
  "super-8": { description: "Look cinéma amateur 8mm vintage" },
  "imax-70mm": { description: "Clarté immaculée grand format" },
  "anamorphic-scope": { label: "Scope anamorphique", description: "Look cinéma widescreen 2,39:1" },
  "arri-alexa": { description: "Cinéma numérique premium" },
  "dslr": { label: "Reflex numérique", description: "Look vidéo-reflex net" },
  "mirrorless-a7iii": { description: "Hybride moderne sans miroir" },
  "canon-r5": { description: "Hybride haute résolution mode-éditorial" },
  "hasselblad-medium-format": { label: "Hasselblad moyen format", description: "Moyen format éditorial" },
  "leica-m-rangefinder": { label: "Télémètre Leica M", description: "Télémètre 35mm classique" },
  "voigtlander": { description: "Caractère télémètre boutique" },
  "fuji-xt4": { description: "Couleur Fuji émulant la pellicule" },
  "drone-aerial": { label: "Drone (aérien)", description: "Aérien stabilisé par cardan" },
  "gopro-action-cam": { label: "Caméra d'action GoPro", description: "Caméra d'action grand-angle fisheye" },
  "webcam-facetime": { label: "Webcam / FaceTime", description: "Appel vidéo basse résolution" },
  "vhs": { description: "Distorsion de bande + lignes de balayage" },
  "camcorder": { label: "Caméscope", description: "Vidéo grand public des années 90" },
  "polaroid": { description: "Tonalité de pellicule instantanée" },
  "fuji-instax": { description: "Pellicule instantanée moderne" },
  "disposable-camera": { label: "Appareil jetable", description: "Pellicule jetable des années 90/2000" },
  "toy-camera-holga": { label: "Toy camera (Holga)", description: "Lo-fi à objectif plastique Holga / Lomo" },
  "tintype-wet-plate": { label: "Ferrotype / Plaque humide", description: "Collodion plaque humide vintage" },
  "daguerreotype": { label: "Daguerréotype", description: "Procédé miroir d'argent des années 1840" },
  "security-cam": { label: "Caméra de surveillance (CCTV)", description: "Fisheye CCTV + horodatage en surimpression" },
  "bw-film": { label: "Pellicule N&B", description: "Pellicule noir et blanc" },
  "iphone": { description: "Look caméra de téléphone moderne" },
}

export default map
