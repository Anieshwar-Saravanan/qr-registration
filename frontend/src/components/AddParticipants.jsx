import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createUser, listTeams, listUsers, manualRegister } from '../api'
import AddUserForm from './AddUserForm'
import { getDeviceId } from '../lib/device'
import { personMeta } from '../lib/person'

// html5-qrcode is ~350KB and only the Scan mode needs it, so it is loaded the
// first time someone opens that mode rather than with the page.
const ScannerPanel = lazy(() => import('./ScannerPanel'))

const MODES = [
  ['scan', 'Scan QR'],
  ['pid', 'Prodigy ID'],
  ['search', 'By name'],
  ['new', 'New student'],
]

/** The one place participants get added to an event: by badge, by Prodigy ID,
 *  by name, or by typing a student who is not on the list yet. */
export default function AddParticipants({ event, refreshKey, onChanged }) {
  const [mode, setMode] = useState('scan')
  const [teams, setTeams] = useState([])
  const [team, setTeam] = useState('')
  const [note, setNote] = useState(null)

  const [pid, setPid] = useState('')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState([])

  const isTeamEvent = event?.event_type === 'team'
  const isFull = (t) => event?.team_size_max != null && t.size >= event.team_size_max

  const loadTeams = useCallback(async () => {
    if (!event || event.event_type !== 'team') return setTeams([])
    try {
      setTeams(await listTeams(event.event_id))
    } catch {
      setTeams([])
    }
  }, [event])

  useEffect(() => {
    loadTeams()
  }, [loadTeams, refreshKey])

  // A team that filled up or was disbanded must not stay selected, or the add
  // is sent to a team that cannot take it.
  useEffect(() => {
    if (team && !teams.some((t) => t.team_id === team && !isFull(t))) setTeam('')
  }, [teams]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNote(null)
  }, [mode, event])

  // Name search for the "By name" mode.
  useEffect(() => {
    if (mode !== 'search' || !query.trim()) return setCandidates([])
    const t = setTimeout(() => {
      listUsers({ q: query, limit: 6 })
        .then((r) => setCandidates(r.items))
        .catch(() => setCandidates([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, mode])

  async function register(user) {
    if (isTeamEvent && !team) {
      setNote({ ok: false, message: 'Choose which team they are joining first.' })
      return false
    }
    try {
      // The endpoint answers 200 for refusals too - already registered, event
      // closed, event full - so the status has to be read, not assumed.
      const res = await manualRegister(
        event.event_id,
        user.user_id,
        getDeviceId(),
        isTeamEvent ? team : null,
      )
      setNote({ ok: res.status === 'registered', message: res.message })
      if (res.status === 'registered') onChanged?.()
      return res.status === 'registered'
    } catch (err) {
      setNote({ ok: false, message: err.message })
      return false
    }
  }

  async function handlePid(e) {
    e.preventDefault()
    const wanted = Number(pid)
    if (!Number.isInteger(wanted) || wanted < 1) return
    try {
      // The general search is a substring match, so "7" also returns every
      // roll number containing a 7. Only an exact Prodigy ID counts here.
      const page = await listUsers({ q: String(wanted), limit: 20 })
      const match = page.items.find((u) => u.prodigy_id === wanted)
      if (!match) {
        setNote({ ok: false, message: `No student has Prodigy ID ${wanted}.` })
        return
      }
      if (await register(match)) setPid('')
    } catch (err) {
      setNote({ ok: false, message: err.message })
    }
  }

  async function handleNew(created) {
    // Created and registered in one go: on an event desk the student standing
    // there is being added *to this event*, not just to the master list.
    if (await register(created)) onChanged?.()
  }

  if (!event) {
    return (
      <div className="card">
        <h2>Add participants</h2>
        <p className="muted">Select an event first — participants have to go somewhere.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Add participants</h2>
      <div className="mode-switch">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            className={mode === id ? 'chip-button on' : 'chip-button'}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {isTeamEvent && (
        <>
          <select
            className="search team-picker"
            value={team}
            onChange={(e) => {
              setTeam(e.target.value)
              setNote(null)
            }}
          >
            <option value="">{teams.length ? 'Which team are they joining?' : 'No teams yet'}</option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id} disabled={isFull(t)}>
                {t.name} — {t.size}
                {event.team_size_max ? `/${event.team_size_max}` : ''} members
                {isFull(t) ? ' (full)' : ''}
              </option>
            ))}
          </select>
          <p className="hint">
            {teams.length
              ? 'Everyone on a team event belongs to a team, so pick theirs before adding them.'
              : 'Form the first team by scanning — a team cannot start with one person.'}
          </p>
        </>
      )}

      {note && <p className={note.ok ? 'ok-note' : 'form-error'}>{note.message}</p>}

      {mode === 'scan' && (
        <Suspense fallback={<p className="muted">Loading scanner…</p>}>
          <ScannerPanel event={event} onRegistered={onChanged} embedded />
        </Suspense>
      )}

      {mode === 'pid' && (
        <form onSubmit={handlePid} className="inline-form">
          <input
            type="number"
            min="1"
            value={pid}
            onChange={(e) => {
              setPid(e.target.value)
              setNote(null)
            }}
            placeholder="Prodigy ID, e.g. 42"
            autoFocus
          />
          <button type="submit" disabled={!pid}>
            Add
          </button>
        </form>
      )}

      {mode === 'search' && (
        <>
          <input
            className="search"
            placeholder="Find them by name…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setNote(null)
            }}
            autoFocus
          />
          {query.trim() && candidates.length === 0 && !note && (
            <p className="hint">No student matches “{query}”.</p>
          )}
          {candidates.length > 0 && (
            <ul className="user-list candidates">
              {candidates.map((u) => (
                <li key={u.user_id}>
                  <button
                    className="user-row"
                    onClick={async () => {
                      if (await register(u)) {
                        setQuery('')
                        setCandidates([])
                      }
                    }}
                  >
                    <span className="user-name">
                      {u.name}
                      {u.prodigy_id != null && <span className="pid-tag">PID {u.prodigy_id}</span>}
                    </span>
                    <span className="user-meta">{personMeta(u) || u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === 'new' && (
        <>
          <p className="hint">
            Adds them to the student list and registers them for “{event.name}” in one step.
          </p>
          <AddUserForm onCreated={handleNew} embedded />
        </>
      )}
    </div>
  )
}
