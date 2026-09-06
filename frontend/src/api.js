/** Thin wrapper over the FastAPI backend.
 *
 * In dev, VITE_API_BASE is unset and paths stay relative ("/api/..."), which
 * Vite proxies to the local backend - one origin, no CORS.
 *
 * In production the frontend and backend live on different hosts, so
 * VITE_API_BASE holds the backend's full origin, e.g.
 *   VITE_API_BASE=https://qr-registration-api.onrender.com
 *
 * Vite inlines this at BUILD time, not runtime: changing it on Vercel requires
 * a redeploy, not just an env var edit.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** Absolute URL for an API path. Also used for <a href> links (CSV, ZIP, PNG),
 *  which must point at the backend rather than the Vercel origin. */
export const apiUrl = (path) => `${API_BASE}${path}`

async function request(path, options) {
  const res = await fetch(apiUrl(path), options)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      // FastAPI returns a string detail for our errors, an array for 422s.
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) {
        // FastAPI 422s arrive as a list of field errors. Pydantic prefixes
        // custom messages with "Value error, " and names the field only in a
        // `loc` array, so both are tidied up for a human reader.
        detail = body.detail
          .map((e) => {
            const field = e.loc?.filter((x) => x !== 'body').join('.') ?? ''
            const msg = String(e.msg ?? '').replace(/^Value error,\s*/, '')
            return field ? `${field}: ${msg}` : msg
          })
          .join(' · ')
      }
    } catch {
      /* response had no JSON body; keep the generic message */
    }
    throw new Error(detail)
  }
  return res.json()
}

/** Returns { items, total, limit, offset }. */
export function listUsers({ q = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (q.trim()) params.set('q', q.trim())
  return request(`/api/users?${params}`)
}

export const createUser = (user) =>
  request('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  })

/** Parse and validate a spreadsheet without writing anything. */
export function previewImport(file) {
  const data = new FormData()
  data.append('file', file)
  // No Content-Type header here on purpose - the browser must set the
  // multipart boundary itself.
  return request('/api/users/import/preview', { method: 'POST', body: data })
}

export const bulkCreate = (users) =>
  request('/api/users/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users }),
  })

export const getQr = (userId) => request(`/api/users/${userId}/qr?format=base64&box_size=12`)

export const qrPngUrl = (userId) => apiUrl(`/api/users/${userId}/qr?box_size=16`)

export function exportZipUrl(q = '') {
  return apiUrl(
    q.trim()
      ? `/api/users/qr/export.zip?q=${encodeURIComponent(q.trim())}`
      : '/api/users/qr/export.zip',
  )
}

// --- Phase 2: events, scanning, registrations ---

export const listEvents = () => request('/api/events')

export const createEvent = (event) =>
  request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })

export const updateEvent = (eventId, changes) =>
  request(`/api/events/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })

export const scan = (eventId, body) =>
  request(`/api/events/${eventId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Replay a batch of scans queued while offline. */
export const syncScans = (eventId, scans) =>
  request(`/api/events/${eventId}/scan/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scans }),
  })

export const manualRegister = (eventId, userId, deviceId) =>
  request(`/api/events/${eventId}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, device_id: deviceId }),
  })

export async function undoRegistration(eventId, userId) {
  const res = await fetch(apiUrl(`/api/events/${eventId}/registrations/${userId}`), { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error(`Could not undo (${res.status})`)
}

export function listRegistrations(eventId, { q = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (q.trim()) params.set('q', q.trim())
  return request(`/api/events/${eventId}/registrations?${params}`)
}

export const eventStats = (eventId) => request(`/api/events/${eventId}/stats`)

export const registrationsCsvUrl = (eventId) =>
  apiUrl(`/api/events/${eventId}/registrations/export.csv`)

// --- printable badge sheets (16 QR codes per A4) ---

/** Badge sheet for everyone matching the current search. */
export const badgesPdfUrl = (q = '') =>
  apiUrl(q.trim() ? `/api/users/qr/export.pdf?q=${encodeURIComponent(q.trim())}` : '/api/users/qr/export.pdf')

/** Badge sheet for a specific set of attendees, e.g. the ones just imported.
 *
 * A POST cannot be an <a href>, so the PDF is fetched as a blob and handed to
 * a temporary link. The object URL is revoked afterwards to release the memory.
 */
export async function downloadBadgesFor(userIds, filename = 'attendee-badges.pdf') {
  const res = await fetch(apiUrl('/api/users/qr/export.pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  })
  if (!res.ok) {
    let detail = `Could not build the badge sheet (${res.status})`
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* no JSON body */
    }
    throw new Error(detail)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return Number(res.headers.get('X-Page-Count') ?? 0)
}

/** Un-register several attendees in one request. */
export const removeRegistrations = (eventId, userIds) =>
  request(`/api/events/${eventId}/registrations/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  })

// --- winners ---

export const listWinners = (eventId) => request(`/api/events/${eventId}/winners`)

/** Replaces the whole winners list, so reordering is atomic. */
export const setWinners = (eventId, winners) =>
  request(`/api/events/${eventId}/winners`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winners }),
  })
