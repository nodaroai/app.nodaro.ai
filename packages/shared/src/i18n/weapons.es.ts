import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Swords --------------------
  "katana": { description: "Katana japonesa con hoja de un solo filo suavemente curvada, mango envuelto en piel de raya, guarda de tsuba en disco y acabado pulido tipo espejo" },
  "longsword": { label: "Espada Larga", description: "Espada larga medieval de doble filo con hoja recta que se afina, guarda cruzada, empuñadura envuelta en cuero y un pomo redondo" },
  "broadsword": { label: "Espada Ancha", description: "Pesada espada ancha con hoja recta de doble filo, guarda de canasta y empuñadura robusta envuelta en cuero" },
  "rapier": { label: "Estoque", description: "Estoque delgado con hoja larga estrecha de estocada, guarda de canasta ornamentada y un pomo esférico" },
  "saber": { label: "Sable", description: "Sable de caballería con hoja curvada de un solo filo, guarda de nudillo de latón y empuñadura de cuero acanalada" },
  "scimitar": { label: "Cimitarra", description: "Cimitarra curvada con hoja ancha de un solo filo, guarda cruzada ornamentada y un pomo metálico redondeado" },
  "claymore": { description: "Masiva claymore escocesa de dos manos con hoja recta larga, guarda cruzada inclinada hacia adelante y una gran empuñadura unida con cuero" },
  "cutlass": { label: "Cutlass", description: "Cutlass pirata con hoja corta curvada de un solo filo, protección de mano de copa de latón y empuñadura de madera curtida" },
  "wakizashi": { description: "Wakizashi japonesa de hoja corta acompañante con borde suavemente curvado, pequeña tsuba y mango envuelto en piel de raya" },
  "falchion": { label: "Falchion", description: "Falchion pesado de un solo filo con hoja en forma de cuchilla afilándose, guarda cruzada simple y empuñadura de cuero remachada" },

  // -------------------- Daggers & Knives --------------------
  "dagger": { label: "Daga", description: "Clásica daga de doble filo con hoja estrecha puntiaguda, guarda cruzada y empuñadura de cuero envuelta" },
  "bowie-knife": { description: "Gran cuchillo bowie con hoja de punta clip, guarda de latón, mango de arandelas de cuero apilado y guarda cruzada" },
  "kukri": { description: "Kukri nepalés con hoja ancha curvada hacia adelante, mango de madera y distintiva recurva angulada hacia adentro" },
  "stiletto": { label: "Estilete", description: "Estilete delgado con hoja triangular larga delgada como aguja, guarda cruzada mínima y mango afilado" },
  "dirk": { description: "Dirk escocés con hoja recta larga de un solo filo, mango entrelazado con nudo celta y un pomo ornamentado" },
  "tanto": { description: "Daga tanto japonesa con punta angular tipo cincel, pequeña tsuba y mango envuelto en piel de raya" },
  "switchblade": { label: "Navaja Automática", description: "Navaja automática de bolsillo con hoja plegable accionada por resorte, paneles laterales de nácar o resina y un botón de liberación pulido" },
  "trench-knife": { label: "Cuchillo de Trinchera", description: "Cuchillo militar de trinchera con hoja delgada de doble filo y una empuñadura de manopla de latón envolviendo la empuñadura" },

  // -------------------- Axes --------------------
  "battle-axe": { label: "Hacha de Batalla", description: "Pesada hacha de batalla a dos manos con borde de corte ancho curvado, perfil con barba y un mango largo de madera atado con bandas de hierro" },
  "tomahawk": { label: "Tomahawk", description: "Tomahawk ligero de lanzar con pequeña cabeza de hierro de un solo filo, mango recto de madera y envoltura de cuero cerca de la empuñadura" },
  "hatchet": { label: "Hacha de Mano", description: "Hacha de mano compacta con mango corto de madera, pequeña cabeza de acero de un solo filo y acabado martillado" },
  "halberd": { label: "Alabarda", description: "Alabarda de palo largo combinando una hoja de hacha, una punta de lanza para estocar y un gancho trasero sobre un alto eje de madera" },
  "greataxe": { label: "Hacha Grande", description: "Hacha grande masiva con enorme cabeza de doble filo en forma de creciente, bandas de refuerzo de hierro y un mango largo y pesado que requiere dos manos" },
  "bearded-axe": { label: "Hacha con Barba", description: "Hacha vikinga con barba con borde inferior de hoja alargado, cabeza estrecha de hierro y un alto mango de madera envuelto con cuero" },

  // -------------------- Polearms --------------------
  "spear": { label: "Lanza", description: "Lanza simple con punta de hierro en forma de hoja atada a un alto eje recto de madera y un pequeño tope en la base" },
  "lance": { label: "Lanza de Justa", description: "Lanza de justa con un eje largo de madera, punta cónica de acero y una guarda de mano abocinada protegiendo la empuñadura" },
  "pike": { label: "Pica", description: "Pica muy larga con una pequeña punta de lanza triangular montada en lo alto de un mástil de madera imponente del doble de la altura de un hombre" },
  "glaive": { label: "Glaive", description: "Polearm glaive con hoja larga curvada de un solo filo montada en un eje de madera, afilándose hasta una pequeña guarda cruzada" },
  "trident": { label: "Tridente", description: "Tridente de tres puntas con púas afiladas con barba, un eje central y un largo poste de madera" },
  "naginata": { description: "Naginata japonesa con hoja curvada de un solo filo montada en un largo poste de madera lacada con envolturas de seda" },

  // -------------------- Bows & Crossbows --------------------
  "longbow": { label: "Arco Largo", description: "Alto arco largo inglés con una sola pieza de madera de tejo, cuerda de lino encerada y empuñadura envuelta en cuero" },
  "recurve-bow": { label: "Arco Recurvo", description: "Arco recurvo tradicional con extremidades que se curvan alejándose del arquero, riser envuelto en cuero y una cuerda tensa" },
  "compound-bow": { label: "Arco Compuesto", description: "Arco compuesto moderno con levas de aluminio, ruedas de polea en cada punta, descanso de flecha de fibra de carbono y un arreglo de pines de mira" },
  "crossbow": { label: "Ballesta", description: "Ballesta medieval con culata horizontal de madera, prod de acero, cuerda tensa y un mecanismo de gatillo bajo el riel" },
  "short-bow": { label: "Arco Corto", description: "Arco corto compacto de madera con perfil curvado simple, una cuerda encerada y empuñadura de cuero en el medio" },

  // -------------------- Blunt & Impact --------------------
  "mace": { label: "Maza", description: "Maza medieval con bridas con cabeza pesada coronada con bridas de hierro sobresalientes en un eje corto de hierro" },
  "war-hammer": { label: "Martillo de Guerra", description: "Martillo de guerra de mango largo con cabeza pesada de hierro con cara plana de golpeo en un lado y una púa curvada en el otro" },
  "club": { label: "Garrote", description: "Garrote simple de madera con cabeza nudosa gruesa, eje afilándose y una empuñadura de cuero gastada cerca de la base" },
  "morning-star": { label: "Lucero del Alba", description: "Lucero del alba con eje de madera coronado por una gran bola de hierro erizada de altas púas en todas direcciones" },
  "flail": { label: "Mangual", description: "Mangual militar con bola de hierro con púas conectada por una cadena corta a un mango de madera con tapa final de hierro" },
  "nunchaku": { label: "Nunchaku", description: "Nunchaku de artes marciales con dos bastones de madera pulidos conectados por una corta longitud de cuerda trenzada o cadena" },

  // -------------------- Throwing --------------------
  "shuriken": { description: "Estrella arrojadiza metálica con múltiples puntas afiladas como navajas que irradian desde un cubo central y un acabado de acero ennegrecido" },
  "throwing-knife": { label: "Cuchillo de Lanzar", description: "Cuchillo de lanzar balanceado con hoja en forma de hoja de doble filo, mango mínimo y un acabado de acero pulido" },
  "boomerang": { label: "Boomerang", description: "Boomerang de madera curvado con codo doblado, patrones tribales pintados y un perfil aerodinámico suave" },
  "javelin": { label: "Jabalina", description: "Ligera jabalina de lanzar con punta delgada de acero, eje de madera afilado y un envoltorio de cuero cerca del punto de equilibrio" },
  "bolas": { label: "Boleadoras", description: "Tres bolas de piedra o hierro con peso atadas con cuerdas trenzadas de cuero que se encuentran en un nudo central" },

  // -------------------- Modern Firearms --------------------
  "pistol": { label: "Pistola", description: "Pistola semiautomática moderna con marco de polímero negro mate, corredera estriada, guardamonte y base de cargador a ras" },
  "revolver": { label: "Revólver", description: "Revólver de seis tiros con cilindro giratorio, cañón largo, martillo amartillado hacia atrás y una empuñadura de madera cuadriculada" },
  "assault-rifle": { label: "Rifle de Asalto", description: "Rifle de asalto militar con cañón largo, culata plegable, mira óptica en el riel y un cargador desmontable curvado" },
  "shotgun": { label: "Escopeta", description: "Escopeta de acción de bombeo con cañón de calibre amplio, frente táctica, cargador tubular debajo y una culata de madera o sintética" },
  "smg": { label: "Subfusil", description: "Subfusil compacto con cañón corto, cargador montado lateralmente, culata de alambre plegable y empuñadura delantera integral" },
  "sniper-rifle": { label: "Rifle de Francotirador", description: "Rifle de francotirador de cerrojo con cañón largo, mira de alta magnificación, bípode y una culata ergonómica de polímero" },
  "machine-gun": { label: "Ametralladora", description: "Pesada ametralladora alimentada por cinta con cañón largo con aletas, bípode, asa de transporte y una cinta de munición alimentando desde el lado" },

  // -------------------- Historical Firearms --------------------
  "musket": { label: "Mosquete", description: "Largo mosquete de chispa con cañón liso de hierro, culata de nogal, herrajes de latón y una bayoneta fijada cerca de la boca" },
  "flintlock-pistol": { label: "Pistola de Chispa", description: "Pistola de chispa ornamentada con empuñadura curvada de madera, herrajes de latón grabados, un martillo de pedernal y un solo cañón largo" },
  "blunderbuss": { label: "Trabuco", description: "Corto trabuco de chispa con boca abocinada, herrajes de latón en una culata robusta de madera y presencia de era pirata" },
  "dueling-pistol": { label: "Pistola de Duelo", description: "Elegante pistola de duelo con cañón octogonal delgado, mecanismo de cerradura finamente grabado y una empuñadura de nogal pulida" },

  // -------------------- Explosives & Siege --------------------
  "grenade": { label: "Granada", description: "Granada de fragmentación de hierro con textura de piña con palanca cuchara sostenida en su lugar por un pin de seguridad jalado" },
  "stick-grenade": { label: "Granada de Mango", description: "Granada de mango cilíndrica con cabeza de hierro montada en lo alto de un largo mango de madera y un fusible de cuerda en la base" },
  "dynamite": { label: "Dinamita", description: "Cartuchos rojos de dinamita atados envueltos con hilo y unidos a un largo fusible chisporroteante con una punta ardiendo" },
  "bomb": { label: "Bomba de Caricatura", description: "Bomba redonda negra de caricatura con un fusible enrollado humeante saliendo de la parte superior y una brillante carcasa esférica de hierro" },
  "rocket-launcher": { label: "Lanzacohetes", description: "Lanzacohetes disparado al hombro con tubo largo, empuñadura delantera, cono de escape trasero y mira óptica de objetivo" },
  "cannon": { label: "Cañón", description: "Cañón de avancarga de hierro fundido montado en un carruaje de madera con ruedas con un largo cañón de ánima lisa y un respiradero humeante" },
  "catapult": { label: "Catapulta", description: "Catapulta de asedio de madera con un largo brazo de lanzamiento amartillado hacia atrás, un contrapeso o haz de torsión y una canasta cargada con piedra" },
  "trebuchet": { label: "Trabuquete", description: "Alto trabuquete medieval con un contrapeso masivo, brazo de lanzamiento largo, honda trenzada y un marco pesado de madera" },

  // -------------------- Sci-Fi --------------------
  "laser-pistol": { label: "Pistola Láser", description: "Compacta pistola láser sci-fi con bobinas de energía neón brillantes, cuerpo metálico estriado y un corto cañón emisor" },
  "plasma-rifle": { label: "Rifle de Plasma", description: "Rifle de plasma futurista con células de energía azul brillantes, cubiertas ventiladas del cañón y una mira holográfica" },
  "lightsaber": { label: "Sable de Luz", description: "Espada láser con mango metálico estriado emitiendo una hoja brillante alta de energía saturada con un halo de plasma brumoso" },
  "blaster": { label: "Bláster", description: "Pistola bláster retrofuturista con cuerpo robusto, cámara de energía brillante, ventilaciones de enfriamiento y una mira montada arriba" },
  "phaser": { label: "Faser", description: "Elegante faser sci-fi con empuñadura curva minimalista, punta emisora brillante y un panel liso controlando la intensidad" },
  "rail-gun": { label: "Cañón de Riel", description: "Pesado cañón de riel electromagnético con rieles metálicos paralelos, condensadores masivos a lo largo del cuerpo y una cámara de proyectil brillante" },
  "emp-grenade": { label: "Granada EMP", description: "Granada esférica de pulso electromagnético con bobinas expuestas, luces indicadoras azules brillantes y un dial de armado holográfico" },

  // -------------------- Fantasy / Magical --------------------
  "enchanted-sword": { label: "Espada Encantada", description: "Espada encantada con hoja grabada con runas brillantes, guarda cruzada incrustada de oro y una piedra preciosa incrustada en el pomo" },
  "magic-staff": { label: "Bastón Mágico", description: "Alto bastón nudoso de mago con eje retorcido de madera terminando en una corona de ramas que sostiene un cristal brillante" },
  "runed-dagger": { label: "Daga Rúnica", description: "Daga mística con hoja inscrita en runas brillantes, mango de hueso y energía oscura arremolinándose a lo largo del borde" },
  "wizard-wand": { label: "Varita de Mago", description: "Esbelta varita de madera con remolinos moleteados, empuñadura de cuero y diminutas chispas de magia escapando de la punta" },
  "war-horn": { label: "Cuerno de Guerra", description: "Masivo cuerno de guerra curvado atado en cuero y bandas de plata con boquilla en un extremo y una abertura abocinada en el otro" },
  "sorcerer-orb": { label: "Orbe de Hechicero", description: "Orbe de hechicero de cristal sostenido en un soporte de garra retorcida de plata con niebla arcana arremolinada suspendida dentro de la esfera de vidrio" },
}

export default map
