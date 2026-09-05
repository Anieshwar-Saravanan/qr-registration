/** Thin wrapper over the FastAPI backend. Vite proxies /api to :8000 in dev. */

async function request(path, options) {
  const res = await fetch(path, options)
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

export const qrPngUrl = (userId) => `/api/users/${userId}/qr?box_size=16`

export function exportZipUrl(q = '') {
  return q.trim()
    ? `/api/users/qr/export.zip?q=${encodeURIComponent(q.trim())}`
    : '/api/users/qr/export.zip'
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
  const res = await fetch(`/api/events/${eventId}/registrations/${userId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error(`Could not undo (${res.status})`)
}

export function listRegistrations(eventId, { q = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (q.trim()) params.set('q', q.trim())
  return request(`/api/events/${eventId}/registrations?${params}`)
}

export const eventStats = (eventId) => request(`/api/events/${eventId}/stats`)

export const registrationsCsvUrl = (eventId) =>
  `/api/events/${eventId}/registrations/export.csv`
