"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  ANIMALS,
  ANIMAL_SUBCATEGORY_LABELS,
  ANIMAL_SUBCATEGORY_ORDER,
  type Animal,
  type AnimalSubcategory,
} from "@nodaro-shared/animals"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface AnimalPickerProps {
  readonly value: string
  readonly onValueChange: (animalId: string, animal: Animal) => void
  readonly className?: string
}

const ANIMAL_EMOJI: Record<string, string> = {
  // cats
  "cat-persian": "😺", "cat-siamese": "😺", "cat-maine-coon": "😺", "cat-bengal": "🐯",
  "cat-sphynx": "😾", "cat-ragdoll": "😸", "cat-british-shorthair": "😽", "cat-scottish-fold": "😺",
  "cat-tabby": "🐈", "cat-black": "🐈‍⬛",
  // dogs
  "dog-labrador": "🐕", "dog-golden-retriever": "🐕‍🦺", "dog-german-shepherd": "🐕‍🦺",
  "dog-bulldog": "🐶", "dog-poodle": "🐩", "dog-husky": "🐺", "dog-beagle": "🐶",
  "dog-dachshund": "🌭", "dog-chihuahua": "🐶", "dog-corgi": "🐕", "dog-pug": "🐶",
  "dog-border-collie": "🐕", "dog-rottweiler": "🐕", "dog-shiba-inu": "🐕",
  // transport
  horse: "🐴", camel: "🐫", donkey: "🐴", mule: "🫏", ox: "🐂",
  // farm
  cow: "🐄", pig: "🐖", sheep: "🐑", goat: "🐐", chicken: "🐔",
  rooster: "🐓", duck: "🦆", rabbit: "🐇", turkey: "🦃",
  // wild
  lion: "🦁", tiger: "🐅", bear: "🐻", "polar-bear": "🐻‍❄️", wolf: "🐺",
  fox: "🦊", elephant: "🐘", zebra: "🦓", giraffe: "🦒", panda: "🐼",
  leopard: "🐆", cheetah: "🐆", monkey: "🐒", gorilla: "🦍", kangaroo: "🦘",
  koala: "🐨", deer: "🦌", raccoon: "🦝",
  // birds
  eagle: "🦅", owl: "🦉", parrot: "🦜", peacock: "🦚", flamingo: "🦩",
  penguin: "🐧", swan: "🦢", sparrow: "🐦", crow: "🐦‍⬛", hummingbird: "🐦",
  // sea
  dolphin: "🐬", whale: "🐋", shark: "🦈", octopus: "🐙", "sea-turtle": "🐢",
  jellyfish: "🪼", crab: "🦀", seahorse: "🐠",
  // small pets
  hamster: "🐹", "guinea-pig": "🐹", ferret: "🐾", parakeet: "🦜", gerbil: "🐭",
  // reptiles
  snake: "🐍", lizard: "🦎", turtle: "🐢", crocodile: "🐊", chameleon: "🦎", gecko: "🦎",
  // insects
  butterfly: "🦋", bee: "🐝", ant: "🐜", spider: "🕷️", ladybug: "🐞",
  dragonfly: "🪰", beetle: "🪲", grasshopper: "🦗", "praying-mantis": "🦗",
  mosquito: "🦟", scorpion: "🦂", caterpillar: "🐛",
  // dinosaurs
  "t-rex": "🦖", velociraptor: "🦖", triceratops: "🦕", brachiosaurus: "🦕",
  stegosaurus: "🦕", pterodactyl: "🦅", spinosaurus: "🦖", diplodocus: "🦕",
  ankylosaurus: "🦕", brontosaurus: "🦕", parasaurolophus: "🦕", allosaurus: "🦖",
  // mythical
  dragon: "🐉", unicorn: "🦄", phoenix: "🔥", griffin: "🦅", pegasus: "🐴", kraken: "🐙",
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

function emojiFor(animal: Animal): string {
  return ANIMAL_EMOJI[animal.id] ?? SUBCATEGORY_FALLBACK_EMOJI[animal.subcategory]
}

/**
 * Single-select animal picker. Animals are grouped by sub-category
 * (cats, dogs, transport, farm, wild, birds, sea, small pets, reptiles,
 * mythical). Search filters across label + description.
 *
 * Selecting an animal calls `onValueChange(id, animal)` so the caller can
 * auto-fill dependent fields (objectName, description) from the catalog.
 */
export const AnimalPicker = memo(function AnimalPicker({
  value,
  onValueChange,
  className,
}: AnimalPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("animals")

  const grouped = useMemo(() => {
    const byCategory = new Map<AnimalSubcategory, Animal[]>()
    for (const animal of ANIMALS) {
      if (!matches(animal.id, animal.label, animal.description, query)) {
        continue
      }
      const list = byCategory.get(animal.subcategory) ?? []
      list.push(animal)
      byCategory.set(animal.subcategory, list)
    }
    return ANIMAL_SUBCATEGORY_ORDER.map((cat) => ({
      subcategory: cat,
      animals: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.animals.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search animal"
          placeholder="Search animal"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No animal matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ subcategory, animals }) => {
        if (animals.length === 0) return null
        return (
          <div key={subcategory} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {ANIMAL_SUBCATEGORY_LABELS[subcategory]}
            </div>
            <div
              role="radiogroup"
              aria-label={ANIMAL_SUBCATEGORY_LABELS[subcategory]}
              className="grid grid-cols-3 gap-1.5"
            >
              {animals.map((animal) => {
                const selected = animal.id === value
                const label = resolveLabel(animal.id, animal.label)
                const description = resolveDescription(animal.id, animal.description)
                return (
                  <button
                    key={animal.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(animal.id, animal)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {emojiFor(animal)}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-0.5 pb-0.5 text-center line-clamp-2",
                        selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})
