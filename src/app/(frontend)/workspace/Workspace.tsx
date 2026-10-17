'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Role = 'owner' | 'partner'
type User = { id: number | string; email: string; role: Role }
type ProductStatus = 'intake' | 'needs-pricing' | 'ready' | 'facebook-listed' | 'reserved' | 'sold'
type Media = { id: number | string; url?: string | null; alt?: string | null }
type Product = {
  id: number | string
  title: string
  sku: string
  category?: string | null
  size?: string | null
  ageRange?: string | null
  colour?: string | null
  stockLocation?: string | null
  quantity?: number | null
  suggestedPriceZMW?: number | null
  sellingPriceZMW?: number | null
  photos?: (Media | number | string)[] | null
  status: ProductStatus
}
type ProductsResponse = {
  docs: Product[]
  totalDocs: number
  totalPages: number
  page: number
}
type Counters = { pricing: number | null; ready: number | null; listed: number | null }
type StatusOption = { value: string; label: string }
const STATUS_OPTIONS: StatusOption[] = [
  { value: 'all', label: 'All stock' },
  { value: 'intake', label: 'New intake' },
  { value: 'needs-pricing', label: 'Needs pricing' },
  { value: 'ready', label: 'Ready to list' },
  { value: 'facebook-listed', label: 'Listed on Facebook' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
]

const STATUS_LABEL: Record<ProductStatus, string> = {
  intake: 'New intake',
  'needs-pricing': 'Needs pricing',
  ready: 'Ready to list',
  'facebook-listed': 'Listed',
  reserved: 'Reserved',
  sold: 'Sold',
}

const currency = new Intl.NumberFormat('en-ZM', {
  style: 'currency',
  currency: 'ZMW',
  maximumFractionDigits: 0,
})

function price(value: number | null | undefined) {
  return typeof value === 'number' ? currency.format(value) : 'Price pending'
}

function photoUrl(product: Product): string | null {
  const photo = product.photos?.find((item): item is Media => typeof item === 'object' && item !== null)
  return photo?.url || null
}

function buildProductsUrl(status: string, search: string, page: number) {
  const params = new URLSearchParams({
    limit: '24',
    depth: '1',
    sort: '-updatedAt',
    page: String(page),
  })
  if (status !== 'all') params.set('where[status][equals]', status)
  if (search) {
    params.set('where[or][0][title][contains]', search)
    params.set('where[or][1][sku][contains]', search)
  }
  return '/api/products?' + params.toString()
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal })
  if (!response.ok) throw new Error('Request failed (' + response.status + ')')
  return response.json() as Promise<T>
}

function Metric({ label, value, caption, tone = '' }: {
  label: string; value: number | string | null; caption: string; tone?: string
}) {
  return (
    <article className={'purkins-metric ' + tone}>
      <div className="purkins-metric-label">{label}</div>
      <div className="purkins-metric-value">{value ?? '—'}</div>
      <div className="purkins-metric-caption">{caption}</div>
    </article>
  )
}

export default function PurkinsWorkspace() {
  const [user, setUser] = useState<User | null>(null)
  const [authState, setAuthState] = useState<'checking' | 'signed-in' | 'signed-out' | 'error'>('checking')
  const [products, setProducts] = useState<Product[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [counters, setCounters] = useState<Counters>({ pricing: null, ready: null, listed: null })
  const [status, setStatus] = useState('all')
  const [draftSearch, setDraftSearch] = useState('')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getJSON<{ user: User | null }>('/api/users/me', controller.signal)
      .then((data) => {
        if (!data.user || !['owner', 'partner'].includes(data.user.role)) {
          setAuthState('signed-out')
          return
        }
        setUser(data.user)
        setAuthState('signed-in')
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Could not check your session.')
        setAuthState('error')
      })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (authState !== 'signed-in') return
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await getJSON<ProductsResponse>(buildProductsUrl(status, search, page), controller.signal)
        if (controller.signal.aborted) return
        setProducts(data.docs)
        setTotalDocs(data.totalDocs)
        setTotalPages(data.totalPages)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load inventory.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [authState, status, search, page, refresh])

  useEffect(() => {
    if (authState !== 'signed-in') return
    const controller = new AbortController()
    const count = async (value: string) => {
      const params = new URLSearchParams({ limit: '1', depth: '0' })
      params.set('where[status][equals]', value)
      const data = await getJSON<ProductsResponse>('/api/products?' + params, controller.signal)
      return data.totalDocs
    }
    Promise.allSettled([count('needs-pricing'), count('ready'), count('facebook-listed')])
      .then((results) => {
        if (controller.signal.aborted) return
        setCounters({
          pricing: results[0].status === 'fulfilled' ? results[0].value : null,
          ready: results[1].status === 'fulfilled' ? results[1].value : null,
          listed: results[2].status === 'fulfilled' ? results[2].value : null,
        })
      })
    return () => controller.abort()
  }, [authState, refresh])

  const updateStatus = useCallback((next: string) => {
    setPage(1)
    setStatus(next)
  }, [])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setSearch(draftSearch.trim())
  }

  if (authState !== 'signed-in') {
    return (
      <main className="purkins-entry">
        <div className="purkins-entry-mark" aria-hidden="true">P</div>
        <p className="purkins-eyebrow">PURKINS · PRIVATE WORKSPACE</p>
        <h1>{authState === 'checking' ? 'Opening your stockroom…' : 'Your stockroom is private.'}</h1>
        <p>{authState === 'error' ? error : 'Sign in through the admin system to view and manage Purkins inventory.'}</p>
        {authState !== 'checking' && <Link className="purkins-primary" href="/admin/login">Sign in to Purkins <span aria-hidden="true">↗</span></Link>}
      </main>
    )
  }

  const isOwner = user?.role === 'owner'
  return (
    <div className="purkins-app">
      <aside className="purkins-sidebar">
        <Link className="purkins-brand" href="/workspace" aria-label="Purkins workspace home">
          <span className="purkins-brand-mark">P</span>
          <span><strong>purkins<span className="purkins-brand-dot">.</span></strong><small>Baby & Mum Essentials</small></span>
        </Link>
        <div className="purkins-sidebar-caption">WORKSPACE</div>
        <nav aria-label="Primary navigation" className="purkins-nav">
          <Link className="purkins-nav-item active" href="/workspace"><span aria-hidden="true">◫</span> Overview</Link>
          <Link className="purkins-nav-item" href="/admin/collections/products"><span aria-hidden="true">▦</span> Full inventory</Link>
          <Link className="purkins-nav-item" href="/admin/collections/media"><span aria-hidden="true">▧</span> Product photos</Link>
          {isOwner && <Link className="purkins-nav-item" href="/admin/collections/users"><span aria-hidden="true">♧</span> Team access</Link>}
        </nav>
        <div className="purkins-sidebar-bottom">
          <div className="purkins-team-badge"><span className="purkins-avatar">{user.email[0]?.toUpperCase() ?? 'P'}</span><span><strong>{user.email}</strong><small>{isOwner ? 'Store owner' : 'Pricing partner'}</small></span></div>
          <p>Little Essentials, Big Love.</p>
        </div>
      </aside>

      <main className="purkins-content">
        <header className="purkins-topbar">
          <span><span className="purkins-topbar-dot" /> PRIVATE STOCKROOM <span className="purkins-topbar-slash">/</span> OVERVIEW</span>
          <div>
            <button className="purkins-text-button" type="button" onClick={() => setRefresh((value) => value + 1)}>↻ Refresh</button>
            <Link className="purkins-topbar-admin" href="/admin">CMS settings ↗</Link>
          </div>
        </header>

        <div className="purkins-main-inner">
          <section className="purkins-hero">
            <div>
              <div className="purkins-eyebrow">YOUR STOCKROOM AT A GLANCE</div>
              <h1>Good to see you <span className="purkins-wave" aria-hidden="true">✳</span></h1>
              <p>Photograph, organise and price every little essential—without losing track of a single piece.</p>
              <div className="purkins-hero-actions">
                {isOwner && <Link className="purkins-primary" href="/admin/collections/products/create">+ Add an item</Link>}
                <Link className="purkins-secondary" href="/admin/collections/media">Manage photos ↗</Link>
              </div>
            </div>
            <div className="purkins-hero-deco" aria-hidden="true">
              <div className="purkins-deco-circle"><span>P</span></div>
              <span className="purkins-deco-sparkle">✳</span>
            </div>
          </section>

          <section className="purkins-metrics" aria-label="Inventory metrics">
            <Metric label="IN THIS VIEW" value={totalDocs} caption="matching inventory items" />
            <Metric label="NEEDS PRICING" value={counters.pricing} caption="waiting for a suggested price" tone="highlight" />
            <Metric label="READY TO LIST" value={counters.ready} caption="prepared for Facebook" />
            <Metric label="ON FACEBOOK" value={counters.listed} caption="marked as listed" />
          </section>

          <section className="purkins-products-section" aria-labelledby="purkins-inventory-title">
            <div className="purkins-section-heading">
              <div><div className="purkins-eyebrow">CATALOGUE</div><h2 id="purkins-inventory-title">Your inventory <span>{loading ? '…' : totalDocs}</span></h2></div>
              {isOwner && <Link className="purkins-outline-link" href="/admin/collections/products/create">Add inventory +</Link>}
            </div>

            <div className="purkins-toolbar">
              <form className="purkins-search" onSubmit={submitSearch} role="search">
                <span aria-hidden="true">⌕</span>
                <input aria-label="Find stock by name or SKU" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search products or SKU…" />
                <button type="submit">Search</button>
              </form>
              <label className="purkins-filter">Filter <select aria-label="Filter inventory by status" value={status} onChange={(event) => updateStatus(event.target.value)}>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>

            {error && <div role="alert" className="purkins-error">Could not load inventory: {error} <button type="button" onClick={() => setRefresh((v) => v + 1)}>Try again</button></div>}

            {loading ? (
              <div className="purkins-loading" role="status">Loading your inventory…</div>
            ) : products.length === 0 ? (
              <div className="purkins-empty">
                <div className="purkins-empty-mark" aria-hidden="true">✳</div>
                <h3>{search || status !== 'all' ? 'Nothing matches yet.' : 'A fresh start for your stockroom.'}</h3>
                <p>{search || status !== 'all' ? 'Try a different search or inventory status.' : 'Start by adding a baby outfit, a feeding essential, or anything ready to be catalogued.'}</p>
                {search || status !== 'all'
                  ? <button type="button" onClick={() => {setSearch('');setDraftSearch('');updateStatus('all')}}>Clear filters</button>
                  : isOwner ? <Link className="purkins-primary" href="/admin/collections/products/create">Add the first product ↗</Link> : <p>Your owner will add stock here.</p>}
              </div>
            ) : (
              <>
                <div className="purkins-product-grid">
                  {products.map((product) => {
                    const src = photoUrl(product)
                    const displayPrice = product.sellingPriceZMW ?? product.suggestedPriceZMW
                    return (
                      <Link key={product.id} href={'/admin/collections/products/' + product.id} className="purkins-product">
                        <div className="purkins-product-image">
                          {src ? (
                            // Only owner-uploaded Payload media URLs are rendered here.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={product.title} src={src} loading="lazy" />
                          ) : <div className="purkins-photo-fallback"><span aria-hidden="true">▧</span><small>No photo yet</small></div>}
                          <span className={'purkins-status status-' + product.status}>{STATUS_LABEL[product.status] ?? product.status}</span>
                        </div>
                        <div className="purkins-product-details">
                          <div className="purkins-product-sku">{product.sku}</div>
                          <h3>{product.title}</h3>
                          <div className="purkins-product-subtitle">{[product.size, product.ageRange, product.colour].filter(Boolean).join(' · ') || product.category?.replaceAll('-', ' ') || 'Baby & Mum Essentials'}</div>
                          <div className="purkins-product-footer">
                            <span className="purkins-product-price">{price(displayPrice)}</span>
                            <span className="purkins-product-count">{product.quantity ?? 0} in stock</span>
                          </div>
                          <p className="purkins-product-location">{product.stockLocation || 'Storage location not set'}</p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
                <div className="purkins-pager">
                  <span>Page {page} of {totalPages} · {totalDocs} matching items</span>
                  <div><button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>← Previous</button><button type="button" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next →</button></div>
                </div>
              </>
            )}
          </section>
          <footer className="purkins-footnote">PURKINS · Little Essentials, Big Love. · Internal workspace</footer>
        </div>
      </main>
    </div>
  )
}
