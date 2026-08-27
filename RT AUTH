/* =====================================================
   REFEREE TRACKER — AUTHENTIFICATION + COUCHE API
   À charger AVANT app.js dans index.html.

   Remplace l'ancienne couche API à clé partagée. Le dépôt étant public,
   aucun secret ne vit ici : ce fichier ne contient que l'URL du
   déploiement (publique par nature) et la logique de session.

   Le jeton est conservé en localStorage : il survit à la fermeture de
   l'onglet, au redémarrage du navigateur et se prolonge tout seul.
   En usage normal, le mot de passe n'est ressaisi qu'après 30 jours
   sans ouvrir l'application.
   ===================================================== */

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxETHFQ5vTXTo7ismnGBWscXbKPDiQLw9X6Wgn7U6WEd7FINf8wDSVmBjI9bF_phWmL/exec";
const API_TIMEOUT_MS = 25000;
const TOKEN_KEY = "rt_session_token";
const EMAIL_KEY = "rt_session_email";

/* HOME est renseigné par le serveur après authentification :
   l'adresse ne figure plus dans le dépôt public. */
var HOME = { label: "", lat: 48.8241, lon: 7.8069 };   // `var` : global explicite, lu par app.js

/* ---------------- Stockage du jeton ---------------- */

const Session = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return window.__rtToken || ""; }
  },
  get email() {
    try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return window.__rtEmail || ""; }
  },
  save(token, email) {
    window.__rtToken = token; window.__rtEmail = email;
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EMAIL_KEY, email || "");
    } catch (e) { /* navigation privée : la session ne durera que l'onglet */ }
  },
  clear() {
    window.__rtToken = ""; window.__rtEmail = "";
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EMAIL_KEY); } catch (e) {}
  }
};

/* ---------------- Erreurs ---------------- */

function apiError(message, hint) {
  const err = new Error(message);
  if (hint) err.hint = hint;
  return err;
}

const DEPLOY_HINT =
  "Dans l'éditeur Apps Script : Déployer → Gérer les déploiements → ✏️ → " +
  "Type « Application Web », Exécuter en tant que « Moi », " +
  "Qui a accès « Tout le monde » → Déployer, puis recopier l'URL /exec " +
  "dans rt-auth.js (ligne 16).";

/* Conservé : app.js s'en sert dans son écran d'erreur. */
function buildApiUrl(action, extra = {}) {
  const params = new URLSearchParams({ action, ...extra });
  return `${APP_SCRIPT_URL}?${params.toString()}`;
}

/* ---------------- Appel serveur ----------------
   POST en text/plain : requête « simple » au sens CORS, donc pas de
   preflight OPTIONS (qu'Apps Script ne sait pas traiter). Le jeton
   voyage dans le corps, jamais dans l'URL. */

function apiCall(action, extra = {}, withToken = true) {
  const body = { action, ...extra };
  if (withToken) body.token = Session.token;

  const hasAbort = typeof AbortController === "function";
  const controller = hasAbort ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, API_TIMEOUT_MS);

  const options = {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    redirect: "follow",
    credentials: "omit",
    cache: "no-store"
  };
  if (controller) options.signal = controller.signal;

  return fetch(APP_SCRIPT_URL, options)
    .then(res => {
      if (!res.ok) {
        const err = apiError("HTTP " + res.status, DEPLOY_HINT);
        err.httpStatus = res.status;
        throw err;
      }
      return res.text();
    })
    .then(text => {
      const raw = String(text || "").trim();
      if (!raw) throw apiError("Réponse vide du serveur", DEPLOY_HINT);
      if (raw.charAt(0) === "<") {
        throw apiError("Google a renvoyé une page HTML au lieu des données", DEPLOY_HINT);
      }
      try { return JSON.parse(raw); }
      catch (e) { throw apiError("Réponse illisible du serveur", DEPLOY_HINT); }
    })
    .finally(() => clearTimeout(timer));
}

/* Point d'entrée unique de l'application.
   Le nom `jsonp` est conservé pour ne rien casser dans app.js —
   le transport n'est plus du JSONP, qui exposait le jeton à n'importe
   quel script tiers. */
function jsonp(action, extra = {}) {
  return apiCall(action, extra).then(res => {
    if (res && res.success === false && res.error === "AUTH_REQUIRED") {
      Session.clear();
      showLogin("Session expirée, reconnecte-toi.");
      throw apiError("Session expirée", "");
    }
    return res;
  }).catch(err => {
    if (err && err.name === "AbortError") {
      throw apiError("Délai dépassé (25 s) sans réponse de l'API",
        "Relance, puis vérifie Apps Script → Exécutions.");
    }
    const status = err && err.httpStatus;
    if (status === 404) throw apiError("Déploiement introuvable (HTTP 404)", DEPLOY_HINT);
    if (status === 401 || status === 403) throw apiError("Accès refusé (HTTP " + status + ")", DEPLOY_HINT);
    if (status >= 500) {
      throw apiError("Erreur côté Apps Script (HTTP " + status + ")",
        "Ouvre Apps Script → Exécutions pour lire l'erreur exacte.");
    }
    throw err;
  });
}

/* ---------------- Écran de connexion ---------------- */

function buildLoginOverlay() {
  if (document.getElementById("rtLogin")) return;

  const el = document.createElement("div");
  el.id = "rtLogin";
  el.className = "rt-login";
  el.innerHTML = `
    <form class="rt-login-card" id="rtLoginForm" autocomplete="on">
      <h1>Referee Tracker</h1>
      <p class="rt-login-sub">Connexion requise</p>
      <label for="rtEmail">Email</label>
      <input id="rtEmail" name="email" type="email" autocomplete="username" required>
      <label for="rtPwd">Mot de passe</label>
      <input id="rtPwd" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" id="rtLoginBtn">Se connecter</button>
      <div class="rt-login-msg" id="rtLoginMsg" role="status"></div>
      <p class="rt-login-note">Tu resteras connecté 30 jours sur cet appareil.</p>
    </form>`;
  document.body.appendChild(el);

  document.getElementById("rtLoginForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const btn = document.getElementById("rtLoginBtn");
    const msg = document.getElementById("rtLoginMsg");
    const email = document.getElementById("rtEmail").value.trim();
    const pwd = document.getElementById("rtPwd").value;

    btn.disabled = true;
    msg.textContent = "Vérification…";
    msg.className = "rt-login-msg";

    apiCall("login", { email, password: pwd }, false)
      .then(res => {
        if (!res || !res.success) throw new Error((res && res.error) || "Connexion refusée");
        Session.save(res.token, res.email);
        document.getElementById("rtPwd").value = "";
        hideLogin();
        startApp();
      })
      .catch(err => {
        msg.textContent = err.message || "Connexion impossible";
        msg.className = "rt-login-msg is-error";
      })
      .finally(() => { btn.disabled = false; });
  });
}

function showLogin(message) {
  buildLoginOverlay();
  const el = document.getElementById("rtLogin");
  el.classList.add("is-visible");
  if (message) {
    const msg = document.getElementById("rtLoginMsg");
    msg.textContent = message;
    msg.className = "rt-login-msg is-error";
  }
  const email = document.getElementById("rtEmail");
  if (Session.email) email.value = Session.email;
  (Session.email ? document.getElementById("rtPwd") : email).focus();
}

function hideLogin() {
  const el = document.getElementById("rtLogin");
  if (el) el.classList.remove("is-visible");
}

function logout() {
  const token = Session.token;
  Session.clear();
  apiCall("logout", { token }, false).catch(() => { /* déconnexion locale de toute façon */ });
  location.reload();
}

/* ---------------- Démarrage ----------------
   app.js n'appelle plus loadData() au chargement : c'est ici qu'on décide,
   selon la présence d'une session valide, d'ouvrir l'application ou l'écran
   de connexion. */

function startApp() {
  jsonp("me")
    .then(res => {
      if (!res || !res.success) throw new Error((res && res.error) || "Session invalide");
      if (res.home && res.home.lat) HOME = res.home;
      const badge = document.getElementById("rtUser");
      if (badge) badge.textContent = res.email || "";
      if (typeof loadData === "function") loadData();
    })
    .catch(() => { /* jsonp a déjà réaffiché l'écran de connexion si besoin */ });
}

document.addEventListener("DOMContentLoaded", () => {
  buildLoginOverlay();
  if (Session.token) startApp();
  else showLogin("");

  const btn = document.getElementById("rtLogoutBtn");
  if (btn) btn.addEventListener("click", logout);
});
