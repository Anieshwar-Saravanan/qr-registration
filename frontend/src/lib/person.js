/** How a student's details are worded and ordered wherever they appear.
 *
 * Kept in one place so the attendee table, the scanner, the roster, the team
 * list and the results image cannot drift into describing the same student
 * differently.
 */

/** School event: 9th to 12th standard. */
export const STANDARD_OPTIONS = [9, 10, 11, 12]

/** 10 -> "Class 10". Null for a student whose standard was never recorded. */
export function standardLabel(standard) {
  if (standard == null || standard === '') return null
  return `Class ${standard}`
}

/** The one-line summary under a student's name. The Prodigy ID is left out on
 *  purpose: it gets its own column wherever it matters, and repeating it here
 *  would just make every line longer. Blank fields are dropped rather than
 *  rendered as gaps. */
export function personMeta(person) {
  return [person?.roll_no, person?.school, standardLabel(person?.standard)]
    .filter(Boolean)
    .join(' · ')
}
