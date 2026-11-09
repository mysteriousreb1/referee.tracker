/* Referee Tracker — service worker : notifications push (PWA iPhone / Android / desktop)
   + b66 : cache de l'application (ouverture instantanée, lecture hors-ligne de la coquille).
   Les données (matchs, paiements) restent gérées par le site (localStorage) : rien d'autre n'est intercepté. */
const VERSION = "2026-11-09-b82";                  // même valeur que <meta name="rt-version"> (rt-deploy.sh la remplace)
const CACHE = "rt-" + VERSION;
const COQUILLE = ["./", "./index.html", "./app.js?v=" + VERSION, "./rt-auth.js?v=" + VERSION, "./rt-stats.js?v=" + VERSION,
  "./style.css?v=" + VERSION, "./manifest.json?v=" + VERSION, "./favicon-32.png?v=" + VERSION, "./apple-touch-icon.png?v=" + VERSION,
  "./img/logo-icon.png?v=" + VERSION, "./img/icon-192.png", "./img/icon-512.png",
  // b70 — polices et bibliothèques auto-hébergées (plus aucune requête tierce)
  "./fonts/fonts.css?v=2026-11-09-b82", "./fonts/montserrat-latin-500-normal.woff2", "./fonts/montserrat-latin-600-normal.woff2", "./fonts/montserrat-latin-700-normal.woff2", "./fonts/montserrat-latin-800-normal.woff2",
  "./fonts/jetbrains-mono-latin-500-normal.woff2", "./fonts/jetbrains-mono-latin-700-normal.woff2", "./vendor/leaflet.css", "./vendor/leaflet.js", "./vendor/chart.umd.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(COQUILLE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("rt-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const memeOrigine = url.origin === self.location.origin;
  const police = memeOrigine && /^\/(fonts|vendor)\//.test(url.pathname);   // b70 : auto-hébergées
  if (!memeOrigine) return;                       // Supabase, Apps Script, API : jamais interceptés
  if (memeOrigine && url.searchParams.has("verif")) return;  // contrôle de version de l'app : toujours réseau
  // 1) Fichiers versionnés (?v=) et polices : cache d'abord (contenu immuable pour une version donnée).
  if (req.mode !== "navigate" && ((memeOrigine && url.searchParams.has("v")) || police)) {
    e.respondWith(caches.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(r => {
      if (r && (r.ok || r.type === "opaque")) caches.open(CACHE).then(c => c.put(req, r.clone()));
      return r;
    })));
    return;
  }
  // 2) Pages et autres fichiers du site : réseau d'abord, cache en secours (hors-ligne).
  e.respondWith(fetch(req).then(r => {
    if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))));
});
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  const titre = d.title || "Referee Tracker";
  e.waitUntil(self.registration.showNotification(titre, {
    body: d.body || "",
    icon: "./apple-touch-icon.png",
    badge: "./favicon-32.png",
    tag: d.tag || "rt",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(liste => {
    for (const c of liste) { if ("focus" in c) { c.navigate && c.navigate(cible); return c.focus(); } }
    return self.clients.openWindow(cible);
  }));
});
/* b48 — l'OS a renouvelé l'abonnement : on en reprend un avec la même clé et on prévient
   la page (qui l'enregistre côté Supabase avec sa session). */
self.addEventListener("pushsubscriptionchange", e => {
  const ancien = e.oldSubscription;
  const cle = (ancien && ancien.options && ancien.options.applicationServerKey) || null;
  e.waitUntil((cle ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle }) : Promise.resolve(null))
    .catch(() => null)
    .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
    .then(liste => { liste.forEach(c => c.postMessage({ type: "rt-push-changed" })); }));
});
