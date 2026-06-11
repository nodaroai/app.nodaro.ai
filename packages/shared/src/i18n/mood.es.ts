import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Positive --------------------
  "happy": { label: "Feliz", description: "Felicidad cálida y sonriente" },
  "joyful": { label: "Alegre", description: "Alegría radiante y desinhibida" },
  "serene": { label: "Sereno", description: "Satisfacción tranquila y pacífica" },
  "playful": { label: "Juguetón", description: "Energía juguetona y traviesa" },
  "confident": { label: "Seguro", description: "Confiado y seguro de sí mismo" },
  "loving": { label: "Amoroso", description: "Tierno y afectuoso" },
  "amused": { label: "Divertido", description: "Sutilmente divertido, con sonrisa pícara" },
  "smirking": { label: "Sonriendo Pícaramente", description: "Diversión arrogante y presumida" },
  "eccentric": { label: "Excéntrico", description: "Peculiar, poco convencional" },
  "hopeful": { label: "Esperanzado", description: "Con ojos brillantes, optimista" },

  // -------------------- Negative --------------------
  "sad": { label: "Triste", description: "Tristeza silenciosa, mirada baja" },
  "angry": { label: "Enojado", description: "Enojo claro, tensión" },
  "afraid": { label: "Asustado", description: "Asustado, con ojos muy abiertos" },
  "anxious": { label: "Ansioso", description: "Nervioso, preocupado" },
  "melancholy": { label: "Melancólico", description: "Tristeza nostálgica" },
  "devastated": { label: "Devastado", description: "Dolor con corazón roto" },
  "grieving": { label: "Afligido", description: "Dolor profundo, pérdida" },
  "caught-off-guard": { label: "Desprevenido", description: "Sobresaltado a media reacción" },
  "aloof": { label: "Distante", description: "Retraído, sin interés" },
  "vulnerable": { label: "Vulnerable", description: "Expuesto, indefenso" },
  "coy": { label: "Tímido Coqueto", description: "Tímido, con mirada baja" },
  "bored": { label: "Aburrido", description: "Desinteresado, inexpresivo" },
  "embarrassed": { label: "Avergonzado", description: "Sonrojado, ojos esquivos" },
  "disgusted": { label: "Asqueado", description: "Repugnado, retrocediendo" },
  "bewildered": { label: "Desconcertado", description: "Confundido, perdido" },

  // -------------------- Neutral / Contemplative --------------------
  "thoughtful": { label: "Pensativo", description: "Sumido en pensamientos" },
  "stoic": { label: "Estoico", description: "Impasible, indescifrable" },
  "calm": { label: "Calmado", description: "Centrado, sin reacciones" },
  "curious": { label: "Curioso", description: "Intrigado, alerta" },
  "mysterious": { label: "Misterioso", description: "Inescrutable, enigmático" },
  "dazed": { label: "Aturdido", description: "Soñador, medio presente" },
  "sleepy": { label: "Soñoliento", description: "Adormilado, con párpados pesados" },
  "unbothered": { label: "Imperturbable", description: "Calma autosuficiente" },

  // -------------------- Intense / Dramatic --------------------
  "fierce": { label: "Feroz", description: "Feroz, imponente" },
  "determined": { label: "Determinado", description: "Resuelto, voluntad enfocada" },
  "passionate": { label: "Apasionado", description: "Pasión ardiente" },
  "brooding": { label: "Sombrío", description: "Melancolía oscura y reflexiva" },
  "seductive": { label: "Seductor", description: "Atractivo, seductor" },
  "defiant": { label: "Desafiante", description: "Desafiante, inflexible" },
  "sultry": { label: "Sensual", description: "Ardiente, con párpados pesados" },
  "smoldering": { label: "Ardiente Lento", description: "Intensidad contenida y lenta" },
  "sinister": { label: "Siniestro", description: "Oscuro, malicioso, amenazante" },
  "wiccan-mystical": { label: "Wicca / Místico", description: "Tranquilamente sobrenatural, oculto" },
  "lazy-shy": { label: "Tímido Perezoso", description: "Adormilado, suave, medio tímido" },
  "awe": { label: "Asombro", description: "Maravilla, reverente" },
  "shocked": { label: "Conmocionado", description: "Sorprendido, boca abierta" },

  // -------------------- Round 2 --------------------
  "flirty": { label: "Coqueto", description: "Coqueteo juguetón, sonrisa prolongada, contacto visual sostenido" },
  "suspicious": { label: "Suspicaz", description: "Desconfianza recelosa, ojos entrecerrados, mirada de reojo" },
  "resigned": { label: "Resignado", description: "Aceptación silenciosa de una situación desagradable" },
  "conflicted": { label: "Conflictuado", description: "Lucha interna visible, ceño fruncido" },
  "relieved": { label: "Aliviado", description: "La tensión se disuelve en calma" },
}

export default map
