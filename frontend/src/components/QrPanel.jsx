import { useEffect, useRef, useState } from 'react'
import { getQr, qrPngUrl } from '../api'
import { personMeta } from '../lib/person'

/** One student's QR, in a native <dialog>.
 *
 * A dialog rather than a side panel because the table now owns the right-hand
 * column, and native <dialog> gives the backdrop, Escape-to-close and focus
 * trapping for free - none of which is worth a modal library.
 */
export default function QrPanel({ user, onClose }) {
  const [qr, setQr] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPayload, setShowPayload] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (user && !el.open) el.showModal()
    if (!user && el.open) el.close()
  }, [user])

  useEffect(() => {
    if (!user) {
      setQr(null)
      setShowPayload(false)
      return
    }

    // Guard against a slow response for a previously selected student
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

  return (
    <dialog ref={ref} className="qr-dialog" onClose={onClose}>
      {user && (
        <>
          <div className="list-header">
            <h2>{user.name}</h2>
            <button className="secondary small" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
          <p className="muted">
            {user.prodigy_id != null ? `PID ${user.prodigy_id} · ` : ''}
            {personMeta(user) || 'No details recorded'}
          </p>

          {loading && <p className="muted">Generating…</p>}
          {error && <p className="error">{error}</p>}

          {qr && !loading && (
            <>
              <img className="qr-image" src={qr.image} alt={`QR code for ${user.name}`} />
              <a
                className="button"
                href={qrPngUrl(user.user_id)}
                download={`qr-${user.prodigy_id ?? user.roll_no}.png`}
              >
                Download PNG
              </a>
              <button className="link-button" onClick={() => setShowPayload((v) => !v)}>
                {showPayload ? 'Hide' : 'Show'} encoded data ({qr.payload.length} bytes)
              </button>
              {showPayload && (
                <pre className="payload">{JSON.stringify(JSON.parse(qr.payload), null, 2)}</pre>
              )}
            </>
          )}
        </>
      )}
    </dialog>
  )
}
