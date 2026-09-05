/** Client-side mirror of the server's QR payload parser.
 *
 * Duplicating this is deliberate and necessary: an offline scanner has to know
 * whether a badge is valid before the network comes back. It MUST stay in step
 * with `build_payload`/`parse_payload` in backend/app/qr.py — if the payload
 * ever becomes a signed token, this file changes with them.
 *
 * The server re-validates every scan regardless, so this is a UX fast path,
 * never the security boundary.
 */
export const PAYLOAD_VERSION = 1

export function parsePayload(raw) {
  if (!raw || !raw.trim()) return { error: 'Empty scan.' }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: 'That is not a registration QR code.' }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { error: 'That is not a registration QR code.' }
  }
  if (data.v !== PAYLOAD_VERSION) {
    return { error: `This badge uses QR format v${data.v}, but this app expects v${PAYLOAD_VERSION}.` }
  }
  if (data.type !== 'user') return { error: 'That QR code is not an attendee badge.' }
  if (typeof data.user_id !== 'string' || !data.user_id.trim()) {
    return { error: 'Badge is missing its attendee id.' }
  }

  return { userId: data.user_id.trim(), hints: data }
}
