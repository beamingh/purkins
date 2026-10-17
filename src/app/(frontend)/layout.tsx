import type { ReactNode } from 'react'

export const metadata = {
  title: 'Purkins | Baby & Mum Essentials',
  description: 'Private inventory management for Purkins.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
