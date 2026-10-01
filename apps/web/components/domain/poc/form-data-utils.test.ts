import { describe, expect, it } from 'vitest'
import { stripEmptyFormFields } from './form-data-utils'

describe('stripEmptyFormFields', () => {
  it('removes a key whose value is an empty string', () => {
    const fd = new FormData()
    fd.set('name', '')
    const result = stripEmptyFormFields(fd)
    expect(result.has('name')).toBe(false)
  })

  it('removes a key whose value is only whitespace', () => {
    const fd = new FormData()
    fd.set('notes', '   ')
    const result = stripEmptyFormFields(fd)
    expect(result.has('notes')).toBe(false)
  })

  it('keeps a key with a meaningful, non-blank value', () => {
    const fd = new FormData()
    fd.set('name', 'Dave')
    const result = stripEmptyFormFields(fd)
    expect(result.get('name')).toBe('Dave')
  })

  it('keeps the literal string "0" (a genuine value, not blank)', () => {
    const fd = new FormData()
    fd.set('candidatesSourcedCount', '0')
    const result = stripEmptyFormFields(fd)
    expect(result.get('candidatesSourcedCount')).toBe('0')
  })

  it('leaves a non-string (File/Blob) FormData value untouched', () => {
    const fd = new FormData()
    const file = new File(['content'], 'evidence.pdf', { type: 'application/pdf' })
    fd.set('attachment', file)
    const result = stripEmptyFormFields(fd)
    expect(result.get('attachment')).toBe(file)
  })

  it('strips several blank fields while keeping the populated ones, and mutates + returns the same FormData instance', () => {
    const fd = new FormData()
    fd.set('name', 'Dave')
    fd.set('notes', '')
    fd.set('startTime', '  ')
    fd.set('searchBoundaries', '{"region":"UK"}')

    const result = stripEmptyFormFields(fd)

    expect(result).toBe(fd)
    expect(result.has('notes')).toBe(false)
    expect(result.has('startTime')).toBe(false)
    expect(result.get('name')).toBe('Dave')
    expect(result.get('searchBoundaries')).toBe('{"region":"UK"}')
  })

  it('is a no-op on an empty FormData', () => {
    const fd = new FormData()
    const result = stripEmptyFormFields(fd)
    expect([...result.keys()]).toEqual([])
  })
})
