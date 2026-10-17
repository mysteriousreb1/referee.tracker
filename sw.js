/* Referee Tracker — service worker : notifications push (PWA iPhone / Android / desktop).
   Pas de cache réseau ici (le site gère son propre cache) : ce fichier ne sert
   qu'à afficher les notifications et à ouvrir l'app au tap. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
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
