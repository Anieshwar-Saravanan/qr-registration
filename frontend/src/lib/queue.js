/** Offline scan queue, persisted in IndexedDB.
 *
 * A scan is written here FIRST and uploaded second. That ordering is the whole
 * point: the door keeps moving whether or not the network does, and nothing is
 * lost if the tab is closed mid-event.
 */
import { get, set } from 'idb-keyval'

const KEY = 'qr-reg.scan-queue'

async function readAll() {
  try {
    return (await get(KEY)) ?? []
  } catch {
    return []
  }
}

async function writeAll(items) {
  await set(KEY, items)
}

/** Add a scan to the queue. Returns the queued record. */
export async function enqueue({ eventId, payload, deviceId }) {
  const item = {
    scan_id: crypto.randomUUID(),
    event_id: eventId,
    payload,
    device_id: deviceId,
    // Recorded on the device, so a scan synced hours later still reports when
    // the person actually walked in.
    scanned_at: new Date().toISOString(),
  }
  const items = await readAll()
  items.push(item)
  await writeAll(items)
  return item
}

export async function pending(eventId) {
  const items = await readAll()
  return eventId ? items.filter((i) => i.event_id === eventId) : items
}

export async function count(eventId) {
  return (await pending(eventId)).length
}

/** Remove the given scan_ids once the server has confirmed them. */
export async function drain(scanIds) {
  const done = new Set(scanIds)
  const items = await readAll()
  await writeAll(items.filter((i) => !done.has(i.scan_id)))
}

export async function clear() {
  await writeAll([])
}
