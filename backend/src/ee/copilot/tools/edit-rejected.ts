/**
 * A refusal the model is meant to read and act on.
 *
 * Distinct from a thrown Error, which is a server fault: `EditRejected` means
 * the edit was understood and declined, and its message goes back to the model
 * as the tool result so it can correct itself in the same turn. Every message
 * should therefore say what to do next, not only what was wrong.
 *
 * Its own module so the guards that raise it (destination locks, entity
 * ownership) do not have to import the writer that catches it.
 */
export class EditRejected extends Error {}
