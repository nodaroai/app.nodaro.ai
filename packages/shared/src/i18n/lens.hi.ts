import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { description: "अत्यधिक wide angle, exaggerated perspective" },
  "wide-24mm": { description: "Wide field of view, environmental" },
  "standard-35mm": { description: "स्वाभाविक perspective, documentary एहसास" },
  "normal-50mm": { description: "मानवीय आँख की धारणा के सबसे क़रीब" },
  "portrait-85mm": { description: "Flattering compression, creamy bokeh" },
  "telephoto-135mm": { description: "Compressed depth, isolated subject" },
  "super-telephoto-400mm": { description: "अत्यधिक compression, दूर का subject" },
  "fisheye": { label: "Fisheye", description: "Hemispherical 180° distortion" },
  "anamorphic": { label: "Anamorphic", description: "Cinematic widescreen, अंडाकार bokeh" },
  "macro": { label: "Macro", description: "छोटे detail का अत्यधिक close-up" },
  "tilt-shift": { label: "Tilt-shift", description: "चयनात्मक focus, miniature प्रभाव" },
  "shallow-dof": { label: "Shallow DOF", description: "बहुत पतला focus, स्वप्निल bokeh" },
  "canon-k35": { description: "विंटेज cinematic, गर्म कोमल skin" },
  "cooke-s4": { description: "Cooke का look — creamy painterly skin" },
  "helios-44": { description: "विंटेज Soviet swirly bokeh" },
  "petzval": { description: "अत्यधिक विंटेज swirl, dramatic falloff" },
  "probe": { label: "प्रोब लेंस", description: "नली मैक्रो — छिद्रों और तंग जगहों के आर-पार" },
  "cctv": { label: "सीसीटीवी", description: "निगरानी कैमरा लुक" },
}

export default map
