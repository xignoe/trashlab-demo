import { describe, expect, it } from 'vitest'
import { fmt, fmtSigned, parseDollars } from './money'

describe('money.fmt', () => {
  it('renders cents as dollars with thousands separators and two decimals', () => {
    expect(fmt(123456)).toBe('$1,234.56')
    expect(fmt(0)).toBe('$0.00')
    expect(fmt(5)).toBe('$0.05')
    expect(fmt(100)).toBe('$1.00')
    expect(fmt(131842)).toBe('$1,318.42')
    expect(fmt(123456789)).toBe('$1,234,567.89')
  })

  it('renders negatives in parentheses', () => {
    expect(fmt(-500)).toBe('($5.00)')
    expect(fmt(-123456)).toBe('($1,234.56)')
    expect(fmt(-1)).toBe('($0.01)')
  })

  it('rounds non-integer cents to the nearest cent before rendering', () => {
    expect(fmt(99.6)).toBe('$1.00')
    expect(fmt(99.4)).toBe('$0.99')
    expect(fmt(217.21)).toBe('$2.17')
    expect(fmt(-0.4)).toBe('$0.00')
    expect(fmt(-0.6)).toBe('($0.01)')
  })

  it('never throws on non-finite input', () => {
    expect(fmt(Number.NaN)).toBe('$0.00')
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('$0.00')
  })
})

describe('money.fmtSigned', () => {
  it('prefixes deltas with their sign and leaves zero bare', () => {
    expect(fmtSigned(100)).toBe('+$1.00')
    expect(fmtSigned(-100)).toBe('-$1.00')
    expect(fmtSigned(0)).toBe('$0.00')
  })
})

describe('money.parseDollars', () => {
  it('parses typed dollar amounts into integer cents', () => {
    expect(parseDollars('12.34')).toBe(1234)
    expect(parseDollars('$1,234.5')).toBe(123450)
    expect(parseDollars('31')).toBe(3100)
    expect(parseDollars(' 0.07 ')).toBe(7)
  })

  it('handles negatives in either notation and rounds half cents', () => {
    expect(parseDollars('-5')).toBe(-500)
    expect(parseDollars('(5.00)')).toBe(-500)
    expect(parseDollars('1.005')).toBe(101)
  })

  it('returns null for text that is not an amount', () => {
    expect(parseDollars('')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('1.2.3')).toBeNull()
    expect(parseDollars('.')).toBeNull()
  })
})
