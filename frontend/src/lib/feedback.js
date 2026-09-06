/** Audible and haptic scan feedback.
 *
 * Staff at a door are looking at the person, not the screen, so the tone is the
 * primary signal and the banner is confirmation.
 */
let ctx = null

function tone(freq, ms, type = 'sine') {
  try {
    ctx = ctx ?? new (window.AudioContext || window.webkitAudioContext)()
    // iOS suspends the audio context until a user gesture; starting the
    // scanner counts as one, so this resume succeeds in practice.
    if (ctx.state === 'suspended') ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
  } catch {
    /* audio is a nicety, never a failure */
  }
}

function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported on iOS Safari; the tone still fires */
  }
}

export function signal(status) {
  if (status === 'team_added') {
    // A short high blip: one more member in, team not yet complete.
    tone(1046, 70)
    buzz(30)
    return
  }
  if (status === 'registered' || status === 'team_done') {
    tone(880, 120)
    buzz(60)
  } else if (status === 'already_registered') {
    tone(560, 90)
    setTimeout(() => tone(560, 90), 130)
    buzz([40, 60, 40])
  } else {
    tone(200, 260, 'square')
    buzz([90, 70, 90])
  }
}
