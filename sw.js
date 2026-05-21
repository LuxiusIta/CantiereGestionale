const CACHE_NAME = 'cantiere-v6-shell';
const IMG_CACHE = 'cantiere-v6-images';
const CDN_CACHE = 'cantiere-v6-cdn';
const DATA_CACHE = 'cantiere-v6-data';
const KNOWN_CACHES = [CACHE_NAME, IMG_CACHE, CDN_CACHE, DATA_CACHE];

// Timeout (ms) per le richieste di rete prima di usare la cache
const NETWORK_TIMEOUT_MS = 4000;

// ─── INSTALL ─────────────────────────────────────────────────────────────────
// Pre-cache immediata delle risorse critiche dell'app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Mette in cache le risorse fondamentali al momento dell'installazione
            // così sono disponibili PRIMA della prima visita completa
            return cache.addAll([
                './',
                './index.html',
                './logo.png',
                './favicon.ico',
                './manifest.webmanifest',
            ]).catch(() => {
                // Ignora errori su singoli file (es. manifest mancante in dev)
            });
        }).then(() => self.skipWaiting()) // Attiva subito il nuovo SW
    );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames.map(name => !KNOWN_CACHES.includes(name) ? caches.delete(name) : null)
            ))
            .then(() => self.clients.claim()) // Prende controllo immediato di tutte le tab
    );
});

// ─── MESSAGE ─────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Bypass: HMR websocket e vite dev server
    if (
        url.protocol === 'ws:' ||
        url.protocol === 'wss:' ||
        url.pathname.includes('/@vite/') ||
        url.pathname.includes('/@react-refresh') ||
        url.pathname.includes('/__vite')
    ) return;

    // ─── 1. Assets locali (JS/CSS/immagini/font dell'app) ─────────────────────
    //    Strategia: CACHE-FIRST + aggiornamento silenzioso in background
    //    → L'app si apre IMMEDIATAMENTE anche con rete lenta o assente
    const isLocalAsset =
        url.origin === self.location.origin && (
            url.pathname.includes('/assets/') ||
            url.pathname.match(/\.(js|css|woff2?|png|ico|svg|webp|jpg|jpeg|avif|json)(\?.*)?$/)
        );
    if (isLocalAsset) {
        event.respondWith(staleWhileRevalidate(CACHE_NAME, event.request));
        return;
    }

    // ─── 2. CDN Statici (Bootstrap Icons, Iconify, Google Fonts) ─────────────
    //    Cache-First: sono immutabili per versione, non cambiano mai
    const isStaticCDN = (
        url.hostname === 'cdn.jsdelivr.net' ||
        url.hostname === 'api.iconify.design' ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com'
    );
    if (isStaticCDN) {
        event.respondWith(cacheFirst(CDN_CACHE, event.request));
        return;
    }

    // ─── 3. Immagini prodotto da host esterni + Supabase Storage ──────────────
    const isExternalImage = url.pathname.match(/\.(jpe?g|webp|png|gif|avif)((\?|#).*)?$/i);
    const isSupabaseStorage = url.hostname.includes('supabase.co') && url.pathname.includes('/storage/');
    if ((isExternalImage && url.origin !== self.location.origin) || isSupabaseStorage) {
        event.respondWith(cacheFirst(IMG_CACHE, event.request));
        return;
    }

    // ─── 4. Supabase REST API (dati magazzino) ────────────────────────────────
    //    Strategia: Network-First con TIMEOUT → se la rete è lenta, usa la cache
    //    senza bloccare l'utente
    const isSupabaseRest = url.hostname.includes('supabase.co') && url.pathname.includes('/rest/');
    if (isSupabaseRest) {
        event.respondWith(networkFirstWithTimeout(DATA_CACHE, event.request, NETWORK_TIMEOUT_MS));
        return;
    }

    // ─── 5. Supabase Auth ─────────────────────────────────────────────────────
    //    Non intercettare le chiamate di autenticazione (non ha senso fare fallback)
    const isSupabaseAuth = url.hostname.includes('supabase.co') && url.pathname.includes('/auth/');
    if (isSupabaseAuth) return;

    // ─── 6. HTML dell'app (navigazione SPA) ──────────────────────────────────
    //    Strategia: STALE-WHILE-REVALIDATE
    //    → Serve subito la shell dall'HTML in cache, poi aggiorna in background
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(CACHE_NAME, event.request));
    }
});

// ─── STRATEGIE ───────────────────────────────────────────────────────────────

/**
 * CACHE-FIRST: Serve dalla cache. Se non c'è, prova la rete e salva.
 * Ideale per risorse immutabili (CDN con versione, immagini).
 */
function cacheFirst(cacheName, request) {
    return caches.open(cacheName).then(cache =>
        cache.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(res => {
                if (res && res.ok) cache.put(request, res.clone());
                return res;
            }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
    );
}

/**
 * STALE-WHILE-REVALIDATE: Serve subito dalla cache (anche se "vecchia"),
 * poi aggiorna la cache in background con la risposta fresca dalla rete.
 * Ideale per: HTML dell'app, assets JS/CSS.
 * → L'app si APRE SEMPRE SUBITO, anche con rete lenta o assente.
 */
function staleWhileRevalidate(cacheName, request) {
    return caches.open(cacheName).then(cache =>
        cache.match(request).then(cached => {
            // Aggiornamento background (non aspettiamo il risultato)
            const fetchPromise = fetch(request).then(res => {
                if (res && res.ok) cache.put(request, res.clone());
                return res;
            }).catch(() => null);

            // Se abbiamo qualcosa in cache, serviamo subito
            if (cached) return cached;

            // Altrimenti aspettiamo la rete (prima visita)
            return fetchPromise.then(res =>
                res || new Response('', { status: 503, statusText: 'Offline' })
            );
        })
    );
}

/**
 * NETWORK-FIRST CON TIMEOUT: Prova la rete, ma se non risponde entro
 * `timeoutMs` millisecondi, serve dalla cache senza aspettare.
 * Ideale per: API Supabase — dati aggiornati quando possibile, cache come fallback.
 */
function networkFirstWithTimeout(cacheName, request, timeoutMs) {
    return caches.open(cacheName).then(cache => {
        // Race: rete vs timeout
        const networkPromise = fetch(request.clone()).then(res => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
        });

        const timeoutPromise = new Promise(resolve =>
            setTimeout(() => resolve(null), timeoutMs)
        );

        return Promise.race([networkPromise, timeoutPromise]).then(res => {
            if (res) return res; // La rete ha risposto in tempo

            // Timeout scaduto: servi dalla cache
            return cache.match(request).then(cached =>
                cached || new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        }).catch(() =>
            // Errore di rete: servi dalla cache
            cache.match(request).then(cached =>
                cached || new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
    });
}


// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
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

    const BASE_PATH = '/CantiereGestionale';
    const fullUrl = data.url.startsWith('http') ? data.url : (BASE_PATH + data.url).replace(/\/+/g, '/');

    const options = {
        body: data.body,
        icon: '/CantiereGestionale/logo.png',
        badge: '/CantiereGestionale/favicon.ico',
        vibrate: [100, 50, 100],
        lang: 'it',
        data: { url: fullUrl }
    };

    const promise = clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        const isAppFocused = windowClients.some(client => client.focused);
        if (isAppFocused) return;
        return self.registration.showNotification(data.title, options);
    });

    event.waitUntil(promise);
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
