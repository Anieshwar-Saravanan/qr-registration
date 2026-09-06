/** Cached attendee roster and locally-known registrations.
 *
 * Without this an offline scan is blind: it could not show a name, could not
 * tell a real badge from a forged one, and could not spot a repeat scan. The
 * roster is downloaded while online and read from IndexedDB at the door.
 */
import { get, set } from 'idb-keyval'
import { listUsers } from '../api'
import { parsePayload } from './payload'
import { pending } from './queue'

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

/** The inverse of markRegistered, for someone removed from the event.
 *
 * Without this the local set can only ever grow: the scanner would keep
 * refusing a badge as "already registered" long after that registration was
 * deleted, and the server would never even be asked.
 */
export async function unmarkRegistered(eventId, userIds) {
  const all = await readRegistered()
  const drop = new Set(userIds)
  all[eventId] = (all[eventId] ?? []).filter((id) => !drop.has(id))
  await set(REGISTERED_KEY, all)
}

/** Drop everything this device remembers about an event, for one that has
 *  been deleted. Its queued scans can never be accepted either. */
export async function forgetEvent(eventId) {
  const all = await readRegistered()
  delete all[eventId]
  await set(REGISTERED_KEY, all)
}

export async function getRegisteredSet(eventId) {
  const all = await readRegistered()
  return new Set(all[eventId] ?? [])
}

/** Ids queued on this device but not yet accepted by the server.
 *
 * As far as the door is concerned these people are registered, so an
 * authoritative refresh must not forget them and let a second scan through.
 */
async function queuedUserIds(eventId) {
  try {
    const items = await pending(eventId)
    return items.map((i) => parsePayload(i.payload).userId).filter(Boolean)
  } catch {
    return []
  }
}

/** Seed the local set from the server, so a device that joins mid-event
 *  knows who other volunteers have already registered.
 *
 * `replace` rebuilds the set from the server's answer instead of merging into
 * it, which is the only way an entry can ever disappear — someone removed from
 * the event on another device, say. It is only correct when the caller holds
 * the event's COMPLETE, unfiltered registration list: priming from a search
 * result or a first page would silently forget everyone not in it.
 */
export async function primeRegistered(eventId, userIds, { replace = false } = {}) {
  const all = await readRegistered()
  const base = replace ? await queuedUserIds(eventId) : (all[eventId] ?? [])
  all[eventId] = [...new Set([...base, ...userIds])]
  await set(REGISTERED_KEY, all)
}
