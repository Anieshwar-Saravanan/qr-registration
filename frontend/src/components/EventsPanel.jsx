import { useEffect, useState } from 'react'
import { createEvent, deleteEvent, listEvents, updateEvent } from '../api'
import { forgetEvent } from '../lib/roster'
import * as queue from '../lib/queue'

const BLANK = {
  name: '',
  venue: '',
  capacity: '',
  event_type: 'individual',
  team_size_min: '3',
  team_size_max: '5',
}

const formFrom = (ev) => ({
  name: ev.name,
  venue: ev.venue ?? '',
  capacity: ev.capacity == null ? '' : String(ev.capacity),
  event_type: ev.event_type,
  team_size_min: String(ev.team_size_min ?? 3),
  team_size_max: String(ev.team_size_max ?? 5),
})

/** Form values -> API payload. Blank means "unset", not "empty string". */
function toPayload(form) {
  const isTeam = form.event_type === 'team'
  return {
    name: form.name.trim(),
    venue: form.venue.trim() || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    event_type: form.event_type,
    // Sizes are meaningless for an individual event, and sending them would
    // let a stale value linger if the type is switched later.
    team_size_min: isTeam ? Number(form.team_size_min) : null,
    team_size_max: isTeam ? Number(form.team_size_max) : null,
  }
}

/** The name/venue/type/size/capacity fields, shared by create and edit so the
 *  two forms cannot drift apart. */
function EventFields({ form, setForm }) {
  return (
    <>
      <label>
        Event name <span className="req">*</span>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          placeholder="TechFest 2026"
        />
      </label>
      <label>
        Venue
        <input
          value={form.venue}
          onChange={(e) => setForm({ ...form, venue: e.target.value })}
          placeholder="Main Auditorium"
        />
      </label>
      <fieldset className="type-toggle">
        <legend>Registration type</legend>
        {[
          ['individual', 'Individual', 'One person per registration'],
          ['team', 'Teams', 'People are scanned into teams'],
        ].map(([value, label, hint]) => (
          <label key={value} className={form.event_type === value ? 'type-option on' : 'type-option'}>
            <input
              type="radio"
              name="event_type"
              value={value}
              checked={form.event_type === value}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
            />
            <span>
              <strong>{label}</strong>
              <em>{hint}</em>
            </span>
          </label>
        ))}
      </fieldset>

      {form.event_type === 'team' && (
        <div className="size-row">
          <label>
            Min team size
            <input
              type="number"
              min="2"
              max="50"
              value={form.team_size_min}
              onChange={(e) => setForm({ ...form, team_size_min: e.target.value })}
              required
            />
          </label>
          <label>
            Max team size
            <input
              type="number"
              min="2"
              max="50"
              value={form.team_size_max}
              onChange={(e) => setForm({ ...form, team_size_max: e.target.value })}
              required
            />
          </label>
        </div>
      )}

      <label>
        Capacity (optional)
        <input
          type="number"
          min="1"
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          placeholder="Leave blank for unlimited"
        />
      </label>
    </>
  )
}

export default function EventsPanel({ selectedId, onSelect }) {
  const [events, setEvents] = useState([])
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Which row's ⋯ menu is open, which row is being edited, and which row is
  // asking for delete confirmation. Only ever one of each at a time.
  const [menuFor, setMenuFor] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState(BLANK)
  const [confirmFor, setConfirmFor] = useState(null)

  async function load() {
    try {
      setEvents(await listEvents())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // A row menu closes on an outside click or Escape, the way a menu is
  // expected to; without this it would sit open behind the next thing clicked.
  useEffect(() => {
    if (!menuFor) return
    const close = (e) => {
      if (!e.target.closest?.('.row-menu')) setMenuFor(null)
    }
    const onKey = (e) => e.key === 'Escape' && setMenuFor(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuFor])

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await createEvent(toPayload(form))
      setForm(BLANK)
      setShowForm(false)
      await load()
      onSelect(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleEdit(e, ev) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const updated = await updateEvent(ev.event_id, toPayload(editForm))
      setEditing(null)
      await load()
      // The panels below read the event's type and team sizes, so the
      // selection has to be refreshed rather than left on the stale copy.
      if (ev.event_id === selectedId) onSelect(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(ev) {
    setError(null)
    try {
      const updated = await updateEvent(ev.event_id, {
        status: ev.status === 'open' ? 'closed' : 'open',
      })
      await load()
      if (ev.event_id === selectedId) onSelect(updated)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(ev) {
    setBusy(true)
    setError(null)
    try {
      // Confirmed here, so the backend's unforced refusal is not what we want
      // to hit; it stays as the guard against an unconfirmed caller.
      await deleteEvent(ev.event_id, { force: true })
      // Nothing on this device should outlive the event: its queued scans can
      // never be accepted, and its registered-set would linger forever.
      await queue.clearEvent(ev.event_id)
      await forgetEvent(ev.event_id)
      setConfirmFor(null)
      await load()
      if (ev.event_id === selectedId) onSelect(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(ev) {
    setEditForm(formFrom(ev))
    setEditing(ev.event_id)
    setConfirmFor(null)
    setMenuFor(null)
    setError(null)
  }

  return (
    <div className="card">
      <div className="list-header">
        <h2>Events</h2>
        <button className="secondary small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'New event'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="event-form">
          <EventFields form={form} setForm={setForm} />
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create event'}
          </button>
        </form>
      )}

      {events.length === 0 ? (
        <p className="muted">No events yet. Create one to start scanning.</p>
      ) : (
        <ul className="user-list">
          {events.map((ev) => (
            <li key={ev.event_id}>
              <div className={ev.event_id === selectedId ? 'event-row selected' : 'event-row'}>
                <button className="event-main" onClick={() => onSelect(ev)}>
                  <span className="user-name">
                    {ev.name}
                    {ev.event_type === 'team' && (
                      <span className="chip chip-team">
                        teams of {ev.team_size_min}–{ev.team_size_max}
                      </span>
                    )}
                    {ev.status === 'closed' && <span className="chip chip-closed">closed</span>}
                  </span>
                  <span className="user-meta">
                    {ev.venue ? `${ev.venue} · ` : ''}
                    {ev.event_type === 'team'
                      ? `${ev.team_count} team${ev.team_count === 1 ? '' : 's'} · ${ev.registered_count} registered`
                      : `${ev.registered_count} registered`}
                    {ev.capacity ? ` / ${ev.capacity}` : ''}
                  </span>
                </button>

                <div className="row-menu">
                  <button
                    className="dots-button"
                    aria-haspopup="menu"
                    aria-expanded={menuFor === ev.event_id}
                    aria-label={`Actions for ${ev.name}`}
                    title="Actions"
                    onClick={() => setMenuFor((id) => (id === ev.event_id ? null : ev.event_id))}
                  >
                    ⋯
                  </button>
                  {menuFor === ev.event_id && (
                    <div className="menu-pop" role="menu">
                      <button role="menuitem" onClick={() => startEdit(ev)}>
                        Edit
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null)
                          toggleStatus(ev)
                        }}
                      >
                        {ev.status === 'open' ? 'Close event' : 'Reopen event'}
                      </button>
                      <button
                        role="menuitem"
                        className="menu-danger"
                        onClick={() => {
                          setMenuFor(null)
                          setEditing(null)
                          setConfirmFor(ev.event_id)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {editing === ev.event_id && (
                <form onSubmit={(e) => handleEdit(e, ev)} className="event-form event-form-inline">
                  <EventFields form={editForm} setForm={setEditForm} />
                  <div className="button-row">
                    <button type="submit" disabled={busy}>
                      {busy ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {confirmFor === ev.event_id && (
                <div className="danger-confirm">
                  <p>
                    <strong>Delete “{ev.name}”?</strong>
                  </p>
                  <p className="hint">
                    {ev.registered_count || ev.team_count
                      ? `This also removes ${ev.registered_count} registration${
                          ev.registered_count === 1 ? '' : 's'
                        }${
                          ev.event_type === 'team'
                            ? ` and ${ev.team_count} team${ev.team_count === 1 ? '' : 's'}`
                            : ''
                        }. `
                      : ''}
                    Attendees are not deleted — they stay in the attendee list and their badges
                    keep working for other events. This cannot be undone.
                  </p>
                  <div className="button-row">
                    <button className="danger" onClick={() => handleDelete(ev)} disabled={busy}>
                      {busy ? 'Deleting…' : 'Delete event'}
                    </button>
                    <button className="secondary" onClick={() => setConfirmFor(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
