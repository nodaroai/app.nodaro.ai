// Subject of the rename probe: test names are built from this data, so a
// mutant of it renames the candidate (`"a"` → `""` gives "price ").
export const IDS = ["a"]

export const price = (id) => id.length * 5
