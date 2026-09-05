/** Thin wrapper over the FastAPI backend. Vite proxies /api to :8000 in dev. */

async function request(path, options) {
  const res = await fetch(path, options)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      // FastAPI returns a string detail for our errors, an array for 422s.
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = body.detail.map((e) => e.msg).join(', ')
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
