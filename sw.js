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
