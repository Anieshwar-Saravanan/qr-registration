import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { listUsers } from './api'
import AddUserForm from './components/AddUserForm'
import ImportPanel from './components/ImportPanel'
import UserList from './components/UserList'
import QrPanel from './components/QrPanel'
import EventsPanel from './components/EventsPanel'
import RegistrationsPanel from './components/RegistrationsPanel'

// html5-qrcode is ~350KB and only the Scan tab needs it. Loading it lazily
// keeps the initial download small for phones on venue wifi.
const ScannerPanel = lazy(() => import('./components/ScannerPanel'))

const PAGE_SIZE = 50
const TABS = [
  { id: 'attendees', label: 'Attendees' },
  { id: 'events', label: 'Events' },
  { id: 'scan', label: 'Scan' },
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
            <UserList
              users={users}
              total={total}
              query={query}
              onQueryChange={setQuery}
              selectedId={selected?.user_id}
              onSelect={setSelected}
              loading={loading}
              onLoadMore={loadMore}
            />
          </div>
          <QrPanel user={selected} />
        </main>
      )}

      {tab === 'events' && (
        // Narrower sidebar than the attendees tab: the registrations table has
        // eight columns and needs the width more than the event list does.
        <main className="layout layout-events">
          <div className="column">
            <EventsPanel selectedId={event?.event_id} onSelect={setEvent} />
          </div>
          <RegistrationsPanel
            event={event}
            refreshKey={regKey}
            onChanged={refreshRegistrations}
          />
        </main>
      )}

      {tab === 'scan' && (
        <main className="layout single">
          <Suspense fallback={<div className="card"><p className="muted">Loading scanner…</p></div>}>
            <ScannerPanel event={event} onRegistered={refreshRegistrations} />
          </Suspense>
        </main>
      )}
    </div>
  )
}
