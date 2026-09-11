import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSeed, resolvePhoto, PHOTO_FILES } from './index'

const PUBLIC_PHOTOS = join(process.cwd(), 'public/photos')

describe('resolvePhoto', () => {
  it('PHOTO_FILES matches the files in public/photos', () => {
    expect([...PHOTO_FILES].sort()).toEqual(readdirSync(PUBLIC_PHOTOS).filter(f => !f.startsWith('.')).sort())
  })

  it('every seeded ServiceEvent.photoUrl resolves to a file that exists', () => {
    const files = new Set(readdirSync(PUBLIC_PHOTOS))
    const urls = loadSeed().serviceEvents.map(e => e.photoUrl).filter((u): u is string => Boolean(u))
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      const resolved = resolvePhoto(url)
      expect(resolved, url).toMatch(/^\/photos\//)
      expect(files.has(resolved!.replace('/photos/', '')), url).toBe(true)
    }
  })

  it('resolves portal style paths and refuses unknown ones', () => {
    expect(resolvePhoto('photos/extra-bags.svg')).toBe('/photos/extra-bags.svg')
    expect(resolvePhoto('/photos/contamination.svg')).toBe('/photos/contamination.svg')
    expect(resolvePhoto('photos/nope.svg')).toBeUndefined()
    expect(resolvePhoto('/evidence/unknown.jpg')).toBeUndefined()
    expect(resolvePhoto(undefined)).toBeUndefined()
  })
})
