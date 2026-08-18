import { getAnimal, type AnimalSubcategory } from "@nodaro/shared"

const ANIMAL_EMOJI: Record<string, string> = {
  // cats
  "cat-persian": "😻", "cat-siamese": "🐈", "cat-maine-coon": "😺", "cat-bengal": "🐯",
  "cat-sphynx": "😾", "cat-ragdoll": "😸", "cat-british-shorthair": "😽", "cat-scottish-fold": "🙀",
  "cat-tabby": "🐈‍⬛", "cat-black": "🖤🐈",
  // dogs
  "dog-labrador": "🐕", "dog-golden-retriever": "🐕‍🦺", "dog-german-shepherd": "🦮",
  "dog-bulldog": "🐶", "dog-poodle": "🐩", "dog-husky": "🐺❄️", "dog-beagle": "🐶👃",
  "dog-dachshund": "🌭", "dog-chihuahua": "🐕💕", "dog-corgi": "🐕👑", "dog-pug": "🐶😤",
  "dog-border-collie": "🐕🐑", "dog-rottweiler": "🐕💪", "dog-shiba-inu": "🐶🍙",
  // transport
  horse: "🐴", camel: "🐫", donkey: "🫏", mule: "🐴🎒", ox: "🐂",
  // farm
  cow: "🐄", pig: "🐖", sheep: "🐑", goat: "🐐", chicken: "🐔",
  rooster: "🐓", duck: "🦆", rabbit: "🐇", turkey: "🦃",
  // wild
  lion: "🦁", tiger: "🐅", bear: "🐻", "polar-bear": "🐻‍❄️", wolf: "🐺",
  fox: "🦊", elephant: "🐘", zebra: "🦓", giraffe: "🦒", panda: "🐼",
  leopard: "🐆", cheetah: "🐆💨", monkey: "🐒", gorilla: "🦍", kangaroo: "🦘",
  koala: "🐨", deer: "🦌", raccoon: "🦝",
  // birds
  eagle: "🦅", owl: "🦉", parrot: "🦜", peacock: "🦚", flamingo: "🦩",
  penguin: "🐧", swan: "🦢", sparrow: "🐦", crow: "🐦‍⬛", hummingbird: "🐦💨",
  // sea
  dolphin: "🐬", whale: "🐋", shark: "🦈", octopus: "🐙", "sea-turtle": "🐢🌊",
  jellyfish: "🪼", crab: "🦀", seahorse: "🐠",
  // small pets
  hamster: "🐹", "guinea-pig": "🐹🥒", ferret: "🐾🪱", parakeet: "🦜🌈", gerbil: "🐭",
  // reptiles
  snake: "🐍", lizard: "🦎", turtle: "🐢", crocodile: "🐊", chameleon: "🦎🌈", gecko: "🦎🟢",
  // insects
  butterfly: "🦋", bee: "🐝", ant: "🐜", spider: "🕷️", ladybug: "🐞",
  dragonfly: "🪰", beetle: "🪲", grasshopper: "🦗", "praying-mantis": "🦗🙏",
  mosquito: "🦟", scorpion: "🦂", caterpillar: "🐛",
  // dinosaurs
  "t-rex": "🦖", velociraptor: "🦖💨", triceratops: "🦕", brachiosaurus: "🦕🌳",
  stegosaurus: "🦕🛡️", pterodactyl: "🦅🦖", spinosaurus: "🦖🌊", diplodocus: "🦕🌿",
  ankylosaurus: "🦕🪨", brontosaurus: "🦕💚", parasaurolophus: "🦕🎺", allosaurus: "🦖🦴",
  // mythical
  dragon: "🐉", unicorn: "🦄", phoenix: "🔥", griffin: "🦁🦅", pegasus: "🐴🪽", kraken: "🐙🌊",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<AnimalSubcategory, string> = {
  cats: "🐈",
  dogs: "🐕",
  transport: "🐴",
  farm: "🐓",
  wild: "🦁",
  birds: "🦅",
  sea: "🐬",
  "small-pets": "🐹",
  reptiles: "🦎",
  insects: "🐛",
  dinosaurs: "🦖",
  mythical: "🐉",
}

export function ANIMAL_ICON_FOR(id: string): string {
  if (ANIMAL_EMOJI[id]) return ANIMAL_EMOJI[id]
  const a = getAnimal(id)
  return a ? SUBCATEGORY_FALLBACK_EMOJI[a.subcategory] ?? "🐾" : "🐾"
}
