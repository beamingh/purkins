/** Narrow the dynamic authenticated user to Purkins roles. */
export const getRole = (user: unknown): string | undefined => {
  if (typeof user !== 'object' || user === null || !('role' in user)) return undefined
  return typeof user.role === 'string' ? user.role : undefined
}

export const isOwner = (user: unknown): boolean => getRole(user) === 'owner'
export const isTeam = (user: unknown): boolean =>
  getRole(user) === 'owner' || getRole(user) === 'partner'

/**
 * First-user registration is a special Payload bootstrap operation that bypasses
 * normal collection access. Every later account must be created by an owner.
 */
export const initialRoleFor = (actor: unknown): 'owner' | 'partner' =>
  isOwner(actor) ? 'partner' : 'owner'
