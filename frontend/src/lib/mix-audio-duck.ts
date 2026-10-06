/**
 * Mix Audio ducking: the amount a freshly enabled duck starts at. The editor
 * writes it onto the node the moment a key track is picked, so the slider
 * always shows the value the run sends. (The server applies the same default
 * to an API call that names no amount.)
 */
export const MIX_DUCK_DEFAULT_AMOUNT = 75
