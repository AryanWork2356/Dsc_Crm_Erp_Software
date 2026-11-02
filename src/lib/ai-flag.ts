/**
 * Browser side of the master switch: the app layout adds an invisible element with id "ai-on" to every page while the AI helper is ON
 * (and an AI key is set). Anything AI in a client component asks this; with the switch OFF it is simply not there.
 */
export const aiIsOn = () => typeof document !== "undefined" && !!document.getElementById("ai-on");
