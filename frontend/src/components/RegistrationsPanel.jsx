import { useCallback, useEffect, useState } from 'react'
import {
  eventStats,
  listRegistrations,
  listUsers,
  manualRegister,
  registrationsCsvUrl,
  removeRegistrations,
  undoRegistration,
} from '../api'
import { getDeviceId } from '../lib/device'
import { downloadRoster, getRoster, primeRegistered, unmarkRegistered } from '../lib/roster'
import RegistrationsTable from './RegistrationsTable'

const PAGE_SIZE = 50

export default function RegistrationsPanel({ event, refreshKey, onChanged }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [note, setNote] = useState(null)

  const [manualQuery, setManualQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [manualNote, setManualNote] = useState(null)
  const [roster, setRoster] = useState(null)
  const [rosterBusy, setRosterBusy] = useState(false)
  const [rosterNote, setRosterNote] = useState(null)

  const load = useCallback(async () => {
    if (!event) return
    try {
      const [page, s] = await Promise.all([
        listRegistrations(event.event_id, { q: query, limit: PAGE_SIZE }),
        eventStats(event.event_id),
      ])
      setRows(page.items)
      setTotal(page.total)
      setStats(s)
      setError(null)
      // Keep this device aware of who other volunteers have registered - and,
      // when this page IS the whole registration list, of who is no longer
      // registered. Anything less than the complete unfiltered list can only
      // be merged in, never used to rebuild the set.
      await primeRegistered(
        event.event_id,
        page.items.map((r) => r.user_id),
        { replace: !query.trim() && page.items.length === page.total },
      )
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

  // Selections refer to rows that may no longer be listed after a filter or
  // refresh, so they are dropped whenever the visible set changes.
  useEffect(() => {
    setSelected(new Set())
  }, [query, event])

  async function loadMore() {
    setBusy(true)
    try {
      const page = await listRegistrations(event.event_id, { q: query, limit: PAGE_SIZE, offset: rows.length })
      setRows((prev) => [...prev, ...page.items])
      setTotal(page.total)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function toggle(userId) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) =>
      rows.every((r) => prev.has(r.user_id)) ? new Set() : new Set(rows.map((r) => r.user_id)),
    )
  }

  async function handleRemoveOne(row) {
    if (!confirm(`Remove ${row.name} from “${event.name}”?\n\nThey stay in the attendee list and can be registered again.`)) return
    setBusy(true)
    setNote(null)
    try {
      await undoRegistration(event.event_id, row.user_id)
      // The scanner refuses a badge it has locally marked as registered, so
      // the mark has to go with the registration or they cannot be re-added.
      await unmarkRegistered(event.event_id, [row.user_id])
      setNote(`Removed ${row.name}.`)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!confirm(`Remove ${ids.length} ${ids.length === 1 ? 'person' : 'people'} from “${event.name}”?\n\nThey stay in the attendee list and can be registered again.`)) return

    setBusy(true)
    setNote(null)
    try {
      const res = await removeRegistrations(event.event_id, ids)
      await unmarkRegistered(event.event_id, ids)
      setNote(`Removed ${res.removed} of ${res.requested}.`)
      setSelected(new Set())
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

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
      // closed, event full - so the status has to be read.
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

  async function handleDownloadRoster() {
    setRosterBusy(true)
    setRosterNote(null)
    try {
      const r = await downloadRoster()
      setRoster(r)
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
          Registered <span className="count">{total}</span>
        </h2>
        {total > 0 && (
          <a className="button secondary small" href={registrationsCsvUrl(event.event_id)}>
            Export CSV
          </a>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      {stats && (
        <p className="hint">
          {stats.registered} of {stats.total_attendees} attendees
          {stats.capacity ? ` · capacity ${stats.capacity}` : ''}
          {stats.by_method.manual ? ` · ${stats.by_method.manual} registered manually` : ''}
        </p>
      )}

      <input
        className="search"
        type="search"
        placeholder="Search registrations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>
            {selected.size} selected
          </span>
          <button className="danger small" onClick={handleRemoveSelected} disabled={busy}>
            Remove selected
          </button>
          <button className="link-button" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">{query ? 'No matches.' : 'Nobody has been registered yet.'}</p>
      ) : (
        <>
          <RegistrationsTable
            showTeam={event.event_type === 'team'}
            rows={rows}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onRemove={handleRemoveOne}
          />
          {rows.length < total && (
            <button className="secondary full-width" onClick={loadMore} disabled={busy}>
              {busy ? 'Loading…' : `Load more (${total - rows.length} remaining)`}
            </button>
          )}
        </>
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
            ? `${roster.count} attendees saved on this device, ${new Date(roster.cached_at).toLocaleString()}. Re-save after adding attendees.`
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
    </div>
  )
}
