import PurkinsWorkspace from './Workspace'
import './workspace.css'

export const metadata = {
  title: 'Stockroom | Purkins',
  description: 'Private Purkins inventory and pricing workspace.',
  robots: { index: false, follow: false },
}

export default function WorkspacePage() {
  return <PurkinsWorkspace />
}
