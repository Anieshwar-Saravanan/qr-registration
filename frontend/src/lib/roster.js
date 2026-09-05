/** Cached attendee roster and locally-known registrations.
 *
 * Without this an offline scan is blind: it could not show a name, could not
 * tell a real badge from a forged one, and could not spot a repeat scan. The
 * roster is downloaded while online and read from IndexedDB at the door.
 */
import { get, set } from 'idb-keyval'
import { listUsers } from '../api'

const ROSTER_KEY = 'qr-reg.roster'
const REGISTERED_KEY = 'qr-reg.registered'
const PAGE = 500

export async function downloadRoster(onProgress) {
  const byId = {}
  let offset = 0
  let total = 0

  // Paged so a large attendee list does not depend on one huge response.
  do {
    const page = await listUsers({ limit: PAGE, offset })
    total = page.total
    for (const u of page.items) {
      byId[u.user_id] = {
        name: u.name,
        email: u.email,
        organization: u.organization,
      }
    }
    offset += page.items.length
    onProgress?.(offset, total)
    if (page.items.length === 0) break
  } while (offset < total)

  const roster = { users: byId, cached_at: new Date().toISOString(), count: Object.keys(byId).length }
  await set(ROSTER_KEY, roster)
  return roster
}

export async function getRoster() {
  try {
    return (await get(ROSTER_KEY)) ?? null
  } catch {
    return null
  }
}

export function lookupLocal(roster, userId) {
  return roster?.users?.[userId] ?? null
}

/** Registrations this device already knows about, keyed by event. */
async function readRegistered() {
  try {
    return (await get(REGISTERED_KEY)) ?? {}
  } catch {
    return {}
  }
}

export async function markRegistered(eventId, userId) {
  const all = await readRegistered()
  const forEvent = new Set(all[eventId] ?? [])
  forEvent.add(userId)
  all[eventId] = [...forEvent]
  await set(REGISTERED_KEY, all)
}

export async function getRegisteredSet(eventId) {
  const all = await readRegistered()
  return new Set(all[eventId] ?? [])
}

/** Seed the local set from the server, so a device that joins mid-event
 *  knows who other volunteers have already registered. */
export async function primeRegistered(eventId, userIds) {
  const all = await readRegistered()
  all[eventId] = [...new Set([...(all[eventId] ?? []), ...userIds])]
  await set(REGISTERED_KEY, all)
}
