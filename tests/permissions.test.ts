import { describe, expect, it } from 'vitest'
import { Products } from '../src/collections/Products'
import { Media } from '../src/collections/Media'
import { Users } from '../src/collections/Users'

const request = (role?: string) =>
  ({ req: { user: role ? { id: 'user-1', role } : null } }) as never

const fieldAccess = (name: string, action: 'read' | 'update', role?: string) => {
  const field = Products.fields.find((entry) => 'name' in entry && entry.name === name)
  if (!field || !('access' in field) || !field.access?.[action]) {
    throw new Error(`Missing ${action} access policy on ${name}`)
  }
  return field.access[action](request(role))
}

describe('private Purkins inventory', () => {
  it('denies anonymous access to inventory and photographs', () => {
    expect(Products.access?.read?.(request())).toBe(false)
    expect(Media.access?.read?.(request())).toBe(false)
    expect(Products.access?.create?.(request())).toBe(false)
    expect(Users.access?.create?.(request())).toBe(false)
  })

  it('restricts stock changes and media uploads to the owner', () => {
    expect(Products.access?.create?.(request('partner'))).toBe(false)
    expect(Products.access?.create?.(request('owner'))).toBe(true)
    expect(fieldAccess('quantity', 'update', 'partner')).toBe(false)
    expect(fieldAccess('quantity', 'update', 'owner')).toBe(true)
    expect(Media.access?.create?.(request('partner'))).toBe(false)
  })

  it('allows the partner to suggest a price, not approve one', () => {
    expect(Products.access?.read?.(request('partner'))).toBe(true)
    expect(Products.access?.update?.(request('partner'))).toBe(true)
    expect(fieldAccess('suggestedPriceZMW', 'update', 'partner')).toBe(true)
    expect(fieldAccess('sellingPriceZMW', 'update', 'partner')).toBe(false)
    expect(fieldAccess('costPriceZMW', 'read', 'partner')).toBe(false)
    expect(fieldAccess('costPriceZMW', 'read', 'owner')).toBe(true)
  })
})
