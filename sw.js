const CACHE_NAME = 'cantiere-v4-shell';
const IMG_CACHE = 'cantiere-v4-images';
const KNOWN_CACHES = [CACHE_NAME, IMG_CACHE, CACHE_NAME + '-data'];

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

    // Bypass totale per localhost (evita bug con Vite server locale) e websocket
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'ws:' || url.protocol === 'wss:') {
        return;
    }

    // Cache-First per assets generati e icone
    const isAsset = url.pathname.includes('/assets/') || url.pathname.match(/\.(png|ico|json|woff2?|css|js)$/);
    if (isAsset && url.origin === self.location.origin) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request).then(res => {
                if (res && res.ok && res.status === 200) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return res;
            }))
        );
        return;
    }

    // Cache-First per immagini prodotto da host esterni (Supabase Storage, CDN, imgur, ecc.)
    // Le immagini vengono scaricate subito e servite dalla cache quando offline
    const isProductImage = url.pathname.match(/\.(jpe?g|webp|png|gif|avif|svg)(\?.*)?$/i);
    if (isProductImage && url.origin !== self.location.origin) {
        event.respondWith(
            caches.open(IMG_CACHE).then(cache => cache.match(event.request)).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(res => {
                    if (res && res.ok) {
                        const clone = res.clone();
                        caches.open(IMG_CACHE).then(c => c.put(event.request, clone));
                    }
                    return res;
                }).catch(() => {
                    // Offline e non in cache: risposta vuota trasparente
                    return new Response('', { status: 503 });
                });
            })
        );
        return;
    }

    // Network-First con fallback cache per le chiamate REST di Supabase (lettura dati magazzino)
    const isSupabaseRest = url.hostname.includes('supabase.co') && url.pathname.includes('/rest/');
    if (isSupabaseRest) {
        event.respondWith(
            fetch(event.request.clone()).then(res => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME + '-data').then(cache => cache.put(event.request, clone));
                }
                return res;
            }).catch(() => {
                // Offline: serve dalla cache dati se disponibile
                return caches.open(CACHE_NAME + '-data').then(cache => cache.match(event.request))
                    .then(cached => cached || new Response(JSON.stringify([]), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }));
            })
        );
        return;
    }

    // Network-First per HTML e fallback cache offline
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
