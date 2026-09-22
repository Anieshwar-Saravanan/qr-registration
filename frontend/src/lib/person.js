/** How an attendee's details are worded and ordered wherever they appear.
 *
 * Kept in one place so the attendee list, the scanner, the roster table, the
 * team list and the results image cannot drift into describing the same
 * person differently.
 */

/** The form offers four years; the importer tolerates a fifth for integrated
 *  courses, so anything stored is rendered rather than dropped. */
export const YEAR_OPTIONS = [1, 2, 3, 4]

const ORDINALS = ['th', 'st', 'nd', 'rd']

/** 1 -> "1st Year". Null for a person whose year was never recorded. */
export function yearLabel(year) {
  if (year == null || year === '') return null
  const n = Number(year)
  if (!Number.isFinite(n)) return String(year)
  const v = n % 100
  return `${n}${ORDINALS[(v - 20) % 10] ?? ORDINALS[v] ?? ORDINALS[0]} Year`
}

/** The one-line summary under a person's name: roll no first, since that is
 *  what identifies them, then the things that distinguish two same-named
 *  people. Blank fields are dropped rather than rendered as gaps. */
export function personMeta(person) {
  return [person?.roll_no, person?.domain, person?.department, yearLabel(person?.year)]
    .filter(Boolean)
    .join(' · ')
}
