import { redirect } from 'next/navigation'

/** Compatibility redirect: operational work is now entirely under /admin. */
export default function FormerWorkspace() {
  redirect('/admin')
}
