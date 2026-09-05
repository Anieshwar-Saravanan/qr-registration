import { useCallback, useEffect, useState } from 'react'
import {
  eventStats,
  listRegistrations,
  listUsers,
  manualRegister,
  registrationsCsvUrl,
  undoRegistration,
} from '../api'
import { getDeviceId } from '../lib/device'
import { downloadRoster, getRoster, primeRegistered } from '../lib/roster'

export default function RegistrationsPanel({ event, refreshKey, onChanged }) {
  const [page, setPage] = useState({ items: [], total: 0 })
  const [stats, setStats] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)

  const [manualQuery, setManualQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [manualNote, setManualNote] = useState(null)
  const [roster, setRoster] = useState(null)
  const [rosterBusy, setRosterBusy] = useState(false)
  const [rosterNote, setRosterNote] = useState(null)

  const load = useCallback(async () => {
    if (!event) return
    try {
      const [p, s] = await Promise.all([
        listRegistrations(event.event_id, { q: query }),
        eventStats(event.event_id),
      ])
      setPage(p)
      setStats(s)
      setError(null)
      // Keep this device aware of who other volunteers have registered.
      await primeRegistered(event.event_id, p.items.map((r) => r.user_id))
    } catch (err) {
      setError(err.message)
    }
  }, [event, query])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load, refreshKey])

  useEffect(() => {
    getRoster().then(setRoster)
  }, [])

  // Manual fallback: find someone by name when their badge will not scan.
  useEffect(() => {
    if (!manualQuery.trim()) {
      setCandidates([])
      return
    }
    setManualNote(null)
    const t = setTimeout(() => {
      listUsers({ q: manualQuery, limit: 6 })
        .then((r) => setCandidates(r.items))
        .catch(() => setCandidates([]))
    }, 250)
    return () => clearTimeout(t)
  }, [manualQuery])

  async function handleManual(user) {
    try {
      // The endpoint answers 200 for refusals too - already registered, event
      // closed, event full - so the status has to be read. Ignoring it made a
      // refusal look identical to a silent failure.
      const res = await manualRegister(event.event_id, user.user_id, getDeviceId())
      setManualNote({ status: res.status, message: res.message })

      if (res.status === 'registered') {
        setManualQuery('')
        setCandidates([])
        await load()
        onChanged?.()
      }
    } catch (err) {
      setManualNote({ status: 'error', message: err.message })
    }
  }

  async function handleUndo(reg) {
    if (!confirm(`Remove ${reg.name} from ${event.name}?`)) return
    try {
      await undoRegistration(event.event_id, reg.user_id)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDownloadRoster() {
    setRosterBusy(true)
    setRosterNote(null)
    try {
      const r = await downloadRoster()
      setRoster(r)
      // The save itself is near-instant and writes to browser storage, not the
      // Downloads folder, so without an explicit confirmation it reads as
      // "nothing happened".
      setRosterNote(`Saved ${r.count} attendees to this device. Scanning will work offline.`)
    } catch (err) {
      setError(`Could not save the attendee list: ${err.message}`)
    } finally {
      setRosterBusy(false)
    }
  }

  if (!event) {
    return (
      <div className="card">
        <h2>Registrations</h2>
        <p className="muted">Select an event to see who has checked in.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="list-header">
        <h2>
          Registered <span className="count">{page.total}</span>
        </h2>
        {page.total > 0 && (
          <a className="button secondary small" href={registrationsCsvUrl(event.event_id)}>
            Export CSV
          </a>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {stats && (
        <p className="hint">
          {stats.registered} of {stats.total_attendees} attendees
          {stats.capacity ? ` · capacity ${stats.capacity}` : ''}
          {stats.by_method.manual ? ` · ${stats.by_method.manual} registered manually` : ''}
        </p>
      )}

      <div className="roster-block">
        <div className="roster-row">
          <button className="secondary small" onClick={handleDownloadRoster} disabled={rosterBusy}>
            {rosterBusy ? 'Saving…' : roster ? 'Update offline copy' : 'Save attendee list to this device'}
          </button>
          <span className={roster ? 'chip chip-online' : 'chip chip-offline'}>
            {roster ? '✓ offline ready' : 'not saved yet'}
          </span>
        </div>
        <p className="hint">
          {roster
            ? `${roster.count} attendees saved on this device, ${new Date(
                roster.cached_at,
              ).toLocaleString()}. Re-save after adding attendees.`
            : 'Saves the attendee list into this browser so scanning works without a network. It is not a file download.'}
        </p>
        {rosterNote && <p className="ok-note">{rosterNote}</p>}
      </div>

      <h3 className="section-label">Register manually</h3>
      <input
        className="search"
        placeholder="Badge won’t scan? Find them by name…"
        value={manualQuery}
        onChange={(e) => setManualQuery(e.target.value)}
      />
      {manualNote && (
        <p className={manualNote.status === 'registered' ? 'ok-note' : 'form-error'}>
          {manualNote.message}
        </p>
      )}

      {manualQuery.trim() && candidates.length === 0 && !manualNote && (
        <p className="hint">No attendee matches “{manualQuery}”.</p>
      )}

      {candidates.length > 0 && (
        <ul className="user-list candidates">
          {candidates.map((u) => (
            <li key={u.user_id}>
              <button className="user-row" onClick={() => handleManual(u)}>
                <span className="user-name">{u.name}</span>
                <span className="user-meta">
                  {u.email}
                  {u.organization ? ` · ${u.organization}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-label">Checked in</h3>
      <input
        className="search"
        type="search"
        placeholder="Search registrations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {page.items.length === 0 ? (
        <p className="muted">{query ? 'No matches.' : 'Nobody has been registered yet.'}</p>
      ) : (
        <ul className="user-list">
          {page.items.map((r) => (
            <li key={r.registration_id}>
              <div className="event-row">
                <div className="event-main">
                  <span className="user-name">{r.name}</span>
                  <span className="user-meta">
                    {new Date(r.registered_at).toLocaleTimeString()}
                    {r.method === 'manual' ? ' · manual' : ''}
                    {r.device_id ? ` · ${r.device_id}` : ''}
                  </span>
                </div>
                <button className="link-button" onClick={() => handleUndo(r)}>
                  Undo
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
