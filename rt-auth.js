/* © 2026 Clément REBHOLZ — Referee Tracker. Tous droits réservés. Reproduction, copie ou réutilisation interdites sans autorisation écrite de l'auteur. */
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

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyi-iJfUyRyN39R9vknQTyvgLeCMA3QzLtsD5N4XVwpJTMtsXMsUSsrsrqDXLi8DI1t/exec";
const API_TIMEOUT_MS = 60000;   // Apps Script peut mettre ~1 min au tout premier appel (démarrage à froid)
const TOKEN_KEY = "rt_session_token";
const EMAIL_KEY = "rt_session_email";
const SINCE_KEY = "rt_session_since";
const CFG_KEY   = "rt_config_cache";

/* HOME est renseigné par le serveur après authentification :
   l'adresse ne figure plus dans le dépôt public. */
var HOME = { label: "", lat: 0, lon: 0 };   // renseigné uniquement après authentification

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
    try { SB.clear(); } catch (e) {}
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(SINCE_KEY);
      localStorage.removeItem(CFG_KEY);
      Object.keys(localStorage)
        .filter(k => k.indexOf("rt_c_") === 0 || k === "rt-reglement-hist-v1" || k === "rt_logos_v1" || k === "rt-alertes-traitees-v2")
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
};

/* ---------------- Erreurs ---------------- */

/* b44 (A22) — date civile AAAA-MM-JJ dans le fuseau de l'utilisateur (Paris).
   toISOString() passe par l'UTC : le 15/10 à minuit devenait le 14/10. */
function isoLocal_(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
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

/* b20 — TRANSPORT FIABILISÉ.
   Mesuré le 08/10/2026 : ~1 appel sur 8 reçoit un 404 de
   script.googleusercontent.com (page de réponse perdue par Google) alors que
   l'action a été exécutée. Chaque appel est donc retenté jusqu'à 3 fois
   (404, 5xx, coupure réseau / « Load failed » Safari). Les écritures portent
   un identifiant unique (rid) : le serveur ne les exécute qu'une seule fois. */
const API_RETRY_PAUSES = [700, 1800];
const API_TIMEOUTS = { "reglement.ask": 150000, "elicence.document": 120000, "elicence.carte": 90000, "rapport.add": 120000, "rapport.file": 120000, "evaluation.upload": 180000, "evaluation.reanalyse": 180000 };
function _rid() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ""); } catch (e) {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function _retentable(err) {
  if (!err) return false;
  const st = err.httpStatus;
  if (st === 404 || st === 408 || st === 429 || st >= 500) return true;
  if (err.name === "TypeError" || /load failed|failed to fetch|network|réseau/i.test(err.message || "")) return true;
  return /page HTML|Réponse vide|illisible/i.test(err.message || "");
}
function apiCall(action, extra = {}, withToken = true) {
  const ecriture = withToken && !(typeof LECTURES !== "undefined" && LECTURES[action]);
  const corps = ecriture ? Object.assign({ rid: _rid() }, extra) : extra;
  // Une action longue (IA) peut encore tourner côté serveur quand le rejeu
  // arrive : on patiente (jusqu'à ~2 min) au lieu d'afficher une erreur.
  let attentes = 0;
  const essai = n => _apiCallUnique(action, corps, withToken).then(res => {
    if (res && res.success === false && /toujours en cours/i.test(res.error || "") && attentes++ < 25) {
      return new Promise(ok => setTimeout(ok, 4000)).then(() => essai(n));
    }
    return res;
  }, err => {
    if (n >= API_RETRY_PAUSES.length || !_retentable(err)) throw err;
    return new Promise(ok => setTimeout(ok, API_RETRY_PAUSES[n])).then(() => essai(n + 1));
  });
  return essai(0);
}
function _apiCallUnique(action, extra = {}, withToken = true) {
  const body = { action, ...extra };
  if (withToken) body.token = Session.token;

  const hasAbort = typeof AbortController === "function";
  const controller = hasAbort ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, API_TIMEOUTS[action] || API_TIMEOUT_MS);

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
          "Pas de réponse du serveur (délai dépassé).",
          "Ouvre les outils développeur (⌥⌘I) → onglet Réseau, retente, et regarde la ligne script.google.com : " +
          "statut « (pending) » = Apps Script ne répond pas ; « CORS error » = problème de déploiement ; " +
          "302 sans suite = redirection bloquée."
        );
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

/* ---------------- Cache « affiche d'abord, rafraîchis ensuite » ----------------

   Apps Script met 1 à 5 s à répondre, et relit toute la feuille à chaque appel.
   Plutôt que d'attendre, on affiche immédiatement la dernière réponse connue
   puis on va chercher la version fraîche en arrière-plan. Si elle diffère,
   l'écran se met à jour tout seul.

   Seules les lectures sont concernées. Les écritures (updatePaymentStatus,
   settings.*, password.*) ne passent jamais par le cache, et invalident tout. */

/* b21 — cache versionné : la clé porte la version du site, donc une nouvelle
   version repart toujours sur des données au bon format (les anciens préfixes
   sont purgés au démarrage). 7 jours maximum : au-delà, les données perso
   (licence, téléphones des collègues) ne traînent plus dans le navigateur. */
const CACHE_VERSION = String(window.RT_VERSION || "x").replace(/[^\w-]/g, "");
const CACHE_PREFIX  = "rt_c_" + CACHE_VERSION + "_";
const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
(function purgerAnciensCaches_() {
  try {
    Object.keys(localStorage).filter(k => k.indexOf("rt_c_") === 0 && k.indexOf(CACHE_PREFIX) !== 0 || k === "rt_last_matchs").forEach(k => localStorage.removeItem(k));
  } catch (e) {}
})();
const CACHE_FRESH   = 45 * 1000;          // en deçà, inutile de revalider
const LECTURES = { matchs: 1, stats: 1, "stats.env": 1, config: 1, classements: 1, qcmStats: 1, formations: 1, niveaux: 1, evaluations: 1, contacts: 1, procedures: 1, "couts.get": 1, hotels: 1, enjeux: 1, elicence: 1, rapports: 1 };

/* Une réponse « matchs » vide est presque toujours un hoquet serveur
   (démarrage à froid, lecture du Sheet ratée), jamais une vraie base vide.
   On ne la met JAMAIS en cache et on ne laisse jamais un jeu déjà chargé
   être remplacé par elle — sinon le rechargement suivant relit le vide. */
function _reponseVide(action, res) {
  return action === "matchs" && (!res || !Array.isArray(res.data) || res.data.length === 0);
}

/* Seules ces actions modifient la feuille : elles seules doivent purger le
   cache. Tout le reste (« me », lectures diverses) passe simplement au
   travers — sans quoi « me », appelé à chaque démarrage, viderait le cache
   avant même qu'il ne serve. */
const ECRITURES = {
  updatePaymentStatus: 1,
  "payment.update": 1, "bank.add": 1, "bank.undo": 1,
  setContact: 1,
  deleteEvaluation: 1, importAllEvaluations: 1, "evaluation.upload": 1, "evaluation.update": 1, "evaluation.reanalyse": 1,
  addFormation: 1, deleteFormation: 1,
  addNiveau: 1, deleteNiveau: 1,
  addContact: 1, deleteContact: 1,
  addProcedure: 1, updateProcedure: 1, deleteProcedure: 1, updateContact: 1,
  addQcmSession: 1, deleteQcmSession: 1,
  "settings.profil": 1, "settings.tarifs": 1,
  "settings.vehicule.add": 1, "settings.vehicule.del": 1,
  "couts.set": 1,
  addHotel: 1, deleteHotel: 1,
  "elicence.set": 1, "elicence.document": 1, "elicence.carte": 1, 
  "rapport.add": 1, "rapport.file": 1, "rapport.delete": 1, "rapport.dossier": 1, "rapport.modele.send": 1,
  "alerte.ignorer": 1, "mission.ecarter": 1, "mission.annuler": 1, "ticket.add": 1, "emarque.set": 1   // b18-b19 (alerte.traiter : volontairement hors liste, ne touche pas aux matchs)
};


/* ======================================================================
   b25 — Supabase (étape 1b) : LECTURES depuis Postgres (≈150 ms) au lieu
   d'Apps Script (1,5-3 s). Les écritures passent encore par Apps Script, qui
   resynchronise la table touchée vers Supabase après chaque écriture.
   Clé « publiable » : publique par conception ; la sécurité repose sur
   l'authentification (Supabase Auth) et les politiques RLS de la base.
   ====================================================================== */
const SB_URL = "https://jlstedchnmdteazuqbly.supabase.co";
const SB_KEY = "sb_publishable_B1w244FrkzbIn-SZ-T_z8w_4HVg9stb";
const SB_STORE = "rt_sb_session";
const SB_LECTURES = { matchs: 1, evaluations: 1, niveaux: 1, contacts: 1, procedures: 1, hotels: 1, formations: 1, qcmStats: 1 };
/* b27 — écritures directes Supabase (tables possédées par Supabase ; le Sheet
   n'est plus la référence pour celles-ci). Hôtels (facture Drive), paiements,
   évaluations (IA) restent sur Apps Script. */
const SB_ECRITURES = { addContact: 1, updateContact: 1, deleteContact: 1, addProcedure: 1, updateProcedure: 1, deleteProcedure: 1, addNiveau: 1, deleteNiveau: 1, addFormation: 1, deleteFormation: 1, addQcmSession: 1, deleteQcmSession: 1 };
const SB_MATCH_COLS = {"UID": "uid", "Source": "source", "Saison": "saison", "Format": "format", "Statut": "statut", "Date match": "date_match", "Heure/RDV": "heure_rdv", "Niveau administratif": "niveau_administratif", "Type compétition": "type_competition", "Code compétition": "code_competition", "Libellé compétition": "libelle_competition", "Poule / phase compétition": "poule_phase_competition", "Genre": "genre", "Catégorie d'âge": "categorie_d_age", "N° rencontre": "n_rencontre", "Recevant": "recevant", "Code club recevant": "code_club_recevant", "N° équipe recevant": "n_equipe_recevant", "Visiteur / événement": "visiteur_evenement", "Code club visiteur": "code_club_visiteur", "Salle": "salle", "Adresse": "adresse", "Ville": "ville", "Téléphone salle": "telephone_salle", "Code e-Marque": "code_e_marque", "Mon rôle": "mon_role", "Collègue nom": "collegue_nom", "Collègue rôle": "collegue_role", "Collègue téléphone": "collegue_telephone", "Contact collègue": "contact_collegue", "Club du collègue (groupement)": "club_du_collegue_groupement", "Km aller collègue": "km_aller_collegue", "Indemnité collègue": "indemnite_collegue", "Référent 3x3": "referent_3x3", "Observateur": "observateur", "OTM Chronométreur": "otm_chronometreur", "OTM Chronométreur tirs": "otm_chronometreur_tirs", "Km A/R stats": "km_a_r_stats", "Indemnité totale": "indemnite_totale", "Indemnisé par": "indemnise_par", "Paiement Type": "paiement_type", "Statut paiement": "statut_paiement", "Date paiement": "date_paiement", "Attendu recevant": "attendu_recevant", "Reçu recevant": "recu_recevant", "Mode recevant": "mode_recevant", "Date reçu recevant": "date_recu_recevant", "Attendu visiteur": "attendu_visiteur", "Reçu visiteur": "recu_visiteur", "Mode visiteur": "mode_visiteur", "Date reçu visiteur": "date_recu_visiteur", "Montant reçu": "montant_recu", "Date réception": "date_reception", "Mode paiement": "mode_paiement", "Mode paiement OTM": "mode_paiement_otm", "À trancher": "a_trancher", "Note paiement": "note_paiement", "Correspondant recevant (nom + tél)": "correspondant_recevant_nom_tel", "Maillot recevant": "maillot_recevant", "Correspondant visiteur (nom + tél)": "correspondant_visiteur_nom_tel", "Maillot visiteur": "maillot_visiteur", "Warning général": "warning_general", "Warning finance": "warning_finance", "Warning FBI": "warning_fbi", "Agenda Event ID": "agenda_event_id", "Dernière MAJ": "derniere_maj", "Sujet mail": "sujet_mail", "Gmail Message ID": "gmail_message_id", "Régime": "regime", "Date attendue": "date_attendue", "Raison à trancher": "raison_a_trancher", "Statut manuel": "statut_manuel", "Recevant court": "recevant_court", "Visiteur court": "visiteur_court"};
const SB_DATES = { date_match: 1, date_paiement: 1, date_reception: 1, date_recu_recevant: 1, date_recu_visiteur: 1, date_attendue: 1 };
const SB = {
  get session() { try { return JSON.parse(localStorage.getItem(SB_STORE) || "null"); } catch (e) { return null; } },
  save(s) { try { localStorage.setItem(SB_STORE, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)) })); } catch (e) {} },
  clear() { try { localStorage.removeItem(SB_STORE); } catch (e) {} },
  get actif() { return !!(this.session && this.session.refresh_token); },
  async _auth(grant, body) {
    const r = await fetch(SB_URL + "/auth/v1/token?grant_type=" + grant, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.error || ("Supabase HTTP " + r.status));
    this.save(j);
    return j;
  },
  login(email, password) { return this._auth("password", { email, password }); },
  async token() {
    const s = this.session;
    if (!s) throw new Error("Session Supabase absente");
    if (s.expires_at - Math.floor(Date.now() / 1000) > 60) return s.access_token;
    const j = await this._auth("refresh_token", { refresh_token: s.refresh_token });
    return j.access_token;
  },
  async write(method, path, body, tentative = 0) {
    const t = await this.token();
    const r = await fetch(SB_URL + "/rest/v1/" + path, { method, headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json", Accept: "application/json", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401 && tentative === 0) { try { await this._auth("refresh_token", { refresh_token: this.session.refresh_token }); } catch (e) { this.clear(); throw new Error("AUTH_REQUIRED"); } return this.write(method, path, body, 1); }
    if (!r.ok) { let m = ""; try { m = (await r.json()).message || ""; } catch (e) {} throw new Error("Supabase HTTP " + r.status + (m ? " : " + m : "")); }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : [];
  },
  async get(path, tentative = 0) {
    const t = await this.token();
    const r = await fetch(SB_URL + "/rest/v1/" + path, { headers: { apikey: SB_KEY, Authorization: "Bearer " + t, Accept: "application/json" }, cache: "no-store" });
    if (r.status === 401 && tentative === 0) { try { await this._auth("refresh_token", { refresh_token: this.session.refresh_token }); } catch (e) { this.clear(); throw new Error("AUTH_REQUIRED"); } return this.get(path, 1); }
    if (!r.ok) throw new Error("Supabase HTTP " + r.status + " (" + path.split("?")[0] + ")");
    return r.json();
  }
};
function sb_dateFr_(v) { if (!v) return ""; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(v); }
function sb_num_(v) { return v === null || v === undefined ? "" : String(v); }
function sb_txt_(v) { return v === null || v === undefined ? "" : String(v); }
/* Ligne Postgres → objet clé = en-tête du Sheet (format attendu par app.js). */
function sb_matchVersSheet_(r) {
  const o = {};
  Object.keys(SB_MATCH_COLS).forEach(h => {
    const c = SB_MATCH_COLS[h], v = r[c];
    if (SB_DATES[c]) o[h] = sb_dateFr_(v);
    else if (c === "derniere_maj") o[h] = v ? sb_dateFr_(v) + " " + String(v).slice(11, 16) : "";
    else if (c === "heure_rdv") { const t = String(v == null ? "" : v); const m = t.match(/(\d{1,2}):(\d{2})/); o[h] = /^1899/.test(t) && !m ? "" : (m ? m[1].padStart(2, "0") + ":" + m[2] : t); }   // b34 : heure Sheets (1899-12-30) → HH:MM
    else if (typeof v === "number") o[h] = sb_num_(v);
    else o[h] = sb_txt_(v);
  });
  return o;
}
const SB_SELECT_MATCHS = Object.values(SB_MATCH_COLS).join(",");
async function sb_lire_(action) {
  const n = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
  switch (action) {
    case "matchs": {
      const rows = await SB.get("matchs?select=" + SB_SELECT_MATCHS + "&order=date_match.desc.nullslast&limit=5000");
      return { success: true, data: rows.map(sb_matchVersSheet_) };
    }
    case "evaluations": {
      const rows = await SB.get("evaluations?select=*&order=date_depot.desc&limit=2000");
      return { success: true, data: rows.map(r => ({
        id: r.sheet_row, dateDepot: sb_dateFr_(r.date_depot), uidMatch: sb_txt_(r.uid_match_lie), dateMatch: sb_dateFr_(r.date_match_liee), rencontre: sb_txt_(r.rencontre),
        fichier: sb_txt_(r.nom_fichier), lien: sb_txt_(r.lien_drive), statut: sb_txt_(r.statut_analyse_ia), synthese: sb_txt_(r.synthese_ia), axe1: sb_txt_(r.axe_travail_1), axe2: sb_txt_(r.axe_travail_2),
        type: r.type || "Observation de match", instance: sb_txt_(r.instance), observateur: sb_txt_(r.observateur), championnat: sb_txt_(r.championnat), dateEval: sb_dateFr_(r.date_evaluation),
        note20: n(r.note_20), familles: { calls: n(r.calls), controle: n(r.controle), mecanique: n(r.mecanique), communication: n(r.communication), physique: n(r.physique) },
        grille: Array.isArray(r.grille_d_origine) ? r.grille_d_origine : [], pointsForts: sb_txt_(r.points_forts).split(" | ").filter(String), plan: sb_txt_(r.plan_de_travail).split(" | ").filter(String),
        saison: sb_txt_(r.saison), noteBrute: sb_txt_(r.note_brute), noteEstimee: r.note_estimee === "oui" })) };
    }
    case "niveaux": {
      const rows = await SB.get("niveaux?select=*&order=date_de_debut.desc.nullslast");
      return { success: true, data: rows.map(r => ({ id: r.id, typeOfficiel: sb_txt_(r.type_d_officiel), niveau: sb_txt_(r.niveau), couleur: sb_txt_(r.couleur), recyclage: sb_dateFr_(r.recyclage), dateDebut: sb_dateFr_(r.date_de_debut), dateFin: sb_dateFr_(r.date_de_fin), groupement: sb_txt_(r.groupement), saisiPar: sb_txt_(r.saisi_par) })) };
    }
    case "contacts": {
      const rows = await SB.get("contacts?select=*&order=id");
      return { success: true, data: rows.map(r => ({ id: r.id, nom: sb_txt_(r.nom), role: sb_txt_(r.role), organisation: sb_txt_(r.organisation_club), telephone: sb_txt_(r.telephone), email: sb_txt_(r.email), notes: sb_txt_(r.notes), championnat: sb_txt_(r.championnat), situation: sb_txt_(r.situation) })) };
    }
    case "procedures": {
      const rows = await SB.get("procedures?select=*&order=id");
      return { success: true, data: rows.map(r => ({ id: r.id, titre: sb_txt_(r.titre), categorie: sb_txt_(r.categorie), contenu: sb_txt_(r.contenu), lien: sb_txt_(r.lien), mail: sb_txt_(r.mail), telephone: sb_txt_(r.telephone), personne: sb_txt_(r.personne), importance: sb_txt_(r.importance) })) };
    }
    case "hotels": {
      const rows = await SB.get("hotels?select=*&order=date_nuit.desc.nullslast");
      return { success: true, data: rows.map(r => ({ id: sb_txt_(r.id_ref), date: sb_dateFr_(r.date_nuit), lieu: sb_txt_(r.lieu), hotel: sb_txt_(r.hotel), prix: Number(r.prix_nuit) || 0, repas: Number(r.repas) || 0, notes: sb_txt_(r.notes), matchUid: sb_txt_(r.match_uid), facture: sb_txt_(r.facture_url) })) };
    }
    case "formations": {
      const rows = await SB.get("formations?select=*&order=date.desc.nullslast");
      return { success: true, data: rows.map(r => ({ date: sb_dateFr_(r.date), intitule: sb_txt_(r.intitule), lieu: sb_txt_(r.lieu), km: Number(r.km_a_r) || 0, notes: sb_txt_(r.notes) })) };
    }
    case "qcmStats": {
      const rows = await SB.get("qcm?select=*&order=id.desc&limit=500");
      const faib = {};
      const toutes = rows.map(r => {
        if (r.mode === "exam" && r.faiblesses) { try { JSON.parse(r.faiblesses).forEach(f => { faib[f.theme] = (faib[f.theme] || 0) + (Number(f.n) || 1); }); } catch (e) {} }
        return { id: r.id, date: sb_dateFr_(r.date), score: Number(r.score) || 0, total: Number(r.total) || 0, pourcentage: Number(r.pourcentage) || 0, duree: r.duree_min === null ? "" : Number(r.duree_min), mode: r.mode || "manuel" };
      });
      const entrainements = toutes.filter(x => x.mode === "entrainement").slice(0, 30);
      const sessions = toutes.filter(x => x.mode !== "entrainement");
      const moy = arr => arr.reduce((t, x) => t + x.pourcentage, 0) / arr.length;
      let tendance = "";
      if (sessions.length >= 4 && sessions.slice(5, 10).length) { const e = Math.round(moy(sessions.slice(0, 5)) - moy(sessions.slice(5, 10))); tendance = e > 1 ? "En progression (+" + e + " pts)" : e < -1 ? "En baisse (" + e + " pts)" : "Stable"; }
      return { success: true, stats: { nb: sessions.length, sessions: sessions.slice(0, 20), entrainements, faiblesses_top: Object.keys(faib).map(k => ({ theme: k, n: faib[k] })).sort((a, b) => b.n - a.n).slice(0, 8), moyenne_pct: sessions.length ? Math.round(moy(sessions) * 10) / 10 : 0, meilleur_score: sessions.reduce((b, x) => (!b || x.pourcentage > b.pourcentage) ? x : b, null), tendance } };
    }
  }
  throw new Error("Lecture Supabase inconnue : " + action);
}
/* b27 — écritures directes. Réponses au même format qu'Apps Script. */
const sb_iso_ = v => { if (!v) return null; const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : null; };
const sb_clean_ = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const sb_id_ = v => { const n = Number(v); if (!n) throw new Error("Identifiant manquant"); return n; };
async function sb_ecrire_(action, p = {}) {
  const ok = result => ({ success: true, result });
  switch (action) {
    case "addContact": case "updateContact": {
      if (!sb_clean_(p.nom)) throw new Error("Nom requis");
      const row = { nom: sb_clean_(p.nom), role: sb_clean_(p.role), organisation_club: sb_clean_(p.organisation), telephone: sb_clean_(p.telephone), email: sb_clean_(p.email), notes: sb_clean_(p.notes), championnat: sb_clean_(p.championnat), situation: sb_clean_(p.situation) };
      const r = action === "addContact" ? await SB.write("POST", "contacts", row) : await SB.write("PATCH", "contacts?id=eq." + sb_id_(p.id), row);
      return ok({ id: r[0] && r[0].id, updated: true });
    }
    case "deleteContact": await SB.write("DELETE", "contacts?id=eq." + sb_id_(p.id)); return ok({ deleted: true });
    case "addProcedure": case "updateProcedure": {
      if (!sb_clean_(p.titre)) throw new Error("Titre requis");
      const row = { titre: sb_clean_(p.titre), categorie: sb_clean_(p.categorie), contenu: String(p.contenu == null ? "" : p.contenu).trim(), lien: sb_clean_(p.lien), mail: sb_clean_(p.mail), telephone: sb_clean_(p.telephone), personne: sb_clean_(p.personne), importance: sb_clean_(p.importance) };
      const r = action === "addProcedure" ? await SB.write("POST", "procedures", row) : await SB.write("PATCH", "procedures?id=eq." + sb_id_(p.id), row);
      return ok({ id: r[0] && r[0].id, updated: true });
    }
    case "deleteProcedure": await SB.write("DELETE", "procedures?id=eq." + sb_id_(p.id)); return ok({ deleted: true });
    case "addNiveau": {
      if (!sb_clean_(p.niveau)) throw new Error("Niveau requis");
      const r = await SB.write("POST", "niveaux", { type_d_officiel: sb_clean_(p.typeOfficiel) || "Arbitre", niveau: sb_clean_(p.niveau), couleur: sb_clean_(p.couleur), recyclage: sb_iso_(p.recyclage), date_de_debut: sb_iso_(p.dateDebut) || isoLocal_(new Date()), date_de_fin: sb_iso_(p.dateFin), groupement: sb_clean_(p.groupement), saisi_par: sb_clean_(p.saisiPar) });
      return ok({ id: r[0] && r[0].id });
    }
    case "deleteNiveau": await SB.write("DELETE", "niveaux?id=eq." + sb_id_(p.id)); return ok({ deleted: true });
    case "addFormation": {
      if (!sb_clean_(p.intitule)) throw new Error("Intitulé requis");
      const r = await SB.write("POST", "formations", { date: sb_iso_(p.date) || isoLocal_(new Date()), intitule: sb_clean_(p.intitule), lieu: sb_clean_(p.lieu), km_a_r: Number(String(p.km || "0").replace(",", ".")) || 0, notes: sb_clean_(p.notes) });
      return ok({ id: r[0] && r[0].id });
    }
    case "deleteFormation": {
      const d = sb_iso_(p.date); if (!d) throw new Error("Date invalide");
      const r = await SB.write("DELETE", "formations?date=eq." + d + "&intitule=eq." + encodeURIComponent(sb_clean_(p.intitule)));
      return ok({ deleted: Array.isArray(r) ? r.length > 0 : true });
    }
    case "addQcmSession": {
      const sc = Number(p.score), tot = Number(p.total) || 20;
      if (isNaN(sc) || sc < 0 || sc > tot) throw new Error("Score invalide");
      const pct = tot > 0 ? Math.round(sc / tot * 1000) / 10 : 0;
      let fb = ""; try { fb = p.faiblesses ? JSON.stringify(JSON.parse(String(p.faiblesses)).slice(0, 40)) : ""; } catch (e) { fb = ""; }
      const r = await SB.write("POST", "qcm", { date: isoLocal_(new Date()), score: sc, total: tot, pourcentage: pct, duree_min: Number(p.duree) || null, mode: p.mode === "exam" ? "exam" : (p.mode === "entrainement" ? "entrainement" : "manuel"), faiblesses: fb });
      return ok({ id: r[0] && r[0].id, score: sc, total: tot, pourcentage: pct });
    }
    case "deleteQcmSession": await SB.write("DELETE", "qcm?id=eq." + sb_id_(p.id)); return ok({ deleted: true });
  }
  throw new Error("Écriture Supabase inconnue : " + action);
}

function _cacheKey(action, extra) {
  return CACHE_PREFIX + action + ":" + JSON.stringify(extra || {});
}

function _cacheLire(cle) {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return null;
    const o = JSON.parse(brut);
    if (o && o.t === 1 && o.d) return o;   // b26 : périmé volontairement, à revalider
    return (o && o.t && Date.now() - o.t < CACHE_MAX_AGE) ? o : null;
  } catch (e) { return null; }
}

function _cacheEcrire(cle, data) {
  try {
    localStorage.setItem(cle, JSON.stringify({ t: Date.now(), d: data }));
  } catch (e) {
    // Quota atteint : on purge les lectures secondaires, puis on retente afin
    // que la liste des matchs — indispensable au rechargement — survive.
    try {
      Object.keys(localStorage)
        .filter(k => k.indexOf(CACHE_PREFIX) === 0 && k !== cle)
        .forEach(k => localStorage.removeItem(k));
      localStorage.setItem(cle, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e2) {}
  }
}

function cacheVider() {
  try {
    Object.keys(localStorage)
      // On garde le dernier instantané des matchs. Une écriture déclenche un
      // rafraîchissement réseau, mais un échec ne doit jamais vider l'écran.
      .filter(k => k.indexOf(CACHE_PREFIX) === 0 && k.indexOf(CACHE_PREFIX + "matchs:") !== 0)
      .forEach(k => {
        // b26 — les lectures calculées côté Apps Script (stats, QCM, enjeux,
        // classements) ne sont plus effacées mais marquées périmées : l'onglet
        // s'affiche tout de suite depuis le cache et se revalide en arrière-plan.
        if (/_(stats|qcmStats|enjeux|classements|config):/.test(k)) {
          try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.d) { o.t = 1; localStorage.setItem(k, JSON.stringify(o)); return; } } catch (e) {}
        }
        localStorage.removeItem(k);
      });
  } catch (e) {}
}
/* b26 — resynchronisation Supabase en arrière-plan après une écriture sur les
   matchs (le serveur ne la fait plus dans la réponse, pour répondre plus vite). */
function sbSyncArrierePlan(tables) {
  if (!SB.actif) return;
  try { apiCall("sb.sync", { tables: tables || "matchs" }).catch(() => {}); } catch (e) {}
}

/* Redemande le rendu après l'arrivée de données fraîches. Les appels
   repassent par jsonp, qui trouve alors un cache tout juste écrit : pas
   de boucle possible. */
let _rafraichissementEnCours = false;
function _rafraichirEcran(action) {
  // Listes secondaires (contacts, procédures, hôtels…) : sans ceci, une entrée
  // périmée restait affichée alors que le serveur avait des données neuves.
  try {
    const L = { contacts: "loadContacts", procedures: "loadProcedures", hotels: "loadHotels", enjeux: "loadEnjeux" };
    if (action && L[action] && typeof window[L[action]] === "function") window[L[action]]();
  } catch (e) {}
  if (action && action !== "matchs" && action !== "stats") return;
  if (_rafraichissementEnCours) return;
  _rafraichissementEnCours = true;
  setTimeout(() => {
    _rafraichissementEnCours = false;
    try {
      if (typeof loadData === "function") loadData();
      if (typeof loadStats === "function") loadStats();
    } catch (e) { /* le rendu suivant repartira du cache */ }
  }, 0);
}

/* Lecture forcée : ignore le cache et va toujours au serveur, puis remplace
   l'entrée en cache. Sert quand le contenu mis en cache est manifestement
   inadapté — par exemple des statistiques calculées pour une autre saison
   que celle demandée. Le cache normal ne peut pas s'en apercevoir tout seul :
   sa clé est correcte, c'est son contenu qui ne l'est pas. */
function jsonpFrais(action, extra = {}) {
  if (SB_LECTURES[action] && SB.actif) return jsonp(action, extra);   // b27 : Supabase est toujours frais
  if (action === "stats") { _statsEnv = null; const local = _statsLocal(extra); if (local) return local; }   // b29
  return _jsonpReseau(action, extra).then(res => {
    if (LECTURES[action] && res && res.success !== false && !_reponseVide(action, res)) {
      _cacheEcrire(_cacheKey(action, extra), res);
    }
    return res;
  });
}

/* Point d'entrée unique de l'application.
   Le nom `jsonp` est conservé pour ne rien casser dans app.js —
   le transport n'est plus du JSONP, qui exposait le jeton à n'importe
   quel script tiers. */
/* b29 — statistiques avancées calculées dans le navigateur (rt-stats.js = même
   moteur que le serveur) à partir des lignes déjà en mémoire : 0 aller-retour.
   Les réglages serveur (prix carburant, périodes) arrivent via « stats.env »,
   lecture cachée 7 j et revalidée en arrière-plan. */
let _statsEnv = null;
function _statsLocal(extra) {
  if (typeof RT_STATS === "undefined" || typeof state === "undefined" || !state.allRows || !state.allRows.length || typeof rawOf_ !== "function") return null;
  const envP = _statsEnv ? Promise.resolve(_statsEnv) : jsonp("stats.env").then(r => { if (r && r.success && r.env) _statsEnv = r.env; return _statsEnv; }).catch(() => null);
  return envP.then(env => {
    const t0 = performance.now();
    const stats = RT_STATS.calculer(state.allRows.map(rawOf_), (extra && extra.season) || "", env || undefined, (typeof Profil !== "undefined" && Profil.config) || null);
    window.RT_CACHE_INFO = window.RT_CACHE_INFO || {};
    window.RT_CACHE_INFO.stats = { timestamp: Date.now(), age: 0, stale: false, ms: Math.round(performance.now() - t0), source: "local" + (env ? "" : " (réglages par défaut)") };
    return { success: true, stats };
  });
}
/* b30 — moteur de paiement local (rt-paiements.js = Paiement.gs + Echeancier.gs).
   1) calcul sur la ligne en mémoire, 2) écriture Supabase (≈ 150 ms), réponse
   immédiate au même format qu'Apps Script (res.row), 3) en arrière-plan, la
   même mise à jour est envoyée à Apps Script (double écriture pendant la
   transition : le Sheet reste identique ; tout écart est journalisé). */
const SB_PAIEMENT_COLS_DATE = { date_attendue: 1, date_recu_recevant: 1, date_recu_visiteur: 1, date_reception: 1, date_paiement: 1 };
function sb_valeurColonne_(col, v) {
  if (v instanceof Date) return isNaN(v) ? null : (col === "derniere_maj" ? v.toISOString() : isoLocal_(v));   // b44 (A22) : date civile locale, pas UTC
  if (v === "" || v === null || v === undefined) return null;
  if (SB_PAIEMENT_COLS_DATE[col]) return sb_iso_(v);
  if (col === "derniere_maj") { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  if (typeof v === "number") return v;
  if (/^(attendu|recu)_(recevant|visiteur)$|^montant_recu$|^indemnite|^km_/.test(col)) { const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? null : n; }
  return String(v);
}
function _paiementLocal(extra) {
  if (typeof RT_PAIEMENTS === "undefined" || !SB.actif || typeof state === "undefined" || typeof rawOf_ !== "function" || !extra || !extra.uid) return null;
  const i = (state.allRows || []).findIndex(r => String(r && r.UID !== undefined ? r.UID : (r && r._raw ? r._raw.UID : "")) === String(extra.uid) || (typeof get === "function" && get(r, "UID") === String(extra.uid)));
  if (i < 0) return null;
  const avant = rawOf_(state.allRows[i]);
  let local;
  try { local = RT_PAIEMENTS.mettreAJour(Object.assign({}, avant), extra); } catch (e) { return Promise.resolve({ success: false, error: e.message }); }
  const patch = {};
  Object.keys(SB_MATCH_COLS).forEach(h => {
    const a = avant[h], b = local.row[h];
    if (String(a == null ? "" : a) !== String(b == null ? "" : b)) patch[SB_MATCH_COLS[h]] = sb_valeurColonne_(SB_MATCH_COLS[h], b);
  });
  const rowSortie = Object.assign({}, local.row);
  if (rowSortie["Dernière MAJ"] instanceof Date) rowSortie["Dernière MAJ"] = rowSortie["Dernière MAJ"].toLocaleString("fr-FR");
  const t0 = performance.now();
  return SB.write("PATCH", "matchs?uid=eq." + encodeURIComponent(String(extra.uid)), patch).then(() => {
    window.RT_CACHE_INFO = window.RT_CACHE_INFO || {};
    window.RT_CACHE_INFO["payment.update"] = { timestamp: Date.now(), ms: Math.round(performance.now() - t0), source: "local+supabase" };
    // Double écriture Apps Script (arrière-plan) + contrôle d'écart.
    _jsonpReseau("payment.update", extra).then(res => {
      const srv = res && res.row;
      if (!srv) return;
      const ecarts = ["Statut paiement", "Montant reçu", "Date attendue", "Régime", "Reçu recevant", "Reçu visiteur"].filter(k => String(srv[k] == null ? "" : srv[k]).replace(/,/g, ".") !== String(local.row[k] == null ? "" : local.row[k]).replace(/,/g, "."));
      if (ecarts.length) {
        console.warn("[Paiement] écart moteur local / Apps Script sur " + extra.uid + " :", ecarts.map(k => k + " local=" + local.row[k] + " serveur=" + srv[k]).join(" ; "));
        try { const j = JSON.parse(localStorage.getItem("rt_pay_ecarts") || "[]"); j.push({ t: new Date().toISOString(), uid: extra.uid, ecarts: ecarts.map(k => [k, local.row[k], srv[k]]) }); localStorage.setItem("rt_pay_ecarts", JSON.stringify(j.slice(-50))); } catch (e) {}
      }
    }).catch(err => console.warn("[Paiement] double écriture Apps Script échouée (Supabase à jour) :", err && err.message));
    return { success: true, result: local.result, row: rowSortie, source: "local" };
  }).catch(err => {
    if (/AUTH_REQUIRED/.test(err.message || "")) { Session.clear(); showLogin("Session expirée, reconnecte-toi."); throw apiError("Session expirée", ""); }
    console.warn("[Paiement] écriture Supabase échouée, repli Apps Script :", err.message);
    return null;
  });
}
function jsonp(action, extra = {}) {
  if (action === "stats") { const local = _statsLocal(extra); if (local) return local; }
  if (action === "payment.update") {
    const local = _paiementLocal(extra);
    if (local) return local.then(res => res || _jsonpReseau(action, extra).then(r => { if (r && r.success !== false) { cacheVider(); sbSyncArrierePlan("matchs"); } return r; }));
  }
  // b25 — lecture Supabase : rapide, pas de revalidation différée ; le cache
  // local n'est qu'un repli hors ligne.
  if (SB_LECTURES[action] && SB.actif) {
    const cle = _cacheKey(action, extra);
    const t0 = performance.now();
    return sb_lire_(action).then(res => {
      window.RT_CACHE_INFO = window.RT_CACHE_INFO || {};
      window.RT_CACHE_INFO[action] = { timestamp: Date.now(), age: 0, stale: false, ms: Math.round(performance.now() - t0), source: "supabase" };
      if (!_reponseVide(action, res)) _cacheEcrire(cle, res);
      return res;
    }).catch(err => {
      if (/AUTH_REQUIRED/.test(err.message || "")) { Session.clear(); showLogin("Session expirée, reconnecte-toi."); throw apiError("Session expirée", ""); }
      const hit = _cacheLire(cle);
      if (hit) { console.warn("[Supabase] " + action + " : " + err.message + " — cache local utilisé"); return hit.d; }
      throw err;
    });
  }
  if (LECTURES[action]) {
    const cle = _cacheKey(action, extra);
    const hit = _cacheLire(cle);

    if (hit) {
      const age = Date.now() - hit.t;
      window.RT_CACHE_INFO = window.RT_CACHE_INFO || {};
      window.RT_CACHE_INFO[action] = { timestamp: hit.t, age: age, stale: age > CACHE_FRESH };
      if (age > CACHE_FRESH) {
        // Revalidation silencieuse : ni spinner, ni erreur à l'écran
        _jsonpReseau(action, extra)
          .then(frais => {
            // Une erreur applicative ne doit jamais remplacer le dernier jeu
            // de données valide : sinon le rechargement suivant relirait
            // l'erreur depuis le cache et viderait l'interface.
            if (!frais || frais.success === false) return;
            if (_reponseVide(action, frais)) return;   // hoquet serveur : on garde le dernier bon jeu
            if (JSON.stringify(frais) !== JSON.stringify(hit.d)) {
              _cacheEcrire(cle, frais);
              _rafraichirEcran(action);
            } else {
              _cacheEcrire(cle, frais);   // rafraîchit l'horodatage
            }
          })
          .catch(() => { /* hors ligne : on garde l'affichage courant */ });
      }
      return Promise.resolve(hit.d);
    }

    return _jsonpReseau(action, extra).then(res => {
      if (res && res.success !== false && !_reponseVide(action, res)) _cacheEcrire(cle, res);
      return res;
    });
  }

  if (SB_ECRITURES[action] && SB.actif) {
    return sb_ecrire_(action, extra).then(res => { cacheVider(); return res; }).catch(err => {
      if (/AUTH_REQUIRED/.test(err.message || "")) { Session.clear(); showLogin("Session expirée, reconnecte-toi."); throw apiError("Session expirée", ""); }
      return { success: false, error: err.message };
    });
  }
  // Écriture : jamais de cache, et on invalide ce qui devient périmé.
  // Les autres actions passent au travers sans rien toucher.
  return _jsonpReseau(action, extra).then(res => {
    if (ECRITURES[action] && res && res.success !== false) {
      cacheVider();
      if (/^(payment\.|updatePaymentStatus|mission\.|setContact|bank\.|alerte\.ignorer|couts\.set|settings\.)/.test(action)) sbSyncArrierePlan("matchs");
    }
    return res;
  });
}

function _jsonpReseau(action, extra = {}) {
  return apiCall(action, extra).then(res => {
    if (res && res.success === false && res.error === "AUTH_REQUIRED") {
      Session.clear();
      showLogin("Session expirée, reconnecte-toi.");
      throw apiError("Session expirée", "");
    }
    return res;
  }).catch(err => {
    if (err && err.name === "AbortError") {
      throw apiError("Délai dépassé sans réponse de l'API",
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

    // b25 — 1) Supabase (lectures, auth principale) 2) Apps Script (écritures).
    // Même email + même mot de passe des deux côtés pendant la transition.
    SB.login(email, pwd)
      .then(() => apiCall("login", { email, password: pwd }, false).catch(err => ({ success: false, error: err.message })))
      .then(res => {
        if (res && res.success) Session.save(res.token, res.email);
        else { Session.save("", email); console.warn("[RefereeTracker] Apps Script refuse la connexion (écritures indisponibles) : " + (res && res.error)); }
        document.getElementById("rtPwd").value = "";
        hideLogin();
        startApp();
        if (!(res && res.success)) setTimeout(() => { try { setStatus("Lecture OK (Supabase) · écritures indisponibles : mot de passe Apps Script différent", "error"); } catch (e) {} }, 1500);
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
var Couts = { prix: [], entretien: [] };   // carburant & entretien par périodes (serveur)

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
      </div>
      <input id="pfUsure" type="hidden" value="${esc(t.usure_km)}">
      <p class="rt-help">L'entretien du véhicule (€/km) se règle dans « Carburant &amp; entretien » ci-dessous, par période.</p>
      <button type="button" class="rt-btn" id="pfSaveTarifs">Enregistrer</button>
    </section>

    <section class="rt-sect">
      <h3>Carburant &amp; entretien</h3>
      <p class="rt-help">Chaque ligne s'applique dès sa date. Matchs passés et à venir recalculés à l'enregistrement.</p>
      <details class="rt-details">
        <summary>Carburant : <b>${esc(coutsResume_("prix"))}</b></summary>
        ${coutsListe_("prix")}
        <div class="rt-row">
          <div class="rt-field"><label for="cpDate">À partir du</label>
            <input id="cpDate" type="date"></div>
          <div class="rt-field"><label for="cpPrix">Prix (€/L)</label>
            <input id="cpPrix" type="text" inputmode="decimal" placeholder="2,276"></div>
        </div>
        <button type="button" class="rt-btn" id="cpAddPrix">Ajouter ce prix</button>
      </details>
      <details class="rt-details">
        <summary>Entretien : <b>${esc(coutsResume_("entretien"))}</b></summary>
        ${coutsListe_("entretien")}
        <div class="rt-row">
          <div class="rt-field"><label for="ceDate">À partir du</label>
            <input id="ceDate" type="date"></div>
          <div class="rt-field"><label for="ceAnnuel">Coût annuel (€)</label>
            <input id="ceAnnuel" type="text" inputmode="decimal" placeholder="1500"></div>
          <div class="rt-field"><label for="ceKm">Km par an</label>
            <input id="ceKm" type="text" inputmode="numeric" placeholder="8000"></div>
        </div>
        <button type="button" class="rt-btn" id="ceAdd">Ajouter cet entretien</button>
        <p class="rt-help">€/km = coût annuel / km par an.</p>
      </details>
    </section>

    <section class="rt-sect">
      <h3>Notifications sur cet appareil</h3>
      <p class="rt-help" id="pfPushAide">Nouveau match, annulation, paiement en retard : directement sur ce téléphone.</p>
      <div class="rt-row">
        <button type="button" class="rt-btn" id="pfPushOn">Activer</button>
        <button type="button" class="rt-btn" id="pfPushOff">Désactiver</button>
        <span class="rt-help" id="pfPushEtat" style="margin:0"></span>
      </div>
    </section>

    <section class="rt-sect">
      <h3>Apparence</h3>
      <p class="rt-help">Thème de l'interface — mémorisé sur cet appareil.</p>
      <div class="rt-row">
        <button type="button" class="rt-btn" id="pfThemeClair">Clair</button>
        <button type="button" class="rt-btn" id="pfThemeSombre">Sombre</button>
      </div>
    </section>

    <section class="rt-sect">
      <h3>Signaler un problème</h3>
      <p class="rt-help">Le ticket part dans l'onglet TICKETS du classeur et t'arrive par mail. Un audit complet t'est envoyé chaque lundi matin.</p>
      <div class="rt-row">
        <div class="rt-field"><label for="tkCat">Type</label>
          <select id="tkCat">${["Bug / affichage", "Calcul faux", "Paiement", "Import mail", "Idée d'amélioration", "Autre"].map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="rt-field"><label for="tkGrav">Gravité</label>
          <select id="tkGrav"><option>Gênant</option><option>Bloquant</option><option>Mineur</option></select></div>
      </div>
      <div class="rt-field"><label for="tkDesc">Que se passe-t-il ?</label>
        <textarea id="tkDesc" rows="3" placeholder="Ex. Paiements : le montant à recevoir d'octobre ne correspond pas à l'échéancier"></textarea></div>
      <button type="button" class="rt-btn" id="tkEnvoyer">Envoyer le ticket</button>
      <details class="rt-details" id="tkHist"><summary>Mes tickets</summary><div id="tkListe"><p class="rt-help">Chargement…</p></div></details>
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
  document.getElementById("cpAddPrix").addEventListener("click", addCoutPrix);
  document.getElementById("ceAdd").addEventListener("click", addCoutEntretien);
  document.querySelectorAll("[data-couts-del]").forEach(b => b.addEventListener("click", () => {
    const [type, i] = b.getAttribute("data-couts-del").split(":");
    delCout(type, Number(i));
  }));
  document.getElementById("pfChangePwd").addEventListener("click", changePassword);
  document.getElementById("tkEnvoyer").addEventListener("click", envoyerTicket);
  const th = document.getElementById("tkHist");
  if (th) th.addEventListener("toggle", () => { if (th.open) chargerTickets(); });
  const setTheme = t => {
    if (typeof applyTheme === "function") applyTheme(t);
    else document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("rt-theme", t); } catch (e) { /* stockage indisponible */ }
    toast(t === "dark" ? "Thème sombre activé." : "Thème clair activé.");
  };
  PUSH.lier();
  const tc = document.getElementById("pfThemeClair");
  if (tc) tc.addEventListener("click", () => setTheme("light"));
  const ts = document.getElementById("pfThemeSombre");
  if (ts) ts.addEventListener("click", () => setTheme("dark"));
  body.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => delVehicule(Number(b.dataset.del))));
}

function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ""; }

/* b19 — tickets : contexte technique joint automatiquement (onglet, écran, version). */
function envoyerTicket() {
  const desc = val("tkDesc");
  if (desc.length < 5) { toast("Décris le problème en quelques mots.", true); return; }
  const onglet = (typeof state !== "undefined" && state.activeTab) || "";
  const appareil = [window.innerWidth + "x" + window.innerHeight, (typeof APP_VERSION !== "undefined" ? APP_VERSION : ""), navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 110)].join(" · ");
  const b = document.getElementById("tkEnvoyer"); if (b) b.disabled = true;
  jsonp("ticket.add", { categorie: val("tkCat"), gravite: val("tkGrav"), description: desc, onglet: onglet, appareil: appareil }).then(res => {
    if (!res || !res.success) throw new Error((res && res.error) || "Échec");
    if (!res.data) throw new Error("Apps Script b19 pas encore déployé");
    const d = document.getElementById("tkDesc"); if (d) d.value = "";
    toast("Ticket " + res.data.id + " envoyé.");
    const th = document.getElementById("tkHist"); if (th && th.open) chargerTickets();
  }).catch(err => toast(err.message || "Échec", true)).then(() => { if (b) b.disabled = false; });
}
function chargerTickets() {
  const box = document.getElementById("tkListe");
  if (!box) return;
  jsonp("ticket.list", {}).then(res => {
    if (!res || !res.success || !Array.isArray(res.data)) throw new Error((res && res.error) || "Apps Script b19 pas encore déployé");
    box.innerHTML = res.data.length ? '<ul class="rt-plist">' + res.data.map(t =>
      '<li><span><b>' + esc(t.id) + '</b> · ' + esc(t.categorie) + ' · ' + esc(t.gravite) + ' — ' + esc(t.description.slice(0, 120)) +
      (t.reponse ? '<br><i>' + esc(t.reponse) + '</i>' : '') + '</span><span class="rt-tag">' + esc(t.statut) + '</span></li>').join("") + '</ul>'
      : '<p class="rt-help">Aucun ticket.</p>';
  }).catch(err => { box.innerHTML = '<p class="rt-help">' + esc(err.message) + '</p>'; });
}

function envoyer(action, corps, succes) {
  return jsonp(action, corps).then(res => {
    if (!res || !res.success) throw new Error((res && res.error) || "Échec");
    if (res.config) Profil.config = res.config;
    if (res.profil) Profil.config.profil = res.profil;
    if (res.tarifs) Profil.config.tarifs = res.tarifs;
    if (res.vehicules) Profil.config.vehicules = res.vehicules;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(Profil.config)); } catch (e) {}
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

/* ---- Carburant & entretien par périodes ---- */
function _fr(iso) { const m = String(iso).split("-"); return m.length === 3 ? m[2] + "/" + m[1] + "/" + m[0] : iso; }
function _n(v, d) { return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }); }

function coutsResume_(type) {
  const l = (Couts && Couts[type]) || [];
  if (!l.length) return "barème par défaut";
  const d = l[l.length - 1];
  return type === "prix" ? _n(d.prix, 3) + " €/L" : _n(d.eur_km, 3) + " €/km";
}

function coutsListe_(type) {
  const l = (Couts && Couts[type]) || [];
  if (!l.length) return '<p class="rt-help">Aucune ligne : anciens barèmes appliqués.</p>';
  return '<ul class="rt-plist">' + l.map((p, i) => {
    const txt = type === "prix"
      ? _n(p.prix, 4) + " €/L"
      : (p.annuel ? _n(p.annuel, 0) + " €/an sur " + _n(p.km_an, 0) + " km/an = " : "") + _n(p.eur_km, 4) + " €/km";
    return '<li><span>Depuis le <b>' + esc(_fr(p.depuis)) + '</b> : ' + esc(txt) + '</span>' +
      '<button type="button" class="rt-x" data-couts-del="' + type + ':' + i + '" aria-label="Supprimer">&times;</button></li>';
  }).join("") + '</ul>';
}

function saveCouts_(nouveau, msg) {
  return jsonp("couts.set", { donnees: JSON.stringify(nouveau) }).then(res => {
    if (!res || !res.success) throw new Error((res && res.error) || "Échec");
    Couts = res.couts || nouveau;
    renderProfile();
    toast(res.message || msg);
    if (typeof window.rtCoutsMaj === "function") window.rtCoutsMaj(Couts);
  }).catch(err => toast(err.message || "Échec", true));
}

function _coutsCopie_() { return JSON.parse(JSON.stringify(Couts || { prix: [], entretien: [] })); }

function addCoutPrix() {
  const depuis = val("cpDate"), prix = Number(val("cpPrix").replace(",", "."));
  if (!depuis) return toast("Choisis une date.", true);
  if (!(prix >= 0.5 && prix <= 5)) return toast("Prix invalide (entre 0,50 et 5 €/L).", true);
  const c = _coutsCopie_();
  c.prix = c.prix.filter(p => p.depuis !== depuis).concat([{ depuis, prix }]);
  saveCouts_(c, "Prix enregistré.");
}

function addCoutEntretien() {
  const depuis = val("ceDate");
  const annuel = Number(val("ceAnnuel").replace(",", ".")), km = Number(val("ceKm").replace(",", "."));
  if (!depuis) return toast("Choisis une date.", true);
  if (!(annuel > 0 && km > 0)) return toast("Renseigne le coût annuel et les km par an.", true);
  const c = _coutsCopie_();
  c.entretien = c.entretien.filter(e => e.depuis !== depuis).concat([{ depuis, annuel, km_an: km }]);
  saveCouts_(c, "Entretien enregistré.");
}

function delCout(type, i) {
  const c = _coutsCopie_();
  if (!c[type] || !c[type][i]) return;
  if (!confirm("Supprimer cette ligne ?\n\nLes coûts seront recalculés.")) return;
  c[type].splice(i, 1);
  saveCouts_(c, "Ligne supprimée.");
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

/* Ouverture instantanée : la config est déjà en mémoire (renvoyée par « me »
   au démarrage) ou en cache local. Aucun aller-retour réseau à l'ouverture —
   c'est ce qui rendait le panneau lent, Apps Script mettant 1 à 3 s à répondre.
   On ne va chercher la config que si on ne l'a vraiment nulle part. */
function showProfile() {
  buildProfilePanel();

  if (!Profil.config) {
    try {
      const cache = localStorage.getItem(CFG_KEY);
      if (cache) Profil.config = JSON.parse(cache);
    } catch (e) { /* cache illisible : on ira la chercher */ }
  }

  renderProfile();
  document.getElementById("rtProfile").classList.add("is-visible");

  jsonp("couts.get").then(res => {
    if (res && res.success && res.couts) { Couts = res.couts; renderProfile(); }
  }).catch(() => { /* on garde la dernière valeur connue */ });

  if (!Profil.config) {
    jsonp("settings.get")
      .then(res => {
        if (res && res.success && res.config) {
          Profil.config = res.config;
          try { localStorage.setItem(CFG_KEY, JSON.stringify(res.config)); } catch (e) {}
          renderProfile();
          return;
        }
        // Cas le plus fréquent : Config.gs pas encore déployé côté Apps Script.
        // On le DIT, au lieu de laisser « Chargement… » tourner sans fin.
        profilErreur((res && res.error) || "Réglages indisponibles.");
      })
      .catch(err => profilErreur(err.message || "Serveur injoignable."));
  }
}

/* Message explicite à la place du « Chargement… » perpétuel. */
function profilErreur(message) {
  const body = document.getElementById("rtProfileBody");
  if (!body) return;
  const inconnue = /action inconnue/i.test(message);
  body.innerHTML = `
    <section class="rt-sect">
      <h3>Réglages indisponibles</h3>
      <p class="rt-help">${esc(message)}</p>
      ${inconnue ? `<p class="rt-help">Cela arrive quand <strong>Config.gs</strong> n'est pas
        encore en place, ou qu'un déploiement manque : Apps Script &rarr; Déployer &rarr;
        Gérer les déploiements &rarr; Nouvelle version.</p>` : ""}
      <button type="button" class="rt-btn" id="pfRetry">Réessayer</button>
      <button type="button" class="rt-btn-danger" id="rtLogoutBtn">Se déconnecter</button>
    </section>`;
  document.getElementById("pfRetry").addEventListener("click", () => {
    body.innerHTML = '<p class="rt-loading">Chargement…</p>';
    Profil.config = null;
    showProfile();
  });
  document.getElementById("rtLogoutBtn").addEventListener("click", logout);
}

function hideProfile() {
  const el = document.getElementById("rtProfile");
  if (el) el.classList.remove("is-visible");
}
/* ---------------- b32 — Notifications push (PWA) ----------------
   iPhone : iOS 16.4+, app ajoutée à l'écran d'accueil (Partager → Sur l'écran
   d'accueil), puis « Activer » ici. L'abonnement est stocké dans Supabase
   (table push_subscriptions, RLS) ; l'envoi se fait par la fonction Supabase
   « push » appelée par Apps Script. Clé publique VAPID ci-dessous : publique
   par conception. */
const PUSH_VAPID_PUBLIC = "BH95R5mQR6Wil1xDHQkiyqKPBVWTWQwaZUdqbwnGR5msRmkfjOhIh0mGVaTkP1xFOx8QAYQQ_d6Ln_lt4Eeu8-4";
const PUSH = {
  supporte() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
  standaloneIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches); },
  _b64(s) { const pad = "=".repeat((4 - s.length % 4) % 4); const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); },
  async reg() { return navigator.serviceWorker.register("./sw.js", { scope: "./" }); },
  async etat() {
    if (!this.supporte()) return { ok: false, texte: this.standaloneIos() ? "Ajoute d'abord l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis reviens ici." : "Navigateur sans notifications push." };
    if (this.standaloneIos()) return { ok: false, texte: "Sur iPhone, ouvre l'app depuis l'écran d'accueil pour activer les notifications." };
    try { const r = await navigator.serviceWorker.getRegistration("./"); const sub = r && await r.pushManager.getSubscription(); return { ok: !!sub, texte: sub ? "Activées sur cet appareil." : (Notification.permission === "denied" ? "Refusées dans les réglages du téléphone (Réglages → Notifications → Referee Tracker)." : "Désactivées.") }; } catch (e) { return { ok: false, texte: "" }; }
  },
  async activer() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permission refusée");
    const r = await this.reg(); await navigator.serviceWorker.ready;
    const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this._b64(PUSH_VAPID_PUBLIC) });
    const j = sub.toJSON();
    await SB.write("POST", "push_subscriptions?on_conflict=endpoint", { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: navigator.userAgent.slice(0, 120) }).catch(async err => {
      // doublon : on met à jour les clés
      if (/409|duplicate/i.test(err.message || "")) return SB.write("PATCH", "push_subscriptions?endpoint=eq." + encodeURIComponent(j.endpoint), { p256dh: j.keys.p256dh, auth: j.keys.auth });
      throw err;
    });
    return true;
  },
  async desactiver() {
    const r = await navigator.serviceWorker.getRegistration("./"); const sub = r && await r.pushManager.getSubscription();
    if (sub) { try { await SB.write("DELETE", "push_subscriptions?endpoint=eq." + encodeURIComponent(sub.endpoint)); } catch (e) {} await sub.unsubscribe(); }
    return true;
  },
  lier() {
    const on = document.getElementById("pfPushOn"), off = document.getElementById("pfPushOff"), et = document.getElementById("pfPushEtat");
    if (!on || !off || !et) return;
    const maj = async () => { const e = await this.etat(); et.textContent = e.texte; on.disabled = e.ok; off.disabled = !e.ok; };
    on.addEventListener("click", async () => { on.disabled = true; et.textContent = "Activation…"; try { await this.activer(); } catch (err) { et.textContent = "Impossible : " + err.message; } maj(); });
    off.addEventListener("click", async () => { off.disabled = true; try { await this.desactiver(); } catch (err) {} maj(); });
    maj();
  }
};
// Enregistrement silencieux du service worker (nécessaire pour recevoir les push déjà activés).
if ("serviceWorker" in navigator) window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {}); });

/* ---------------- b35 — Confirmations (annulation reçue par mail) ----------------
   Le robot a reconnu un mail #RT-ANNULATION : il n'annule rien, il crée une
   demande (table confirmations) et envoie un push. Ici on l'affiche et on
   applique la décision. */
const CONFIRM = {
  _vues: {},
  async verifier() {
    if (!SB.actif) return;
    let liste = [];
    try { liste = await SB.get("confirmations?select=*&statut=eq.en_attente&order=id.desc&limit=10"); } catch (e) { return; }
    const c = liste.find(x => !this._vues[x.id]);
    if (c) this.afficher(c);
  },
  afficher(c) {
    this._vues[c.id] = 1;
    document.querySelectorAll(".rt-confirm").forEach(e => e.remove());
    const el = document.createElement("div");
    el.className = "rt-confirm";
    el.innerHTML = `<div class="rt-confirm-card" role="dialog" aria-modal="true">
      <span class="rt-confirm-tag">Annulation reçue par mail</span>
      <h2>Annuler ce match ?</h2>
      <p class="rt-confirm-lib">${esc(c.libelle || c.uid || "")}</p>
      <p class="rt-confirm-aide">Le match passera en « Annulé », l'événement d'agenda sera retiré. Rien n'a encore été modifié.</p>
      <div class="rt-confirm-actions">
        <button type="button" class="rt-btn rt-btn-danger" id="rtConfirmOui">Oui, annuler le match</button>
        <button type="button" class="rt-btn" id="rtConfirmNon">Non, garder le match</button>
      </div>
      <div class="rt-login-msg" id="rtConfirmMsg" role="status"></div>
    </div>`;
    document.body.appendChild(el);
    const msg = el.querySelector("#rtConfirmMsg");
    const decider = async (oui) => {
      el.querySelectorAll("button").forEach(b => b.disabled = true);
      msg.textContent = oui ? "Annulation en cours…" : "C'est noté.";
      try {
        if (oui) {
          const r = await jsonp("mission.annuler", { uid: c.uid });
          if (!r || r.success === false) throw new Error((r && r.error) || "Annulation refusée");
          sbSyncArrierePlan("matchs");
        }
        await SB.write("PATCH", "confirmations?id=eq." + c.id, { statut: oui ? "confirme" : "refuse", decided_at: new Date().toISOString() });
        el.remove();
        try { if (typeof setStatus === "function") setStatus(oui ? "Match annulé" : "Match conservé", "ok"); if (typeof loadData === "function") loadData(); } catch (e) {}
        this.verifier();
      } catch (err) {
        msg.textContent = "Erreur : " + err.message; msg.className = "rt-login-msg is-error";
        el.querySelectorAll("button").forEach(b => b.disabled = false);
      }
    };
    el.querySelector("#rtConfirmOui").addEventListener("click", () => decider(true));
    el.querySelector("#rtConfirmNon").addEventListener("click", () => decider(false));
  }
};

/* ---------------- Démarrage ----------------
   app.js n'appelle plus loadData() au chargement : c'est ici qu'on décide,
   selon la présence d'une session valide, d'ouvrir l'application ou l'écran
   de connexion. */

function startApp() {
  // On affiche AVANT de parler au serveur : `loadData` passe par le cache,
  // donc le contenu est à l'écran immédiatement au lieu d'attendre la réponse
  // de « me » — un aller-retour Apps Script, soit 1 à 5 s d'écran vide.
  //
  // setTimeout(0) est indispensable : rt-auth.js est chargé AVANT app.js, donc
  // son écouteur DOMContentLoaded s'exécute en premier. Sans ce report,
  // loadData() rendrait la liste avant buildSeasonSelect(), alors que
  // state.selectedSeason vaut encore "" — et filterRows ne retiendrait
  // aucune ligne. Le report laisse app.js finir son initialisation.
  setTimeout(function () {
    if (typeof loadData === "function") loadData();
    setTimeout(() => { try { CONFIRM.verifier(); } catch (e) {} }, 1500);   // b35
  }, 0);
  // Retour depuis la notification push : on revérifie quand l'app reprend le premier plan.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { try { CONFIRM.verifier(); } catch (e) {} } });

  // b26 — préchargement discret des lectures Apps Script lentes (QCM, enjeux,
  // classements, config) : les onglets s'ouvrent ensuite sans attente.
  setTimeout(function () {
    ["qcmStats", "enjeux", "classements", "config"].forEach((a, i) => setTimeout(() => { try { jsonp(a).catch(() => {}); } catch (e) {} }, i * 1500));
  }, 4000);
  if (!Session.token) return;   // b25 : session Supabase seule (écritures Apps Script indisponibles)
  jsonp("me")
    .then(res => {
      if (!res || !res.success) throw new Error((res && res.error) || "Session invalide");
      if (res.home && res.home.lat) HOME = res.home;
      Profil.email = res.email || "";
      if (res.config) {
        Profil.config = res.config;
        try { localStorage.setItem(CFG_KEY, JSON.stringify(res.config)); } catch (e) {}
        if (document.getElementById("rtProfile")) renderProfile();
      }
    })
    .catch(() => { /* jsonp a déjà réaffiché l'écran de connexion si besoin */ });
}

document.addEventListener("DOMContentLoaded", () => {
  buildLoginOverlay();
  if (Session.token || SB.actif) startApp();
  else showLogin("");

  const btn = document.getElementById("rtProfileBtn");
  if (btn) btn.addEventListener("click", showProfile);

  const dec = document.getElementById("rtHeaderLogout");
  if (dec) dec.addEventListener("click", logout);
});
