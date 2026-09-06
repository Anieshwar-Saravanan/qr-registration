import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { createTeam, syncScans } from '../api'
import { getDeviceId } from '../lib/device'
import { signal } from '../lib/feedback'
import { parsePayload } from '../lib/payload'
import * as queue from '../lib/queue'
import { getRegisteredSet, getRoster, lookupLocal, markRegistered } from '../lib/roster'

const READER_ID = 'qr-reader'
// The camera decodes several times a second and will happily re-read the same
// badge twenty times while its owner walks away.
const SAME_BADGE_COOLDOWN_MS = 4000

// One place for what each outcome is called, so a live scan and a correction
// arriving later from the server never word the same thing differently.
const STATUS_TEXT = {
  registered: { title: 'Registered', icon: '✓' },
  team_added: { title: 'Added to team', icon: '+' },
  team_done: { title: 'Team registered', icon: '✓' },
  team_duplicate: { title: 'Already in this team', icon: '!' },
  no_team: { title: 'Start a team first', icon: '!' },
  already_registered: { title: 'Already registered', icon: '!' },
  unknown_user: { title: 'Not on the attendee list', icon: '✕' },
  invalid_qr: { title: 'Not a valid badge', icon: '✕' },
  event_closed: { title: 'Event is closed', icon: '✕' },
  event_full: { title: 'Event is full', icon: '✕' },
}
const ANY_SCAN_COOLDOWN_MS = 900

export default function ScannerPanel({ event, onRegistered }) {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const [queued, setQueued] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [roster, setRoster] = useState(null)
  const [registered, setRegistered] = useState(new Set())
  const [error, setError] = useState(null)
  const [syncNote, setSyncNote] = useState(null)
  const [corrections, setCorrections] = useState([])

  // --- team mode ---
  const isTeamEvent = event?.event_type === 'team'
  const [teamName, setTeamName] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [buffer, setBuffer] = useState([])
  const [committing, setCommitting] = useState(false)
  const [teamNote, setTeamNote] = useState(null)

  // Best local estimate of the event's headcount: the server's number from
  // when the event was loaded, or what this device has registered since -
  // whichever is higher. Approximate by nature, which is why the server still
  // enforces capacity; this only avoids showing green to someone who is
  // certainly not getting in.
  const knownCount = Math.max(event?.registered_count ?? 0, registered.size)

  const scannerRef = useRef(null)
  const lastScan = useRef({ text: null, at: 0 })
  const startingRef = useRef(false)
  // html5-qrcode captures the decode callback once, at start(). Routing
  // through a ref means every scan runs the CURRENT handler - otherwise the
  // scanner keeps calling the closure it captured, whose `roster` is still
  // null (it loads asynchronously) and whose registered-set never updates.
  const handlerRef = useRef(null)

  // --- connectivity ---------------------------------------------------
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // --- local state for this event -------------------------------------
  const refreshLocal = useCallback(async () => {
    if (!event) return
    setQueued(await queue.count(event.event_id))
    setRegistered(await getRegisteredSet(event.event_id))
  }, [event])

  useEffect(() => {
    getRoster().then(setRoster)
    refreshLocal()
  }, [refreshLocal])

  // --- sync ------------------------------------------------------------
  const sync = useCallback(
    async ({ quiet = false } = {}) => {
      if (!event || !navigator.onLine) return
      const items = await queue.pending(event.event_id)
      if (items.length === 0) {
        if (!quiet) setSyncNote('Nothing to sync.')
        return
      }

      try {
        const res = await syncScans(
          event.event_id,
          items.map((i) => ({
            payload: i.payload,
            device_id: i.device_id,
            scan_id: i.scan_id,
            scanned_at: i.scanned_at,
          })),
        )
        // Every scan the server answered is settled, whatever the verdict -
        // a rejected badge must not sit in the queue retrying forever.
        await queue.drain(res.results.map((r) => r.scan_id).filter(Boolean))
        await refreshLocal()
        onRegistered?.()

        // A scan shown as green here can still be refused by the server -
        // another volunteer got there first, or the event filled up. Those
        // disagreements are surfaced, not buried in a summary line.
        const refused = res.results
          .filter((r) => r.status !== 'registered')
          .map((r) => ({
            status: r.status,
            name: r.user?.name ?? 'A badge',
            message: r.message,
          }))
        setCorrections(refused)

        const parts = Object.entries(res.summary).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
        setSyncNote(`Synced ${items.length}: ${parts.join(', ')}.`)
      } catch (err) {
        // Keep the queue intact and try again later.
        if (!quiet) setSyncNote(`Sync failed: ${err.message}. Scans are still saved.`)
      }
    },
    [event, refreshLocal, onRegistered],
  )

  // Opportunistic sync: on reconnect, and periodically while online.
  useEffect(() => {
    if (!online || !event) return
    sync({ quiet: true })
    const t = setInterval(() => sync({ quiet: true }), 15000)
    return () => clearInterval(t)
  }, [online, event, sync])

  // --- scanning --------------------------------------------------------
  const show = useCallback((status, { name, detail } = {}) => {
    const t = STATUS_TEXT[status] ?? { title: status, icon: '' }
    setResult({ status, title: t.title, icon: t.icon, name, detail, at: Date.now() })
    signal(status)
  }, [])

  const commitTeam = useCallback(
    async (members) => {
      const list = members ?? buffer
      if (list.length === 0) return
      setCommitting(true)
      setTeamNote(null)
      try {
        const team = await createTeam(event.event_id, {
          name: teamName.trim(),
          member_ids: list.map((m) => m.user_id),
          device_id: getDeviceId(),
        })
        // Mark members registered locally so a re-scan is caught instantly.
        for (const m of list) await markRegistered(event.event_id, m.user_id)
        setRegistered((prev) => {
          const next = new Set(prev)
          list.forEach((m) => next.add(m.user_id))
          return next
        })
        setBuffer([])
        setCollecting(false)
        setTeamName('')
        show('team_done', { name: team.name, detail: `${team.size} members registered.` })
        setTeamNote(
          team.renamed_from
            ? `Saved as “${team.name}” — “${team.renamed_from}” was already taken.`
            : `${team.name} registered with ${team.size} members.`,
        )
        onRegistered?.()
      } catch (err) {
        // The buffer is deliberately kept so the team can be retried without
        // asking everyone to scan again.
        setTeamNote(`Could not save the team: ${err.message}`)
        signal('invalid_qr')
      } finally {
        setCommitting(false)
      }
    },
    [buffer, event, teamName, show, onRegistered],
  )

  function cancelTeam() {
    setBuffer([])
    setCollecting(false)
    setTeamNote(null)
    setResult(null)
  }

  function removeFromBuffer(userId) {
    setBuffer((prev) => prev.filter((m) => m.user_id !== userId))
  }

  const handleDecoded = useCallback(
    async (text) => {
      const now = Date.now()
      if (now - lastScan.current.at < ANY_SCAN_COOLDOWN_MS) return
      if (text === lastScan.current.text && now - lastScan.current.at < SAME_BADGE_COOLDOWN_MS) return
      lastScan.current = { text, at: now }

      const parsed = parsePayload(text)
      if (parsed.error) {
        show('invalid_qr', { detail: parsed.error })
        return
      }

      // The cached roster lets an offline device name the person and reject a
      // badge that is not on the list, instead of queueing blind.
      const known = lookupLocal(roster, parsed.userId)
      if (roster && !known) {
        show('unknown_user', { detail: 'This badge is not in the attendee list for this event.' })
        return
      }

      const name = known?.name ?? parsed.hints?.name ?? 'Attendee'

      if (isTeamEvent) {
        if (!collecting) {
          show('no_team', { name, detail: 'Enter a team name and press Start team.' })
          return
        }
        if (buffer.some((m) => m.user_id === parsed.userId)) {
          show('team_duplicate', { name, detail: `Already in ${teamName}.` })
          return
        }
        if (registered.has(parsed.userId)) {
          show('already_registered', { name, detail: 'Already registered for this event.' })
          return
        }
        const next = [...buffer, { user_id: parsed.userId, name, organization: known?.organization }]
        setBuffer(next)
        show('team_added', {
          name,
          detail: `${teamName} · ${next.length} of ${event.team_size_min}–${event.team_size_max}`,
        })
        // A full team commits without waiting to be told.
        if (next.length >= event.team_size_max) commitTeam(next)
        return
      }

      // Checked here as well as on the server: queueing a scan the event will
      // certainly reject would show a green banner to someone who is not
      // actually getting in.
      if (event.status === 'closed') {
        show('event_closed', { name, detail: `“${event.name}” is not accepting registrations.` })
        return
      }

      if (registered.has(parsed.userId)) {
        show('already_registered', { name, detail: 'Already checked in for this event.' })
        setRecent((p) => [{ name, status: 'already_registered', at: now }, ...p].slice(0, 8))
        return
      }

      if (event.capacity != null && knownCount >= event.capacity) {
        show('event_full', {
          name,
          detail: `${event.capacity} of ${event.capacity} places taken.`,
        })
        return
      }

      // Queue first, upload second. The door keeps moving whether or not the
      // network does.
      await queue.enqueue({ eventId: event.event_id, payload: text, deviceId: getDeviceId() })
      await markRegistered(event.event_id, parsed.userId)
      setRegistered((prev) => new Set(prev).add(parsed.userId))
      await refreshLocal()

      show('registered', {
        name,
        detail: navigator.onLine ? 'Sending to server…' : 'Saved on this device — will sync when back online.',
      })
      setRecent((p) => [{ name, status: 'registered', at: now }, ...p].slice(0, 8))

      sync({ quiet: true })
    },
    [event, roster, registered, knownCount, refreshLocal, sync, show,
     isTeamEvent, collecting, buffer, teamName, commitTeam],
  )

  // A banner left on screen from an earlier scan could be read as the verdict
  // on the person now standing there, so it expires.
  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 6000)
    return () => clearTimeout(t)
  }, [result])

  // Kept pointing at the latest handler on every render.
  useEffect(() => {
    handlerRef.current = handleDecoded
  }, [handleDecoded])

  // Dev-only: simulate a scan without a camera, e.g. from the browser console
  //   __feedScan(JSON.stringify({v:1,type:'user',user_id:'<id>'}))
  // Vite strips this from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__feedScan = (text) => handlerRef.current?.(text)
    return () => {
      delete window.__feedScan
    }
  }, [])

  async function start() {
    if (startingRef.current || scanning) return
    startingRef.current = true
    setError(null)
    try {
      const scanner = new Html5Qrcode(READER_ID)
      scannerRef.current = scanner
      await scanner.start(
        // Rear camera; phones default to the selfie cam without this.
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => handlerRef.current?.(text),
        () => {
          /* per-frame "no QR found" noise - ignored on purpose */
        },
      )
      setScanning(true)
    } catch (err) {
      const msg = String(err?.message || err)
      setError(
        msg.includes('secure') || msg.includes('NotAllowed') || msg.includes('Permission')
          ? 'Camera blocked. Cameras only work over HTTPS or on localhost, and permission must be granted.'
          : `Could not start the camera: ${msg}`,
      )
    } finally {
      startingRef.current = false
    }
  }

  async function stop() {
    const scanner = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    try {
      if (scanner?.isScanning) await scanner.stop()
      scanner?.clear()
    } catch {
      /* already torn down */
    }
  }

  // Release the camera when the panel unmounts, or the light stays on.
  useEffect(() => () => { stop() }, [])

  if (!event) {
    return (
      <div className="card">
        <h2>Scan</h2>
        <p className="muted">Select an event first — scans have to go somewhere.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="list-header">
        <h2>Scanning into “{event.name}”</h2>
        <span className={online ? 'chip chip-online' : 'chip chip-offline'}>
          {online ? 'online' : 'offline'}
          {queued > 0 ? ` · ${queued} queued` : ''}
        </span>
      </div>

      {!roster && (
        <p className="warn-note">
          No roster cached on this device. Download it from the Event tab before going
          offline, or scans cannot be checked without a network.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {isTeamEvent && (
        <div className="team-mode">
          {!collecting ? (
            <>
              <label className="team-name-label">
                Team name
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. Code Warriors"
                  maxLength={80}
                />
              </label>
              <button
                onClick={() => {
                  setTeamNote(null)
                  setResult(null)
                  setCollecting(true)
                }}
                disabled={!teamName.trim()}
              >
                Start team
              </button>
              <p className="hint">
                Then scan {event.team_size_min}–{event.team_size_max} badges. The team saves
                automatically at {event.team_size_max}.
              </p>
            </>
          ) : (
            <>
              <div className="team-progress">
                <strong>{teamName}</strong>
                <span className="team-size">
                  {buffer.length} of {event.team_size_min}–{event.team_size_max}
                </span>
              </div>

              {buffer.length === 0 ? (
                <p className="hint">Scan the first member’s badge.</p>
              ) : (
                <ol className="buffer-list">
                  {buffer.map((m) => (
                    <li key={m.user_id}>
                      <span>
                        {m.name}
                        {m.organization && <span className="user-meta"> · {m.organization}</span>}
                      </span>
                      <button className="link-button" onClick={() => removeFromBuffer(m.user_id)}>
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
            </>
          )}
          {teamNote && <p className="hint team-note">{teamNote}</p>}
        </div>
      )}

      <div id={READER_ID} className={scanning ? 'reader active' : 'reader'} />

      {result && (
        <div className={`scan-result scan-${result.status}`}>
          <div className="scan-title">
            <span className="scan-icon">{result.icon}</span>
            {result.title}
          </div>
          {result.name && <div className="scan-name">{result.name}</div>}
          {result.detail && <div className="scan-detail">{result.detail}</div>}
        </div>
      )}

      {corrections.length > 0 && (
        <div className="corrections">
          <strong>The server disagreed with {corrections.length} scan
            {corrections.length === 1 ? '' : 's'}:</strong>
          <ul>
            {corrections.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
          <button className="link-button" onClick={() => setCorrections([])}>
            Dismiss
          </button>
        </div>
      )}

      <div className="button-row">
        {scanning ? (
          <button className="secondary" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button onClick={start}>Start camera</button>
        )}
        <button className="secondary" onClick={() => sync()} disabled={!online}>
          Sync now{queued > 0 ? ` (${queued})` : ''}
        </button>
      </div>

      {syncNote && <p className="hint">{syncNote}</p>}

      {recent.length > 0 && (
        <>
          <h3 className="section-label">Recent scans</h3>
          <ul className="recent-list">
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <span className={`dot dot-${r.status}`} />
                {r.name}
                <span className="muted"> · {new Date(r.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
