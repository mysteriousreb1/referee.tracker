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
const API_TIMEOUT_MS = 60000;   // Apps Script peut mettre ~1 min au tout premier appel (démarrage à froid)
const TOKEN_KEY = "rt_session_token";
const EMAIL_KEY = "rt_session_email";
const SINCE_KEY = "rt_session_since";

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
  get since() {
    try { return Number(localStorage.getItem(SINCE_KEY)) || 0; } catch (e) { return window.__rtSince || 0; }
  },
  save(token, email) {
    const now = Date.now();
    window.__rtToken = token; window.__rtEmail = email; window.__rtSince = now;
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EMAIL_KEY, email || "");
      localStorage.setItem(SINCE_KEY, String(now));
    } catch (e) { /* navigation privée : la session ne durera que l'onglet */ }
  },
  clear() {
    window.__rtToken = ""; window.__rtEmail = "";
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(SINCE_KEY);
    } catch (e) {}
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
    .catch(err => {
      if (err && (err.name === "AbortError" || /aborted/i.test(err.message || ""))) {
        throw apiError(
          "Pas de réponse du serveur après 60 s.",
          "Ouvre les outils développeur (⌥⌘I) → onglet Réseau, retente, et regarde la ligne script.google.com : " +
          "statut « (pending) » = Apps Script ne répond pas ; « CORS error » = problème de déploiement ; " +
          "302 sans suite = redirection bloquée."
        );
      }
      throw err;
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
      <button type="button" class="rt-link" id="rtForgotBtn">Mot de passe oublié ?</button>
      <p class="rt-login-note">Tu resteras connecté 30 jours sur cet appareil.</p>
    </form>

    <form class="rt-login-card" id="rtResetForm" style="display:none" autocomplete="off">
      <h1>Mot de passe oublié</h1>
      <p class="rt-login-sub" id="rtResetSub">On t'envoie un code à 6 chiffres par email.</p>

      <div id="rtResetStep1">
        <label for="rtResetEmail">Email du compte</label>
        <input id="rtResetEmail" type="email" autocomplete="username">
        <button type="button" id="rtResetSend">Envoyer le code</button>
      </div>

      <div id="rtResetStep2" style="display:none">
        <label for="rtResetCode">Code reçu par email</label>
        <input id="rtResetCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456">
        <label for="rtResetPwd">Nouveau mot de passe</label>
        <input id="rtResetPwd" type="password" autocomplete="new-password" placeholder="12 caractères minimum">
        <button type="button" id="rtResetDo">Valider</button>
      </div>

      <div class="rt-login-msg" id="rtResetMsg" role="status"></div>
      <button type="button" class="rt-link" id="rtBackBtn">Retour à la connexion</button>
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
        if (err && err.hint) {
          var note = document.querySelector(".rt-login-note");
          if (note) note.textContent = err.hint;
        }
        console.error("[RefereeTracker] échec de connexion :", err);
      })
      .finally(() => { btn.disabled = false; });
  });

  const basculer = (versReset) => {
    document.getElementById("rtLoginForm").style.display = versReset ? "none" : "";
    document.getElementById("rtResetForm").style.display = versReset ? "" : "none";
    if (versReset) {
      document.getElementById("rtResetEmail").value =
        document.getElementById("rtEmail").value || Session.email || "";
    }
  };

  document.getElementById("rtForgotBtn").addEventListener("click", () => basculer(true));
  document.getElementById("rtBackBtn").addEventListener("click", () => {
    basculer(false);
    document.getElementById("rtResetMsg").textContent = "";
    document.getElementById("rtResetStep1").style.display = "";
    document.getElementById("rtResetStep2").style.display = "none";
  });

  const msgReset = (texte, erreur) => {
    const m = document.getElementById("rtResetMsg");
    m.textContent = texte;
    m.className = "rt-login-msg" + (erreur ? " is-error" : "");
  };

  document.getElementById("rtResetSend").addEventListener("click", () => {
    const b = document.getElementById("rtResetSend");
    b.disabled = true;
    msgReset("Envoi en cours…");
    apiCall("password.forgot", { email: document.getElementById("rtResetEmail").value.trim() }, false)
      .then(res => {
        msgReset((res && res.message) || "Code envoyé.");
        document.getElementById("rtResetStep1").style.display = "none";
        document.getElementById("rtResetStep2").style.display = "";
      })
      .catch(err => msgReset(err.message || "Envoi impossible", true))
      .finally(() => { b.disabled = false; });
  });

  document.getElementById("rtResetDo").addEventListener("click", () => {
    const b = document.getElementById("rtResetDo");
    b.disabled = true;
    msgReset("Vérification…");
    apiCall("password.reset", {
      email:   document.getElementById("rtResetEmail").value.trim(),
      code:    document.getElementById("rtResetCode").value.trim(),
      nouveau: document.getElementById("rtResetPwd").value
    }, false)
      .then(res => {
        if (!res || !res.success) throw new Error((res && res.error) || "Échec");
        msgReset(res.message || "Mot de passe réinitialisé.");
        setTimeout(() => {
          basculer(false);
          document.getElementById("rtPwd").value = "";
          document.getElementById("rtLoginMsg").textContent = "Mot de passe changé, connecte-toi.";
        }, 1500);
      })
      .catch(err => msgReset(err.message || "Échec", true))
      .finally(() => { b.disabled = false; });
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

/* ---------------- Fiche profil ----------------
   Remplace le badge email de l'en-tête. Tous les réglages sont modifiables
   ici : plus besoin de toucher au code pour changer d'adresse ou de voiture.

   Les véhicules forment un HISTORIQUE DATÉ. Ajouter une voiture n'efface
   pas l'ancienne : un match passé reste calculé avec le véhicule qui
   roulait à cette date. Aucune modification n'est rétroactive. */

var Profil = { email: "", config: null };

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildProfilePanel() {
  if (document.getElementById("rtProfile")) return;

  const el = document.createElement("div");
  el.id = "rtProfile";
  el.className = "rt-modal";
  el.innerHTML = `
    <div class="rt-modal-card rt-modal-lg" role="dialog" aria-modal="true" aria-labelledby="rtProfileTitle">
      <div class="rt-modal-head">
        <h2 id="rtProfileTitle">Mon profil</h2>
        <button type="button" class="rt-modal-close" id="rtProfileClose" aria-label="Fermer">&times;</button>
      </div>
      <div id="rtProfileBody" class="rt-profile-body"></div>
      <div class="rt-toast" id="rtToast" role="status"></div>
    </div>`;
  document.body.appendChild(el);

  document.getElementById("rtProfileClose").addEventListener("click", hideProfile);
  el.addEventListener("click", ev => { if (ev.target === el) hideProfile(); });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && el.classList.contains("is-visible")) hideProfile();
  });
}

function toast(message, erreur) {
  const t = document.getElementById("rtToast");
  if (!t) return;
  t.textContent = message;
  t.className = "rt-toast is-visible" + (erreur ? " is-error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = "rt-toast"; }, 4000);
}

function renderProfile() {
  const body = document.getElementById("rtProfileBody");
  if (!body) return;

  const c = Profil.config;
  if (!c) { body.innerHTML = '<p class="rt-loading">Chargement…</p>'; return; }

  const p = c.profil || {}, t = c.tarifs || {}, vs = c.vehicules || [];
  const actuel = vs.length ? vs[vs.length - 1] : null;

  body.innerHTML = `
    <section class="rt-sect">
      <h3>Identité</h3>
      <div class="rt-field"><label for="pfEmailC">Email de connexion</label>
        <input id="pfEmailC" type="email" value="${esc(p.email_connexion)}" disabled></div>
      <div class="rt-field"><label for="pfNiveau">Niveau d'arbitrage</label>
        <input id="pfNiveau" type="text" value="${esc(p.niveau)}" placeholder="JPR Groupe Rouge REG"></div>
      <div class="rt-field"><label for="pfNom">Nom tel qu'il figure sur les convocations</label>
        <input id="pfNom" type="text" value="${esc(p.nom_ffbb)}"></div>
      <div class="rt-field"><label for="pfMailFfbb">Email connu de la FFBB</label>
        <input id="pfMailFfbb" type="email" value="${esc(p.email_ffbb)}"></div>
      <p class="rt-help">Ces deux dernières valeurs servent à te reconnaître dans le bloc arbitre d'une convocation.</p>
    </section>

    <section class="rt-sect">
      <h3>Adresse de départ</h3>
      <p class="rt-help">Point de départ de tous les calculs de kilomètres.</p>
      <div class="rt-field"><label for="pfAdr">Adresse</label>
        <input id="pfAdr" type="text" value="${esc(p.adresse)}"></div>
      <div class="rt-row">
        <div class="rt-field"><label for="pfCp">Code postal</label>
          <input id="pfCp" type="text" value="${esc(p.code_postal)}"></div>
        <div class="rt-field"><label for="pfVille">Ville</label>
          <input id="pfVille" type="text" value="${esc(p.ville)}"></div>
      </div>
      <button type="button" class="rt-btn" id="pfSaveProfil">Enregistrer</button>
    </section>

    <section class="rt-sect">
      <h3>Véhicules</h3>
      <p class="rt-help">Historique daté : un match reste calculé avec la voiture
        en service à sa date. Ajouter un véhicule ne change rien au passé.</p>
      <ul class="rt-veh-list">
        ${vs.map((v, i) => `
          <li class="rt-veh${v === actuel ? " is-current" : ""}">
            <div>
              <strong>${esc(v.nom)}</strong>${v === actuel ? ' <span class="rt-tag">actuel</span>' : ""}
              <span class="rt-veh-meta">${esc(v.conso)} L/100 · ${esc(v.cv)} CV · depuis le ${esc(v.depuis)}</span>
            </div>
            ${vs.length > 1 ? `<button type="button" class="rt-mini" data-del="${i}" title="Supprimer">&times;</button>` : ""}
          </li>`).join("")}
      </ul>
      <details class="rt-details">
        <summary>Ajouter un véhicule</summary>
        <div class="rt-row">
          <div class="rt-field"><label for="vhNom">Modèle</label>
            <input id="vhNom" type="text" placeholder="Audi A3 35 TFSI"></div>
          <div class="rt-field"><label for="vhDepuis">Depuis le</label>
            <input id="vhDepuis" type="text" placeholder="01/09/2026"></div>
        </div>
        <div class="rt-row">
          <div class="rt-field"><label for="vhConso">Consommation (L/100 km)</label>
            <input id="vhConso" type="text" placeholder="6.0"></div>
          <div class="rt-field"><label for="vhCv">Chevaux fiscaux</label>
            <input id="vhCv" type="text" placeholder="8"></div>
        </div>
        <p class="rt-help">Les chevaux fiscaux n'entrent pas dans l'indemnité FFBB
          (toujours ${esc(t.indemnite_km)} €/km) : ils ne servent qu'à l'équivalent barème fiscal.</p>
        <button type="button" class="rt-btn" id="pfAddVeh">Ajouter</button>
      </details>
    </section>

    <section class="rt-sect">
      <h3>Tarifs</h3>
      <div class="rt-row">
        <div class="rt-field"><label for="pfIndem">Indemnité FFBB (€/km)</label>
          <input id="pfIndem" type="text" value="${esc(t.indemnite_km)}"></div>
        <div class="rt-field"><label for="pfUsure">Usure véhicule (€/km)</label>
          <input id="pfUsure" type="text" value="${esc(t.usure_km)}"></div>
      </div>
      <p class="rt-help">L'usure n'est versée par personne : elle sert à calculer un net réel plus complet.</p>
      <button type="button" class="rt-btn" id="pfSaveTarifs">Enregistrer</button>
    </section>

    <section class="rt-sect">
      <h3>Sécurité</h3>
      <details class="rt-details">
        <summary>Changer mon mot de passe</summary>
        <div class="rt-field"><label for="pwAnc">Mot de passe actuel</label>
          <input id="pwAnc" type="password" autocomplete="current-password"></div>
        <div class="rt-field"><label for="pwNouv">Nouveau mot de passe</label>
          <input id="pwNouv" type="password" autocomplete="new-password" placeholder="12 caractères minimum"></div>
        <button type="button" class="rt-btn" id="pfChangePwd">Modifier</button>
      </details>
      <p class="rt-help">Session valable 30 jours, prolongée à chaque visite.</p>
      <button type="button" class="rt-btn-danger" id="rtLogoutBtn">Se déconnecter</button>
    </section>`;

  document.getElementById("rtLogoutBtn").addEventListener("click", logout);
  document.getElementById("pfSaveProfil").addEventListener("click", saveProfil);
  document.getElementById("pfSaveTarifs").addEventListener("click", saveTarifs);
  document.getElementById("pfAddVeh").addEventListener("click", addVehicule);
  document.getElementById("pfChangePwd").addEventListener("click", changePassword);
  body.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => delVehicule(Number(b.dataset.del))));
}

function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ""; }

function envoyer(action, corps, succes) {
  return jsonp(action, corps).then(res => {
    if (!res || !res.success) throw new Error((res && res.error) || "Échec");
    if (res.config) Profil.config = res.config;
    if (res.profil) Profil.config.profil = res.profil;
    if (res.tarifs) Profil.config.tarifs = res.tarifs;
    if (res.vehicules) Profil.config.vehicules = res.vehicules;
    renderProfile();
    toast(res.message || succes);
    return res;
  }).catch(err => toast(err.message || "Échec", true));
}

function saveProfil() {
  envoyer("settings.profil", {
    profil: {
      niveau: val("pfNiveau"), nom_ffbb: val("pfNom"), email_ffbb: val("pfMailFfbb"),
      adresse: val("pfAdr"), code_postal: val("pfCp"), ville: val("pfVille")
    }
  }, "Profil enregistré.");
}

function saveTarifs() {
  envoyer("settings.tarifs", {
    tarifs: { indemnite_km: val("pfIndem"), usure_km: val("pfUsure") }
  }, "Tarifs enregistrés.");
}

function addVehicule() {
  envoyer("settings.vehicule.add", {
    vehicule: { nom: val("vhNom"), depuis: val("vhDepuis"), conso: val("vhConso"), cv: val("vhCv") }
  }, "Véhicule ajouté. Les matchs passés ne changent pas.");
}

function delVehicule(i) {
  const v = (Profil.config.vehicules || [])[i];
  if (!v) return;
  if (!confirm("Supprimer « " + v.nom + " » ?\n\nLes matchs de cette période seront recalculés avec le véhicule précédent.")) return;
  envoyer("settings.vehicule.del", { index: i }, "Véhicule supprimé.");
}

function changePassword() {
  const anc = val("pwAnc"), nouv = val("pwNouv");
  if (!anc || !nouv) return toast("Remplis les deux champs.", true);
  jsonp("password.change", { ancien: anc, nouveau: nouv }).then(res => {
    if (!res || !res.success) throw new Error((res && res.error) || "Échec");
    document.getElementById("pwAnc").value = "";
    document.getElementById("pwNouv").value = "";
    toast(res.message || "Mot de passe modifié.");
  }).catch(err => toast(err.message || "Échec", true));
}

function showProfile() {
  buildProfilePanel();
  renderProfile();
  document.getElementById("rtProfile").classList.add("is-visible");

  jsonp("settings.get").then(res => {
    if (res && res.success) { Profil.config = res.config; renderProfile(); }
  }).catch(() => toast("Réglages indisponibles.", true));
}

function hideProfile() {
  const el = document.getElementById("rtProfile");
  if (el) el.classList.remove("is-visible");
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
      Profil.email = res.email || "";
      if (typeof loadData === "function") loadData();
    })
    .catch(() => { /* jsonp a déjà réaffiché l'écran de connexion si besoin */ });
}

document.addEventListener("DOMContentLoaded", () => {
  buildLoginOverlay();
  if (Session.token) startApp();
  else showLogin("");

  const btn = document.getElementById("rtProfileBtn");
  if (btn) btn.addEventListener("click", showProfile);
});
