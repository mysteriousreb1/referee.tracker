/* Referee Tracker — interface d'administration « super admin » (b69).
   Accès : compte présent dans la table `admins` + double authentification (TOTP, session aal2).
   Toutes les lectures et écritures passent par l'Edge Function « admin » (clé service côté serveur), qui journalise chaque action.
   Vanilla JS, aucune dépendance. Sections : #dashboard #arbitres #inscriptions #config #tickets #sante #stats. */
"use strict";
(function () {
  const SB_URL = "https://jlstedchnmdteazuqbly.supabase.co";
  const SB_KEY = "sb_publishable_B1w244FrkzbIn-SZ-T_z8w_4HVg9stb";   // clé publique (publiable par conception)
  const STORE = "rt_sb_session";                                       // même session que l'app
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const voir = (id) => ["vLogin", "vMfa", "vAdmin"].forEach((v) => $(v).classList.toggle("hidden", v !== id));
  const fmt = (d) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
  const euro = (n) => (Number(n) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + " %" : "—");
  // b71 — minutes d'utilisation → « 1 h 05 » / « 12 min »
  const minutesTxt = (m) => { m = Number(m) || 0; if (!m) return "—"; if (m < 60) return m + " min"; return Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0"); };
  const depuis = (d) => { if (!d) return "jamais"; const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? "il y a " + Math.round(h * 60) + " min" : h < 48 ? "il y a " + Math.round(h) + " h" : "il y a " + Math.round(h / 24) + " j"; };
  const heures = (d) => (d ? (Date.now() - new Date(d)) / 36e5 : Infinity);
  const nomDe = (p, email) => (p && (p.prenom || p.nom_ffbb)) ? [p.prenom, p.nom_ffbb].filter(Boolean).join(" ") : (email || "—");
  const zonesTxt = (z) => { z = z || {}; return [z.cd, z.ligue, z.cf ? "CF" : ""].filter(Boolean).join(" · ") || "—"; };
  const csv = (lignes, nom) => {
    const t = lignes.map((l) => l.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + t], { type: "text/csv;charset=utf-8" })); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copier = (t) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error("Presse-papiers indisponible"))).then(() => toast("Copié ✓", "ok"), (e) => toast(e.message, "err"));

  // ---------- session / auth (conservé b62) ----------
  const session = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; } };
  const sauver = (s) => { try { localStorage.setItem(STORE, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) })); } catch (e) {} };
  const claims = (t) => { try { let b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "="; return JSON.parse(atob(b)); } catch (e) { return {}; } };
  async function jeton() {
    const s = session();
    if (!s || !s.refresh_token) throw new Error("AUTH_REQUIRED");
    if (s.expires_at - Math.floor(Date.now() / 1000) > 60) return s.access_token;
    const r = await fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    const j = await r.json(); if (!r.ok) throw new Error("AUTH_REQUIRED");
    sauver(j); return j.access_token;
  }
  async function auth(chemin, methode, corps) {
    const t = await jeton();
    const r = await fetch(SB_URL + "/auth/v1/" + chemin, { method: methode || "GET", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Erreur " + r.status);
    return j;
  }
  let enCours = 0;
  async function admin(action, extra) {
    enCours++; $("chargement").classList.remove("hidden");
    try {
      const t = await jeton();
      const r = await fetch(SB_URL + "/functions/v1/admin", { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, extra || {})) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Erreur " + r.status);
      return j;
    } finally { if (--enCours <= 0) { enCours = 0; $("chargement").classList.add("hidden"); } }
  }

  // ---------- double authentification ----------
  let facteur = null;
  async function preparerMfa() {
    const u = await auth("user");
    $("qui").textContent = u.email || "";
    const verifies = (u.factors || []).filter((f) => f.factor_type === "totp" && f.status === "verified");
    if (claims(session().access_token).aal === "aal2") return true;
    voir("vMfa");
    if (verifies.length) { facteur = verifies[0].id; $("mfaEnroll").classList.add("hidden"); }
    else {
      for (const f of (u.factors || []).filter((f) => f.status !== "verified")) { try { await auth("factors/" + f.id, "DELETE"); } catch (e) {} }
      const e = await auth("factors", "POST", { factor_type: "totp", friendly_name: "Admin Referee Tracker" });
      facteur = e.id;
      // b74 — QR généré en local depuis l'URI otpauth (le SVG brut de Supabase ne s'affichait pas dans un <img>).
      let src = "";
      try { const q = qrcode(0, "M"); q.addData(e.totp.uri); q.make(); src = q.createDataURL(6, 12); }
      catch (x) { src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(e.totp.qr_code || "").replace(/^data:image\/svg\+xml;utf-8,/, "")); }
      $("qr").innerHTML = '<img alt="QR code" width="240" height="240" style="background:#fff;padding:8px;border-radius:8px" src="' + esc(src) + '">';
      $("secret").textContent = e.totp.secret;
      $("mfaEnroll").classList.remove("hidden");
      $("mfaTxt").textContent = "Puis saisis le code à 6 chiffres :";
    }
    return false;
  }
  $("btnCode").addEventListener("click", async () => {
    $("mfaMsg").textContent = "";
    try {
      const code = $("code").value.replace(/\D/g, "");
      if (code.length !== 6) throw new Error("6 chiffres attendus");
      const ch = await auth("factors/" + facteur + "/challenge", "POST", {});
      const s = await auth("factors/" + facteur + "/verify", "POST", { challenge_id: ch.id, code });
      sauver(s);
      demarrer();
    } catch (e) { $("mfaMsg").textContent = e.message; }
  });
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnCode").click(); });

  // ---------- UI génériques ----------
  let toastT = null;
  function toast(txt, type) { const t = $("toast"); t.textContent = txt; t.className = "toast " + (type || ""); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 3200); }
  function erreur(e) { const m = $("msg"); m.textContent = e && e.message ? e.message : String(e); m.classList.remove("hidden"); if (/AUTH_REQUIRED/.test(m.textContent)) voir("vLogin"); }
  function effacerMsg() { $("msg").classList.add("hidden"); }
  let dlgAnnuler = null;   // callback d'annulation du dialogue courant (✕ ou Échap)
  function dialogue(titre, html, apres) { dlgAnnuler = null; $("dlgTitre").textContent = titre; $("dlgBody").innerHTML = html; if (!$("dlg").open) $("dlg").showModal(); if (apres) apres($("dlgBody")); }
  const fermerDlg = () => { dlgAnnuler = null; try { $("dlg").close(); } catch (e) {} };
  const annulerDlg = () => { const f = dlgAnnuler; fermerDlg(); if (f) f(); };
  $("dlgClose").addEventListener("click", annulerDlg);
  $("dlg").addEventListener("cancel", (e) => { e.preventDefault(); annulerDlg(); });
  function confirmer(titre, texte, libelle, danger) {
    return new Promise((res) => {
      dialogue(titre, "<p>" + texte + '</p><div class="dlg-actions"><button class="btn" id="cNon">Annuler</button><button class="btn ' + (danger ? "danger" : "pri") + '" id="cOui">' + esc(libelle || "Confirmer") + "</button></div>", (b) => {
        b.querySelector("#cNon").onclick = () => { fermerDlg(); res(false); };
        b.querySelector("#cOui").onclick = () => { fermerDlg(); res(true); };
        dlgAnnuler = () => res(false);
      });
    });
  }
  function saisir(titre, texte, placeholder, valide, libelle) {
    return new Promise((res) => {
      dialogue(titre, "<p>" + texte + '</p><input id="sVal" placeholder="' + esc(placeholder || "") + '" autocomplete="off"><p id="sErr" class="err tiny"></p><div class="dlg-actions"><button class="btn" id="sNon">Annuler</button><button class="btn pri" id="sOui">' + esc(libelle || "Valider") + "</button></div>", (b) => {
        const inp = b.querySelector("#sVal"); inp.focus();
        const go = () => { const v = inp.value.trim(); const err = valide ? valide(v) : null; if (err) { b.querySelector("#sErr").textContent = err; return; } fermerDlg(); res(v); };
        b.querySelector("#sNon").onclick = () => { fermerDlg(); res(null); };
        b.querySelector("#sOui").onclick = go; inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        dlgAnnuler = () => res(null);
      });
    });
  }
  const badge = (txt, cl) => '<span class="badge ' + (cl || "") + '">' + esc(txt) + "</span>";
  const badgeStatut = (s) => ({ actif: badge("actif", "green"), inscrit: badge("inscrit", "orange"), moteur_pret: badge("moteur prêt", "gold"), suspendu: badge("suspendu", "red"),
    attente: badge("attente", "blue"), recue: badge("reçue", "orange"), moteur_cree: badge("moteur créé", "gold"), prete: badge("prête", "green"), erreur: badge("erreur", "red"),
    Ouvert: badge("Ouvert", "red"), "En cours": badge("En cours", "orange"), "Fermé": badge("Fermé", "green") }[s] || badge(s || "—"));
  const ouiNon = (v) => (v ? badge("oui", "green") : badge("non", "gray"));
  const API_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
  const RECEP_RE = /^[a-z0-9._-]+@referee-tracker\.fr$/;

  // Tableau triable + filtrable. cols: [{t: titre, k: clé de tri (fn ou nom), r: rendu(row) → html, cl}] ; rows: objets ; recherche sur texte(row).
  function tableau(cible, cols, rows, opts) {
    opts = opts || {}; let tri = opts.tri || null, sens = opts.sens || 1;
    const texte = opts.texte || ((r) => JSON.stringify(r).toLowerCase());
    const val = (r, c) => (typeof c.k === "function" ? c.k(r) : r[c.k]);
    function rendre() {
      const q = (opts.recherche ? opts.recherche() : "").toLowerCase().trim();
      let l = rows.filter((r) => !q || texte(r).includes(q));
      if (opts.filtre) l = l.filter(opts.filtre);
      if (tri) { const c = cols.find((x) => x.t === tri); if (c) l.sort((a, b) => { const x = val(a, c), y = val(b, c); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr")) * sens; }); }
      cible.innerHTML = '<div class="tbl"><table><thead><tr>' + cols.map((c) => '<th data-tri="' + esc(c.t) + '" class="' + (c.cl || "") + (tri === c.t ? (sens > 0 ? " asc" : " desc") : "") + '">' + esc(c.t) + "</th>").join("") + "</tr></thead><tbody>" +
        (l.length ? l.map((r, i) => '<tr data-i="' + rows.indexOf(r) + '"' + (opts.clic ? ' class="clic"' : "") + ">" + cols.map((c) => '<td class="' + (c.cl || "") + '">' + c.r(r) + "</td>").join("") + "</tr>").join("") : '<tr><td colspan="' + cols.length + '" class="vide">' + esc(opts.vide || "Aucun résultat") + "</td></tr>") +
        "</tbody></table></div>" + '<p class="mut tiny" style="margin:6px 2px 0">' + l.length + " / " + rows.length + " ligne(s)</p>";
      cible.querySelectorAll("th[data-tri]").forEach((th) => th.addEventListener("click", () => { if (tri === th.dataset.tri) sens = -sens; else { tri = th.dataset.tri; sens = 1; } rendre(); }));
      if (opts.clic) cible.querySelectorAll("tr.clic").forEach((tr) => tr.addEventListener("click", (ev) => { if (ev.target.closest("button,a")) return; opts.clic(rows[Number(tr.dataset.i)]); }));
      if (opts.action) cible.querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => opts.action(b.dataset.act, rows[Number(b.closest("tr").dataset.i)], b)));
    }
    rendre(); return { rendre };
  }
  function barres(serie, cl) { // [{l: libellé, v: valeur}] → barres verticales CSS
    const max = Math.max(1, ...serie.map((s) => s.v));
    return '<div class="bars">' + serie.map((s) => '<div class="b ' + (cl || "") + '"><b>' + esc(s.v) + '</b><i style="height:' + Math.max(2, Math.round((s.v / max) * 100)) + '%"></i><span>' + esc(s.l) + "</span></div>").join("") + "</div>";
  }
  function hbarres(serie, fmtV, cl) { // barres horizontales
    const max = Math.max(1, ...serie.map((s) => s.v));
    return '<div class="hbars">' + serie.map((s) => '<span class="lbl" title="' + esc(s.l) + '">' + esc(s.l) + '</span><span class="trk"><i class="' + (s.cl || cl || "") + '" style="width:' + Math.round((s.v / max) * 100) + '%"></i></span><span class="val">' + esc(fmtV ? fmtV(s.v) : s.v) + "</span>").join("") + "</div>";
  }
  function moisLbl(ym) { const [y, m] = ym.split("-"); return ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"][Number(m) - 1] + " " + y.slice(2); }

  // ---------- navigation ----------
  const SECTIONS = { pilotage: "Pilotage", dashboard: "Tableau de bord", arbitres: "Arbitres", inscriptions: "Inscriptions", messages: "Messages", config: "Configuration", tickets: "Tickets", sante: "Santé", stats: "Statistiques" };
  const cache = {}; let courant = null;
  const rendus = {};
  async function naviguer(force) {
    const h = (location.hash || "#pilotage").slice(1).split("/"); const sec = SECTIONS[h[0]] ? h[0] : "pilotage";
    courant = sec; effacerMsg();
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.sec === sec));
    document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("active", s.id === "sec-" + sec));
    $("topTitre").textContent = SECTIONS[sec];
    $("recherche").value = recherches[sec] || "";
    try { await rendus[sec](force, h.slice(1)); } catch (e) { erreur(e); }
  }
  window.addEventListener("hashchange", () => naviguer(false));
  $("btnRefresh").addEventListener("click", () => naviguer(true));
  const recherches = {}; let tableCourante = null;
  $("recherche").addEventListener("input", () => { recherches[courant] = $("recherche").value; if (tableCourante) tableCourante.rendre(); });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("recherche").focus(); $("recherche").select(); } if (e.key === "Escape" && !$("drawer").classList.contains("hidden")) fermerDrawer(); });
  const rechercheCourante = () => $("recherche").value;

  // thème
  const initTheme = () => { try { const t = localStorage.getItem("rt_theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {} };
  $("btnTheme").addEventListener("click", () => { const d = document.documentElement; const sombre = d.dataset.theme === "dark" || (!d.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches); d.dataset.theme = sombre ? "light" : "dark"; try { localStorage.setItem("rt_theme", d.dataset.theme); } catch (e) {} });

  // panneau latéral
  function ouvrirDrawer(titre, html) { $("drawerTitre").textContent = titre; $("drawerBody").innerHTML = html; $("drawer").classList.remove("hidden"); $("voile").classList.remove("hidden"); $("drawer").setAttribute("aria-hidden", "false"); }
  function fermerDrawer() { $("drawer").classList.add("hidden"); $("voile").classList.add("hidden"); $("drawer").setAttribute("aria-hidden", "true"); }
  $("drawerClose").addEventListener("click", fermerDrawer); $("voile").addEventListener("click", fermerDrawer);

  // =====================================================================
  // 1. TABLEAU DE BORD
  // =====================================================================
  rendus.dashboard = async function (force) {
    const el = $("sec-dashboard");
    if (force || !cache.stats) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.stats = await admin("stats"); }
    const s = cache.stats, t = s.tuiles || {};
    const tuile = (v, l, cl, sub, lien) => '<div class="tile ' + cl + (lien ? " clic" : "") + '"' + (lien ? ' data-lien="' + lien + '"' : "") + "><b>" + esc(v) + "</b><span>" + l + "</span>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
    const sante = (s.sante || []).slice();
    const rouge = (x) => x.moteur && heures(x.derniere_synchro) > 48;
    // b77 — « À traiter » : la liste d'actions du jour, cliquable, avant les chiffres.
    const aFaire = [];
    if (t.inscrits_attente) aFaire.push(["orange", t.inscrits_attente + " inscription(s) en attente", "Accepter ou rejeter", "#inscriptions"]);
    if (t.tickets_ouverts) aFaire.push(["red", t.tickets_ouverts + " ticket(s) ouvert(s)", "Répondre (l'arbitre est prévenu)", "#tickets"]);
    const muets = sante.filter(rouge); if (muets.length) aFaire.push(["red", muets.length + " moteur(s) sans synchro depuis 48 h", muets.map((x) => x.prenom || x.email).slice(0, 3).join(", "), "#sante"]);
    if (t.moteurs_prets) aFaire.push(["gold", t.moteurs_prets + " compte(s) prêt(s), jamais connecté(s)", "Renvoyer le code de 1re connexion depuis la fiche", "#arbitres"]);
    // b78e — un arbitre d'un comité / d'une ligue sans barème ni échéancier : dates de paiement seulement estimées.
    try {
      if (!cache.config) cache.config = await admin("config.get");
      if (!cache.arbitres) cache.arbitres = (await admin("arbitres.liste")).data || [];
      const cfgV = (k) => ((cache.config.data || []).find((r) => r.cle === k) || {}).valeur || {};
      const bar = cfgV("pub.baremes"), per = cfgV("pub.periodes_paiement"), sais = Object.values(per);
      const manque = new Set();
      cache.arbitres.filter((a) => (a.profil || {}).statut === "actif" || (a.profil || {}).statut === "inscrit").forEach((a) => { const z = (a.profil || {}).zones || {};
        const cd = String(z.cd || "").toLowerCase(), lg = String(z.ligue || "").toLowerCase();
        if (cd && cd !== "cd67" && (!bar[cd] || !sais.some((x) => x && x[cd]))) manque.add(cd.toUpperCase());
        if (lg && lg !== "lrgeb" && !sais.some((x) => x && x[lg])) manque.add(lg.toUpperCase()); });
      // b78f — barèmes saisis par des arbitres (comité inconnu), en attente de validation.
      if (!cache.bp) cache.bp = (await admin("baremes_proposes.liste")).data || [];
      const nbp = cache.bp.filter((x) => x.statut === "a_valider").length;
      if (nbp) aFaire.push(["orange", nbp + " barème(s) proposé(s) par des arbitres", "À vérifier puis valider : Configuration → Barèmes des comités", "#config"]);
      if (manque.size) aFaire.push(["gold", "Barème / échéancier à renseigner : " + [...manque].join(", "), "Sans eux, les dates de paiement de ces arbitres sont estimées. Configuration → Barèmes / Échéanciers", "#config"]);
    } catch (e) {}
    if (t.alertes_non_traitees) aFaire.push(["orange", t.alertes_non_traitees + " alerte(s) non traitée(s)", "Voir dans la fiche de chaque arbitre", "#arbitres"]);
    const aFaireHtml = '<div class="card afaire"><div class="card-head"><h2>À traiter</h2><span class="sub">' + (aFaire.length ? aFaire.length + " point(s)" : "rien en attente") + "</span></div>" +
      (aFaire.length ? '<ul class="afaire-l">' + aFaire.map((a) => '<li class="clic" data-lien="' + a[3] + '"><span class="dot ' + a[0] + '"></span><div><strong>' + esc(a[1]) + '</strong><span class="mut tiny">' + esc(a[2]) + '</span></div><span class="afaire-go">→</span></li>').join("") + "</ul>" : '<p class="vide">Tout est à jour. ✓</p>') + "</div>";
    el.innerHTML = aFaireHtml +
      '<div class="tiles">' +
      tuile(t.arbitres_actifs ?? 0, "Arbitres actifs", "green", (t.comptes ?? 0) + " comptes", "#arbitres") + tuile(t.inscrits_attente ?? 0, "Inscrits en attente", "orange", "", "#inscriptions") +
      tuile(t.moteurs_prets ?? 0, "Moteurs prêts", "gold", "en attente de 1re connexion", "#arbitres") + tuile(t.suspendus ?? 0, "Suspendus", "red", "", "#arbitres") +
      tuile(t.matchs_total ?? 0, "Matchs total", "", (t.matchs_30j ?? 0) + " sur 30 j") + tuile(t.convocations_7j ?? 0, "Convocations 7 j", "", "reçues toutes instances") +
      tuile(t.connexions_7j ?? 0, "Connexions 7 j", "green", "comptes vus") + tuile(t.actifs_7j ?? 0, "Utilisateurs actifs 7 j", "green", (t.minutes_7j ?? 0) >= 60 ? Math.round((t.minutes_7j || 0) / 60) + " h d'utilisation cumulée" : (t.minutes_7j ?? 0) + " min cumulées") + tuile(t.tickets_ouverts ?? 0, "Tickets ouverts", t.tickets_ouverts ? "red" : "gray", "", "#tickets") +
      tuile(t.push_actifs ?? 0, "Appareils push", "", "actifs (< 5 échecs)", "#sante") + tuile(t.alertes_non_traitees ?? 0, "Alertes non traitées", t.alertes_non_traitees ? "orange" : "gray", "warnings hors INFO") +
      "</div>" +
      '<div class="grid-3">' +
      '<div class="card"><div class="card-head"><h2>Matchs reçus par semaine</h2><span class="sub">12 dernières semaines · toutes instances</span></div>' + barres((s.semaines || []).map((w) => ({ l: fmtD(w.debut).slice(0, 5), v: w.n }))) + "</div>" +
      '<div class="card"><div class="card-head"><h2>Derniers événements</h2></div><ul class="events">' + ((s.evenements || []).map((e) => "<li><time>" + fmt(e.at) + "</time><span>" + badge(e.type, { inscription: "gold", ticket: "red", suspension: "red" }[e.type]) + " " + esc(e.libelle) + (e.detail ? ' <span class="err tiny">' + esc(e.detail) + "</span>" : "") + "</span></li>").join("") || '<li class="vide">Rien à signaler</li>') + "</ul></div>" +
      "</div>" +
      '<div class="card"><div class="card-head"><h2>État de santé par arbitre</h2><span class="sub">rouge = moteur prêt mais aucune synchro depuis 48 h</span></div><div id="dashSante"></div></div>';
    el.querySelectorAll(".tile.clic, .afaire-l li.clic").forEach((x) => x.addEventListener("click", () => (location.hash = x.dataset.lien)));
    tableCourante = tableau($("dashSante"), [
      { t: "Arbitre", k: (r) => r.prenom || r.email, r: (r) => '<span class="dot ' + (rouge(r) ? "red" : r.moteur ? "green" : "") + '"></span><strong>' + esc(r.prenom || "—") + '</strong> <span class="mut">' + esc(r.email) + "</span>" },
      { t: "Statut", k: "statut", r: (r) => badgeStatut(r.statut) },
      { t: "Moteur", k: (r) => (r.moteur ? 1 : 0), r: (r) => ouiNon(r.moteur) },
      { t: "Dernier match reçu", k: (r) => r.dernier_match || "", r: (r) => fmt(r.dernier_match) + ' <span class="mut tiny">' + depuis(r.dernier_match) + "</span>" },
      { t: "Dernière synchro", k: (r) => r.derniere_synchro || "", r: (r) => '<span class="' + (rouge(r) ? "err" : "") + '">' + fmt(r.derniere_synchro) + ' <span class="tiny">' + depuis(r.derniere_synchro) + "</span></span>" },
      { t: "Convoc. 7 j / 30 j", k: (r) => (r.convocations || {}).j30 || 0, cl: "num right", r: (r) => ((r.convocations || {}).j7 || 0) + " / " + ((r.convocations || {}).j30 || 0) },
      { t: "Utilisation 7 j", k: (r) => (r.usage || {}).minutes_7j || 0, cl: "num right", r: (r) => minutesTxt((r.usage || {}).minutes_7j) + ' <span class="mut tiny">' + ((r.usage || {}).jours_actifs_30j || 0) + " j actifs / 30</span>" },
      { t: "Dernière activité", k: (r) => (r.usage || {}).derniere_activite || "", cl: "nw", r: (r) => esc(depuis((r.usage || {}).derniere_activite)) },
    ], sante, { recherche: rechercheCourante, tri: "Dernière synchro", sens: 1, clic: (r) => (location.hash = "#arbitres/" + r.user_id) });
  };

  // =====================================================================
  // 0. PILOTAGE (b74) — tableau de bord type Power BI (admin-pilotage.js)
  // =====================================================================
  rendus.pilotage = async function (force) {
    const el = $("sec-pilotage");
    if (force || !cache.pilotage) {
      el.innerHTML = '<p class="mut">Chargement…</p>';
      enCours++; $("chargement").classList.remove("hidden");
      try {
        const t = await jeton();
        const r = await fetch(SB_URL + "/functions/v1/admin-pilotage", { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(j.error || "Erreur " + r.status);
        cache.pilotage = j;
      } finally { if (--enCours <= 0) { enCours = 0; $("chargement").classList.add("hidden"); } }
    }
    if (!window.RT_PILOTAGE) throw new Error("Module de pilotage non chargé");
    window.RT_PILOTAGE.render(el, cache.pilotage, { fiche: (u) => (location.hash = "#arbitres/" + u) });
    tableCourante = null;
  };

  // =====================================================================
  // 2. ARBITRES
  // =====================================================================
  let filtreStatut = "";
  rendus.arbitres = async function (force, params) {
    const el = $("sec-arbitres");
    if (force || !cache.arbitres) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.arbitres = (await admin("arbitres.liste")).data || []; }
    const l = cache.arbitres; $("navArbitres").textContent = l.length;
    el.innerHTML = '<div class="toolbar"><span class="pill' + (filtreStatut === "" ? " on" : "") + '" data-f="">Tous</span>' +
      ["actif", "moteur_pret", "inscrit", "suspendu"].map((s) => '<span class="pill' + (filtreStatut === s ? " on" : "") + '" data-f="' + s + '">' + esc(s.replace("_", " ")) + " (" + l.filter((u) => (u.profil || {}).statut === s || (s === "suspendu" && u.banni)).length + ")</span>").join("") +
      '<span class="sp"></span><input id="invEmail" type="email" placeholder="E-mail d\'un nouvel arbitre" style="width:240px"><button class="btn sm" id="btnCreate">Créer sans mail</button><button class="btn sm" id="btnInvite">Inviter</button><button class="btn sm" id="btnCsvArb">CSV</button></div><p class="mut tiny" style="margin:0 0 6px">Clique sur une ligne pour ouvrir la fiche (profil, matchs, alertes, tickets, compte).</p><div id="tblArb"></div>';
    el.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => { filtreStatut = p.dataset.f; rendus.arbitres(false); }));
    const statut = (u) => (u.banni ? "suspendu" : (u.profil || {}).statut || (u.invite ? "inscrit" : "actif"));
    tableCourante = tableau($("tblArb"), [
      { t: "Arbitre", k: (u) => ((u.profil || {}).prenom || "") + " " + ((u.profil || {}).nom_ffbb || ""), cl: "nw", r: (u) => "<strong>" + esc((u.profil || {}).prenom || "—") + "</strong> " + esc((u.profil || {}).nom_ffbb || "") + (u.admin ? " " + badge("admin", "navy") : "") + (u.mfa ? " " + badge("2FA") : "") },
      { t: "E-mail", k: "email", cl: "nw", r: (u) => '<span class="ellip" title="' + esc(u.email) + '">' + esc(u.email) + "</span>" },
      { t: "Réception", k: (u) => (u.profil || {}).adresse_reception || "", cl: "nw", r: (u) => { const a = (u.profil || {}).adresse_reception; return a ? '<span class="mono" title="' + esc(a) + '">' + esc(a.split("@")[0]) + '<span class="mut">@…</span></span>' : "—"; } },
      { t: "Statut", k: statut, r: (u) => badgeStatut(statut(u)) },
      { t: "Niveau", k: (u) => (u.profil || {}).niveau || "", r: (u) => esc((u.profil || {}).niveau || "—") },
      { t: "Zones", k: (u) => zonesTxt((u.profil || {}).zones), cl: "nw", r: (u) => esc(zonesTxt((u.profil || {}).zones)) },
      { t: "Moteur", k: (u) => ((u.profil || {}).api_url ? 1 : 0), r: (u) => ouiNon((u.profil || {}).api_url) },
      { t: "Connexion", k: (u) => u.derniere_connexion || "", cl: "nw", r: (u) => '<span title="' + esc(fmt(u.derniere_connexion)) + '">' + esc(depuis(u.derniere_connexion)) + "</span>" },
      { t: "Matchs", k: "matchs", cl: "num right", r: (u) => u.matchs },
      { t: "Convoc. 7/30 j", k: (u) => (u.convocations || {}).j30 || 0, cl: "num right", r: (u) => ((u.convocations || {}).j7 || 0) + " / " + ((u.convocations || {}).j30 || 0) },
      { t: "Usage 7 j", k: (u) => (u.usage || {}).minutes_7j || 0, cl: "num right", r: (u) => minutesTxt((u.usage || {}).minutes_7j) },
      { t: "Synchro", k: (u) => u.derniere_synchro || "", cl: "nw", r: (u) => '<span class="' + ((u.profil || {}).api_url && heures(u.derniere_synchro) > 48 ? "err" : "") + '" title="' + esc(fmt(u.derniere_synchro)) + '">' + esc(depuis(u.derniere_synchro)) + "</span>" },
      { t: "Push", k: (u) => (u.push || {}).n || 0, r: (u) => (u.push && u.push.n ? badge(u.push.n + " app." + (u.push.echecs ? " · " + u.push.echecs + " éch." : ""), u.push.echecs ? "orange" : "green") : badge("—", "gray")) },
      { t: "CGU", k: (u) => (u.consentement || {}).version || "", r: (u) => (u.consentement ? badge("✓ " + u.consentement.version.slice(2), "green") : badge("non", "red")) },
      { t: "Offres", k: (u) => (comm(u).offres ? 1 : 0) + (comm(u).whatsapp ? 1 : 0), r: (u) => (comm(u).offres ? badge("e-mail", "green") : badge("non", "gray")) + (comm(u).whatsapp ? " " + badge("WhatsApp", "green") : "") },
    ], l, { recherche: rechercheCourante, tri: "Arbitre", filtre: (u) => !filtreStatut || statut(u) === filtreStatut, clic: (u) => ouvrirFiche(u.id),
      texte: (u) => [u.email, (u.profil || {}).prenom, (u.profil || {}).nom_ffbb, (u.profil || {}).adresse_reception, (u.profil || {}).niveau, zonesTxt((u.profil || {}).zones), statut(u)].join(" ").toLowerCase() });
    $("btnCsvArb").addEventListener("click", () => csv([["prenom", "nom_ffbb", "email", "adresse_reception", "statut", "niveau", "zones", "moteur", "derniere_connexion", "matchs", "derniere_synchro", "push", "cgu"]].concat(l.map((u) => { const p = u.profil || {}; return [p.prenom, p.nom_ffbb, u.email, p.adresse_reception, statut(u), p.niveau, zonesTxt(p.zones), p.api_url ? "oui" : "non", u.derniere_connexion, u.matchs, u.derniere_synchro, (u.push || {}).n || 0, (u.consentement || {}).version]; })), "arbitres.csv"));
    $("btnInvite").addEventListener("click", async () => {
      const email = $("invEmail").value.trim(); if (!email) return toast("Saisis un e-mail", "err");
      if (!(await confirmer("Inviter", "Envoyer une invitation (mail immédiat) à <strong>" + esc(email) + "</strong> ?", "Inviter"))) return;
      try { await admin("user.inviter", { email }); toast("Invitation envoyée", "ok"); rendus.arbitres(true); } catch (e) { erreur(e); }
    });
    $("btnCreate").addEventListener("click", async () => {
      const email = $("invEmail").value.trim(); if (!email) return toast("Saisis un e-mail", "err");
      if (!(await confirmer("Créer sans mail", "Créer le compte <strong>" + esc(email) + "</strong> SANS envoyer de mail ? Tu enverras le lien mot de passe depuis sa fiche.", "Créer"))) return;
      try { await admin("user.creer", { email }); toast("Compte créé, aucun mail envoyé", "ok"); rendus.arbitres(true); } catch (e) { erreur(e); }
    });
    if (params && params[0] && /^[0-9a-f-]{36}$/i.test(params[0])) { history.replaceState(null, "", "#arbitres"); ouvrirFiche(params[0]); }
  };

  // ---- fiche arbitre (panneau latéral) ----
  async function ouvrirFiche(userId, saison) {
    ouvrirDrawer("Fiche arbitre", '<p class="mut">Chargement…</p>');
    let f; try { f = await admin("arbitre.fiche", { user_id: userId, saison: saison || undefined }); } catch (e) { $("drawerBody").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; return; }
    const p = f.profil || {}, u = f.user || {}, z = p.zones || {}, fn = p.fonctions || {};
    $("drawerTitre").textContent = nomDe(p, u.email) + " — " + u.email;
    const nonTraitees = f.alertes ? f.alertes.non_traitees : 0;
    const matchsHtml = (f.matchs || []).length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Rencontre</th><th>Rôle</th><th class="right">Indemnité</th><th>Paiement</th><th>Alertes</th></tr></thead><tbody>' +
      f.matchs.map((m) => "<tr><td>" + esc(m.date_match) + ' <span class="mut tiny">' + esc(m.heure_rdv || "") + "</span></td><td>" + esc(m.libelle_competition || "") + '<br><span class="mut">' + esc(m.recevant || "") + " – " + esc(m.visiteur_evenement || "") + "</span></td><td>" + esc(m.mon_role || "") + '</td><td class="num right">' + esc(m.indemnite_totale != null ? m.indemnite_totale + " €" : "—") + "</td><td>" + badge(m.statut_paiement || "—", { "Reçu": "green", "Bénévole": "gray", "En attente": "orange", "En retard": "red" }[m.statut_paiement] || "") + '</td><td class="warn tiny">' + esc([m.warning_general, m.warning_finance, m.warning_fbi].filter((w) => w && !/^\s*INFO\s*:/i.test(w)).join(" · ")) + (m.alerte_traitee_sig ? " " + badge("traitée", "green") : "") + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="vide">Aucun match</p>';
    const alertesHtml = f.alertes && f.alertes.total ? hbarres(Object.entries(f.alertes.par_type).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: k, v })), null, "red") + '<p class="mut tiny" style="margin-top:8px">' + f.alertes.total + " alerte(s) au total · " + nonTraitees + " non traitée(s)</p>" : '<p class="vide">Aucune alerte</p>';
    const ticketsHtml = (f.tickets || []).length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Type</th><th>Gravité</th><th>Description</th><th>Statut</th></tr></thead><tbody>' + f.tickets.map((t) => "<tr><td>" + fmt(t.created_at) + "</td><td>" + esc(t.categorie) + "</td><td>" + esc(t.gravite) + "</td><td>" + esc((t.description || "").slice(0, 160)) + (t.reponse ? '<br><i class="mut">↳ ' + esc(t.reponse.slice(0, 160)) + "</i>" : "") + "</td><td>" + badgeStatut(t.statut || "Ouvert") + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="vide">Aucun ticket</p>';
    const sel = (id, lab, opts, val) => '<label class="f">' + lab + '<select id="' + id + '">' + opts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select></label>";
    const inp = (id, lab, val, ph, type) => '<label class="f">' + lab + '<input id="' + id + '" type="' + (type || "text") + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></label>';
    const chk = (id, lab, val) => '<label class="chk"><input type="checkbox" id="' + id + '"' + (val ? " checked" : "") + ">" + lab + "</label>";
    $("drawerBody").innerHTML =
      '<div class="row" style="margin-bottom:10px">' + badgeStatut(u.banni ? "suspendu" : p.statut || "actif") + (u.mfa ? badge("2FA", "green") : badge("sans 2FA", "gray")) + (u.invite ? badge("invitation non confirmée", "orange") : "") +
        badge("créé " + fmtD(u.cree)) + badge("vu " + depuis(u.derniere_connexion)) + badge((f.evaluations || 0) + " évaluation(s)") + (f.consentements && f.consentements.length ? badge("CGU " + f.consentements[0].version, "green") : badge("CGU non acceptées", "red")) +
        (f.push || []).map((x) => badge("push " + (x.appareil || "appareil") + (x.echecs ? " · " + x.echecs + " éch." : ""), x.echecs >= 3 ? "orange" : "green")).join("") +
        (nonTraitees ? badge(nonTraitees + " alerte(s) non traitée(s)", "orange") : "") + "</div>" +
      '<div class="row" style="margin-bottom:12px"><button class="btn sm" id="fLien">Lien mot de passe</button><button class="btn sm" id="fCode">Régénérer le code 1re connexion</button>' +
        '<button class="btn sm" id="fSusp">' + (u.banni ? "Réactiver" : "Suspendre") + "</button>" + '<button class="btn sm" id="fPing">Tester le moteur</button><span id="fPingRes" class="mut tiny"></span></div>' +
      '<div class="tabs"><button class="on" data-tab="profil">Profil</button><button data-tab="matchs">Matchs (' + (f.matchs || []).length + ')</button><button data-tab="alertes">Alertes (' + (f.alertes ? f.alertes.total : 0) + ')</button><button data-tab="tickets">Tickets (' + (f.tickets || []).length + ")</button><button data-tab=\"notes\">Notes & message</button><button data-tab=\"danger\">Compte</button></div>" +
      '<div class="tabpane on" data-pane="profil"><div class="card"><div class="form-grid">' +
        inp("pPrenom", "Prénom", p.prenom) + inp("pNom", "Nom officiel", p.nom_ffbb) + inp("pEmailF", "E-mail fédération", p.email_ffbb, "", "email") + inp("pTel", "Téléphone", p.telephone) + inp("pNiveau", "Niveau", p.niveau, "ex. Départemental, Région, CF") +
        sel("pStatut", "Statut", [["inscrit", "inscrit"], ["moteur_pret", "moteur prêt"], ["actif", "actif"], ["suspendu", "suspendu"]], p.statut || "inscrit") +
        inp("pCd", "Zone CD", z.cd, "CD67") + inp("pLigue", "Ligue", z.ligue, "LRGEB") + '<label class="f">Championnat de France<span style="padding-top:8px">' + chk("pCf", "Oui", z.cf) + "</span></label>" +
        inp("pRecep", "Adresse de réception", p.adresse_reception, "prenom@referee-tracker.fr") + '</div><label class="f" style="margin-top:10px">URL du moteur (Apps Script /exec)<input id="pApi" value="' + esc(p.api_url || "") + '" placeholder="https://script.google.com/macros/s/…/exec" class="mono"></label>' +
        '<div class="subtab">Fonctions activées</div><div class="row">' + ["ia", "evaluations", "elicence", "classements"].map((k) => chk("fn_" + k, k, fn[k])).join("") + "</div>" +
        '<div class="row" style="margin-top:12px"><button class="btn pri" id="pSave">Enregistrer le profil</button><span id="pMsg" class="mut"></span></div></div>' +
        (f.inscription ? '<div class="card"><div class="card-head"><h3>Inscription</h3>' + badgeStatut(f.inscription.statut) + "</div><dl class=\"kv\"><dt>Date</dt><dd>" + fmt(f.inscription.created_at) + "</dd><dt>Fichiers</dt><dd>" + (Array.isArray(f.inscription.fichiers) ? f.inscription.fichiers.length : 0) + (f.inscription.fichiers_ok ? " ✓" : "") + "</dd><dt>Erreur</dt><dd class=\"err\">" + esc(f.inscription.erreur || "—") + "</dd><dt>Traitée le</dt><dd>" + fmt(f.inscription.traite_le) + "</dd></dl></div>" : "") +
        '<dl class="kv card"><dt>Identifiant</dt><dd class="mono">' + esc(u.id) + "</dd><dt>Code 1re connexion</dt><dd>" + (p.code_premiere_utilise ? badge("utilisé", "green") : p.code_premiere_expire ? badge("expire " + fmt(p.code_premiere_expire), new Date(p.code_premiere_expire) < new Date() ? "red" : "gold") : badge("aucun", "gray")) + "</dd><dt>Onboarding</dt><dd>" + ouiNon(p.onboarding_fait) + "</dd><dt>E-mail connexion</dt><dd>" + esc(p.email_connexion || u.email) + "</dd><dt>Fournisseur mail</dt><dd>" + esc(p.fournisseur_mail || "—") + "</dd></dl></div>" +
      '<div class="tabpane" data-pane="matchs"><div class="toolbar"><span class="mut">50 derniers · lecture seule (consultation journalisée)</span><span class="sp"></span><select id="fSaison"><option value="">Toutes saisons</option>' + (f.saisons || []).map((s) => '<option value="' + esc(s) + '"' + (s === saison ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" + matchsHtml + "</div>" +
      '<div class="tabpane" data-pane="alertes"><div class="card">' + alertesHtml + "</div></div>" +
      '<div class="tabpane" data-pane="tickets">' + ticketsHtml + '<p style="margin-top:8px"><a href="#tickets/' + esc(u.id) + '" id="fTickets">Ouvrir dans Tickets →</a></p></div>' +
      '<div class="tabpane" data-pane="notes"><div class="grid-2"><div class="card"><div class="card-head"><h3>Notes internes</h3><span class="sub">visibles par toi seul · jamais par l\'arbitre</span></div>' +
        '<div class="row"><select id="nCat"><option value="retour">Retour client</option><option value="demande">Demande</option><option value="bug">Bug</option><option value="suivi" selected>Suivi</option><option value="autre">Autre</option></select></div><textarea id="nTxt" rows="3" placeholder="Ex. : souhaite un export par mois ; a signalé un écart sur un match du 12/10…" style="width:100%;margin-top:8px;font-family:inherit"></textarea><div class="row" style="margin-top:8px"><button class="btn pri sm" id="nAdd">Ajouter la note</button></div><div id="nListe" style="margin-top:12px"><p class="mut">Chargement…</p></div></div>' +
        '<div class="card"><div class="card-head"><h3>Écrire à cet arbitre</h3><span class="sub">e-mail au design Referee Tracker et/ou notification</span></div>' +
        '<label class="f">Sujet<input id="mSujet" maxlength="120" placeholder="Ex. : Ton écart du 12/10 est corrigé"></label><label class="f" style="margin-top:8px">Message<textarea id="mTxt" rows="6" style="font-family:inherit" placeholder="Le message commence automatiquement par « Bonjour Prénom, »."></textarea></label>' +
        '<div class="row" style="margin-top:8px"><select id="mCanal"><option value="les2">E-mail + notification</option><option value="mail">E-mail seulement</option><option value="push">Notification seulement</option></select><button class="btn pri sm" id="mEnv">Envoyer</button>' + (waNum(p.telephone) ? '<button class="btn sm wa-btn" id="mWa" title="' + esc(p.telephone) + '">WhatsApp</button>' : '<span class="mut tiny">WhatsApp : aucun numéro</span>') + '<button class="btn sm" id="mStop" title="L\'arbitre a répondu STOP ou ne veut plus de nouveautés">Retirer des offres (STOP)</button><span class="mut tiny" id="mStopEtat">' + (((p.communications || {}).offres === true) ? "offres : oui" : "offres : non") + " · WhatsApp : " + (((p.communications || {}).whatsapp === true) ? "oui" : "non") + '</span></div></div></div></div>' +
      '<div class="tabpane" data-pane="danger"><div class="card danger-zone"><h3>Supprimer le compte</h3><p>Supprime définitivement : matchs, évaluations, tickets, appareils push, consentements, profil, inscription, fichiers Storage import/, puis le compte de connexion. Irréversible.</p><button class="btn danger" id="fSuppr">Supprimer le compte…</button></div></div>';
    const body = $("drawerBody");
    body.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { body.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b)); body.querySelectorAll(".tabpane").forEach((x) => x.classList.toggle("on", x.dataset.pane === b.dataset.tab)); }));
    body.querySelector("#fSaison").addEventListener("change", (e) => ouvrirFiche(userId, e.target.value));
    // b77 — notes internes + message direct
    const CAT_NOTE = { retour: ["Retour client", "gold"], demande: ["Demande", "blue"], bug: ["Bug", "red"], suivi: ["Suivi", "gray"], autre: ["Autre", "gray"] };
    async function chargerNotes() {
      const z = body.querySelector("#nListe"); if (!z) return;
      try { const j = await admin("notes.liste", { user_id: userId }); const l = j.data || [];
        z.innerHTML = l.length ? '<ul class="notes">' + l.map((n) => '<li><div class="row">' + badge((CAT_NOTE[n.categorie] || [n.categorie])[0], (CAT_NOTE[n.categorie] || [0, ""])[1]) + '<time class="mut tiny">' + fmt(n.cree) + '</time><span class="sp"></span><button class="btn sm" data-note="' + n.id + '">Supprimer</button></div><p>' + esc(n.texte).replace(/\n/g, "<br>") + "</p></li>").join("") + "</ul>" : '<p class="vide">Aucune note pour l\'instant.</p>';
        z.querySelectorAll("[data-note]").forEach((x) => x.addEventListener("click", async () => { if (!(await confirmer("Supprimer la note", "Supprimer définitivement cette note ?", "Supprimer", true))) return; try { await admin("note.supprimer", { id: Number(x.dataset.note) }); chargerNotes(); } catch (e) { toast(e.message, "err"); } }));
      } catch (e) { z.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
    }
    chargerNotes();
    body.querySelector("#nAdd").addEventListener("click", async () => { const t = body.querySelector("#nTxt").value.trim(); if (t.length < 2) return toast("Note vide", "err"); try { await admin("note.ajouter", { user_id: userId, texte: t, categorie: body.querySelector("#nCat").value }); body.querySelector("#nTxt").value = ""; toast("Note ajoutée", "ok"); chargerNotes(); } catch (e) { toast(e.message, "err"); } });
    { const st = body.querySelector("#mStop"); if (st) st.addEventListener("click", async () => { if (!(await confirmer("Retirer des nouveautés et offres", "Plus aucun message promotionnel (e-mail et WhatsApp) ne sera envoyé à " + esc(p.prenom || "cet arbitre") + ". Les informations de service continuent. Il pourra se réinscrire depuis Mon profil.", "Retirer"))) return;
      try { await admin("communications.retirer", { user_id: userId, canal: "tout" }); body.querySelector("#mStopEtat").textContent = "offres : non · WhatsApp : non"; p.communications = { ...(p.communications || {}), offres: false, whatsapp: false }; cache.arbitres = null; toast("Retiré : plus de nouveautés ni d'offres", "ok"); } catch (e) { toast(e.message, "err"); } }); }
    { const w = body.querySelector("#mWa"); if (w) w.addEventListener("click", () => { const sujet = body.querySelector("#mSujet").value.trim(), texte = body.querySelector("#mTxt").value.trim(); window.open(waLien(p.telephone, "Bonjour " + (p.prenom || "") + ",\n\n" + (sujet ? "*" + sujet + "*\n\n" : "") + texte + "\n\n— Referee Tracker"), "_blank", "noopener"); }); }
    body.querySelector("#mEnv").addEventListener("click", async () => {
      const sujet = body.querySelector("#mSujet").value.trim(), texte = body.querySelector("#mTxt").value.trim(), canal = body.querySelector("#mCanal").value;
      if (sujet.length < 3 || texte.length < 3) return toast("Sujet et message obligatoires", "err");
      if (!(await confirmer("Envoyer le message", "Envoyer « " + esc(sujet) + " » à <strong>" + esc(nomDe(p, u.email)) + "</strong> ?", "Envoyer"))) return;
      try { const j = await admin("message.envoyer", { cible: userId, sujet, texte, canal }); toast("Envoyé · " + j.mails + " e-mail · " + j.pushs + " notification", "ok"); body.querySelector("#mTxt").value = ""; } catch (e) { toast(e.message, "err"); }
    });
    body.querySelector("#fTickets").addEventListener("click", fermerDrawer);
    body.querySelector("#pSave").addEventListener("click", async () => {
      const v = (id) => body.querySelector("#" + id).value.trim(); const msg = body.querySelector("#pMsg");
      const api = v("pApi"), recep = v("pRecep").toLowerCase();
      if (api && !API_RE.test(api)) { msg.textContent = "URL du moteur invalide (https://script.google.com/macros/s/…/exec)"; msg.className = "err"; return; }
      if (recep && !RECEP_RE.test(recep)) { msg.textContent = "Adresse de réception invalide (…@referee-tracker.fr)"; msg.className = "err"; return; }
      const fonctions = {}; ["ia", "evaluations", "elicence", "classements"].forEach((k) => (fonctions[k] = body.querySelector("#fn_" + k).checked));
      msg.textContent = "Enregistrement…"; msg.className = "mut";
      try {
        await admin("profil.set", { user_id: userId, prenom: v("pPrenom"), nom_ffbb: v("pNom"), email_ffbb: v("pEmailF"), telephone: v("pTel"), niveau: v("pNiveau"), statut: v("pStatut"), zones: { cd: v("pCd"), ligue: v("pLigue"), cf: body.querySelector("#pCf").checked }, adresse_reception: recep, api_url: api, fonctions });
        msg.textContent = "Enregistré ✓"; msg.className = "ok"; toast("Profil enregistré", "ok"); cache.arbitres = null; cache.stats = null; if (courant === "arbitres") rendus.arbitres(true);
      } catch (e) { msg.textContent = e.message; msg.className = "err"; }
    });
    body.querySelector("#fLien").addEventListener("click", async () => { if (!(await confirmer("Lien mot de passe", "Envoyer à <strong>" + esc(u.email) + "</strong> le mail « définis ton mot de passe » ?", "Envoyer"))) return; try { await admin("user.lien", { user_id: userId }); toast("Lien envoyé", "ok"); } catch (e) { toast(e.message, "err"); } });
    body.querySelector("#fCode").addEventListener("click", async () => { if (!(await confirmer("Code de première connexion", "Régénérer le code (l'ancien devient invalide) et l'envoyer par mail à <strong>" + esc(p.email_connexion || u.email) + "</strong> ?", "Régénérer et envoyer"))) return; try { await admin("code.regenerer", { user_id: userId }); toast("Code envoyé", "ok"); ouvrirFiche(userId, saison); } catch (e) { toast(e.message, "err"); } });
    body.querySelector("#fSusp").addEventListener("click", async () => { const s = !u.banni; if (!(await confirmer(s ? "Suspendre" : "Réactiver", (s ? "Suspendre l'accès de " : "Réactiver ") + "<strong>" + esc(u.email) + "</strong> ?", s ? "Suspendre" : "Réactiver", s))) return; try { await admin(s ? "user.suspendre" : "user.reactiver", { user_id: userId }); toast(s ? "Compte suspendu" : "Compte réactivé", "ok"); cache.arbitres = null; cache.stats = null; ouvrirFiche(userId, saison); if (courant === "arbitres") rendus.arbitres(true); } catch (e) { toast(e.message, "err"); } });
    body.querySelector("#fPing").addEventListener("click", async () => { const r = body.querySelector("#fPingRes"); r.textContent = "Test en cours…"; try { const j = await admin("sante.ping", { user_id: userId }); r.innerHTML = j.ping ? badge("OK · " + j.latence_ms + " ms", "green") : badge("KO · HTTP " + (j.http || "—") + " · " + (j.detail || "") , "red"); } catch (e) { r.innerHTML = badge(e.message, "red"); } });
    body.querySelector("#fSuppr").addEventListener("click", async () => {
      const attendu = "SUPPRIMER " + (p.prenom || u.email || "").trim();
      if (!(await confirmer("Supprimer le compte", "Tu vas supprimer <strong>" + esc(nomDe(p, u.email)) + "</strong> (" + esc(u.email) + ") et <u>toutes</u> ses données. Cette action est irréversible et journalisée.", "Continuer", true))) return;
      const v = await saisir("Confirmation finale", "Saisis exactement <code>" + esc(attendu) + "</code> pour confirmer.", attendu, (x) => (x === attendu ? null : "Texte incorrect"), "Supprimer définitivement");
      if (v == null) return;
      try { const j = await admin("user.supprimer", { user_id: userId, confirmation: v }); toast("Compte supprimé", "ok"); fermerDrawer(); cache.arbitres = null; cache.stats = null; cache.inscriptions = null; dialogue("Compte supprimé", '<pre class="code">' + esc(JSON.stringify(j.supprime || {}, null, 1)) + "</pre>"); if (courant === "arbitres") rendus.arbitres(true); } catch (e) { toast(e.message, "err"); }
    });
  }

  // =====================================================================
  // 3. INSCRIPTIONS
  // =====================================================================
  let filtreInsc = "";
  rendus.inscriptions = async function (force) {
    const el = $("sec-inscriptions");
    if (force || !cache.inscriptions) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.inscriptions = (await admin("inscriptions.liste")).data || []; }
    const l = cache.inscriptions; $("navInscriptions").textContent = l.filter((i) => i.statut === "recue" || i.statut === "erreur" || i.statut === "attente").length || "";
    el.innerHTML = '<div class="toolbar"><span class="pill' + (!filtreInsc ? " on" : "") + '" data-f="">Toutes (' + l.length + ")</span>" + ["attente", "recue", "moteur_cree", "prete", "erreur"].map((s) => '<span class="pill' + (filtreInsc === s ? " on" : "") + '" data-f="' + s + '">' + esc(s.replace("_", " ")) + " (" + l.filter((i) => i.statut === s).length + ")</span>").join("") +
      '<span class="sp"></span><button class="btn sm" id="btnCmdFile">Copier la commande file d\'attente</button><button class="btn sm" id="btnCsvInsc">Export CSV</button></div>' +
      '<p class="mut tiny">Places : <code>pub.beta</code> (Configuration) — au-delà de <em>max</em>, les demandes arrivent en « attente » et tu les acceptes ici une par une. Parcours : inscription reçue → <code>zsh rt-beta.sh --file-attente</code> crée le moteur → « Marquer moteur créé » (api_url) → « Envoyer le code » (statut prête). Une erreur de route Cloudflare se lève avec « Route faite ».</p><div id="tblInsc"></div>';
    el.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => { filtreInsc = p.dataset.f; rendus.inscriptions(false); }));
    $("btnCmdFile").addEventListener("click", () => copier("zsh rt-beta.sh --file-attente"));
    $("btnCsvInsc").addEventListener("click", () => csv([["date", "email", "prenom", "nom_ffbb", "zones", "niveau", "fichiers", "fichiers_ok", "statut", "erreur", "api_url", "adresse_reception"]].concat(l.map((i) => [i.created_at, i.email, i.prenom, i.nom_ffbb, zonesTxt(i.zones), i.niveau, i.fichiers, i.fichiers_ok ? "oui" : "non", i.statut, i.erreur, i.api_url, i.adresse_reception])), "inscriptions.csv"));
    tableCourante = tableau($("tblInsc"), [
      { t: "Date", k: "created_at", r: (i) => fmt(i.created_at) },
      { t: "E-mail", k: "email", r: (i) => '<span class="ellip" title="' + esc(i.email) + '">' + esc(i.email) + "</span>" },
      { t: "Prénom", k: "prenom", r: (i) => "<strong>" + esc(i.prenom || "—") + "</strong>" },
      { t: "Nom officiel", k: "nom_ffbb", r: (i) => esc(i.nom_ffbb || "—") },
      { t: "Zones", k: (i) => zonesTxt(i.zones), cl: "nw", r: (i) => esc(zonesTxt(i.zones)) },
      { t: "Fichiers", k: "fichiers", cl: "right", r: (i) => '<span class="num">' + i.fichiers + "</span> " + (i.fichiers_ok ? badge("ok", "green") : i.fichiers ? badge("à vérifier", "orange") : "") },
      { t: "Statut", k: "statut", r: (i) => badgeStatut(i.statut) + (i.api_url ? " " + badge("moteur", "green") : "") },
      { t: "Erreur", k: "erreur", r: (i) => '<span class="err tiny">' + esc(i.erreur || "") + "</span>" },
      { t: "", cl: "actions", r: (i) => (i.statut === "attente" ? '<button class="btn sm pri" data-act="accepter">Accepter</button>' : '<button class="btn sm" data-act="cmd" title="Commande + JSON">Commande</button>') + (i.statut !== "prete" ? '<button class="btn sm" data-act="moteur">Moteur créé</button>' : "") + (i.user_id ? '<button class="btn sm" data-act="code">Envoyer le code</button>' : "") + (i.erreur ? '<button class="btn sm" data-act="route">Route faite</button>' : "") + (i.statut !== "erreur" ? '<button class="btn sm danger" data-act="rejeter">Rejeter</button>' : "") + (i.user_id ? '<button class="btn sm" data-act="fiche">Fiche</button>' : "") },
    ], l, { recherche: rechercheCourante, tri: "Date", sens: -1, filtre: (i) => !filtreInsc || i.statut === filtreInsc, texte: (i) => [i.email, i.prenom, i.nom_ffbb, i.statut, i.erreur, zonesTxt(i.zones)].join(" ").toLowerCase(),
      action: async (act, i) => {
        try {
          if (act === "cmd") {
            const json = JSON.stringify({ id: i.id, user_id: i.user_id, email: i.email, prenom: i.prenom, nom_ffbb: i.nom_ffbb, zones: i.zones, niveau: i.niveau, fournisseur_mail: i.fournisseur_mail, adresse_reception: i.adresse_reception, fichiers: i.fichiers });
            dialogue("Commande de provisionnement — " + i.email, '<p>Dans le terminal (dossier du script) :</p><pre class="code">zsh rt-beta.sh --file-attente</pre><p>Ligne d\'inscription :</p><pre class="code">' + esc(json) + '</pre><div class="dlg-actions"><button class="btn" id="cp1">Copier la commande</button><button class="btn pri" id="cp2">Copier le JSON</button></div>', (b) => { b.querySelector("#cp1").onclick = () => copier("zsh rt-beta.sh --file-attente"); b.querySelector("#cp2").onclick = () => copier(json); });
          } else if (act === "moteur") {
            const api = await saisir("Marquer le moteur créé", "URL /exec du moteur Apps Script de <strong>" + esc(i.prenom || i.email) + "</strong> :", "https://script.google.com/macros/s/…/exec", (v) => (API_RE.test(v) ? null : "Format attendu : https://script.google.com/macros/s/<id>/exec"), "Enregistrer");
            if (!api) return; await admin("inscription.moteur", { id: i.id, api_url: api }); toast("Moteur enregistré (profil moteur_pret)", "ok"); cache.inscriptions = null; cache.arbitres = null; rendus.inscriptions(true);
          } else if (act === "code") {
            if (!(await confirmer("Envoyer le code", "Générer et envoyer le code de première connexion à <strong>" + esc(i.email) + "</strong> ? L'inscription passera en « prête ».", "Envoyer"))) return;
            await admin("code.regenerer", { user_id: i.user_id }); toast("Code envoyé", "ok"); cache.inscriptions = null; rendus.inscriptions(true);
          } else if (act === "route") {
            if (!(await confirmer("Route Cloudflare manuelle", "Confirmer que la route e-mail Cloudflare de <strong>" + esc(i.adresse_reception || i.email) + "</strong> a été créée à la main ? L'erreur sera effacée.", "Route faite"))) return;
            await admin("inscription.route_ok", { id: i.id }); toast("Erreur effacée", "ok"); cache.inscriptions = null; rendus.inscriptions(true);
          } else if (act === "rejeter") {
            const motif = await saisir("Rejeter l'inscription", "Motif (facultatif) du rejet de <strong>" + esc(i.email) + "</strong>. Le compte n'est pas supprimé (voir sa fiche pour cela).", "Doublon, demande invalide…", null, "Rejeter");
            if (motif === null) return; await admin("inscription.rejeter", { id: i.id, motif }); toast("Inscription rejetée", "ok"); cache.inscriptions = null; rendus.inscriptions(true);
          } else if (act === "accepter") {
            if (!(await confirmer("Accepter la demande", "Créer le compte de <strong>" + esc(i.email) + "</strong> (adresse de réception, route, mail « nous configurons ton compte ») ? Elle passera dans la file « reçue ».", "Accepter"))) return;
            await admin("inscription.accepter", { id: i.id }); toast("Demande acceptée : compte créé", "ok"); cache.inscriptions = null; cache.arbitres = null; rendus.inscriptions(true);
          } else if (act === "fiche") ouvrirFiche(i.user_id);
        } catch (e) { toast(e.message, "err"); }
      } });
  };

  // =====================================================================
  // 4. CONFIGURATION
  // =====================================================================
  const CFG = {
    "pub.baremes": { titre: "Barèmes des comités", desc: "Un barème par comité (CD67, CD75…) : part fixe par catégorie (désigné, QR, interdép., amicaux) · appliqué par les moteurs sous 10 min" },
    "pub.periodes_paiement": { titre: "Échéanciers de paiement", desc: "Par comité et par ligue, par saison · appliqué sous 10 min" },
    "pub.ia": { titre: "IA", desc: "Plafond mensuel et répartition par fonction · appliqué sous 10 min" },
    "pub.textes": { titre: "Bandeau & maintenance", desc: "Message affiché à tous, mode maintenance · immédiat" },
    "pub.beta": { titre: "Bêta", desc: "Inscriptions ouvertes, nombre maximal" },
    "pub.carburant": { titre: "Carburant", desc: "Prix relevé autour du domicile de chaque arbitre (rayon, fraîcheur, carburant) · prix imposé par mois · appliqué sous 10 min" },
    "pub.fonctions_defaut": { titre: "Fonctions par défaut (info)", desc: "Non utilisé pour l'instant" },
  };
  let cfgCle = "pub.baremes";
  rendus.config = async function (force) {
    const el = $("sec-config");
    if (force || !cache.config) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.config = await admin("config.get"); }
    const c = cache.config, rows = c.data || [], hist = c.historique || {};
    const ligne = rows.find((r) => r.cle === cfgCle) || { cle: cfgCle, valeur: {} };
    el.innerHTML = '<div class="cfg-grid"><div class="cfg-list">' + Object.keys(CFG).map((k) => '<button data-k="' + k + '" class="' + (k === cfgCle ? "on" : "") + '">' + esc(CFG[k].titre) + "<small>" + esc(CFG[k].desc) + "</small>" + (rows.find((r) => r.cle === k) ? "" : '<small class="warn">non initialisée (exécuter 22_admin.sql)</small>') + "</button>").join("") + "</div>" +
      '<div><div class="card"><div class="card-head"><h2>' + esc(CFG[cfgCle].titre) + '</h2><span class="sub mono">' + esc(cfgCle) + "</span><span class=\"sub\">maj " + fmt(ligne.maj_le) + '</span></div><div id="cfgForm"></div>' +
      '<div class="subtab">JSON brut</div><textarea id="cfgJson" rows="10"></textarea><p id="cfgErr" class="err tiny"></p><div class="row"><button class="btn" id="cfgFormToJson">Formulaire → JSON</button><button class="btn pri" id="cfgSave">Enregistrer</button><span class="mut tiny">Le formulaire et le JSON décrivent la même valeur ; le JSON fait foi à l\'enregistrement.</span></div></div>' +
      '<div class="card"><div class="card-head"><h3>Historique (10 dernières valeurs)</h3></div>' + ((hist[cfgCle] || []).length ? '<div class="tbl"><table><thead><tr><th>Remplacée le</th><th>Valeur précédente</th><th></th></tr></thead><tbody>' + hist[cfgCle].map((h, i) => "<tr><td>" + fmt(h.maj_le) + '</td><td class="mono tiny">' + esc(JSON.stringify(h.valeur).slice(0, 180)) + '</td><td><button class="btn sm" data-h="' + i + '">Restaurer dans l\'éditeur</button></td></tr>').join("") + "</tbody></table></div>" : '<p class="vide">Aucune modification enregistrée</p>') + "</div></div></div>";
    el.querySelectorAll(".cfg-list button").forEach((b) => b.addEventListener("click", () => { cfgCle = b.dataset.k; rendus.config(false); }));
    const ta = $("cfgJson"); ta.value = JSON.stringify(ligne.valeur, null, 2);
    el.querySelectorAll("button[data-h]").forEach((b) => b.addEventListener("click", () => { ta.value = JSON.stringify(hist[cfgCle][Number(b.dataset.h)].valeur, null, 2); formulaire(JSON.parse(ta.value)); toast("Valeur chargée dans l'éditeur (non enregistrée)", ""); }));
    const lireJson = () => { try { const v = JSON.parse(ta.value); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Un objet JSON { … } est attendu"); $("cfgErr").textContent = ""; return v; } catch (e) { $("cfgErr").textContent = "JSON invalide : " + e.message; return null; } };
    // ---- formulaires dédiés ----
    const F = $("cfgForm"); let lireForm = () => lireJson();
    const num = (id, lab, v, step) => '<label class="f">' + lab + '<input type="number" step="' + (step || "0.01") + '" id="' + id + '" value="' + esc(v == null ? "" : v) + '"></label>';
    const kv = (id, titre, obj, ph) => '<div class="subtab">' + titre + '</div><div class="liste-edit" id="' + id + '">' + Object.entries(obj || {}).map(([k, v]) => '<div class="row"><input value="' + esc(k) + '" placeholder="' + esc(ph) + '"><input type="number" step="any" value="' + esc(v) + '" style="max-width:110px"><button class="btn sm" data-del>✕</button></div>').join("") + '</div><button class="btn sm" data-add="' + id + '">+ Ajouter</button>';
    const lireKv = (id) => { const o = {}; F.querySelectorAll("#" + id + " .row").forEach((r) => { const [k, v] = r.querySelectorAll("input"); if (k.value.trim()) o[k.value.trim()] = Number(v.value) || 0; }); return o; };
    const periodes = (id, titre, arr) => '<div class="subtab">' + titre + ' (début · fin · paiement le)</div><div class="liste-edit" id="' + id + '">' + (arr || []).map((p) => '<div class="row"><input type="date" value="' + esc(p.debut) + '"><input type="date" value="' + esc(p.fin) + '"><input type="date" value="' + esc(p.paiement_le) + '"><button class="btn sm" data-del>✕</button></div>').join("") + '</div><button class="btn sm" data-addp="' + id + '">+ Période</button>';
    const lirePeriodes = (id) => Array.from(F.querySelectorAll("#" + id + " .row")).map((r) => { const [a, b, c] = r.querySelectorAll("input"); return { debut: a.value, fin: b.value, paiement_le: c.value }; }).filter((p) => p.debut && p.fin);
    const chk = (id, lab, v) => '<label class="chk"><input type="checkbox" id="' + id + '"' + (v ? " checked" : "") + ">" + lab + "</label>";
    function formulaire(v) {
      v = v || {};
      if (cfgCle === "pub.baremes") {
        // b78e — un barème PAR COMITÉ (clé « cd67 », « cd75 »…) : part fixe en € par catégorie ; le km (A/R × 0,40 €) s'ajoute toujours.
        const cles = Object.keys(v).filter((k) => /^cd/i.test(k) && v[k] && typeof v[k] === "object");
        if (!cles.length) cles.push("cd67");
        if (!formulaire._cd || cles.indexOf(formulaire._cd) < 0) formulaire._cd = cles[0];
        const k = formulaire._cd, c = v[k] || {};
        F.innerHTML = '<div class="row" style="align-items:flex-end;gap:8px;flex-wrap:wrap"><label class="f">Comité<select id="bCd">' + cles.map((x) => '<option value="' + esc(x) + '"' + (x === k ? " selected" : "") + ">" + esc(x.toUpperCase()) + "</option>").join("") + '</select></label><label class="f">Ajouter un comité<input id="bCdNew" placeholder="CD75" style="max-width:110px"></label><button class="btn sm" id="bCdAdd">+ Ajouter</button></div>' +
          '<p class="mut tiny">Indemnité d\'un match départemental = part fixe ci-dessous + km A/R × 0,40 €. Une catégorie absente : on garde le montant écrit sur la convocation' + (k === "cd67" ? " (pour le CD67, la valeur du code)" : "") + '.</p>' +
          kv("bDe", "Officiel désigné (catégorie → €)", c.designe, "Catégorie") + kv("bQr", "Jeunes qualification région, code -5 (catégorie → €)", c.qr, "Catégorie") +
          kv("bIn", "Interdépartemental, code -7 (catégorie → €)", c.interdepartemental, "Catégorie") + kv("bAm", "Amicaux / tournois (Séniors, Jeunes → €)", c.amicaux, "Séniors ou Jeunes");
        // b78f — propositions des arbitres (comités sans barème connu) : déjà utilisées par leur moteur, à valider ici.
        const bpHtml = (l) => '<div class="subtab">Barèmes proposés par les arbitres</div>' + (!l.length ? '<p class="vide">Aucune proposition</p>' : '<div class="tbl"><table><thead><tr><th>Arbitre</th><th>Comité · ligue</th><th>Part fixe (€)</th><th>Délais (j)</th><th>Statut</th><th></th></tr></thead><tbody>' + l.map((x) => '<tr><td>' + esc(((x.profil || {}).prenom || "") + " " + ((x.profil || {}).nom_ffbb || "")) + '<br><span class="mut tiny">' + fmt(x.maj) + '</span></td><td>' + esc(String(x.cd || "—").toUpperCase() + " · " + String(x.ligue || "—").toUpperCase()) + '</td><td class="tiny">' + esc(Object.entries(x.parts || {}).map(([c, m]) => c + " " + m).join(" · ") || "—") + (x.commentaire ? '<br><span class="mut">« ' + esc(x.commentaire) + ' »</span>' : "") + '</td><td class="tiny">comité ' + esc(x.delai_cd ?? "—") + " · ligue " + esc(x.delai_ligue ?? "—") + '</td><td>' + ({ a_valider: '<span class="badge orange">à valider</span>', valide: '<span class="badge green">validé</span>', rejete: '<span class="badge red">refusé</span>' }[x.statut] || esc(x.statut)) + '</td><td>' + (x.statut === "a_valider" ? '<button class="btn sm pri" data-bpv="' + x.id + '">Valider</button> <button class="btn sm" data-bpr="' + x.id + '">Refuser</button>' : "") + "</td></tr>").join("") + "</tbody></table></div>" + '<p class="mut tiny">Valider copie la part fixe et les délais dans ce barème (les valeurs déjà saisies ici priment). Refuser : le moteur de l\'arbitre repasse au montant de la convocation, sinon km seuls.</p>');
        const bpBox = document.createElement("div"); bpBox.id = "bpBox"; bpBox.innerHTML = '<p class="mut tiny">Chargement des propositions…</p>';
        setTimeout(async () => { F.appendChild(bpBox);
          try { if (!cache.bp) cache.bp = (await admin("baremes_proposes.liste")).data || []; bpBox.innerHTML = bpHtml(cache.bp); } catch (e) { bpBox.innerHTML = '<p class="err tiny">' + esc(e.message) + "</p>"; }
          bpBox.addEventListener("click", async (ev) => { const bt = ev.target.closest("[data-bpv],[data-bpr]"); if (!bt) return; const id = Number(bt.dataset.bpv || bt.dataset.bpr), statut = bt.dataset.bpv ? "valide" : "rejete";
            if (statut === "valide" && !confirm("Copier ce barème dans la configuration ?")) return;
            bt.disabled = true; try { await admin("bareme_propose.statut", { id, statut }); cache.bp = null; cache.config = null; cache.stats = null; toast(statut === "valide" ? "Barème validé et copié" : "Proposition refusée", "ok"); rendus.config(true); } catch (e) { bt.disabled = false; toast(e.message, "err"); } }); }, 0);
        lireForm = () => Object.assign({}, v, { indemnite_km: v.indemnite_km ?? 0.4, [k]: { designe: lireKv("bDe"), qr: lireKv("bQr"), interdepartemental: lireKv("bIn"), amicaux: lireKv("bAm") } });
        setTimeout(() => {
          const sel = F.querySelector("#bCd"); if (sel) sel.addEventListener("change", () => { const o = lireForm(); formulaire._cd = sel.value; formulaire(o); });
          const add = F.querySelector("#bCdAdd"); if (add) add.addEventListener("click", () => { const n = F.querySelector("#bCdNew").value.trim().toLowerCase(); if (!/^cd\d{2,3}[ab]?$/.test(n)) return toast("Format attendu : CD75, CD2A…", "err"); const o = lireForm(); o[n] = o[n] || { designe: {}, qr: {}, interdepartemental: {}, amicaux: {} }; formulaire._cd = n; formulaire(o); });
        }, 0);
      } else if (cfgCle === "pub.periodes_paiement") {
        // b74 — { "2026/2027": { cd67: [[début, fin, paiement]], lrgeb: [[début, fin, à partir du]], lrgeb_marge_jours } } (dates JJ/MM/AAAA).
        const saisons = Object.keys(v).filter((s) => /^\d{4}\/\d{4}$/.test(s)).sort();
        const iso = (d) => { const m = String(d || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + "-" + m[2] + "-" + m[1] : ""; };
        const fr = (d) => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; };
        const bloc = (id, titre, l, lib3) => '<div class="subtab">' + titre + ' (début · fin · ' + lib3 + ')</div><div class="liste-edit" id="' + id + '">' + (l || []).map((p) => '<div class="row"><input type="date" value="' + esc(iso(p[0])) + '"><input type="date" value="' + esc(iso(p[1])) + '"><input type="date" value="' + esc(iso(p[2])) + '"><button class="btn sm" data-del>✕</button></div>').join("") + '</div><button class="btn sm" data-addp="' + id + '">+ Période</button>';
        // b78e — par saison : un bloc par comité (« cd.. » : date de paiement) et par ligue (date « à partir du » + marge de virement).
        const zonesDe = (o) => Object.keys(o || {}).filter((z) => !/_marge_jours$/.test(z) && Array.isArray(o[z]));
        F.innerHTML = '<p class="mut tiny">Une saison renseignée ici remplace celle écrite dans le moteur (CD67 et LRGEB). Pour un autre comité ou une autre ligue, ajoute son code (CD75, LIDF…) : il s\'appliquera aux arbitres qui l\'ont choisi.</p>' + saisons.map((s, i) => { const zs = zonesDe(v[s]); if (!zs.length) zs.push("cd67", "lrgeb");
          return '<div class="card" data-saison="' + esc(s) + '" data-zones="' + esc(zs.join(",")) + '"><div class="card-head"><h3>Saison ' + esc(s) + "</h3></div>" + zs.map((z, j) => /^cd/.test(z)
            ? bloc("p" + i + "_" + j, "Comité " + z.toUpperCase() + " — date de paiement", v[s][z], "payé le")
            : bloc("p" + i + "_" + j, "Ligue " + z.toUpperCase() + " — date « à partir du »", v[s][z], "à partir du") + '<div class="form-grid" style="margin-top:6px">' + num("pM" + i + "_" + j, "Ligue " + z.toUpperCase() + " : marge de virement (jours)", v[s][z + "_marge_jours"] ?? 7, "1") + "</div>").join("") +
            '<div class="row" style="margin-top:8px"><input data-zadd="' + i + '" placeholder="CD75 ou LIDF" style="max-width:140px"><button class="btn sm" data-zaddb="' + i + '">+ Comité ou ligue</button></div></div>'; }).join("") +
          '<div class="row"><input id="pNew" placeholder="2027/2028" style="max-width:140px"><button class="btn sm" id="pAddS">+ Ajouter la saison</button></div>';
        const lireP = (id) => Array.from(F.querySelectorAll("#" + id + " .row")).map((r) => Array.from(r.querySelectorAll("input")).map((x) => fr(x.value))).filter((p) => p[0] && p[1] && p[2]);
        lireForm = () => { const o = {}; F.querySelectorAll("[data-saison]").forEach((c, i) => { const r = {}; c.dataset.zones.split(",").forEach((z, j) => { r[z] = lireP("p" + i + "_" + j); if (!/^cd/.test(z)) { const m = F.querySelector("#pM" + i + "_" + j); r[z + "_marge_jours"] = m ? Number(m.value) || 0 : 7; } }); o[c.dataset.saison] = r; }); return o; };
        setTimeout(() => {
          const b = F.querySelector("#pAddS"); if (b) b.addEventListener("click", () => { const s = F.querySelector("#pNew").value.trim(); if (!/^\d{4}\/\d{4}$/.test(s)) return toast("Format attendu : 2027/2028", "err"); const o = lireForm(); o[s] = o[s] || { cd67: [], lrgeb: [], lrgeb_marge_jours: 7 }; formulaire(o); });
          F.querySelectorAll("[data-zaddb]").forEach((bt) => bt.addEventListener("click", () => { const i = bt.dataset.zaddb, n = F.querySelector('[data-zadd="' + i + '"]').value.trim().toLowerCase(); if (!/^[a-z0-9]{2,8}$/.test(n)) return toast("Code attendu : CD75, LIDF…", "err"); const o = lireForm(); const s = F.querySelectorAll("[data-saison]")[Number(i)].dataset.saison; if (!o[s][n]) { o[s][n] = []; if (!/^cd/.test(n)) o[s][n + "_marge_jours"] = 7; } formulaire(o); }));
        }, 0);
      } else if (cfgCle === "pub.carburant") {
        // b79 — relevé automatique local (moteur) : stations à moins de N km, prix de moins de N jours, médiane, 1 relevé par jour → moyenne du mois.
        const carbs = [["e10", "SP95-E10"], ["sp95", "SP95"], ["sp98", "SP98"], ["gazole", "Gazole"], ["e85", "E85"], ["gplc", "GPLc"]];
        F.innerHTML = '<p class="mut tiny">Chaque moteur relève le prix une fois par jour dans les stations proches du domicile de l\'arbitre (open data du ministère de l\'Économie), prend la <b>médiane</b> et en fait la moyenne du mois. Un prix saisi par l\'arbitre dans Mon profil reste prioritaire.</p>' +
          '<div class="form-grid">' + num("cRay", "Rayon autour du domicile (km)", v.rayon_km ?? 10, "1") + num("cFr", "Prix pris en compte s\'ils ont moins de (jours)", v.fraicheur_jours ?? 7, "1") +
          '<label class="f">Carburant<select id="cCarb">' + carbs.map(([k, l]) => '<option value="' + k + '"' + ((v.carburant || "e10") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>" +
          kv("cForce", "Prix imposé à tous pour un mois (AAAA-MM → €/L) — remplace le relevé automatique", v.force, "2026-11") +
          '<p class="mut tiny">Moins de 3 stations dans le rayon : le moteur élargit à 15 puis 25 km.</p>';
        lireForm = () => { const f = lireKv("cForce"), force = {}; Object.keys(f).forEach((k) => { if (/^\d{4}-\d{2}$/.test(k) && f[k] > 0.5 && f[k] < 4) force[k] = f[k]; });
          return { carburant: F.querySelector("#cCarb").value, rayon_km: Math.min(50, Math.max(3, Number(F.querySelector("#cRay").value) || 10)), fraicheur_jours: Math.min(30, Math.max(1, Number(F.querySelector("#cFr").value) || 7)), force }; };
      } else if (cfgCle === "pub.fonctions_defaut") {
        F.innerHTML = '<div class="row">' + ["ia", "evaluations", "elicence", "classements"].map((k) => chk("fd_" + k, k, v[k])).join("") + "</div>";
        lireForm = () => { const o = {}; ["ia", "evaluations", "elicence", "classements"].forEach((k) => (o[k] = F.querySelector("#fd_" + k).checked)); return o; };
      } else if (cfgCle === "pub.ia") {
        // b74 — même structure que le moteur (Ia.gs) : plafond en $ par moteur et par mois, part de chaque fonction en % (total ≤ 100).
        F.innerHTML = '<div class="form-grid">' + num("iaMax", "Plafond mensuel par arbitre (USD)", v.plafond_usd ?? 30) + "</div>" + kv("iaB", "Part du plafond par fonction (%) — convocations, evaluations, reglement, rapports, autre", v.budget_pct, "Fonction") + '<p class="mut tiny">Les convocations ne sont jamais bloquées, même au-delà de leur part.</p>';
        lireForm = () => ({ plafond_usd: Number(F.querySelector("#iaMax").value) || 0, budget_pct: lireKv("iaB") });
      } else if (cfgCle === "pub.beta") {
        F.innerHTML = '<div class="form-grid">' + num("btMax", "Nombre maximal de testeurs", v.max ?? 10, "1") + '</div><div class="row">' + chk("btOuv", "Inscriptions ouvertes", v.ouvert) + "</div>";
        lireForm = () => ({ max: Number(F.querySelector("#btMax").value) || 0, ouvert: F.querySelector("#btOuv").checked });
      } else if (cfgCle === "pub.textes") {
        F.innerHTML = '<label class="f">Message du bandeau global (vide = aucun)<textarea id="tBand" rows="3" style="font-family:inherit">' + esc(v.bandeau || "") + "</textarea></label><div class=\"row\" style=\"margin-top:8px\">" + chk("tMaint", "Mode maintenance (l'app affiche un écran d'attente)", v.maintenance) + "</div>";
        lireForm = () => ({ bandeau: F.querySelector("#tBand").value.trim(), maintenance: F.querySelector("#tMaint").checked });
      } else { F.innerHTML = ""; lireForm = () => lireJson(); }
      F.querySelectorAll("button[data-add]").forEach((b) => b.addEventListener("click", () => F.querySelector("#" + b.dataset.add).insertAdjacentHTML("beforeend", '<div class="row"><input placeholder="Niveau"><input type="number" step="any" value="0" style="max-width:110px"><button class="btn sm" data-del>✕</button></div>')));
      F.querySelectorAll("button[data-addp]").forEach((b) => b.addEventListener("click", () => F.querySelector("#" + b.dataset.addp).insertAdjacentHTML("beforeend", '<div class="row"><input type="date"><input type="date"><input type="date"><button class="btn sm" data-del>✕</button></div>')));
      F.addEventListener("click", (e) => { const d = e.target.closest("button[data-del]"); if (d) d.closest(".row").remove(); });
    }
    formulaire(ligne.valeur);
    ta.addEventListener("change", () => { const v = lireJson(); if (v) formulaire(v); });
    $("cfgFormToJson").addEventListener("click", () => { const v = lireForm(); if (v) { ta.value = JSON.stringify(v, null, 2); $("cfgErr").textContent = ""; } });
    $("cfgSave").addEventListener("click", async () => {
      const fromForm = lireForm(); const v = ta.value.trim() ? lireJson() : fromForm; if (!v) return;
      if (JSON.stringify(v) !== JSON.stringify(fromForm) && !(await confirmer("Enregistrer la configuration", "Le JSON brut diffère du formulaire : c'est le <strong>JSON</strong> qui sera enregistré. Continuer ?", "Enregistrer"))) return;
      else if (JSON.stringify(v) === JSON.stringify(fromForm) && !(await confirmer("Enregistrer la configuration", "Enregistrer <code>" + esc(cfgCle) + "</code> ? La valeur actuelle est conservée dans l'historique et l'app lira la nouvelle immédiatement.", "Enregistrer"))) return;
      try { await admin("config.set", { cle: cfgCle, valeur: v }); toast("Configuration enregistrée", "ok"); cache.config = null; rendus.config(true); } catch (e) { toast(e.message, "err"); }
    });
  };

  // =====================================================================
  // 5. TICKETS
  // =====================================================================
  let filtreTk = "", filtreTkUser = "";
  rendus.tickets = async function (force, params) {
    const el = $("sec-tickets");
    if (params && params[0]) { filtreTkUser = params[0]; history.replaceState(null, "", "#tickets"); }
    if (force || !cache.tickets) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.tickets = (await admin("tickets.liste")).data || []; }
    if (!cache.arbitres) { try { cache.arbitres = (await admin("arbitres.liste")).data || []; } catch (e) { cache.arbitres = []; } }
    const l = cache.tickets, arb = (id) => cache.arbitres.find((a) => a.id === id);
    $("navTickets").textContent = l.filter((t) => t.statut !== "Fermé").length || "";
    el.innerHTML = '<div class="toolbar"><span class="pill' + (!filtreTk ? " on" : "") + '" data-f="">Tous (' + l.length + ")</span>" + ["Ouvert", "En cours", "Fermé"].map((s) => '<span class="pill' + (filtreTk === s ? " on" : "") + '" data-f="' + s + '">' + s + " (" + l.filter((t) => (t.statut || "Ouvert") === s).length + ")</span>").join("") +
      '<select id="tkUser"><option value="">Tous les arbitres</option>' + cache.arbitres.map((a) => '<option value="' + a.id + '"' + (a.id === filtreTkUser ? " selected" : "") + ">" + esc(nomDe(a.profil, a.email)) + "</option>").join("") + '</select><span class="sp"></span><button class="btn sm" id="btnCsvTk">CSV</button></div><div id="tblTk"></div>';
    el.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => { filtreTk = p.dataset.f; rendus.tickets(false); }));
    $("tkUser").addEventListener("change", (e) => { filtreTkUser = e.target.value; rendus.tickets(false); });
    $("btnCsvTk").addEventListener("click", () => csv([["date", "arbitre", "categorie", "gravite", "onglet", "description", "statut", "reponse"]].concat(l.map((t) => { const a = arb(t.user_id); return [t.created_at, a ? nomDe(a.profil, a.email) : t.user_id, t.categorie, t.gravite, t.onglet, t.description, t.statut, t.reponse]; })), "tickets.csv"));
    const grav = (g) => badge(g || "—", /bloquant|critique|haute/i.test(g || "") ? "red" : /moyen|gênant/i.test(g || "") ? "orange" : "");
    tableCourante = tableau($("tblTk"), [
      { t: "Date", k: "created_at", r: (t) => fmt(t.created_at) + (t.id_ref ? '<br><span class="mono mut tiny">' + esc(t.id_ref) + "</span>" : "") },
      { t: "Arbitre", k: (t) => { const a = arb(t.user_id); return a ? nomDe(a.profil, a.email) : t.user_id; }, r: (t) => { const a = arb(t.user_id); return a ? '<a href="#arbitres/' + a.id + '">' + esc(nomDe(a.profil, a.email)) + "</a>" : '<span class="mono tiny">' + esc(t.user_id) + "</span>"; } },
      { t: "Type", k: "categorie", r: (t) => esc(t.categorie || "—") + (t.onglet ? '<br><span class="mut tiny">' + esc(t.onglet) + "</span>" : "") },
      { t: "Gravité", k: "gravite", r: (t) => grav(t.gravite) },
      { t: "Description", r: (t) => "<div style=\"max-width:380px;white-space:pre-wrap\">" + esc(t.description || "") + "</div>" + (t.appareil ? '<span class="mut tiny">' + esc(t.appareil) + "</span>" : "") },
      { t: "Réponse", r: (t) => (t.reponse ? '<div style="max-width:300px;white-space:pre-wrap"><i>' + esc(t.reponse) + "</i></div>" : '<span class="mut">—</span>') },
      { t: "Statut", k: (t) => t.statut || "Ouvert", r: (t) => badgeStatut(t.statut || "Ouvert") },
      { t: "", cl: "actions", r: (t) => '<button class="btn sm pri" data-act="rep">Répondre</button>' + (t.statut !== "Fermé" ? '<button class="btn sm" data-act="fermer">Fermer</button>' : '<button class="btn sm" data-act="rouvrir">Rouvrir</button>') },
    ], l, { recherche: rechercheCourante, tri: "Date", sens: -1, filtre: (t) => (!filtreTk || (t.statut || "Ouvert") === filtreTk) && (!filtreTkUser || t.user_id === filtreTkUser), texte: (t) => { const a = arb(t.user_id); return [t.categorie, t.gravite, t.description, t.reponse, t.statut, a && nomDe(a.profil, a.email)].join(" ").toLowerCase(); },
      action: async (act, t) => {
        try {
          if (act === "rep") {
            dialogue("Répondre au ticket #" + t.id, '<p class="mut">' + esc(t.categorie || "") + " · " + esc(t.gravite || "") + "</p><p style=\"white-space:pre-wrap\">" + esc(t.description || "") + '</p><label class="f">Réponse (visible par l\'arbitre dans l\'app)<textarea id="tkRep" rows="5" style="font-family:inherit">' + esc(t.reponse || "") + '</textarea></label><label class="f" style="margin-top:8px">Statut<select id="tkSt">' + ["Ouvert", "En cours", "Fermé"].map((s) => '<option' + ((t.reponse ? t.statut : "En cours") === s ? " selected" : "") + ">" + s + "</option>").join("") + '</select></label><label class="chk" style="margin-top:10px"><input type="checkbox" id="tkNotif" checked>Prévenir l\'arbitre (e-mail + notification)</label><div class="dlg-actions"><button class="btn" id="tkNon">Annuler</button><button class="btn pri" id="tkOui">Enregistrer</button></div>', (b) => {
              b.querySelector("#tkNon").onclick = fermerDlg;
              b.querySelector("#tkOui").onclick = async () => { try { const j = await admin("ticket.repondre", { id: t.id, reponse: b.querySelector("#tkRep").value.trim(), statut: b.querySelector("#tkSt").value, notifier: b.querySelector("#tkNotif").checked }); fermerDlg(); toast("Réponse enregistrée" + (j.prevenu && (j.prevenu.mail || j.prevenu.push) ? " · arbitre prévenu" + (j.prevenu.mail ? " par e-mail" : "") + (j.prevenu.push ? (j.prevenu.mail ? " et" : "") + " par notification" : "") : ""), "ok"); cache.tickets = null; cache.stats = null; rendus.tickets(true); } catch (e) { toast(e.message, "err"); } };
            });
          } else if (act === "fermer" || act === "rouvrir") {
            const st = act === "fermer" ? "Fermé" : "Ouvert";
            if (!(await confirmer(act === "fermer" ? "Fermer le ticket" : "Rouvrir le ticket", "Passer le ticket #" + t.id + " en « " + st + " » ?", st))) return;
            await admin("ticket.repondre", { id: t.id, statut: st }); toast("Ticket " + st.toLowerCase(), "ok"); cache.tickets = null; cache.stats = null; rendus.tickets(true);
          }
        } catch (e) { toast(e.message, "err"); }
      } });
  };

  // =====================================================================
  // b77 — MESSAGES : écrire à un arbitre, aux actifs ou à tous (e-mail au design + notification)
  // =====================================================================
  // b77 — WhatsApp : lien wa.me (ouvre WhatsApp sur le PC ou le téléphone, message pré-rempli, tu n'as plus qu'à envoyer).
  const waNum = (t) => { let d = String(t || "").replace(/[^\d+]/g, ""); if (/^0[1-9]\d{8}$/.test(d)) d = "33" + d.slice(1); d = d.replace(/^\+/, ""); return /^\d{10,15}$/.test(d) ? d : ""; };
  const waLien = (tel, texte) => "https://wa.me/" + waNum(tel) + "?text=" + encodeURIComponent(texte);
  const comm = (a) => (a.profil || {}).communications || {};
  const MODELES_MSG = [
    ["", "— Partir d'un modèle —", ""],
    ["Nouvelle version de l'application", "Une nouvelle version de Referee Tracker est en ligne.\n\nCe qui change :\n- \n- \n\nPour l'avoir tout de suite : ferme puis rouvre l'application (ou touche « Actualiser »)."],
    ["Maintenance prévue", "Une courte maintenance est prévue le JJ/MM de HHhMM à HHhMM.\n\nPendant ce temps, l'application peut être indisponible. Tes convocations reçues pendant la maintenance seront traitées juste après."],
    ["Ton retour a été pris en compte", "Merci pour ton retour. La correction est en ligne depuis aujourd'hui.\n\nDis-nous si tout est bon de ton côté."],
    ["Pense à transférer tes convocations", "Petit rappel : pour que tes matchs arrivent tout seuls dans l'application, vérifie que la règle de transfert de ta messagerie vers ton adresse Referee Tracker est bien active.\n\nBesoin d'aide ? Réponds simplement à ce message."]
  ];
  rendus.messages = async function (force) {
    const el = $("sec-messages");
    if (force || !cache.arbitres) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.arbitres = (await admin("arbitres.liste")).data || []; }
    const l = cache.arbitres.filter((a) => !a.banni);
    const actifs = l.filter((a) => (a.profil || {}).statut === "actif").length;
    el.innerHTML = '<div class="grid-2 msg-grid"><div class="card"><div class="card-head"><h2>Nouveau message</h2><span class="sub">e-mail au design Referee Tracker et/ou notification sur le téléphone</span></div>' +
      '<label class="f">Destinataires<select id="msCible"><option value="actifs">Arbitres actifs (' + actifs + ')</option><option value="tous">Tous les comptes non suspendus (' + l.length + ")</option>" + l.map((a) => '<option value="' + a.id + '">' + esc(nomDe(a.profil, a.email)) + "</option>").join("") + "</select></label>" +
      '<label class="f">Modèle<select id="msModele">' + MODELES_MSG.map((m, i) => '<option value="' + i + '">' + esc(m[1] && i ? m[0] : m[1]) + "</option>").join("") + "</select></label>" +
      '<label class="f">Sujet<input id="msSujet" maxlength="120" placeholder="Ex. : Nouvelle version de l\'application"></label>' +
      '<label class="f">Message<textarea id="msTxt" rows="9" style="font-family:inherit" placeholder="Commence automatiquement par « Bonjour Prénom, »."></textarea></label>' +
      '<label class="f">Type<select id="msType"><option value="service">Information de service (nouvelle version, maintenance, compte) · tous les destinataires</option><option value="promo">Promotion / nouveautés commerciales · sauf ceux qui s\'y sont opposés</option></select></label>' +
      '<label class="f">Canal<select id="msCanal"><option value="les2">E-mail + notification</option><option value="mail">E-mail seulement</option><option value="push">Notification seulement</option><option value="wa">WhatsApp (un clic par arbitre)</option></select></label>' +
      '<div id="msWa" class="wa-liste" hidden></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn" id="msApercu">Aperçu</button><button class="btn pri" id="msEnv">Envoyer</button></div></div>' +
      '<div class="card"><div class="card-head"><h2>Aperçu</h2><span class="sub">tel que l\'arbitre le recevra</span></div><div id="msPrev" class="mail-prev"><p class="mut">Rédige un message puis clique sur « Aperçu ».</p></div></div></div>' +
      '<div class="card"><div class="card-head"><h2>Historique des envois</h2><button class="btn sm" id="msHist">Afficher</button></div><div id="msHistZ"><p class="mut">Clique sur « Afficher ».</p></div></div>';
    $("msModele").addEventListener("change", (e) => { const m = MODELES_MSG[Number(e.target.value)]; if (m && m[0] && Number(e.target.value)) { $("msSujet").value = m[0]; $("msTxt").value = m[1]; } });
    const apercu = () => { const sujet = $("msSujet").value.trim() || "Sujet", texte = $("msTxt").value.trim() || "…";
      $("msPrev").innerHTML = '<div class="mp-head">REFEREE <b>TRACKER</b></div><div class="mp-body"><h3>' + esc(sujet) + "</h3><p>Bonjour Prénom,</p>" + texte.split(/\n{2,}/).map((x) => "<p>" + esc(x).replace(/\n/g, "<br>") + "</p>").join("") + '<span class="mp-btn">Ouvrir l\'application</span><small>Message de l\'équipe Referee Tracker · une question ? contact@referee-tracker.fr</small></div>'; };
    $("msApercu").addEventListener("click", apercu); $("msTxt").addEventListener("input", apercu); $("msSujet").addEventListener("input", apercu);
    // Destinataires réels selon cible + type (promo = consentement « offres » ; WhatsApp = consentement « whatsapp » + numéro).
    const destinataires = () => { const c = $("msCible").value, promo = $("msType").value === "promo";
      let d = c === "tous" ? l : c === "actifs" ? l.filter((a) => (a.profil || {}).statut === "actif") : l.filter((a) => a.id === c);
      if (promo) d = d.filter((a) => comm(a).offres === true);
      return d; };
    const majWa = () => { const z = $("msWa"), wa = $("msCanal").value === "wa"; z.hidden = !wa; $("msEnv").hidden = wa; if (!wa) return;
      const sujet = $("msSujet").value.trim(), texte = $("msTxt").value.trim(); let envoyes = {}; try { envoyes = JSON.parse(localStorage.getItem("rt-wa-envoyes") || "{}"); } catch (e) {}
      const d = destinataires(), ok = d.filter((a) => comm(a).whatsapp === true && waNum((a.profil || {}).telephone)), exclus = d.length - ok.length;
      z.innerHTML = '<p class="mut tiny">WhatsApp ne permet pas l\'envoi groupé depuis un site : chaque bouton ouvre la conversation avec le message déjà écrit, tu n\'as plus qu\'à appuyer sur Envoyer. Seuls les arbitres qui ne se sont pas opposés à WhatsApp et dont le numéro est connu apparaissent' + (exclus ? " (" + exclus + " exclu(s) : opposition ou pas de numéro)" : "") + ".</p>" +
        (ok.length ? ok.map((a) => { const p = a.profil || {}, k = a.id + "|" + sujet; const msg = "Bonjour " + (p.prenom || "") + ",\n\n" + (sujet ? "*" + sujet + "*\n\n" : "") + texte + ($("msType").value === "promo" ? "\n\n(Réponds STOP pour ne plus recevoir ces messages.)" : "") + "\n\n— Referee Tracker";
          return '<div class="wa-l"><strong>' + esc(nomDe(p, a.email)) + '</strong><span class="mut tiny">' + esc(p.telephone || "") + '</span><span class="sp"></span>' + (envoyes[k] ? badge("ouvert", "green") : "") + '<a class="btn sm wa-btn" target="_blank" rel="noopener" data-k="' + esc(k) + '" href="' + esc(waLien(p.telephone, msg)) + '">WhatsApp</a></div>'; }).join("") : '<p class="vide">Aucun destinataire WhatsApp.</p>');
      z.querySelectorAll(".wa-btn").forEach((b) => b.addEventListener("click", () => { try { const e = JSON.parse(localStorage.getItem("rt-wa-envoyes") || "{}"); e[b.dataset.k] = Date.now(); localStorage.setItem("rt-wa-envoyes", JSON.stringify(e)); } catch (x) {} setTimeout(majWa, 300); })); };
    ["msCible", "msType", "msCanal"].forEach((id) => $(id).addEventListener("change", majWa)); ["msSujet", "msTxt"].forEach((id) => $(id).addEventListener("input", () => { if ($("msCanal").value === "wa") majWa(); }));
    $("msEnv").addEventListener("click", async () => {
      const cible = $("msCible").value, sujet = $("msSujet").value.trim(), texte = $("msTxt").value.trim(), canal = $("msCanal").value, type = $("msType").value;
      if (sujet.length < 3 || texte.length < 3) return toast("Sujet et message obligatoires", "err");
      const lib = $("msCible").selectedOptions[0].textContent;
      if (!(await confirmer("Envoyer le message", "Envoyer « " + esc(sujet) + " » à <strong>" + esc(lib) + "</strong>" + (type === "promo" ? " (sauf ceux qui se sont opposés aux offres : " + destinataires().length + ")" : "") + " ? Chaque arbitre reçoit son propre e-mail (aucune adresse visible des autres).", "Envoyer"))) return;
      try { const j = await admin("message.envoyer", { cible, sujet, texte, canal, type }); toast(j.destinataires + " destinataire(s) · " + j.mails + " e-mail(s) · " + j.pushs + " notification(s)", "ok"); $("msTxt").value = ""; } catch (e) { toast(e.message, "err"); }
    });
    $("msHist").addEventListener("click", async () => {
      $("msHistZ").innerHTML = '<p class="mut">Chargement…</p>';
      try { const j = await admin("journal.liste", { page: 0, filtre_action: "message.envoyer" }); const d = j.data || [];
        $("msHistZ").innerHTML = d.length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Sujet</th><th>Cible</th><th>Canal</th><th class="right">Envois</th></tr></thead><tbody>' + d.map((x) => { const t = x.details || {}; return "<tr><td>" + fmt(x.at) + "</td><td><strong>" + esc(t.sujet || "") + '</strong><br><span class="mut tiny">' + esc((t.extrait || "").slice(0, 120)) + "</span></td><td>" + esc(t.cible === "tous" ? "Tous" : t.cible === "actifs" ? "Actifs" : "1 arbitre") + "</td><td>" + esc({ les2: "E-mail + notif.", mail: "E-mail", push: "Notification" }[t.canal] || "") + '</td><td class="num right">' + (t.mails || 0) + " / " + (t.pushs || 0) + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="vide">Aucun message envoyé.</p>';
      } catch (e) { $("msHistZ").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
    });
  };

  // =====================================================================
  // 6. SANTÉ
  // =====================================================================
  const pings = {};
  rendus.sante = async function (force) {
    const el = $("sec-sante");
    if (force || !cache.arbitres) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.arbitres = (await admin("arbitres.liste")).data || []; }
    const l = cache.arbitres;
    el.innerHTML = '<div class="card"><div class="card-head"><h2>Moteurs & synchronisation</h2><span class="sub">ping depuis l\'Edge (délai 10 s) · synchro = max(updated_at) · push = échecs consécutifs</span><button class="btn sm" id="btnPingAll">Tester tous les moteurs</button></div><div id="tblSante"></div></div>' +
      '<div class="card"><div class="card-head"><h2>Journal administrateur</h2><input id="jrnAct" placeholder="Filtrer par action (ex. profil.set)" style="width:220px"><select id="jrnUser"><option value="">Tous les arbitres</option>' + l.map((a) => '<option value="' + a.id + '">' + esc(nomDe(a.profil, a.email)) + "</option>").join("") + '</select><button class="btn sm" id="btnJournal">Afficher</button><button class="btn sm" id="btnJrnCsv">Export CSV</button></div><div id="jrn"><p class="mut tiny">Clique « Afficher » pour charger le journal (paginé par 100).</p></div></div>';
    const moteur = (u) => !!(u.profil || {}).api_url;
    tableCourante = tableau($("tblSante"), [
      { t: "Arbitre", k: (u) => nomDe(u.profil, u.email), r: (u) => "<strong>" + esc(nomDe(u.profil, u.email)) + '</strong><br><span class="mut tiny">' + esc(u.email) + "</span>" },
      { t: "Moteur", k: (u) => (moteur(u) ? 1 : 0), r: (u) => (moteur(u) ? '<span class="mono tiny" title="' + esc(u.profil.api_url) + '">…' + esc(u.profil.api_url.slice(-28)) + "</span>" : badge("aucun", "gray")) },
      { t: "Ping", k: (u) => (pings[u.id] ? pings[u.id].latence_ms : null), r: (u) => { const p = pings[u.id]; return (p ? (p.erreur ? badge(p.erreur, "red") : p.ping ? badge("OK · " + p.latence_ms + " ms", p.latence_ms > 5000 ? "orange" : "green") : badge("KO · HTTP " + (p.http || "—") + (p.detail ? " · " + p.detail : ""), "red")) : "") + (moteur(u) ? ' <button class="btn sm" data-act="ping">Tester</button>' : ""); } },
      { t: "Dernière synchro", k: (u) => u.derniere_synchro || "", r: (u) => '<span class="' + (moteur(u) && heures(u.derniere_synchro) > 48 ? "err" : "") + '">' + fmt(u.derniere_synchro) + ' <span class="tiny">' + depuis(u.derniere_synchro) + "</span></span>" },
      { t: "Dernier match reçu", k: (u) => u.dernier_match || "", r: (u) => fmt(u.dernier_match) },
      { t: "Connexion", k: (u) => u.derniere_connexion || "", r: (u) => fmt(u.derniere_connexion) },
      { t: "Push", k: (u) => (u.push || {}).echecs || 0, r: (u) => (u.push && u.push.n ? badge(u.push.n + " appareil(s)", "green") + " " + (u.push.echecs ? badge(u.push.echecs + " échec(s)", u.push.echecs >= 5 ? "red" : "orange") : "") + (u.push.last_ok ? ' <span class="mut tiny">ok ' + depuis(u.push.last_ok) + "</span>" : "") : badge("—", "gray")) },
      { t: "Consentement", k: (u) => (u.consentement || {}).version || "", r: (u) => (u.consentement ? badge("v" + u.consentement.version, "green") + ' <span class="mut tiny">' + fmtD(u.consentement.accepte_le) + "</span>" : badge("aucun", "red")) },
    ], l, { recherche: rechercheCourante, tri: "Dernière synchro", action: (a, u, b) => ping(u.id, b) });
    async function ping(id, b) { if (b) b.disabled = true; try { pings[id] = await admin("sante.ping", { user_id: id }); } catch (e) { pings[id] = { erreur: e.message }; } tableCourante.rendre(); }
    $("btnPingAll").addEventListener("click", async () => { for (const u of l.filter(moteur)) await ping(u.id); toast("Tests terminés", "ok"); });
    let page = 0;
    async function journal(p) {
      page = p || 0; $("jrn").innerHTML = '<p class="mut">Chargement…</p>';
      try {
        const j = await admin("journal.liste", { page, filtre_action: $("jrnAct").value.trim() || undefined, user_id: $("jrnUser").value || undefined });
        const nom = (id) => { const a = l.find((x) => x.id === id); return a ? nomDe(a.profil, a.email) : id ? id.slice(0, 8) + "…" : ""; };
        $("jrn").innerHTML = '<div class="tbl"><table><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>' + ((j.data || []).map((x) => "<tr><td>" + fmt(x.at) + '</td><td><span class="mono">' + esc(x.action) + "</span></td><td>" + esc(nom(x.cible_user)) + '</td><td class="mono tiny mut">' + esc(JSON.stringify(x.details || {}).slice(0, 200)) + "</td></tr>").join("") || '<tr><td colspan="4" class="vide">Aucune entrée</td></tr>') + "</tbody></table></div>" +
          '<div class="row" style="margin-top:8px"><span class="mut tiny">' + (j.total || 0) + " entrée(s) · page " + (page + 1) + " / " + Math.max(1, Math.ceil((j.total || 0) / (j.taille || 100))) + '</span><span class="sp"></span><button class="btn sm" id="jrnPrev"' + (page ? "" : " disabled") + '>← Précédent</button><button class="btn sm" id="jrnNext"' + ((page + 1) * (j.taille || 100) < (j.total || 0) ? "" : " disabled") + ">Suivant →</button></div>";
        $("jrnPrev").addEventListener("click", () => journal(page - 1)); $("jrnNext").addEventListener("click", () => journal(page + 1));
        $("btnJrnCsv").onclick = () => csv([["date", "action", "cible", "details"]].concat((j.data || []).map((x) => [x.at, x.action, nom(x.cible_user), JSON.stringify(x.details || {})])), "admin_journal_p" + (page + 1) + ".csv");
      } catch (e) { $("jrn").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
    }
    $("btnJournal").addEventListener("click", () => journal(0));
    $("btnJrnCsv").onclick = () => toast("Affiche d'abord le journal", "err");
    $("jrnAct").addEventListener("keydown", (e) => { if (e.key === "Enter") journal(0); });
  };

  // =====================================================================
  // 7. STATISTIQUES
  // =====================================================================
  let statsUser = "";
  rendus.stats = async function (force) {
    const el = $("sec-stats");
    if (force || !cache.statsDetail) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.statsDetail = await admin("stats.detail"); }
    const s = cache.statsDetail, g = s.global || {}, arb = s.arbitres || [];
    const sel = statsUser ? arb.find((a) => a.user_id === statsUser) : null, d = sel || g;
    const bloc = (titre, html, sub) => '<div class="card"><div class="card-head"><h2>' + titre + "</h2>" + (sub ? '<span class="sub">' + sub + "</span>" : "") + "</div>" + html + "</div>";
    const nom = (a) => a.prenom || a.nom_ffbb ? [a.prenom, a.nom_ffbb].filter(Boolean).join(" ") : a.email || a.user_id.slice(0, 8);
    el.innerHTML = '<div class="toolbar"><span class="pill' + (!statsUser ? " on" : "") + '" data-u="">Global</span>' + arb.map((a) => '<span class="pill' + (a.user_id === statsUser ? " on" : "") + '" data-u="' + a.user_id + '">' + esc(nom(a)) + "</span>").join("") + "</div>" +
      '<div class="tiles"><div class="tile"><b>' + (d.matchs || 0) + '</b><span>Matchs</span><small>hors annulés, 12 mois glissants et plus</small></div><div class="tile gold"><b>' + euro(d.indemnites) + '</b><span>Indemnités</span><small>somme indemnite_totale</small></div><div class="tile green"><b>' + pct(d.payes, d.payables) + '</b><span>Taux payé</span><small>' + (d.payes || 0) + " reçus / " + (d.payables || 0) + ' payables</small></div><div class="tile"><b>' + (d.f5 || 0) + ' <span style="font-size:13px;color:var(--muted)">/ ' + (d.f3 || 0) + '</span></b><span>5x5 / 3x3</span><small>' + (d.autres || 0) + ' autre(s)</small></div><div class="tile red"><b>' + (d.evaluations || 0) + '</b><span>Évaluations</span></div><div class="tile gray"><b>' + (sel ? 1 : arb.length) + "</b><span>Arbitre(s)</span></div></div>" +
      '<div class="grid-2">' + bloc("Matchs par mois", barres((s.mois || []).map((m) => ({ l: moisLbl(m), v: (d.par_mois || {})[m] || 0 }))), "12 derniers mois · date du match") +
      bloc("Répartition 5x5 / 3x3 et paiement", '<div class="subtab">Format</div><div class="ratio"><i class="a" style="width:' + pct(d.f5, d.matchs).replace(" %", "%").replace("—", "0%") + '"></i><i class="b" style="width:' + pct(d.f3, d.matchs).replace(" %", "%").replace("—", "0%") + '"></i></div><div class="legend"><span><i style="background:var(--navy-600)"></i>5x5 ' + (d.f5 || 0) + "</span><span><i style=\"background:var(--gold)\"></i>3x3 " + (d.f3 || 0) + "</span><span><i style=\"background:var(--line)\"></i>autres " + (d.autres || 0) + "</span></div>" +
        '<div class="subtab">Paiement</div><div class="ratio"><i class="a" style="width:' + pct(d.payes, d.payables).replace(" %", "%").replace("—", "0%") + '"></i></div><div class="legend"><span><i style="background:var(--navy-600)"></i>Reçu ' + (d.payes || 0) + "</span><span><i style=\"background:var(--surface-2);border:1px solid var(--line)\"></i>En attente " + ((d.payables || 0) - (d.payes || 0)) + "</span><span>Bénévole/annulé exclus</span></div>") + "</div>" +
      (sel ? "" : bloc("Par arbitre", arb.length ? '<div class="grid-2">' + '<div><div class="subtab">Matchs</div>' + hbarres(arb.map((a) => ({ l: nom(a), v: a.matchs }))) + "</div>" + '<div><div class="subtab">Indemnités</div>' + hbarres(arb.map((a) => ({ l: nom(a), v: Math.round(a.indemnites) })), euro, "gold") + "</div>" + '<div><div class="subtab">Taux payé</div>' + hbarres(arb.map((a) => ({ l: nom(a), v: a.payables ? Math.round((a.payes / a.payables) * 100) : 0 })), (v) => v + " %", "green") + "</div>" + '<div><div class="subtab">Évaluations</div>' + hbarres(arb.map((a) => ({ l: nom(a), v: a.evaluations })), null, "red") + "</div></div>" : '<p class="vide">Aucune donnée</p>')) +
      (sel ? "" : '<div class="card"><div class="card-head"><h2>Tableau récapitulatif</h2><button class="btn sm" id="btnCsvStats">CSV</button></div><div id="tblStats"></div></div>');
    el.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => { statsUser = p.dataset.u; rendus.stats(false); }));
    if (!sel) {
      tableCourante = tableau($("tblStats"), [
        { t: "Arbitre", k: nom, r: (a) => '<a href="#arbitres/' + a.user_id + '">' + esc(nom(a)) + "</a>" },
        { t: "Matchs", k: "matchs", cl: "num right", r: (a) => a.matchs }, { t: "5x5", k: "f5", cl: "num right", r: (a) => a.f5 }, { t: "3x3", k: "f3", cl: "num right", r: (a) => a.f3 },
        { t: "Indemnités", k: "indemnites", cl: "num right", r: (a) => euro(a.indemnites) }, { t: "Reçus", k: "payes", cl: "num right", r: (a) => a.payes + " / " + a.payables }, { t: "Taux payé", k: (a) => (a.payables ? a.payes / a.payables : 0), cl: "num right", r: (a) => pct(a.payes, a.payables) },
        { t: "Évaluations", k: "evaluations", cl: "num right", r: (a) => a.evaluations },
      ], arb, { recherche: rechercheCourante, tri: "Matchs", sens: -1, texte: (a) => nom(a).toLowerCase() });
      $("btnCsvStats").addEventListener("click", () => csv([["arbitre", "email", "matchs", "5x5", "3x3", "autres", "indemnites", "recus", "payables", "evaluations"].concat(s.mois)].concat(arb.map((a) => [nom(a), a.email, a.matchs, a.f5, a.f3, a.autres, a.indemnites, a.payes, a.payables, a.evaluations].concat(s.mois.map((m) => a.par_mois[m] || 0)))), "stats_arbitres.csv"));
    } else tableCourante = null;
  };

  // ---------- démarrage ----------
  async function demarrer() {
    initTheme();
    try {
      if (!session()) return voir("vLogin");
      if (!(await preparerMfa())) return;
      voir("vAdmin");
      await naviguer(true);
      // compteurs de navigation en arrière-plan (ne bloquent pas la section affichée)
      Promise.allSettled([
        courant === "arbitres" ? null : admin("arbitres.liste").then((j) => { cache.arbitres = j.data || []; $("navArbitres").textContent = cache.arbitres.length; }),
        courant === "inscriptions" ? null : admin("inscriptions.liste").then((j) => { cache.inscriptions = j.data || []; $("navInscriptions").textContent = cache.inscriptions.filter((i) => i.statut === "recue" || i.statut === "erreur").length || ""; }),
        courant === "tickets" ? null : admin("tickets.liste").then((j) => { cache.tickets = j.data || []; $("navTickets").textContent = cache.tickets.filter((t) => t.statut !== "Fermé").length || ""; }),
      ].filter(Boolean));
    } catch (e) {
      if (/AUTH_REQUIRED/.test(e.message)) return voir("vLogin");
      erreur(e);
    }
  }
  demarrer();
})();
