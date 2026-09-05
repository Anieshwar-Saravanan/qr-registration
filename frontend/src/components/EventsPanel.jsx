import { useEffect, useState } from 'react'
import { createEvent, listEvents, updateEvent } from '../api'

export default function EventsPanel({ selectedId, onSelect }) {
  const [events, setEvents] = useState([])
  const [form, setForm] = useState({ name: '', venue: '', capacity: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)

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

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await createEvent({
        name: form.name.trim(),
        venue: form.venue.trim() || null,
        capacity: form.capacity ? Number(form.capacity) : null,
      })
      setForm({ name: '', venue: '', capacity: '' })
      setShowForm(false)
      await load()
      onSelect(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(ev) {
    try {
      await updateEvent(ev.event_id, { status: ev.status === 'open' ? 'closed' : 'open' })
      await load()
    } catch (err) {
      setError(err.message)
    }
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
                    {ev.status === 'closed' && <span className="chip chip-closed">closed</span>}
                  </span>
                  <span className="user-meta">
                    {ev.venue ? `${ev.venue} · ` : ''}
                    {ev.registered_count} registered
                    {ev.capacity ? ` / ${ev.capacity}` : ''}
                  </span>
                </button>
                <button
                  className="link-button"
                  onClick={() => toggleStatus(ev)}
                  title={ev.status === 'open' ? 'Close event' : 'Reopen event'}
                >
                  {ev.status === 'open' ? 'Close' : 'Reopen'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
