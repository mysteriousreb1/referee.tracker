/* =====================================================
   REFEREE TRACKER — INTERFACE GITHUB PAGES
   Connectée à Google Apps Script via rt-auth.js (POST authentifié).
   Carte : OpenStreetMap (Leaflet) + itinéraire OSRM.
   Stats : calculées côté serveur (endpoint action=stats).
   ===================================================== */

/* "Bénévole" : match arbitré gratuitement, en accord avec le club recevant.
   Rien n'est dû : ces missions sortent du restant à encaisser et des retards. */
const PAYMENT_STATUSES = ["À recevoir", "Reçu partiel", "Reçu", "Bénévole", "Écart à vérifier", "À vérifier"];
const BENEVOLE = "Bénévole";

let state = {
  allRows: [],
  filteredRows: [],
  serverStats: null,
  prixActuel: null,        // prix E10 temps réel, fourni par le serveur
  activeTab: "matchs",
  selectedSeason: "",
  search: "",
  searchTokens: [],
  maps: {},
  exportSeason: "",   // filtres propres à l'onglet Export
  exportMonth: "",
  qcmStats: null,      // MODIFICATION 19/09/2026 — suivi progression QCM
  qcmBank: null,        // banque de questions (data/questions.json)
  qcmSession: null,      // série QCM en cours (20 questions, 10 min)
  formations: null,       // MODIFICATION 19/09/2026 — déplacements formation non rémunérés
  niveaux: null,           // MODIFICATION 18/09/2026 — historique niveau d'arbitrage (onglet Progression)
  evaluations: null,        // MODIFICATION 19/09/2026 — dépôt PDF d'évaluations (onglet Progression)
  statsSubView: "overview",  // MODIFICATION 19/09/2026 — Stats/Analyse fusionnés : "overview" ou "avancee"
  agendaCursor: null,         // MODIFICATION 19/09/2026 — onglet Agenda : 1er jour du mois affiché
  agendaSelectedDate: null,   // jour sélectionné dans le calendrier ("YYYY-MM-DD")
  contacts: null,             // MODIFICATION 19/09/2026 — onglet Contacts & Procédures
  procedures: null,
  contactsSubView: "contacts", // "contacts" ou "procedures"
  contactsSearch: "",
  filterNiveau: "",   // MODIFICATION 19/09/2026 — filtres rapides toolbar
  filterStatut: "",
  filterFormat: "",
  classements: null   // MODIFICATION 19/09/2026 — classement équipes / enjeu du match
};

/* ---------------- Thème clair / sombre (19/09/2026) ----------------
   Choix mémorisé en localStorage (site déployé, origine propre — sans
   risque, contrairement à un artifact Claude). Par défaut : on respecte
   prefers-color-scheme du système si rien n'est enregistré, sinon clair. */

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("rt-theme"); } catch (e) { /* stockage indisponible : on ignore */ }
  const theme = saved === "dark" || saved === "light"
    ? saved
    : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const sun = document.getElementById("themeIconSun");
  const moon = document.getElementById("themeIconMoon");
  if (sun) sun.style.display = theme === "dark" ? "none" : "";
  if (moon) moon.style.display = theme === "dark" ? "" : "none";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("rt-theme", next); } catch (e) { /* stockage indisponible : on ignore, le choix ne persiste pas */ }
}


document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindUi();
  buildSeasonSelect();
  // loadData() est déclenché par rt-auth.js une fois l'utilisateur authentifié.
  setTimeout(verifierAffichageInitial, 1500);
  setTimeout(verifierAffichageInitial, 5000);
});

function bindUi() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const statsSubOverviewBtn = document.getElementById("statsSubOverviewBtn");
  const statsSubAvanceeBtn = document.getElementById("statsSubAvanceeBtn");
  if (statsSubOverviewBtn) statsSubOverviewBtn.addEventListener("click", () => setStatsSubView_("overview"));
  if (statsSubAvanceeBtn) statsSubAvanceeBtn.addEventListener("click", () => setStatsSubView_("avancee"));

  const refresh = document.getElementById("refreshBtn");
  refresh.addEventListener("click", () => {
    refresh.classList.remove("spin");
    void refresh.offsetWidth;
    refresh.classList.add("spin");
    loadData();
  });

  document.getElementById("seasonSelect").addEventListener("change", e => {
    state.selectedSeason = e.target.value;
    state.serverStats = null;   // les stats en mémoire portent sur l'ancienne saison
    buildQuickFilterSelects_();
    loadStats();
    renderAll();
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    state.search = normaliserRecherche(e.target.value);
    state.searchTokens = state.search ? state.search.split(" ") : [];
    renderAll();
  });

  // Filtres rapides Niveau / Paiement / Format (19/09/2026), repliés dans un
  // menu déroulant "Filtre" (20/09/2026) pour alléger la barre de recherche.
  document.getElementById("filterNiveauSelect").addEventListener("change", e => {
    state.filterNiveau = e.target.value;
    updateFilterBadge_();
    renderAll();
  });
  document.getElementById("filterStatutSelect").addEventListener("change", e => {
    state.filterStatut = e.target.value;
    updateFilterBadge_();
    renderAll();
  });
  document.getElementById("filterFormatSelect").addEventListener("change", e => {
    state.filterFormat = e.target.value;
    updateFilterBadge_();
    renderAll();
  });

  const filterBtn = document.getElementById("filterDropdownBtn");
  const filterPanel = document.getElementById("filterDropdownPanel");
  if (filterBtn && filterPanel) {
    filterBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      const open = filterPanel.hasAttribute("hidden");
      if (open) filterPanel.removeAttribute("hidden"); else filterPanel.setAttribute("hidden", "");
      filterBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    filterPanel.addEventListener("click", ev => ev.stopPropagation());
    document.addEventListener("click", () => {
      if (!filterPanel.hasAttribute("hidden")) {
        filterPanel.setAttribute("hidden", "");
        filterBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && !filterPanel.hasAttribute("hidden")) {
        filterPanel.setAttribute("hidden", "");
        filterBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  const filterResetBtn = document.getElementById("filterResetBtn");
  if (filterResetBtn) {
    filterResetBtn.addEventListener("click", () => {
      state.filterNiveau = "";
      state.filterStatut = "";
      state.filterFormat = "";
      ["filterNiveauSelect", "filterStatutSelect", "filterFormatSelect"].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.value = "";
      });
      updateFilterBadge_();
      renderAll();
    });
  }
}

/* Nombre de filtres actifs affiché en pastille sur le bouton "Filtre". */
function updateFilterBadge_() {
  const badge = document.getElementById("filterActiveCount");
  if (!badge) return;
  const n = [state.filterNiveau, state.filterStatut, state.filterFormat].filter(Boolean).length;
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

/* Remplit les 3 <select> de filtre rapide à partir des valeurs réellement
   présentes dans les données de la saison sélectionnée — pas de liste en
   dur qui se désynchroniserait du barème/des libellés FFBB. */
function buildQuickFilterSelects_() {
  const rows = state.allRows.filter(r =>
    state.selectedSeason === "Toutes les saisons" || r._season === state.selectedSeason
  );

  const fillSelect = (id, values, current) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const opts = ["Tous", ...values];
    sel.innerHTML = opts.map(v =>
      `<option value="${v === "Tous" ? "" : escapeHtml(v)}">${escapeHtml(v)}</option>`
    ).join("");
    sel.value = current || "";
  };

  const niveaux = [...new Set(rows.map(r => cleanText(get(r, "Niveau administratif"))).filter(Boolean))].sort();
  fillSelect("filterNiveauSelect", niveaux, state.filterNiveau);

  const statuts = [...new Set(rows.map(r => cleanText(get(r, "Statut paiement"))).filter(Boolean))].sort();
  fillSelect("filterStatutSelect", statuts, state.filterStatut);

  const formats = [...new Set(rows.map(r => r._format).filter(Boolean))].sort();
  fillSelect("filterFormatSelect", formats, state.filterFormat);

  updateFilterBadge_();
}

/* ---------------- Saisons ---------------- */

function buildSeasonSelect() {
  const select = document.getElementById("seasonSelect");
  select.innerHTML = "";
  const options = ["Toutes les saisons", ...getSeasonsFrom2022ToCurrent()];
  options.forEach(season => {
    const opt = document.createElement("option");
    opt.value = season;
    opt.textContent = season;
    select.appendChild(opt);
  });
  const current = getCurrentSeason();
  state.selectedSeason = current;
  select.value = current;
}

function getCurrentSeason() {
  const now = new Date();
  const switchDate = new Date(now.getFullYear(), 6, 30);
  const startYear = now >= switchDate ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}/${startYear + 1}`;
}

function getSeasonsFrom2022ToCurrent() {
  const current = getCurrentSeason();
  const currentStartYear = Number(current.split("/")[0]);
  const seasons = [];
  for (let y = 2022; y <= currentStartYear; y++) seasons.push(`${y}/${y + 1}`);
  return seasons;
}

/* ---------------- Tabs ---------------- */

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === tab));
  renderAll();
  if (tab === "qcm" && !state.qcmStats) loadQcmStats();
}

/* ---------------- Chargement données ---------------- */

function loadData() {
  setStatus("Chargement des données…", "");
  jsonp("matchs")
    .then(res => {
      if (!res.success) throw new Error(res.error || "Erreur API");
      state.allRows = normalizeRows(res.data || []);
      setStatus(`${state.allRows.length} ligne(s) chargée(s)`, "ok");
      buildQuickFilterSelects_();

      // L'affichage d'abord, et rien entre les deux. Les statistiques serveur
      // sont un supplément : si leur appel échoue, la liste doit rester à
      // l'écran. C'est l'inverse qui se produisait — une erreur dans
      // loadStats() sautait le rendu et laissait la page à zéro match.
      renderAll();

      try { loadStats(); } catch (e) { console.warn("Stats serveur indisponibles :", e); }
      try { loadPrixCarburant(); } catch (e) { console.warn("Prix carburant indisponible :", e); }
      try { loadClassements(); } catch (e) { console.warn("Classements FFBB indisponibles :", e); }
    })
    .catch(showApiError);
}

/* Filet de sécurité au démarrage.
   Si des lignes sont chargées mais que l'écran affiche encore une liste vide,
   c'est qu'un rendu a été manqué : on le rejoue. Une seule fois, et seulement
   dans ce cas précis — jamais en boucle. */
function verifierAffichageInitial() {
  if (state.allRows.length && !state.filteredRows.length) {
    const auraitDuAfficher = filterRows(state.allRows).length;
    if (auraitDuAfficher) {
      console.warn("Rendu manqué au démarrage : " + auraitDuAfficher + " mission(s) réaffichée(s).");
      renderAll();
    }
  }
}

/* Affiche l'erreur API + la marche à suivre, au lieu d'une phrase opaque. */
function showApiError(err) {
  const message = (err && err.message) || "erreur inconnue";
  const hint = (err && err.hint) || "";
  setStatus("Impossible de contacter l’API Apps Script : " + message, "error");

  const panel = document.getElementById("matchs");
  if (!panel) return;
  panel.innerHTML = `
    <div class="empty" style="text-align:left">
      <div style="font-size:16px;color:var(--danger);margin-bottom:8px">Connexion à l’API impossible</div>
      <div style="font-weight:600;margin-bottom:10px">${escapeHtml(message)}</div>
      ${hint ? `<div style="font-weight:500;line-height:1.5;color:var(--muted)">${escapeHtml(hint)}</div>` : ""}
      <div style="margin-top:14px">
        <a class="action-link secondary" href="${escapeHtml(buildApiUrl("ping", {}))}" target="_blank" rel="noopener">
          Tester l’URL de l’API dans un onglet
        </a>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">
        Si cet onglet affiche <code>{"success":true,"message":"pong"}</code>, l’API va bien : le problème vient du navigateur (extension, blocage réseau).
        S’il affiche une page Google ou une erreur, c’est le déploiement qu’il faut corriger.
      </div>
    </div>`;
}

/* Prix E10 courant, tel que le serveur le voit. Les matchs à venir n'ont pas
   encore de relevé mensuel : sans cette valeur, le navigateur retomberait sur
   le dernier mois connu et annoncerait un carburant différent du serveur. */
function loadPrixCarburant() {
  jsonp("config")
    .then(res => {
      const p = res && res.config ? Number(res.config.prix_e10_actuel) : 0;
      if (p > 0.5 && p < 4 && p !== state.prixActuel) {
        state.prixActuel = p;
        renderAll();          // les coûts affichés changent
      }
    })
    .catch(() => { /* on garde la table mensuelle en repli */ });
}

/* Classement équipes / enjeu du match (19/09/2026) — mis à jour côté
   serveur une fois par semaine, sans IA (voir ClassementFFBB.gs). Un échec
   ici ne doit jamais bloquer l'affichage des matchs : la carte s'affiche
   simplement sans le bandeau enjeu. */
function loadClassements() {
  jsonp("classements")
    .then(res => {
      state.classements = (res && res.success) ? (res.data || []) : [];
      renderAll();
    })
    .catch(() => { state.classements = state.classements || []; });
}

function classementPour_(codeClub, codeCompetition) {
  if (!state.classements || !codeClub || !codeCompetition) return null;
  const cc = String(codeCompetition).toUpperCase();
  return state.classements.find(r =>
    String(r["Code club"]) === String(codeClub) &&
    String(r["Code compétition"]).toUpperCase() === cc
  ) || null;
}

/* @param {boolean} force  ignore le cache et interroge le serveur.
   Nécessaire quand l'entrée en cache porte sur une autre saison : sa clé
   est pourtant la bonne, seul son contenu est périmé. */
function loadStats(force) {
  const demandee = state.selectedSeason;
  const appel = (force && typeof jsonpFrais === "function") ? jsonpFrais : jsonp;
  appel("stats", { season: demandee })
    .then(res => {
      if (res && res.success && res.stats) {
        state.serverStats = res.stats;
        state._statsEnAttente = false;
        if (state.activeTab === "stats") renderStats();
      }
    })
    .catch(err => {
      // Jamais bloquant pour le reste de l'app, mais on le dit dans l'onglet
      // Stats plutôt que de laisser un « chargement… » éternel.
      state._statsEnAttente = false;
      console.warn("Statistiques serveur indisponibles :", err && err.message);
    });
}

/* ---------------- Recherche ----------------
   Une recherche doit trouver quoi qu'on tape : avec ou sans accents,
   avec ou sans ponctuation, dans le désordre. On normalise donc des deux
   côtés — la requête et les données — puis on exige que TOUS les mots
   tapés soient présents, peu importe leur ordre.
--------------------------------------------- */

function normaliserRecherche(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // é → e, ï → i
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")                        // S.I. → s i
    .replace(/\s+/g, " ")
    .trim();
}

/* Champs balayés par la recherche. Bien plus large qu'avant : on peut
   chercher un n° de rencontre, un statut de paiement, une catégorie,
   un numéro de téléphone ou une date en toutes lettres. */
const CHAMPS_RECHERCHE = [
  "Recevant", "Visiteur / événement", "Salle", "Adresse", "Ville",
  "Collègue nom", "Collègue rôle", "Collègue téléphone",
  "Libellé compétition", "Niveau administratif", "Code compétition",
  "N° rencontre", "Mon rôle", "Statut paiement", "Format", "Genre",
  "Catégorie d'âge", "Observateur", "Code e-Marque", "Référent 3x3"
];

function indexRecherche_(row) {
  const morceaux = CHAMPS_RECHERCHE.map(k => get(row, k));

  // Le code de compétition tel qu'affiché sur la carte (NM3, U18 France…),
  // qui n'est pas toujours celui écrit en base.
  try { morceaux.push(niveauCarte(row).badge); } catch (e) { /* rien */ }

  // Le téléphone du collègue remis au format national : chercher
  // « 0771567486 » doit marcher même si la base stocke « 771567486 ».
  morceaux.push(normalizePhoneFr(get(row, "Collègue téléphone")));

  // La date sous toutes ses formes lisibles : 12/09/2026, 12 09 2026,
  // « samedi 12 septembre 2026 ». Chercher « septembre » doit marcher.
  if (row._date) {
    morceaux.push(row._date.toLocaleDateString("fr-FR"));
    morceaux.push(row._date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }
  morceaux.push(row._season);

  const texte = normaliserRecherche(morceaux.filter(Boolean).join(" "));
  // Version sans espaces : « si graffenstaden » trouve « S.I. GRAFFENSTADEN ».
  return { texte: texte, compact: texte.replace(/ /g, "") };
}

/* Un mot est trouvé s'il apparaît tel quel, ou collé (à partir de 3
   caractères, pour éviter que « as » ne matche la moitié de la base). */
function motTrouve_(hay, mot) {
  if (!hay) return false;
  if (hay.texte.indexOf(mot) >= 0) return true;
  return mot.length >= 3 && hay.compact.indexOf(mot) >= 0;
}

function correspondRecherche_(row, mots) {
  if (!mots || !mots.length) return true;
  const hay = row._hay || indexRecherche_(row);

  let tousTrouves = true;
  for (let i = 0; i < mots.length; i++) {
    if (!motTrouve_(hay, mots[i])) { tousTrouves = false; break; }
  }
  if (tousTrouves) return true;

  /* Repli : la requête entière, collée. Rattrape les sigles que la
     ponctuation a éclatés — « si graffenstaden » vs « S.I. GRAFFENSTADEN ». */
  const colle = mots.join("");
  return colle.length >= 3 && hay.compact.indexOf(colle) >= 0;
}

/* ---------------- Normalisation ---------------- */

function normalizeRows(rows) {
  return rows.map(row => {
    const r = { ...row };
    r._date = parseFrDate(get(r, "Date match"));

    /* Bénévolat : le déplacement a bien eu lieu, mais rien n'a été perçu.
       On retient 0 € de recette pour ne pas gonfler les revenus ; le montant
       théorique reste consultable dans _amountTheorique. */
    r._benevole = cleanText(get(r, "Statut paiement")) === "Bénévole";
    r._amountTheorique = toNumber(get(r, "Indemnité totale"));
    r._amount = r._benevole ? 0 : r._amountTheorique;
    r._recu = toNumber(get(r, "Montant reçu"));
    r._statutPaie = cleanText(get(r, "Statut paiement"));
    r._encaisse = r._statutPaie === "Reçu" ? r._amount : (r._statutPaie === "Reçu partiel" ? Math.max(0, Math.min(r._recu, r._amount)) : 0);
    r._reste = (r._benevole || r._statutPaie === "Reçu") ? 0 : (r._statutPaie === "Reçu partiel" ? Math.max(0, r._amount - r._recu) : r._amount);
    r._km = toNumber(get(r, "Km A/R stats"));
    r._format = get(r, "Format");
    r._season = normalizeSeason(get(r, "Saison"), r._date);
    r._isActive = !["annulé", "annule", "alerte"].includes(cleanText(get(r, "Statut")).toLowerCase()) && r._format !== "Alerte";
    r._isPast = isPastMission(r);
    r._hay = indexRecherche_(r);
    return r;
  });
}

function normalizeSeason(value, date) {
  if (value && value.includes("/")) return value;
  if (value && value.includes("-")) { const p = value.split("-"); if (p.length === 2) return `${p[0]}/${p[1]}`; }
  if (date) { const sw = new Date(date.getFullYear(), 6, 30); const sy = date >= sw ? date.getFullYear() : date.getFullYear() - 1; return `${sy}/${sy + 1}`; }
  return "";
}

function isPastMission(row) {
  if (!row._date) return false;
  const eod = new Date(row._date); eod.setHours(23, 59, 59, 999);
  return eod < new Date();
}

/* ---------------- Render global ---------------- */

/* Bloc 3/9 (25/09/2026) — Garde anti-écran-blanc : isole le rendu de chaque
   onglet. Si un rendu jette, on affiche l'erreur DANS son panneau (au lieu
   d'un écran blanc général) et on la logge en Console pour diagnostic ;
   les autres onglets continuent de s'afficher normalement. */
function safeRender_(fn, panelId, label) {
  try { fn(); }
  catch (err) {
    console.error("[RenderError] " + (label || panelId) + " :", err);
    const el = panelId ? document.getElementById(panelId) : null;
    if (el) {
      el.innerHTML = `
        <div class="table-card" style="padding:16px">
          <h2 class="section-title" style="margin-top:0">Affichage indisponible</h2>
          <p class="card-sub" style="margin:0 0 10px">Une erreur est survenue en affichant « ${escapeHtml(label || panelId)} ». Le reste de l'application fonctionne. Détail technique ci-dessous (utile pour corriger) :</p>
          <pre style="white-space:pre-wrap; font-size:12px; color:var(--danger); background:var(--surface-2); padding:10px; border-radius:8px; overflow:auto; margin:0">${escapeHtml(String((err && err.stack) || err))}</pre>
        </div>`;
    }
  }
}

function renderAll() {
  state.filteredRows = filterRows(state.allRows);
  safeRender_(renderMatchs, "matchs", "Matchs");
  safeRender_(renderTroisx3, "troisx3", "3×3");
  safeRender_(renderPaiements, "paiements", "Paiements");
  safeRender_(renderStats, "stats", "Statistiques");
  // Ne (re)construire les graphiques Chart.js que si le panneau Stats est
  // réellement visible : sinon le canvas a une taille 0 (display:none via
  // .panel), Chart.js dimensionne les graphiques à 0px et ils restent
  // vides même après un retour sur l'onglet — c'est ce qui donnait
  // l'impression que « les graphiques ont disparu » lors de la fusion
  // Stats/Analyse (19/09/2026). setActiveTab() met déjà state.activeTab
  // et la classe .panel.active AVANT d'appeler renderAll(), donc ce test
  // capture bien le retour sur l'onglet Stats en mode "avancee".
  if (state.statsSubView === "avancee" && state.activeTab === "stats") safeRender_(renderAnalyse, "stats", "Analyse");
  safeRender_(renderAgenda, "agenda", "Agenda");
  safeRender_(renderAlertes, "alertes", "Alertes");
  safeRender_(renderExport, "export", "Export");
  safeRender_(renderQcm, "qcm", "QCM");
  safeRender_(renderProgression, "progression", "Progression");
  safeRender_(renderContacts, "contacts", "Contacts");
  safeRender_(renderTabBadges_, null, "Badges");
}

/* Badges de notification sur les onglets Alertes / Paiements (19/09/2026).
   Même logique de filtre que renderAlertes()/paiementEnRetard() pour rester
   cohérent avec le contenu réel des onglets ; masqué (hidden) si le
   compteur est à 0 pour ne pas alourdir la barre de navigation inutile. */
function renderTabBadges_() {
  const rows = state.filteredRows || [];

  const nbAlertes = rows.filter(r =>
    r._format === "Alerte" ||
    hasWarningReel(r) ||
    cleanText(get(r, "Statut paiement")) === "À vérifier" ||
    paiementEnRetard(r)
  ).length;
  const badgeAlertes = document.getElementById("badgeAlertes");
  if (badgeAlertes) {
    badgeAlertes.textContent = nbAlertes > 99 ? "99+" : String(nbAlertes);
    badgeAlertes.hidden = nbAlertes === 0;
  }

  const nbPaiements = rows.filter(paiementEnRetard).length;
  const badgePaiements = document.getElementById("badgePaiements");
  if (badgePaiements) {
    badgePaiements.textContent = nbPaiements > 99 ? "99+" : String(nbPaiements);
    badgePaiements.hidden = nbPaiements === 0;
  }
}

/* Bascule entre les deux vues fusionnées de l'onglet Stats (19/09/2026) :
   « Vue d'ensemble » (ex-onglet Stats) et « Analyse avancée » (ex-onglet
   Analyse), toutes deux dans le même panel via le pattern .tabs-mini. */
function setStatsSubView_(view) {
  state.statsSubView = view;
  const overviewBtn = document.getElementById("statsSubOverviewBtn");
  const avanceeBtn = document.getElementById("statsSubAvanceeBtn");
  if (overviewBtn) overviewBtn.classList.toggle("active", view === "overview");
  if (avanceeBtn) avanceeBtn.classList.toggle("active", view === "avancee");
  const financier = document.getElementById("statsFinancier");
  const analyse = document.getElementById("statsAnalyse");
  if (financier) financier.style.display = view === "overview" ? "" : "none";
  if (analyse) analyse.style.display = view === "avancee" ? "" : "none";
  if (view === "avancee") renderAnalyse(); else renderStats();
}

function filterRows(rows) {
  const s = state.selectedSeason;
  return rows.filter(row => {
    const seasonOk = s === "Toutes les saisons" || row._season === s;
    if (!seasonOk) return false;
    if (state.filterNiveau && cleanText(get(row, "Niveau administratif")) !== state.filterNiveau) return false;
    if (state.filterStatut && cleanText(get(row, "Statut paiement")) !== state.filterStatut) return false;
    if (state.filterFormat && row._format !== state.filterFormat) return false;
    return correspondRecherche_(row, state.searchTokens);
  });
}

/* ---------------- 5x5 / 3x3 ---------------- */

function renderMatchs() { renderMatchPanel("matchs", "5x5", "5×5"); }
function renderTroisx3() { renderMatchPanel("troisx3", "3x3", "3×3"); }

function renderMatchPanel(rootId, format, label) {
  const root = document.getElementById(rootId);
  // Une rencontre annulée n'est plus une mission : elle disparaît de l'app,
  // listes comme totaux. La ligne reste dans le Sheet, statut « Annulé »,
  // pour garder la trace de la désignation.
  const rows = state.filteredRows
    .filter(r => r._format === format && r._isActive)
    .sort(sortByDateAsc);
  const upcoming = rows.filter(r => !r._isPast);
  const past = rows.filter(r => r._isPast).sort(sortByDateDesc);

  const ouvert = PASSES_OUVERTS[rootId] === true;

  root.innerHTML = `
    <h2 class="section-title">${label} à venir <span class="count">${upcoming.length}</span></h2>
    ${upcoming.length ? renderWeekendGroups(upcoming, false) : empty(`Aucun match ${label} à venir pour cette saison.`)}
    ${past.length ? `
      <details class="past-block" data-panel="${rootId}"${ouvert ? " open" : ""}>
        <summary class="past-summary">
          <span class="past-summary-inner">
            <span class="past-chevron" aria-hidden="true"></span>
            <span class="past-title">${label} passés</span>
            <span class="count">${past.length}</span>
          </span>
        </summary>
        <div class="past-body">${renderWeekendGroups(past, true)}</div>
      </details>`
      : `<h2 class="section-title">${label} passés <span class="count">0</span></h2>
         ${empty(`Aucun match ${label} passé pour cette saison.`)}`}
  `;
  attachCardListeners(root);
  attachPaymentListeners(root);
  attachContactListeners(root);
  attachPastToggle(root);
}

/* Les matchs passés sont repliés par défaut : la page s'ouvre sur ce qui
   arrive, pas sur ce qui est fait. L'état choisi survit aux rafraîchissements
   de la liste (changement de saison, mise à jour d'un paiement). */
const PASSES_OUVERTS = {};

function attachPastToggle(root) {
  root.querySelectorAll("details.past-block").forEach(function (bloc) {
    bloc.addEventListener("toggle", function () {
      PASSES_OUVERTS[bloc.dataset.panel] = bloc.open;
    });
  });
}

/* ---------------- regroupement par week-end ----------------
   Les désignations tombent par week-end : c'est l'unité de temps qui
   compte pour un arbitre, pas le match isolé. On regroupe donc par
   semaine calendaire et on nomme le groupe d'après ce qu'il contient. */

const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/* Lundi de la semaine contenant cette date — clé de regroupement. */
function lundiDeLaSemaine(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jour = d.getDay();               // 0 = dimanche
  d.setDate(d.getDate() - (jour === 0 ? 6 : jour - 1));
  return d;
}

function cleSemaine(date) {
  const l = lundiDeLaSemaine(date);
  return l.getFullYear() + "-" + String(l.getMonth() + 1).padStart(2, "0") + "-" + String(l.getDate()).padStart(2, "0");
}

function jourEtMois(date) {
  const mois = date.toLocaleDateString("fr-FR", { month: "long" });
  const jour = date.getDate();
  return (jour === 1 ? "1er" : String(jour)) + " " + mois;
}

/* Intitulé du groupe : « Week-end du 6 & 7 septembre », « Samedi 6 septembre »
   ou « Semaine du 2 au 8 septembre » si des matchs tombent en semaine. */
function libelleGroupe(dates) {
  const uniques = [];
  dates.forEach(d => {
    const c = d.toDateString();
    if (!uniques.some(u => u.toDateString() === c)) uniques.push(d);
  });
  uniques.sort((a, b) => a - b);

  const tousWeekEnd = uniques.every(d => d.getDay() === 0 || d.getDay() === 6);

  if (tousWeekEnd && uniques.length === 1) {
    const d = uniques[0];
    return JOURS_SEMAINE[d.getDay()].charAt(0).toUpperCase() + JOURS_SEMAINE[d.getDay()].slice(1) + " " + jourEtMois(d);
  }
  if (tousWeekEnd && uniques.length === 2) {
    const a = uniques[0], b = uniques[1];
    const memeMois = a.getMonth() === b.getMonth();
    return "Week-end du " + (memeMois ? a.getDate() : jourEtMois(a)) + " & " + jourEtMois(b);
  }
  if (tousWeekEnd) return "Week-end du " + jourEtMois(uniques[0]);

  const lundi = lundiDeLaSemaine(uniques[0]);
  const dimanche = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 6);
  return "Semaine du " + (lundi.getMonth() === dimanche.getMonth() ? lundi.getDate() : jourEtMois(lundi)) +
         " au " + jourEtMois(dimanche);
}

function renderWeekendGroups(rows, decroissant) {
  const groupes = [];
  const index = {};

  rows.forEach(r => {
    const cle = r._date ? cleSemaine(r._date) : "sans-date";
    if (!index[cle]) { index[cle] = { cle, rows: [], dates: [] }; groupes.push(index[cle]); }
    index[cle].rows.push(r);
    if (r._date) index[cle].dates.push(r._date);
  });

  return groupes.map(g => {
    const titre = g.dates.length ? libelleGroupe(g.dates) : "Date à confirmer";
    const nb = g.rows.length;
    const rowsTriees = g.rows.slice().sort(decroissant ? sortByDateDesc : sortByDateAsc);
    return `
      <section class="we-group">
        <div class="we-head">
          <span class="we-label">${escapeHtml(titre)}</span>
          <span class="we-count">${nb} match${nb > 1 ? "s" : ""}</span>
        </div>
        <div class="cards">${rowsTriees.map(renderMatchCard).join("")}</div>
      </section>`;
  }).join("");
}

/* ---------------- niveaux à distinguer ----------------
   Championnat de France et Pré-national ne se noient pas dans le lot :
   ils portent un liseré et un badge propres. */

/* ---------------- logo de compétition ----------------
   Le code compétition FFBB encode déjà tout ce que porte l'arborescence
   des logos : championnat, jeune/senior, genre, catégorie ou niveau.
   « DFU18-P2 » = Départemental Féminin U18, phase 2 → logo DFU18.
   Les suffixes de phase (-P1, -P2, -5, -7, -FF, -QR, -T1…) ne changent
   pas le logo : on les retire.

   Les fichiers vivent à plat dans img/competitions/, sous le nom qu'ils
   portent déjà dans le Drive — aucun renommage nécessaire. */

const LOGOS_DISPONIBLES = {
  /* 3x3 */
  "3X3":   "3x3.png",

  /* Coupes et phases finales */
  "CPE":   "Coupe de France de Basket FFBB.png",
  "FD":    "FFBB LOGO FINALES.png",

  /* National — séniors */
  "NM1": "NM1.png", "NM2": "NM2.png", "NM3": "NM3.png",
  "NF1": "NF1.png", "NF2": "NF2.png", "NF3": "NF3.png",

  /* National — jeunes */
  "NMU15": "NMU15.png", "NMU18": "NMU18.png",
  "NFU15": "NFU15.png", "NFU18": "NFU18.png",

  /* Région — séniors */
  "PNM": "PNM.png", "PNF": "PNF.png",
  "RM2": "RM2.png", "RM3": "RM3.png",
  "RF2": "RF2.png", "RF3": "RF3.png",

  /* Région — jeunes */
  "RMU13": "RMU13.png", "RMU15": "RMU15.png", "RMU18": "RMU18.png", "RMU21": "RMU21.png",
  "RFU13": "RFU13.png", "RFU15": "RFU15.png", "RFU18": "RFU18.png",

  /* Département — séniors */
  "DM2": "DM2.png", "DM3": "DM3.png",
  "DF1": "DF1.png", "DF2": "DF2.png", "DF3": "DF3.png",

  /* Département — jeunes */
  "DMU11": "DMU11.png", "DMU13": "DMU13.png", "DMU21": "DMU21.png",
  "DFU11": "DFU11.png", "DFU13": "DFU13.png", "DFU15": "DFU15.png", "DFU18": "DFU18.png"
};

/* Le parsing des convocations range parfois le NUMÉRO de rencontre dans la
   colonne « Code compétition » (« 6 », « 4 »…) : le vrai code ne subsiste
   alors que dans le libellé (« PNM », « 4 - AMI NM3 + ESP.PB »).
   On récupère donc le code où qu'il soit. */

const RE_CODE_FFBB = /\b(?:3X3|CPE|CMUT|ENCOU|FD|OPEN|(?:PN|PR)[MF]|[NRD][MF](?:U\d{2}|\d))\b/;

function codeCompetition(row) {
  if (cleanText(get(row, "Format")) === "3x3") return "3X3";

  const brut = cleanText(get(row, "Code compétition")).toUpperCase();
  const codeNu = brut.split("-")[0].replace(/[^A-Z0-9]/g, "");

  // Un code exploitable commence toujours par une lettre.
  if (codeNu && !/^\d+$/.test(codeNu)) return codeNu;

  // Sinon on va le chercher dans le libellé.
  const libelle = cleanText(get(row, "Libellé compétition")).toUpperCase();
  const trouve = libelle.match(RE_CODE_FFBB);
  return trouve ? trouve[0].replace(/[^A-Z0-9]/g, "") : "";
}

function slugCompetition(row) {
  return codeCompetition(row);
}

function logoCompetition(row) {
  const slug = slugCompetition(row);
  const fichier = LOGOS_DISPONIBLES[slug];
  if (!fichier) return "";                     // pas de logo connu : rien, la carte reste intacte

  const alt = cleanText(get(row, "Libellé compétition")) || slug;
  return `<img class="comp-logo" src="img/competitions/${encodeURIComponent(fichier)}"
               alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}"
               loading="lazy" decoding="async" onerror="this.remove()">`;
}

/* Niveau de la rencontre : toujours renvoyé, jamais null.
   La pastille affiche le CODE de compétition (NM3, PNM, RM2, DM1…),
   pas le niveau générique : c'est ce qui se lit le plus vite.
   La couleur, elle, porte la hiérarchie France > PN > Région > Dép. */

/* NMU18 / NFU18 → « U18 France » : le code brut ne parle pas, alors que
   la catégorie jeune en Championnat de France, si. */
function libelleCodeNiveau(code, famille) {
  const jeune = code.match(/^N[MF](U\d{2})$/);
  if (jeune) return jeune[1] + " France";
  if (code) return code;
  return famille === "autre" ? "" : "";
}

function niveauCarte(row) {
  const niveau = cleanText(get(row, "Niveau administratif")).toLowerCase();
  const code = codeCompetition(row);
  const libelle = cleanText(get(row, "Libellé compétition")).toUpperCase();
  const amical = /\bAMI(CAL)?\b/.test(libelle);

  const carte = (classe, court) => {
    const texte = libelleCodeNiveau(code, classe) ||
                  cleanText(get(row, "Niveau administratif")) || "À vérifier";
    return { classe: classe, badge: amical ? texte + " · amical" : texte, court: court };
  };

  if (cleanText(get(row, "Format")) === "3x3" || code === "3X3") {
    return { classe: "niv-3x3", badge: "3x3", court: "3x3" };
  }

  // Championnat de France : NM1-3, NF1-3, NMU15/18, NFU15/18 — tout code
  // commençant par NM ou NF. Aucune autre compétition FFBB ne commence par N.
  if (niveau.indexOf("championnat de france") >= 0 || /^N[MF]/.test(code) ||
      /\bCHAMPIONNAT DE FRANCE\b/.test(libelle)) return carte("niv-france", "France");

  // Pré-national : PNM / PNF. À ne pas confondre avec PRM / PRF (pré-région).
  if (/^PN[MF]/.test(code)) return carte("niv-pn", "PN");

  if (niveau.indexOf("départ") >= 0 || niveau.indexOf("depart") >= 0 || /^D[MF]/.test(code)) {
    return carte("niv-departement", "Dép.");
  }

  if (niveau.indexOf("région") >= 0 || niveau.indexOf("region") >= 0 || /^(PR|R)[MF]/.test(code)) {
    return carte("niv-region", "Région");
  }

  return carte("niv-autre", "—");
}

function renderMatchCard(row) {
  const uid = escapeHtml(get(row, "UID"));
  const format = get(row, "Format");
  const title = format === "3x3"
    ? firstValue(row, ["Visiteur / événement", "Recevant", "Libellé compétition"])
    : firstValue(row, ["Recevant", "Visiteur / événement", "Libellé compétition"]);

  const date = formatDateShort(row._date);
  const time = get(row, "Heure/RDV");
  const paiement = get(row, "Statut paiement") || "À recevoir";
  const isPaid = paiement === "Reçu";
  const isBenevole = paiement === BENEVOLE;

  const cost = realFuelCostClient(row._km, row._date);
  const net = round2(row._amount - cost);

  const niv = niveauCarte(row);
  const reglement = reglementSpecial(row);   // MODIFICATION 10
  const enjeu = renderEnjeuClassement_(row);   // MODIFICATION 19/09/2026


  return `
    <article class="match-card match-card--niveau ${niv.classe}${reglement ? " match-card--reglement" : ""}" data-uid="${uid}">
      <div class="card-head" role="button" tabindex="0">
        <div>
          <div class="badges">
            <span class="badge-niveau">${escapeHtml(niv.badge)}</span>
            ${reglement ? `<span class="badge badge-reglement" title="${escapeHtml(reglement)}">⚠ ${escapeHtml(reglement)}</span>` : ""}
            ${format && format !== "3x3" ? badge(format, "gray") : ""}
            ${badge(get(row, "Genre"), get(row, "Genre") === "Féminin" ? "red" : get(row, "Genre") === "Mixte" ? "gold" : "")}
            ${row._isPast ? badge("Passé", "gray") : ""}
            ${isBenevole ? badge("Bénévole", "gray")
              : isPaid ? badge("Payé", "green")
              : badge(paiement, paiement === "À recevoir" ? "gold" : "orange")}
          </div>
          <div class="title-row">
            ${logoCompetition(row)}
            <h3 class="card-title">${escapeHtml(title || "Mission")}</h3>
          </div>
          <p class="card-sub">${escapeHtml(get(row, "Visiteur / événement") || get(row, "Libellé compétition") || "")}</p>
        </div>
        <div class="date-pill"><strong>${escapeHtml(date)}</strong><span>${escapeHtml(time)}</span></div>
      </div>
      <div class="card-body">
        ${renderMoneyStrip(row._amount, cost, net)}
        ${enjeu}
        ${renderDetails(row)}
        ${renderMapContainer(row, uid)}
        ${renderActions(row)}
        ${renderPaymentControl(row)}
      </div>
    </article>
  `;
}

/* Bandeau "classement / enjeu" : uniquement s'il y a une donnée serveur
   pour au moins une des 2 équipes (silencieux sinon — le module classement
   est neuf, les anciens matchs n'ont pas de code club enregistré). */
function renderEnjeuClassement_(row) {
  if (row._isPast) return "";
  const codeComp = get(row, "Code compétition");
  const cR = classementPour_(get(row, "Code club recevant"), codeComp);
  const cV = classementPour_(get(row, "Code club visiteur"), codeComp);
  if (!cR && !cV) return "";

  const ligne = (nom, c) => {
    if (!c) return "";
    const pos = c["Position"], taille = c["Taille poule"], enjeu = c["Enjeu"];
    return `<div class="enjeu-ligne"><strong>${escapeHtml(nom)}</strong> — ${pos}${taille ? "e/" + taille : ""}${enjeu ? " · " + escapeHtml(String(enjeu)) : ""}</div>`;
  };

  return `<div class="enjeu-classement">${ligne(get(row, "Recevant") || "Recevant", cR)}${ligne(get(row, "Visiteur / événement") || "Visiteur", cV)}</div>`;
}

function renderMoneyStrip(gross, cost, net) {
  return `
    <div class="money-strip">
      <div class="money-cell gross"><label>Indemnité</label><strong>${formatMoney(gross)}</strong></div>
      <div class="money-cell cost"><label>Carburant réel</label><strong>−${formatMoney(cost)}</strong></div>
      <div class="money-cell net"><label>Net réel</label><strong>${formatMoney(net)}</strong></div>
    </div>
  `;
}

function renderDetails(row) {
  const details = [
    ["Format", get(row, "Format")],
    ["Saison", row._season],
    ["Mon rôle", get(row, "Mon rôle")],
    ["Compétition", get(row, "Libellé compétition")],
    ["Genre", get(row, "Genre")],
    ["Catégorie", get(row, "Catégorie d'âge")],
    ["N° rencontre", get(row, "N° rencontre")],
    ["Recevant", get(row, "Recevant")],
    ["Visiteur / événement", get(row, "Visiteur / événement")],
    ["Salle", get(row, "Salle")],
    ["Adresse", get(row, "Adresse")],
    ["Ville", get(row, "Ville")],
    ["Code e-Marque", get(row, "Code e-Marque")],
    ["Collègue", get(row, "Collègue nom")],
    ["Tél. collègue", formatPhoneFr(get(row, "Collègue téléphone"))],
    ["Rôle collègue", get(row, "Collègue rôle")],
    ["Référent 3x3", get(row, "Référent 3x3")],
    ["Observateur", get(row, "Observateur")],
    ["KM A/R", row._km ? formatNumber(row._km, " km") : ""],
    ["Paiement prévu", get(row, "Date paiement")],
    ["Mode de règlement", reglementSpecial(row)],
    ["Contact collègue", get(row, "Contact collègue")],
    ["Warnings", warningsReels(row).join(" | ")]
  ].filter(([, v]) => v !== "" && v !== null && v !== undefined);

  /* Champs dont la valeur est longue : ils gardent toute la largeur de la
     grille, sinon une adresse se casse en quatre lignes dans une colonne. */
  const pleineLargeur = ["Recevant", "Visiteur / événement", "Salle", "Adresse", "Warnings", "Observateur", "Mode de règlement"];

  return `<div class="detail-grid">${details.map(([l, v]) => `
    <div class="detail${pleineLargeur.indexOf(l) >= 0 ? " detail--wide" : ""}"><label>${escapeHtml(l)}</label><span>${escapeHtml(String(v))}</span></div>`).join("")}</div>`;
}

/* ---------------- Carte OSM ---------------- */

function renderMapContainer(row, uid) {
  const addr = get(row, "Adresse") || get(row, "Ville");
  if (!addr) return "";
  return `<div class="card-map" id="map-${uid}" data-addr="${escapeHtml(addr)}"></div>`;
}

function initMapFor(uid, addr) {
  if (state.maps[uid]) { setTimeout(() => state.maps[uid].invalidateSize(), 60); return; }
  const el = document.getElementById(`map-${uid}`);
  if (!el || typeof L === "undefined") return;

  const map = L.map(el, { scrollWheelZoom: false }).setView([HOME.lat, HOME.lon], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap"
  }).addTo(map);
  L.marker([HOME.lat, HOME.lon]).addTo(map).bindPopup("Domicile");
  state.maps[uid] = map;

  geocode(addr).then(dest => {
    if (!dest) return;
    L.marker([dest.lat, dest.lon]).addTo(map).bindPopup("Salle");
    route(HOME, dest).then(r => {
      if (r && r.geometry) {
        const line = L.geoJSON(r.geometry, { style: { color: "#E4002B", weight: 4, opacity: 0.85 } }).addTo(map);
        map.fitBounds(line.getBounds().pad(0.2));
        const km = Math.round(r.distanceKm * 2);
        L.popup().setLatLng([dest.lat, dest.lon])
          .setContent(`<b>${km} km A/R</b><br>${(km * 0.4).toFixed(2)} € remboursés`).openOn(map);
      } else {
        map.fitBounds(L.latLngBounds([[HOME.lat, HOME.lon], [dest.lat, dest.lon]]).pad(0.3));
      }
    });
  });
  setTimeout(() => map.invalidateSize(), 80);
}

function geocode(address) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address);
  return fetch(url, { headers: { "Accept": "application/json" } })
    .then(r => r.json())
    .then(d => (d && d.length) ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null)
    .catch(() => null);
}

function route(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  return fetch(url).then(r => r.json())
    .then(d => (d.routes && d.routes.length) ? { geometry: d.routes[0].geometry, distanceKm: d.routes[0].distance / 1000 } : null)
    .catch(() => null);
}

/* ---------------- Mode de règlement ----------------
   La plupart des rencontres sont payées par le comité ou par la ligue :
   c'est réglé, il n'y a rien à surveiller. Quand c'est le club recevant
   qui paie, il faut penser à réclamer sur place — d'où le signalement
   visuel sur la carte plutôt qu'une alerte noyée dans un onglet.
---------------------------------------------------- */

function reglementSpecial(row) {
  const type = normaliserRecherche(get(row, "Paiement Type"));
  const par = normaliserRecherche(get(row, "Indemnisé par"));

  const estClub = type.indexOf("club") >= 0 ||
                  par.indexOf("association recevante") >= 0 ||
                  par.indexOf("club") >= 0;

  if (!estClub) return "";
  return cleanText(get(row, "Indemnisé par")) || "Paiement par le club recevant";
}

/* ---------------- SMS collègue (message pré-rempli) ---------------- */

/* Délai de RDV devant la salle selon le niveau de la rencontre :
   Championnat de France 1h00 · Région (dont pré-national / pré-région) 45 min ·
   Départemental 35 min. Tout niveau 5x5 non identifié retombe sur le régime Région. */
const RDV_MINUTES = { france: 60, region: 45, departement: 35 };

/* Pas de message type en 3x3 : le bouton SMS n'est pas proposé sur ces missions. */
function smsDisponible(row) {
  return cleanText(get(row, "Format")) !== "3x3" && codeCompetition(row) !== "3X3";
}

function niveauRencontre(row) {
  const code = codeCompetition(row);
  const niveau = cleanText(get(row, "Niveau administratif")).toLowerCase();
  const libelle = cleanText(get(row, "Libellé compétition")).toUpperCase();

  if (niveau.indexOf("championnat de france") >= 0 || niveau.indexOf("national") === 0 ||
      /^N[MF]/.test(code) || /\bCHAMPIONNAT DE FRANCE\b/.test(libelle)) return "france";
  if (niveau.indexOf("départ") >= 0 || niveau.indexOf("depart") >= 0 || /^D[MF]/.test(code)) return "departement";
  return "region";   // régional, pré-national, pré-région, non renseigné
}

function libelleNiveauSms(row) {
  return cleanText(get(row, "Libellé compétition")) ||
         codeCompetition(row) ||
         cleanText(get(row, "Niveau administratif")) ||
         "notre rencontre";
}

/* "20:30", "20h30", "20 h 30" → { h, m } ; null si illisible. */
function parseHeure(value) {
  const m = String(value || "").match(/(\d{1,2})\s*[:hH.]\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h: h, m: min };
}

function formatHeureFr(t) {
  return t ? String(t.h).padStart(2, "0") + "h" + String(t.m).padStart(2, "0") : "";
}

function reculerHeure(t, minutes) {
  if (!t) return null;
  let total = t.h * 60 + t.m - minutes;
  while (total < 0) total += 1440;
  return { h: Math.floor(total / 60), m: total % 60 };
}

function formatDelai(minutes) {
  if (minutes % 60 === 0) return (minutes / 60) + "h00";
  return minutes < 60 ? minutes + " min" : Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");
}

function formatDateLongue(date) {
  if (!date) return "";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

/* Prénom du collègue à partir de « Collègue nom » (format FFBB : NOM en
   MAJUSCULES suivi du prénom, ex. "WEBER-URBAN Emma", "BAH Mamadou Dian").
   On retire le bloc de mots en majuscules du début. */
function prenomCollegue(row) {
  const nom = cleanText(get(row, "Collègue nom"));
  if (!nom) return "";
  const mots = nom.split(/\s+/);
  let i = 0;
  while (i < mots.length && mots[i] === mots[i].toUpperCase() && /[A-ZÀ-Ÿ]/.test(mots[i])) i++;
  const prenom = mots.slice(i).join(" ");
  return prenom || nom;
}

/* MODIFICATION 19/09/2026 — messages types repris mot pour mot (3 gabarits
   selon le niveau : France / Région / Départemental), avec les emplacements
   variables remplis automatiquement. La clause covoiturage (France, Région)
   est du texte fixe, comme dans le gabarit fourni : le système ne connaît
   pas l'adresse du collègue, donc la condition "trajet > 1h15 et collègue
   à 25-30 km de mon domicile" reste à juger par toi avant d'envoyer. */
function buildSmsCollegue(row) {
  const niveau = niveauRencontre(row);           // "france" | "region" | "departement"
  const minutes = RDV_MINUTES[niveau];
  const prenom = prenomCollegue(row) || "";

  const date = formatDateLongue(row._date) || cleanText(get(row, "Date match"));
  const heure = cleanText(get(row, "Heure/RDV"));
  const club = cleanText(get(row, "Recevant")) || cleanText(get(row, "Ville")) || cleanText(get(row, "Salle"));

  const lignes = [
    "Hello" + (prenom ? " " + prenom : "") + ",",
    "",
    "J'espère que tu vas bien ?",
    "",
    "On arbitre ensemble en " + libelleNiveauSms(row),
    "Le " + date + (heure ? " à " + heure : "") + " ",
    "À " + club + ".",
    "On se donne RDV devant la salle " + formatDelai(minutes) + " avant l'heure de début de rencontre"
  ];

  if (niveau === "france") {
    lignes.push("", "Tu souhaites prendre la tenue rouge ou noir ?");
  }
  // MODIFICATION 19/09/2026 — clause covoiturage conditionnée : avant, elle
  // sortait dans TOUS les messages France/Région, même pour un trajet à côté.
  // Le système ne connaît pas l'adresse du collègue (condition réelle :
  // trajet > 1h15 ET collègue à 25-30 km de chez toi, donc pas exploitable
  // telle quelle) — on se rabat sur un indicateur qu'on a vraiment : TON
  // propre trajet aller (estimé à 70 km/h) dépasse 1h15. Si ton trajet est
  // court, pas de covoiturage à proposer même en France/Région.
  const kmAR = toNumber(get(row, "Km A/R stats"));
  const trajetAllerMin = kmAR > 0 ? (kmAR / 2) / 70 * 60 : 0;
  if ((niveau === "france" || niveau === "region") && trajetAllerMin > 75) {
    lignes.push("", "Si tu souhaite faire du covoiturage, pas de soucis dis moi juste comment tu veux qu'on s'organise");
  }
  lignes.push("", "A plus Clément !");

  return lignes.join("\n");
}

/* ---------------- Actions ---------------- */

function renderActions(row) {
  const address = get(row, "Adresse");
  const phone = normalizePhoneFr(get(row, "Collègue téléphone"));
  const links = [];
  if (address) {
    links.push(`<a class="action-link" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${HOME.lat}%2C${HOME.lon}%3B${encodeURIComponent(address)}" target="_blank" rel="noopener">Itinéraire</a>`);
    links.push(`<a class="action-link gold" href="https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes" target="_blank" rel="noopener">Waze</a>`);
  }
  if (phone && smsDisponible(row)) {
    const corps = encodeURIComponent(buildSmsCollegue(row));
    const uid = escapeHtml(get(row, "UID"));
    // MODIFICATION 11 — envoyer le SMS marque la mission comme contactée :
    // dans le cas normal tu n'as rien de plus à faire, les relances s'arrêtent.
    links.push(`<a class="action-link secondary contact-sms" data-uid="${uid}" href="sms:${phone}?&body=${corps}">SMS collègue</a>`);
  }

  /* MODIFICATION 11 — cas où c'est le collègue qui a écrit en premier, ou
     un simple appel : un tap et les relances s'arrêtent. Aucun système ne
     peut le deviner à ta place. */
  if (get(row, "Collègue nom") && smsDisponible(row)) {
    const uid = escapeHtml(get(row, "UID"));
    const fait = Boolean(get(row, "Contact collègue"));
    links.push(`<button type="button" class="action-link secondary contact-toggle${fait ? " is-done" : ""}" data-uid="${uid}" data-fait="${fait ? "1" : "0"}">${fait ? "✓ Contact fait" : "Contact fait"}</button>`);
  }
  if (get(row, "N° rencontre") || get(row, "Warning FBI")) {
    links.push(`<a class="action-link secondary" href="https://extranet.ffbb.com/fbi/connexion.fbi" target="_blank" rel="noopener">FBI</a>`);
  }
  return links.length ? `<div class="actions">${links.join("")}</div>` : "";
}

/* Mercredi de la semaine qui suit une date donnée (JJ/MM/AAAA) — sert au
   pointage des virements CF Jeunes (vérif à J+1 semaine, le mercredi). */
function mercrediSemaineSuivante_(dateStr) {
  const d = parseFrDate(dateStr);
  if (!d) return "";
  const jour = d.getDay(); // 0=dim ... 3=mer ... 6=sam
  const decalageVersMercrediCourant = (3 - jour + 7) % 7;
  const cible = new Date(d);
  cible.setDate(d.getDate() + decalageVersMercrediCourant + 7);
  return formatDateShort(cible);
}

function renderPaymentControl(row) {
  const uid = escapeHtml(get(row, "UID"));
  const current = get(row, "Statut paiement") || "À recevoir";
  const prevu = get(row, "Date paiement");
  const typePaiement = get(row, "Paiement Type") || "";
  const niveauAdmin = get(row, "Niveau administratif") || "";
  const categorie = get(row, "Catégorie d'âge") || "";

  // MODIFICATION 15/09/2026 — Bloc B : les matchs de Championnat de
  // France Jeunes payés à parts égales entre 2 clubs (chèque ou virement,
  // choix à faire) — rappel de faire signer la convocation sur place.
  const estPartsEgales = typePaiement === "Parts égales (2 clubs)" && current !== "Bénévole";

  // MODIFICATION 19/09/2026 — CF Jeunes (U15 France, U18 France M/F) payés
  // par le club recevant : le choix chèque/virement doit aussi être
  // proposé ici (jusque-là réservé aux « parts égales »), Région/CD67
  // restant virement par défaut sans choix.
  const estCfJeunesClubRecevant = typePaiement === "Association recevante"
    && niveauAdmin === "Championnat de France"
    && (categorie === "U15" || categorie === "U18")
    && current !== "Bénévole";

  const proposerChoixModePaiement = estPartsEgales || estCfJeunesClubRecevant;
  const modePaiement = get(row, "Mode paiement") || "";

  // Virement CF Jeunes : à vérifier le mercredi de la semaine suivant le match
  // (chèques : encaissés à la banque tous les 15 jours le mardi — hors appli).
  const dateVerifVirement = (estCfJeunesClubRecevant && modePaiement === "Virement" && current === "À recevoir")
    ? mercrediSemaineSuivante_(get(row, "Date match"))
    : "";

  // Échéancier CD67 : au-delà de 10 jours après la date de paiement
  // attendue (donc à partir du 20 du mois), on signale le retard.
  const estAssociationRecevante = typePaiement === "Association recevante";
  let retardCD67 = false;
  if (estAssociationRecevante && !estCfJeunesClubRecevant && current === "À recevoir" && prevu) {
    const m = String(prevu).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const limite = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 10);
      retardCD67 = new Date() > limite;
    }
  }

  return `
    <div class="payment-row">
      <div>
        <strong>Statut paiement</strong>
        <div class="card-sub">${escapeHtml(prevu ? "Prévu : " + prevu : "Date à vérifier")}</div>
      </div>
      <select class="payment-select" data-uid="${uid}">
        ${PAYMENT_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${s === current ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
      </select>
    </div>
    ${proposerChoixModePaiement ? `
    <div class="payment-row-alert">
      <div class="badge-parts-egales" title="${estPartsEgales ? "Le paiement est réparti entre les 2 clubs. Imprime ta convocation : elle doit être signée sur place." : "CF Jeunes — le club recevant paie par chèque ou virement."}">⚠ ${estPartsEgales ? "Parts égales — imprime ta convocation" : "CF Jeunes — choisis le mode de paiement"}</div>
      <select class="payment-mode-select" data-uid="${uid}">
        <option value="" ${modePaiement === "" ? "selected" : ""}>Mode de paiement à choisir…</option>
        <option value="Chèque" ${modePaiement === "Chèque" ? "selected" : ""}>Chèque</option>
        <option value="Virement" ${modePaiement === "Virement" ? "selected" : ""}>Virement</option>
      </select>
      ${dateVerifVirement ? `<div class="card-sub">À vérifier le ${escapeHtml(dateVerifVirement)} (mercredi suivant le match)</div>` : ""}
    </div>` : ""}
    ${retardCD67 ? `
    <div class="payment-row-alert">
      <div class="badge-retard">⚠ Paiement CD67 en retard — relance à faire</div>
    </div>` : ""}`;
}

function attachCardListeners(root) {
  root.querySelectorAll(".card-head").forEach(head => {
    const toggle = () => {
      const card = head.closest(".match-card");
      card.classList.toggle("open");
      if (card.classList.contains("open")) {
        const uid = card.dataset.uid;
        const mapEl = card.querySelector(".card-map");
        if (mapEl) initMapFor(uid, mapEl.dataset.addr);
      }
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}

/* ---------------- Paiements ---------------- */

/* Bloc 3 — Section « À relancer » (>45 j), en tête de l'onglet Paiements,
   triée du plus ancien au plus récent (le plus urgent d'abord). */
function renderRelance45_(rows) {
  const aRelancer = rows.filter(paiementARelancer)
    .map(r => ({ r: r, j: Math.floor((Date.now() - parseFrDate(get(r, "Date paiement")).getTime()) / 86400000) }))
    .sort((a, b) => b.j - a.j);
  if (!aRelancer.length) return "";
  const total = aRelancer.reduce((t, x) => t + (x.r._reste || x.r._amount), 0);
  return `
    <div class="relance-box">
      <h2 class="section-title relance-title">À relancer — plus de ${RELANCE_JOURS} jours <span class="count">${aRelancer.length}</span></h2>
      <div class="relance-sub">${formatMoney(total)} en attente au-delà de ${RELANCE_JOURS} jours après l'échéance prévue. Du plus ancien (${aRelancer[0].j} j) au plus récent.</div>
      <div class="cards">${aRelancer.map(x => renderMatchCard(x.r)).join("")}</div>
    </div>`;
}

function renderPaiements() {
  const root = document.getElementById("paiements");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte" && r._isActive).sort(sortByPaymentThenDate);
  if (!rows.length) { root.innerHTML = empty("Aucun paiement pour cette saison."); return; }

  const grouped = groupBy(rows, r => get(r, "Statut paiement") || "À recevoir");
  const order = ["À recevoir", "Reçu partiel", "Écart à vérifier", "À vérifier", "Reçu", BENEVOLE];

  const statutDe = r => get(r, "Statut paiement") || "À recevoir";
  // Le bénévolat ne compte ni comme encaissé, ni comme dû.
  const totalDu = rows.reduce((t, r) => t + (r._reste || 0), 0);
  const totalRecu = rows.reduce((t, r) => t + (r._encaisse || 0), 0);
  const benevoles = rows.filter(r => statutDe(r) === BENEVOLE);

  /* Un statut (surtout « Reçu ») accumule vite des dizaines de missions
     passées. On garde à l'écran ce qui reste actionnable (à venir, ou
     traité récemment) et on replie le reste sous un même principe que
     les onglets 5×5 / 3×3. Seuil : 8 lignes récentes visibles, le reste
     replié — au-delà la liste devient illisible. */
  const RECENTS_VISIBLES = 8;
  // MODIFICATION 19/09/2026 — ce qui est déjà soldé (Reçu, Bénévole) ne
  // doit plus encombrer l'écran : replié par défaut dans un menu déroulant,
  // même en dessous du seuil de 8. Ce qui reste à pointer (À recevoir,
  // Écart/À vérifier) reste affiché en clair comme avant.
  const TOUJOURS_REPLIES = ["Reçu", BENEVOLE];

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><label>En attente de paiement</label><strong>${formatMoney(totalDu)}</strong></div>
      <div class="kpi"><label>Déjà reçu</label><strong>${formatMoney(totalRecu)}</strong></div>
      ${benevoles.length ? `<div class="kpi"><label>Arbitré bénévolement</label><strong>${benevoles.length}</strong><span class="sub">mission(s), aucune indemnité attendue</span></div>` : ""}
    </div>
    ${renderRelance45_(rows)}
    ${order.filter(k => grouped[k]).map(status => {
      const liste = grouped[status].slice().sort(sortByDateDesc);
      const panelId = "paiements-" + status.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const ouvert = PASSES_OUVERTS[panelId] === true;

      if (TOUJOURS_REPLIES.includes(status)) {
        return `
      <h2 class="section-title">${escapeHtml(status)} <span class="count">${liste.length}</span></h2>
      <details class="past-block" data-panel="${panelId}"${ouvert ? " open" : ""}>
        <summary class="past-summary">
          <span class="past-summary-inner">
            <span class="past-chevron" aria-hidden="true"></span>
            <span class="past-title">Afficher — ${escapeHtml(status)}</span>
            <span class="count">${liste.length}</span>
          </span>
        </summary>
        <div class="past-body"><div class="cards">${liste.map(renderMatchCard).join("")}</div></div>
      </details>
    `;
      }

      const visibles = liste.slice(0, RECENTS_VISIBLES);
      const repliees = liste.slice(RECENTS_VISIBLES);
      return `
      <h2 class="section-title">${escapeHtml(status)} <span class="count">${liste.length}</span></h2>
      <div class="cards">${visibles.map(renderMatchCard).join("")}</div>
      ${repliees.length ? `
        <details class="past-block" data-panel="${panelId}"${ouvert ? " open" : ""}>
          <summary class="past-summary">
            <span class="past-summary-inner">
              <span class="past-chevron" aria-hidden="true"></span>
              <span class="past-title">Voir les ${repliees.length} de plus — ${escapeHtml(status)}</span>
              <span class="count">${repliees.length}</span>
            </span>
          </summary>
          <div class="past-body"><div class="cards">${repliees.map(renderMatchCard).join("")}</div></div>
        </details>` : ""}
    `;
    }).join("")}
  `;
  attachCardListeners(root);
  attachPaymentListeners(root);
  attachContactListeners(root);
  attachPastToggle(root);
}

/* MODIFICATION 11 — marquage du contact collègue.
   L'appel réseau ne bloque rien : l'affichage est mis à jour tout de suite,
   et une erreur repasse le bouton dans son état précédent. */
async function marquerContact(uid, valeur) {
  const res = await jsonp("setContact", { uid, value: valeur ? "1" : "" });
  if (!res || res.success === false) throw new Error((res && res.error) || "Erreur contact");
  const row = state.allRows.find(r => get(r, "UID") === uid);
  if (row) row["Contact collègue"] = valeur ? new Date().toLocaleDateString("fr-FR") : "";
  return res;
}

function attachContactListeners(root) {
  // Le lien SMS s'ouvre normalement ; le marquage part en parallèle.
  root.querySelectorAll(".contact-sms").forEach(lien => {
    lien.addEventListener("click", () => {
      const uid = lien.dataset.uid;
      const row = state.allRows.find(r => get(r, "UID") === uid);
      if (row && get(row, "Contact collègue")) return;   // déjà marqué
      marquerContact(uid, true).catch(() => { /* silencieux : le SMS prime */ });
    });
  });

  root.querySelectorAll(".contact-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      const etaitFait = btn.dataset.fait === "1";
      btn.disabled = true;
      try {
        await marquerContact(uid, !etaitFait);
        setStatus(etaitFait ? "Contact effacé" : "Contact enregistré", "ok");
        renderAll();
      } catch (err) {
        setStatus("Erreur contact : " + err.message, "error");
        btn.disabled = false;
      }
    });
  });
}

function attachPaymentListeners(root) {
  // MODIFICATION 15/09/2026 — Bloc B : choix du mode de paiement
  // (chèque/virement) sur les missions « Parts égales » (CF Jeunes).
  root.querySelectorAll(".payment-mode-select").forEach(select => {
    select.addEventListener("change", async e => {
      const uid = e.target.dataset.uid, mode = e.target.value;
      e.target.disabled = true;
      setStatus("Mise à jour du mode de paiement…", "");
      try {
        const res = await jsonp("updatePaymentMode", { uid, mode });
        if (!res.success) throw new Error(res.error || "Erreur update");
        const row = state.allRows.find(r => get(r, "UID") === uid);
        if (row) row["Mode paiement"] = mode;
        setStatus("Mode de paiement mis à jour", "ok");
      } catch (err) {
        setStatus("Erreur mode paiement : " + err.message, "error");
      } finally {
        e.target.disabled = false;
      }
    });
  });

  root.querySelectorAll(".payment-select").forEach(select => {
    select.addEventListener("change", async e => {
      const uid = e.target.dataset.uid, status = e.target.value;
      let montant = "";
      if (status === "Reçu partiel") {
        const row0 = state.allRows.find(r => get(r, "UID") === uid);
        const attendu = row0 ? toNumber(get(row0, "Indemnité totale")) : 0;
        const saisi = prompt("Montant déjà reçu (€) — la part d'un des 2 clubs :", attendu ? (attendu / 2).toFixed(2) : "");
        if (saisi === null) { e.target.value = row0 ? (get(row0, "Statut paiement") || "À recevoir") : "À recevoir"; return; }
        montant = String(saisi).replace(",", ".").replace(/[^\d.]/g, "");
      }
      e.target.disabled = true;
      setStatus("Mise à jour du paiement…", "");
      try {
        const res = await jsonp("updatePaymentStatus", { uid, status, montant });
        if (!res.success) throw new Error(res.error || "Erreur update");
        const row = state.allRows.find(r => get(r, "UID") === uid);
        if (row) {
          row["Statut paiement"] = status;
          if (status === "Reçu") {
            row["Date réception"] = new Date().toLocaleDateString("fr-FR");
            if (!get(row, "Montant reçu")) row["Montant reçu"] = get(row, "Indemnité totale");
          }
          if (status === "À recevoir") { row["Date réception"] = ""; row["Montant reçu"] = ""; }
          if (status === BENEVOLE) { row["Date réception"] = ""; row["Montant reçu"] = 0; }
          if (status === "Reçu partiel") { row["Date réception"] = new Date().toLocaleDateString("fr-FR"); if (montant) row["Montant reçu"] = montant; }
        }
        setStatus("Paiement mis à jour", "ok");
        AN.statsCache = {}; // les délais/KPI avancés doivent être recalculés
        loadStats();
        renderAll();
      } catch (err) {
        setStatus("Erreur paiement : " + err.message, "error");
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

/* ---------------- Stats ---------------- */

/* ===================================================================
   BLOC 2 — Trésorerie prévisionnelle + Comparaison saison N-1 (front)
   Ajouté le 25/09/2026. Appelés depuis renderStats() (sous-vue overview).
   Consomment s.cash_flow et s.comparaison_saison_precedente.
   =================================================================== */

function renderCashFlow_(cf) {
  if (!cf) return "";
  const h = cf.horizon || {};
  const ret = cf.en_retard || { montant: 0, nb: 0 };
  const proch = cf.prochaine;
  const spark = cashFlowSparkline_(cf.echeances || []);
  return `
    <h2 class="section-title">Trésorerie prévisionnelle</h2>
    <div class="kpi-grid">
      <div class="kpi hero">
        <label>Reste à percevoir</label>
        <strong>${formatMoney(cf.a_percevoir_total)}</strong>
        <span class="sub">${proch ? "prochaine échéance : " + escapeHtml(proch.date) + " · " + money(proch.montant) : "aucune échéance à venir"}</span>
      </div>
      <div class="kpi"><label>D'ici 30 jours</label><strong>${formatMoney(h.j30)}</strong></div>
      <div class="kpi"><label>D'ici 60 jours</label><strong>${formatMoney(h.j60)}</strong></div>
      <div class="kpi"><label>D'ici 90 jours</label><strong>${formatMoney(h.j90)}</strong></div>
      <div class="kpi${ret.montant > 0 ? " kpi-alert" : ""}"><label>En retard</label><strong>${formatMoney(ret.montant)}</strong><span class="sub">${ret.nb} échéance(s) dépassée(s)</span></div>
    </div>
    ${spark}
    ${(cf.echeances && cf.echeances.length) ? `
    <div class="table-card"><div class="table-wrap"><table class="cf-table">
      <thead><tr><th>Échéance</th><th>Dans</th><th>Missions</th><th>Montant</th><th>Cumulé</th></tr></thead>
      <tbody>${cf.echeances.map(e => `<tr>
        <td>${escapeHtml(e.date)}</td>
        <td>${e.jours <= 0 ? "auj." : "J+" + e.jours}</td>
        <td>${e.nb}</td>
        <td>${money(e.montant)}</td>
        <td class="cf-cumul">${money(e.cumul)}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : ""}
    <div class="stat-note">${escapeHtml(cf.note || "")}</div>`;
}

/* Courbe cumulée des encaissements à venir — SVG maison, aucun canvas :
   pas de problème de dimensionnement quand le panneau est masqué. */
function cashFlowSparkline_(echeances) {
  if (!echeances || echeances.length < 2) return "";
  const W = 640, H = 130, PADX = 10, PADY = 16;
  const last = echeances[echeances.length - 1];
  const maxCumul = last.cumul || 1;
  const maxJ = Math.max(1, last.jours);
  const px = j => PADX + (Math.max(0, j) / maxJ) * (W - 2 * PADX);
  const py = c => H - PADY - (c / maxCumul) * (H - 2 * PADY);
  let line = `M ${px(0).toFixed(1)} ${py(0).toFixed(1)}`;
  const dots = [];
  echeances.forEach(e => {
    const X = px(e.jours), Y = py(e.cumul);
    line += ` L ${X.toFixed(1)} ${Y.toFixed(1)}`;
    dots.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.5" class="cf-dot"><title>${escapeHtml(e.date)} · ${money(e.cumul)} cumulés</title></circle>`);
  });
  const area = line + ` L ${px(maxJ).toFixed(1)} ${(H - PADY).toFixed(1)} L ${px(0).toFixed(1)} ${(H - PADY).toFixed(1)} Z`;
  return `
    <div class="cf-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Courbe cumulée des encaissements à venir">
        <path d="${area}" class="cf-area"/>
        <path d="${line}" class="cf-line" fill="none"/>
        ${dots.join("")}
      </svg>
      <div class="cf-chart-axis"><span>aujourd'hui</span><span>+${maxJ} j · ${money(maxCumul)}</span></div>
    </div>`;
}

function renderComparaisonN1_(c) {
  if (!c || !c.disponible) return "";
  const cur = c.courante, prev = c.precedente, d = c.delta;
  const fleche = v => v > 0 ? "▲" : (v < 0 ? "▼" : "＝");
  const cls = v => v > 0 ? "delta-up" : (v < 0 ? "delta-down" : "");
  const pctTxt = p => p === null ? "n/a" : (p > 0 ? "+" : "") + money(p).replace(" €", " %");
  return `
    <h2 class="section-title">Comparaison saison N-1 <span class="count">au même jour de saison</span></h2>
    <div class="kpi-grid">
      <div class="kpi hero">
        <label>Net réel — ${escapeHtml(c.saison_courante)}</label>
        <strong>${formatMoney(cur.net_reel)}</strong>
        <span class="sub ${cls(d.net_reel)}">${fleche(d.net_reel)} ${pctTxt(d.net_reel_pct)} vs ${escapeHtml(c.saison_precedente)} (${formatMoney(prev.net_reel)})</span>
      </div>
      <div class="kpi"><label>Missions à ce jour</label><strong>${cur.missions}</strong><span class="sub ${cls(d.missions)}">${fleche(d.missions)} ${d.missions > 0 ? "+" : ""}${d.missions} vs ${prev.missions}</span></div>
      <div class="kpi"><label>Indemnités brutes</label><strong>${formatMoney(cur.indemnite)}</strong><span class="sub">N-1 : ${formatMoney(prev.indemnite)}</span></div>
      <div class="kpi"><label>KM parcourus</label><strong>${formatNumber(cur.km, " km")}</strong><span class="sub">N-1 : ${formatNumber(prev.km, " km")}</span></div>
    </div>
    <div class="stat-note">${escapeHtml(c.note || "")}</div>`;
}

function renderStats() {
  const root = document.getElementById("statsFinancier");
  if (!root) return;
  const s = state.serverStats;

  // La période demandée. Le serveur renvoie « Toutes les saisons » quand
  // aucun filtre n'est passé : c'est ce libellé qu'il faut comparer.
  const periodeAttendue = state.selectedSeason || "Toutes les saisons";
  const bonnePeriode = s && s.season === periodeAttendue;

  if (!s || !s.totaux || s.totaux.missions === undefined || !bonnePeriode) {
    // Statistiques absentes, ou calculées pour une autre saison que celle
    // sélectionnée : on affiche le calcul local, juste par construction,
    // et on redemande les statistiques serveur pour la bonne période.
    root.innerHTML = renderStatsClient(s && !bonnePeriode ? s.season : null);
    if (!state._statsEnAttente) {
      state._statsEnAttente = true;
      // Mauvaise période en cache : on va rechercher la bonne au serveur,
      // sans repasser par le cache qui redonnerait la même réponse.
      loadStats(!bonnePeriode);
      setTimeout(() => { state._statsEnAttente = false; }, 8000);
    }
    return;
  }

  const t = s.totaux, m = s.moyennes, rec = s.records;

  root.innerHTML = `
    <h2 class="section-title">Bilan financier <span class="count">${escapeHtml(s.season)}</span></h2>
    <div class="kpi-grid">
      <div class="kpi hero">
        <label>Revenu net réel (indemnités − carburant)</label>
        <strong>${formatMoney(t.net_reel)}</strong>
        <span class="sub">${t.missions} mission(s) · ${t.matchs5x5} en 5×5 · ${t.tournois3x3} en 3×3</span>
      </div>
      <div class="kpi"><label>Indemnités brutes</label><strong>${formatMoney(t.indemnite_brute)}</strong></div>
      <div class="kpi"><label>Coût carburant réel</label><strong>−${formatMoney(t.cout_reel_carburant)}</strong></div>
      <div class="kpi"><label>Déjà reçu</label><strong>${formatMoney(t.recu_total)}</strong><span class="sub">${t.nb_recu} paiement(s)</span></div>
      <div class="kpi"><label>Reste à percevoir</label><strong>${formatMoney(t.a_recevoir_total)}</strong><span class="sub">${t.nb_a_recevoir} en attente</span></div>
    </div>

    ${renderCashFlow_(s.cash_flow)}
    ${renderComparaisonN1_(s.comparaison_saison_precedente)}

    <h2 class="section-title">Efficacité</h2>
    <div class="kpi-grid">
      <div class="kpi"><label>€ / km (indemnité)</label><strong>${money(m.eur_par_km)}</strong><span class="sub">0,40 €/km + match</span></div>
      <div class="kpi"><label>€ / heure (net réel)</label><strong>${money(m.eur_par_heure_moyen)}</strong><span class="sub">trajet inclus</span></div>
      <div class="kpi"><label>Coût réel / 100 km</label><strong>${money(m.cout_reel_par_100km)}</strong></div>
      <div class="kpi"><label>KM total A/R</label><strong>${formatNumber(t.km_total_AR, " km")}</strong></div>
      <div class="kpi"><label>Net moyen / mission</label><strong>${money(m.net_reel_par_mission)}</strong></div>
      <div class="kpi"><label>Indemnité moy. 5×5</label><strong>${money(m.indemnite_par_5x5)}</strong></div>
      <div class="kpi"><label>Indemnité moy. 3×3</label><strong>${money(m.indemnite_par_3x3)}</strong></div>
      <div class="kpi"><label>Équiv. barème fiscal*</label><strong>${formatMoney(t.equivalent_bareme_fiscal)}</strong><span class="sub">info — non versé</span></div>
    </div>
    <div class="stat-note">* Le barème fiscal (chevaux fiscaux) est indicatif : la FFBB rembourse toujours 0,40 €/km, jamais au barème. ${s.note_3x3 ? escapeHtml(s.note_3x3) : ""}</div>

    ${renderRepartitionRoles()}
    ${renderRecords(rec)}
    ${renderAggTable("Par saison", s.par_saison, "Saison")}
    ${renderAggTable("Par mois", s.par_mois, "Mois")}
    ${renderAggTable("Par niveau", s.par_niveau, "Niveau")}
    ${renderTop("Top 3 clubs (5×5)", s.top_clubs)}
    ${renderTop("Top 3 salles (5×5)", s.top_salles)}
    ${renderTop("Top 3 villes", s.top_villes)}
    ${renderTop("Top 3 collègues (5×5)", s.top_collegues)}
    ${renderAggTable("Événements 3×3", s.evenements_3x3, "Événement")}
    ${renderMatchsAnnules()}
    ${renderFormations()}
  `;
  attachFormationsListeners_(root);
}

/* Suivi des matchs annulés — rubrique STATS séparée (19/09/2026).
   Les rencontres annulées restent en base (statut « Annulé ») pour garder
   la trace de la désignation, mais disparaissent de tous les autres écrans
   (Matchs, 3x3, Paiements, calcul des stats) : ce bloc les rend visibles,
   sur la saison filtrée en cours, sans les compter dans aucun total. */
function renderMatchsAnnules() {
  const rows = state.filteredRows
    .filter(r => r._format !== "Alerte" && !r._isActive)
    .sort(sortByDateDesc);
  if (!rows.length) return "";
  return `
    <h2 class="section-title">Matchs annulés <span class="count">${rows.length}</span></h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Format</th><th>Rencontre</th><th>Lieu</th><th>Annulation</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(get(r, "Date match"))}</td>
        <td>${escapeHtml(r._format)}</td>
        <td>${escapeHtml(rencontreLabel(r))}</td>
        <td>${escapeHtml(get(r, "Ville") || get(r, "Salle"))}</td>
        <td>${escapeHtml(get(r, "Warning général") || "—")}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`;
}

/* Répartition Arbitre n°1 (Crew Chief) / Arbitre n°2 sur les missions 5×5
   de la saison filtrée — le rôle est déjà lu depuis la convocation dans la
   colonne « Mon rôle », rien à ajouter côté Code.gs. (19/09/2026) */
function renderRepartitionRoles() {
  const rows = state.filteredRows.filter(r => r._isActive && r._format === "5x5");
  if (!rows.length) return "";
  const n1 = rows.filter(r => get(r, "Mon rôle") === "Crew Chief").length;
  const n2 = rows.filter(r => get(r, "Mon rôle") === "Arbitre n°2").length;
  const autre = rows.length - n1 - n2;
  const pct = n => rows.length ? Math.round((n / rows.length) * 100) : 0;
  return `
    <h2 class="section-title">Répartition des rôles (5×5)</h2>
    <div class="kpi-grid">
      <div class="kpi"><label>1er arbitre (Crew Chief)</label><strong>${n1}</strong><span class="sub">${pct(n1)} % des missions</span></div>
      <div class="kpi"><label>2ème arbitre</label><strong>${n2}</strong><span class="sub">${pct(n2)} % des missions</span></div>
      ${autre ? `<div class="kpi"><label>Rôle non renseigné</label><strong>${autre}</strong></div>` : ""}
    </div>`;
}

/* Déplacements de formation non rémunérés (19/09/2026) — stages et
   recyclages : aucune indemnité FFBB dessus, saisie manuelle (rien à
   parser dans un mail), mais le coût carburant réel est suivi comme
   pour une mission, avec la même logique de prix historique/temps réel. */
function loadFormations() {
  if (state._formationsEnCours) return;
  state._formationsEnCours = true;
  jsonp("formations")
    .then(res => {
      state.formations = (res && res.success) ? res.data : [];
      state._formationsEnCours = false;
      if (state.activeTab === "stats") renderStats();
    })
    .catch(() => { state._formationsEnCours = false; });
}

function renderFormations() {
  if (state.formations === null) { loadFormations(); return ""; }

  const rows = state.formations;
  const kmTotal = rows.reduce((t, f) => t + f.km, 0);
  const coutTotal = rows.reduce((t, f) => t + realFuelCostClient(f.km, parseFrDate(f.date)), 0);

  return `
    <h2 class="section-title">Déplacements formation <span class="count">${rows.length}</span></h2>
    ${rows.length ? `
    <div class="kpi-grid">
      <div class="kpi"><label>Déplacements</label><strong>${rows.length}</strong><span class="sub">non rémunérés</span></div>
      <div class="kpi"><label>Km total A/R</label><strong>${formatNumber(kmTotal, " km")}</strong></div>
      <div class="kpi"><label>Coût carburant réel</label><strong>${formatMoney(coutTotal)}</strong><span class="sub">non remboursé</span></div>
    </div>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Intitulé</th><th>Lieu</th><th class="num">Km A/R</th><th class="num">Carburant</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows.map(f => `<tr>
        <td>${escapeHtml(f.date)}</td>
        <td>${escapeHtml(f.intitule)}</td>
        <td>${escapeHtml(f.lieu)}</td>
        <td class="num">${formatNumber(f.km, "")}</td>
        <td class="num">${formatMoney(realFuelCostClient(f.km, parseFrDate(f.date)))}</td>
        <td>${escapeHtml(f.notes || "—")}</td>
        <td><button type="button" class="action-link" data-del-formation-date="${escapeHtml(f.date)}" data-del-formation-intitule="${escapeHtml(f.intitule)}">Supprimer</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : empty("Aucun déplacement de formation enregistré.")}

    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter un déplacement</span></span></summary>
      <div class="past-body">
        <form id="formationForm" class="toolbar" style="grid-template-columns: 1fr 2fr 2fr 1fr; align-items:end; margin-top:10px">
          <div class="field"><label for="formationDate">Date</label><input id="formationDate" type="date" required /></div>
          <div class="field"><label for="formationIntitule">Intitulé</label><input id="formationIntitule" type="text" placeholder="Stage recyclage CD67…" required /></div>
          <div class="field"><label for="formationLieu">Lieu</label><input id="formationLieu" type="text" placeholder="Ville / salle" /></div>
          <div class="field"><label for="formationKm">Km A/R</label><input id="formationKm" type="number" min="0" step="1" required /></div>
        </form>
        <div class="field" style="margin-top:10px"><label for="formationNotes">Notes</label><input id="formationNotes" type="text" placeholder="Optionnel" /></div>
        <div class="actions" style="margin-top:10px"><button class="small-btn secondary" type="submit" form="formationForm">Enregistrer</button></div>
      </div>
    </details>
  `;
}

function attachFormationsListeners_(root) {
  const form = root.querySelector("#formationForm");
  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const date = document.getElementById("formationDate").value;
      const intitule = document.getElementById("formationIntitule").value;
      const lieu = document.getElementById("formationLieu").value;
      const km = document.getElementById("formationKm").value;
      const notes = document.getElementById("formationNotes") ? document.getElementById("formationNotes").value : "";
      setStatus("Enregistrement du déplacement…", "");
      try {
        const res = await jsonp("addFormation", { date, intitule, lieu, km, notes });
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Déplacement enregistré", "ok");
        state.formations = null;
        loadFormations();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-del-formation-date]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce déplacement ?")) return;
      try {
        const res = await jsonp("deleteFormation", { date: btn.dataset.delFormationDate, intitule: btn.dataset.delFormationIntitule });
        if (!res.success) throw new Error(res.error || "Erreur suppression");
        state.formations = null;
        loadFormations();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  });
}

/* Onglet Progression (18/09/2026) — trois blocs :
   1) historique daté du niveau d'arbitrage personnel (saisie manuelle,
      onglet NIVEAUX_ARBITRAGE) ;
   2) désignations reçues par niveau et par saison — recalculé en local
      à partir des matchs déjà chargés, rien à demander au serveur ;
   3) évaluations d'observation : l'IA (Gemini) et le dépôt glisser-déposer
      ne sont pas encore branchés (voir note dans le bloc) — le formulaire
      manuel sert de repli en attendant. */
function loadNiveaux() {
  if (state._niveauxEnCours) return;
  state._niveauxEnCours = true;
  jsonp("niveaux")
    .then(res => {
      state.niveaux = (res && res.success) ? res.data : [];
      state._niveauxErreur = false;
    })
    .catch(err => {
      state.niveaux = null;
      state._niveauxErreur = (err && err.message) || "Erreur de chargement";
    })
    .finally(() => {
      state._niveauxEnCours = false;
      if (state.activeTab === "progression") renderProgression();
    });
}

function loadEvaluations() {
  if (state._evaluationsEnCours) return;
  state._evaluationsEnCours = true;
  jsonp("evaluations")
    .then(res => {
      state.evaluations = (res && res.success) ? res.data : [];
      state._evaluationsErreur = false;
    })
    .catch(err => {
      state.evaluations = null;
      state._evaluationsErreur = (err && err.message) || "Erreur de chargement";
    })
    .finally(() => {
      state._evaluationsEnCours = false;
      if (state.activeTab === "progression") renderProgression();
    });
}

function fileToBase64_(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

async function uploaderEvaluation_(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    setStatus("Seuls les PDF sont acceptés", "error");
    return;
  }
  setStatus("Envoi de " + file.name + "…", "");
  try {
    const base64 = await fileToBase64_(file);
    const res = await jsonp("evaluation.upload", { filename: file.name, mimeType: file.type || "application/pdf", base64 });
    if (!res.success) throw new Error(res.error || "Erreur d'envoi");
    setStatus(res.matched ? "Évaluation classée : " + res.matchLabel : "Évaluation déposée (match non identifié)", "ok");
    state.evaluations = null;
    loadEvaluations();
  } catch (err) {
    setStatus("Erreur : " + err.message, "error");
  }
}

function renderDesignationsParNiveau_() {
  const rows = state.allRows.filter(r => r._isActive && r._format === "5x5");
  if (!rows.length) return "";
  const parSaison = {};
  rows.forEach(r => {
    const saison = r._season || "?";
    const niveau = get(r, "Niveau administratif") || "Non renseigné";
    parSaison[saison] = parSaison[saison] || {};
    parSaison[saison][niveau] = (parSaison[saison][niveau] || 0) + 1;
  });
  const saisons = Object.keys(parSaison).sort();
  const niveaux = ["Départemental", "Régional", "Championnat de France", "Amical", "Non renseigné"];
  return `
    <h2 class="section-title">Désignations reçues par niveau</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Saison</th>${niveaux.map(n => `<th class="num">${escapeHtml(n)}</th>`).join("")}</tr></thead>
      <tbody>${saisons.map(s => `<tr>
        <td>${escapeHtml(s)}</td>
        ${niveaux.map(n => `<td class="num">${parSaison[s][n] || 0}</td>`).join("")}
      </tr>`).join("")}</tbody>
    </table></div></div>`;
}

function renderProgression() {
  const root = document.getElementById("progression");
  if (!root) return;

  if (state.niveaux === null) {
    if (state._niveauxErreur) {
      root.innerHTML = `
        <h2 class="section-title">Progression</h2>
        <div class="table-card" style="padding:16px; text-align:center">
          <p class="card-sub" style="margin:0 0 10px">Impossible de charger cette partie (${escapeHtml(state._niveauxErreur)}).</p>
          <button type="button" class="small-btn secondary" id="retryNiveaux">Réessayer</button>
        </div>`;
      const btn = root.querySelector("#retryNiveaux");
      if (btn) btn.addEventListener("click", () => { state._niveauxErreur = false; loadNiveaux(); });
    } else {
      loadNiveaux();
      root.innerHTML = empty("Chargement…");
    }
    return;
  }
  if (state.evaluations === null && !state._evaluationsErreur) loadEvaluations();

  const niveaux = state.niveaux;
  // Niveau actuel = la ligne encore active (pas de date de fin) la plus récente,
  // sinon la ligne la plus récente tout court (même logique que l'extranet FFBB).
  const actuel = niveaux.find(n => !n.dateFin) || niveaux[0] || null;

  const evaluations = state.evaluations || [];
  const planTravail = evaluations.filter(ev => ev.axe1 || ev.axe2);

  root.innerHTML = `
    <h2 class="section-title">Progression</h2>
    <div class="kpi-grid">
      <div class="kpi hero">
        <label>Niveau actuel</label>
        <strong>${actuel ? escapeHtml(actuel.niveau) : "Non renseigné"}</strong>
        <span class="sub">${actuel ? "Depuis le " + escapeHtml(actuel.dateDebut) + (actuel.groupement ? " — " + escapeHtml(actuel.groupement) : "") : "Ajoute ta première entrée plus bas"}</span>
      </div>
    </div>

    <h2 class="section-title">Plan de travail (IA)</h2>
    ${planTravail.length ? `
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Match</th><th>Date</th><th>Point à travailler 1</th><th>Point à travailler 2</th></tr></thead>
      <tbody>${planTravail.map(ev => `<tr>
        <td>${escapeHtml(ev.rencontre || "Non identifié")}</td>
        <td>${escapeHtml(ev.dateMatch || ev.dateDepot)}</td>
        <td>${escapeHtml(ev.axe1 || "—")}</td>
        <td>${escapeHtml(ev.axe2 || "—")}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : empty("Dépose une évaluation ci-dessous pour générer ton plan de travail IA, match par match.")}

    <h2 class="section-title">Évaluations</h2>
    <div class="table-card" style="padding:16px">
      <div id="evalDropzone" class="eval-dropzone">
        <span class="eval-dropzone-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-5"/><path d="M3 14v5a2 2 0 0 0 2 2h1"/></svg>
        </span>
        <p class="eval-dropzone-text">Glisse un PDF d'évaluation ici, ou <label for="evalFileInput" class="eval-dropzone-link">choisis un fichier</label></p>
        <p class="eval-dropzone-sub">Le match correspondant est identifié automatiquement (date + club), le fichier est classé dans le Drive dédié, et l'IA en tire 2 points de travail prioritaires.</p>
        <input id="evalFileInput" type="file" accept="application/pdf" hidden />
      </div>
    </div>

    ${evaluations.length ? `
    <div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Déposé le</th><th>Match lié</th><th>Fichier</th><th>Statut IA</th></tr></thead>
      <tbody>${evaluations.map(ev => `<tr>
        <td>${escapeHtml(ev.dateDepot)}</td>
        <td>${escapeHtml(ev.rencontre || "Non identifié")}</td>
        <td><a href="${escapeHtml(ev.lien)}" target="_blank" rel="noopener">${escapeHtml(ev.fichier)}</a></td>
        <td>${escapeHtml(ev.statut || "—")}</td>
      </tr>${ev.synthese ? `<tr><td colspan="4" style="padding-top:0">
        <details class="past-block"><summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Voir la synthèse IA</span></span></summary>
        <div class="past-body" style="white-space:pre-wrap; font-size:13px; line-height:1.5">${escapeHtml(ev.synthese)}</div></details>
      </td></tr>` : ""}`).join("")}</tbody>
    </table></div></div>` : ""}

    <h2 class="section-title">Historique du niveau</h2>
    ${niveaux.length ? `
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Type d'officiel</th><th>Niveau</th><th>Couleur</th><th>Recyclage</th><th>Début</th><th>Fin</th><th>Groupement</th><th>Saisi par</th><th></th></tr></thead>
      <tbody>${niveaux.map(n => `<tr>
        <td>${escapeHtml(n.typeOfficiel || "—")}</td>
        <td>${escapeHtml(n.niveau || "—")}</td>
        <td>${escapeHtml(n.couleur || "—")}</td>
        <td>${escapeHtml(n.recyclage || "—")}</td>
        <td>${escapeHtml(n.dateDebut || "—")}</td>
        <td>${escapeHtml(n.dateFin || "—")}</td>
        <td>${escapeHtml(n.groupement || "—")}</td>
        <td>${escapeHtml(n.saisiPar || "—")}</td>
        <td><button type="button" class="action-link" data-del-niveau-id="${n.id}">Supprimer</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : empty("Aucun niveau enregistré pour l'instant.")}

    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter un niveau</span></span></summary>
      <div class="past-body">
        <p class="card-sub" style="margin:0 0 10px">Copie les valeurs depuis le tableau "Niveaux" de ton extranet officiels FFBB.</p>
        <form id="niveauForm" class="toolbar" style="grid-template-columns: repeat(4, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="niveauType">Type d'officiel</label><input id="niveauType" type="text" value="Arbitre" /></div>
          <div class="field"><label for="niveauNiveau">Niveau</label><input id="niveauNiveau" type="text" placeholder="Ex. Championnats de France Jeunes" required /></div>
          <div class="field"><label for="niveauCouleur">Couleur</label><input id="niveauCouleur" type="text" placeholder="Ex. Rouge" /></div>
          <div class="field"><label for="niveauRecyclage">Recyclage</label><input id="niveauRecyclage" type="date" /></div>
          <div class="field"><label for="niveauDateDebut">Date de début</label><input id="niveauDateDebut" type="date" required /></div>
          <div class="field"><label for="niveauDateFin">Date de fin</label><input id="niveauDateFin" type="date" /></div>
          <div class="field"><label for="niveauGroupement">Groupement</label><input id="niveauGroupement" type="text" placeholder="Ex. GES0067070 - WEITBRUCH A.S.C.G" /></div>
          <div class="field"><label for="niveauSaisiPar">Saisi par</label><input id="niveauSaisiPar" type="text" placeholder="Ex. GES - LIGUE REGIONALE GRAND EST" /></div>
        </form>
        <div class="actions" style="margin-top:10px"><button class="small-btn secondary" type="submit" form="niveauForm">Enregistrer</button></div>
      </div>
    </details>

    ${renderDesignationsParNiveau_()}
  `;

  const form = root.querySelector("#niveauForm");
  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const payload = {
        typeOfficiel: document.getElementById("niveauType").value,
        niveau: document.getElementById("niveauNiveau").value,
        couleur: document.getElementById("niveauCouleur").value,
        recyclage: document.getElementById("niveauRecyclage").value,
        dateDebut: document.getElementById("niveauDateDebut").value,
        dateFin: document.getElementById("niveauDateFin").value,
        groupement: document.getElementById("niveauGroupement").value,
        saisiPar: document.getElementById("niveauSaisiPar").value
      };
      setStatus("Enregistrement du niveau…", "");
      try {
        const res = await jsonp("addNiveau", payload);
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Niveau enregistré", "ok");
        state.niveaux = null;
        loadNiveaux();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-del-niveau-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer cette entrée ?")) return;
      try {
        const res = await jsonp("deleteNiveau", { id: btn.dataset.delNiveauId });
        if (!res.success) throw new Error(res.error || "Erreur suppression");
        state.niveaux = null;
        loadNiveaux();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  });

  const dz = root.querySelector("#evalDropzone");
  const fileInput = root.querySelector("#evalFileInput");
  if (dz && fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) uploaderEvaluation_(fileInput.files[0]);
      fileInput.value = "";
    });
    ["dragenter", "dragover"].forEach(evt => {
      dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add("is-dragover"); });
    });
    ["dragleave", "drop"].forEach(evt => {
      dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove("is-dragover"); });
    });
    dz.addEventListener("drop", e => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) uploaderEvaluation_(file);
    });
  }
}

/* Onglet Contacts & Procédures (19/09/2026) — carnet de contacts (clubs,
   collègues, responsables ligue) et pense-bêtes de procédures, saisis à la
   main. Même pattern robuste que Niveaux/Évaluations : sur échec réseau on
   affiche une erreur avec bouton "Réessayer" plutôt que de rester bloqué
   sur "Chargement…" indéfiniment. */
function loadContacts() {
  if (state._contactsEnCours) return;
  state._contactsEnCours = true;
  jsonp("contacts")
    .then(res => {
      state.contacts = (res && res.success) ? res.data : [];
      state._contactsErreur = false;
    })
    .catch(err => {
      state.contacts = null;
      state._contactsErreur = (err && err.message) || "Erreur de chargement";
    })
    .finally(() => {
      state._contactsEnCours = false;
      if (state.activeTab === "contacts") renderContacts();
    });
}

function loadProcedures() {
  if (state._proceduresEnCours) return;
  state._proceduresEnCours = true;
  jsonp("procedures")
    .then(res => {
      state.procedures = (res && res.success) ? res.data : [];
      state._proceduresErreur = false;
    })
    .catch(err => {
      state.procedures = null;
      state._proceduresErreur = (err && err.message) || "Erreur de chargement";
    })
    .finally(() => {
      state._proceduresEnCours = false;
      if (state.activeTab === "contacts") renderContacts();
    });
}

function setContactsSubView_(view) {
  state.contactsSubView = view;
  renderContacts();
}

function renderContacts() {
  const root = document.getElementById("contacts");
  if (!root) return;

  if (state.contactsSubView === "contacts" && state.contacts === null) {
    if (state._contactsErreur) {
      root.innerHTML = renderChargementErreur_(state._contactsErreur, "retryContacts");
      const btn = root.querySelector("#retryContacts");
      if (btn) btn.addEventListener("click", () => { state._contactsErreur = false; loadContacts(); });
      return;
    }
    loadContacts();
    root.innerHTML = empty("Chargement…");
    return;
  }
  if (state.contactsSubView === "procedures" && state.procedures === null) {
    if (state._proceduresErreur) {
      root.innerHTML = renderChargementErreur_(state._proceduresErreur, "retryProcedures");
      const btn = root.querySelector("#retryProcedures");
      if (btn) btn.addEventListener("click", () => { state._proceduresErreur = false; loadProcedures(); });
      return;
    }
    loadProcedures();
    root.innerHTML = empty("Chargement…");
    return;
  }
  // Précharge l'autre sous-vue en arrière-plan pour un basculement instantané.
  if (state.contacts === null && !state._contactsErreur) loadContacts();
  if (state.procedures === null && !state._proceduresErreur) loadProcedures();

  root.innerHTML = `
    <h2 class="section-title">Contacts &amp; Procédures</h2>
    <div class="tabs-mini">
      <button type="button" class="tabs-mini-btn${state.contactsSubView === "contacts" ? " active" : ""}" id="contactsSubContactsBtn">Contacts</button>
      <button type="button" class="tabs-mini-btn${state.contactsSubView === "procedures" ? " active" : ""}" id="contactsSubProceduresBtn">Procédures</button>
    </div>
    <div id="contactsSubPanel">${state.contactsSubView === "contacts" ? renderContactsPanel_() : renderProceduresPanel_()}</div>
  `;

  root.querySelector("#contactsSubContactsBtn").addEventListener("click", () => setContactsSubView_("contacts"));
  root.querySelector("#contactsSubProceduresBtn").addEventListener("click", () => setContactsSubView_("procedures"));

  attachContactsPanelListeners_(root);
}

function renderChargementErreur_(message, retryId) {
  return `
    <h2 class="section-title">Contacts &amp; Procédures</h2>
    <div class="table-card" style="padding:16px; text-align:center">
      <p class="card-sub" style="margin:0 0 10px">Impossible de charger cette partie (${escapeHtml(message)}).</p>
      <button type="button" class="small-btn secondary" id="${retryId}">Réessayer</button>
    </div>`;
}

function renderContactsPanel_() {
  const contacts = state.contacts || [];
  const q = normaliserRecherche(state.contactsSearch || "");
  const filtres = q
    ? contacts.filter(c => normaliserRecherche([c.nom, c.role, c.organisation, c.telephone, c.email, c.notes].filter(Boolean).join(" ")).indexOf(q) >= 0)
    : contacts;

  return `
    <div class="toolbar" style="grid-template-columns: minmax(220px, 360px); margin-top:12px">
      <div class="field"><label for="contactsSearchInput">Recherche</label><input id="contactsSearchInput" type="text" placeholder="Nom, club, téléphone…" value="${escapeHtml(state.contactsSearch || "")}" /></div>
    </div>

    ${filtres.length ? `
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Rôle</th><th>Organisation / Club</th><th>Téléphone</th><th>Email</th><th>Notes</th><th></th></tr></thead>
      <tbody>${filtres.map(c => `<tr>
        <td>${escapeHtml(c.nom || "—")}</td>
        <td>${escapeHtml(c.role || "—")}</td>
        <td>${escapeHtml(c.organisation || "—")}</td>
        <td>${c.telephone ? `<a href="tel:${escapeHtml(c.telephone)}">${escapeHtml(c.telephone)}</a>` : "—"}</td>
        <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : "—"}</td>
        <td>${escapeHtml(c.notes || "—")}</td>
        <td><button type="button" class="action-link" data-del-contact-id="${c.id}">Supprimer</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : empty(q ? "Aucun contact ne correspond à cette recherche." : "Aucun contact enregistré pour l'instant.")}

    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter un contact</span></span></summary>
      <div class="past-body">
        <form id="contactForm" class="toolbar" style="grid-template-columns: repeat(3, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="contactNom">Nom</label><input id="contactNom" type="text" required /></div>
          <div class="field"><label for="contactRole">Rôle</label><input id="contactRole" type="text" placeholder="Ex. Responsable ligue, Collègue arbitre…" /></div>
          <div class="field"><label for="contactOrganisation">Organisation / Club</label><input id="contactOrganisation" type="text" /></div>
          <div class="field"><label for="contactTelephone">Téléphone</label><input id="contactTelephone" type="tel" /></div>
          <div class="field"><label for="contactEmail">Email</label><input id="contactEmail" type="email" /></div>
          <div class="field"><label for="contactNotes">Notes</label><input id="contactNotes" type="text" /></div>
        </form>
        <div class="actions" style="margin-top:10px"><button class="small-btn secondary" type="submit" form="contactForm">Enregistrer</button></div>
      </div>
    </details>
  `;
}

function renderProceduresPanel_() {
  const procedures = state.procedures || [];
  return `
    ${procedures.length ? `
    <div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Titre</th><th>Catégorie</th><th>Contenu</th><th>Lien</th><th></th></tr></thead>
      <tbody>${procedures.map(p => `<tr>
        <td>${escapeHtml(p.titre || "—")}</td>
        <td>${escapeHtml(p.categorie || "—")}</td>
        <td style="white-space:pre-wrap">${escapeHtml(p.contenu || "—")}</td>
        <td>${p.lien ? `<a href="${escapeHtml(p.lien)}" target="_blank" rel="noopener">Ouvrir</a>` : "—"}</td>
        <td><button type="button" class="action-link" data-del-procedure-id="${p.id}">Supprimer</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : empty("Aucune procédure enregistrée pour l'instant.")}

    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter une procédure</span></span></summary>
      <div class="past-body">
        <form id="procedureForm" class="toolbar" style="grid-template-columns: 1fr 1fr; align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="procedureTitre">Titre</label><input id="procedureTitre" type="text" required /></div>
          <div class="field">
            <label for="procedureCategorie">Catégorie</label>
            <select id="procedureCategorie">
              <option value="Règlement">Règlement</option>
              <option value="Logistique">Logistique</option>
              <option value="Administratif">Administratif</option>
              <option value="Autre">Autre</option>
            </select>
          </div>
          <div class="field" style="grid-column: 1 / -1"><label for="procedureContenu">Contenu</label><textarea id="procedureContenu" rows="4" style="width:100%; font-family:inherit; padding:10px; border-radius:var(--radius-md); border:1px solid var(--line); background:var(--surface); color:var(--text)"></textarea></div>
          <div class="field"><label for="procedureLien">Lien (optionnel)</label><input id="procedureLien" type="url" placeholder="https://…" /></div>
        </form>
        <div class="actions" style="margin-top:10px"><button class="small-btn secondary" type="submit" form="procedureForm">Enregistrer</button></div>
      </div>
    </details>
  `;
}

function attachContactsPanelListeners_(root) {
  const searchInput = root.querySelector("#contactsSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      state.contactsSearch = e.target.value;
      const panel = root.querySelector("#contactsSubPanel");
      if (panel) panel.innerHTML = renderContactsPanel_();
      attachContactsPanelListeners_(root);
    });
  }

  const contactForm = root.querySelector("#contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", async e => {
      e.preventDefault();
      const payload = {
        nom: document.getElementById("contactNom").value,
        role: document.getElementById("contactRole").value,
        organisation: document.getElementById("contactOrganisation").value,
        telephone: document.getElementById("contactTelephone").value,
        email: document.getElementById("contactEmail").value,
        notes: document.getElementById("contactNotes").value
      };
      setStatus("Enregistrement du contact…", "");
      try {
        const res = await jsonp("addContact", payload);
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Contact enregistré", "ok");
        state.contacts = null;
        loadContacts();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-del-contact-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce contact ?")) return;
      try {
        const res = await jsonp("deleteContact", { id: btn.dataset.delContactId });
        if (!res.success) throw new Error(res.error || "Erreur suppression");
        state.contacts = null;
        loadContacts();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  });

  const procedureForm = root.querySelector("#procedureForm");
  if (procedureForm) {
    procedureForm.addEventListener("submit", async e => {
      e.preventDefault();
      const payload = {
        titre: document.getElementById("procedureTitre").value,
        categorie: document.getElementById("procedureCategorie").value,
        contenu: document.getElementById("procedureContenu").value,
        lien: document.getElementById("procedureLien").value
      };
      setStatus("Enregistrement de la procédure…", "");
      try {
        const res = await jsonp("addProcedure", payload);
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Procédure enregistrée", "ok");
        state.procedures = null;
        loadProcedures();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-del-procedure-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer cette procédure ?")) return;
      try {
        const res = await jsonp("deleteProcedure", { id: btn.dataset.delProcedureId });
        if (!res.success) throw new Error(res.error || "Erreur suppression");
        state.procedures = null;
        loadProcedures();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  });
}

function renderRecords(rec) {
  if (!rec) return "";
  const items = [];
  if (rec.plus_gros_deplacement) items.push(["Plus gros déplacement", `${rec.plus_gros_deplacement.km} km — ${rec.plus_gros_deplacement.lieu}`]);
  if (rec.plus_grosse_indemnite) items.push(["Plus grosse indemnité", `${formatMoney(rec.plus_grosse_indemnite.montant)} — ${rec.plus_grosse_indemnite.lieu}`]);
  if (rec.meilleur_net_reel) items.push(["Meilleur net réel", `${formatMoney(rec.meilleur_net_reel.net)} — ${rec.meilleur_net_reel.lieu}`]);
  if (rec.pire_rentabilite_horaire) items.push(["Pire rentabilité horaire", `${money(rec.pire_rentabilite_horaire.eur_heure)}/h — ${rec.pire_rentabilite_horaire.lieu}`]);
  if (!items.length) return "";
  return `<h2 class="section-title">Records</h2><div class="kpi-grid">${items.map(([l, v]) =>
    `<div class="kpi"><label>${escapeHtml(l)}</label><strong style="font-size:15px">${escapeHtml(v)}</strong></div>`).join("")}</div>`;
}

function renderAggTable(title, rows, keyLabel) {
  if (!rows || !rows.length) return "";
  return `
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>${escapeHtml(keyLabel || "Clé")}</th><th class="num">Missions</th><th class="num">Indemnités</th><th class="num">Carburant</th><th class="num">Net réel</th><th class="num">KM</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(r.label)}</td>
        <td class="num">${r.count}</td>
        <td class="num">${formatMoney(r.indemnite)}</td>
        <td class="num">${formatMoney(r.cout_reel)}</td>
        <td class="num pos">${formatMoney(r.net_reel)}</td>
        <td class="num">${formatNumber(r.km, "")}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`;
}

/* Top 3 uniquement : au-delà, la table encombre plus qu'elle n'informe.
   Le serveur peut renvoyer davantage de lignes (rétrocompatibilité), on
   tronque toujours côté client. */
function renderTop(title, rows) {
  if (!rows || !rows.length) return "";
  const top3 = rows.slice(0, 3);
  return `
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th class="num">Nombre</th><th class="num">Indemnités</th><th class="num">Net réel</th></tr></thead>
      <tbody>${top3.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td><td class="num">${formatMoney(r.indemnite)}</td><td class="num pos">${formatMoney(r.net_reel)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
}

/* Calcul local, sur la saison réellement sélectionnée. Sert quand les
   statistiques serveur manquent ou portent sur une autre période.
   @param {string|null} periodeRecue  la période des stats serveur en mémoire,
                                      si elle ne correspond pas à la sélection. */
function renderStatsClient(periodeRecue) {
  const periode = state.selectedSeason || "Toutes les saisons";
  const rows = state.filteredRows.filter(r => r._isActive && r._format !== "Alerte");

  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._km, r._date), 0);
  const km = rows.reduce((t, r) => t + (r._km || 0), 0);
  const benevoles = rows.filter(r => r._benevole);
  const cinq = rows.filter(r => r._format === "5x5").length;
  const trois = rows.filter(r => r._format === "3x3").length;

  const note = periodeRecue
    ? `Les statistiques détaillées affichées par le serveur portaient sur « ${escapeHtml(periodeRecue)} ». Elles sont en cours de recalcul pour ${escapeHtml(periode)}.`
    : "Statistiques détaillées en cours de chargement depuis le serveur…";

  return `
    <h2 class="section-title">Bilan financier <span class="count">${escapeHtml(periode)}</span></h2>
    <div class="kpi-grid">
      <div class="kpi hero">
        <label>Revenu net réel (indemnités − carburant)</label>
        <strong>${formatMoney(gross - cost)}</strong>
        <span class="sub">${rows.length} mission(s) · ${cinq} en 5×5 · ${trois} en 3×3</span>
      </div>
      <div class="kpi"><label>Indemnités perçues</label><strong>${formatMoney(gross)}</strong></div>
      <div class="kpi"><label>Carburant réel</label><strong>−${formatMoney(cost)}</strong></div>
      <div class="kpi"><label>KM total A/R</label><strong>${formatNumber(km, " km")}</strong></div>
      <div class="kpi"><label>€ / km</label><strong>${money(km > 0 ? gross / km : 0)}</strong></div>
      <div class="kpi"><label>Net moyen / mission</label><strong>${money(rows.length ? (gross - cost) / rows.length : 0)}</strong></div>
      ${benevoles.length ? `<div class="kpi"><label>Dont bénévolat</label><strong>${benevoles.length}</strong><span class="sub">mission(s) sans indemnité</span></div>` : ""}
    </div>
    <div class="stat-note">${note}</div>
    <div style="margin:12px 4px">
      <button class="small-btn secondary" id="btnRechargerStats">Recharger les statistiques</button>
    </div>`;
}

/* ---------------- QCM arbitrage (19/09/2026) ----------------
   Série jouable directement dans l'app, sur le format officiel : 20
   questions tirées au hasard dans la banque (459 questions, reprises de
   ton app qcm-arbitrage), 10 minutes chrono. Le résultat s'enregistre
   automatiquement à la fin — plus de saisie manuelle du score. */

const QCM_DUREE_SEC = 600; // 10 minutes

function loadQcmStats() {
  jsonp("qcmStats")
    .then(res => {
      if (res && res.success) {
        state.qcmStats = res.stats;
        if (state.activeTab === "qcm" && !state.qcmSession) renderQcm();
      }
    })
    .catch(err => console.warn("Stats QCM indisponibles :", err && err.message));
}

function loadQcmBank() {
  if (state.qcmBank || state._qcmBankEnCours) return;
  state._qcmBankEnCours = true;
  fetch("./data/questions.json")
    .then(r => r.json())
    .then(d => {
      state.qcmBank = (d && d.questions) || [];
      state._qcmBankEnCours = false;
      if (state.activeTab === "qcm" && !state.qcmSession) renderQcm();
    })
    .catch(err => {
      state._qcmBankEnCours = false;
      console.warn("Banque QCM indisponible :", err && err.message);
    });
}

function melanger_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function demarrerSerieQcm() {
  if (!state.qcmBank || !state.qcmBank.length) { setStatus("Banque de questions non chargée, réessaie dans un instant", "error"); return; }
  const questions = melanger_(state.qcmBank).slice(0, 20);
  state.qcmSession = {
    questions,
    reponses: {},           // { questionId: [indices choisis] }
    debut: Date.now(),
    fin: Date.now() + QCM_DUREE_SEC * 1000,
    resultat: null
  };
  demarrerTimerQcm_();
  renderQcm();
}

function demarrerTimerQcm_() {
  arreterTimerQcm_();
  state._qcmTimerId = setInterval(() => {
    const s = state.qcmSession;
    if (!s || s.resultat) { arreterTimerQcm_(); return; }
    const restant = s.fin - Date.now();
    const el = document.getElementById("qcmChrono");
    if (el) el.textContent = formatChronoQcm_(restant);
    if (restant <= 0) { arreterTimerQcm_(); soumettreSerieQcm(true); }
  }, 1000);
}

function arreterTimerQcm_() {
  if (state._qcmTimerId) { clearInterval(state._qcmTimerId); state._qcmTimerId = null; }
}

function formatChronoQcm_(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

async function soumettreSerieQcm(auto) {
  const s = state.qcmSession;
  if (!s || s.resultat) return;
  arreterTimerQcm_();

  let bonnes = 0;
  const details = s.questions.map(q => {
    const choisi = (s.reponses[q.id] || []).slice().sort();
    const correct = (q.correct || []).slice().sort();
    const ok = choisi.length === correct.length && choisi.every((v, i) => v === correct[i]);
    if (ok) bonnes++;
    return { q, choisi, ok };
  });

  const dureeMin = Math.round(((Date.now() - s.debut) / 60000) * 10) / 10;
  s.resultat = { bonnes, total: s.questions.length, details, auto: Boolean(auto), duree: dureeMin };
  renderQcm();

  try {
    const res = await jsonp("addQcmSession", { score: bonnes, total: s.questions.length, duree: dureeMin });
    if (!res.success) throw new Error(res.error || "Erreur enregistrement");
    setStatus("Série enregistrée (" + bonnes + "/" + s.questions.length + ")", "ok");
    state.qcmStats = null;
    loadQcmStats();
  } catch (err) {
    setStatus("Série jouée mais non enregistrée : " + err.message, "error");
  }
}

function quitterSerieQcm() {
  arreterTimerQcm_();
  state.qcmSession = null;
  renderQcm();
}

function renderQcm() {
  const root = document.getElementById("qcm");
  if (!root) return;

  if (!state.qcmBank && !state._qcmBankEnCours) loadQcmBank();

  if (state.qcmSession) { renderQcmSession_(root); return; }

  const s = state.qcmStats;

  root.innerHTML = `
    <h2 class="section-title">Série QCM</h2>
    <div class="table-card" style="padding:16px; text-align:center">
      <p class="card-sub" style="margin:0 0 12px">20 questions tirées au hasard · 10 minutes chrono · résultat enregistré automatiquement</p>
      <button class="small-btn" id="btnDemarrerQcm"${state.qcmBank ? "" : " disabled"}>${state.qcmBank ? "Lancer une série" : "Chargement de la banque de questions…"}</button>
    </div>

    ${s && s.nb ? `
    <h2 class="section-title">Progression</h2>
    <div class="kpi-grid">
      <div class="kpi hero"><label>Moyenne</label><strong>${s.moyenne_pct}%</strong><span class="sub">${s.nb} série(s) enregistrée(s)</span></div>
      ${s.meilleur_score ? `<div class="kpi"><label>Meilleur score</label><strong>${s.meilleur_score.score}/${s.meilleur_score.total}</strong><span class="sub">${escapeHtml(s.meilleur_score.date)}</span></div>` : ""}
      ${s.tendance ? `<div class="kpi"><label>Tendance récente</label><strong style="font-size:15px">${escapeHtml(s.tendance)}</strong></div>` : ""}
    </div>
    <h2 class="section-title">Historique</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="num">Score</th><th class="num">%</th><th class="num">Durée</th></tr></thead>
      <tbody>${s.sessions.map(r => `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td class="num">${r.score}/${r.total}</td>
        <td class="num">${r.pourcentage}%</td>
        <td class="num">${r.duree ? r.duree + " min" : "—"}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`
    : (s ? empty("Aucune série enregistrée pour l'instant.") : "")}

    <details class="past-block" style="margin-top:16px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Enregistrer une série jouée ailleurs</span></span></summary>
      <div class="past-body">
        <form id="qcmForm" class="toolbar" style="grid-template-columns: 1fr 1fr 1fr auto; align-items:end; margin-top:10px">
          <div class="field"><label for="qcmScore">Score</label><input id="qcmScore" type="number" min="0" max="20" required /></div>
          <div class="field"><label for="qcmTotal">Sur</label><input id="qcmTotal" type="number" min="1" value="20" required /></div>
          <div class="field"><label for="qcmDuree">Temps (min)</label><input id="qcmDuree" type="number" min="0" max="10" step="0.5" value="10" /></div>
          <button class="small-btn secondary" type="submit">Enregistrer</button>
        </form>
      </div>
    </details>
  `;

  const btnStart = document.getElementById("btnDemarrerQcm");
  if (btnStart) btnStart.addEventListener("click", demarrerSerieQcm);

  const form = document.getElementById("qcmForm");
  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const score = document.getElementById("qcmScore").value;
      const total = document.getElementById("qcmTotal").value;
      const duree = document.getElementById("qcmDuree").value;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      setStatus("Enregistrement de la série…", "");
      try {
        const res = await jsonp("addQcmSession", { score, total, duree });
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Série enregistrée", "ok");
        state.qcmStats = null;
        loadQcmStats();
      } catch (err) {
        setStatus("Erreur QCM : " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }
}

const QCM_LETTRES = ["A", "B", "C", "D", "E", "F"];

/* Options rendues comme des cartes cliquables (pas des radios natifs nus) :
   pastille lettre + texte, état survolé/sélectionné géré en CSS via
   .is-selected (posée par JS au change, pas de dépendance à :has()). */
function renderQcmOptions_(q, reponsesChoisies) {
  return q.answers.map((a, idx) => {
    const checked = (reponsesChoisies || []).includes(idx);
    return `
      <label class="qcm-opt${checked ? " is-selected" : ""}" data-qid="${q.id}">
        <input type="${q.multiple ? "checkbox" : "radio"}" name="qcm-${q.id}" data-qid="${q.id}" data-idx="${idx}"${checked ? " checked" : ""} />
        <span class="qcm-opt-mark">${QCM_LETTRES[idx] || idx + 1}</span>
        <span class="qcm-opt-text">${escapeHtml(a)}</span>
      </label>`;
  }).join("");
}

function renderQcmSession_(root) {
  const s = state.qcmSession;

  if (s.resultat) {
    const r = s.resultat;
    const pct = Math.round((r.bonnes / r.total) * 100);
    root.innerHTML = `
      <h2 class="section-title">Résultat${r.auto ? " (temps écoulé)" : ""}</h2>
      <div class="kpi-grid">
        <div class="kpi hero"><label>Score</label><strong>${r.bonnes}/${r.total}</strong><span class="sub">${pct}% · ${r.duree} min</span></div>
      </div>
      <div class="actions" style="margin:14px 0"><button class="small-btn" id="btnRejouerQcm">Nouvelle série</button></div>
      <h2 class="section-title">Corrigé</h2>
      <div class="cards">${r.details.map((d, i) => `
        <article class="table-card qcm-card">
          <div class="qcm-card-pad">
            <p class="qcm-q-num">Question ${i + 1}<span class="qcm-result-tag ${d.ok ? "ok" : "ko"}">${d.ok ? "✓ Correct" : "✗ Faux"}</span></p>
            <p class="qcm-q-text">${escapeHtml(d.q.question)}</p>
            <div class="qcm-opts qcm-opts--result">
              ${d.q.answers.map((a, idx) => {
                const isCorrect = d.q.correct.includes(idx);
                const isChosen = d.choisi.includes(idx);
                let cls = "qcm-opt";
                if (isCorrect) cls += " qcm-opt--correct";
                else if (isChosen) cls += " qcm-opt--wrong";
                return `<div class="${cls}"><span class="qcm-opt-mark">${QCM_LETTRES[idx] || idx + 1}</span><span class="qcm-opt-text">${escapeHtml(a)}</span></div>`;
              }).join("")}
            </div>
            ${d.q.explanation ? `<p class="qcm-explanation">${escapeHtml(d.q.explanation)}</p>` : ""}
          </div>
        </article>`).join("")}</div>
    `;
    const btn = document.getElementById("btnRejouerQcm");
    if (btn) btn.addEventListener("click", quitterSerieQcm);
    return;
  }

  const repondues = Object.keys(s.reponses).length;
  root.innerHTML = `
    <div class="table-card qcm-topbar">
      <div class="qcm-topbar-row">
        <div><strong id="qcmChrono" class="qcm-chrono">${formatChronoQcm_(s.fin - Date.now())}</strong><span class="qcm-topbar-count" id="qcmCompteur">${repondues}/${s.questions.length} répondues</span></div>
        <button class="small-btn" id="btnValiderQcm">Valider la série</button>
      </div>
      <div class="qcm-progress"><div class="qcm-progress-bar" id="qcmProgressBar" style="width:${Math.round((repondues / s.questions.length) * 100)}%"></div></div>
    </div>
    <div class="cards" style="margin-top:14px">
      ${s.questions.map((q, i) => `
        <article class="table-card qcm-card">
          <div class="qcm-card-pad">
            <p class="qcm-q-num">Question ${i + 1}<span class="qcm-q-total">/${s.questions.length}</span></p>
            <p class="qcm-q-text">${escapeHtml(q.question)}</p>
            <div class="qcm-opts">${renderQcmOptions_(q, s.reponses[q.id])}</div>
          </div>
        </article>`).join("")}
    </div>
    <div class="actions" style="margin:16px 0"><button class="small-btn" id="btnValiderQcm2">Valider la série</button></div>
  `;

  root.querySelectorAll('input[data-qid]').forEach(input => {
    input.addEventListener("change", e => {
      const qid = Number(e.target.dataset.qid), idx = Number(e.target.dataset.idx);
      const q = s.questions.find(q => q.id === qid);
      if (!s.reponses[qid]) s.reponses[qid] = [];
      if (q.multiple) {
        const pos = s.reponses[qid].indexOf(idx);
        if (e.target.checked && pos === -1) s.reponses[qid].push(idx);
        if (!e.target.checked && pos !== -1) s.reponses[qid].splice(pos, 1);
      } else {
        s.reponses[qid] = [idx];
      }
      // Reflet visuel immédiat : la carte cochée passe en surbrillance,
      // et pour un choix unique les autres cartes du groupe se désélectionnent.
      root.querySelectorAll(`label.qcm-opt[data-qid="${qid}"]`).forEach(lbl => {
        const box = lbl.querySelector("input");
        lbl.classList.toggle("is-selected", box.checked);
      });
      const total = Object.keys(s.reponses).filter(k => s.reponses[k].length).length;
      const compteur = document.getElementById("qcmCompteur");
      if (compteur) compteur.textContent = total + "/" + s.questions.length + " répondues";
      const bar = document.getElementById("qcmProgressBar");
      if (bar) bar.style.width = Math.round((total / s.questions.length) * 100) + "%";
    });
  });

  ["btnValiderQcm", "btnValiderQcm2"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => soumettreSerieQcm(false));
  });
}

/* ---------------- Alertes ---------------- */

/* ---------------- Agenda (19/09/2026) ----------------
   Vue calendrier mensuelle des désignations (5×5 + 3×3), façon Google
   Agenda. Lecture seule : on visualise, on ne modifie rien depuis ici.
   Réutilise state.filteredRows (déjà filtré saison + recherche) et les
   mêmes conventions de date/niveau que les autres onglets. */

function renderAgenda() {
  const root = document.getElementById("agenda");
  if (!root) return;

  if (!state.agendaCursor) {
    const now = new Date();
    state.agendaCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const rows = state.filteredRows.filter(r => r._isActive && r._date);
  const cursor = state.agendaCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const parJour = {};
  rows.forEach(r => {
    const k = agendaDayKey_(r._date);
    (parJour[k] = parJour[k] || []).push(r);
  });

  const todayKey = agendaDayKey_(new Date());
  // Lundi = 0 … dimanche = 6, convention FR (Date.getDay() renvoie 0 pour dimanche).
  const decalage = (new Date(year, month, 1).getDay() + 6) % 7;
  const debutGrille = new Date(year, month, 1 - decalage);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(debutGrille.getFullYear(), debutGrille.getMonth(), debutGrille.getDate() + i);
    const k = agendaDayKey_(d);
    const matches = parJour[k] || [];
    const horsMois = d.getMonth() !== month;
    const estAuj = k === todayKey;
    const estSelect = state.agendaSelectedDate === k;
    const classes = ["agenda-day"];
    if (horsMois) classes.push("is-outside");
    if (estAuj) classes.push("is-today");
    if (estSelect) classes.push("is-selected");
    if (matches.length) classes.push("has-matches");
    cells.push(`
      <button type="button" class="${classes.join(" ")}" data-day="${k}"${matches.length ? "" : " disabled"}>
        <span class="agenda-day-num">${d.getDate()}</span>
        ${matches.length ? `<span class="agenda-day-dots">${matches.slice(0, 4).map(m => `<span class="agenda-dot ${niveauCarte(m).classe}"></span>`).join("")}${matches.length > 4 ? `<span class="agenda-dot-more">+${matches.length - 4}</span>` : ""}</span>` : ""}
      </button>`);
  }

  const moisLabel = capitalize_(cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  const jourAffiche = state.agendaSelectedDate && parJour[state.agendaSelectedDate] ? state.agendaSelectedDate : null;

  root.innerHTML = `
    <h2 class="section-title">Agenda</h2>
    <div class="agenda-toolbar">
      <div class="agenda-nav">
        <button type="button" class="small-btn secondary" id="agendaPrevBtn" aria-label="Mois précédent">‹</button>
        <strong class="agenda-month-label">${escapeHtml(moisLabel)}</strong>
        <button type="button" class="small-btn secondary" id="agendaNextBtn" aria-label="Mois suivant">›</button>
      </div>
      <button type="button" class="small-btn" id="agendaTodayBtn">Aujourd'hui</button>
    </div>
    <div class="agenda-grid">
      <div class="agenda-weekday">Lun</div><div class="agenda-weekday">Mar</div><div class="agenda-weekday">Mer</div>
      <div class="agenda-weekday">Jeu</div><div class="agenda-weekday">Ven</div><div class="agenda-weekday">Sam</div>
      <div class="agenda-weekday">Dim</div>
      ${cells.join("")}
    </div>
    <div id="agendaDayMatches">${jourAffiche ? renderAgendaDayList_(jourAffiche, parJour[jourAffiche]) : empty("Sélectionne un jour marqué d'un point pour voir les missions.")}</div>
  `;

  document.getElementById("agendaPrevBtn").addEventListener("click", () => {
    state.agendaCursor = new Date(year, month - 1, 1);
    renderAgenda();
  });
  document.getElementById("agendaNextBtn").addEventListener("click", () => {
    state.agendaCursor = new Date(year, month + 1, 1);
    renderAgenda();
  });
  document.getElementById("agendaTodayBtn").addEventListener("click", () => {
    const now = new Date();
    state.agendaCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    state.agendaSelectedDate = agendaDayKey_(now);
    renderAgenda();
  });
  root.querySelectorAll(".agenda-day.has-matches").forEach(btn => {
    btn.addEventListener("click", () => {
      state.agendaSelectedDate = btn.dataset.day;
      renderAgenda();
    });
  });
}

function agendaDayKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function capitalize_(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function renderAgendaDayList_(dayKey, matches) {
  const sorted = matches.slice().sort(sortByDateAsc);
  const dateLabel = sorted[0] && sorted[0]._date ? formatDateLongue(sorted[0]._date) : dayKey;
  return `
    <h3 class="agenda-day-title">${escapeHtml(dateLabel)} <span class="count">${sorted.length}</span></h3>
    <div class="agenda-day-cards">
      ${sorted.map(renderAgendaMatchMini_).join("")}
    </div>`;
}

function renderAgendaMatchMini_(row) {
  const format = get(row, "Format");
  const title = format === "3x3"
    ? firstValue(row, ["Visiteur / événement", "Recevant", "Libellé compétition"])
    : firstValue(row, ["Recevant", "Visiteur / événement", "Libellé compétition"]);
  const time = get(row, "Heure/RDV");
  const niv = niveauCarte(row);
  const lieu = firstValue(row, ["Salle", "Ville"]);
  const paiement = get(row, "Statut paiement") || "À recevoir";
  const isPaid = paiement === "Reçu";
  const isBenevole = paiement === BENEVOLE;
  return `
    <div class="agenda-match-card ${niv.classe}">
      <div class="badges">
        <span class="badge-niveau">${escapeHtml(niv.badge)}</span>
        ${format && format !== "3x3" ? badge(format, "gray") : ""}
        ${isBenevole ? badge("Bénévole", "gray") : isPaid ? badge("Payé", "green") : badge(paiement, paiement === "À recevoir" ? "gold" : "orange")}
      </div>
      <div class="agenda-match-title">${escapeHtml(title || "Mission")}</div>
      <div class="agenda-match-meta">${time ? escapeHtml(time) + " · " : ""}${escapeHtml(lieu || "")}</div>
    </div>`;
}

function renderAlertes() {
  const root = document.getElementById("alertes");
  /* Une alerte doit être actionnable : import raté / warning, statut à
     trancher, ou paiement en retard. Refonte 25/09/2026 — regroupées par
     type d'action (priorité : corriger > trancher > relancer), chaque
     mission n'apparaissant qu'une seule fois. */
  const base = state.filteredRows.filter(r =>
    r._format === "Alerte" ||
    hasWarningReel(r) ||
    cleanText(get(r, "Statut paiement")) === "À vérifier" ||
    paiementEnRetard(r)
  );
  if (!base.length) { root.innerHTML = empty("Aucune alerte pour cette saison. Rien à corriger, rien à relancer."); return; }

  const aCorriger = [], aTrancher = [], enRetard = [];
  base.forEach(r => {
    if (r._format === "Alerte" || hasWarningReel(r)) aCorriger.push(r);
    else if (cleanText(get(r, "Statut paiement")) === "À vérifier") aTrancher.push(r);
    else if (paiementEnRetard(r)) enRetard.push(r);
  });
  const groupes = [
    ["À corriger", "Imports ratés ou warnings de traitement à lever.", aCorriger],
    ["Statut à trancher", "Missions dont le paiement reste à qualifier.", aTrancher],
    ["Retard de paiement", "Échéance prévue dépassée, sans réception enregistrée.", enRetard]
  ];

  root.innerHTML = `
    <h2 class="section-title">Alertes <span class="count">${base.length}</span></h2>
    ${groupes.filter(g => g[2].length).map(g => `
      <h2 class="section-title alerte-groupe">${escapeHtml(g[0])} <span class="count">${g[2].length}</span></h2>
      <div class="alerte-groupe-sub">${escapeHtml(g[1])}</div>
      <div class="cards">${g[2].slice().sort(sortByDateAsc).map(renderMatchCard).join("")}</div>
    `).join("")}`;
  attachCardListeners(root);
  attachPaymentListeners(root);
  attachContactListeners(root);
}

/* ---------------- Export ----------------
   Filtres propres à l'onglet (saison + mois), indépendants de la barre
   de recherche du haut : un export doit être reproductible à l'identique.
   Mois vide = toute la saison.
------------------------------------------- */

function monthKeyOf(date) {
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function monthLabelOf(key) {
  const [y, m] = String(key).split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* Les 12 mois d'une saison (août → juillet), plus tout mois réellement
   présent dans les données qui sortirait de cette fenêtre. */
function monthsOfSeason(season) {
  const start = Number(String(season).split("/")[0]);
  const keys = [];
  for (let i = 0; i < 12; i++) keys.push(monthKeyOf(new Date(start, 7 + i, 1)));
  state.allRows
    .filter(r => r._season === season && r._date)
    .forEach(r => { const k = monthKeyOf(r._date); if (keys.indexOf(k) === -1) keys.push(k); });
  return keys.sort().map(k => ({ value: k, label: monthLabelOf(k) }));
}

/* Refonte export (19/09/2026) : deux modes, saison/mois (existant) ou
   plage de dates libre — pratique pour un export "sur les 3 derniers
   mois" ou à cheval sur deux saisons, ce que le mode saison ne permet pas. */
function exportRows() {
  if (state.exportMode === "range") {
    const from = state.exportFrom ? new Date(state.exportFrom + "T00:00:00") : null;
    const to = state.exportTo ? new Date(state.exportTo + "T23:59:59") : null;
    return state.allRows
      .filter(r => r._isActive && r._format !== "Alerte" && r._date)
      .filter(r => (!from || r._date >= from) && (!to || r._date <= to))
      .slice()
      .sort(sortByDateAsc);
  }
  return state.allRows
    .filter(r => r._isActive && r._format !== "Alerte")
    .filter(r => r._season === state.exportSeason)
    .filter(r => !state.exportMonth || monthKeyOf(r._date) === state.exportMonth)
    .slice()
    .sort(sortByDateAsc);
}

function exportTotals(rows) {
  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._km, r._date), 0);
  return {
    gross, cost, net: gross - cost,
    km: rows.reduce((t, r) => t + r._km, 0),
    five: rows.filter(r => r._format === "5x5").length,
    three: rows.filter(r => r._format === "3x3").length
  };
}

/* Sur un document exporté, on veut la rencontre complète, pas seulement
   le club recevant. Les 3×3 sont des événements : séparateur neutre. */
function rencontreLabel(row) {
  const recevant = get(row, "Recevant");
  const adverse = get(row, "Visiteur / événement");
  if (!recevant) return adverse;
  if (!adverse) return recevant;
  return `${recevant} ${row._format === "3x3" ? "—" : "vs"} ${adverse}`;
}

function exportPeriodLabel() {
  if (state.exportMode === "range") {
    if (state.exportFrom && state.exportTo) return `Du ${escapeHtml(state.exportFrom)} au ${escapeHtml(state.exportTo)}`;
    if (state.exportFrom) return `Depuis le ${escapeHtml(state.exportFrom)}`;
    if (state.exportTo) return `Jusqu'au ${escapeHtml(state.exportTo)}`;
    return "Toutes dates";
  }
  return state.exportMonth ? monthLabelOf(state.exportMonth) : `Saison complète ${state.exportSeason}`;
}

function renderExport() {
  const root = document.getElementById("export");

  // Valeurs par défaut : la saison courante, tous les mois, mode saison.
  const seasons = getSeasonsFrom2022ToCurrent();
  if (!state.exportSeason || seasons.indexOf(state.exportSeason) === -1) {
    state.exportSeason = seasons.indexOf(state.selectedSeason) !== -1 ? state.selectedSeason : getCurrentSeason();
  }
  const months = monthsOfSeason(state.exportSeason);
  if (state.exportMonth && !months.some(m => m.value === state.exportMonth)) state.exportMonth = "";
  if (!state.exportMode) state.exportMode = "season";

  const rows = exportRows();
  const t = exportTotals(rows);

  root.innerHTML = `
    <h2 class="section-title">Export</h2>

    <div class="tabs-mini">
      <button type="button" class="tabs-mini-btn${state.exportMode === "season" ? " active" : ""}" id="exportModeSeasonBtn">Saison / mois</button>
      <button type="button" class="tabs-mini-btn${state.exportMode === "range" ? " active" : ""}" id="exportModeRangeBtn">Plage de dates</button>
    </div>

    ${state.exportMode === "range" ? `
    <section class="toolbar" style="grid-template-columns: 1fr 1fr;">
      <div class="field"><label for="exportFromInput">Du</label><input type="date" id="exportFromInput" value="${state.exportFrom || ""}" /></div>
      <div class="field"><label for="exportToInput">Au</label><input type="date" id="exportToInput" value="${state.exportTo || ""}" /></div>
    </section>` : `
    <section class="toolbar" style="grid-template-columns: 1fr 1fr;">
      <div class="field">
        <label for="exportSeasonSelect">Saison</label>
        <select id="exportSeasonSelect">
          ${seasons.map(s => `<option value="${s}"${s === state.exportSeason ? " selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="exportMonthSelect">Mois</label>
        <select id="exportMonthSelect">
          <option value="">Toute la saison</option>
          ${months.map(m => `<option value="${m.value}"${m.value === state.exportMonth ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
        </select>
      </div>
    </section>`}

    <div class="kpi-grid" style="margin-top:14px">
      <div class="kpi hero">
        <label>Revenu net réel</label>
        <strong>${formatMoney(t.net)}</strong>
        <span class="sub">${escapeHtml(exportPeriodLabel())}</span>
      </div>
      <div class="kpi"><label>Indemnités brutes</label><strong>${formatMoney(t.gross)}</strong></div>
      <div class="kpi"><label>Coût carburant</label><strong>${formatMoney(t.cost)}</strong></div>
      <div class="kpi"><label>Missions</label><strong>${rows.length}</strong><span class="sub">${t.five} en 5×5 · ${t.three} en 3×3</span></div>
      <div class="kpi"><label>Kilomètres A/R</label><strong>${formatNumber(t.km, " km")}</strong></div>
    </div>

    <div class="actions" style="margin-top:14px">
      <button class="small-btn" type="button" id="genPdfBtn"${rows.length ? "" : " disabled"}>Générer le PDF</button>
      <button class="small-btn secondary" type="button" id="exportCsvBtn"${rows.length ? "" : " disabled"}>Exporter en CSV</button>
      <button class="small-btn secondary" type="button" id="copyExportBtn"${rows.length ? "" : " disabled"}>Copier en texte</button>
    </div>

    <div class="table-card" style="padding:14px; margin-top:14px">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap">
        <strong>Carte des salles — nombre de fois arbitré</strong>
        <button class="small-btn secondary" type="button" id="exportMapBtn"${rows.length ? "" : " disabled"}>Afficher la carte</button>
      </div>
      <p class="card-sub" style="margin:6px 0 0">Géocodage un peu lent (respect du quota de l'API OSM gratuite, ~1 salle/seconde) — normal.</p>
      <div id="exportMap" style="height:320px; border-radius:12px; margin-top:10px; display:none"></div>
    </div>

    ${rows.length ? `
    <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Format</th><th>Niveau</th><th>Rencontre</th><th>Lieu</th>
                <th class="num">Km</th><th class="num">Brut</th><th class="num">Carburant</th><th class="num">Net</th><th>Paiement</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const c = realFuelCostClient(r._km, r._date);
              return `<tr>
                <td>${escapeHtml(get(r, "Date match"))}</td>
                <td>${escapeHtml(r._format)}</td>
                <td>${escapeHtml(get(r, "Niveau administratif"))}</td>
                <td>${escapeHtml(rencontreLabel(r))}</td>
                <td>${escapeHtml(get(r, "Ville") || get(r, "Salle"))}</td>
                <td class="num">${formatNumber(r._km, "")}</td>
                <td class="num">${formatMoney(r._amount)}</td>
                <td class="num">${formatMoney(c)}</td>
                <td class="num pos">${formatMoney(r._amount - c)}</td>
                <td>${escapeHtml(get(r, "Statut paiement"))}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>` : empty("Aucune mission pour cette période.")}
  `;

  document.getElementById("exportModeSeasonBtn").addEventListener("click", () => { state.exportMode = "season"; renderExport(); });
  document.getElementById("exportModeRangeBtn").addEventListener("click", () => { state.exportMode = "range"; renderExport(); });

  if (state.exportMode === "range") {
    document.getElementById("exportFromInput").addEventListener("change", e => { state.exportFrom = e.target.value; renderExport(); });
    document.getElementById("exportToInput").addEventListener("change", e => { state.exportTo = e.target.value; renderExport(); });
  } else {
    document.getElementById("exportSeasonSelect").addEventListener("change", e => {
      state.exportSeason = e.target.value;
      state.exportMonth = ""; // les mois changent avec la saison
      renderExport();
    });
    document.getElementById("exportMonthSelect").addEventListener("change", e => {
      state.exportMonth = e.target.value;
      renderExport();
    });
  }

  const pdfBtn = document.getElementById("genPdfBtn");
  if (pdfBtn) pdfBtn.addEventListener("click", generateExportPdf);

  const csvBtn = document.getElementById("exportCsvBtn");
  if (csvBtn) csvBtn.addEventListener("click", downloadExportCsv);

  const copyBtn = document.getElementById("copyExportBtn");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(buildExportText()); setStatus("Export copié", "ok"); }
    catch { setStatus("Copie impossible — utilise le PDF", "error"); }
  });

  const mapBtn = document.getElementById("exportMapBtn");
  if (mapBtn) mapBtn.addEventListener("click", () => genererCarteSalles_(rows));
}

/* MODIFICATION 20/09/2026 — carte de France des salles arbitrées, avec un
   marqueur par salle dont la taille reflète le nombre de fois où tu y as
   arbitré sur la période sélectionnée. Réutilise geocode() (déjà présent
   pour les mini-cartes par match) et le cache pour ne jamais re-géocoder
   deux fois la même adresse — Nominatim limite à ~1 requête/seconde.
   Volontairement déclenché par bouton (pas au chargement de l'onglet) :
   géocoder 30-40 salles à chaque ouverture serait lent et inutile tant
   que tu ne veux pas cette carte précise. */
if (!state.geocodeCache) state.geocodeCache = {};

async function geocodeAvecCache_(adresse) {
  if (!adresse) return null;
  if (state.geocodeCache[adresse]) return state.geocodeCache[adresse];
  const res = await geocode(adresse);
  if (res) state.geocodeCache[adresse] = res;
  return res;
}

async function genererCarteSalles_(rows) {
  const conteneur = document.getElementById("exportMap");
  const bouton = document.getElementById("exportMapBtn");
  if (!conteneur || typeof L === "undefined") return;

  // Regroupement par salle (adresse si connue, sinon ville+nom de salle).
  const parSalle = {};
  rows.forEach(r => {
    const salle = cleanText(get(r, "Salle")) || cleanText(get(r, "Ville"));
    if (!salle) return;
    const adresse = cleanText(get(r, "Adresse")) || salle;
    const cle = adresse;
    if (!parSalle[cle]) parSalle[cle] = { salle, adresse, count: 0 };
    parSalle[cle].count++;
  });
  const entrees = Object.values(parSalle);
  if (!entrees.length) { setStatus("Aucune salle à placer sur cette période", "error"); return; }

  bouton.disabled = true;
  bouton.textContent = "Géocodage en cours…";
  conteneur.style.display = "";

  if (state.exportMapInstance) { state.exportMapInstance.remove(); state.exportMapInstance = null; }
  const carte = L.map(conteneur, { scrollWheelZoom: false }).setView([HOME.lat, HOME.lon], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap"
  }).addTo(carte);
  L.marker([HOME.lat, HOME.lon]).addTo(carte).bindPopup("Domicile");
  state.exportMapInstance = carte;

  const points = [[HOME.lat, HOME.lon]];
  const maxCount = Math.max(...entrees.map(e => e.count));

  for (const e of entrees) {
    const dejaEnCache = !!state.geocodeCache[e.adresse];
    const dest = await geocodeAvecCache_(e.adresse);
    if (dest) {
      const rayon = 8 + (e.count / maxCount) * 18; // 8 à 26 px selon la fréquence
      L.circleMarker([dest.lat, dest.lon], {
        radius: rayon, color: "#E4002B", weight: 2, fillColor: "#E4002B", fillOpacity: 0.35
      }).addTo(carte).bindPopup(`<b>${escapeHtml(e.salle)}</b><br>${e.count} fois arbitré`);
      points.push([dest.lat, dest.lon]);
    }
    // Respecte le quota Nominatim (max 1 requête/seconde) — seulement quand
    // l'appel vient réellement d'interroger le réseau (pas un hit de cache).
    if (!dejaEnCache) await new Promise(res => setTimeout(res, 1100));
  }

  if (points.length > 1) carte.fitBounds(points, { padding: [24, 24] });
  setTimeout(() => carte.invalidateSize(), 80);

  bouton.disabled = false;
  bouton.textContent = "Actualiser la carte";
}

/* Export CSV — un fichier tiers (Excel, Sheets, compta) préfère des
   colonnes brutes à un texte ou un PDF. Séparateur ; pour Excel FR,
   virgule décimale évitée (nombres en point, Excel FR sait le lire). */
function downloadExportCsv() {
  const rows = exportRows();
  if (!rows.length) { setStatus("Aucune mission à exporter pour cette période", "error"); return; }
  const header = ["Date", "Format", "Niveau", "Rencontre", "Lieu", "Km", "Brut (€)", "Carburant (€)", "Net (€)", "Paiement"];
  const csvEscape = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [header.map(csvEscape).join(";")];
  rows.forEach(r => {
    const c = realFuelCostClient(r._km, r._date);
    lines.push([
      get(r, "Date match"), r._format, get(r, "Niveau administratif"), rencontreLabel(r), get(r, "Ville") || get(r, "Salle"),
      r._km, r._amount.toFixed(2), c.toFixed(2), (r._amount - c).toFixed(2), get(r, "Statut paiement")
    ].map(csvEscape).join(";"));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `referee-tracker-export-${state.exportMode === "range" ? (state.exportFrom || "debut") + "_" + (state.exportTo || "fin") : state.exportSeason}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("CSV téléchargé", "ok");
}

function buildExportText() {
  const rows = exportRows();
  const t = exportTotals(rows);
  return [
    `REFEREE TRACKER — EXPORT`,
    `Saison : ${state.exportSeason}`,
    `Période : ${exportPeriodLabel()}`,
    ``,
    `Indemnités brutes : ${formatMoney(t.gross)}`,
    `Coût carburant réel : ${formatMoney(t.cost)}`,
    `REVENU NET RÉEL : ${formatMoney(t.net)}`,
    `KM total A/R : ${formatNumber(t.km, " km")}`,
    `Matchs 5×5 : ${t.five} · Tournois 3×3 : ${t.three}`,
    ``,
    `Détail :`,
    ...rows.map(r => {
      const c = realFuelCostClient(r._km, r._date);
      return `- ${get(r, "Date match")} ${get(r, "Heure/RDV")} | ${r._format} | ${get(r, "Niveau administratif")} | ${rencontreLabel(r)} | ind ${formatMoney(r._amount)} | carb ${formatMoney(c)} | net ${formatMoney(r._amount - c)} | ${formatNumber(r._km, " km")}`;
    })
  ].join("\n");
}

/* ---------------- Génération du PDF ----------------
   jsPDF + autoTable, chargés depuis le CDN dans index.html.
   Les polices PDF standard n'acceptent pas les espaces fines
   insécables produites par toLocaleString : on les normalise.
------------------------------------------------------ */

function pdfSafe(value) {
  return String(value == null ? "" : value).replace(/[   ]/g, " ");
}

function generateExportPdf() {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) {
    setStatus("Bibliothèque PDF non chargée — recharge la page (Cmd+Maj+R)", "error");
    return;
  }

  const rows = exportRows();
  if (!rows.length) { setStatus("Aucune mission à exporter pour cette période", "error"); return; }

  const t = exportTotals(rows);
  const doc = new jsPDFCtor({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const navy = [10, 31, 68], gold = [245, 180, 0], grey = [91, 104, 132], green = [14, 123, 71];

  // Bandeau de titre
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(0, 0, pageW, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("REFEREE TRACKER", 12, 12);
  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.setFontSize(10);
  doc.text(pdfSafe(`Arbitrage FFBB — ${exportPeriodLabel()}`), 12, 19);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(pdfSafe(`Édité le ${new Date().toLocaleDateString("fr-FR")}`), pageW - 12, 19, { align: "right" });

  // Bandeau de synthèse
  const summary = [
    ["Revenu net réel", formatMoney(t.net), green],
    ["Indemnités brutes", formatMoney(t.gross), navy],
    ["Coût carburant", formatMoney(t.cost), [181, 89, 10]],
    ["Missions", `${rows.length}  (${t.five} en 5x5 · ${t.three} en 3x3)`, navy],
    ["Kilomètres A/R", formatNumber(t.km, " km"), navy]
  ];
  let x = 12;
  const cellW = (pageW - 24) / summary.length;
  summary.forEach(([label, value, color]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text(pdfSafe(label.toUpperCase()), x, 35);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(pdfSafe(value), x, 42);
    x += cellW;
  });
  doc.setDrawColor(220, 227, 239);
  doc.line(12, 46, pageW - 12, 46);

  // Tableau détaillé
  const body = rows.map(r => {
    const c = realFuelCostClient(r._km, r._date);
    return [
      pdfSafe(get(r, "Date match")),
      pdfSafe(get(r, "Heure/RDV")),
      pdfSafe(r._format),
      pdfSafe(get(r, "Niveau administratif")),
      pdfSafe(rencontreLabel(r)),
      pdfSafe(get(r, "Ville") || get(r, "Salle")),
      pdfSafe(formatNumber(r._km, "")),
      pdfSafe(formatMoney(r._amount)),
      pdfSafe(formatMoney(c)),
      pdfSafe(formatMoney(r._amount - c)),
      pdfSafe(get(r, "Statut paiement"))
    ];
  });

  doc.autoTable({
    startY: 52,
    head: [["Date", "Heure", "Format", "Niveau", "Rencontre", "Lieu", "Km", "Brut", "Carburant", "Net", "Paiement"]],
    body: body,
    foot: [["", "", "", "", "TOTAL", "", pdfSafe(formatNumber(t.km, "")), pdfSafe(formatMoney(t.gross)),
            pdfSafe(formatMoney(t.cost)), pdfSafe(formatMoney(t.net)), ""]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, textColor: [12, 23, 48], lineColor: [220, 227, 239] },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [242, 245, 251], textColor: navy, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 248, 252] },
    columnStyles: {
      0: { cellWidth: 18 }, 1: { cellWidth: 13 }, 2: { cellWidth: 14 }, 3: { cellWidth: 14 },
      6: { halign: "right", cellWidth: 14 }, 7: { halign: "right", cellWidth: 20 },
      8: { halign: "right", cellWidth: 20 }, 9: { halign: "right", cellWidth: 20, textColor: green },
      10: { cellWidth: 22 }
    },
    margin: { left: 12, right: 12 },
    didDrawPage: data => {
      const page = doc.internal.getNumberOfPages();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(grey[0], grey[1], grey[2]);
      doc.text("Referee Tracker — net réel = indemnité versée moins coût carburant réel",
        data.settings.margin.left, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Page ${page}`, pageW - 12, doc.internal.pageSize.getHeight() - 8, { align: "right" });
    }
  });

  const suffix = state.exportMonth || state.exportSeason.replace("/", "-");
  doc.save(`referee-tracker-${suffix}.pdf`);
  setStatus(`PDF généré — ${rows.length} mission(s)`, "ok");
}

/* ---------------- Coût carburant client ----------------
   Doit rester cohérent avec le serveur (Code.gs) :
   Peugeot 108 → 6,58 L/100 avant le 01/08/2026
   Audi A3     → 6,00 L/100 à partir du 01/08/2026
   Prix carburant : modifier FUEL ci-dessous ET dans Code.gs.
------------------------------------------------------- */
/* Historique du prix E10 (€/L, par mois) — doit rester identique à Code.gs.
   Sources : archives officielles data.gouv.fr (stations à moins de 15 km du
   domicile) ajustées de -0,058 €/L pour refléter les stations fréquentées,
   et relevés réels des pleins d'août 2025 à juin 2026. */
const PRIX_E10 = {
    // 2022
    "2022-01": 1.6281,
    "2022-02": 1.6986,
    "2022-03": 1.8901,
    "2022-04": 1.6916,
    "2022-05": 1.8012,
    "2022-06": 1.9578,
    "2022-07": 1.8312,
    "2022-08": 1.7041,
    "2022-09": 1.4477,
    "2022-10": 1.5527,
    "2022-11": 1.6151,
    "2022-12": 1.5643,

    // 2023
    "2023-01": 1.8238,
    "2023-02": 1.8337,
    "2023-03": 1.8228,
    "2023-04": 1.8327,
    "2023-05": 1.7755,
    "2023-06": 1.7663,
    "2023-07": 1.7662,
    "2023-08": 1.8645,
    "2023-09": 1.8884,
    "2023-10": 1.7981,
    "2023-11": 1.7703,
    "2023-12": 1.7326,

    // 2024
    "2024-01": 1.7498,
    "2024-02": 1.785,
    "2024-03": 1.7969,
    "2024-04": 1.8478,
    "2024-05": 1.8096,
    "2024-06": 1.7544,
    "2024-07": 1.7362,
    "2024-08": 1.6897,
    "2024-09": 1.6424,
    "2024-10": 1.6664,
    "2024-11": 1.6683,
    "2024-12": 1.6953,

    // 2025
    "2025-01": 1.7057,
    "2025-02": 1.6905,
    "2025-03": 1.6367,
    "2025-04": 1.6421,
    "2025-05": 1.6254,
    "2025-06": 1.627,
    "2025-07": 1.6125,
    "2025-08": 1.6153,
    "2025-09": 1.6403,
    "2025-10": 1.6297,
    "2025-11": 1.6647,
    "2025-12": 1.5956,

    // 2026
    "2026-01": 1.6596,
    "2026-02": 1.6883,
    "2026-03": 1.861,
    "2026-04": 1.995,
    "2026-05": 2.0273,
    "2026-06": 1.868
};

const PRIX_DEFAUT = 1.95;

const numMois_ = c => { const p = String(c).split("-"); return Number(p[0]) * 12 + Number(p[1]); };

function prixCarburantPour(date) {
  if (!date) return PRIX_DEFAUT;
  const cle = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  if (PRIX_E10[cle]) return PRIX_E10[cle];

  const mois = Object.keys(PRIX_E10);
  if (!mois.length) return state.prixActuel || PRIX_DEFAUT;

  const cible = numMois_(cle);
  const dernierConnu = mois.reduce((max, m) => Math.max(max, numMois_(m)), 0);

  /* Mois postérieur à la table des relevés : c'est un match à venir. Le serveur
     le valorise au prix E10 relevé aujourd'hui autour du domicile — on fait
     exactement pareil, sinon Stats et Analyse annoncent deux coûts différents
     pour les mêmes trajets. */
  if (cible > dernierConnu && state.prixActuel) return state.prixActuel;

  // Sinon : le mois connu le plus proche.
  let proche = mois[0], ecartMin = Infinity;
  mois.forEach(m => {
    const e = Math.abs(numMois_(m) - cible);
    if (e < ecartMin) { ecartMin = e; proche = m; }
  });
  return PRIX_E10[proche];
}

function realFuelCostClient(km, date) {
  const k = Number(km) || 0;
  if (!k) return 0;
  const cutover = new Date(2026, 7, 1);
  const conso = (date && date >= cutover) ? 6.0 : 6.58;
  return round2((k * conso / 100) * prixCarburantPour(date));
}

/* ---------------- Utils ---------------- */

function get(row, key) { return row && row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : ""; }
function firstValue(row, keys) { for (const k of keys) { const v = get(row, k); if (v) return v; } return ""; }
function hasWarning(row) { return Boolean(get(row, "Warning général") || get(row, "Warning finance") || get(row, "Warning FBI")); }

/* « Paiement club à vérifier » n'est pas une anomalie : c'est un mode de
   règlement, vrai dès l'import et pour toujours. Posé en warning, il
   remplissait l'onglet Alertes en permanence. Il est signalé sur la carte
   (voir reglementSpecial) et retiré d'ici. */
const WARNINGS_IGNORES = ["Paiement club à vérifier"];

function warningsReels(row) {
  return ["Warning général", "Warning finance", "Warning FBI"]
    .map(k => get(row, k))
    .filter(Boolean)
    .join(" | ")
    .split("|")
    .map(w => w.trim())
    .filter(w => w && WARNINGS_IGNORES.indexOf(w) === -1);
}

function hasWarningReel(row) { return warningsReels(row).length > 0; }

/* Un paiement est en retard passé 30 jours après la date prévue : en deçà,
   les virements de comité et de ligue arrivent régulièrement en décalé. */
const RETARD_JOURS = 30;

function paiementEnRetard(row) {
  const statut = cleanText(get(row, "Statut paiement"));
  if (statut === "Reçu" || statut === BENEVOLE) return false;

  const prevu = parseFrDate(get(row, "Date paiement"));
  if (!prevu) return false;

  return (Date.now() - prevu.getTime()) / 86400000 > RETARD_JOURS;
}

/* Bloc 3 (25/09/2026) — Relance active : au-delà de 45 j après l'échéance
   prévue, une créance doit être relancée (le retard "normal" est déjà
   signalé dès 30 j via paiementEnRetard / Alertes). */
const RELANCE_JOURS = 45;
function paiementARelancer(row) {
  const statut = cleanText(get(row, "Statut paiement"));
  if (statut === "Reçu" || statut === BENEVOLE) return false;
  const prevu = parseFrDate(get(row, "Date paiement"));
  if (!prevu) return false;
  return (Date.now() - prevu.getTime()) / 86400000 > RELANCE_JOURS;
}
function normalizePhoneFr(v) {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  else if (d.startsWith("0033")) d = "0" + d.slice(4);
  else if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2);
  d = d.replace(/\D/g, "");
  if (d.length === 9 && d[0] !== "0") d = "0" + d;
  return d;
}
function formatPhoneFr(v) {
  const d = normalizePhoneFr(v);
  if (d.length !== 10) return d;
  return d.match(/.{2}/g).join(".");
}
function badge(text, cls = "") { return text ? `<span class="badge ${cls}">${escapeHtml(text)}</span>` : ""; }
function empty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }

function setStatus(message, type) {
  const bar = document.getElementById("statusBar");
  bar.textContent = message;
  bar.className = "status-bar show" + (type ? " " + type : "");
  if (type === "ok") setTimeout(() => bar.classList.remove("show"), 2600);
}

function parseFrDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
}

function formatDateShort(date) { return date ? date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; }
function formatMoney(v) { return (Number(v) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
function money(v) { return (Number(v) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function formatNumber(v, suffix = "") { return (Number(v) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + suffix; }
function toNumber(v) { if (v === null || v === undefined || v === "") return 0; const n = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; }
function round2(n) { return Number((Number(n) || 0).toFixed(2)); }
function cleanText(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function escapeHtml(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function sortByDateAsc(a, b) { return (a._date ? a._date.getTime() : 0) - (b._date ? b._date.getTime() : 0); }
function sortByDateDesc(a, b) { return sortByDateAsc(b, a); }
function sortByPaymentThenDate(a, b) {
  const pa = PAYMENT_STATUSES.indexOf(get(a, "Statut paiement")), pb = PAYMENT_STATUSES.indexOf(get(b, "Statut paiement"));
  return pa !== pb ? pa - pb : sortByDateAsc(a, b);
}
function groupBy(rows, fn) { return rows.reduce((acc, r) => { const k = fn(r) || "Autre"; (acc[k] = acc[k] || []).push(r); return acc; }, {}); }

/* =====================================================
   ONGLET ANALYSE — graphiques, diagrammes, KPI avancés
   Ne touche pas à l'onglet Stats existant.
   Utilise Chart.js (CDN) + les données déjà chargées.
   ===================================================== */

const AN = {
  charts: {},              // instances Chart.js, détruites avant re-render
  VITESSE_MOY_KMH: 70,     // pour estimer le temps de route
  DUREE_5X5_H: 1.5,        // temps sur place, match 5x5
  DUREE_3X3_H: 6,          // temps sur place, tournoi 3x3
  saison: "",              // saison choisie dans l'onglet Analyse ("" = auto)
  statsCache: {},          // cache des stats serveur par saison (délais, régularité, etc.)
  COLORS: {
    navy: "#0A1F44", navyMid: "#1E4E9C", navyLight: "#6C93D6",
    red: "#E4002B", gold: "#F5B400", green: "#0E7B47", orange: "#B5590A",
    grid: "#E3EAF4", muted: "#5B6884"
  }
};


function renderAnalyse() {
  const root = document.getElementById("statsAnalyse");
  if (!root) return;

  destroyCharts();

  // Toutes les lignes actives, sans filtre de saison : le filtrage se fait
  // ensuite via le sélecteur propre à cet onglet.
  const toutes = analyseRowsToutesSaisons();

  if (!toutes.length) {
    root.innerHTML = empty("Aucune mission à analyser. Vide la recherche ou vérifie le chargement des données.");
    return;
  }

  // Saison retenue pour l'ensemble de l'onglet Analyse
  AN.saison = resoudreSaison_(AN.saison, toutes);
  const rows = filtrerParSaison_(toutes, AN.saison);

  if (!rows.length) {
    root.innerHTML = `
      <div class="analysis-toolbar">
        <div class="chart-filter">
          <label for="saisonAnalyse">Saison analysée</label>
          <select id="saisonAnalyse">${optionsSaison_(toutes, AN.saison)}</select>
        </div>
      </div>
      ${empty("Aucune mission pour cette saison.")}
    `;
    brancherSelecteurAnalyse_();
    return;
  }

  const sum = (k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

  const brut = sum("_brut");
  const carburant = sum("_carburant");
  const net = round2(brut - carburant);
  const kmTotal = sum("_km");
  const heuresRoute = sum("_heuresRoute");
  const heuresTotal = sum("_heuresTotal");
  const partGardee = brut > 0 ? (net / brut) * 100 : 0;

  const five = rows.filter(r => r._format === "5x5");
  const three = rows.filter(r => r._format === "3x3");

  const eurHeureGlobal = heuresTotal > 0 ? net / heuresTotal : 0;
  const eurKmGlobal = kmTotal > 0 ? brut / kmTotal : 0;
  const nonPayes = rows.filter(r => !r._paye);
  const montantDu = nonPayes.reduce((t, r) => t + r._brut, 0);

  root.innerHTML = `
    <div class="analysis-toolbar">
      <div class="chart-filter">
        <label for="saisonAnalyse">Saison analysée</label>
        <select id="saisonAnalyse">${optionsSaison_(toutes, AN.saison)}</select>
      </div>
      <div class="toolbar-summary">${rows.length} mission(s) · ${formatNumber(kmTotal, " km")} · ${formatHeures(heuresTotal)}</div>
    </div>

    ${renderAnalyseHero(brut, carburant, net, partGardee, rows.length, kmTotal, heuresTotal)}

    <div id="analyseAvancee">${empty("Chargement des analyses avancées…")}</div>

    <h2 class="section-title">Indicateurs clés</h2>
    <div class="kpi-grid">
      ${kpi("Net par mission", money(net / rows.length))}
      ${kpi("Net par heure", money(eurHeureGlobal), "trajet + temps sur place")}
      ${kpi("Indemnité par km", money(eurKmGlobal))}
      ${kpi("Temps sur la route", formatHeures(heuresRoute), `sur ${formatHeures(heuresTotal)} au total`)}
      ${kpi("Distance parcourue", formatNumber(kmTotal, " km"), `${formatNumber(kmTotal / rows.length, " km")} par mission`)}
      ${kpi("Part absorbée par le carburant", (100 - partGardee).toFixed(1) + " %")}
      ${kpi("Reste à percevoir", formatMoney(montantDu), `${nonPayes.length} mission(s)`)}
      ${kpi("Litres consommés", formatNumber(litresTotal(rows), " L"))}
    </div>

    <h2 class="section-title">Évolution mensuelle</h2>
    <div class="chart-card">
      <h3>Ce que rapporte chaque mois</h3>
      <p class="hint">Mois classés dans l'ordre de la saison sportive, de septembre à juillet. Barres empilées : la part nette conservée et la part partie en carburant. La ligne montre le nombre de missions.</p>
      <div class="chart-box tall"><canvas id="chartMois"></canvas></div>
      ${insightMois(rows)}
    </div>

    <div class="chart-grid two">
      <div class="chart-card">
        <h3>Répartition 5×5 / 3×3</h3>
        <p class="hint">Part de chaque format dans le revenu net.</p>
        <div class="chart-box small"><canvas id="chartFormat"></canvas></div>
        ${insightFormat(five, three)}
      </div>
      <div class="chart-card">
        <h3>Net réel par niveau</h3>
        <p class="hint">Où se concentre réellement le gain.</p>
        <div class="chart-box small"><canvas id="chartNiveau"></canvas></div>
      </div>
    </div>

    <h2 class="section-title">Public arbitré</h2>
    <div class="chart-grid two">
      <div class="chart-card">
        <h3>Masculin / Féminin / Mixte</h3>
        <p class="hint">Répartition des missions selon le genre de la compétition.</p>
        <div class="chart-box small"><canvas id="chartGenre"></canvas></div>
        ${insightGenre(rows)}
      </div>
      <div class="chart-card">
        <h3>Par catégorie d'âge</h3>
        <p class="hint">Des U11 aux séniors : où se situe le gros de ton activité.</p>
        <div class="chart-box small"><canvas id="chartCategorie"></canvas></div>
      </div>
    </div>

    <h2 class="section-title">Rentabilité du déplacement</h2>
    <div class="chart-card">
      <h3>Distance et rentabilité horaire</h3>
      <p class="hint">Chaque point est une mission : distance parcourue en abscisse, gain net par heure en ordonnée. Plus un point est bas et à droite, moins la mission est rentable.</p>
      <div class="chart-box tall"><canvas id="chartNuage"></canvas></div>
      ${insightRentabilite(rows)}
    </div>

    <div class="chart-card">
      <h3>Rentabilité par tranche de distance</h3>
      <p class="hint">Gain net moyen par heure selon l'éloignement de la salle.</p>
      <div class="chart-box"><canvas id="chartTranches"></canvas></div>
      ${insightTranches(rows)}
    </div>

    <h2 class="section-title">Où va l'argent</h2>
    ${renderClassementRentabilite(rows)}

    <div class="chart-card">
      <h3>Suivi des encaissements</h3>
      <p class="hint">Montants perçus et restant dus, mois par mois.</p>
      <div class="chart-box"><canvas id="chartPaiements"></canvas></div>
      ${insightPaiements(rows)}
    </div>

    <div class="stat-note">
      Temps estimé : ${AN.VITESSE_MOY_KMH} km/h de moyenne sur la route,
      ${AN.DUREE_5X5_H} h sur place en 5×5, ${AN.DUREE_3X3_H} h en 3×3.
      Le coût carburant ne comprend ni l'usure, ni l'entretien, ni l'assurance.
    </div>
  `;

  // Les graphiques se construisent après l'injection du HTML
  buildChartMois(rows);
  buildChartFormat(five, three);
  buildChartNiveau(rows);
  buildChartGenre(rows);
  buildChartCategorie(rows);
  buildChartNuage(rows);
  buildChartTranches(rows);
  buildChartPaiements(rows);

  brancherSelecteurAnalyse_();
  chargerStatsAvancees(AN.saison);
}

/* ---------- Stats avancées (calculées côté serveur) ----------
   Délais de paiement, régularité, fidélité géographique, projection de
   fin de saison, classement de rentabilité. Chargées à part de action=stats
   car elles ont leur propre sélecteur de saison (AN.saison), indépendant
   du sélecteur global en haut de page. Mises en cache par saison pour
   éviter de re-télécharger à chaque clic d'onglet. */

function chargerStatsAvancees(saison) {
  if (AN.statsCache[saison]) {
    injecterStatsAvancees(AN.statsCache[saison]);
    return;
  }

  jsonp("stats", { season: saison })
    .then(res => {
      if (!res.success) throw new Error(res.error || "Erreur API");
      AN.statsCache[saison] = res.stats;
      // Si l'utilisateur a changé de saison entre-temps, ne pas injecter une réponse périmée
      if (AN.saison === saison) injecterStatsAvancees(res.stats);
    })
    .catch(err => {
      const el = document.getElementById("analyseAvancee");
      if (el) el.innerHTML = `<div class="insight warn">Analyses avancées indisponibles : ${escapeHtml(err.message)}</div>`;
    });
}

function injecterStatsAvancees(stats) {
  const el = document.getElementById("analyseAvancee");
  if (!el) return;
  el.innerHTML = renderStatsAvancees(stats);
  buildChartJourSemaine(stats);
}

/* Le bouton « Recharger les statistiques » du repli local. */
document.addEventListener("click", function (e) {
  if (e.target && e.target.id === "btnRechargerStats") {
    state._statsEnAttente = false;
    state.serverStats = null;
    setStatus("Recalcul des statistiques…", "");
    loadStats(true);
    setTimeout(renderStats, 1200);
  }
});

function renderStatsAvancees(stats) {
  const cc = stats.cout_complet || {};
  const emp = stats.empreinte || {};
  const dp = stats.delais_paiement || {};
  const reg = stats.regularite || {};
  const fid = stats.fidelite_geographique || {};
  const proj = stats.projection_saison || null;

  return `
    <h2 class="section-title">Coût réel complet</h2>
    <div class="kpi-grid">
      ${kpi("Net réel (carburant seul)", formatMoney(stats.totaux ? stats.totaux.net_reel : 0))}
      ${kpi("Usure & entretien estimés", "−" + formatMoney(cc.cout_usure_total), cc.cout_usure_par_km + " €/km")}
      ${kpi("Net réel tout compris", formatMoney(cc.net_reel_tout_compris), "carburant + usure déduits")}
      ${kpi("Distance d'équilibre", cc.km_equilibre ? formatNumber(cc.km_equilibre, " km") : "—", "au-delà, le trajet mange plus qu'il ne rapporte en moyenne")}
    </div>
    ${proj ? renderProjection(proj) : ""}

    <h2 class="section-title">Délais de paiement réels</h2>
    ${dp.par_type && dp.par_type.length ? `
      <div class="kpi-grid">
        ${kpi("Délai moyen constaté", dp.delai_moyen_jours !== null ? dp.delai_moyen_jours + " j" : "—", "entre la date prévue et la réception")}
        ${kpi("Paiements avec délai connu", dp.nb_avec_delai_connu)}
      </div>
      <div class="table-card"><div class="table-wrap"><table>
        <thead><tr><th>Type de paiement</th><th class="num">Paiements</th><th class="num">Délai moyen</th><th class="num">En retard</th></tr></thead>
        <tbody>${dp.par_type.map(t => `<tr>
          <td>${escapeHtml(t.label)}</td>
          <td class="num">${t.nb_paiements}</td>
          <td class="num">${t.delai_moyen_jours >= 0 ? t.delai_moyen_jours + " j" : t.delai_moyen_jours + " j (anticipé)"}</td>
          <td class="num">${t.nb_en_retard}</td>
        </tr>`).join("")}</tbody>
      </table></div></div>
      ${dp.note ? `<div class="insight warn">${escapeHtml(dp.note)}</div>` : ""}
    ` : `<div class="insight">Pas encore assez de paiements avec date de réception fiable pour calculer un délai. Ça s'affinera au fil des validations de paiement.</div>`}

    <h2 class="section-title">Empreinte carbone</h2>
    <div class="kpi-grid">
      ${kpi("CO₂ émis", formatNumber(emp.co2_kg, " kg"))}
      ${kpi("Carburant consommé", formatNumber(emp.litres_consommes, " L"))}
      ${kpi("Équivalent pleins (50 L)", formatNumber(emp.equivalent_pleins_50l, ""))}
    </div>

    <h2 class="section-title">Régularité</h2>
    ${reg.mois_analyses >= 2 ? `
      <div class="kpi-grid">
        ${kpi("Variation mensuelle", reg.coefficient_variation !== null ? reg.coefficient_variation + " %" : "—", "plus c'est bas, plus les revenus sont réguliers")}
        ${kpi("Jour dominant", reg.jour_dominant || "—")}
        ${kpi("Mois analysés", reg.mois_analyses)}
      </div>
      <div class="chart-card">
        <h3>Répartition par jour de la semaine</h3>
        <p class="hint">Nombre de missions et net réel cumulé selon le jour.</p>
        <div class="chart-box small"><canvas id="chartJourSemaine"></canvas></div>
      </div>
    ` : `<div class="insight">Pas assez de mois différents sur cette saison pour mesurer la régularité.</div>`}

    <h2 class="section-title">Fidélité géographique</h2>
    ${fid.salles_distinctes ? `
      <div class="kpi-grid">
        ${kpi("Salles distinctes (5×5)", fid.salles_distinctes)}
        ${kpi("Villes distinctes", fid.villes_distinctes)}
        ${kpi("Indice de concentration", fid.indice_concentration + " / 100", "bas = très dispersé, haut = toujours les mêmes salles")}
        ${kpi("Salle principale", fid.salle_principale || "—", fid.part_salle_principale ? fid.part_salle_principale + " % des missions" : "")}
      </div>
    ` : `<div class="insight">Pas de match 5×5 sur cette saison.</div>`}
  `;
}

function renderProjection(proj) {
  return `
    <div class="analysis-hero" style="margin-top:14px;padding:18px 20px">
      <div class="eyebrow">Projection fin de saison ${escapeHtml(proj.saison)} · ${proj.pourcentage_saison_ecoule.toFixed(0)} % écoulés</div>
      <div class="big" style="font-size:32px">${formatMoney(proj.net_reel_projete_fin_saison)}</div>
      <div class="breakdown">
        <span><b>${formatMoney(proj.net_reel_actuel)}</b> déjà net</span>
        <span><b>${proj.missions_actuelles}</b> missions faites</span>
        <span>~<b>${proj.missions_projetees_fin_saison}</b> missions projetées</span>
      </div>
    </div>
  `;
}


function buildChartJourSemaine(stats) {
  const c = ctx("chartJourSemaine"); if (!c || typeof Chart === "undefined") return;
  const reg = stats.regularite || {};
  const jours = reg.repartition_jours || [];
  if (!jours.length) return;

  const ordre = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const tries = [...jours].sort((a, b) => ordre.indexOf(a.label) - ordre.indexOf(b.label));

  if (AN.charts.jourSemaine) { try { AN.charts.jourSemaine.destroy(); } catch (e) {} }

  AN.charts.jourSemaine = new Chart(c, {
    data: {
      labels: tries.map(j => j.label),
      datasets: [
        { type: "bar", label: "Missions", data: tries.map(j => j.count), backgroundColor: AN.COLORS.navyMid, borderRadius: 5, yAxisID: "y" },
        { type: "line", label: "Net réel", data: tries.map(j => j.net_reel), borderColor: AN.COLORS.gold, backgroundColor: AN.COLORS.gold, borderWidth: 2.5, tension: 0.3, pointRadius: 3, yAxisID: "y1" }
      ]
    },
    options: {
      ...chartBase,
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, precision: 0 },
        y1: { position: "right", grid: { display: false }, ticks: { font: { size: 11 }, color: AN.COLORS.gold } }
      },
      plugins: {
        ...chartBase.plugins,
        tooltip: { ...chartBase.plugins.tooltip, callbacks: { label: (i) => i.dataset.label === "Missions" ? `${i.parsed.y} mission(s)` : money(i.parsed.y) } }
      }
    }
  });
}

/* ---------- Filtre de saison propre à l'onglet Analyse ---------- */

/* Toutes les missions actives, indépendamment du filtre de saison global :
   l'onglet Analyse a son propre sélecteur. La recherche texte reste appliquée. */
function analyseRowsToutesSaisons() {
  const mots = state.searchTokens;
  return state.allRows
    .filter(r => r._isActive && r._format !== "Alerte")
    .filter(r => correspondRecherche_(r, mots))
    .map(enrichirPourAnalyse_);
}

function enrichirPourAnalyse_(r) {
  const km = r._km || 0;
  const brut = r._amount || 0;
  const carburant = realFuelCostClient(km, r._date);
  const net = round2(brut - carburant);

  const heuresRoute = km ? km / AN.VITESSE_MOY_KMH : 0;
  const heuresSurPlace = r._format === "3x3" ? AN.DUREE_3X3_H : AN.DUREE_5X5_H;
  const heuresTotal = heuresRoute + heuresSurPlace;

  return {
    ...r,
    _km: km, _brut: brut, _carburant: carburant, _net: net,
    _heuresRoute: round2(heuresRoute),
    _heuresSurPlace: heuresSurPlace,
    _heuresTotal: round2(heuresTotal),
    _eurHeure: heuresTotal > 0 ? round2(net / heuresTotal) : 0,
    _eurKm: km > 0 ? round2(brut / km) : 0,
    _partCarburant: brut > 0 ? (carburant / brut) * 100 : 0,
    _paye: get(r, "Statut paiement") === "Reçu",
    // Lus de la colonne si le Sheet est enrichi, sinon déduits à la volée
    _genre: get(r, "Genre") || detecterGenreClient(get(r, "Code compétition"), get(r, "Libellé compétition")),
    _categorie: get(r, "Catégorie d'âge") || detecterCategorieClient(get(r, "Code compétition"), get(r, "Libellé compétition"))
  };
}

/* ---------- Détection genre / catégorie (miroir de Code.gs) ----------
   Permet d'afficher les stats même si le Sheet n'a pas encore été enrichi
   par completerGenreEtCategorie(). Doit rester identique au serveur. */

function normUp(v) {
  return String(v || "").replace(/\s+/g, " ").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function detecterGenreClient(code, libelle) {
  const c = normUp(code);
  const t = (c + " " + normUp(libelle)).replace(/[_.]+/g, " ").trim();

  if (/\bU\d{2}MI\b/.test(t) || /\bMIXTE\b/.test(t)) return "Mixte";

  let m = c.match(/^(?:D|R|N|PR|PN)(M|F)(?:U?\d|\d|$)/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";

  if (/\bSM\b/.test(t)) return "Masculin";
  if (/\bSF\b/.test(t)) return "Féminin";

  m = t.match(/\bU\d{2}\s*(M|F)\b/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";

  m = t.match(/\bRS(M|F)\b/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";

  return "";
}

function detecterCategorieClient(code, libelle) {
  const c = normUp(code);
  const t = (c + " " + normUp(libelle)).replace(/[_.]+/g, " ").trim();

  const m = t.match(/U(\d{2})/);
  if (m) return "U" + m[1];

  if (/\bS(M|F)\b/.test(t) || /\bRS(M|F)\b/.test(t)) return "Séniors";
  if (/^(?:D|R|N)(?:M|F)\d/.test(c)) return "Séniors";
  if (/^(?:PR|PN)(?:M|F)$/.test(c)) return "Séniors";

  return "";
}

function filtrerParSaison_(rows, saison) {
  if (!saison || saison === "Toutes les saisons") return rows;
  return rows.filter(r => r._season === saison);
}

/* Choisit une saison valide : celle déjà retenue si elle existe encore,
   sinon celle du filtre global, sinon la plus récente. */
function resoudreSaison_(courante, rows) {
  const dispo = saisonsDisponibles(rows);
  if (courante === "Toutes les saisons") return courante;
  if (courante && dispo.includes(courante)) return courante;
  if (state.selectedSeason && dispo.includes(state.selectedSeason)) return state.selectedSeason;
  return dispo[0] || "Toutes les saisons";
}

function optionsSaison_(rows, selected) {
  const choix = ["Toutes les saisons", ...saisonsDisponibles(rows)];
  return choix.map(s =>
    `<option value="${escapeHtml(s)}" ${s === selected ? "selected" : ""}>${escapeHtml(s)}</option>`
  ).join("");
}

function brancherSelecteurAnalyse_() {
  const sel = document.getElementById("saisonAnalyse");
  if (!sel) return;
  sel.addEventListener("change", e => {
    AN.saison = e.target.value;
    renderAnalyse();
  });
}

function renderAnalyseHero(brut, carburant, net, partGardee, nb, kmTotal, heuresTotal) {
  const partCarburant = 100 - partGardee;
  return `
    <div class="analysis-hero">
      <div class="eyebrow">Ce que l'arbitrage rapporte vraiment · ${escapeHtml(state.selectedSeason)}</div>
      <div class="big">${formatMoney(net)}</div>
      <div class="breakdown">
        <span><b>${formatMoney(brut)}</b> encaissés</span>
        <span>−<b>${formatMoney(carburant)}</b> de carburant</span>
        <span><b>${nb}</b> mission(s)</span>
        <span><b>${formatNumber(kmTotal, " km")}</b> parcourus</span>
        <span><b>${formatHeures(heuresTotal)}</b> mobilisées</span>
      </div>
      <div class="margin-bar">
        <div class="kept" style="width:${partGardee.toFixed(1)}%"></div>
        <div class="burned" style="width:${partCarburant.toFixed(1)}%"></div>
      </div>
      <div class="margin-legend">
        <span><i style="background:var(--gold)"></i>${partGardee.toFixed(1)} % conservés</span>
        <span><i style="background:var(--red)"></i>${partCarburant.toFixed(1)} % au carburant</span>
      </div>
    </div>
  `;
}

function kpi(label, value, sub) {
  return `<div class="kpi"><label>${escapeHtml(label)}</label><strong>${value}</strong>${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ""}</div>`;
}

function litresTotal(rows) {
  return rows.reduce((t, r) => {
    const cutover = new Date(2026, 7, 1);
    const conso = (r._date && r._date >= cutover) ? 6.0 : 6.58;
    return t + (r._km * conso / 100);
  }, 0);
}

function formatHeures(h) {
  const n = Number(h) || 0;
  if (n < 1) return Math.round(n * 60) + " min";
  const heures = Math.floor(n);
  const min = Math.round((n - heures) * 60);
  return min ? `${heures} h ${String(min).padStart(2, "0")}` : `${heures} h`;
}

/* ---------------- Agrégations ---------------- */

/* Ordre des mois dans la saison sportive : septembre → juillet.
   La saison bascule le 30 juillet, donc août est le mois de coupure. */
const ORDRE_MOIS_SAISON = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

function rangMoisSaison(moisIndex1a12) {
  const i = ORDRE_MOIS_SAISON.indexOf(moisIndex1a12);
  return i === -1 ? 99 : i;
}

/* Regroupe par mois. Trie dans l'ordre de la saison sportive
   (sept, oct, nov, déc, janv, févr, mars, avr, mai, juin, juil),
   et non par montant ni par année civile. */
function groupMonths(rows, seasonFilter) {
  const map = new Map();

  rows.forEach(r => {
    if (!r._date) return;
    if (seasonFilter && seasonFilter !== "Toutes les saisons" && r._season !== seasonFilter) return;

    const annee = r._date.getFullYear();
    const mois = r._date.getMonth() + 1;
    const key = annee + "-" + String(mois).padStart(2, "0");

    if (!map.has(key)) {
      map.set(key, {
        key, annee, mois,
        saison: r._season || "",
        net: 0, carburant: 0, brut: 0, count: 0, recu: 0, du: 0, km: 0, heures: 0
      });
    }

    const m = map.get(key);
    m.net += r._net; m.carburant += r._carburant; m.brut += r._brut;
    m.km += r._km; m.heures += r._heuresTotal; m.count++;
    if (r._paye) m.recu += r._brut; else m.du += r._brut;
  });

  return [...map.values()].sort((a, b) => {
    // D'abord par saison (ordre chronologique des saisons)
    if (a.saison !== b.saison) return String(a.saison).localeCompare(String(b.saison));
    // Puis dans l'ordre des mois de la saison sportive
    return rangMoisSaison(a.mois) - rangMoisSaison(b.mois);
  });
}

/* Liste des saisons réellement présentes dans les données affichées */
function saisonsDisponibles(rows) {
  const set = new Set();
  rows.forEach(r => { if (r._season) set.add(r._season); });
  return [...set].sort().reverse();
}

function labelMois(key) {
  const [y, m] = key.split("-");
  const noms = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
  return `${noms[Number(m) - 1]} ${y.slice(2)}`;
}

function groupBySimple(rows, keyFn) {
  const map = new Map();
  rows.forEach(r => {
    const k = String(keyFn(r) || "").trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, { label: k, net: 0, brut: 0, km: 0, count: 0, heures: 0 });
    const g = map.get(k);
    g.net += r._net; g.brut += r._brut; g.km += r._km; g.count++; g.heures += r._heuresTotal;
  });
  return [...map.values()];
}

/* ---------------- Graphiques ---------------- */

function destroyCharts() {
  Object.values(AN.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
  AN.charts = {};
}

function ctx(id) {
  const el = document.getElementById(id);
  return el ? el.getContext("2d") : null;
}

const chartBase = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { font: { size: 11.5, family: "Inter, sans-serif" }, color: AN.COLORS.muted, boxWidth: 12, padding: 12 } },
    tooltip: {
      backgroundColor: "#0A1F44", padding: 10, cornerRadius: 8,
      titleFont: { size: 12.5 }, bodyFont: { size: 12.5, family: "Inter, sans-serif" }
    }
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: AN.COLORS.muted } },
    y: { grid: { color: AN.COLORS.grid }, ticks: { font: { size: 11 }, color: AN.COLORS.muted } }
  }
};

function buildChartMois(rows) {
  const c = ctx("chartMois"); if (!c || typeof Chart === "undefined") return;
  const months = groupMonths(rows, AN.saison);

  if (!months.length) {
    AN.charts.mois = new Chart(c, {
      type: "bar",
      data: { labels: [], datasets: [] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  AN.charts.mois = new Chart(c, {
    data: {
      labels: months.map(m => labelMois(m.key)),
      datasets: [
        { type: "bar", label: "Net conservé", data: months.map(m => round2(m.net)), backgroundColor: AN.COLORS.navyMid, borderRadius: 5, stack: "s", yAxisID: "y" },
        { type: "bar", label: "Carburant", data: months.map(m => round2(m.carburant)), backgroundColor: AN.COLORS.red, borderRadius: 5, stack: "s", yAxisID: "y" },
        { type: "line", label: "Missions", data: months.map(m => m.count), borderColor: AN.COLORS.gold, backgroundColor: AN.COLORS.gold, borderWidth: 2.5, tension: 0.3, pointRadius: 3, yAxisID: "y1" }
      ]
    },
    options: {
      ...chartBase,
      scales: {
        x: { ...chartBase.scales.x, stacked: true },
        y: { ...chartBase.scales.y, stacked: true, title: { display: true, text: "€", font: { size: 11 }, color: AN.COLORS.muted } },
        y1: { position: "right", grid: { display: false }, ticks: { font: { size: 11 }, color: AN.COLORS.gold, precision: 0 }, title: { display: true, text: "missions", font: { size: 11 }, color: AN.COLORS.gold } }
      },
      plugins: {
        ...chartBase.plugins,
        tooltip: {
          ...chartBase.plugins.tooltip,
          callbacks: {
            label: (i) => i.dataset.label === "Missions"
              ? `${i.parsed.y} mission(s)`
              : `${i.dataset.label} : ${money(i.parsed.y)}`
          }
        }
      }
    }
  });
}

function buildChartFormat(five, three) {
  const c = ctx("chartFormat"); if (!c || typeof Chart === "undefined") return;
  const netFive = five.reduce((t, r) => t + r._net, 0);
  const netThree = three.reduce((t, r) => t + r._net, 0);

  AN.charts.format = new Chart(c, {
    type: "doughnut",
    data: {
      labels: [`5×5 (${five.length})`, `3×3 (${three.length})`],
      datasets: [{ data: [round2(netFive), round2(netThree)], backgroundColor: [AN.COLORS.navyMid, AN.COLORS.red], borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 12 }, color: AN.COLORS.muted, boxWidth: 12, padding: 12 } },
        tooltip: { ...chartBase.plugins.tooltip, callbacks: { label: (i) => `${i.label} : ${money(i.parsed)}` } }
      }
    }
  });
}

function buildChartNiveau(rows) {
  const c = ctx("chartNiveau"); if (!c || typeof Chart === "undefined") return;
  const g = groupBySimple(rows, r => get(r, "Niveau administratif") || "Non renseigné")
    .sort((a, b) => b.net - a.net);

  AN.charts.niveau = new Chart(c, {
    type: "bar",
    data: {
      labels: g.map(x => x.label),
      datasets: [{
        label: "Net réel",
        data: g.map(x => round2(x.net)),
        backgroundColor: g.map(x => x.label === "3x3" ? AN.COLORS.red : x.label === "Régional" ? AN.COLORS.navy : AN.COLORS.navyMid),
        borderRadius: 5
      }]
    },
    options: {
      ...chartBase,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { ...chartBase.plugins.tooltip, callbacks: { label: (i) => `${money(i.parsed.x)} — ${g[i.dataIndex].count} mission(s)` } }
      },
      scales: {
        x: { grid: { color: AN.COLORS.grid }, ticks: { font: { size: 11 }, color: AN.COLORS.muted } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: AN.COLORS.muted } }
      }
    }
  });
}

function buildChartGenre(rows) {
  const c = ctx("chartGenre"); if (!c || typeof Chart === "undefined") return;

  const ordre = ["Masculin", "Féminin", "Mixte", "Non déterminé"];
  const g = groupBySimple(rows, r => r._genre || "Non déterminé")
    .sort((a, b) => ordre.indexOf(a.label) - ordre.indexOf(b.label));

  const couleurs = {
    "Masculin": AN.COLORS.navyMid,
    "Féminin": AN.COLORS.red,
    "Mixte": AN.COLORS.gold,
    "Non déterminé": "#B8C4D8"
  };

  AN.charts.genre = new Chart(c, {
    type: "doughnut",
    data: {
      labels: g.map(x => `${x.label} (${x.count})`),
      datasets: [{
        data: g.map(x => round2(x.net)),
        backgroundColor: g.map(x => couleurs[x.label] || AN.COLORS.navyLight),
        borderWidth: 0, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 12 }, color: AN.COLORS.muted, boxWidth: 12, padding: 12 } },
        tooltip: {
          ...chartBase.plugins.tooltip,
          callbacks: {
            label: (i) => {
              const item = g[i.dataIndex];
              return [`${item.label} : ${money(item.net)} nets`, `${item.count} mission(s) · ${formatNumber(item.km, " km")}`];
            }
          }
        }
      }
    }
  });
}

function buildChartCategorie(rows) {
  const c = ctx("chartCategorie"); if (!c || typeof Chart === "undefined") return;

  // Ordre logique : des plus jeunes aux séniors
  const ordre = ["U11", "U13", "U15", "U17", "U18", "U20", "U21", "Séniors", "Non déterminé"];
  const g = groupBySimple(rows, r => r._categorie || "Non déterminé")
    .sort((a, b) => {
      const ia = ordre.indexOf(a.label), ib = ordre.indexOf(b.label);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  AN.charts.categorie = new Chart(c, {
    type: "bar",
    data: {
      labels: g.map(x => x.label),
      datasets: [{
        label: "Net réel",
        data: g.map(x => round2(x.net)),
        backgroundColor: g.map(x => x.label === "Séniors" ? AN.COLORS.navy : AN.COLORS.navyMid),
        borderRadius: 5
      }]
    },
    options: {
      ...chartBase,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartBase.plugins.tooltip,
          callbacks: { label: (i) => `${money(i.parsed.y)} — ${g[i.dataIndex].count} mission(s)` }
        }
      }
    }
  });
}

function buildChartNuage(rows) {
  const c = ctx("chartNuage"); if (!c || typeof Chart === "undefined") return;
  const pts = rows.filter(r => r._km > 0 && r._eurHeure !== 0);

  AN.charts.nuage = new Chart(c, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "5×5",
          data: pts.filter(r => r._format === "5x5").map(r => ({ x: r._km, y: r._eurHeure, lieu: firstValue(r, ["Recevant", "Visiteur / événement"]), date: get(r, "Date match") })),
          backgroundColor: AN.COLORS.navyMid, pointRadius: 5, pointHoverRadius: 7
        },
        {
          label: "3×3",
          data: pts.filter(r => r._format === "3x3").map(r => ({ x: r._km, y: r._eurHeure, lieu: firstValue(r, ["Visiteur / événement", "Recevant"]), date: get(r, "Date match") })),
          backgroundColor: AN.COLORS.red, pointRadius: 5, pointHoverRadius: 7
        }
      ]
    },
    options: {
      ...chartBase,
      interaction: { mode: "nearest", intersect: true },
      plugins: {
        ...chartBase.plugins,
        tooltip: {
          ...chartBase.plugins.tooltip,
          callbacks: {
            label: (i) => {
              const d = i.raw;
              return [`${d.lieu || "Mission"} — ${d.date || ""}`, `${formatNumber(d.x, " km")} · ${money(d.y)}/h`];
            }
          }
        }
      },
      scales: {
        x: { ...chartBase.scales.x, grid: { color: AN.COLORS.grid }, title: { display: true, text: "distance aller-retour (km)", font: { size: 11 }, color: AN.COLORS.muted } },
        y: { ...chartBase.scales.y, title: { display: true, text: "net par heure (€)", font: { size: 11 }, color: AN.COLORS.muted } }
      }
    }
  });
}

function trancheDe(km) {
  if (km < 20) return "0–20 km";
  if (km < 40) return "20–40 km";
  if (km < 60) return "40–60 km";
  if (km < 100) return "60–100 km";
  return "100 km et +";
}
const ORDRE_TRANCHES = ["0–20 km", "20–40 km", "40–60 km", "60–100 km", "100 km et +"];

function buildChartTranches(rows) {
  const c = ctx("chartTranches"); if (!c || typeof Chart === "undefined") return;
  const withKm = rows.filter(r => r._km > 0);
  const g = groupBySimple(withKm, r => trancheDe(r._km))
    .sort((a, b) => ORDRE_TRANCHES.indexOf(a.label) - ORDRE_TRANCHES.indexOf(b.label));

  AN.charts.tranches = new Chart(c, {
    data: {
      labels: g.map(x => x.label),
      datasets: [
        { type: "bar", label: "Net par heure", data: g.map(x => x.heures > 0 ? round2(x.net / x.heures) : 0), backgroundColor: AN.COLORS.navyMid, borderRadius: 5, yAxisID: "y" },
        { type: "line", label: "Missions", data: g.map(x => x.count), borderColor: AN.COLORS.gold, backgroundColor: AN.COLORS.gold, borderWidth: 2.5, tension: 0.3, pointRadius: 3, yAxisID: "y1" }
      ]
    },
    options: {
      ...chartBase,
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, title: { display: true, text: "€ / heure", font: { size: 11 }, color: AN.COLORS.muted } },
        y1: { position: "right", grid: { display: false }, ticks: { font: { size: 11 }, color: AN.COLORS.gold, precision: 0 } }
      },
      plugins: {
        ...chartBase.plugins,
        tooltip: {
          ...chartBase.plugins.tooltip,
          callbacks: { label: (i) => i.dataset.label === "Missions" ? `${i.parsed.y} mission(s)` : `${money(i.parsed.y)} / heure` }
        }
      }
    }
  });
}

function buildChartPaiements(rows) {
  const c = ctx("chartPaiements"); if (!c || typeof Chart === "undefined") return;
  const months = groupMonths(rows);

  AN.charts.paiements = new Chart(c, {
    type: "bar",
    data: {
      labels: months.map(m => labelMois(m.key)),
      datasets: [
        { label: "Perçu", data: months.map(m => round2(m.recu)), backgroundColor: AN.COLORS.green, borderRadius: 5, stack: "p" },
        { label: "En attente", data: months.map(m => round2(m.du)), backgroundColor: AN.COLORS.gold, borderRadius: 5, stack: "p" }
      ]
    },
    options: {
      ...chartBase,
      scales: {
        x: { ...chartBase.scales.x, stacked: true },
        y: { ...chartBase.scales.y, stacked: true }
      },
      plugins: {
        ...chartBase.plugins,
        tooltip: { ...chartBase.plugins.tooltip, callbacks: { label: (i) => `${i.dataset.label} : ${money(i.parsed.y)}` } }
      }
    }
  });
}

/* ---------------- Classement rentabilité ---------------- */

function renderClassementRentabilite(rows) {
  const five = rows.filter(r => r._format === "5x5");
  const parClub = groupBySimple(five, r => get(r, "Recevant"))
    .filter(g => g.count > 0)
    .sort((a, b) => b.net - a.net)
    .slice(0, 10);

  if (!parClub.length) return "";

  const maxNet = Math.max(...parClub.map(g => g.net));

  return `
    <div class="chart-card">
      <h3>Clubs les plus rentables (5×5)</h3>
      <p class="hint">Net réel cumulé par club recevant, nombre de missions et gain net par heure.</p>
      ${parClub.map(g => `
        <div class="rank-row">
          <div class="rank-name">
            <div class="label">${escapeHtml(g.label)}</div>
            <div class="meter"><i style="width:${maxNet > 0 ? (g.net / maxNet) * 100 : 0}%"></i></div>
          </div>
          <div class="rank-count">${g.count}×</div>
          <div class="rank-value ${g.net < 0 ? "neg" : ""}">${formatMoney(g.net)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------------- Lectures écrites sous les graphiques ---------------- */

function insightMois(rows) {
  const months = groupMonths(rows);
  if (months.length < 2) return "";
  const best = months.reduce((a, b) => b.net > a.net ? b : a);
  const worst = months.reduce((a, b) => b.net < a.net ? b : a);
  return `<div class="insight">
    Mois le plus rentable : <b>${labelMois(best.key)}</b> avec ${formatMoney(best.net)} nets sur ${best.count} mission(s).
    Le plus faible : <b>${labelMois(worst.key)}</b> à ${formatMoney(worst.net)}.
  </div>`;
}

function insightFormat(five, three) {
  if (!five.length || !three.length) return "";
  const hFive = five.reduce((t, r) => t + r._heuresTotal, 0);
  const hThree = three.reduce((t, r) => t + r._heuresTotal, 0);
  const eurHFive = hFive > 0 ? five.reduce((t, r) => t + r._net, 0) / hFive : 0;
  const eurHThree = hThree > 0 ? three.reduce((t, r) => t + r._net, 0) / hThree : 0;
  const mieux = eurHFive >= eurHThree ? "Le 5×5" : "Le 3×3";
  const ecart = Math.abs(eurHFive - eurHThree);
  return `<div class="insight">
    <b>${mieux}</b> rapporte davantage à l'heure : ${money(eurHFive)}/h en 5×5 contre ${money(eurHThree)}/h en 3×3,
    soit ${money(ecart)} d'écart horaire.
  </div>`;
}

function insightGenre(rows) {
  const g = groupBySimple(rows, r => r._genre || "Non déterminé")
    .filter(x => x.label !== "Non déterminé");
  if (g.length < 2) return "";

  const total = g.reduce((t, x) => t + x.count, 0);
  const dominant = g.reduce((a, b) => b.count > a.count ? b : a);
  const part = total > 0 ? (dominant.count / total) * 100 : 0;

  // Comparaison du rendement horaire entre genres
  const avecHeures = g.filter(x => x.heures > 0).map(x => ({ ...x, eurH: x.net / x.heures }));
  let comparaison = "";
  if (avecHeures.length >= 2) {
    const best = avecHeures.reduce((a, b) => b.eurH > a.eurH ? b : a);
    const worst = avecHeures.reduce((a, b) => b.eurH < a.eurH ? b : a);
    if (best.label !== worst.label) {
      comparaison = ` Le <b>${escapeHtml(best.label.toLowerCase())}</b> rapporte le plus à l'heure (${money(best.eurH)}/h contre ${money(worst.eurH)}/h).`;
    }
  }

  return `<div class="insight">
    <b>${escapeHtml(dominant.label)}</b> domine avec ${dominant.count} mission(s), soit ${part.toFixed(0)} % du total.${comparaison}
  </div>`;
}

function insightRentabilite(rows) {
  const pts = rows.filter(r => r._km > 0 && r._eurHeure !== 0);
  if (pts.length < 3) return "";
  const pire = pts.reduce((a, b) => b._eurHeure < a._eurHeure ? b : a);
  const meilleure = pts.reduce((a, b) => b._eurHeure > a._eurHeure ? b : a);
  return `<div class="insight warn">
    Mission la moins rentable : <b>${escapeHtml(firstValue(pire, ["Recevant", "Visiteur / événement"]) || "—")}</b>
    le ${escapeHtml(get(pire, "Date match"))} — ${formatNumber(pire._km, " km")} pour ${money(pire._eurHeure)}/h.
    À l'inverse, ${escapeHtml(firstValue(meilleure, ["Recevant", "Visiteur / événement"]) || "—")} monte à ${money(meilleure._eurHeure)}/h.
  </div>`;
}

function insightTranches(rows) {
  const withKm = rows.filter(r => r._km > 0);
  if (withKm.length < 4) return "";
  const g = groupBySimple(withKm, r => trancheDe(r._km))
    .map(x => ({ ...x, eurH: x.heures > 0 ? x.net / x.heures : 0 }))
    .sort((a, b) => b.eurH - a.eurH);
  if (!g.length) return "";
  const best = g[0], worst = g[g.length - 1];
  return `<div class="insight good">
    Les missions <b>${escapeHtml(best.label)}</b> sont les plus rentables : ${money(best.eurH)}/h.
    Les <b>${escapeHtml(worst.label)}</b> tombent à ${money(worst.eurH)}/h.
  </div>`;
}

function insightPaiements(rows) {
  const nonPayes = rows.filter(r => !r._paye && !r._benevole);
  if (!nonPayes.length) return `<div class="insight good">Tout est encaissé pour cette saison.</div>`;

  const today = new Date();
  const retard = nonPayes.filter(r => {
    const d = parseFrDate(get(r, "Date paiement"));
    return d && d < today;
  });

  const montantRetard = retard.reduce((t, r) => t + r._brut, 0);
  const montantTotal = nonPayes.reduce((t, r) => t + r._brut, 0);

  if (!retard.length) {
    return `<div class="insight">${formatMoney(montantTotal)} restent à percevoir sur ${nonPayes.length} mission(s), aucune échéance dépassée.</div>`;
  }

  return `<div class="insight warn">
    <b>${retard.length} paiement(s) en retard</b> pour ${formatMoney(montantRetard)} :
    la date prévue est passée sans réception enregistrée. Total restant dû : ${formatMoney(montantTotal)}.
  </div>`;
}
