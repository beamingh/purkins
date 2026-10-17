/** Narrow the dynamic authenticated user to Purkins roles. */
export const getRole = (user: unknown): string | undefined => {
  if (typeof user !== 'object' || user === null || !('role' in user)) return undefined
  return typeof user.role === 'string' ? user.role : undefined
}

export const isOwner = (user: unknown): boolean => getRole(user) === 'owner'
export const isTeam = (user: unknown): boolean =>
  getRole(user) === 'owner' || getRole(user) === 'partner'
