const CACHE_NAME = 'cantiere-v5-shell';
const IMG_CACHE = 'cantiere-v5-images';
const CDN_CACHE = 'cantiere-v5-cdn';
const KNOWN_CACHES = [CACHE_NAME, IMG_CACHE, CDN_CACHE, CACHE_NAME + '-data'];

self.addEventListener('install', (event) => {
    // skipWaiting rimosso per evitare crash asincroni
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => Promise.all(
            cacheNames.map(name => !KNOWN_CACHES.includes(name) ? caches.delete(name) : null)
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Bypass per localhost e websocket
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'ws:' || url.protocol === 'wss:') {
        return;
    }

    // ─── 1. Assets locali (JS/CSS/font dell'app stessa) — Cache-First ─────────
    const isLocalAsset = url.pathname.includes('/assets/') || url.pathname.match(/\.(png|ico|json|woff2?|css|js)$/);
    if (isLocalAsset && url.origin === self.location.origin) {
        event.respondWith(cacheFirst(CACHE_NAME, event.request));
        return;
    }

    // ─── 2. CDN Statici (Bootstrap Icons, Iconify, Google Fonts) — Cache-First ─
    // Questi non cambiano mai: un font/icona su jsdelivr è immutabile per versione
    const isStaticCDN = (
        url.hostname === 'cdn.jsdelivr.net' ||          // Bootstrap Icons CSS + woff2
        url.hostname === 'api.iconify.design' ||         // Iconify SVG (mdi, bi, fa6, ecc.)
        url.hostname === 'fonts.googleapis.com' ||       // Google Fonts CSS
        url.hostname === 'fonts.gstatic.com'             // Google Fonts file
    );
    if (isStaticCDN) {
        event.respondWith(cacheFirst(CDN_CACHE, event.request));
        return;
    }

    // ─── 3. Immagini prodotto da host esterni — Cache-First ───────────────────
    const isExternalImage = url.pathname.match(/\.(jpe?g|webp|png|gif|avif)((\?|#).*)?$/i);
    if (isExternalImage && url.origin !== self.location.origin) {
        event.respondWith(cacheFirst(IMG_CACHE, event.request));
        return;
    }

    // ─── 4. Supabase Storage (url_immagine su storage.supabase.co) ────────────
    const isSupabaseStorage = url.hostname.includes('supabase.co') && url.pathname.includes('/storage/');
    if (isSupabaseStorage) {
        event.respondWith(cacheFirst(IMG_CACHE, event.request));
        return;
    }

    // ─── 5. Supabase REST API (dati magazzino) — Network-First con fallback ──
    const isSupabaseRest = url.hostname.includes('supabase.co') && url.pathname.includes('/rest/');
    if (isSupabaseRest) {
        event.respondWith(
            fetch(event.request.clone()).then(res => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME + '-data').then(cache => cache.put(event.request, clone));
                }
                return res;
            }).catch(() =>
                caches.open(CACHE_NAME + '-data').then(cache => cache.match(event.request))
                    .then(cached => cached || new Response(JSON.stringify([]), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }))
            )
        );
        return;
    }

    // ─── 6. HTML dell'app — Network-First con fallback offline ────────────────
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(event.request).then(res => {
                if (res && res.ok && res.status === 200) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return res;
            }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
        );
    }
});

// Helper: Cache-First con fetch fallback e salvataggio automatico
function cacheFirst(cacheName, request) {
    return caches.open(cacheName).then(cache => cache.match(request)).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
            if (res && res.ok) {
                const clone = res.clone();
                caches.open(cacheName).then(c => c.put(request, clone));
            }
            return res;
        }).catch(() => new Response('', { status: 503 }));
    });
}


// GESTIONE PUSH NOTIFICATIONS
self.addEventListener('push', (event) => {
    let data = { title: 'Cantiere', body: 'Nuova notifica', url: '/dashboard' };

    if (event.data) {
        try {
            const json = event.data.json();
            data.title = json.title || data.title;
            data.body = json.body || data.body;
            data.url = json.url || data.url;
        } catch (e) {
            data.body = event.data.text();
        }
    }

    // Configurazione Base (Sincronizzata con vite.config.js / BASE_URL)
    const BASE_PATH = '/CantiereGestionale';
    const fullUrl = data.url.startsWith('http') ? data.url : (BASE_PATH + data.url).replace(/\/+/g, '/');

    const options = {
        body: data.body,
        icon: '/CantiereGestionale/logo.png',
        badge: '/CantiereGestionale/favicon.ico',
        vibrate: [100, 50, 100],
        lang: 'it', // Suggerisce al browser di usare l'italiano per le etichette di sistema
        data: {
            url: fullUrl
        }
    };

    // LOGICA: Mostra la notifica SOLO se l'utente non è già attivo sull'app
    const promise = clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        const isAppFocused = windowClients.some(client => client.focused);

        if (isAppFocused) {
            console.log("[SW] App già focalizzata, salto la notifica push.");
            return;
        }

        return self.registration.showNotification(data.title, options);
    });

    event.waitUntil(promise);
});

// FOCUS PWA ON CLICK
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Se la PWA è già aperta, focalizzala o naviga
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            // Altrimenti aprine una nuova
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
