import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Devices / Phones --------------------
  "smartphone": { label: "Smartphone", description: "Teléfono moderno en la mano" },
  "smartphone-raised": { label: "Teléfono Levantado", description: "Teléfono levantado a media foto" },
  "polaroid-camera": { label: "Cámara Polaroid", description: "Cámara instantánea vintage" },
  "vintage-camera": { label: "Cámara Vintage", description: "Vieja cámara de película con correa" },
  "dslr-camera": { label: "Cámara DSLR", description: "Cámara DSLR / mirrorless moderna" },
  "video-camera": { label: "Videocámara", description: "Videocámara montada al hombro" },
  "microphone": { label: "Micrófono", description: "Micrófono vocal de mano" },
  "megaphone": { label: "Megáfono", description: "Bocina / megáfono" },
  "smartwatch": { label: "Smartwatch", description: "Muñeca levantada para revisar el reloj" },

  // -------------------- Drinks --------------------
  "coffee-cup": { label: "Taza de Café", description: "Taza de café de cerámica" },
  "takeaway-coffee": { label: "Café Para Llevar", description: "Vaso de papel para café para llevar" },
  "wine-glass": { label: "Copa de Vino", description: "Copa con tallo de vino tinto" },
  "champagne-flute": { label: "Copa de Champán", description: "Copa flauta alta de champán" },
  "martini-glass": { label: "Copa de Martini", description: "Copa clásica de martini" },
  "cocktail-glass": { label: "Vaso de Cóctel", description: "Vaso corto con cóctel" },
  "beer-bottle": { label: "Botella de Cerveza", description: "Botella marrón de cerveza" },
  "water-bottle": { label: "Botella de Agua", description: "Botella reutilizable de agua" },

  // -------------------- Smoking --------------------
  "cigarette": { label: "Cigarrillo", description: "Cigarrillo encendido entre los dedos" },
  "cigar": { label: "Cigarro", description: "Cigarro grueso encendido" },
  "vape-pen": { label: "Pluma de Vape", description: "Pluma esbelta de vape" },
  "joint": { label: "Porro", description: "Porro liado a mano" },

  // -------------------- Reading / Writing --------------------
  "book": { label: "Libro", description: "Libro de tapa dura abierto" },
  "magazine": { label: "Revista", description: "Revista brillante doblada" },
  "newspaper": { label: "Periódico", description: "Periódico tipo broadsheet doblado" },
  "notebook": { label: "Cuaderno", description: "Cuaderno de líneas abierto" },
  "pen": { label: "Pluma", description: "Pluma a media escritura" },
  "marker": { label: "Marcador", description: "Marcador grueso a media trazo" },
  "paintbrush": { label: "Pincel", description: "Pincel cargado de pintura" },
  "chalk": { label: "Tiza", description: "Barra de tiza blanca" },

  // -------------------- Bags / Accessories --------------------
  "handbag": { label: "Bolso", description: "Bolso de diseñador" },
  "tote-bag": { label: "Bolso Tote", description: "Bolso tote suave de lona" },
  "briefcase": { label: "Maletín", description: "Maletín de carcasa rígida" },
  "umbrella": { label: "Paraguas", description: "Paraguas negro abierto" },
  "fan-folding": { label: "Abanico Plegable", description: "Abanico abierto pintado a mano" },

  // -------------------- Floral / Nature --------------------
  "bouquet": { label: "Ramo", description: "Ramo mixto de flores" },
  "single-rose": { label: "Una Rosa", description: "Una sola rosa de tallo largo" },
  "sunflower": { label: "Girasol", description: "Un girasol alto" },
  "leaf": { label: "Hoja", description: "Una hoja grande" },
  "fruit-apple": { label: "Manzana", description: "Una manzana fresca" },

  // -------------------- Instruments / Performance --------------------
  "guitar": { label: "Guitarra", description: "Guitarra colgada al cuerpo" },
  "violin": { label: "Violín", description: "Violín bajo el mentón" },
  "saxophone": { label: "Saxofón", description: "Saxofón llevado a los labios" },
  "drumsticks": { label: "Baquetas", description: "Par de baquetas cruzadas" },
  "sheet-music": { label: "Partitura", description: "Partitura doblada" },

  // -------------------- Companion --------------------
  "small-dog": { label: "Perro Pequeño", description: "Perro pequeño en brazos" },
  "cat": { label: "Gato", description: "Gato sobre el brazo" },
  "plush-toy": { label: "Peluche", description: "Suave peluche abrazado" },

  // -------------------- Occupational / Weapon --------------------
  "katana": { description: "Espada japonesa de un solo filo" },
  "pointer-stick": { label: "Bastón Puntero", description: "Bastón puntero telescópico" },
  "gavel": { label: "Mazo de Juez", description: "Mazo judicial de madera" },
  "wine-bottle": { label: "Botella de Vino", description: "Botella llena con sello de papel aluminio" },
}

export default map
