import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Seating --------------------
  "sofa": { label: "Sofá", description: "Sofá de tres plazas con respaldo y asiento de cojines mullidos, reposabrazos bajos y tapicería en tono neutro" },
  "sectional-sofa": { label: "Sofá Seccional", description: "Sofá seccional en forma de L con asientos profundos, cojines suaves, una sección chaise y mecanismos ocultos de almacenamiento o reclinación" },
  "loveseat": { label: "Loveseat", description: "Loveseat compacto de dos plazas con brazos enrollados, respaldo capitoneado y patas de madera afiladas" },
  "armchair": { label: "Sillón", description: "Sillón tapizado con respaldo alto acolchado, reposabrazos curvos y cuatro patas de madera esbeltas" },
  "recliner": { label: "Reclinable", description: "Sillón reclinable acolchado con palanca, reposapiés extensible, gruesa tapicería de cuero y respaldo reclinado" },
  "office-chair": { label: "Silla de Oficina", description: "Silla de oficina ergonómica con respaldo de malla, reposabrazos ajustables, elevación de gas y base de cinco ruedas" },
  "rocking-chair": { label: "Mecedora", description: "Mecedora de madera con balancines curvos, respaldo de caña tejida y cojín de asiento acolchado" },
  "throne": { label: "Trono", description: "Trono real ornamentado con respaldo alto tallado, ribetes dorados, acentos enjoyados y cojín de terciopelo mullido" },
  "bean-bag": { label: "Puff", description: "Puff sobredimensionado y holgado con exterior de tela suave y forma blanda y mullida que se adapta al cuerpo" },
  "stool": { label: "Taburete", description: "Taburete simple sin respaldo con asiento redondo de madera, cuatro patas torneadas abiertas y una pátina cómoda y desgastada" },
  "bench": { label: "Banco", description: "Banco largo de madera con asiento plano, respaldo abierto de listones y patas robustas de tablones" },
  "chaise-lounge": { label: "Chaise Lounge", description: "Chaise lounge elegante con reposacabezas inclinado, asiento alargado tapizado y patas torneadas de madera" },
  "dining-chair": { label: "Silla de Comedor", description: "Silla formal de comedor con respaldo alto de listones, cojín tapizado y patas de madera afiladas" },

  // -------------------- Tables --------------------
  "dining-table": { label: "Mesa de Comedor", description: "Gran mesa rectangular de comedor con tapa de madera pulida, base gruesa de caballete y capacidad para seis a ocho comensales" },
  "coffee-table": { label: "Mesa de Centro", description: "Mesa baja rectangular de centro con tapa de cristal o madera, patas minimalistas limpias y un estante inferior para revistas" },
  "side-table": { label: "Mesa Auxiliar", description: "Pequeña mesa auxiliar con tapa redonda, un cajón y patas afiladas esbeltas" },
  "console-table": { label: "Mesa Consola", description: "Mesa consola estrecha con tapa larga delgada, patas delicadas y volutas decorativas a lo largo del faldón" },
  "desk": { label: "Escritorio", description: "Escritorio de trabajo con superficie plana, banco de cajones a un lado y un paso para cables en la parte trasera" },
  "workbench": { label: "Banco de Trabajo", description: "Banco de trabajo robusto con tapa gruesa de bloque de carnicero, panel posterior de pegboard y un torno fijado a un borde" },
  "vanity-table": { label: "Tocador", description: "Tocador con amplio espejo tríptico, pequeños cajones a cada lado y una banqueta acolchada metida debajo" },
  "nightstand": { label: "Mesita de Noche", description: "Pequeña mesita de noche con un cajón, estante inferior abierto y superficie superior lista para una lámpara" },
  "picnic-table": { label: "Mesa de Picnic", description: "Clásica mesa de picnic de madera con tapa de tablones, bancos integrados y acabado exterior desgastado" },

  // -------------------- Beds --------------------
  "bed-single": { label: "Cama Individual", description: "Cama individual estrecha con cabecero acolchado, sábana ajustable a medida y manta doblada al pie" },
  "bed-queen": { label: "Cama Queen", description: "Cama queen con cabecero alto tapizado, almohadas en capas, edredón crujiente y un caminero al pie" },
  "bed-king": { label: "Cama King", description: "Gran cama king con cabecero capitoneado, múltiples almohadas mullidas, sábanas blancas crujientes y grueso edredón acolchado" },
  "bunk-bed": { label: "Litera", description: "Litera robusta de madera con dos colchones apilados, escalera lateral, barandillas de seguridad y ropa de cama infantil a juego" },
  "canopy-bed": { label: "Cama con Dosel", description: "Cama de cuatro postes con dosel con altos postes tallados, dosel de tela y cortinas fluyentes en cada esquina" },
  "four-poster-bed": { label: "Cama de Cuatro Postes", description: "Cama de cuatro postes con columnas torneadas de madera en cada esquina que se elevan sin adornos para coincidir con el perfil tallado del cabecero" },
  "daybed": { label: "Diván", description: "Diván con marco bajo, tres lados tapizados que actúan como respaldo y reposabrazos y cojines almohadón a lo largo de la pared" },
  "crib": { label: "Cuna de Bebé", description: "Cuna de bebé de madera con lados de listones verticales, un pequeño colchón ajustable y suaves peluches metidos dentro" },
  "futon": { label: "Futón", description: "Futón convertible con colchón delgado acolchado sobre un marco metálico plegable que se convierte de sofá a cama" },
  "hammock": { label: "Hamaca", description: "Hamaca de cuerda tejida colgada entre dos soportes, cayendo suavemente con una curva acogedora y borlas coloridas en cada extremo" },

  // -------------------- Storage --------------------
  "bookshelf": { label: "Estantería", description: "Estantería independiente alta con múltiples estantes horizontales, lados de madera y filas de libros bien apilados" },
  "wardrobe": { label: "Armario", description: "Gran armario de doble puerta con sección colgante de cuerpo entero, banco de cajones y puertas decorativas con paneles" },
  "dresser": { label: "Cómoda", description: "Cómoda de madera con tapa amplia, seis cajones profundos en dos columnas, tiradores de latón y patas cortas afiladas" },
  "cabinet": { label: "Vitrina", description: "Vitrina de almacenamiento con puertas con paneles, estantes interiores ajustables y herrajes de latón" },
  "chest": { label: "Baúl de Almacenamiento", description: "Baúl de madera desgastado con bandas de hierro, tapa abovedada con bisagras y un pesado pestillo de cierre al frente" },
  "trunk": { label: "Baúl de Viaje", description: "Baúl de viaje vintage con correas de cuero, esquinas de latón, pegatinas de viaje y tapa con cerrojo que revela bandejas interiores" },
  "filing-cabinet": { label: "Archivero", description: "Archivero metálico de cuatro cajones con ranuras de etiquetas en cada cajón, tiradores empotrados y cerradura con llave en la parte superior" },
  "tv-stand": { label: "Mueble de TV", description: "Mueble bajo de TV con estantes abiertos, puertas de gabinete con frente de cristal y pasos para cables" },
  "display-case": { label: "Vitrina Expositora", description: "Vitrina expositora alta de cristal con iluminación interior, estantes de cristal y puerta enmarcada con cerrojo" },
  "hutch": { label: "Aparador Vajillero", description: "Aparador vajillero de dos partes con gabinete superior con frente de cristal mostrando platos de canto y base de buffet con cajones y puertas" },
  "toy-chest": { label: "Baúl de Juguetes", description: "Baúl de juguetes de madera pintada con calcomanías alegres, tapa con bisagras de cierre suave y pegatinas acumuladas en los lados" },

  // -------------------- Lighting --------------------
  "floor-lamp": { label: "Lámpara de Pie", description: "Lámpara de pie alta con soporte metálico esbelto, base lastrada, interruptor de cadenilla y pantalla de tela tipo tambor en la parte superior" },
  "table-lamp": { label: "Lámpara de Mesa", description: "Lámpara de mesa clásica con base de cerámica, pantalla plisada de tela y un pequeño interruptor de cadenilla" },
  "desk-lamp": { label: "Lámpara de Escritorio", description: "Lámpara de escritorio articulada con brazo ajustable, cabezal con bisagras y pequeña pantalla cónica de metal" },
  "chandelier": { label: "Candelabro Colgante", description: "Gran candelabro de cristal con cristales en cascada escalonada, brazos curvos dorados y múltiples bombillas en forma de llama" },
  "pendant-light": { label: "Lámpara Colgante", description: "Lámpara colgante moderna que cuelga de un cable largo con pantalla minimalista de metal o cristal" },
  "sconce": { label: "Aplique de Pared", description: "Aplique de pared con placa decorativa, brazo curvo y pantalla de tela o cristal apuntando hacia arriba" },
  "lantern": { label: "Farol", description: "Farol clásico con marco metálico, paneles de cristal, vela o bombilla parpadeante adentro y un anillo de transporte en la parte superior" },
  "candelabra": { label: "Candelabro", description: "Candelabro plateado ornamentado con múltiples brazos ramificados curvos cada uno sosteniendo una vela cónica alta" },
  "neon-sign": { label: "Letrero de Neón", description: "Letrero de neón brillante con tubos de cristal doblados en letras cursivas o un ícono retro, proyectando luz coloreada en la pared" },

  // -------------------- Kitchen & Dining --------------------
  "kitchen-island": { label: "Isla de Cocina", description: "Isla de cocina independiente con tapa gruesa de bloque de carnicero, almacenamiento en gabinetes debajo, voladizo para banquetas y un estante encima" },
  "bar-counter": { label: "Barra de Bar", description: "Barra de bar casera con tapa de madera pulida, riel de latón para los pies, estantes traseros iluminados de cristal y filas de botellas en exhibición" },
  "bar-stool": { label: "Banqueta de Bar", description: "Banqueta alta de bar con asiento giratorio redondo, anillo reposapiés, marco metálico y respaldo bajo opcional" },
  "pot-rack": { label: "Estante para Ollas", description: "Estante colgante para ollas con marco de hierro forjado, ganchos en S sosteniendo ollas y sartenes y estantería para especias arriba" },
  "spice-rack": { label: "Especiero", description: "Especiero montado en pared con filas de pequeños frascos de cristal etiquetados, estantes de madera y un encanto desordenado y alegre" },
  "buffet": { label: "Buffet", description: "Largo buffet de comedor con tapa plana para bandejas de servir, cajones para mantelería y puertas de gabinete para vajilla abajo" },

  // -------------------- Outdoor --------------------
  "patio-chair": { label: "Silla de Patio", description: "Silla de patio exterior con asiento de mimbre tejido resistente al clima, marco de aluminio y cojín a prueba de intemperie" },
  "adirondack-chair": { label: "Silla Adirondack", description: "Clásica silla de madera Adirondack con respaldo inclinado de listones, anchos reposabrazos planos y asiento que se inclina suavemente hacia atrás" },
  "porch-swing": { label: "Columpio de Porche", description: "Columpio de porche de madera suspendido con cadenas del techo con asiento de listones y una fila de coloridos cojines exteriores" },
  "gazebo": { label: "Gazebo", description: "Gazebo exterior independiente con techo a dos aguas con tejas, seis columnas abiertas de madera, barandales y suelo de madera elevado" },
  "bistro-set": { label: "Set de Bistró", description: "Set compacto de bistró exterior con mesa redonda de hierro forjado y dos sillas a juego con acabado brillante resistente al clima" },
  "sun-lounger": { label: "Tumbona", description: "Tumbona junto a la piscina con respaldo reclinable ajustable, correas blancas de vinilo y mesa lateral a juego" },
  "fire-pit": { label: "Hoguera", description: "Cuenco redondo de hoguera exterior con exterior de hierro rugoso, llamas parpadeantes y brasas brillantes bajo una pantalla protectora de malla" },

  // -------------------- Decorative --------------------
  "mirror": { label: "Espejo", description: "Gran espejo de pared con marco dorado ornamentado, volutas talladas y plateado ligeramente envejecido en el cristal" },
  "rug": { label: "Alfombra", description: "Gran alfombra de área con motivos tejidos intricados, extremos con borlas y suave pelaje mullido" },
  "vase": { label: "Jarrón", description: "Jarrón alto de cerámica con cuerpo redondeado, cuello estrecho, acabado vidriado y un fresco ramo de flores arreglado adentro" },
  "grandfather-clock": { label: "Reloj de Pie", description: "Alto reloj de pie de madera con puerta de péndulo de cristal, esfera de latón, números romanos y mecanismo de carillón" },
  "wall-art": { label: "Arte de Pared Enmarcado", description: "Gran obra de arte enmarcada con marco dorado o minimalista, borde tipo galería con paspartú y una sola pintura focal" },
  "pillow": { label: "Cojín Decorativo", description: "Cojín decorativo con funda con patrón, bordes ribeteados, relleno mullido y cierre invisible de cremallera" },
  "curtains": { label: "Cortinas", description: "Cortinas de cuerpo entero con tela gruesa que cae, tops plisados colgando de una barra metálica y alzapaños a cada lado" },
  "sculpture": { label: "Escultura", description: "Escultura abstracta sobre pedestal con formas orgánicas fluyentes en bronce o mármol captando la luz desde múltiples ángulos" },

  // -------------------- Bath --------------------
  "bathtub": { label: "Bañera", description: "Bañera independiente con patas de garra, borde enrollado, interior de esmalte blanco pulido y cuatro patas ornamentadas de hierro fundido" },
  "shower": { label: "Ducha de Acceso Directo", description: "Ducha de acceso directo con paneles de cristal sin marco, paredes embaldosadas, alcachofa de lluvia y desagüe lineal en el suelo" },
  "toilet": { label: "Inodoro", description: "Inodoro estándar de cerámica blanca con taza ovalada, asiento alargado y tanque con palanca de descarga cromada" },
  "sink-vanity": { label: "Mueble de Lavabo", description: "Mueble de lavabo de baño con encimera de piedra, lavabo bajo encimera, espejo amplio arriba y puertas de gabinete con paneles abajo" },
  "towel-rack": { label: "Toallero", description: "Toallero calefaccionado montado en pared con múltiples barras horizontales y toallas dobladas mullidas colgadas sobre cada barra" },
}

export default map
