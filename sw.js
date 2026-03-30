const CACHE_NAME = 'cantiere-v4-shell';

self.addEventListener('install', (event) => {
    // skipWaiting rimosso per evitare crash asincroni
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => Promise.all(
            cacheNames.map(name => name !== CACHE_NAME ? caches.delete(name) : null)
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Bypass totale per localhost (evita bug con Vite server locale), database e websocket
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.origin !== self.location.origin || url.origin.includes('supabase') || url.protocol === 'ws:' || url.protocol === 'wss:') {
        return; // Passa diretto alla rete senza toccare la cache
    }

    // Cache-First per assets generati e icone
    const isAsset = url.pathname.includes('/assets/') || url.pathname.match(/\.(png|ico|json|woff2?|css|js)$/);
    if (isAsset) {
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

    // Network-First per HTML e fallback cache offline
    event.respondWith(
        fetch(event.request).then(res => {
            if (res && res.ok && res.status === 200) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return res;
        }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
    );
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
