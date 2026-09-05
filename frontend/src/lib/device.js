/** A stable per-browser id, so scans can be attributed to a device.
 *
 * Volunteers use their own phones with no login, so this gives most of the
 * audit value of accounts ("device 3 scanned this person") at none of the cost.
 */
const KEY = 'qr-reg.device-id'

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `dev-${crypto.randomUUID().slice(0, 8)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private browsing can throw on storage access; a per-session id still
    // beats sending nothing.
    return `dev-ephemeral-${Math.random().toString(36).slice(2, 10)}`
  }
}
