const CACHE_NAME = 'cantiere-v1';

// Service Worker minimale necessario per l'installabilità (PWA)
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Il fetch handler è OBBLIGATORIO per far apparire il tasto "Installa"
self.addEventListener('fetch', (event) => {
    // Risposta semplice: passa la richiesta alla rete
    event.respondWith(fetch(event.request));
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
