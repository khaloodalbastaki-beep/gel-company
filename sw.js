// gel-company app-shell service worker — lets the PWA open with ZERO network.
//
// Strategy is hash-agnostic (no asset manifest, so it survives every rebuild):
//   - install: cache the app shell (index.html at the registration scope).
//   - navigations: network-first, fall back to the cached shell when offline.
//   - same-origin static assets: stale-while-revalidate (cache as fetched).
// Cross-origin requests (the GitHub queue API, raw bundle fetches) are left
// entirely to the app — the SW never touches them.

const CACHE = "gel-shell-BIbIIL15"

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE)
        // scope === the app's base URL (e.g. /gel-company/) === index.html
        await cache.add(new Request(self.registration.scope, { cache: "reload" }))
      } catch {
        // first install offline — nothing to precache yet; runtime caching fills in
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // queue API / raw bundles: hands off

  // App-shell navigations: network-first, fall back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          // `no-store` bypasses the HTTP cache so a fresh deploy is ALWAYS
          // picked up (otherwise the browser can hand the SW a stale index.html
          // and users stay on the old build).
          const res = await fetch(req, { cache: "no-store" })
          // Only cache a genuine, successful shell — never a transient 404/5xx
          // (which would otherwise poison the offline shell).
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone())
          return res
        } catch {
          return (
            (await cache.match(req)) ||
            (await cache.match(self.registration.scope)) ||
            Response.error()
          )
        }
      })(),
    )
    return
  }

  // Static assets (hashed JS/CSS/fonts/images): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone())
          return res
        })
        .catch(() => null)
      return cached || (await network) || Response.error()
    })(),
  )
})
