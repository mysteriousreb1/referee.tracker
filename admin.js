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
  const SECTIONS = { pilotage: "Pilotage", dashboard: "Tableau de bord", usage: "Connexions & usage", messages: "Messages", communication: "Communication", config: "Configuration", tickets: "Tickets", sante: "Santé technique", moteurs: "Moteurs", journal: "Journal d'audit",
    arbitres: "Arbitres", inscriptions: "Inscriptions", stats: "Statistiques arbitres", agenda: "Matchs à venir", paiements: "Paiements", alertes: "Alertes" };   // b86 : 2 espaces
  const cache = {}; let courant = null;
  const rendus = {};
  async function naviguer(force) {
    const h = (location.hash || "#pilotage").slice(1).split("/"); const sec = SECTIONS[h[0]] ? h[0] : "pilotage";
    courant = sec; effacerMsg(); if (!$("drawer").classList.contains("hidden")) fermerDrawer();   // b86 : changer de section ferme la fiche
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
    if (t.alertes_non_traitees) aFaire.push(["orange", t.alertes_non_traitees + " alerte(s) à traiter (« À régler » / « Avant le match »)", (t.alertes_infos ? t.alertes_infos + " info(s) en plus · " : "") + "même tri que dans l'app des arbitres", "#alertes"]);
    const aFaireHtml = '<div class="card afaire"><div class="card-head"><h2>À traiter</h2><span class="sub">' + (aFaire.length ? aFaire.length + " point(s)" : "rien en attente") + "</span></div>" +
      (aFaire.length ? '<ul class="afaire-l">' + aFaire.map((a) => '<li class="clic" data-lien="' + a[3] + '"><span class="dot ' + a[0] + '"></span><div><strong>' + esc(a[1]) + '</strong><span class="mut tiny">' + esc(a[2]) + '</span></div><span class="afaire-go">→</span></li>').join("") + "</ul>" : '<p class="vide">Tout est à jour. ✓</p>') + "</div>";
    el.innerHTML = aFaireHtml +
      '<div class="tiles">' +
      tuile(t.arbitres_actifs ?? 0, "Arbitres actifs", "green", (t.comptes ?? 0) + " comptes", "#arbitres") + tuile(t.inscrits_attente ?? 0, "Inscrits en attente", "orange", "", "#inscriptions") +
      tuile(t.moteurs_prets ?? 0, "Moteurs prêts", "gold", "en attente de 1re connexion", "#arbitres") + tuile(t.suspendus ?? 0, "Suspendus", "red", "", "#arbitres") +
      tuile(t.matchs_total ?? 0, "Matchs total", "", (t.matchs_30j ?? 0) + " sur 30 j") + tuile(t.convocations_7j ?? 0, "Convocations 7 j", "", "reçues toutes instances") +
      tuile(t.connexions_7j ?? 0, "Connexions 7 j", "green", "comptes vus") + tuile(t.actifs_7j ?? 0, "Utilisateurs actifs 7 j", "green", (t.minutes_7j ?? 0) >= 60 ? Math.round((t.minutes_7j || 0) / 60) + " h d'utilisation cumulée" : (t.minutes_7j ?? 0) + " min cumulées") +
      tuile(minutesTxt(t.minutes_30j || 0), "Temps d'écran 30 j", "", "téléphone " + minutesTxt(t.minutes_tel_30j || 0) + " · ordinateur " + minutesTxt(t.minutes_pc_30j || 0)) + tuile(t.tickets_ouverts ?? 0, "Tickets ouverts", t.tickets_ouverts ? "red" : "gray", "", "#tickets") +
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
      // b84 — répartition de l'écran : téléphone / ordinateur, et durée moyenne par jour d'utilisation
      { t: "Téléphone / PC 30 j", k: (r) => (r.usage || {}).minutes_30j || 0, cl: "num right", r: (r) => { const u = r.usage || {}; const tot = (u.tel_30j || 0) + (u.pc_30j || 0) + (u.tab_30j || 0); const pct = tot ? Math.round((u.tel_30j || 0) * 100 / tot) : 0; return tot ? "Tél. " + minutesTxt(u.tel_30j) + " · PC " + minutesTxt(u.pc_30j) + (u.tab_30j ? " · tab. " + minutesTxt(u.tab_30j) : "") + '<br><span class="mut tiny">' + pct + " % sur téléphone · " + minutesTxt(u.moy_jour_actif) + " / jour actif</span>" : '<span class="mut">—</span>'; } },
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
    // b86 — complétude de la fiche (ce qui manque et pourquoi)
    const ME = p.moteur_etat || {}, MA = ME.adresse || {};
    const crit = [["Nom officiel", !!p.nom_ffbb], ["Niveau", !!p.niveau], ["Zones de paiement", !!(z.cd || z.ligue)], ["Adresse de réception", !!p.adresse_reception], ["Moteur relié", !!p.api_url],
      ["E-mail fédération", !!(p.email_ffbb || ME.email_ffbb)], ["Téléphone (WhatsApp)", !!p.telephone], ["Fournisseur de mail", !!p.fournisseur_mail], ["Adresse de départ", !!MA.renseignee], ["Adresse localisée", !!MA.localisee],
      ["Carburant du véhicule", !!((ME.vehicules || []).slice(-1)[0] || {}).carburant], ["Onboarding terminé", !!p.onboarding_fait], ["CGU acceptées", !!(f.consentements && f.consentements.length)], ["Notifications", !!(f.push && f.push.length)], ["Double authentification", !!u.mfa]];
    const nOk = crit.filter((c) => c[1]).length;
    const completHtml = '<div class="card"><div class="card-head"><h3>Complétude de la fiche</h3><span class="sub">' + nOk + " / " + crit.length + " (" + Math.round(nOk / crit.length * 100) + ' %)</span></div><div class="complet">' + crit.map((c) => '<span class="' + (c[1] ? "" : "non") + '">' + (c[1] ? "✓ " : "✗ ") + esc(c[0]) + "</span>").join("") + '</div><p class="mut tiny" style="margin-top:8px">Téléphone : facultatif à l\'inscription. Fournisseur de mail : vide pour un compte créé à la main (Clément). E-mail fédération et adresse de départ : lus dans le moteur (onglet Moteur).</p></div>';
    const alertesHtml = f.alertes && f.alertes.total ? hbarres(Object.entries(f.alertes.par_type).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: k, v })), null, "red") + '<p class="mut tiny" style="margin-top:8px">' + f.alertes.total + " alerte(s) au total · <b>" + nonTraitees + "</b> à traiter (" + (f.alertes.regler || 0) + " à régler, " + (f.alertes.avant || 0) + " avant le match) · " + (f.alertes.infos || 0) + " info(s), visibles dans l'onglet Alertes de l'arbitre</p>" : '<p class="vide">Aucune alerte</p>';
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
      '<div class="tabs"><button class="on" data-tab="profil">Profil</button><button data-tab="matchs">Matchs (' + (f.matchs || []).length + ')</button><button data-tab="alertes">Alertes (' + (f.alertes ? f.alertes.total : 0) + ')</button><button data-tab="tickets">Tickets (' + (f.tickets || []).length + ")</button><button data-tab=\"notes\">Notes & message</button><button data-tab=\"moteur\">Moteur</button><button data-tab=\"danger\">Compte</button></div>" +
      '<div class="tabpane on" data-pane="profil"><div class="card"><div class="form-grid">' +
        inp("pPrenom", "Prénom", p.prenom) + inp("pNom", "Nom officiel", p.nom_ffbb) + inp("pEmailF", "E-mail fédération", p.email_ffbb, ME.email_ffbb ? "moteur : " + ME.email_ffbb : "non renseigné", "email") + inp("pTel", "Téléphone", p.telephone) + inp("pNiveau", "Niveau", p.niveau, "ex. Départemental, Région, CF") +
        sel("pStatut", "Statut", [["inscrit", "inscrit"], ["moteur_pret", "moteur prêt"], ["actif", "actif"], ["suspendu", "suspendu"]], p.statut || "inscrit") +
        inp("pCd", "Zone CD", z.cd, "CD67") + inp("pLigue", "Ligue", z.ligue, "LRGEB") + '<label class="f">Championnat de France<span style="padding-top:8px">' + chk("pCf", "Oui", z.cf) + "</span></label>" +
        inp("pRecep", "Adresse de réception", p.adresse_reception, "prenom@referee-tracker.fr") + '</div><label class="f" style="margin-top:10px">URL du moteur (Apps Script /exec)<input id="pApi" value="' + esc(p.api_url || "") + '" placeholder="https://script.google.com/macros/s/…/exec" class="mono"></label>' +
        '<div class="subtab">Fonctions activées</div><div class="row">' + ["ia", "evaluations", "elicence", "classements"].map((k) => chk("fn_" + k, LIB_FN[k] || k, fn[k] !== false)).join("") + "</div>" +
        '<div class="row" style="margin-top:12px"><button class="btn pri" id="pSave">Enregistrer le profil</button><span id="pMsg" class="mut"></span></div></div>' +
        completHtml + (f.inscription ? '<div class="card"><div class="card-head"><h3>Inscription</h3>' + badgeStatut(f.inscription.statut) + "</div><dl class=\"kv\"><dt>Date</dt><dd>" + fmt(f.inscription.created_at) + "</dd><dt>Fichiers</dt><dd>" + (Array.isArray(f.inscription.fichiers) ? f.inscription.fichiers.length : 0) + (f.inscription.fichiers_ok ? " ✓" : "") + "</dd><dt>Erreur</dt><dd class=\"err\">" + esc(f.inscription.erreur || "—") + "</dd><dt>Traitée le</dt><dd>" + fmt(f.inscription.traite_le) + "</dd></dl></div>" : "") +
        '<dl class="kv card"><dt>Identifiant</dt><dd class="mono">' + esc(u.id) + "</dd><dt>Code 1re connexion</dt><dd>" + (p.code_premiere_utilise ? badge("utilisé", "green") : p.code_premiere_expire ? badge("expire " + fmt(p.code_premiere_expire), new Date(p.code_premiere_expire) < new Date() ? "red" : "gold") : badge("aucun", "gray")) + "</dd><dt>Onboarding</dt><dd>" + ouiNon(p.onboarding_fait) + "</dd><dt>E-mail connexion</dt><dd>" + esc(p.email_connexion || u.email) + "</dd><dt>Fournisseur mail</dt><dd>" + esc(p.fournisseur_mail || "—") + "</dd></dl></div>" +
      '<div class="tabpane" data-pane="matchs"><div class="toolbar"><span class="mut">50 derniers · consultation journalisée</span><span class="sp"></span><button class="btn sm" id="fSolder" title="Historique importé jamais pointé (saisons passées)">Solder l\'historique…</button><select id="fSaison"><option value="">Toutes saisons</option>' + (f.saisons || []).map((s) => '<option value="' + esc(s) + '"' + (s === saison ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" + matchsHtml + "</div>" +
      '<div class="tabpane" data-pane="alertes"><div class="card">' + alertesHtml + '</div><div class="card" id="alZ"><p class="mut">Chargement des alertes…</p></div></div>' +
      '<div class="tabpane" data-pane="tickets">' + ticketsHtml + '<p style="margin-top:8px"><a href="#tickets/' + esc(u.id) + '" id="fTickets">Ouvrir dans Tickets →</a></p></div>' +
      '<div class="tabpane" data-pane="notes"><div class="grid-2"><div class="card"><div class="card-head"><h3>Notes internes</h3><span class="sub">visibles par toi seul · jamais par l\'arbitre</span></div>' +
        '<div class="row"><select id="nCat"><option value="retour">Retour client</option><option value="demande">Demande</option><option value="bug">Bug</option><option value="suivi" selected>Suivi</option><option value="autre">Autre</option></select></div><textarea id="nTxt" rows="3" placeholder="Ex. : souhaite un export par mois ; a signalé un écart sur un match du 12/10…" style="width:100%;margin-top:8px;font-family:inherit"></textarea><div class="row" style="margin-top:8px"><button class="btn pri sm" id="nAdd">Ajouter la note</button></div><div id="nListe" style="margin-top:12px"><p class="mut">Chargement…</p></div></div>' +
        '<div class="card"><div class="card-head"><h3>Écrire à cet arbitre</h3><span class="sub">e-mail au design Referee Tracker et/ou notification</span></div>' +
        '<label class="f">Sujet<input id="mSujet" maxlength="120" placeholder="Ex. : Ton écart du 12/10 est corrigé"></label><label class="f" style="margin-top:8px">Message<textarea id="mTxt" rows="6" style="font-family:inherit" placeholder="Le message commence automatiquement par « Bonjour Prénom, »."></textarea></label>' +
        '<div class="row" style="margin-top:8px"><select id="mCanal"><option value="les2">E-mail + notification</option><option value="mail">E-mail seulement</option><option value="push">Notification seulement</option></select><button class="btn pri sm" id="mEnv">Envoyer</button>' + (waNum(p.telephone) ? '<button class="btn sm wa-btn" id="mWa" title="' + esc(p.telephone) + '">WhatsApp</button>' : '<span class="mut tiny">WhatsApp : aucun numéro</span>') + '<button class="btn sm" id="mStop" title="L\'arbitre a répondu STOP ou ne veut plus de nouveautés">Retirer des offres (STOP)</button><span class="mut tiny" id="mStopEtat">' + (((p.communications || {}).offres === true) ? "offres : oui" : "offres : non") + " · WhatsApp : " + (((p.communications || {}).whatsapp === true) ? "oui" : "non") + '</span></div></div></div></div>' +
      '<div class="tabpane" data-pane="moteur"><div class="card" id="mtZ"><p class="mut">Ouvre cet onglet pour piloter le moteur.</p></div></div>' +
      '<div class="tabpane" data-pane="danger"><div class="card danger-zone"><h3>Supprimer le compte</h3><p>Supprime définitivement : matchs, évaluations, tickets, appareils push, consentements, profil, inscription, fichiers Storage import/, puis le compte de connexion. Irréversible.</p><button class="btn danger" id="fSuppr">Supprimer le compte…</button></div></div>';
    const body = $("drawerBody");
    body.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { body.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b)); body.querySelectorAll(".tabpane").forEach((x) => x.classList.toggle("on", x.dataset.pane === b.dataset.tab)); if (b.dataset.tab === "moteur") rendMoteur(); if (b.dataset.tab === "alertes") rendAlertes(); }));
    // ---------- b85 : traiter les alertes de l'arbitre (mêmes règles que son app ; le moteur est prévenu) ----------
    let alFiltre = "actives";
    const rendAlertes = async () => {
      const z = body.querySelector("#alZ"); if (!z) return;
      let l = []; try { l = (await admin("alertes.liste", { user_id: userId })).data || []; } catch (e) { z.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; return; }
      const nAct = l.filter((a) => !a.traitee).length, vue = l.filter((a) => alFiltre === "toutes" || (alFiltre === "actives" ? !a.traitee : a.traitee));
      z.innerHTML = '<div class="card-head"><h3>Alertes de l\'arbitre</h3><span class="sub">' + nAct + " à traiter · " + (l.length - nAct) + " traitée(s) · même affichage que dans son app</span></div>" +
        '<div class="toolbar"><select id="alF"><option value="actives">À traiter</option><option value="traitees">Traitées</option><option value="toutes">Toutes</option></select><label class="chk"><input type="checkbox" id="alTous">Tout cocher</label><span class="sp"></span>' +
        '<button class="btn sm pri" id="alOk">Marquer la sélection traitée</button><button class="btn sm" id="alRet">Rétablir la sélection</button>' + (nAct ? '<button class="btn sm" id="alAll">Tout marquer traité (' + nAct + ")</button>" : "") + '<button class="btn sm" id="alMaj">↻</button></div>' +
        (vue.length ? '<div class="tbl"><table><thead><tr><th></th><th>Date</th><th>Mission</th><th>Type</th><th>Alerte</th><th>État</th></tr></thead><tbody>' + vue.map((a) => '<tr><td><input type="checkbox" class="alC" value="' + esc(a.uid) + '"></td><td class="tiny">' + esc(a.date || "—") + "</td><td>" + esc(a.libelle || a.format || "") + '<br><span class="mut tiny">' + esc(a.rencontre || "") + "</span></td><td>" + ({ regler: badge("À régler", "red"), avant: badge("Avant le match", "orange"), infos: badge("Info", "gray") }[a.section] || "") + '<br><span class="tiny">' + esc(a.titre || "") + '</span></td><td class="warn tiny">' + a.alertes.map(esc).join("<br>") + "</td><td>" + (a.traitee ? badge("traitée", "green") : badge("active", "orange")) + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="vide">' + (alFiltre === "actives" ? "Aucune alerte à traiter" : "Rien à afficher") + "</p>");
      z.querySelector("#alF").value = alFiltre;
      z.querySelector("#alF").onchange = (e) => { alFiltre = e.target.value; rendAlertes(); };
      z.querySelector("#alMaj").onclick = rendAlertes;
      z.querySelector("#alTous").onchange = (e) => z.querySelectorAll(".alC").forEach((c) => { c.checked = e.target.checked; });
      const coches = () => [...z.querySelectorAll(".alC:checked")].map((c) => c.value);
      const go = async (btn, corps, txt) => {
        btn.disabled = true;
        try { const r = await admin("alertes.traiter", { user_id: userId, ...corps }); toast(r.n + " alerte(s) " + txt + (r.moteur ? " · moteur prévenu (≤ 10 min)" : ""), "ok"); rendAlertes(); }
        catch (e) { btn.disabled = false; toast(e.message, "err"); }
      };
      z.querySelector("#alOk").onclick = (e) => { const u = coches(); if (!u.length) return toast("Coche au moins une alerte", "err"); go(e.target, { uids: u }, "marquée(s) traitée(s)"); };
      z.querySelector("#alRet").onclick = (e) => { const u = coches(); if (!u.length) return toast("Coche au moins une alerte", "err"); go(e.target, { uids: u, retablir: true }, "rétablie(s)"); };
      const all = z.querySelector("#alAll");
      if (all) all.onclick = async (e) => { if (!(await confirmer("Tout marquer traité", "Marquer les <strong>" + nAct + "</strong> alertes de " + esc(nomDe(p, u.email)) + " comme traitées ? Elles disparaissent de son onglet Alertes (réversible ici).", "Tout marquer"))) return; go(e.target, { tout: true }, "marquée(s) traitée(s)"); };
    };
    // ---------- b81 : piloter le moteur de l'arbitre (commandes exécutées au prochain passage, ≤ 10 min) ----------
    const LIB_CMD = { synchro: "Synchroniser maintenant", carburant: "Relever le prix du carburant", diagnostic: "Diagnostic complet", declencheurs: "Réinstaller les déclencheurs", adresse: "Changer l'adresse de départ", tarifs: "Changer les tarifs", vehicule: "Ajouter un véhicule", vehicule_set: "Modifier un véhicule", alertes: "Alertes traitées / rétablies", profil: "Profil modifié" };
    const BADGE_CMD = { en_attente: ["en attente", "orange"], en_cours: ["en cours", "gold"], ok: ["fait", "green"], erreur: ["erreur", "red"], annulee: ["annulée", ""] };
    const rendMoteur = async () => {
      const z = body.querySelector("#mtZ"); if (!z) return;
      if (!p.api_url) { z.innerHTML = '<p class="vide">Aucun moteur pour ce compte.</p>'; return; }
      let l = []; try { l = (await admin("commandes.liste", { user_id: userId })).data || []; } catch (e) { z.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; return; }
      const resTxt = (c) => { if (c.action === "diagnostic" && c.statut === "ok") { try { const d = JSON.parse(c.resultat); return '<pre class="code tiny">' + esc(JSON.stringify(d, null, 1)) + "</pre>"; } catch (e) {} } return esc(c.resultat || ""); };
      const E = p.moteur_etat || null, A = (E && E.adresse) || {}, T = (E && E.tarifs) || {}, V = (E && E.vehicules) || [];
      const bat = E && E.battement ? depuis(E.battement) : "inconnu";
      const etatHtml = '<div class="card-head"><h3>Qu\'est-ce que le moteur ?</h3></div><p class="mut tiny" style="margin-top:0">Le moteur est le programme (Google Apps Script) propre à cet arbitre : toutes les 10 minutes il lit les convocations reçues sur <b>' + esc(p.adresse_reception || "son adresse Referee Tracker") + '</b>, crée les matchs, calcule les km, les indemnités, le carburant, l\'agenda et les alertes, puis envoie tout à l\'app. Ses réglages (adresse de départ, véhicules, tarifs) vivent dans le moteur : ils s\'affichent ici dès qu\'il publie son état (1 fois par heure, ou tout de suite avec « Diagnostic complet »).</p>' +
        (E ? '<div class="subtab">État publié par le moteur</div><dl class="kv-mini"><dt>Version</dt><dd>' + esc(E.version || "?") + ' · publié ' + depuis(E.publie) + '</dd><dt>Dernier passage</dt><dd>' + esc(bat) + '</dd><dt>Adresse de départ</dt><dd>' + (A.renseignee ? esc([A.code_postal, A.ville].filter(Boolean).join(" ")) + (A.localisee ? " " + badge("localisée", "green") : " " + badge("non localisée", "red")) : badge("non renseignée", "red")) + "</dd>" +
          '<dt>Tarifs</dt><dd>indemnité ' + esc(T.indemnite_km ?? "?") + ' €/km · usure ' + esc(T.usure_km ?? "?") + ' €/km</dd><dt>Carburant</dt><dd>' + (E.carburant ? esc(String(E.carburant.carburant || "").toUpperCase()) + " " + esc(E.carburant.prix) + " €/L (médiane de " + esc(E.carburant.n) + " station(s), " + esc(E.carburant.rayon_km) + " km)" : "aucun relevé") + "</dd>" +
          '<dt>Déclencheurs</dt><dd>' + esc((E.declencheurs || []).join(", ") || "aucun") + '</dd><dt>Classeur</dt><dd>' + esc((E.compteurs || {}).matchs ?? "?") + " match(s) · " + esc((E.compteurs || {}).mails_traites ?? "?") + " mail(s) traité(s)</dd>" +
          (E.rattrapage_b84 ? '<dt>Rattrapage b84</dt><dd class="tiny mono">' + esc(String(E.rattrapage_b84).slice(0, 260)) + "</dd>" : "") + "</dl>" +
          '<div class="subtab">Véhicules du moteur</div>' + (V.length ? '<div class="tbl"><table><thead><tr><th>Véhicule</th><th>Conso</th><th>CV</th><th>Depuis</th><th>Carburant</th></tr></thead><tbody>' + V.map((v, i) => "<tr><td>" + esc(v.nom) + "</td><td>" + esc(v.conso) + (v.carburant === "electrique" ? " kWh" : " L") + "/100</td><td>" + esc(v.cv) + "</td><td>" + esc(v.depuis) + '</td><td><select data-vcarb="' + i + '">' + CARBS_ADM.map(([k, l]) => '<option value="' + k + '"' + ((v.carburant || "") === k ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></td></tr>").join("") + "</tbody></table></div>" : '<p class="vide">Aucun véhicule publié</p>')
          : '<p class="warn">Le moteur n\'a pas encore publié son état (version antérieure à b86 ou pas encore passé). Lance « Diagnostic complet » : le résultat s\'affiche dans l\'historique ci-dessous.</p>');
      z.innerHTML = etatHtml + '<div class="card-head" style="margin-top:14px"><h3>Piloter le moteur</h3><span class="sub">exécuté au prochain passage du moteur (10 min au plus)</span></div>' +
        '<div class="row" style="flex-wrap:wrap;gap:6px">' + ["synchro", "carburant", "diagnostic", "declencheurs"].map((k) => '<button class="btn sm" data-cmd="' + k + '">' + LIB_CMD[k] + "</button>").join("") + '<button class="btn sm" id="mtMaj">↻ Actualiser</button></div>' +
        '<div class="subtab">Adresse de départ (calcul des km et du carburant)</div><div class="form-grid"><label class="f">Adresse<input id="mtAdr" maxlength="120"></label><label class="f">Code postal<input id="mtCp" maxlength="5" inputmode="numeric"></label><label class="f">Ville<input id="mtVille" maxlength="60"></label></div><button class="btn sm" data-cmd="adresse">Envoyer au moteur</button>' +
        '<div class="subtab">Tarifs de l\'arbitre</div><div class="form-grid"><label class="f">Indemnité km (€/km)<input id="mtIk" inputmode="decimal" placeholder="0,40"></label><label class="f">Usure (€/km)<input id="mtUs" inputmode="decimal" placeholder="0,19"></label></div><button class="btn sm" data-cmd="tarifs">Envoyer au moteur</button>' +
        '<div class="subtab">Nouveau véhicule (les matchs passés gardent l\'ancien)</div><div class="form-grid"><label class="f">Nom<input id="mtVn" maxlength="60" placeholder="Peugeot 208"></label><label class="f">Conso (L/100 km)<input id="mtVc" inputmode="decimal"></label><label class="f">CV fiscaux<input id="mtVcv" inputmode="numeric"></label><label class="f">Depuis (JJ/MM/AAAA)<input id="mtVd" placeholder="01/11/2026"></label><label class="f">Carburant<select id="mtVcarb">' + CARBS_ADM.filter((x) => x[0]).map(([k, l]) => '<option value="' + k + '">' + esc(l) + "</option>").join("") + '</select></label></div><button class="btn sm" data-cmd="vehicule">Envoyer au moteur</button>' +
        '<div class="subtab">Historique des commandes</div>' + (l.length ? '<div class="tbl"><table><thead><tr><th>Déposée</th><th>Commande</th><th>État</th><th>Résultat</th><th></th></tr></thead><tbody>' + l.map((c) => "<tr><td class=\"tiny\">" + fmt(c.cree) + "</td><td>" + esc(LIB_CMD[c.action] || c.action) + "</td><td>" + badge(...(BADGE_CMD[c.statut] || [c.statut, ""])) + '</td><td class="tiny">' + resTxt(c) + "</td><td>" + (c.statut === "en_attente" ? '<button class="btn sm" data-annul="' + c.id + '">Annuler</button>' : "") + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="vide">Aucune commande</p>');
      if (E) { const sv = (id, v) => { const x = z.querySelector("#" + id); if (x && v != null && v !== "") x.value = String(v).replace(".", ","); };
        sv("mtCp", A.code_postal); sv("mtVille", A.ville); sv("mtIk", T.indemnite_km); sv("mtUs", T.usure_km); }
      z.querySelectorAll("[data-vcarb]").forEach((sel) => sel.addEventListener("change", async () => {
        if (!sel.value) return;
        try { await admin("commande.creer", { user_id: userId, action_moteur: "vehicule_set", params: { index: Number(sel.dataset.vcarb), carburant: sel.value } }); toast("Carburant envoyé au moteur (≤ 10 min)", "ok"); rendMoteur(); } catch (e) { toast(e.message, "err"); }
      }));
      z.querySelector("#mtMaj").onclick = rendMoteur;
      z.querySelectorAll("[data-annul]").forEach((b) => b.addEventListener("click", async () => { try { await admin("commande.annuler", { id: Number(b.dataset.annul) }); toast("Commande annulée", "ok"); rendMoteur(); } catch (e) { toast(e.message, "err"); } }));
      z.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", async () => {
        const a = b.dataset.cmd, v = (id) => (z.querySelector("#" + id).value || "").trim(); let params = {};
        if (a === "adresse") params = { adresse: v("mtAdr"), code_postal: v("mtCp"), ville: v("mtVille") };
        if (a === "tarifs") params = { indemnite_km: v("mtIk").replace(",", "."), usure_km: v("mtUs").replace(",", ".") };
        if (a === "vehicule") params = { nom: v("mtVn"), conso: v("mtVc").replace(",", "."), cv: v("mtVcv"), depuis: v("mtVd"), carburant: v("mtVcarb") };
        if (["adresse", "tarifs", "vehicule"].includes(a) && !(await confirmer(LIB_CMD[a], "Envoyer cette modification au moteur de <strong>" + esc(nomDe(p, u.email)) + "</strong> ? Elle sera appliquée dans les 10 minutes et journalisée.", "Envoyer"))) return;
        b.disabled = true;
        try { await admin("commande.creer", { user_id: userId, action_moteur: a, params }); toast("Commande envoyée : exécution dans les 10 min", "ok"); rendMoteur(); } catch (e) { b.disabled = false; toast(e.message, "err"); }
      }));
    };
    body.querySelector("#fSaison").addEventListener("change", (e) => ouvrirFiche(userId, e.target.value));
    // b85 — saisons passées importées sans pointage (ex. historique d'un nouvel arbitre) : « Reçu » en une fois, à la demande de l'arbitre.
    body.querySelector("#fSolder").addEventListener("click", async (e) => {
      const d = new Date(), y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1, avant = y + "/" + (y + 1);
      let c; try { c = await admin("paiements.solder", { user_id: userId, saison_avant: avant, motif: "comptage", compter: true }); } catch (er) { return toast(er.message, "err"); }
      if (!c.n) return toast("Rien à solder : toutes les saisons avant " + avant + " sont pointées", "ok");
      const motif = prompt(c.n + " match(s) des saisons avant " + avant + " ne sont pas marqués payés (" + String(c.total).replace(".", ",") + " €).\nIls passeront en « Reçu » (montant = indemnité). À faire seulement si l'arbitre confirme qu'ils sont payés.\n\nMotif (journalisé), ex. : confirmé par l'arbitre le " + d.toLocaleDateString("fr-FR") + " :");
      if (!motif || motif.trim().length < 5) return;
      e.target.disabled = true;
      try { const r = await admin("paiements.solder", { user_id: userId, saison_avant: avant, motif: motif.trim() }); toast(r.n + " match(s) passé(s) en « Reçu » · le moteur les reprend au prochain passage", "ok"); ouvrirFiche(userId, saison); } catch (er) { e.target.disabled = false; toast(er.message, "err"); }
    });
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
        const rProf = await admin("profil.set", { user_id: userId, prenom: v("pPrenom"), nom_ffbb: v("pNom"), email_ffbb: v("pEmailF"), telephone: v("pTel"), niveau: v("pNiveau"), statut: v("pStatut"), zones: { cd: v("pCd"), ligue: v("pLigue"), cf: body.querySelector("#pCf").checked }, adresse_reception: recep, api_url: api, fonctions });
        msg.textContent = "Enregistré ✓"; msg.className = "ok"; toast("Profil enregistré" + (rProf && rProf.moteur ? " · envoyé au moteur (appliqué sous 10 min)" : ""), "ok"); cache.arbitres = null; cache.stats = null; if (courant === "arbitres") rendus.arbitres(true);
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
  // b86 — NOUVELLES SECTIONS (espace Application / espace Arbitres)
  // =====================================================================
  const tuileB = (v, l, cl, sub) => '<div class="tile ' + (cl || "") + '"><b>' + esc(v) + "</b><span>" + l + "</span>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
  const hm = (m) => { m = Math.round(Number(m) || 0); return m >= 60 ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") : m + " min"; };
  const ficheDe = (uid) => (uid ? ouvrirFiche(uid) : null);

  // ---- Connexions & usage
  let usageJours = 30;
  rendus.usage = async function (force) {
    const el = $("sec-usage");
    if (force || !cache.usage || cache.usage.j !== usageJours) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.usage = { j: usageJours, d: await admin("usage.detail", { jours: usageJours }) }; }
    const d = cache.usage.d, J = d.jours || [], U = d.par_arbitre || [];
    const tot = J.reduce((t, x) => t + x.minutes, 0), tel = J.reduce((t, x) => t + x.tel, 0), pc = J.reduce((t, x) => t + x.pc, 0), tab = J.reduce((t, x) => t + x.tab, 0);
    const actifsJ = J.length ? Math.round(J.reduce((t, x) => t + x.utilisateurs, 0) / J.length * 10) / 10 : 0;
    el.innerHTML = '<div class="toolbar"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Période <select id="usJ">' + [7, 30, 90].map((n) => '<option value="' + n + '"' + (n === usageJours ? " selected" : "") + ">" + n + " jours</option>").join("") + "</select></label></div>" +
      '<div class="tiles">' + tuileB(hm(tot), "Temps d'écran total", "", usageJours + " jours") + tuileB(pct(tel, tel + pc + tab), "Sur téléphone", "", hm(tel)) + tuileB(pct(pc, tel + pc + tab), "Sur ordinateur", "", hm(pc)) + tuileB(pct(tab, tel + pc + tab), "Sur tablette", "", hm(tab)) +
        tuileB(U.length, "Arbitres connectés", "", "sur la période") + tuileB(actifsJ, "Arbitres actifs / jour", "", "moyenne") + tuileB(U.length ? hm(tot / U.length) : "—", "Temps moyen / arbitre", "", "sur la période") + "</div>" +
      '<div class="grid-2"><div class="card"><div class="card-head"><h3>Minutes par jour</h3><span class="sub">toutes plateformes</span></div>' + barres(J.slice(-31).map((x) => ({ l: x.jour.slice(8, 10) + "/" + x.jour.slice(5, 7), v: x.minutes }))) + "</div>" +
      '<div class="card"><div class="card-head"><h3>Par jour de la semaine</h3><span class="sub">minutes cumulées</span></div>' + barres(["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((l, i) => ({ l, v: (d.semaine || [])[i] || 0 }))) + "</div></div>" +
      '<div class="card"><div class="card-head"><h3>Par arbitre</h3><span class="sub">clic = fiche</span></div><div id="usT"></div></div>';
    el.querySelector("#usJ").onchange = (e) => { usageJours = Number(e.target.value); rendus.usage(true); };
    tableCourante = tableau(el.querySelector("#usT"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(x.prenom || "—") }, { t: "Total", k: "minutes", cl: "num right", r: (x) => hm(x.minutes) },
      { t: "Téléphone", k: "tel", cl: "num right", r: (x) => hm(x.tel) }, { t: "Ordinateur", k: "pc", cl: "num right", r: (x) => hm(x.pc) }, { t: "Tablette", k: "tab", cl: "num right", r: (x) => hm(x.tab) },
      { t: "Jours actifs", k: "jours", cl: "num right", r: (x) => esc(x.jours) }, { t: "Moyenne / jour actif", k: (x) => x.minutes / Math.max(1, x.jours), cl: "num right", r: (x) => hm(x.minutes / Math.max(1, x.jours)) },
      { t: "Dernière activité", k: "derniere", r: (x) => esc(depuis(x.derniere)) },
    ], U, { recherche: rechercheCourante, tri: "Total", sens: -1, clic: (x) => ficheDe(x.user_id) });
  };

  // ---- Communication (bandeau, textes des e-mails, historique des envois)
  rendus.communication = async function (force) {
    const el = $("sec-communication");
    if (force || !cache.config || !cache.journalMsg) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.config = await admin("config.get"); cache.journalMsg = await admin("journal.liste", { filtre_action: "message" }); }
    const cfgV = (k) => ((cache.config.data || []).find((r) => r.cle === k) || {}).valeur || {};
    const tx = cfgV("pub.textes"), ml = cfgV("pub.mails"), env = (cache.journalMsg.data || []).filter((x) => /message\.envoyer/.test(x.action || ""));
    const MOD = [["attente", "Liste d'attente"], ["recue", "Demande reçue"], ["guides", "Guide et manuel"], ["compte_pret", "Compte prêt"]];
    el.innerHTML = '<div class="grid-2"><div class="card"><div class="card-head"><h3>Bandeau dans l\'app</h3><span class="sub">' + (tx.bandeau ? "affiché" : "aucun") + "</span></div>" +
        (tx.bandeau ? '<p class="rt-bandeau-apercu">' + esc(tx.bandeau) + '</p><p class="mut tiny">Du ' + esc(tx.bandeau_debut || "maintenant") + " au " + esc(tx.bandeau_fin || "sans fin") + " · style " + esc(tx.bandeau_style || "info") + "</p>" : '<p class="vide">Aucun bandeau</p>') +
        '<p class="mut tiny">Mode maintenance : ' + (tx.maintenance ? badge("ACTIVÉ", "red") : badge("désactivé", "green")) + '</p><div class="row"><a class="btn sm" href="#messages">Publier / retirer un bandeau</a><button class="btn sm" id="coCfgT">Planifier (Configuration)</button></div></div>' +
      '<div class="card"><div class="card-head"><h3>Textes des e-mails</h3><span class="sub">4 modèles envoyés aux arbitres</span></div><div class="tbl"><table><thead><tr><th>Modèle</th><th>Sujet</th><th>Message ajouté</th></tr></thead><tbody>' +
        MOD.map(([k, l]) => "<tr><td>" + esc(l) + "</td><td>" + (ml[k] && ml[k].sujet ? esc(ml[k].sujet) : '<span class="mut">texte d\'origine</span>') + "</td><td>" + (ml[k] && ml[k].message ? esc(ml[k].message.slice(0, 80)) : '<span class="mut">—</span>') + "</td></tr>").join("") +
        '</tbody></table></div><div class="row" style="margin-top:8px"><button class="btn sm pri" id="coCfgM">Modifier les textes</button></div></div></div>' +
      '<div class="card"><div class="card-head"><h3>Historique des envois</h3><span class="sub">messages, diffusions, notifications (journal d\'audit)</span></div><div id="coT"></div></div>';
    el.querySelector("#coCfgM").onclick = () => { cfgCle = "pub.mails"; location.hash = "#config"; };
    el.querySelector("#coCfgT").onclick = () => { cfgCle = "pub.textes"; location.hash = "#config"; };
    const nomU = (id) => { const a = (cache.arbitres || []).find((x) => x.id === id); return a ? nomDe(a.profil, a.email) : (id ? id.slice(0, 8) : "tous"); };
    tableCourante = tableau(el.querySelector("#coT"), [
      { t: "Date", k: "at", r: (x) => fmt(x.at) }, { t: "Destinataire", k: "cible_user", r: (x) => esc(nomU(x.cible_user)) },
      { t: "Détail", k: (x) => JSON.stringify(x.details || {}), r: (x) => '<span class="tiny">' + esc(JSON.stringify(x.details || {}).slice(0, 180)) + "</span>" },
    ], env, { recherche: rechercheCourante });
  };

  // ---- Moteurs (tous les arbitres)
  rendus.moteurs = async function (force) {
    const el = $("sec-moteurs");
    if (force || !cache.moteurs) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.moteurs = (await admin("moteurs.liste")).data || []; }
    const l = cache.moteurs, n = (st) => l.filter((x) => x.sante === st).length;
    $("navMoteurs").textContent = (n("arrete") + n("lent")) || "";
    el.innerHTML = '<p class="mut tiny">Chaque arbitre a son moteur (Google Apps Script) qui lit ses convocations toutes les 10 min. Vert : passé il y a moins de 30 min · orange : moins de 3 h · rouge : arrêté. « Inconnu » : moteur antérieur à b86 (pas encore d\'état publié).</p>' +
      '<div class="tiles">' + tuileB(l.length, "Moteurs", "") + tuileB(n("ok"), "En marche", "green") + tuileB(n("lent"), "En retard", "orange") + tuileB(n("arrete"), "Arrêtés", "red") + tuileB(n("inconnu"), "État inconnu", "") +
        tuileB(l.reduce((t, x) => t + x.commandes.attente, 0), "Commandes en attente", "") + tuileB(l.reduce((t, x) => t + x.commandes.erreur, 0), "Commandes en erreur (7 j)", "") + "</div>" +
      '<div class="row" style="margin:10px 0"><button class="btn sm" id="moDiag">Diagnostic de tous les moteurs</button><button class="btn sm" id="moSync">Synchroniser tous les moteurs</button></div><div id="moT"></div>';
    const tous = async (act, lib) => { if (!(await confirmer(lib, "Envoyer « " + esc(lib) + " » aux " + l.length + " moteur(s) ? Exécution dans les 10 minutes.", "Envoyer"))) return; let ok = 0; for (const m of l) { try { await admin("commande.creer", { user_id: m.user_id, action_moteur: act, params: {} }); ok++; } catch (e) {} } toast(ok + " commande(s) envoyée(s)", "ok"); rendus.moteurs(true); };
    el.querySelector("#moDiag").onclick = () => tous("diagnostic", "Diagnostic complet");
    el.querySelector("#moSync").onclick = () => tous("synchro", "Synchroniser maintenant");
    const S = { ok: badge("en marche", "green"), lent: badge("en retard", "orange"), arrete: badge("arrêté", "red"), inconnu: badge("inconnu", "gray") };
    tableCourante = tableau(el.querySelector("#moT"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(nomDe({ prenom: x.prenom, nom_ffbb: x.nom })) + '<br><span class="mut tiny mono">' + esc(x.reception || "") + "</span>" },
      { t: "État", k: "sante", r: (x) => S[x.sante] || "" }, { t: "Dernier passage", k: (x) => x.battement_min ?? 1e9, r: (x) => (x.battement_min == null ? "—" : "il y a " + hm(x.battement_min)) },
      { t: "Version", k: (x) => x.etat.version || "", r: (x) => esc(x.etat.version || "—") },
      { t: "Départ", k: (x) => (x.etat.adresse || {}).ville || "", r: (x) => { const a = x.etat.adresse || {}; return a.renseignee ? esc([a.code_postal, a.ville].filter(Boolean).join(" ")) + (a.localisee ? "" : " " + badge("non localisée", "red")) : x.etat.publie ? badge("manquante", "red") : "—"; } },
      { t: "Véhicule", k: (x) => ((x.etat.vehicules || []).slice(-1)[0] || {}).nom || "", r: (x) => { const v = (x.etat.vehicules || []).slice(-1)[0]; return v ? esc(v.nom) + '<br><span class="tiny mut">' + esc(v.conso) + " · " + esc(v.carburant || "E10 par défaut") + "</span>" : "—"; } },
      { t: "Carburant relevé", k: (x) => (x.etat.carburant || {}).prix || 0, r: (x) => (x.etat.carburant ? esc(x.etat.carburant.prix) + " €/L" : "—") },
      { t: "Déclencheurs", k: (x) => (x.etat.declencheurs || []).length, cl: "num right", r: (x) => esc((x.etat.declencheurs || []).length || (x.etat.publie ? "0 ⚠" : "—")) },
      { t: "Convocations 30 j", k: "convocations_30j", cl: "num right", r: (x) => esc(x.convocations_30j) },
      { t: "Commandes", k: (x) => x.commandes.attente + x.commandes.erreur, r: (x) => (x.commandes.attente ? badge(x.commandes.attente + " en attente", "orange") : "") + (x.commandes.erreur ? badge(x.commandes.erreur + " erreur(s)", "red") : "") || '<span class="mut">—</span>' },
    ], l, { recherche: rechercheCourante, tri: "État", clic: (x) => ficheDe(x.user_id) });
  };

  // ---- Journal d'audit
  let jrPage = 0, jrFiltre = "";
  rendus.journal = async function (force) {
    const el = $("sec-journal");
    if (force || !cache.journal || cache.journal.p !== jrPage || cache.journal.f !== jrFiltre) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.journal = { p: jrPage, f: jrFiltre, d: await admin("journal.liste", { page: jrPage, filtre_action: jrFiltre || undefined }) }; }
    const d = cache.journal.d, l = d.data || [];
    const nomU = (id) => { const a = (cache.arbitres || []).find((x) => x.id === id); return a ? nomDe(a.profil, a.email) : (id ? id.slice(0, 8) + "…" : "—"); };
    el.innerHTML = '<p class="mut tiny">Toutes les actions de l\'administration sont tracées (RGPD) : consultation d\'une fiche, envoi, modification, commande au moteur…</p><div class="toolbar"><input id="jrF" placeholder="Filtrer par action (ex. profil, message, commande)" value="' + esc(jrFiltre) + '"><button class="btn sm" id="jrGo">Filtrer</button><span class="sp"></span><span class="mut tiny">' + d.total + " entrée(s) · page " + (jrPage + 1) + '</span><button class="btn sm" id="jrP"' + (jrPage ? "" : " disabled") + '>← Plus récentes</button><button class="btn sm" id="jrN"' + ((jrPage + 1) * (d.taille || 100) < d.total ? "" : " disabled") + ">Plus anciennes →</button></div><div id=\"jrT\"></div>";
    el.querySelector("#jrGo").onclick = () => { jrFiltre = el.querySelector("#jrF").value.trim(); jrPage = 0; rendus.journal(true); };
    el.querySelector("#jrP").onclick = () => { jrPage = Math.max(0, jrPage - 1); rendus.journal(true); };
    el.querySelector("#jrN").onclick = () => { jrPage++; rendus.journal(true); };
    tableCourante = tableau(el.querySelector("#jrT"), [
      { t: "Date", k: "at", r: (x) => fmt(x.at) }, { t: "Action", k: "action", r: (x) => '<span class="mono tiny">' + esc(x.action || "") + "</span>" },
      { t: "Arbitre concerné", k: "cible_user", r: (x) => esc(nomU(x.cible_user)) },
      { t: "Détail", k: (x) => JSON.stringify(x.details || {}), r: (x) => '<span class="tiny">' + esc(JSON.stringify(x.details || {}).slice(0, 200)) + "</span>" },
    ], l, { recherche: rechercheCourante });
  };

  // ---- Matchs à venir (tous les arbitres)
  let agJours = 14;
  rendus.agenda = async function (force) {
    const el = $("sec-agenda");
    if (force || !cache.agenda || cache.agenda.j !== agJours) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.agenda = { j: agJours, d: (await admin("matchs.avenir", { jours: agJours })).data || [] }; }
    const l = cache.agenda.d;
    el.innerHTML = '<div class="toolbar"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Horizon <select id="agJ">' + [7, 14, 30, 60].map((n) => '<option value="' + n + '"' + (n === agJours ? " selected" : "") + ">" + n + " jours</option>").join("") + '</select></label><span class="sp"></span><span class="mut tiny">' + l.length + " match(s) · " + euro(l.reduce((t, x) => t + (Number(x.indemnite_totale) || 0), 0)) + " d'indemnités · " + Math.round(l.reduce((t, x) => t + (Number(x.km_a_r_stats) || 0), 0)) + ' km A/R</span></div><div id="agT"></div>';
    el.querySelector("#agJ").onchange = (e) => { agJours = Number(e.target.value); rendus.agenda(true); };
    tableCourante = tableau(el.querySelector("#agT"), [
      { t: "Date", k: "date_match", r: (x) => esc(fmtD(x.date_match)) + ' <span class="mut tiny">' + esc(x.heure_rdv || "") + "</span>" }, { t: "Arbitre", k: "prenom", r: (x) => esc(x.prenom || "—") },
      { t: "Compétition", k: "libelle_competition", r: (x) => esc(x.libelle_competition || "") + '<br><span class="mut tiny">' + esc(x.niveau_administratif || x.format || "") + "</span>" },
      { t: "Rencontre", k: "recevant", r: (x) => esc([x.recevant, x.visiteur_evenement].filter(Boolean).join(" – ")) + '<br><span class="mut tiny">' + esc(x.ville || "") + "</span>" },
      { t: "Rôle", k: "mon_role", r: (x) => esc(x.mon_role || "") }, { t: "Collègue", k: "collegue_nom", r: (x) => esc(x.collegue_nom || "—") },
      { t: "Km A/R", k: (x) => Number(x.km_a_r_stats) || 0, cl: "num right", r: (x) => esc(x.km_a_r_stats || "—") }, { t: "Indemnité", k: (x) => Number(x.indemnite_totale) || 0, cl: "num right", r: (x) => (x.indemnite_totale != null ? esc(x.indemnite_totale) + " €" : "—") },
    ], l, { recherche: rechercheCourante, clic: (x) => ficheDe(x.user_id) });
  };

  // ---- Paiements (tous les arbitres)
  rendus.paiements = async function (force) {
    const el = $("sec-paiements");
    if (force || !cache.paiements) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.paiements = await admin("paiements.global"); }
    const d = cache.paiements, t = d.total || {}, l = d.par_arbitre || [];
    el.innerHTML = '<p class="mut tiny">Matchs passés seulement (hors annulés). « En retard » : date de paiement prévue dépassée ou statut « En retard ». Un historique importé jamais pointé apparaît en retard : fiche → Matchs → « Solder l\'historique… » (à la demande de l\'arbitre).</p>' +
      '<div class="tiles">' + tuileB(euro(t.recu), "Reçu", "green") + tuileB(euro(t.attendu), "À recevoir (dans les délais)", "") + tuileB(euro(t.retard), "En retard", "red") + tuileB((d.retards || []).length, "Matchs en retard", "red") + "</div>" +
      '<div class="card"><div class="card-head"><h3>Par arbitre</h3><span class="sub">clic = fiche</span></div><div id="paT"></div></div><div class="card"><div class="card-head"><h3>Retards</h3><span class="sub">du plus ancien au plus récent</span></div><div id="paR"></div></div>';
    tableau(el.querySelector("#paT"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(nomDe({ prenom: x.prenom, nom_ffbb: x.nom })) }, { t: "Reçu", k: "recu", cl: "num right", r: (x) => euro(x.recu) + ' <span class="mut tiny">(' + x.n_recu + ")</span>" },
      { t: "À recevoir", k: "attendu", cl: "num right", r: (x) => euro(x.attendu) + ' <span class="mut tiny">(' + x.n_attendu + ")</span>" }, { t: "En retard", k: "retard", cl: "num right", r: (x) => (x.retard ? '<b class="err">' + euro(x.retard) + "</b>" : euro(0)) + ' <span class="mut tiny">(' + x.n_retard + ")</span>" },
      { t: "Bénévole", k: "benevole", cl: "num right", r: (x) => esc(x.benevole) }, { t: "Saisons en retard", k: (x) => Object.keys(x.saisons).filter((k) => x.saisons[k].retard).length, r: (x) => esc(Object.keys(x.saisons).filter((k) => x.saisons[k].retard).sort().join(", ") || "—") },
    ], l, { tri: "En retard", sens: -1, clic: (x) => ficheDe(x.user_id) });
    tableCourante = tableau(el.querySelector("#paR"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(x.prenom || "—") }, { t: "Match", k: "date", r: (x) => esc(fmtD(x.date)) }, { t: "Prévu le", k: "attendue", r: (x) => esc(x.attendue ? fmtD(x.attendue) : "—") },
      { t: "Compétition", k: "libelle", r: (x) => esc(x.libelle || "") + '<br><span class="mut tiny">' + esc(x.rencontre || "") + "</span>" }, { t: "Payeur", k: "payeur", r: (x) => esc(x.payeur || "—") }, { t: "Montant", k: "montant", cl: "num right", r: (x) => esc(x.montant) + " €" },
    ], d.retards || [], { recherche: rechercheCourante, clic: (x) => ficheDe(x.user_id) });
  };

  // ---- Alertes (tous les arbitres)
  let alSec = "action";
  rendus.alertes = async function (force) {
    const el = $("sec-alertes");
    if (force || !cache.alertesG) { el.innerHTML = '<p class="mut">Chargement…</p>'; cache.alertesG = await admin("alertes.global"); }
    const d = cache.alertesG, P = d.par_arbitre || [], I = d.items || [];
    const nR = P.reduce((t, x) => t + x.regler, 0), nA = P.reduce((t, x) => t + x.avant, 0), nI = P.reduce((t, x) => t + x.infos, 0);
    $("navAlertes").textContent = (nR + nA) || "";
    el.innerHTML = '<p class="mut tiny">Même tri que l\'onglet Alertes de l\'app : <b>À régler</b> (badge rouge chez l\'arbitre), <b>Avant le match</b> (match à venir incomplet), <b>Infos</b> (rien d\'obligatoire). Traiter / rétablir : fiche de l\'arbitre → Alertes.</p>' +
      '<div class="tiles">' + tuileB(nR, "À régler", "red") + tuileB(nA, "Avant le match", "orange") + tuileB(nI, "Infos", "") + tuileB(P.reduce((t, x) => t + x.traitees, 0), "Traitées", "green") + "</div>" +
      '<div class="card"><div class="card-head"><h3>Par arbitre</h3></div><div id="alP"></div></div><div class="card"><div class="card-head"><h3>Détail</h3><select id="alS"><option value="action">À régler + avant le match</option><option value="regler">À régler</option><option value="avant">Avant le match</option><option value="infos">Infos</option><option value="tout">Tout</option></select></div><div id="alI"></div></div>';
    el.querySelector("#alS").value = alSec; el.querySelector("#alS").onchange = (e) => { alSec = e.target.value; rendus.alertes(false); };
    tableau(el.querySelector("#alP"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(nomDe({ prenom: x.prenom, nom_ffbb: x.nom })) }, { t: "À régler", k: "regler", cl: "num right", r: (x) => (x.regler ? badge(x.regler, "red") : "0") },
      { t: "Avant le match", k: "avant", cl: "num right", r: (x) => (x.avant ? badge(x.avant, "orange") : "0") }, { t: "Infos", k: "infos", cl: "num right", r: (x) => esc(x.infos) }, { t: "Traitées", k: "traitees", cl: "num right", r: (x) => esc(x.traitees) },
    ], P, { tri: "À régler", sens: -1, clic: (x) => ficheDe(x.user_id) });
    const vue = I.filter((x) => alSec === "tout" || (alSec === "action" ? x.section !== "infos" : x.section === alSec));
    tableCourante = tableau(el.querySelector("#alI"), [
      { t: "Arbitre", k: "prenom", r: (x) => esc(x.prenom || "—") }, { t: "Date", k: "date", r: (x) => esc(fmtD(x.date)) },
      { t: "Type", k: "section", r: (x) => ({ regler: badge("À régler", "red"), avant: badge("Avant le match", "orange"), infos: badge("Info", "gray") }[x.section] || "") + '<br><span class="tiny">' + esc(x.titre) + "</span>" },
      { t: "Mission", k: "libelle", r: (x) => esc(x.libelle || "") + '<br><span class="mut tiny">' + esc(x.rencontre || "") + "</span>" }, { t: "Détail", k: (x) => (x.alertes || []).join(" "), r: (x) => '<span class="warn tiny">' + (x.alertes || []).map(esc).join("<br>") + "</span>" },
    ], vue, { recherche: rechercheCourante, clic: (x) => ficheDe(x.user_id) });
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
    "pub.mails": { titre: "Textes des e-mails", desc: "Sujet, titre et message des 4 e-mails envoyés aux arbitres (liste d'attente, demande reçue, guides, compte prêt) · immédiat" },
    "pub.fonctions_defaut": { titre: "Fonctions par défaut", desc: "Modules visibles pour un arbitre sans réglage perso (fiche → Fonctions) : Progression, e-Licence, classements · immédiat" },
  };
  const CARBS_ADM = [["", "— non précisé (E10) —"], ["e10", "SP95-E10"], ["sp95", "SP95"], ["sp98", "SP98"], ["gazole", "Gazole"], ["e85", "E85"], ["gplc", "GPL"], ["electrique", "Électrique"]];   // b86
  const LIB_FN = { ia: "IA (budget : Configuration → IA)", evaluations: "Progression (évaluations)", elicence: "e-Licence", classements: "Classements et enjeux" };   // b80
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
        F.innerHTML = '<div class="form-grid">' + num("bKm", "Indemnité kilométrique nationale (€/km A/R) — appliquée aux arbitres qui ont gardé 0,40", v.indemnite_km ?? 0.4, "0.01") + "</div>" + '<div class="row" style="align-items:flex-end;gap:8px;flex-wrap:wrap"><label class="f">Comité<select id="bCd">' + cles.map((x) => '<option value="' + esc(x) + '"' + (x === k ? " selected" : "") + ">" + esc(x.toUpperCase()) + "</option>").join("") + '</select></label><label class="f">Ajouter un comité<input id="bCdNew" placeholder="CD75" style="max-width:110px"></label><button class="btn sm" id="bCdAdd">+ Ajouter</button></div>' +
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
        lireForm = () => Object.assign({}, v, { indemnite_km: Math.min(2, Math.max(0, Number(F.querySelector("#bKm").value) || 0.4)), [k]: { designe: lireKv("bDe"), qr: lireKv("bQr"), interdepartemental: lireKv("bIn"), amicaux: lireKv("bAm") } });
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
          '<label class="f">Carburant par défaut (véhicule sans type)<select id="cCarb">' + carbs.map(([k, l]) => '<option value="' + k + '"' + ((v.carburant || "e10") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>" +
          '<div class="form-grid">' + num("cKwh", "Prix du kWh (véhicules électriques, €)", v.prix_kwh ?? 0.25, "0.001") + "</div>" +
          '<p class="mut tiny">b86 : chaque véhicule a son carburant (Mon profil de l\'arbitre, ou fiche → Moteur). Le moteur relève tous les carburants autour du domicile ; un mois sans relevé = prix E10 × rapport mesuré localement.</p>' +
          kv("cForce", "Prix imposé à tous pour un mois (AAAA-MM → €/L, en équivalent E10) — remplace le relevé automatique", v.force, "2026-11") +
          '<p class="mut tiny">Moins de 3 stations dans le rayon : le moteur élargit à 15 puis 25 km.</p>';
        lireForm = () => { const f = lireKv("cForce"), force = {}; Object.keys(f).forEach((k) => { if (/^\d{4}-\d{2}$/.test(k) && f[k] > 0.5 && f[k] < 4) force[k] = f[k]; });
          return { carburant: F.querySelector("#cCarb").value, prix_kwh: Math.min(1.5, Math.max(0.05, Number(F.querySelector("#cKwh").value) || 0.25)), rayon_km: Math.min(50, Math.max(3, Number(F.querySelector("#cRay").value) || 10)), fraicheur_jours: Math.min(30, Math.max(1, Number(F.querySelector("#cFr").value) || 7)), force }; };
      } else if (cfgCle === "pub.fonctions_defaut") {
        F.innerHTML = '<div class="row">' + ["ia", "evaluations", "elicence", "classements"].map((k) => chk("fd_" + k, LIB_FN[k] || k, v[k])).join("") + "</div>";
        lireForm = () => { const o = {}; ["ia", "evaluations", "elicence", "classements"].forEach((k) => (o[k] = F.querySelector("#fd_" + k).checked)); return o; };
      } else if (cfgCle === "pub.ia") {
        // b74 — même structure que le moteur (Ia.gs) : plafond en $ par moteur et par mois, part de chaque fonction en % (total ≤ 100).
        F.innerHTML = '<div class="form-grid">' + num("iaMax", "Plafond mensuel par arbitre (USD)", v.plafond_usd ?? 30) + "</div>" + kv("iaB", "Part du plafond par fonction (%) — convocations, evaluations, reglement, rapports, autre", v.budget_pct, "Fonction") + '<p class="mut tiny">Les convocations ne sont jamais bloquées, même au-delà de leur part.</p>';
        lireForm = () => ({ plafond_usd: Number(F.querySelector("#iaMax").value) || 0, budget_pct: lireKv("iaB") });
      } else if (cfgCle === "pub.beta") {
        F.innerHTML = '<div class="form-grid">' + num("btMax", "Nombre maximal de testeurs", v.max ?? 10, "1") + '</div><div class="row">' + chk("btOuv", "Inscriptions ouvertes", v.ouvert) + "</div>";
        lireForm = () => ({ max: Number(F.querySelector("#btMax").value) || 0, ouvert: F.querySelector("#btOuv").checked });
      } else if (cfgCle === "pub.mails") {
        // b85 — 4 modèles. Vide = texte d'origine. Le message s'ajoute sous « Bonjour Prénom, » ; code, liens et mode d'emploi restent automatiques.
        const MODS = [["attente", "Liste d'attente", "Referee Tracker — ta demande est sur liste d'attente", "Ta demande est sur liste d'attente", "{prenom}"],
          ["recue", "Demande reçue", "Referee Tracker — nous configurons ton compte", "Nous configurons ton compte", "{prenom}"],
          ["guides", "Guide et manuel (PDF joints)", "Referee Tracker — ton guide de démarrage et ton manuel", "Ton guide et ton manuel", "{prenom}"],
          ["compte_pret", "Compte prêt (code de 1re connexion)", "Ton compte Referee Tracker est prêt", "Ton compte est prêt !", "{prenom} {code} {adresse}"]];
        F.innerHTML = '<p class="mut tiny">Laisse un champ vide pour garder le texte d\'origine. Texte simple, sans HTML ; une ligne vide = nouveau paragraphe. Le code, les boutons, les liens des PDF et le mode d\'emploi du transfert sont toujours ajoutés automatiquement.</p>' +
          MODS.map(([k, t, sj, ti, vars]) => { const o = v[k] || {}; return '<div class="card" data-mail="' + k + '"><div class="card-head"><h3>' + esc(t) + '</h3><span class="sub">variables : ' + esc(vars) + "</span></div>" +
            '<div class="form-grid"><label class="f">Sujet<input data-c="sujet" maxlength="140" value="' + esc(o.sujet || "") + '" placeholder="' + esc(sj) + '"></label><label class="f">Titre dans le mail<input data-c="titre" maxlength="80" value="' + esc(o.titre || "") + '" placeholder="' + esc(ti) + '"></label></div>' +
            '<label class="f">Message ajouté sous « Bonjour {prenom}, »<textarea data-c="message" rows="3" maxlength="1500" style="font-family:inherit" placeholder="Ex. : Merci de faire partie des premiers testeurs !">' + esc(o.message || "") + "</textarea></label></div>"; }).join("");
        lireForm = () => { const o = {}; F.querySelectorAll("[data-mail]").forEach((c) => { const m = {}; c.querySelectorAll("[data-c]").forEach((x) => { const t = x.value.trim(); if (t) m[x.dataset.c] = t; }); if (Object.keys(m).length) o[c.dataset.mail] = m; }); return o; };
      } else if (cfgCle === "pub.textes") {
        // b81 — bandeau programmable (début / fin, style) + écran de maintenance personnalisable.
        const dt = (x) => (x ? String(x).slice(0, 16) : "");
        F.innerHTML = '<label class="f">Message du bandeau (vide = aucun)<textarea id="tBand" rows="3" maxlength="300" style="font-family:inherit">' + esc(v.bandeau || "") + "</textarea></label>" +
          '<div class="form-grid"><label class="f">Afficher à partir du (vide = tout de suite)<input type="datetime-local" id="tDeb" value="' + esc(dt(v.bandeau_debut)) + '"></label><label class="f">Jusqu\'au (vide = sans fin)<input type="datetime-local" id="tFin" value="' + esc(dt(v.bandeau_fin)) + '"></label>' +
          '<label class="f">Style<select id="tStyle">' + [["info", "Information (bleu)"], ["succes", "Bonne nouvelle (vert)"], ["alerte", "Alerte (orange)"]].map(([k, l]) => '<option value="' + k + '"' + ((v.bandeau_style || "info") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>" +
          '<div class="row" style="margin-top:8px">' + chk("tMaint", "Mode maintenance (l'app affiche un écran d'attente à tous, l'admin reste accessible)", v.maintenance) + "</div>" +
          '<label class="f">Texte de l\'écran de maintenance (vide = texte standard)<textarea id="tMaintTxt" rows="2" maxlength="300" style="font-family:inherit">' + esc(v.maintenance_texte || "") + "</textarea></label>";
        lireForm = () => ({ bandeau: F.querySelector("#tBand").value.trim(), bandeau_debut: F.querySelector("#tDeb").value || "", bandeau_fin: F.querySelector("#tFin").value || "", bandeau_style: F.querySelector("#tStyle").value, maintenance: F.querySelector("#tMaint").checked, maintenance_texte: F.querySelector("#tMaintTxt").value.trim() });
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
    // b80 — segments (comité, ligue, niveau) construits depuis les profils
    const valSeg = (a, k) => { const p = a.profil || {}; return k === "niveau" ? String(p.niveau || "") : String((p.zones || {})[k] || "").toUpperCase(); };
    const segOpts = (k) => [...new Set(l.map((a) => valSeg(a, k)).filter(Boolean))].sort().map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
    el.innerHTML = '<div class="grid-2 msg-grid"><div class="card"><div class="card-head"><h2>Nouveau message</h2><span class="sub">e-mail au design Referee Tracker et/ou notification sur le téléphone</span></div>' +
      '<label class="f">Destinataires<select id="msCible"><option value="actifs">Arbitres actifs (' + actifs + ')</option><option value="tous">Tous les comptes non suspendus (' + l.length + ")</option>" + l.map((a) => '<option value="' + a.id + '">' + esc(nomDe(a.profil, a.email)) + "</option>").join("") + "</select></label>" +
      '<div class="form-grid seg-grid"><label class="f">Comité<select id="msCd"><option value="">Tous</option>' + segOpts("cd") + '</select></label><label class="f">Ligue<select id="msLg"><option value="">Toutes</option>' + segOpts("ligue") + '</select></label><label class="f">Niveau<select id="msNiv"><option value="">Tous</option>' + segOpts("niveau") + "</select></label></div>" +
      '<p class="mut tiny" id="msCompte"></p>' +
      '<label class="f">Modèle<select id="msModele">' + MODELES_MSG.map((m, i) => '<option value="' + i + '">' + esc(m[1] && i ? m[0] : m[1]) + "</option>").join("") + "</select></label>" +
      '<label class="f">Sujet<input id="msSujet" maxlength="120" placeholder="Ex. : Nouvelle version de l\'application"></label>' +
      '<label class="f">Message<textarea id="msTxt" rows="9" style="font-family:inherit" placeholder="Commence automatiquement par « Bonjour Prénom, »."></textarea></label>' +
      '<label class="f">Type<select id="msType"><option value="service">Information de service (nouvelle version, maintenance, compte) · tous les destinataires</option><option value="promo">Promotion / nouveautés commerciales · sauf ceux qui s\'y sont opposés</option></select></label>' +
      '<label class="f">Canal<select id="msCanal"><option value="les2">E-mail + notification</option><option value="mail">E-mail seulement</option><option value="push">Notification seulement</option><option value="wa">WhatsApp (un clic par arbitre)</option></select></label>' +
      '<div id="msWa" class="wa-liste" hidden></div>' +
      '<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px"><button class="btn" id="msApercu">Aperçu</button><button class="btn" id="msTest">Envoyer un test à moi</button><button class="btn" id="msBrSave">Enregistrer le brouillon</button><button class="btn" id="msBrLoad">Reprendre le brouillon</button><button class="btn pri" id="msEnv">Envoyer</button></div></div>' +
      '<div class="card"><div class="card-head"><h2>Aperçu</h2><span class="sub">tel que l\'arbitre le recevra</span></div><div id="msPrev" class="mail-prev"><p class="mut">Rédige un message puis clique sur « Aperçu ».</p></div></div></div>' +
      '<div class="card" id="bandCard"></div>' +
      '<div class="card" id="diffCard"></div>' +
      '<div class="card"><div class="card-head"><h2>Historique des envois</h2><button class="btn sm" id="msHist">Afficher</button></div><div id="msHistZ"><p class="mut">Clique sur « Afficher ».</p></div></div>';
    // ---------- b80 : liste de diffusion (qui reçoit quoi, opposition, réinscription sur demande, export) ----------
    const etatComm = (a) => { const c = comm(a); return !c.date ? "non_informe" : c.offres === true ? "abonne" : "oppose"; };
    const diff = { q: "", etat: "", cd: "" };
    const rendDiff = () => {
      const z = $("diffCard"); if (!z) return;
      const nb = (f) => l.filter(f).length;
      let d = l.filter((a) => { const p = a.profil || {}; const t = (nomDe(p, a.email) + " " + a.email + " " + (p.telephone || "")).toLowerCase();
        return (!diff.q || t.includes(diff.q)) && (!diff.etat || etatComm(a) === diff.etat || (diff.etat === "wa" && comm(a).whatsapp === true && waNum(p.telephone))) && (!diff.cd || valSeg(a, "cd") === diff.cd); });
      z.innerHTML = '<div class="card-head"><h2>Liste de diffusion</h2><span class="sub">' + l.length + " compte(s) · seuls les abonnés reçoivent les offres ; les messages de service vont à tous</span></div>" +
        '<div class="tiles mini">' + [["abonne", "Abonnés offres", nb((a) => etatComm(a) === "abonne"), "green"], ["wa", "WhatsApp possible", nb((a) => comm(a).whatsapp === true && waNum((a.profil || {}).telephone)), "green"], ["oppose", "Opposés", nb((a) => etatComm(a) === "oppose"), "red"], ["non_informe", "Pas encore informés", nb((a) => etatComm(a) === "non_informe"), "orange"]].map((t) => '<div class="tile ' + t[3] + ' clic' + (diff.etat === t[0] ? " on" : "") + '" data-etat="' + t[0] + '"><b>' + t[2] + "</b><span>" + t[1] + "</span></div>").join("") + "</div>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0"><input id="dfQ" placeholder="Rechercher (nom, e-mail, téléphone)" value="' + esc(diff.q) + '" style="flex:1;min-width:200px"><select id="dfCd"><option value="">Tous comités</option>' + segOpts("cd").replace('value="' + esc(diff.cd) + '"', 'value="' + esc(diff.cd) + '" selected') + '</select><button class="btn sm" id="dfTous">Tout afficher</button><button class="btn sm" id="dfCsv">Exporter CSV (' + d.length + ")</button></div>" +
        '<div class="tbl"><table><thead><tr><th>Arbitre</th><th>Contact</th><th>Comité · ligue</th><th>Offres</th><th>WhatsApp</th><th>Choix</th><th></th></tr></thead><tbody>' +
        (d.length ? d.map((a) => { const p = a.profil || {}, c = comm(a), e = etatComm(a);
          return "<tr><td><strong>" + esc(nomDe(p, a.email)) + "</strong><br>" + badgeStatut(p.statut) + '</td><td class="tiny">' + esc(p.email_connexion || a.email || "") + "<br>" + esc(p.telephone || "—") + '</td><td class="tiny">' + esc(valSeg(a, "cd") || "—") + " · " + esc(valSeg(a, "ligue") || "—") + "</td><td>" + (e === "abonne" ? badge("abonné", "green") : e === "oppose" ? badge("opposé", "red") : badge("pas informé", "orange")) + "</td><td>" + (c.whatsapp === true && waNum(p.telephone) ? badge("oui", "green") : badge(p.telephone ? "non" : "sans n°", "")) + '</td><td class="tiny mut">' + (c.date ? fmt(c.date) + "<br>" + esc(c.source || "") : "—") + "</td><td>" +
            (e === "abonne" || c.whatsapp === true ? '<button class="btn sm" data-dret="' + a.id + '">Retirer</button>' : "") + (e !== "abonne" ? ' <button class="btn sm" data-drein="' + a.id + '">Réinscrire (sur demande)</button>' : "") + "</td></tr>"; }).join("") : '<tr><td colspan="7" class="vide">Aucun compte</td></tr>') + "</tbody></table></div>" +
        '<p class="mut tiny">Pas encore informés : comptes créés avant le choix « Je ne souhaite pas les recevoir » ; le choix leur est demandé à la prochaine connexion. Réinscrire n\'est permis qu\'à la demande de l\'arbitre (motif journalisé).</p>';
      z.querySelectorAll("[data-etat]").forEach((t) => t.addEventListener("click", () => { diff.etat = diff.etat === t.dataset.etat ? "" : t.dataset.etat; rendDiff(); }));
      const q = z.querySelector("#dfQ"); q.addEventListener("input", () => { diff.q = q.value.trim().toLowerCase(); const pos = q.selectionStart; rendDiff(); const q2 = $("dfQ"); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} });
      z.querySelector("#dfCd").addEventListener("change", (e) => { diff.cd = e.target.value; rendDiff(); });
      z.querySelector("#dfTous").addEventListener("click", () => { diff.q = ""; diff.etat = ""; diff.cd = ""; rendDiff(); });
      z.querySelector("#dfCsv").addEventListener("click", () => {
        const cel = (v) => { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
        const lignes = [["Prénom", "Nom", "E-mail", "Téléphone", "Statut", "Comité", "Ligue", "Niveau", "Offres", "WhatsApp", "Choix le", "Source"]].concat(d.map((a) => { const p = a.profil || {}, c = comm(a); return [p.prenom, p.nom_ffbb, p.email_connexion || a.email, p.telephone, p.statut, valSeg(a, "cd"), valSeg(a, "ligue"), p.niveau, etatComm(a), c.whatsapp === true ? "oui" : "non", c.date ? fmt(c.date) : "", c.source || ""]; }));
        const blob = new Blob(["\ufeff" + lignes.map((r) => r.map(cel).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const lien = document.createElement("a"); lien.href = URL.createObjectURL(blob); lien.download = "referee-tracker-diffusion-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.appendChild(lien); lien.click(); setTimeout(() => { URL.revokeObjectURL(lien.href); lien.remove(); }, 500); });
      z.querySelectorAll("[data-dret]").forEach((b) => b.addEventListener("click", async () => { const a = l.find((x) => x.id === b.dataset.dret);
        if (!(await confirmer("Retirer de la liste", "Retirer <strong>" + esc(nomDe(a.profil, a.email)) + "</strong> des offres (e-mail et WhatsApp) ? Les messages de service continuent.", "Retirer", true))) return;
        try { const j = await admin("communications.retirer", { user_id: a.id, canal: "tout" }); a.profil.communications = j.communications; toast("Retiré de la liste", "ok"); rendDiff(); majCompte(); } catch (e) { toast(e.message, "err"); } }));
      z.querySelectorAll("[data-drein]").forEach((b) => b.addEventListener("click", async () => { const a = l.find((x) => x.id === b.dataset.drein);
        const motif = await saisir("Réinscrire à la demande de l'arbitre", "Uniquement si <strong>" + esc(nomDe(a.profil, a.email)) + "</strong> l'a demandé. Indique comment et quand (journalisé).", "Ex. : demande par e-mail du 09/11", (v) => v.length < 5 ? "Motif obligatoire" : null, "Réinscrire");
        if (!motif) return;
        try { const j = await admin("communications.reinscrire", { user_id: a.id, canal: (a.profil || {}).telephone ? "tout" : "offres", motif }); a.profil.communications = j.communications; toast("Réinscrit aux offres", "ok"); rendDiff(); majCompte(); } catch (e) { toast(e.message, "err"); } }));
    };
    setTimeout(rendDiff, 0);
    // ---------- b84 : bandeau affiché en haut de l'app de tous les arbitres (maintenance, sauvegarde, nouveauté) ----------
    const MODELES_BANDEAU = [["", "— Modèle —", "info"], ["maint", "Maintenance prévue ce soir de 22 h à 23 h : l'app peut être indisponible quelques minutes.", "alerte"], ["sauv", "Sauvegarde en cours : tes données sont protégées, certaines mises à jour peuvent prendre quelques minutes de plus.", "info"], ["nouv", "Nouvelle version disponible : recharge l'app pour en profiter.", "succes"], ["inc", "Incident en cours sur la lecture des convocations : nous corrigeons, rien n'est perdu.", "alerte"]];
    const rendBandeau = async () => {
      const z = $("bandCard"); if (!z) return;
      let v = {}; try { if (!cache.config) cache.config = await admin("config.get"); v = ((cache.config.data || []).find((r) => r.cle === "pub.textes") || {}).valeur || {}; } catch (e) {}
      const actif = String(v.bandeau || "").trim(), dt = (x) => (x ? String(x).slice(0, 16) : "");
      z.innerHTML = '<div class="card-head"><h2>Bandeau dans l\'app</h2><span class="sub">' + (actif ? "en ligne : « " + esc(actif.slice(0, 80)) + (actif.length > 80 ? "…" : "") + " »" : "aucun bandeau affiché") + "</span></div>" +
        '<div class="form-grid"><label class="f">Modèle<select id="bdMod">' + MODELES_BANDEAU.map((m, i) => '<option value="' + i + '">' + esc(m[0] ? m[1].slice(0, 60) + "…" : m[1]) + "</option>").join("") + '</select></label>' +
        '<label class="f">Style<select id="bdSty">' + [["info", "Information (bleu)"], ["succes", "Bonne nouvelle (vert)"], ["alerte", "Alerte (orange)"]].map(([k, l]) => '<option value="' + k + '"' + ((v.bandeau_style || "info") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>" +
        '<label class="f">Texte (300 caractères max)<textarea id="bdTxt" rows="2" maxlength="300" style="font-family:inherit">' + esc(actif) + "</textarea></label>" +
        '<div class="form-grid"><label class="f">Afficher à partir du (vide = tout de suite)<input type="datetime-local" id="bdDeb" value="' + esc(dt(v.bandeau_debut)) + '"></label><label class="f">Jusqu\'au (vide = sans fin)<input type="datetime-local" id="bdFin" value="' + esc(dt(v.bandeau_fin)) + '"></label></div>' +
        '<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn pri" id="bdPub">Publier le bandeau</button><button class="btn" id="bdOff">Retirer le bandeau</button><span class="mut tiny">Visible à la prochaine ouverture de l\'app (ou rechargement). Le mode maintenance complet se règle dans Configuration.</span></div>';
      z.querySelector("#bdMod").addEventListener("change", (e) => { const m = MODELES_BANDEAU[Number(e.target.value)]; if (m && m[0]) { z.querySelector("#bdTxt").value = m[1]; z.querySelector("#bdSty").value = m[2]; } });
      const ecrire = async (nv) => { try { await admin("config.set", { cle: "pub.textes", valeur: Object.assign({}, v, nv) }); cache.config = null; toast(nv.bandeau ? "Bandeau publié" : "Bandeau retiré", "ok"); rendBandeau(); } catch (e) { toast(e.message, "err"); } };
      z.querySelector("#bdPub").addEventListener("click", () => { const t = z.querySelector("#bdTxt").value.trim(); if (t.length < 5) return toast("Texte trop court", "err"); ecrire({ bandeau: t, bandeau_style: z.querySelector("#bdSty").value, bandeau_debut: z.querySelector("#bdDeb").value || "", bandeau_fin: z.querySelector("#bdFin").value || "" }); });
      z.querySelector("#bdOff").addEventListener("click", () => ecrire({ bandeau: "", bandeau_debut: "", bandeau_fin: "" }));
    };
    setTimeout(rendBandeau, 0);
    $("msModele").addEventListener("change", (e) => { const m = MODELES_MSG[Number(e.target.value)]; if (m && m[0] && Number(e.target.value)) { $("msSujet").value = m[0]; $("msTxt").value = m[1]; } });
    const apercu = () => { const sujet = $("msSujet").value.trim() || "Sujet", texte = $("msTxt").value.trim() || "…";
      $("msPrev").innerHTML = '<div class="mp-head">REFEREE <b>TRACKER</b></div><div class="mp-body"><h3>' + esc(sujet) + "</h3><p>Bonjour Prénom,</p>" + texte.split(/\n{2,}/).map((x) => "<p>" + esc(x).replace(/\n/g, "<br>") + "</p>").join("") + '<span class="mp-btn">Ouvrir l\'application</span><small>Message de l\'équipe Referee Tracker · une question ? contact@referee-tracker.fr</small></div>'; };
    $("msApercu").addEventListener("click", apercu); $("msTxt").addEventListener("input", apercu); $("msSujet").addEventListener("input", apercu);
    // Destinataires réels selon cible + type (promo = consentement « offres » ; WhatsApp = consentement « whatsapp » + numéro).
    const destinataires = () => { const c = $("msCible").value, promo = $("msType").value === "promo";
      let d = c === "tous" ? l : c === "actifs" ? l.filter((a) => (a.profil || {}).statut === "actif") : l.filter((a) => a.id === c);
      if (promo) d = d.filter((a) => comm(a).offres === true);
      const cd = $("msCd").value, lg = $("msLg").value, nv = $("msNiv").value;
      if (cd) d = d.filter((a) => valSeg(a, "cd") === cd); if (lg) d = d.filter((a) => valSeg(a, "ligue") === lg); if (nv) d = d.filter((a) => valSeg(a, "niveau") === nv);
      return d; };
    const filtres = () => { const o = {}; if ($("msCd").value) o.cd = [$("msCd").value]; if ($("msLg").value) o.ligue = [$("msLg").value]; if ($("msNiv").value) o.niveau = [$("msNiv").value]; return o; };
    const majCompte = () => { const d = destinataires(); $("msCompte").textContent = d.length + " destinataire(s) : " + d.slice(0, 12).map((a) => (a.profil || {}).prenom || a.email).join(", ") + (d.length > 12 ? "…" : ""); };
    ["msCible", "msType", "msCd", "msLg", "msNiv"].forEach((id) => $(id).addEventListener("change", majCompte)); setTimeout(majCompte, 0);
    const majWa = () => { const z = $("msWa"), wa = $("msCanal").value === "wa"; z.hidden = !wa; $("msEnv").hidden = wa; if (!wa) return;
      const sujet = $("msSujet").value.trim(), texte = $("msTxt").value.trim(); let envoyes = {}; try { envoyes = JSON.parse(localStorage.getItem("rt-wa-envoyes") || "{}"); } catch (e) {}
      const d = destinataires(), ok = d.filter((a) => comm(a).whatsapp === true && waNum((a.profil || {}).telephone)), exclus = d.length - ok.length;
      z.innerHTML = '<p class="mut tiny">WhatsApp ne permet pas l\'envoi groupé depuis un site : chaque bouton ouvre la conversation avec le message déjà écrit, tu n\'as plus qu\'à appuyer sur Envoyer. Seuls les arbitres qui ne se sont pas opposés à WhatsApp et dont le numéro est connu apparaissent' + (exclus ? " (" + exclus + " exclu(s) : opposition ou pas de numéro)" : "") + ".</p>" +
        (ok.length ? ok.map((a) => { const p = a.profil || {}, k = a.id + "|" + sujet; const msg = "Bonjour " + (p.prenom || "") + ",\n\n" + (sujet ? "*" + sujet + "*\n\n" : "") + texte + ($("msType").value === "promo" ? "\n\n(Réponds STOP pour ne plus recevoir ces messages.)" : "") + "\n\n— Referee Tracker";
          return '<div class="wa-l"><strong>' + esc(nomDe(p, a.email)) + '</strong><span class="mut tiny">' + esc(p.telephone || "") + '</span><span class="sp"></span>' + (envoyes[k] ? badge("ouvert", "green") : "") + '<a class="btn sm wa-btn" target="_blank" rel="noopener" data-k="' + esc(k) + '" href="' + esc(waLien(p.telephone, msg)) + '">WhatsApp</a></div>'; }).join("") : '<p class="vide">Aucun destinataire WhatsApp.</p>');
      z.querySelectorAll(".wa-btn").forEach((b) => b.addEventListener("click", () => { try { const e = JSON.parse(localStorage.getItem("rt-wa-envoyes") || "{}"); e[b.dataset.k] = Date.now(); localStorage.setItem("rt-wa-envoyes", JSON.stringify(e)); } catch (x) {} setTimeout(majWa, 300); })); };
    ["msCible", "msType", "msCanal", "msCd", "msLg", "msNiv"].forEach((id) => $(id).addEventListener("change", majWa)); ["msSujet", "msTxt"].forEach((id) => $(id).addEventListener("input", () => { if ($("msCanal").value === "wa") majWa(); }));
    $("msEnv").addEventListener("click", async () => {
      const cible = $("msCible").value, sujet = $("msSujet").value.trim(), texte = $("msTxt").value.trim(), canal = $("msCanal").value, type = $("msType").value;
      if (sujet.length < 3 || texte.length < 3) return toast("Sujet et message obligatoires", "err");
      const lib = $("msCible").selectedOptions[0].textContent;
      if (!(await confirmer("Envoyer le message", "Envoyer « " + esc(sujet) + " » à <strong>" + esc(lib) + "</strong> (" + destinataires().length + " destinataire(s) après filtres)" + (type === "promo" ? " (sauf ceux qui se sont opposés aux offres : " + destinataires().length + ")" : "") + " ? Chaque arbitre reçoit son propre e-mail (aucune adresse visible des autres).", "Envoyer"))) return;
      try { const j = await admin("message.envoyer", { cible, sujet, texte, canal, type, filtres: filtres() }); try { localStorage.removeItem("rt-msg-brouillon"); } catch (e) {} toast(j.destinataires + " destinataire(s) · " + j.mails + " e-mail(s) · " + j.pushs + " notification(s)", "ok"); $("msTxt").value = ""; } catch (e) { toast(e.message, "err"); }
    });
    // b80 — test à soi-même, brouillon (gardé dans ce navigateur)
    $("msTest").addEventListener("click", async () => { const sujet = $("msSujet").value.trim(), texte = $("msTxt").value.trim();
      if (sujet.length < 3 || texte.length < 3) return toast("Sujet et message obligatoires", "err");
      try { const j = await admin("message.envoyer", { cible: $("msCible").value, sujet, texte, canal: "mail", type: $("msType").value, filtres: filtres(), test: true }); toast(j.ok ? "Test envoyé à " + j.a + " (" + j.destinataires_reels + " destinataire(s) réel(s))" : "Envoi du test impossible", j.ok ? "ok" : "err"); } catch (e) { toast(e.message, "err"); } });
    $("msBrSave").addEventListener("click", () => { try { localStorage.setItem("rt-msg-brouillon", JSON.stringify({ sujet: $("msSujet").value, texte: $("msTxt").value, type: $("msType").value, canal: $("msCanal").value, cd: $("msCd").value, lg: $("msLg").value, nv: $("msNiv").value, le: Date.now() })); toast("Brouillon enregistré (dans ce navigateur)", "ok"); } catch (e) { toast("Impossible d'enregistrer", "err"); } });
    $("msBrLoad").addEventListener("click", () => { let b = null; try { b = JSON.parse(localStorage.getItem("rt-msg-brouillon") || "null"); } catch (e) {} if (!b) return toast("Aucun brouillon", "err");
      $("msSujet").value = b.sujet || ""; $("msTxt").value = b.texte || ""; $("msType").value = b.type || "service"; $("msCanal").value = b.canal || "les2"; $("msCd").value = b.cd || ""; $("msLg").value = b.lg || ""; $("msNiv").value = b.nv || ""; majCompte(); apercu(); toast("Brouillon repris", "ok"); });
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
        courant === "alertes" ? null : admin("alertes.global").then((j) => { cache.alertesG = j; const P = j.par_arbitre || []; $("navAlertes").textContent = P.reduce((t, x) => t + x.regler + x.avant, 0) || ""; }),
        courant === "moteurs" ? null : admin("moteurs.liste").then((j) => { cache.moteurs = j.data || []; $("navMoteurs").textContent = cache.moteurs.filter((x) => x.sante === "arrete" || x.sante === "lent").length || ""; }),
      ].filter(Boolean));
    } catch (e) {
      if (/AUTH_REQUIRED/.test(e.message)) return voir("vLogin");
      erreur(e);
    }
  }
  demarrer();
})();
