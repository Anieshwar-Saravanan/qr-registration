import { useState } from 'react'
import { createUser } from '../api'
import { YEAR_OPTIONS, yearLabel } from '../lib/person'

const EMPTY = {
  name: '',
  roll_no: '',
  domain: '',
  position: '',
  year: '',
  department: '',
  phone: '',
  email: '',
}

export default function AddUserForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState(null)

  const update = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    // Clear stale messages as soon as the user starts fixing things. Without
    // this, a submit the browser blocks natively leaves the previous error on
    // screen, pointing at the wrong field.
    if (error) setError(null)
    if (added) setAdded(null)
  }

  function scrollToQr() {
    document.querySelector('.qr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setAdded(null)
    try {
      // Optional fields go as null rather than "", so a blank stays absent
      // from the record instead of being stored as an empty string.
      const blank = (v) => v.trim() || null
      const created = await createUser({
        name: form.name.trim(),
        roll_no: form.roll_no.trim(),
        domain: blank(form.domain),
        position: blank(form.position),
        year: form.year ? Number(form.year) : null,
        department: blank(form.department),
        phone: blank(form.phone),
        email: blank(form.email),
      })
      setForm(EMPTY)
      // On a narrow screen the QR panel sits far below this form, so without
      // an explicit confirmation here a successful add looks like nothing
      // happened - the fields simply empty.
      setAdded(created)
      onCreated(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Add attendee</h2>
      <label>
        Name <span className="req">*</span>
        <input value={form.name} onChange={update('name')} required placeholder="Jane Doe" />
      </label>
      <label>
        Roll no <span className="req">*</span>
        <input
          value={form.roll_no}
          onChange={update('roll_no')}
          required
          placeholder="21CS001"
          autoCapitalize="characters"
        />
      </label>
      <label>
        Domain
        <input value={form.domain} onChange={update('domain')} placeholder="Web Development" />
      </label>
      <label>
        Position
        <input value={form.position} onChange={update('position')} placeholder="Member" />
      </label>
      <div className="field-row">
        <label>
          Year
          <select value={form.year} onChange={update('year')}>
            <option value="">—</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {yearLabel(y)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <input value={form.department} onChange={update('department')} placeholder="CSE" />
        </label>
      </div>
      <label>
        Phone number
        <input value={form.phone} onChange={update('phone')} placeholder="+91 98400 00000" />
      </label>
      <label>
        Mail id
        <input
          type="email"
          value={form.email}
          onChange={update('email')}
          placeholder="jane@example.com"
        />
      </label>

      {error && <p className="form-error">{error}</p>}
      {added && (
        <p className="ok-note">
          Added <strong>{added.name}</strong> ({added.roll_no}). Their QR code is ready
          {' '}
          <button type="button" className="link-button" onClick={scrollToQr}>
            — view it
          </button>
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add attendee'}
      </button>
    </form>
  )
}
