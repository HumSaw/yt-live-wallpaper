// Общие рантайм-флаги приложения (не персистятся).
// Единственное место, где живёт изменяемое состояние, разделяемое между
// window-manager / ipc / app-lifecycle — вместо россыпи let в main.js.

let pausedByMonitor = false // пауза из-за полного экрана / перекрытого стола
let pausedByBattery = false
let setupState = null // null = компоненты готовы, иначе { label, percent, error }
let quitting = false

module.exports = {
  isPausedByMonitor: () => pausedByMonitor,
  setPausedByMonitor: (v) => {
    pausedByMonitor = !!v
  },
  isPausedByBattery: () => pausedByBattery,
  setPausedByBattery: (v) => {
    pausedByBattery = !!v
  },
  isPaused: () => pausedByMonitor || pausedByBattery,
  getSetupState: () => setupState,
  setSetupState: (v) => {
    setupState = v
  },
  isQuitting: () => quitting,
  setQuitting: (v) => {
    quitting = !!v
  },
}
