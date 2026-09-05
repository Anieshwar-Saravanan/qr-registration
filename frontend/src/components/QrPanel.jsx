import { useEffect, useState } from 'react'
import { getQr, qrPngUrl } from '../api'

export default function QrPanel({ user }) {
  const [qr, setQr] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPayload, setShowPayload] = useState(false)

  useEffect(() => {
    if (!user) {
      setQr(null)
      return
    }

    // Guard against a slow response for a previously selected user
    // overwriting the QR of the one now selected.
    let active = true
    setLoading(true)
    setError(null)

    getQr(user.user_id)
      .then((data) => active && setQr(data))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [user])

  if (!user) {
    return (
      <div className="card qr-card">
        <div className="empty-qr">
          <p className="muted">Select an attendee to generate their QR code.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card qr-card">
      <h2>{user.name}</h2>
      <p className="muted">{user.email}</p>

      {loading && <p className="muted">Generating…</p>}
      {error && <p className="error">{error}</p>}

      {qr && !loading && (
        <>
          <img className="qr-image" src={qr.image} alt={`QR code for ${user.name}`} />

          <a className="button" href={qrPngUrl(user.user_id)} download={`qr-${user.name.replace(/\s+/g, '-').toLowerCase()}.png`}>
            Download PNG
          </a>

          <button className="link-button" onClick={() => setShowPayload((v) => !v)}>
            {showPayload ? 'Hide' : 'Show'} encoded data ({qr.payload.length} bytes)
          </button>

          {showPayload && <pre className="payload">{JSON.stringify(JSON.parse(qr.payload), null, 2)}</pre>}
        </>
      )}
    </div>
  )
}
