/** Human labels for the activity rows in the panel. Unknown tools fall back to their name. */
const LABELS: Readonly<Record<string, string>> = {
  get_graph: "Reading the workflow",
  edit_workflow: "Editing the canvas",
  run_workflow: "Proposing a run",
  get_execution: "Checking the run",
  diagnose_run: "Diagnosing failures",
  get_job: "Reading a job",
  get_node_skill: "Reading node docs",
  get_picker_catalog: "Reading picker options",
  list_models: "Comparing models",
  list_node_presets: "Browsing presets",
  get_node_preset: "Reading a preset",
  get_recipe: "Reading a recipe",
  list_brand_presets: "Reading brand presets",
  list_characters: "Listing characters",
  get_character: "Reading a character",
  list_locations: "Listing locations",
  get_location: "Reading a location",
  check_balance: "Checking credits",
}

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, " ")
}
