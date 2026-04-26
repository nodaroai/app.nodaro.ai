import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Cats --------------------
  "cat-persian": { label: "Gato Persa", description: "Gato de pelo largo con cara plana, complexión robusta y pelaje esponjoso y lujoso" },
  "cat-siamese": { label: "Gato Siamés", description: "Gato de pelo corto y elegante con cuerpo color crema, puntos oscuros en cara, orejas, patas y cola, y penetrantes ojos azules en forma de almendra" },
  "cat-maine-coon": { label: "Maine Coon", description: "Gato muy grande de pelo largo con melena tupida, orejas con mechones y cola anillada esponjosa" },
  "cat-bengal": { label: "Gato Bengalí", description: "Gato musculoso y atlético con pelaje sedoso parecido al de un leopardo con rosetas en tonos dorado y marrón" },
  "cat-sphynx": { label: "Gato Sphynx", description: "Gato sin pelo con piel arrugada, grandes orejas como de murciélago, pómulos prominentes y cuerpo musculoso elegante" },
  "cat-ragdoll": { label: "Gato Ragdoll", description: "Gato grande de pelo semi-largo con pelaje sedoso y suave, puntos de color y vivos ojos azules" },
  "cat-british-shorthair": { label: "British Shorthair", description: "Gato de cara redonda y pelaje denso azul-gris, mejillas regordetas y ojos color cobre" },
  "cat-scottish-fold": { label: "Scottish Fold", description: "Gato de cara redonda con pequeñas orejas plegadas, cuerpo robusto y grandes ojos redondos como de búho" },
  "cat-tabby": { label: "Gato Atigrado", description: "Gato clásico de pelo corto con rayas, marca en forma de M en la frente y ojos verdes alertas" },
  "cat-black": { label: "Gato Negro", description: "Gato negro elegante de pelo corto con brillantes ojos amarillo-verdes y pelaje brillante" },

  // -------------------- Dogs --------------------
  "dog-labrador": { label: "Labrador Retriever", description: "Perro deportivo mediano-grande amigable con pelaje corto y denso en amarillo, negro o chocolate y una cola gruesa de nutria" },
  "dog-golden-retriever": { label: "Golden Retriever", description: "Perro mediano-grande con lujoso pelaje dorado ondulado, cola con plumas y rostro cálido y amigable" },
  "dog-german-shepherd": { label: "Pastor Alemán", description: "Perro de trabajo fuerte y alerta con pelaje en forma de silla bicolor canela y negro, orejas erguidas y cola tupida" },
  "dog-bulldog": { label: "Bulldog", description: "Perro robusto y musculoso de pelo corto con cara plana arrugada, mandíbula ancha y papada caída" },
  "dog-poodle": { label: "Poodle", description: "Perro elegante de pelaje rizado con postura orgullosa y silueta clásica recortada" },
  "dog-husky": { label: "Husky Siberiano", description: "Perro de doble pelaje grueso con marcas blanco y negro, penetrantes ojos azules o bicolor y orejas triangulares erguidas" },
  "dog-beagle": { label: "Beagle", description: "Pequeño sabueso tricolor con largas orejas caídas, pelaje corto y cola con punta blanca" },
  "dog-dachshund": { label: "Dachshund", description: "Perro alargado y de patas cortas, pecho profundo y largas orejas caídas" },
  "dog-chihuahua": { label: "Chihuahua", description: "Diminuto perro de juguete con cabeza en forma de manzana, enormes orejas erguidas y grandes ojos alertas" },
  "dog-corgi": { label: "Corgi", description: "Perro pastor de patas cortas con cara de zorro, enormes orejas erguidas y pelaje denso bicolor rojo y blanco" },
  "dog-pug": { label: "Pug", description: "Pequeño perro robusto con cara plana profundamente arrugada, cola enroscada y pelaje canela con máscara negra" },
  "dog-border-collie": { label: "Border Collie", description: "Ágil perro pastor mediano con pelaje blanco y negro, mirada intensa y cola con plumas" },
  "dog-rottweiler": { label: "Rottweiler", description: "Perro musculoso y poderoso con pelaje negro corto y brillante y características marcas color caoba en la cara, pecho y patas" },
  "dog-shiba-inu": { label: "Shiba Inu", description: "Perro tipo spitz compacto con pelaje rojo-naranja, cola enroscada, orejas triangulares erguidas y cara de zorro" },

  // -------------------- Transport / Working --------------------
  "horse": { label: "Caballo", description: "Caballo fuerte y elegante con melena y cola fluyentes, cascos firmes y cuerpo musculoso" },
  "camel": { label: "Camello", description: "Camello del desierto con joroba alta, patas largas, pies anchos almohadillados y rostro sereno" },
  "donkey": { label: "Burro", description: "Burro pequeño y robusto con orejas largas, melena erguida y rostro amable" },
  "mule": { label: "Mula", description: "Mula resistente de carga con orejas largas, melena oscura corta y cuerpo compacto musculoso" },
  "ox": { label: "Buey", description: "Enorme buey de trabajo con hombros anchos, cuernos curvos y rostro paciente y estoico" },

  // -------------------- Farm --------------------
  "cow": { label: "Vaca", description: "Vaca lechera con piel manchada blanco y negro, gran ubre y suaves ojos marrones" },
  "pig": { label: "Cerdo", description: "Cerdo de granja rosa robusto con cola enroscada, hocico redondo y orejas erguidas" },
  "sheep": { label: "Oveja", description: "Oveja lanuda y esponjosa con espeso vellón color crema, cara oscura y patas cortas" },
  "goat": { label: "Cabra", description: "Cabra ágil con pelaje desgreñado, cuernos curvos, mechón de barba y pupilas rectangulares" },
  "chicken": { label: "Gallina", description: "Gallina clásica de granja con cresta y barbillas rojas, cuerpo emplumado y cabeza alerta inclinada" },
  "rooster": { label: "Gallo", description: "Gallo orgulloso con alta cresta roja, plumas iridiscentes verde y cobre y largas plumas arqueadas en la cola" },
  "duck": { label: "Pato", description: "Pato de granja blanco y marrón con pico naranja, patas palmeadas y trasero redondeado" },
  "rabbit": { label: "Conejo", description: "Conejo esponjoso con largas orejas erguidas, nariz palpitante y cola como bola de algodón" },
  "turkey": { label: "Pavo", description: "Pavo grande con abanico de plumas oscuras iridiscentes en la cola, cabeza roja desnuda y carúncula colgante" },

  // -------------------- Wild --------------------
  "lion": { label: "León", description: "Poderoso león macho con espesa melena dorada que enmarca un rostro ancho leonado y cuerpo musculoso" },
  "tiger": { label: "Tigre", description: "Tigre enorme con llamativo pelaje naranja, atrevidas rayas negras y ojos ámbar intensos" },
  "bear": { label: "Oso", description: "Gran oso pardo con pelaje grueso y desgreñado, cabeza ancha, orejas redondas y poderosas patas con garras" },
  "polar-bear": { label: "Oso Polar", description: "Enorme oso ártico con pelaje denso blanco crema, cuello largo, hocico negro y enormes patas almohadilladas" },
  "wolf": { label: "Lobo", description: "Lobo gris esbelto con denso doble pelaje, orejas erguidas, penetrantes ojos amarillos y cola tupida" },
  "fox": { label: "Zorro", description: "Esbelto zorro rojo con hocico puntiagudo afilado, orejas erguidas y larga cola tupida con punta blanca" },
  "elephant": { label: "Elefante", description: "Elefante enorme con piel gris arrugada, larga trompa, orejas anchas que se agitan y curvos colmillos de marfil" },
  "zebra": { label: "Cebra", description: "Robusta cebra parecida a un caballo con atrevidas rayas blancas y negras, melena erguida corta y grandes ojos oscuros" },
  "giraffe": { label: "Jirafa", description: "Jirafa alta y elegante con cuello imposiblemente largo, pelaje dorado en parches y pequeños cuernos osicónicos" },
  "panda": { label: "Panda Gigante", description: "Panda regordete con pelaje blanco y negro, orejas redondas, distintivos parches negros en los ojos y rostro amable" },
  "leopard": { label: "Leopardo", description: "Leopardo elegante moteado con pelaje leonado cubierto de rosetas, hombros musculosos y penetrantes ojos pálidos" },
  "cheetah": { label: "Guepardo", description: "Guepardo esbelto y veloz con pelaje dorado de manchas negras sólidas y líneas como lágrimas que bajan por la cara" },
  "monkey": { label: "Mono", description: "Mono ágil de cola larga con expresivos ojos marrones, extremidades esbeltas y suave pelaje marrón y crema" },
  "gorilla": { label: "Gorila", description: "Enorme gorila lomo plateado con hombros anchos, prominente arco superciliar y espeso pelaje negro" },
  "kangaroo": { label: "Canguro", description: "Canguro alto con poderosas patas traseras, gruesa cola musculosa, pequeñas patas delanteras y orejas alertas erguidas" },
  "koala": { label: "Koala", description: "Marsupial gris esponjoso con cabeza redonda, grandes orejas peludas, gran nariz negra y suave pecho mullido" },
  "deer": { label: "Ciervo", description: "Ciervo elegante con pelaje marrón rojizo, patas esbeltas, parche blanco en la garganta y, en los machos, astas ramificadas" },
  "raccoon": { label: "Mapache", description: "Mapache enmascarado con pelaje gris, máscara oscura de bandido sobre los ojos y cola tupida anillada" },

  // -------------------- Birds --------------------
  "eagle": { label: "Águila", description: "Águila majestuosa con cuerpo marrón oscuro, cabeza y cola blancas, pico amarillo curvo y afiladas garras" },
  "owl": { label: "Búho", description: "Búho de cara redonda con plumaje moteado marrón y blanco, enormes ojos amarillos frontales y mechones de plumas en las orejas" },
  "parrot": { label: "Loro", description: "Loro tropical vibrante con plumaje rojo, verde, amarillo y azul saturado y pico curvo" },
  "peacock": { label: "Pavo Real", description: "Pavo real azul iridiscente con enorme cola en abanico de plumas brillantes con patrones de ojos" },
  "flamingo": { label: "Flamenco", description: "Flamenco alto y esbelto con plumaje rosa brillante, largo cuello curvo y pico curvado hacia el agua" },
  "penguin": { label: "Pingüino", description: "Pingüino erguido con esmoquin, espalda negra, vientre blanco y pequeñas alas tipo aleta" },
  "swan": { label: "Cisne", description: "Cisne blanco elegante con cuello largo curvo, pico naranja y alas delicadamente plegadas" },
  "sparrow": { label: "Gorrión", description: "Pequeño gorrión marrón y gris con espalda rayada, cuerpo redondeado y ojo negro alerta" },
  "crow": { label: "Cuervo", description: "Cuervo todo negro brillante con grueso pico recto, inteligentes ojos oscuros y plumas iridiscentes elegantes" },
  "hummingbird": { label: "Colibrí", description: "Diminuto colibrí con tonos de joya, plumaje iridiscente esmeralda y rubí y pico largo como una aguja" },

  // -------------------- Sea --------------------
  "dolphin": { label: "Delfín", description: "Delfín gris elegante con cara sonriente juguetona, aleta dorsal curva y poderosa aleta caudal" },
  "whale": { label: "Ballena", description: "Enorme ballena jorobada con cuerpo azul-gris oscuro, largas aletas pectorales y cabeza con percebes nudosa" },
  "shark": { label: "Tiburón", description: "Poderoso tiburón blanco con cuerpo gris en forma de torpedo, vientre blanco y filas de dientes afilados" },
  "octopus": { label: "Pulpo", description: "Pulpo curioso con cabeza bulbosa, grandes ojos inteligentes y ocho largos brazos con ventosas" },
  "sea-turtle": { label: "Tortuga Marina", description: "Tortuga marina elegante con caparazón verde y marrón con patrones, extremidades tipo aleta y rostro sabio arrugado" },
  "jellyfish": { label: "Medusa", description: "Medusa translúcida con cuerpo brillante en forma de campana y largos tentáculos filamentosos arrastrándose" },
  "crab": { label: "Cangrejo", description: "Cangrejo de caparazón rojo con caparazón ancho blindado, grandes pinzas y patas que se desplazan de lado" },
  "seahorse": { label: "Caballito de Mar", description: "Diminuto caballito de mar con cola prensil enroscada, cabeza parecida a la de un caballo y delicada aleta dorsal" },

  // -------------------- Small Pets --------------------
  "hamster": { label: "Hámster", description: "Hámster redondo y esponjoso con bolsas de mejillas regordetas, patitas y brillantes ojos negros como cuentas" },
  "guinea-pig": { label: "Cobaya", description: "Cobaya regordeta con suave pelaje tricolor, sin cola visible y rostro dulce y alerta" },
  "ferret": { label: "Hurón", description: "Hurón elegante de cuerpo largo con pelaje crema y marta, máscara oscura de bandido y postura juguetona" },
  "parakeet": { label: "Periquito", description: "Pequeño periquito verde y amarillo brillante con cabeza rayada, manchas oscuras en los ojos y larga cola afilada" },
  "gerbil": { label: "Jerbo", description: "Esbelto jerbo color arena con grandes ojos oscuros, orejas erguidas y larga cola con mechón" },

  // -------------------- Reptiles --------------------
  "snake": { label: "Serpiente", description: "Serpiente enroscada con cuerpo escamoso liso, piel con patrón de diamantes, pupilas rasgadas y lengua bífida que destella" },
  "lizard": { label: "Lagarto", description: "Lagarto ágil con cuerpo escamoso esbelto, larga cola tipo látigo, patas con garras y agudos ojos laterales" },
  "turtle": { label: "Tortuga", description: "Tortuga terrestre amigable con caparazón abovedado con patrones, patas escamosas robustas y rostro sabio arrugado" },
  "crocodile": { label: "Cocodrilo", description: "Enorme cocodrilo con escamas blindadas verde oliva, largo hocico dentado y poderosas extremidades con garras" },
  "chameleon": { label: "Camaleón", description: "Camaleón cambiacolor con cabeza alta con casco, ojos que giran independientemente y cola prensil firmemente enroscada" },
  "gecko": { label: "Gecko", description: "Pequeño gecko con cuerpo regordete moteado, grandes ojos sin párpados y anchas almohadillas pegajosas en los dedos" },

  // -------------------- Insects --------------------
  "butterfly": { label: "Mariposa", description: "Mariposa delicada con anchas alas con patrones en colores vivos, cuerpo esbelto y largas antenas" },
  "bee": { label: "Abeja", description: "Abeja melífera peluda con rayas amarillas y negras, alas translúcidas y patas espolvoreadas con polen" },
  "ant": { label: "Hormiga", description: "Hormiga ocupada con cuerpo oscuro segmentado, seis patas delgadas, antenas dobladas y mandíbulas fuertes" },
  "spider": { label: "Araña", description: "Araña de ocho patas con abdomen bulboso, ojos oscuros agrupados y finos pelos por todo su cuerpo" },
  "ladybug": { label: "Mariquita", description: "Diminuta mariquita roja con caparazón redondeado brillante, atrevidos puntos negros y delicadas patas asomando" },
  "dragonfly": { label: "Libélula", description: "Libélula esbelta con cuerpo iridiscente verde-azul, enormes ojos compuestos y cuatro largas alas transparentes" },
  "beetle": { label: "Escarabajo", description: "Escarabajo blindado con caparazón duro brillante, élitros estriados, patas robustas y antenas cortas" },
  "grasshopper": { label: "Saltamontes", description: "Saltamontes verde con largas patas traseras poderosas, alas plegadas a lo largo de la espalda y largas antenas tipo látigo" },
  "praying-mantis": { label: "Mantis Religiosa", description: "Mantis religiosa alargada con cabeza triangular, grandes ojos compuestos y patas delanteras espinosas mantenidas en pose de oración" },
  "mosquito": { label: "Mosquito", description: "Mosquito esbelto con largas patas finas, alas estrechas transparentes y proboscis tipo aguja" },
  "scorpion": { label: "Escorpión", description: "Escorpión del desierto con segmentos blindados, grandes pinzas y cola enroscada con aguijón levantada sobre su espalda" },
  "caterpillar": { label: "Oruga", description: "Oruga regordeta segmentada con suaves mechones, diminutas patas y postura alegre mordisqueando una hoja verde" },

  // -------------------- Dinosaurs --------------------
  "t-rex": { label: "Tyrannosaurus Rex", description: "Enorme T-Rex con poderosas patas traseras, diminutos brazos con garras, enorme mandíbula llena de dientes como dagas y gruesa piel escamosa" },
  "velociraptor": { label: "Velociraptor", description: "Velociraptor delgado con plumas, garras de hoz, larga cola rígida y postura predadora inclinada hacia adelante" },
  "triceratops": { label: "Triceratops", description: "Triceratops blindado con gran gola ósea, tres cuernos afilados en la cara y postura pesada de cuatro patas" },
  "brachiosaurus": { label: "Brachiosaurus", description: "Brachiosaurus imponente con cuello imposiblemente largo que llega a las copas de los árboles, cabeza pequeña y patas como pilares" },
  "stegosaurus": { label: "Stegosaurus", description: "Voluminoso stegosaurus con dos filas de altas placas en forma de diamante a lo largo de su espalda y cola con púas" },
  "pterodactyl": { label: "Pterodáctilo", description: "Pterodáctilo volador con vastas alas correosas, largo pico dentado y cresta inclinada hacia atrás" },
  "spinosaurus": { label: "Spinosaurus", description: "Spinosaurus depredador con alta vela en la espalda, largo hocico parecido al de un cocodrilo y poderosos brazos con garras" },
  "diplodocus": { label: "Diplodocus", description: "Enorme diplodocus de cuerpo largo con cola fina como látigo equilibrando un cuello igualmente largo, dientes como clavijas y patas robustas" },
  "ankylosaurus": { label: "Ankylosaurus", description: "Ankylosaurus tipo tanque cubierto de gruesas placas blindadas y púas, con un masivo mazo óseo al final de su cola" },
  "brontosaurus": { label: "Brontosaurus", description: "Gigante gentil brontosaurus con largo cuello extendido, cabeza pequeña, cuerpo grueso y cola que se afina como un látigo" },
  "parasaurolophus": { label: "Parasaurolophus", description: "Parasaurolophus de pico de pato con larga cresta tubular curva que se inclina hacia atrás desde su cabeza y cuerpo bípedo esbelto" },
  "allosaurus": { label: "Allosaurus", description: "Feroz allosaurus depredador con gran cabeza, pequeños cuernos en la frente, dientes serrados y poderosos brazos prensiles" },

  // -------------------- Mythical --------------------
  "dragon": { label: "Dragón", description: "Imponente dragón con alas correosas, escamas estriadas, cuernos curvos, ojos brillantes y humo saliendo de sus fosas nasales" },
  "unicorn": { label: "Unicornio", description: "Unicornio blanco puro con melena y cola pastel fluyentes y un único cuerno espiralado perlado en su frente" },
  "phoenix": { label: "Fénix", description: "Fénix majestuoso con plumaje de fuego rojo, naranja y oro, largas plumas de cola arrastrando y llamas lamiendo las puntas de sus alas" },
  "griffin": { label: "Grifo", description: "Grifo híbrido con la cabeza, alas y patas delanteras con garras de un águila y el cuerpo trasero musculoso de un león" },
  "pegasus": { label: "Pegaso", description: "Caballo alado blanco puro con alas emplumadas, melena fluyente y presencia de otro mundo" },
  "kraken": { label: "Kraken", description: "Colosal bestia marina kraken con masiva cabeza, ojos brillantes y enormes tentáculos con ventosas que se retuercen desde las profundidades" },
}

export default map
