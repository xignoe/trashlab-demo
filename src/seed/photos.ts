/**
 * Evidence photos. The files live in public/photos and are served at /photos/<file>. They come from
 * portal/src/seed/photos (generic scenes) and account/public/photos (one per seeded exception event).
 *
 * The seed is billing's, whose ServiceEvent.photoUrl values name evidence files that were never shipped
 * ("/evidence/maple-extra-bags.jpg"). resolvePhoto maps each of those to the closest real file, so a surface can
 * render an img tag without a 404. Portal style values ("photos/extra-bags.svg") resolve to /photos/extra-bags.svg.
 * Anything else that is not a known photo returns undefined, and callers show their text placeholder instead.
 */

/** Every file under public/photos. The photos test checks this list against the folder. */
export const PHOTO_FILES = [
  'blocked-driveway.svg',
  'completed-cart-at-curb.svg',
  'contamination.svg',
  'extra-bags.svg',
  'ev_bakery_contamination.svg',
  'ev_fl_003_dryrun.svg',
  'ev_hale_dryrun.svg',
  'ev_maple_extrabags.svg',
  'ev_res_014_overload.svg',
] as const

/** Billing seed evidence names to the photo that shows the same scene. */
const EVIDENCE_TO_PHOTO: Record<string, (typeof PHOTO_FILES)[number]> = {
  'maple-extra-bags.jpg': 'ev_maple_extrabags.svg',
  'bakery-wood-contamination.jpg': 'ev_bakery_contamination.svg',
  'res014-overload.jpg': 'ev_res_014_overload.svg',
  'res008-extra-bags-0825.jpg': 'extra-bags.svg',
  'res012-extra-bags-0324.jpg': 'extra-bags.svg',
  'fl003-contamination-0826.jpg': 'contamination.svg',
  'fl004-contamination-0819.jpg': 'contamination.svg',
  'fl005-blocked-0617.jpg': 'blocked-driveway.svg',
  'hale-b-blocked.jpg': 'blocked-driveway.svg',
}

const KNOWN = new Set<string>(PHOTO_FILES)

function base(): string {
  const b = import.meta.env?.BASE_URL ?? '/'
  return b.endsWith('/') ? b : `${b}/`
}

/** A served URL for a seeded photoUrl, or undefined when there is no real file for it. */
export function resolvePhoto(photoUrl: string | undefined): string | undefined {
  if (!photoUrl) return undefined
  const file = photoUrl.split('/').pop() ?? ''
  if (/^\/?evidence\//.test(photoUrl)) {
    const mapped = EVIDENCE_TO_PHOTO[file]
    return mapped ? `${base()}photos/${mapped}` : undefined
  }
  if (/^\/?photos\//.test(photoUrl) && KNOWN.has(file)) return `${base()}photos/${file}`
  return undefined
}
