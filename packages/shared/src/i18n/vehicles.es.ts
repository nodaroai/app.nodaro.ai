import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Classic Cars --------------------
  "muscle-car": { label: "Muscle Car", description: "Muscle car estadounidense agresivo con capó largo, postura ancha, escapes cromados duales y profunda presencia de V8" },
  "car-57-chevy": { description: "Icónico Chevrolet Bel Air de 1957 con aletas, parachoques cromados, pintura bicolor y neumáticos de banda blanca" },
  "hot-rod": { label: "Hot Rod", description: "Hot rod recortado y rebajado con pintura de llamas, motor cromado expuesto, neumáticos traseros gordos y delanteros delgados" },
  "vintage-roadster": { label: "Roadster Vintage", description: "Roadster descapotable de antes de la guerra con guardabarros amplios, estribos, ruedas con radios de alambre y un capó largo pulido" },
  "model-t": { label: "Ford Model T", description: "Modelo T negro de principios del siglo XX con cuerpo cuadrado erguido, faros de latón, ruedas con rayos y motor de manivela" },
  "vw-beetle": { label: "VW Beetle", description: "Volkswagen Beetle pastel redondeado con capó curvo, motor trasero refrigerado por aire y cara animada como un insecto" },
  "checker-cab": { label: "Taxi Checker", description: "Clásico taxi checker amarillo de Nueva York con cuerpo cuadrado, banda checker blanca y negra y luz de techo" },
  "woody-wagon": { label: "Woody Wagon", description: "Camioneta de la era surf con puertas laterales con paneles de madera, parachoques cromados y portón trasero largo" },
  "lowrider": { label: "Lowrider", description: "Lowrider con pintura caramelo, suspensión hidráulica, ruedas de radios cromadas, neumáticos de banda blanca y murales aerografiados" },

  // -------------------- Everyday Cars --------------------
  "sedan": { label: "Sedán", description: "Sedán de cuatro puertas tamaño mediano con silueta aerodinámica, acentos cromados y faros LED modernos" },
  "suv": { label: "SUV", description: "Vehículo utilitario deportivo grande con postura alta, rieles de techo, grandes ruedas de aleación y cuerpo musculoso cuadrado" },
  "hatchback": { label: "Hatchback", description: "Hatchback compacto con parte trasera corta, portón levadizo, proporciones ágiles y pintura brillante" },
  "minivan": { label: "Minivan", description: "Minivan familiar con puertas laterales corredizas, cabina alta espaciosa, ventanas traseras tintadas y un amplio portón trasero" },
  "station-wagon": { label: "Camioneta Familiar", description: "Camioneta familiar de techo largo con área de carga extendida, ventanas traseras laterales y silueta orientada a la familia" },
  "crossover": { label: "Crossover", description: "Crossover SUV mediano con altura de marcha elevada, estilo similar a un auto y acentos LED aerodinámicos" },
  "electric-car": { label: "Auto Eléctrico", description: "Auto eléctrico moderno y elegante con frente sin parrilla suave, manijas a ras y líneas limpias aerodinámicas" },
  "hatchback-econobox": { label: "Auto Económico", description: "Pequeño auto urbano de dos puertas asequible con capó corto, ruedas pequeñas y estilo compacto sencillo" },

  // -------------------- Performance / Exotic --------------------
  "sports-car": { label: "Auto Deportivo", description: "Auto deportivo de dos puertas bajo con postura amplia agresiva, carrocería aerodinámica y pintura brillante" },
  "supercar": { label: "Supercar", description: "Supercar exótico con motor central, puertas tijera, capó ultra-bajo, enormes tomas traseras y alerón trasero de fibra de carbono" },
  "convertible": { label: "Convertible", description: "Convertible de dos asientos con la capota plegada, capó largo esculpido y viento pasando por puertas bajas" },
  "grand-tourer": { label: "Gran Turismo", description: "Coupé gran turismo elegante con capó largo fluido, cuatro escapes y proporciones lujosas" },
  "roadster": { label: "Roadster", description: "Roadster compacto de dos asientos con parabrisas envolvente, capota plegada y silueta clásica con techo abierto" },
  "racing-car": { label: "Auto de Carreras", description: "Auto de carreras fórmula de ruedas abiertas con neumáticos lisos, gran alerón trasero, cabina con halo y pontones aerodinámicos cubiertos de logos de patrocinadores" },
  "rally-car": { label: "Auto de Rally", description: "Hatchback de rally salpicado de barro con neumáticos con tacos, enormes guardabarros, luces montadas en el techo y librea de carreras" },
  "drift-car": { label: "Auto de Drift", description: "Coupé tuneado para drift agresivo con kit de carrocería ancho, alerón trasero sobredimensionado, neón debajo y humo de neumáticos detrás" },

  // -------------------- Motorcycles --------------------
  "sportbike": { label: "Moto Deportiva", description: "Motocicleta deportiva aerodinámica con postura agachada, carenado completo, neumáticos pegajosos y gráficos brillantes estilo carreras" },
  "cruiser": { label: "Cruiser", description: "Motocicleta cruiser de bajo perfil con tanque largo en forma de lágrima, manillares barridos hacia atrás, escapes cromados y neumático trasero gordo" },
  "chopper": { label: "Chopper", description: "Chopper personalizada estirada con frente inclinado, manillares ape-hanger altos, rueda delantera delgada y cromo por todas partes" },
  "dirt-bike": { label: "Moto de Cross", description: "Moto de cross todoterreno con neumáticos con tacos, suspensión alta, carenado plástico en colores brillantes y manillares altos" },
  "scooter": { label: "Scooter", description: "Scooter compacto de paso a través con carcasa lisa, ruedas pequeñas, reposapiés plano y bulto de almacenamiento bajo el asiento" },
  "moped": { label: "Ciclomotor", description: "Pequeño ciclomotor con arranque a pedal con marco simple de acero, canasta delante y un pequeño motor de gasolina bajo el asiento" },
  "cafe-racer": { label: "Café Racer", description: "Motocicleta café racer despojada con manillares clip-on, asiento solo con joroba, marco expuesto y tanque minimalista" },

  // -------------------- Bicycles & Human-Powered --------------------
  "road-bike": { label: "Bicicleta de Ruta", description: "Bicicleta de ruta ligera con manillar de caída, neumáticos delgados de alta presión y marco aerodinámico de fibra de carbono" },
  "mountain-bike": { label: "Bicicleta de Montaña", description: "Bicicleta de montaña robusta con neumáticos con tacos, horquilla de suspensión delantera, manillar plano y marco salpicado de barro" },
  "bmx": { label: "Bicicleta BMX", description: "Bicicleta BMX de acrobacias con marco pequeño, pegs en los ejes, neumáticos gruesos y manillar con travesaño" },
  "cruiser-bike": { label: "Bicicleta Playera", description: "Bicicleta cruiser playera relajada con marco curvo, manillar barrido hacia atrás, asiento ancho y neumáticos balón" },
  "penny-farthing": { description: "Bicicleta penny-farthing victoriana con una enorme rueda delantera, una rueda trasera diminuta y un sillín de cuero encaramado en lo alto" },
  "unicycle": { label: "Monociclo", description: "Monociclo de una sola rueda con tija de sillín alta, pedales simples en el cubo y un look minimalista de circo" },
  "skateboard": { label: "Patineta", description: "Tabla de patineta de madera con cinta antideslizante encima, cuatro ruedas de poliuretano y arte gráfico colorido en la parte inferior" },
  "kick-scooter": { label: "Patinete", description: "Patinete de dos ruedas con manillar T alto, plataforma estrecha y pequeñas ruedas duras" },

  // -------------------- Trucks --------------------
  "pickup-truck": { label: "Camioneta Pickup", description: "Camioneta pickup de tamaño completo con cabina alta, caja trasera abierta, parrilla cromada y neumáticos todo terreno agresivos" },
  "semi-truck": { label: "Camión Tráiler", description: "Camión tráiler de larga distancia con cabina dormitorio, escapes cromados altos y enorme remolque articulado detrás" },
  "dump-truck": { label: "Volquete", description: "Volquete de servicio pesado con caja basculante elevada, enormes neumáticos todo terreno y librea amarilla de construcción" },
  "tow-truck": { label: "Grúa", description: "Grúa con pluma hidráulica, gancho y plataforma plana de recuperación, luces ámbar de advertencia rotativas y rótulos llamativos" },
  "delivery-van": { label: "Furgoneta de Reparto", description: "Furgoneta blanca de reparto con bodega de carga cuadrada, puerta lateral corrediza, rieles de techo y calcomanías corporativas" },
  "ice-cream-truck": { label: "Camión de Helados", description: "Alegre camión de helados con pintura pastel, ventana de servicio mostrando golosinas, calcomanías coloridas y un adorno cónico en el techo" },
  "food-truck": { label: "Food Truck", description: "Food truck estilizado con ventana de servicio plegable, menú de pizarra, luces colgantes y un envoltorio personalizado brillante" },
  "box-truck": { label: "Camión de Caja", description: "Camión de caja mediano con caja de carga rectangular sencilla, puerta trasera enrollable y cabina delantera" },

  // -------------------- Transit --------------------
  "city-bus": { label: "Autobús Urbano", description: "Autobús urbano articulado moderno con suelo bajo, puertas corredizas, cartel de destino al frente y envoltorio publicitario" },
  "school-bus": { label: "Autobús Escolar", description: "Clásico autobús escolar amarillo estadounidense con borde negro, señales de stop rojas intermitentes, brazo de stop extendido y números estarcidos en negro" },
  "double-decker": { label: "Autobús de Dos Pisos", description: "Icónico autobús rojo de dos pisos con techo redondeado, escalera abierta dentro y rollo de destino al frente" },
  "coach-bus": { label: "Autocar", description: "Autocar de larga distancia con ventanas panorámicas tintadas, bahías de equipaje debajo y carrocería aerodinámica" },
  "train": { label: "Tren", description: "Tren de pasajeros moderno con nariz aerodinámica elegante, ventanas panorámicas y línea de vagones brillantes" },
  "steam-locomotive": { label: "Locomotora de Vapor", description: "Locomotora de vapor negra con chimenea alta echando vapor, caldera, bielas conectoras y un tender de carbón detrás" },
  "bullet-train": { label: "Tren Bala", description: "Tren bala de alta velocidad con nariz aerodinámica puntiaguda, librea blanco y azul lisa y ventanas estrechas" },
  "subway": { label: "Tren del Metro", description: "Vagón de metro de acero inoxidable con paneles resistentes al grafiti, puertas corredizas y filas de luces fluorescentes adentro" },
  "tram": { label: "Tranvía", description: "Tranvía urbano clásico con cuerpo cuadrado con marco de madera, pantógrafo aéreo y rieles corriendo por debajo" },
  "stagecoach": { label: "Diligencia", description: "Diligencia del Lejano Oeste con cuerpo de madera, suspensión de ballesta, portaequipajes en el techo y un equipo de caballos enganchados al frente" },
  "horse-carriage": { label: "Carruaje Tirado por Caballos", description: "Carruaje tirado por caballos ornamentado con paneles de madera pulida, grandes ruedas con radios y cabina tapizada en terciopelo" },

  // -------------------- Aircraft --------------------
  "airliner": { label: "Avión Comercial", description: "Avión comercial de fuselaje ancho con dos motores de jet bajo alas en flecha, filas de ventanas ovales y cola alta en flecha" },
  "biplane": { label: "Biplano", description: "Biplano vintage con dos alas apiladas conectadas por puntales y arriostramiento de cables, una cabina abierta y una hélice de madera" },
  "propeller-plane": { label: "Avión de Hélice", description: "Pequeño avión monomotor de hélice con hélice giratoria, alas altas, tren de aterrizaje fijo y una cabina en burbuja" },
  "helicopter": { label: "Helicóptero", description: "Helicóptero utilitario con un gran rotor principal en la parte superior, un brazo de cola delgado, patines debajo y cabina con frente en burbuja" },
  "seaplane": { label: "Hidroavión", description: "Hidroavión con flotadores gemelos en lugar de ruedas, alas altas y una hélice, descansando sobre aguas tranquilas" },
  "hot-air-balloon": { label: "Globo Aerostático", description: "Gigantesco globo aerostático con envoltura rayada colorida, un quemador de llamas en alto y una canasta de mimbre debajo" },
  "blimp": { label: "Dirigible", description: "Dirigible en forma de salchicha con envoltura plateada lisa, pequeñas aletas traseras y una góndola colgada debajo" },
  "glider": { label: "Planeador", description: "Planeador elegante con alas ultralargas y estrechas, sin motor y una cápsula de cabina en forma de lágrima" },
  "drone": { label: "Dron", description: "Dron quadcopter con cámara con cuatro rotores giratorios en brazos delgados, un cuerpo central y una cámara con gimbal debajo" },

  // -------------------- Watercraft --------------------
  "yacht": { label: "Yate", description: "Elegante yate de motor de lujo con múltiples cubiertas, ventanas tintadas, mástil de radar y casco blanco brillante cortando agua azul" },
  "sailboat": { label: "Velero", description: "Velero gracioso con un mástil alto, velas blancas tensas atrapando el viento y un casco de fibra de vidrio estrecho" },
  "speedboat": { label: "Lancha Rápida", description: "Lancha motora rápida con casco profundo en V puntiagudo, parabrisas bajo y un motor fueraborda rugiendo levantando una estela" },
  "cruise-ship": { label: "Crucero", description: "Crucero masivo con múltiples cubiertas altas, filas de balcones, chimeneas brillantes y una proa puntiaguda" },
  "cargo-ship": { label: "Buque de Carga", description: "Gigantesco buque de carga de contenedores apilado alto con contenedores de envío de colores arcoíris, una torre de puente en la popa" },
  "canoe": { label: "Canoa", description: "Canoa clásica de madera con proa y popa puntiagudas, interior con costillas de cedro y un solo remo descansando dentro" },
  "kayak": { label: "Kayak", description: "Kayak delgado de plástico con bajo perfil, abertura de cabina cerrada y un remo de doble pala" },
  "rowboat": { label: "Bote de Remos", description: "Pequeño bote de remos de madera con tablones de fondo plano, escálamos en las regalas y dos remos de madera" },
  "jet-ski": { label: "Moto Acuática", description: "Moto acuática personal de pie con carenado agresivo, manillares, un solo asiento y un chorro de propulsión" },
  "submarine": { label: "Submarino", description: "Submarino militar con casco cilíndrico largo, una torre de mando con periscopios y proa bulbosa sumergiéndose por aguas profundas" },
  "pirate-ship": { label: "Barco Pirata", description: "Galeón pirata de madera con mástiles altos, velas cuadradas, mascarón en la proa, cañones a lo largo del casco y una bandera negra hecha jirones" },

  // -------------------- Military --------------------
  "tank": { label: "Tanque", description: "Tanque pesado de batalla con un largo cañón, torreta giratoria, gruesa armadura inclinada y anchas orugas continuas" },
  "humvee": { label: "Humvee", description: "Humvee militar con postura ancha, carrocería angular blindada, neumáticos todo terreno y una torreta montada en el techo" },
  "armored-personnel-carrier": { label: "Vehículo Blindado de Transporte", description: "Vehículo blindado de transporte sobre orugas con casco cuadrado, rampa trasera y una pequeña torreta arriba" },
  "fighter-jet": { label: "Caza", description: "Caza supersónico con alas delta en flecha, una nariz puntiaguda afilada, dos colas y misiles en pilones de ala" },
  "stealth-bomber": { label: "Bombardero Sigiloso", description: "Bombardero sigiloso de ala volante con silueta triangular negra mate, sin colas y superficies facetadas absorbentes de radar" },
  "destroyer": { label: "Destructor", description: "Elegante destructor naval con largo casco gris, torretas de cañones, lanzadores de misiles y una superestructura erizada de radares" },
  "aircraft-carrier": { label: "Portaaviones", description: "Portaaviones masivo con cubierta de vuelo plana, torre isla con arreglos de radar y aviones de combate estacionados en filas" },

  // -------------------- Construction --------------------
  "bulldozer": { label: "Bulldozer", description: "Bulldozer amarillo de construcción con una enorme cuchilla empujadora al frente, orugas pesadas y un escape alto" },
  "excavator": { label: "Excavadora", description: "Excavadora hidráulica con brazo articulado, cucharón dentado, cabina giratoria y base pesada sobre orugas" },
  "crane-truck": { label: "Camión Grúa", description: "Camión grúa móvil con un brazo telescópico masivo extendido hacia arriba, estabilizadores y un contrapeso pesado" },
  "cement-mixer": { label: "Camión Hormigonera", description: "Camión hormigonera con un gran tambor giratorio, canaleta en la parte trasera y una cabina cuadrada" },
  "forklift": { label: "Montacargas", description: "Montacargas de almacén con horquillas gemelas de acero levantadas al frente, jaula sobre el conductor y trasera compacta con contrapeso" },
  "backhoe": { label: "Retroexcavadora", description: "Retroexcavadora con un cucharón delantero para palear y un brazo articulado trasero con un cucharón de excavación dentado" },
  "tractor": { label: "Tractor", description: "Tractor agrícola con grandes neumáticos traseros con tacos, neumáticos delanteros más pequeños, una cubierta de techo y un enganche de remolque atrás" },

  // -------------------- Sci-Fi --------------------
  "spaceship": { label: "Nave Espacial", description: "Elegante nave espacial interestelar con fuselaje curvo, toberas de motor brillantes, antenas y una ventana de puente de mando" },
  "starfighter": { label: "Caza Estelar", description: "Ágil caza estelar de un solo piloto con alas en flecha, cañones láser en las puntas de las alas, una cabina en burbuja y propulsores brillantes" },
  "hovercar": { label: "Auto Volador", description: "Auto volador futurista flotando sobre el suelo sin ruedas, propulsores brillantes en la parte inferior, carrocería sin costuras y una cubierta curvada" },
  "mech": { label: "Mech", description: "Robot mech bípedo gigante con placas blindadas, pistones hidráulicos, una cabina en el torso y armas pesadas montadas en los brazos" },
  "flying-saucer": { label: "Platillo Volador", description: "Clásico platillo volador OVNI con cuerpo de disco metálico, luces de portilla brillantes alrededor del borde y una cúpula de cabina arriba" },
  "space-shuttle": { label: "Transbordador Espacial", description: "Orbitador del transbordador espacial con alas delta blancas, escudo térmico negro debajo y enormes toberas de cohete en la parte trasera" },
  "rocket": { label: "Cohete", description: "Cohete cilíndrico alto con cono de morro puntiagudo, aletas de cola, etapas de propulsores y llamas rugiendo de los motores en el lanzamiento" },
  "hoverboard": { label: "Hoverboard", description: "Hoverboard futurista flotando a centímetros del suelo con propulsores debajo brillantes y un cuerpo elegante de tabla única" },

  // -------------------- Round 2 --------------------
  "ambulance": { label: "Ambulancia", description: "Vehículo médico de emergencia" },
  "police-car": { label: "Patrulla", description: "Patrulla blanco y negro con barra de luces" },
  "hovercraft": { label: "Aerodeslizador", description: "Vehículo de colchón de aire sobre agua / tierra" },
  "paraglider": { label: "Parapente", description: "Planeador de ala blanda lanzado a pie" },
  "microlight": { label: "Avión Ultraligero", description: "Aeronave recreativa monoplaza ligera" },
  "airship": { label: "Dirigible", description: "Gran vehículo rígido más ligero que el aire" },
}

export default map
