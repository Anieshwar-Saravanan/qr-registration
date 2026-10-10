import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createTeam, listTeams, listUsers, manualRegister } from '../api'
import AddUserForm from './AddUserForm'
import { getDeviceId } from '../lib/device'
import { markRegistered } from '../lib/roster'
import { personMeta } from '../lib/person'

// html5-qrcode is ~350KB and only the Scan mode needs it, so it is loaded the
// first time someone opens that mode rather than with the page.
const ScannerPanel = lazy(() => import('./ScannerPanel'))

// Picked in the team dropdown to start a team here rather than join one.
const NEW_TEAM = '__new__'

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

  // Forming a team here instead of joining one. Members are collected into a
  // buffer and written in a single call, because a team is created whole -
  // there is no endpoint that makes a team of one and grows it.
  const [teamName, setTeamName] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [buffer, setBuffer] = useState([])
  const [committing, setCommitting] = useState(false)

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
    // While a team is being formed, everyone found by any method lands in the
    // buffer instead of being registered on their own.
    if (collecting) return addToBuffer(user)

    if (isTeamEvent && (!team || team === NEW_TEAM)) {
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

  function addToBuffer(user) {
    if (buffer.some((m) => m.user_id === user.user_id)) {
      setNote({ ok: false, message: `${user.name} is already in this team.` })
      return false
    }
    const next = [...buffer, user]
    setBuffer(next)
    setNote({
      ok: true,
      message: `${user.name} added · ${next.length} of ${event.team_size_min}–${event.team_size_max}`,
    })
    // A full team saves itself rather than waiting to be told.
    if (next.length >= event.team_size_max) commitTeam(next)
    return true
  }

  async function commitTeam(members) {
    const list = members ?? buffer
    if (list.length === 0) return
    setCommitting(true)
    try {
      const saved = await createTeam(event.event_id, {
        name: teamName.trim(),
        member_ids: list.map((m) => m.user_id),
        device_id: getDeviceId(),
      })
      // Mark them locally so the scanner catches a re-scan straight away.
      for (const m of list) await markRegistered(event.event_id, m.user_id)
      setBuffer([])
      setCollecting(false)
      setTeamName('')
      setTeam(saved.team_id)
      setNote({
        ok: true,
        message: saved.renamed_from
          ? `Saved as “${saved.name}” — “${saved.renamed_from}” was already taken.`
          : `${saved.name} registered with ${saved.size} members.`,
      })
      await loadTeams()
      onChanged?.()
    } catch (err) {
      // The buffer is deliberately kept, so a failed save can be retried
      // without looking every Prodigy ID up again.
      setNote({ ok: false, message: `Could not save the team: ${err.message}` })
    } finally {
      setCommitting(false)
    }
  }

  function cancelTeam() {
    setBuffer([])
    setCollecting(false)
    setTeamName('')
    setNote(null)
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

      {isTeamEvent && !collecting && (
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
            <option value={NEW_TEAM}>+ Start a new team…</option>
          </select>

          {team === NEW_TEAM ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!teamName.trim()) return
                setCollecting(true)
                setNote({
                  ok: true,
                  message: `Now add ${event.team_size_min}–${event.team_size_max} members by Prodigy ID, name, or scanning.`,
                })
              }}
            >
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Team name"
                autoFocus
              />
              <button type="submit" disabled={!teamName.trim()}>
                Start team
              </button>
            </form>
          ) : (
            <p className="hint">
              {teams.length
                ? 'Everyone on a team event belongs to a team, so pick theirs before adding them.'
                : 'No teams yet — choose “Start a new team” to make the first one.'}
            </p>
          )}
        </>
      )}

      {collecting && (
        <div className="team-buffer">
          <div className="team-head">
            <span className="team-name">{teamName}</span>
            <span className="team-size">
              {buffer.length} of {event.team_size_min}–{event.team_size_max}
            </span>
          </div>
          {buffer.length === 0 ? (
            <p className="hint">Nobody added yet.</p>
          ) : (
            <ol className="team-members">
              {buffer.map((m) => (
                <li key={m.user_id}>
                  {m.name}
                  {m.prodigy_id != null && <span className="pid-tag">PID {m.prodigy_id}</span>}
                  <button
                    className="link-button"
                    onClick={() => setBuffer((b) => b.filter((x) => x.user_id !== m.user_id))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="button-row">
            <button
              onClick={() => commitTeam()}
              disabled={committing || buffer.length < event.team_size_min}
            >
              {committing
                ? 'Saving…'
                : buffer.length < event.team_size_min
                  ? `Need ${event.team_size_min - buffer.length} more`
                  : `Finish team (${buffer.length})`}
            </button>
            <button className="secondary" onClick={cancelTeam} disabled={committing}>
              Cancel team
            </button>
          </div>
        </div>
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
