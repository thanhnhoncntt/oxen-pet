// Keeps Node's experimental-feature warnings (TypeScript stripping, SQLite) off the output, before anything loads:
// a hook's output is shown to the user, and a stray line there reads as a failed hook. Other warnings still print.
const listeners = process.listeners('warning')
process.removeAllListeners('warning')
process.on('warning', w => {
  if (w.name !== 'ExperimentalWarning') {
    for (const l of listeners) {
      l(w)
    }
  }
})
