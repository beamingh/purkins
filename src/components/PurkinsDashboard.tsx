import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'

import { isTeam } from '../access/roles'
import PurkinsDashboardClient from './PurkinsDashboardClient'

/**
 * /admin is the only operational home. Payload owns the logged-in shell,
 * navigation, auth, collections, media and user management.
 */
export default function PurkinsDashboard({
  initPageResult,
  params,
  searchParams,
  user,
}: AdminViewServerProps) {
  if (!isTeam(initPageResult.req.user)) {
    return <p role="alert">Sign in with an authorised Purkins account to access the stockroom.</p>
  }

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <PurkinsDashboardClient />
    </DefaultTemplate>
  )
}
