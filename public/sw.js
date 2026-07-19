const CACHE = 'haven-shell-v3'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const isPrivateRequest = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || event.request.headers.has('Authorization')
  if (isPrivateRequest) return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'Haven care alert'
  const options = {
    body: data.body || 'Open Haven to review this care alert securely.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.receipt ? `haven-${data.receipt}` : 'haven-care-alert',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || '/?alerts=open', receipt: data.receipt },
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options)
    if (data.receipt) {
      await fetch('/api/v1/delivery-receipts/web-push/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt: data.receipt, status: 'delivered' }),
      }).catch(() => undefined)
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/?alerts=open', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      existing.navigate(target)
      return
    }
    await self.clients.openWindow(target)
  })())
})
