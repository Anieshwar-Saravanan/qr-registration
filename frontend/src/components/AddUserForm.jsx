import { useState } from 'react'
import { createUser } from '../api'
import { STANDARD_OPTIONS, standardLabel } from '../lib/person'

const EMPTY = { name: '', prodigy_id: '', roll_no: '', school: '', standard: '', phone: '', email: '' }

export default function AddUserForm({ onCreated, embedded = false }) {
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
        prodigy_id: form.prodigy_id ? Number(form.prodigy_id) : null,
        school: blank(form.school),
        standard: form.standard ? Number(form.standard) : null,
        phone: blank(form.phone),
        email: blank(form.email),
      })
      // School and standard are kept: a whole school is usually entered in one
      // sitting, so clearing them would mean retyping the same two values for
      // every student.
      setForm({ ...EMPTY, school: form.school, standard: form.standard })
      setAdded(created)
      onCreated(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={embedded ? '' : 'card'} onSubmit={handleSubmit}>
      {!embedded && <h2>Add student</h2>}
      <label>
        Name <span className="req">*</span>
        <input value={form.name} onChange={update('name')} required placeholder="Jane Doe" autoFocus />
      </label>
      <div className="field-row">
        <label>
          Prodigy ID
          <input
            type="number"
            min="1"
            value={form.prodigy_id}
            onChange={update('prodigy_id')}
            placeholder="1"
          />
        </label>
        <label>
          Roll no <span className="req">*</span>
          <input value={form.roll_no} onChange={update('roll_no')} required placeholder="9A01" />
        </label>
      </div>
      <label>
        School
        <input value={form.school} onChange={update('school')} placeholder="DAV Public School" />
      </label>
      <div className="field-row">
        <label>
          Standard
          <select value={form.standard} onChange={update('standard')}>
            <option value="">—</option>
            {STANDARD_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {standardLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone number
          <input value={form.phone} onChange={update('phone')} placeholder="98400 00000" />
        </label>
      </div>
      <label>
        Mail id
        <input type="email" value={form.email} onChange={update('email')} placeholder="jane@example.com" />
      </label>

      {error && <p className="form-error">{error}</p>}
      {added && !embedded && (
        <p className="ok-note">
          Added <strong>{added.name}</strong>
          {added.prodigy_id != null ? ` (PID ${added.prodigy_id})` : ''} — click them in the
          table to see their QR.
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add student'}
      </button>
    </form>
  )
}
