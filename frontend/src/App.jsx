import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteUser, listUsers } from './api'
import AddUserForm from './components/AddUserForm'
import ImportPanel from './components/ImportPanel'
import UserList from './components/UserList'
import QrPanel from './components/QrPanel'
import EventsPanel from './components/EventsPanel'
import RegistrationsPanel from './components/RegistrationsPanel'
import TeamsPanel from './components/TeamsPanel'
import WinnersPanel from './components/WinnersPanel'
import AddParticipants from './components/AddParticipants'

const PAGE_SIZE = 50
const TABS = [
  { id: 'attendees', label: 'Students' },
  { id: 'events', label: 'Events' },
  { id: 'winners', label: 'Winners' },
]

export default function App() {
  const [tab, setTab] = useState('attendees')

  // --- attendees (phase 1) ---
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const requestId = useRef(0)

  // --- events (phase 2) ---
  const [event, setEvent] = useState(null)
  const [regKey, setRegKey] = useState(0)

  useEffect(() => {
    // Debounce so typing "priya" fires one request, not five.
    const handle = setTimeout(() => {
      const id = ++requestId.current
      setLoading(true)
      listUsers({ q: query, limit: PAGE_SIZE, offset: 0 })
        .then((page) => {
          // A slower earlier request must not overwrite newer results.
          if (id !== requestId.current) return
          setUsers(page.items)
          setTotal(page.total)
          setError(null)
        })
        .catch((err) => id === requestId.current && setError(err.message))
        .finally(() => id === requestId.current && setLoading(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [query, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  async function handleDelete(user) {
    const label = `${user.name}${user.prodigy_id != null ? ` (PID ${user.prodigy_id})` : ''}`
    if (!confirm(`Delete ${label}?\n\nThis cannot be undone.`)) return
    try {
      // Unforced first, so the server can report what is attached before
      // anything is destroyed; the counts then go into the second prompt.
      await deleteUser(user.user_id)
    } catch (err) {
      if (err.status !== 409) {
        setError(err.message)
        return
      }
      if (!confirm(`${err.message}\n\nDelete them and those registrations anyway?`)) return
      try {
        await deleteUser(user.user_id, { force: true })
      } catch (forced) {
        setError(forced.message)
        return
      }
    }
    // The QR dialog is showing someone who no longer exists.
    if (selected?.user_id === user.user_id) setSelected(null)
    setError(null)
    refresh()
    refreshRegistrations()
  }
  const refreshRegistrations = useCallback(() => setRegKey((k) => k + 1), [])

  async function loadMore() {
    setLoading(true)
    try {
      const page = await listUsers({ q: query, limit: PAGE_SIZE, offset: users.length })
      setUsers((prev) => [...prev, ...page.items])
      setTotal(page.total)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCreated(user) {
    setSelected(user)
    refresh()
  }

  return (
    <div className="app">
      <header>
        <h1>QR Registration</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id !== 'attendees' && event && <span className="tab-sub">{event.name}</span>}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="error banner">{error}</p>}

      {tab === 'attendees' && (
        <main className="layout">
          <div className="column">
            <AddUserForm onCreated={handleCreated} />
            <ImportPanel onImported={refresh} />
          </div>
          <div className="column">
            <UserList
              users={users}
              total={total}
              query={query}
              onQueryChange={setQuery}
              selectedId={selected?.user_id}
              onSelect={setSelected}
              onDelete={handleDelete}
              loading={loading}
              onLoadMore={loadMore}
            />
          </div>
          <QrPanel user={selected} onClose={() => setSelected(null)} />
        </main>
      )}

      {tab === 'events' && (
        // Narrower sidebar than the attendees tab: the registrations table has
        // eight columns and needs the width more than the event list does.
        <main className="layout layout-events">
          <div className="column">
            <EventsPanel selectedId={event?.event_id} onSelect={setEvent} />
          </div>
          <div className="column">
            <AddParticipants
              event={event}
              refreshKey={regKey}
              onChanged={refreshRegistrations}
            />
            <RegistrationsPanel
              event={event}
              refreshKey={regKey}
              onChanged={refreshRegistrations}
            />
            <TeamsPanel event={event} refreshKey={regKey} onChanged={refreshRegistrations} />
          </div>
        </main>
      )}

      {tab === 'winners' && (
        <main className="layout single">
          <WinnersPanel event={event} refreshKey={regKey} />
        </main>
      )}
    </div>
  )
}
