/**
 * The theme bridge stays consistent (box 1.7): every @theme entry points at the --rt- variable of the same name,
 * every --rt- variable has a :root default, and a filled surface sets only names the bridge declares.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(process.cwd(), 'src/styles')
const read = (f: string) => readFileSync(join(dir, f), 'utf8')

function block(css: string, opener: string): string {
  const start = css.indexOf(opener)
  if (start < 0) throw new Error(`no ${opener}`)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

const decls = (body: string) => [...body.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)].map(m => [m[1], m[2].trim()] as const)

const theme = read('theme.css')
const bridge = decls(block(theme, '\n@theme inline {'))
const rootDefaults = new Map(decls(block(theme, '\n:root {')))
const rtNames = bridge.map(([name]) => `--rt-${name.slice(2)}`)

describe('theme bridge', () => {
  it('maps every theme name to var(--rt-<same name>)', () => {
    expect(bridge.length).toBeGreaterThan(100)
    for (const [name, value] of bridge) expect(value, name).toBe(`var(--rt-${name.slice(2)})`)
  })

  it('gives every --rt- variable a :root default and declares nothing extra', () => {
    expect([...rootDefaults.keys()].sort()).toEqual([...rtNames].sort())
  })

  it('billing sets every bridged name inside .surface-billing', () => {
    const billing = decls(block(read('surfaces/billing.css'), '.surface-billing')).filter(([n]) => n.startsWith('--rt-'))
    expect(billing.map(([n]) => n).sort()).toEqual([...rtNames].sort())
  })

  it.each(['account', 'pricing', 'portal', 'storefront', 'billing'])('%s.css sets only declared --rt- names and only inside its wrapper', name => {
    const css = read(`surfaces/${name}.css`)
    const known = new Set(rtNames)
    for (const [n] of decls(css).filter(([n]) => n.startsWith('--rt-'))) expect(known.has(n), `${name}.css sets unknown ${n}`).toBe(true)
    expect(css).not.toMatch(/^(:root|html|body)\b/m)
    expect(css).toContain(`.surface-${name} {`)
  })
})
