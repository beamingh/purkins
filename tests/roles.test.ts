import { describe, expect, it } from 'vitest'
import { getRole, isOwner, isTeam } from '../src/access/roles'

describe('Purkins user roles', () => {
  it('rejects anonymous and unrecognized users', () => {
    expect(getRole(null)).toBeUndefined()
    expect(isTeam(undefined)).toBe(false)
    expect(isOwner({ role: 'admin' })).toBe(false)
  })
  it('reserves privileged actions for the owner', () => {
    expect(isOwner({ role: 'owner' })).toBe(true)
    expect(isOwner({ role: 'partner' })).toBe(false)
  })
  it('allows partners to participate in pricing', () => {
    expect(isTeam({ role: 'partner' })).toBe(true)
    expect(isTeam({ role: 'owner' })).toBe(true)
  })
})
