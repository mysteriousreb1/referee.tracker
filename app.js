/* © 2026 Clément REBHOLZ — Referee Tracker. Tous droits réservés. Reproduction, copie ou réutilisation interdites sans autorisation écrite de l'auteur. */
/* =====================================================
   REFEREE TRACKER — INTERFACE GITHUB PAGES
   Connectée à Google Apps Script via rt-auth.js (POST authentifié).
   Carte : OpenStreetMap (Leaflet) + itinéraire OSRM.
   Stats : calculées côté serveur (endpoint action=stats).
   ===================================================== */

/* "Bénévole" : match arbitré gratuitement, en accord avec le club recevant.
   Rien n'est dû : ces missions sortent du restant à encaisser et des retards. */
const PAYMENT_STATUSES = ["En retard", "À recevoir", "Reçu partiel", "À vérifier", "Reçu", "Bénévole", "Écart à vérifier"];
const BENEVOLE = "Bénévole";

/* Bloc 9 (25/09/2026) — Perf & fiabilité */
const APP_VERSION = "2026-10-05-b13";
const RT_NET = { retries: 0, echecs: 0, keepWarm: 0, dernierPing: null };
const RT_ACTIONS_LECTURE = ["ping", "matchs", "stats", "config", "classements", "qcmStats", "formations", "niveaux", "evaluations", "contacts", "procedures", "hotels", "enjeux", "elicence", "indispos", "rapports"];

let state = {
  allRows: [],
  filteredRows: [],
  serverStats: null,
  couts: null,             // périodes carburant/entretien (réglages)
  prixActuel: null,        // prix E10 temps réel, fourni par le serveur
  activeTab: "accueil",
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
  contactsSubView: "procedures", // "contacts" ou "procedures"
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


/* Bloc 9 — Décoration retry du transport jsonp (défini dans rt-auth.js).
   Ne réessaie QUE les actions de lecture (jamais une écriture, pour éviter
   tout double envoi). Transparent : même Promise en retour. Guardé : si
   jsonp n'est pas décorable, aucun effet. */
function rtInstallRetry_() {
  const wrap = name => {
    const raw = window[name];
    if (typeof raw !== "function" || raw._rtWrapped) return;
    const MAX = 3, BASE = 800, sleep = ms => new Promise(r => setTimeout(r, ms));
    const wrapped = function (action) {
      const args = arguments, self = this;
      if (RT_ACTIONS_LECTURE.indexOf(String(action)) === -1) return raw.apply(self, args);
      let essai = 0;
      const tenter = () => raw.apply(self, args).then(r => r, err => {
        essai++; RT_NET.retries++;
        if (essai >= MAX) { RT_NET.echecs++; throw err; }
        return sleep(BASE * essai).then(tenter);
      });
      return tenter();
    };
    wrapped._rtWrapped = true;
    try { window[name] = wrapped; } catch (e) {}
  };
  wrap("jsonp"); wrap("jsonpFrais");
}

/* Keep-warm : ping léger tant que l'onglet est visible, pour éviter le cold
   start d'Apps Script (~1 min d'écran blanc au premier appel). */
function rtStartKeepWarm_() {
  if (RT_NET._kwId) return;
  RT_NET._kwId = setInterval(() => {
    if (document.visibilityState !== "visible" || typeof jsonp !== "function") return;
    jsonp("ping").then(() => { RT_NET.keepWarm++; RT_NET.dernierPing = new Date().toLocaleTimeString("fr-FR"); }).catch(() => {});
  }, 4 * 60 * 1000);
}

/* Diagnostic — tape RTDiag() dans la Console (F12) pour un état de santé. */
window.RTDiag = function () {
  const d = {
    version: APP_VERSION,
    enLigne: navigator.onLine,
    onglet_actif: state.activeTab,
    lignes_chargees: (state.allRows || []).length,
    dernier_chargement: state._lastLoadTs ? new Date(state._lastLoadTs).toLocaleString("fr-FR") : "—",
    stats_serveur: state.serverStats ? "chargées" : "absentes",
    reseau: { retries: RT_NET.retries, echecs: RT_NET.echecs, keepWarm: RT_NET.keepWarm, dernierPing: RT_NET.dernierPing }
  };
  console.log("[RT Diagnostic]", d);
  return d;
};

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindUi();
  buildSeasonSelect();
  rtInstallRetry_();
  rtStartKeepWarm_();
  console.log("%cReferee Tracker " + APP_VERSION, "font-weight:bold");
  // loadData() est déclenché par rt-auth.js une fois l'utilisateur authentifié.
  setTimeout(verifierAffichageInitial, 1500);
  setTimeout(verifierAffichageInitial, 5000);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(err => console.warn("Mode hors ligne indisponible :", err));
  }
});

function bindUi() {
  // Clic sur le logo : retour à l'accueil, quelle que soit la page.
  const brandHome = document.getElementById("brandHome");
  if (brandHome) {
    const goHome = () => { setActiveTab("accueil"); try { window.scrollTo({ top: 0 }); } catch (e) {} };
    brandHome.addEventListener("click", goHome);
    brandHome.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); } });
  }
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
  setupMoreMenu_();

  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const statsSubOverviewBtn = document.getElementById("statsSubOverviewBtn");
  const statsSubAvanceeBtn = document.getElementById("statsSubAvanceeBtn");
  if (statsSubOverviewBtn) statsSubOverviewBtn.addEventListener("click", () => setStatsSubView_("overview"));
  if (statsSubAvanceeBtn) statsSubAvanceeBtn.addEventListener("click", () => setStatsSubView_("avancee"));
  const statsSubEstimationBtn = document.getElementById("statsSubEstimationBtn");
  if (statsSubEstimationBtn) statsSubEstimationBtn.addEventListener("click", () => setStatsSubView_("estimation"));

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

  // Recherche : anti-rebond 180 ms (un rendu par pause de frappe, pas par touche) ; Échap efface.
  let rechercheTimer = 0;
  const searchEl = document.getElementById("searchInput");
  const appliquerRecherche = () => {
    state.search = normaliserRecherche(searchEl.value);
    state.searchTokens = state.search ? state.search.split(" ") : [];
    renderAll();
  };
  searchEl.addEventListener("input", () => { clearTimeout(rechercheTimer); rechercheTimer = setTimeout(appliquerRecherche, 180); });
  searchEl.addEventListener("keydown", e => {
    if (e.key === "Escape" && searchEl.value) { searchEl.value = ""; clearTimeout(rechercheTimer); appliquerRecherche(); }
  });

  // Loupe header (téléphone) : déplie/replie la barre Saison/Recherche/Filtre.
  // Sur PC la barre est toujours visible (bouton masqué en CSS), toggle sans effet.
  const searchToggle = document.getElementById("searchToggleBtn");
  const toolbarSearch = document.getElementById("toolbarSearch");
  if (searchToggle && toolbarSearch) {
    searchToggle.addEventListener("click", () => {
      const open = toolbarSearch.classList.toggle("search-open");
      searchToggle.setAttribute("aria-expanded", open ? "true" : "false");
      searchToggle.classList.toggle("active", open);
      if (open) { const i = document.getElementById("searchInput"); if (i) i.focus(); }
    });
  }

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

/* Menu "Plus" (téléphone) — 01/10/2026 : désencombre la barre d'onglets en
   repliant les onglets secondaires dans un panneau déroulant. PC/tablette
   inchangés (tout masqué en CSS hors ≤720px). Injecté en JS : aucune
   modification de la structure de index.html. */
function setupMoreMenu_() {
  const nav = document.querySelector("nav.tabs");
  if (!nav || document.getElementById("tabMoreBtn")) return;
  const SECONDARY = ["stats", "export", "qcm", "progression", "reglement", "elicence", "indispos", "rapports", "contacts"];
  SECONDARY.forEach(t => {
    const b = nav.querySelector(`.tab[data-tab="${t}"]`);
    if (b) b.classList.add("tab-secondary");
  });

  const more = document.createElement("button");
  more.type = "button";
  more.id = "tabMoreBtn";
  more.className = "tab tab-more";
  more.setAttribute("aria-expanded", "false");
  more.innerHTML = `<span class="tab-icon"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></span><span class="tab-label">Plus</span>`;
  const foot = nav.querySelector(".tabs-foot");
  nav.insertBefore(more, foot || null);

  const panel = document.createElement("div");
  panel.id = "tabMorePanel";
  panel.className = "tab-more-panel";
  panel.hidden = true;
  SECONDARY.forEach(t => {
    const src = nav.querySelector(`.tab[data-tab="${t}"] .tab-label`);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-more-item";
    item.dataset.goto = t;
    item.textContent = src ? src.textContent : t;
    panel.appendChild(item);
  });
  // Hors de la grille .tabs pour occuper toute la largeur proprement.
  nav.parentNode.insertBefore(panel, nav.nextSibling);

  const close = () => { panel.hidden = true; more.setAttribute("aria-expanded", "false"); more.classList.remove("active"); };
  more.addEventListener("click", ev => {
    ev.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    more.setAttribute("aria-expanded", open ? "true" : "false");
    more.classList.toggle("active", open);
  });
  panel.addEventListener("click", ev => {
    const it = ev.target.closest("[data-goto]");
    if (!it) return;
    setActiveTab(it.dataset.goto);
    close();
  });
  document.addEventListener("click", () => { if (!panel.hidden) close(); });
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  // iPhone : la barre d'onglets est scrollable ; on ramène l'onglet actif à
  // l'écran pour qu'il ne reste jamais caché hors du champ visible.
  const ongletActif = document.querySelector(".tab.active");
  if (ongletActif && ongletActif.scrollIntoView) { try { ongletActif.scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) {} }
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === tab));
  state.filteredRows = filterRows(state.allRows);
  renderTab_(tab);
  if (tab === "qcm" && !state.qcmStats) loadQcmStats();
  if (tab === "progression" && !state.qcmStats) loadQcmStats();
}

/* ---------------- Chargement données ---------------- */

function loadData() {
  setStatus(state.allRows.length ? "Actualisation des données…" : "Chargement des données…", "");
  jsonp("matchs")
    .then(res => {
      if (!res.success) throw new Error(res.error || "Erreur API");
      const lignes = normalizeRows(res.data || []);
      // Garde anti-perte : une réponse vide alors qu'on affiche déjà des
      // lignes = hoquet serveur. On conserve l'affichage courant, on ne
      // réécrit rien et on ne re-rend pas à vide.
      if (!lignes.length && state.allRows.length) {
        console.warn("Réponse matchs vide ignorée — lignes actuelles conservées.");
        setStatus("Réponse serveur vide ignorée — données conservées.", "");
        return;
      }
      state.allRows = lignes;
      state._lastLoadTs = Date.now();
      const cacheInfo = window.RT_CACHE_INFO && window.RT_CACHE_INFO.matchs;
      if (cacheInfo && cacheInfo.stale) {
        setStatus(`${state.allRows.length} ligne(s) · actualisation en arrière-plan…`, "");
      } else {
        setStatus(`${state.allRows.length} ligne(s) chargée(s)`, "ok");
      }
      buildQuickFilterSelects_();

      // L'affichage d'abord, et rien entre les deux. Les statistiques serveur
      // sont un supplément : si leur appel échoue, la liste doit rester à
      // l'écran. C'est l'inverse qui se produisait — une erreur dans
      // loadStats() sautait le rendu et laissait la page à zéro match.
      renderAll();

      // Chargements secondaires étalés : on évite 4 appels Apps Script
      // simultanés qui se ralentissent entre eux et retardent l'affichage.
      const _plus = (fn, nom, ms) => setTimeout(() => { try { fn(); } catch (e) { console.warn(nom + " indisponible :", e); } }, ms);
      _plus(loadStats, "Stats serveur", 300);
      _plus(loadPrixCarburant, "Prix carburant", 1200);
      _plus(loadClassements, "Classements FFBB", 2200);
      _plus(loadEnjeux, "Enjeux FFBB", 3500);
      _plus(loadIndispos, "Indispos", 4500);
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

  if (state.allRows && state.allRows.length) {
    setStatus("Serveur momentanément indisponible — les dernières données enregistrées restent affichées.", "error");
    renderAll();
    return;
  }
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
      if (res && res.config && res.config.couts) state.couts = res.config.couts;
      if (res && res.config && Array.isArray(res.config.vehicles)) state.vehicles = res.config.vehicles;
      const p = res && res.config ? Number(res.config.prix_e10_actuel) : 0;
      if (p > 0.5 && p < 4 && p !== state.prixActuel) {
        state.prixActuel = p;
        renderAllSoon_();     // les coûts affichés changent
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
      renderAllSoon_();
    })
    .catch(() => { state.classements = state.classements || []; });
}

/* Enjeu via l'API publique FFBB (calculé par le serveur, en arrière-plan). */
function loadEnjeux() {
  if (state._enjeuxEnCours) return;
  state._enjeuxEnCours = true;
  jsonp("enjeux")
    .then(res => {
      state.enjeux = (res && res.success && res.enjeux && res.enjeux.data) || {};
      if (Object.keys(state.enjeux).length) renderAllSoon_();
    })
    .catch(() => { state.enjeux = state.enjeux || {}; })
    .then(() => { state._enjeuxEnCours = false; });
}

function classementPour_(codeClub, codeCompetition, numeroEquipe) {
  if (!state.classements || !codeClub || !codeCompetition) return null;
  const cc = String(codeCompetition).toUpperCase();
  const candidats = state.classements.filter(r =>
    String(r["Code club"]) === String(codeClub) &&
    String(r["Code compétition"]).toUpperCase() === cc
  );
  if (!candidats.length) return null;
  const numero = String(numeroEquipe || "").replace(/\D/g, "");
  if (numero) return candidats.find(r => String(r["N° équipe"] || "").replace(/\D/g, "") === numero) || null;
  return candidats.length === 1 ? candidats[0] : null;
}

function numeroEquipeDepuisNom_(nom) {
  const m = String(nom || "").trim().match(/\s-\s*(\d+)\s*$/);
  return m ? m[1] : "";
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

/* Ligne telle que le serveur l'a envoyée : sans les champs calculés (_xxx). */
function rawOf_(r) {
  const o = {};
  Object.keys(r).forEach(k => { if (k.charAt(0) !== "_") o[k] = r[k]; });
  return o;
}

function normalizeRows(rows) {
  const out = rows.map(row => {
    const r = { ...row };
    r._date = parseFrDate(get(r, "Date match"));

    /* Bénévolat : le déplacement a bien eu lieu, mais rien n'a été perçu.
       On retient 0 € de recette pour ne pas gonfler les revenus ; le montant
       théorique reste consultable dans _amountTheorique. */
    r._benevole = cleanText(get(r, "Statut paiement")) === "Bénévole";
    r._amountTheorique = toNumber(get(r, "Indemnité totale"));
    r._amount = r._benevole ? 0 : r._amountTheorique;
    const recuVentile = toNumber(get(r, "Reçu recevant")) + toNumber(get(r, "Reçu visiteur"));
    r._recu = recuVentile || toNumber(get(r, "Montant reçu"));
    r._statutPaie = cleanText(get(r, "Statut paiement"));
    if (r._statutPaie === "Reçu" && !r._recu) r._recu = r._amount;
    r._encaisse = r._benevole ? 0 : Math.max(0, Math.min(r._recu, r._amount));
    r._reste = r._benevole ? 0 : Math.max(0, r._amount - r._encaisse);
    r._km = toNumber(get(r, "Km A/R stats"));
    r._kmEff = r._km;   // km à compter (carburant/km parcourus) — ajusté pour les doublés
    r._format = get(r, "Format");
    r._season = normalizeSeason(get(r, "Saison"), r._date);
    r._isActive = !/annul|alerte/i.test(cleanText(get(r, "Statut"))) && r._format !== "Alerte";
    r._isPast = isPastMission(r);
    r._hay = indexRecherche_(r);
    return r;
  });
  appliquerDoubles_(out);
  return out;
}

/* Doublé (02/10/2026) : plusieurs matchs le même jour au même lieu = un
   SEUL trajet A/R au total. Le km A/R est donc réparti à parts égales entre
   les matchs du groupe (2 matchs → moitié chacun : aller sur l'un, retour
   sur l'autre). Seul le COÛT (carburant + km parcourus) est réparti via
   _kmEff ; _km garde la distance brute et l'indemnité de chaque match reste
   entière. Non destructif, 100 % côté client. */
function appliquerDoubles_(rows) {
  const groupes = {};
  rows.forEach(r => {
    if (!r._isActive || r._format === "Alerte" || !r._date) return;
    const lieu = lieuDouble_(r);
    if (!lieu) return;
    const cle = ymd_(r._date) + "|" + lieu;
    (groupes[cle] = groupes[cle] || []).push(r);
  });
  Object.keys(groupes).forEach(cle => {
    const grp = groupes[cle];
    if (grp.length < 2) return;
    // Le km du trajet n'est souvent renseigné que sur UNE convocation du
    // groupe (les autres ont la case vide). On prend donc le km du GROUPE =
    // le max, puis on le répartit : somme = 1 seul A/R, quel que soit le
    // remplissage des lignes.
    const kmGroupe = Math.max.apply(null, grp.map(r => r._km || 0));
    grp.forEach(r => {
      r._kmEff = kmGroupe / grp.length;
      r._double = { taille: grp.length };
    });
  });
}
/* Lieu normalisé pour détecter un doublé : salle en priorité, sinon adresse,
   sinon ville. */
function lieuDouble_(r) {
  const base = cleanText(get(r, "Salle")) || cleanText(get(r, "Adresse")) || cleanText(get(r, "Ville"));
  return base ? normaliserRecherche(base) : "";
}
function ymd_(d) {
  return d ? (d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()) : "";
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

/* Bloc 7 (28/09/2026) — Onglet IA Règlement : Q&A sur le corpus FIBA.
   Chat simple ; chaque question part au backend reglement.ask (Gemini). */
const REGL_LS_KEY = "rt-reglement-hist-v1";
function reglHistLoad_() {
  if (!state._reglementHist) {
    try { state._reglementHist = JSON.parse(localStorage.getItem(REGL_LS_KEY) || "[]") || []; } catch (e) { state._reglementHist = []; }
  }
  return state._reglementHist;
}
function reglHistSave_() {
  try { localStorage.setItem(REGL_LS_KEY, JSON.stringify((state._reglementHist || []).slice(-60))); } catch (e) { /* stockage indisponible */ }
}
function renderReglement() {
  const root = document.getElementById("reglement");
  if (!root) return;
  const hist = reglHistLoad_();
  root.innerHTML = `
    <h2 class="section-title">Règlement & situations <span class="count">IA</span>${hist.length ? ` <button type="button" class="small-btn secondary" id="reglClear" style="margin-left:auto">Effacer l'historique</button>` : ""}</h2>
    <div class="regl-chat" id="reglChat">${hist.length ? hist.map(m => `
      <div class="regl-msg regl-${m.role === "user" ? "user" : "ia"}"><div class="regl-bulle">${m.role === "user" ? escapeHtml(m.text) : formatReglementReponse_(m.text) + reglSourcesHtml_(m.sources)}</div></div>`).join("") : `<div class="empty">Aucune question pour l'instant. Exemples : « Un joueur au sol garde le ballon, que siffle-t-on ? » · « Différence entre faute technique et antisportive ? »</div>`}</div>
    <form class="regl-form" id="reglForm">
      <textarea id="reglInput" rows="2" placeholder="Ta question de règlement ou ta situation…"></textarea>
      <button type="submit" class="rt-btn regl-send" id="reglSend">Demander</button>
    </form>
    <div class="regl-status" id="reglStatus" role="status"></div>
    ${renderReglementDocs_()}`;
  attachReglementListeners_(root);
  const chat = document.getElementById("reglChat"); if (chat) chat.scrollTop = chat.scrollHeight;
}

/* Documents lus par l'IA (dossier Drive « Referee Tracker - Corpus »).
   Pour intégrer une nouvelle version du règlement : ajouter / remplacer le
   fichier dans ce dossier, pris en compte dès la question suivante. */
function renderReglementDocs_() {
  if (state._reglDocs === undefined && !state._reglDocsEnCours) {
    state._reglDocsEnCours = true;
    jsonp("reglement.docs").then(res => {
      state._reglDocs = (res && res.success && res.result && res.result.ok) ? res.result : null;
    }).catch(() => { state._reglDocs = null; }).then(() => {
      state._reglDocsEnCours = false;
      if (state.activeTab === "reglement") renderReglement();
    });
    return "";
  }
  const d = state._reglDocs;
  if (!d) return "";
  const body = `<ul class="regl-docs">${d.docs.map(x => `<li><strong>${escapeHtml(x.nom)}</strong> <span class="sub">mis à jour le ${escapeHtml(x.maj)}</span></li>`).join("")}</ul>
    <p class="card-sub">Nouvelle version du règlement ? Remplace ou ajoute le fichier (.txt ou Google Doc) dans <a href="${escapeHtml(safeUrl_(d.dossierUrl))}" target="_blank" rel="noopener">le dossier Drive</a>. Pris en compte à la question suivante, sans mise à jour du site.</p>`;
  return `<div class="regl-corpus"><div class="regl-sources-t">Documents lus par l'IA</div>${body}</div>`;
}

function reglSourcesHtml_(src) {
  if (!src || !src.length) return "";
  return `<div class="regl-sources"><div class="regl-sources-t">Sources</div>${src.map((x, i) => `
    <div class="regl-src-item"><div class="regl-src-doc"><span class="regl-src-n">${i + 1}</span>${x.url ? `<a href="${escapeHtml(safeUrl_(x.url))}" target="_blank" rel="noopener">${escapeHtml(x.doc)}</a>` : escapeHtml(x.doc)}</div>
    <div class="regl-src-txt">${escapeHtml(x.extrait)}</div></div>`).join("")}</div>`;
}

function formatReglementReponse_(txt) {
  let h = escapeHtml(String(txt || ""));
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return h.replace(/\n/g, "<br>");
}

async function askReglement_(question) {
  reglHistLoad_();
  const cle = normaliserRecherche(question);
  const h0 = state._reglementHist;
  // Même question déjà posée : réponse instantanée depuis l'historique.
  for (let i = 0; i < h0.length - 1; i++) {
    if (h0[i].role === "user" && normaliserRecherche(h0[i].text) === cle && h0[i + 1].role === "ia" && h0[i + 1].text.indexOf("⚠") !== 0) {
      h0.push({ role: "user", text: question }, { role: "ia", text: h0[i + 1].text, sources: h0[i + 1].sources });
      reglHistSave_(); renderReglement(); return;
    }
  }
  state._reglementHist.push({ role: "user", text: question });
  reglHistSave_();
  renderReglement();
  const status = document.getElementById("reglStatus");
  if (status) status.textContent = "L'IA cherche dans le règlement… (quelques secondes)";
  const btn = document.getElementById("reglSend"); if (btn) btn.disabled = true;
  try {
    const res = await jsonp("reglement.ask", { question });
    const r = res && res.result;
    if (!res || !res.success || !r || !r.ok) throw new Error((r && r.error) || (res && res.error) || "Erreur inconnue");
    state._reglementHist.push({ role: "ia", text: r.reponse, sources: (r.sources || []).map(x => ({ doc: x.doc, url: x.url, extrait: String(x.extrait || "").slice(0, 900) })) });
  } catch (err) {
    state._reglementHist.push({ role: "ia", text: "⚠ " + (err.message || "Erreur") });
  }
  reglHistSave_();
  renderReglement();
}

function attachReglementListeners_(root) {
  const clr = root.querySelector("#reglClear");
  if (clr) clr.addEventListener("click", () => {
    if (!confirm("Effacer l'historique des conversations ?")) return;
    state._reglementHist = []; reglHistSave_(); renderReglement();
  });
  const form = root.querySelector("#reglForm");
  if (form) form.addEventListener("submit", e => {
    e.preventDefault();
    const ta = document.getElementById("reglInput");
    const q = ta ? ta.value.trim() : "";
    if (!q) return;
    ta.value = "";
    askReglement_(q);
  });
  // Entrée = envoi ; Maj+Entrée = nouvelle ligne (28/09 -> 30/09)
  const ta = root.querySelector("#reglInput");
  if (ta) ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (form) { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true })); }
    }
  });
}

/* Performance (03/10/2026) : on ne redessine QUE l'onglet visible. Les autres
   se redessinent à l'ouverture (setActiveTab → renderTab_). Avant, chaque
   rafraîchissement reconstruisait les 13 onglets d'un coup. */
const TAB_RENDERERS_ = {
  accueil:     [function () { renderAccueil(); },     "Accueil"],
  matchs:      [function () { renderMatchs(); },      "Matchs"],
  troisx3:     [function () { renderTroisx3(); },     "3×3"],
  paiements:   [function () { renderPaiements(); },   "Paiements"],
  stats:       [function () { renderStats(); },       "Statistiques"],
  reglement:   [function () { renderReglement(); },   "Règlement"],
  alertes:     [function () { renderAlertes(); },     "Alertes"],
  export:      [function () { renderExport(); },      "Export"],
  qcm:         [function () { renderQcm(); },         "QCM"],
  progression: [function () { renderProgression(); }, "Progression"],
  contacts:    [function () { renderContacts(); },    "Procédures"],
  elicence:    [function () { renderPersoTab_("elicence", "e-Licence", renderElicencePanel_); }, "e-Licence"],
  indispos:    [function () { renderPersoTab_("indispos", "Indispos", renderIndisposPanel_); }, "Indispos"],
  rapports:    [function () { renderPersoTab_("rapports", "Rapports", renderRapportsPanel_); }, "Rapports"],
  hotel:       [function () { renderHotel(); },       "Hôtel"]
};

/* Un seul grand titre par page : le premier h2 du panneau, les suivants deviennent des sous-titres. */
let _titresId = 0;
function harmoniserTitres_() {
  _titresId = 0;
  document.querySelectorAll(".panel").forEach(p => {
    let premier = true;
    p.querySelectorAll("h2.section-title").forEach(h => {
      if (h.classList.contains("stat-fold-sum")) return;
      if (premier) { h.classList.add("page-title"); h.classList.remove("sub-title"); premier = false; }
      else { h.classList.add("sub-title"); h.classList.remove("page-title"); }
    });
  });
}
(function () {
  const lancer = () => { if (_titresId) return; _titresId = requestAnimationFrame(() => { try { harmoniserTitres_(); } catch (_) {} }); };
  const init = () => { const c = document.querySelector(".content") || document.body; new MutationObserver(lancer).observe(c, { childList: true, subtree: true }); lancer(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

function renderTab_(tab) {
  const e = TAB_RENDERERS_[tab];
  if (!e) return;
  safeRender_(e[0], tab, e[1]);
  if (tab === "stats" && state.statsSubView === "avancee") safeRender_(renderAnalyse, "stats", "Analyse");
  if (tab === "stats" && state.statsSubView === "estimation") safeRender_(renderEstimation, "stats", "Estimation");
}

function renderAll() {
  state.filteredRows = filterRows(state.allRows);
  try { hotelScan_(); } catch (e) { console.warn("Hôtel :", e); }
  renderTab_(state.activeTab || "accueil");
  safeRender_(renderTabBadges_, null, "Badges");
}

/* Regroupe les rendus demandés au même instant (stats, carburant,
   classements arrivent presque ensemble au démarrage). */
let _renderSoonId = 0;
function renderAllSoon_() {
  if (_renderSoonId) return;
  _renderSoonId = requestAnimationFrame(function () { _renderSoonId = 0; renderAll(); });
}

/* Badges de notification sur les onglets Alertes / Paiements (19/09/2026).
   Même logique de filtre que renderAlertes()/paiementEnRetard() pour rester
   cohérent avec le contenu réel des onglets ; masqué (hidden) si le
   compteur est à 0 pour ne pas alourdir la barre de navigation inutile. */
function renderTabBadges_() {
  const rows = state.filteredRows || [];
  const sessEl = document.querySelector(".tabs-foot span:last-child");
  if (sessEl && typeof Session !== "undefined" && Session && Session.email) {
    sessEl.textContent = "Session : " + Session.email;
    sessEl.title = "Tu es connecté avec ce compte. La session reste ouverte tant que tu utilises le site (30 jours d'inactivité maximum).";
  }

  const nbAlertes = alertesSplit_(rows).actives.length;
  const badgeAlertes = document.getElementById("badgeAlertes");
  if (badgeAlertes) {
    badgeAlertes.textContent = nbAlertes > 99 ? "99+" : String(nbAlertes);
    badgeAlertes.hidden = nbAlertes === 0;
  }

  const nbInd = nbAlertesIndispos_();
  const badgeInd = document.getElementById("badgeIndispos");
  if (badgeInd) { badgeInd.textContent = String(nbInd); badgeInd.hidden = nbInd === 0; }

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
  const estBtn = document.getElementById("statsSubEstimationBtn");
  if (estBtn) estBtn.classList.toggle("active", view === "estimation");
  const financier = document.getElementById("statsFinancier");
  const analyse = document.getElementById("statsAnalyse");
  const estim = document.getElementById("statsEstimation");
  if (financier) financier.style.display = view === "overview" ? "" : "none";
  if (analyse) analyse.style.display = view === "avancee" ? "" : "none";
  if (estim) estim.style.display = view === "estimation" ? "" : "none";
  if (view === "avancee") renderAnalyse(); else if (view === "estimation") renderEstimation(); else renderStats();
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

/* Examinateur présent sur le match : champ « Observateur » renseigné, ou un rôle mentionnant examinateur / observateur. */
function isExaminateur_(r) {
  if (cleanText(get(r, "Observateur"))) return true;
  return /examinateur|observateur|[ée]valuateur/i.test([get(r, "Collègue rôle"), get(r, "Collègue nom"), get(r, "Mon rôle")].join(" "));
}
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
    ${upcoming.some(isExaminateur_) ? `<h3 class="section-title exam-title">Examinateur présent <span class="count">${upcoming.filter(isExaminateur_).length}</span></h3>${renderWeekendGroups(upcoming.filter(isExaminateur_), false)}` : ""}
    ${upcoming.filter(r => !isExaminateur_(r)).length ? renderWeekendGroups(upcoming.filter(r => !isExaminateur_(r)), false) : (upcoming.length ? "" : empty(`Aucun match ${label} à venir pour cette saison.`))}
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

/* ---------------- Accueil : coup d'œil rapide (100 % client) ----------------
   Page d'ouverture. Ne fait qu'agréger/filtrer state.allRows — aucun appel
   serveur — donc elle profite directement de la garde anti-perte du cache. */

/* Fenêtre "week-end à venir" : vendredi 00:00 → dimanche 23:59.
   Samedi/dimanche : on reste sur le week-end en cours. */
function fenetreWE_() {
  const now = new Date();
  const j = now.getDay();                     // 0=dim … 6=sam
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let versVendredi = (5 - j + 7) % 7;         // prochain vendredi
  if (j === 6) versVendredi = -1;             // samedi → vendredi de ce WE
  else if (j === 0) versVendredi = -2;        // dimanche → vendredi de ce WE
  start.setDate(start.getDate() + versVendredi);
  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function heureDe_(r) {
  return cleanText(get(r, "Heure/RDV") || get(r, "Heure RDV") || get(r, "Heure") || "");
}

/* Début réel d'un match (date + heure de coup d'envoi) ; sans heure : fin de journée. */
function startDT_(r) {
  if (!r._date) return null;
  const t = parseHeure(heureDe_(r));
  return new Date(r._date.getFullYear(), r._date.getMonth(), r._date.getDate(), t ? t.h : 23, t ? t.m : 59);
}
const DUREE_MATCH_MIN_ = 120;   // un match reste « en cours » 2 h après le coup d'envoi

/* Prochain match = 1er match non terminé (début + 2 h > maintenant), toutes dates.
   Samedi 18h30 puis 20h30 : à 20h30 pile on passe au second. */
function prochainMatch_(actifs) {
  const now = Date.now();
  return actifs
    .filter(r => { const s = startDT_(r); return s && s.getTime() + DUREE_MATCH_MIN_ * 60000 > now; })
    .sort((a, b) => startDT_(a) - startDT_(b))[0] || null;
}

function renderAccueil() {
  const root = document.getElementById("accueil");
  if (!root) return;

  const actifs = state.allRows.filter(r => r._isActive && r._format !== "Alerte");
  const { start, end } = fenetreWE_();

  // Matchs du week-end (5x5 + 3x3), triés par date/heure.
  const weRows = actifs.filter(r => r._date && r._date >= start && r._date <= end).sort(sortByDateAsc);
  const prochain = prochainMatch_(actifs);

  // Compteurs WE (prévisionnel). Carburant : source unique realFuelCostClient.
  const nb = weRows.length;
  const km = weRows.reduce((t, r) => t + (r._kmEff || 0), 0);
  const brut = weRows.reduce((t, r) => t + (r._amount || 0), 0);
  const carburant = weRows.reduce((t, r) => t + realFuelCostClient(r._kmEff, r._date), 0);
  const netEstime = brut - carburant;
  const impayes = state.allRows.filter(paiementEnRetard);
  const totalDu = impayes.reduce((t, r) => t + (r._reste || 0), 0);

  const oppDe = r => (cleanText(get(r, "Recevant")) + " / " + cleanText(get(r, "Visiteur / événement"))).replace(/^ \/ | \/ $/g, "");

  // --- Hero prochain match ---
  const hero = (() => {
    if (!prochain) return `<div class="acc-hero acc-hero--vide">Aucun match à venir.</div>`;
    const r = prochain;
    const uid = escapeHtml(get(r, "UID"));
    const enCours = startDT_(r).getTime() <= Date.now();
    const dateLong = r._date ? (r._date.toLocaleDateString("fr-FR", { weekday: "long" }) + " " + formatDateShort(r._date)) : "";
    const heure = fmtHeure(heureDe_(r));
    const comp = cleanText(get(r, "Libellé compétition") || get(r, "Niveau administratif")) || "";
    const role = cleanText(get(r, "Mon rôle"));
    const salle = cleanText(get(r, "Salle"));
    const ville = cleanText(get(r, "Ville"));
    const addr = cleanText(get(r, "Adresse")) || [salle, ville].filter(Boolean).join(" ");
    const col = cleanText(get(r, "Collègue nom"));
    const telBrut = normalizePhoneFr(get(r, "Collègue téléphone"));
    return `<div class="acc-hero">
      <div class="acc-hero-top"><span class="acc-hero-tag">${enCours ? "En cours" : "Prochain match"}</span><span class="acc-hero-date">${escapeHtml(dateLong)}${heure ? " · " + escapeHtml(heure) : ""}</span></div>
      <div class="acc-hero-match">${escapeHtml(oppDe(r))}</div>
      <div class="acc-hero-sub">${escapeHtml(comp)}${role ? " · " + escapeHtml(role) : ""}</div>
      <div class="acc-hero-lieu">${escapeHtml(salle || ville || "Lieu à préciser")}${salle && ville ? " · " + escapeHtml(ville) : ""}</div>
      <div class="acc-hero-actions">
        ${addr ? `<a class="action-link gold" href="https://waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes" target="_blank" rel="noopener">Waze</a>` : ""}
        ${telBrut ? `<a class="action-link secondary acc-tel-col" href="tel:${telBrut}">Tél ${escapeHtml(col || "collègue")}</a>` : ""}
        <button type="button" class="action-link secondary acc-vers-match" data-uid="${uid}">Voir le match</button>
      </div>
      <div class="acc-hero-indem">${formatMoney(r._amount)}</div>
    </div>`;
  })();

  // --- 4 chiffres clés : information seule, aucun lien ---
  const compteurs = `
    <div class="acc-kpis">
      <div class="acc-kpi"><span class="acc-kpi-val">${nb}</span><span class="acc-kpi-lbl">match${nb > 1 ? "s" : ""} ce week-end</span></div>
      <div class="acc-kpi"><span class="acc-kpi-val">${formatNumber(km, "")}</span><span class="acc-kpi-lbl">km ce week-end</span></div>
      <div class="acc-kpi acc-kpi--net"><span class="acc-kpi-val">${formatMoney(netEstime)}</span><span class="acc-kpi-lbl">net estimé ce week-end</span></div>
      <div class="acc-kpi"><span class="acc-kpi-val ${totalDu > 0 ? "acc-cost" : ""}">${formatMoney(totalDu)}</span><span class="acc-kpi-lbl">total impayé${impayes.length ? " · " + impayes.length : ""}</span></div>
    </div>`;

  // --- Bandeau de bienvenue compact ---
  const now = new Date();
  const hNow = now.getHours();
  const salut = hNow < 12 ? "Bonjour" : (hNow < 18 ? "Bon après-midi" : "Bonsoir");
  const dateJour = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const bienvenue = `
    <div class="acc-welcome">
      <span class="acc-welcome-hi">${salut}</span>
      <span class="acc-welcome-date">${escapeHtml(dateJour)}</span>
    </div>`;

  // --- Week-end : une carte par jour, matchs dans l'ordre horaire ---
  const parJour = {};
  weRows.forEach(r => { const k = ymd_(r._date); (parJour[k] = parJour[k] || []).push(r); });
  const jours = Object.keys(parJour).map(k => parJour[k]).sort((a, b) => a[0]._date - b[0]._date);
  const nextUid = prochain ? get(prochain, "UID") : "";
  const ligne = r => {
    const uid = get(r, "UID");
    const s = startDT_(r).getTime();
    const fini = s + DUREE_MATCH_MIN_ * 60000 <= Date.now();
    const etat = fini ? "Terminé" : (uid === nextUid ? (s <= Date.now() ? "En cours" : "Prochain") : "À venir");
    const cls = fini ? "is-fini" : (uid === nextUid ? "is-next" : "");
    const comp = cleanText(get(r, "Libellé compétition") || get(r, "Niveau administratif"));
    const lieu = cleanText(get(r, "Ville") || get(r, "Salle"));
    return `<button type="button" class="acc-m ${cls} acc-vers-match" data-uid="${escapeHtml(uid)}">
      <span class="acc-m-h">${escapeHtml(fmtHeure(heureDe_(r)) || "—")}</span>
      <span class="acc-m-body"><strong>${escapeHtml(oppDe(r))}</strong><small>${escapeHtml([comp, lieu].filter(Boolean).join(" · "))}</small></span>
      <span class="acc-m-side"><span class="acc-m-eur">${formatMoney(r._amount)}</span><span class="acc-m-etat">${etat}</span></span>
    </button>`;
  };
  const carteJour = rows => {
    const d = rows[0]._date;
    const titre = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const tot = rows.reduce((t, r) => t + (r._amount || 0), 0);
    return `<div class="acc-day">
      <div class="acc-day-head"><h3>${escapeHtml(titre)}</h3><span>${rows.length} match${rows.length > 1 ? "s" : ""} · ${formatMoney(tot)}</span></div>
      ${rows.map(ligne).join("")}
    </div>`;
  };
  const matchsHtml = jours.length ? `<div class="acc-days">${jours.map(carteJour).join("")}</div>` : empty("Aucun match ce week-end. Repos mérité.");

  // --- Bandeau saison (style tableau de bord) ---
  const saison = state.filteredRows.filter(r => r._isActive && r._format !== "Alerte");
  const aVenir = saison.filter(r => !r._isPast);
  const recuS = saison.reduce((t, r) => t + (r._encaisse || 0), 0);
  const attS = saison.reduce((t, r) => t + (r._reste || 0), 0);
  const saisonHtml = `<div class="acc-season">
    <div class="acc-s"><span class="acc-s-val">${saison.length}</span><span class="acc-s-lbl">Matchs saison</span></div>
    <div class="acc-s"><span class="acc-s-val">${aVenir.length}</span><span class="acc-s-lbl">À venir</span></div>
    <div class="acc-s acc-s--ok"><span class="acc-s-val">${formatMoney(recuS)}</span><span class="acc-s-lbl">Paiements reçus</span></div>
    <div class="acc-s acc-s--att"><span class="acc-s-val">${formatMoney(attS)}</span><span class="acc-s-lbl">En attente</span></div>
  </div>`;
  // --- Prochains matchs (hors week-end en cours) ---
  const idsWE = new Set(weRows.map(r => get(r, "UID")));
  const suivants = aVenir.filter(r => !idsWE.has(get(r, "UID"))).sort(sortByDateAsc).slice(0, 5);
  const suivantsHtml = suivants.length ? `<section class="acc-bloc"><h2 class="section-title">Prochains matchs</h2><div class="acc-days"><div class="acc-day">${suivants.map(r => `<button type="button" class="acc-m acc-m--date acc-vers-match" data-uid="${escapeHtml(get(r, "UID"))}">
      <span class="acc-m-h acc-m-h--date">${escapeHtml(formatDateShort(r._date))}</span>
      <span class="acc-m-body"><strong>${escapeHtml(oppDe(r))}</strong><small>${escapeHtml([cleanText(get(r, "Libellé compétition") || get(r, "Niveau administratif")), cleanText(get(r, "Ville") || get(r, "Salle"))].filter(Boolean).join(" · "))}</small></span>
      <span class="acc-m-side"><span class="acc-m-eur">${formatMoney(r._amount)}</span><span class="acc-m-etat">${escapeHtml(fmtHeure(heureDe_(r)) || "")}</span></span>
    </button>`).join("")}</div></div></section>` : "";

  root.innerHTML = `
    ${bienvenue}
    ${indispoBanner_()}
    ${saisonHtml}
    <div class="acc-grid">
      ${hero}
      ${compteurs}
    </div>
    <div class="acc-cols">
      <section class="acc-bloc">
        <h2 class="section-title">Mes matchs du week-end${nb ? ` <span class="count">${nb}</span>` : ""}</h2>
        ${matchsHtml}
      </section>
      ${suivantsHtml}
    </div>
  `;

  root.querySelectorAll(".acc-vers-match").forEach(b => b.addEventListener("click", () => ouvrirMatch(b.dataset.uid)));
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
  // 03/10/2026 : plus de regroupement par week-end — les matchs se suivent
  // simplement dans l'ordre chronologique (décroissant pour les passés).
  const tries = rows.slice().sort(decroissant ? sortByDateDesc : sortByDateAsc);
  return `<div class="cards">${tries.map(renderMatchCard).join("")}</div>`;
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

/* Repli en chaîne : GitHub Pages est sensible à la casse et aux extensions.
   On essaie le nom connu, puis les variantes courantes, puis la pastille texte. */
function logoSuivant_(img) {
  const c = (img.dataset.cands || "").split("|").filter(Boolean);
  const i = Number(img.dataset.i || 0) + 1;
  if (i < c.length) { img.dataset.i = i; img.src = "img/competitions/" + encodeURIComponent(c[i]); return; }
  const sp = document.createElement("span");
  sp.className = "comp-logo comp-logo--txt";
  sp.textContent = img.dataset.slug || "";
  img.replaceWith(sp);
}

function logoCompetition(row) {
  const slug = slugCompetition(row);
  const alt = cleanText(get(row, "Libellé compétition")) || slug;
  const fichier = LOGOS_DISPONIBLES[slug];
  if (!slug) return "";
  const cands = [];
  if (fichier) cands.push(fichier);
  ["png", "PNG", "webp", "jpg", "jpeg", "svg"].forEach(ext => {
    [slug, slug.toLowerCase()].forEach(n => { const f = n + "." + ext; if (!cands.includes(f)) cands.push(f); });
  });
  return `<img class="comp-logo" src="img/competitions/${encodeURIComponent(cands[0])}"
               alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" data-slug="${escapeHtml(slug)}"
               data-cands="${escapeHtml(cands.join("|"))}" data-i="0"
               loading="lazy" decoding="async" onerror="logoSuivant_(this)">`;
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
  const time = fmtHeure(get(row, "Heure/RDV"));
  const paiement = get(row, "Statut paiement") || "À recevoir";
  const isPaid = paiement === "Reçu";
  const isBenevole = paiement === BENEVOLE;

  const cost = realFuelCostClient(row._kmEff != null ? row._kmEff : row._km, row._date);
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
            ${isExaminateur_(row) ? `<span class="badge badge-examinateur">Examinateur</span>` : ""}
            ${reglement ? `<span class="badge badge-reglement" title="${escapeHtml(reglement)}">⚠ ${escapeHtml(reglement)}</span>` : ""}
            ${format && format !== "3x3" ? badge(format, "gray") : ""}
            ${badge(get(row, "Genre"), get(row, "Genre") === "Féminin" ? "red" : get(row, "Genre") === "Mixte" ? "gold" : "")}
            ${row._isPast ? badge("Passé", "gray") : ""}
            ${renderHotelBadge_(row)}
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
        ${renderHotelPanel_(row)}
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
  const en = state.enjeux && state.enjeux[get(row, "UID")];
  const raisonTxt = (en && en.raison && !(en.rec || en.vis) && niveauRencontre(row) === "france")
    ? `<div class="enjeu-classement"><div class="enjeu-ligne" style="opacity:.7"><em>Classement indisponible : ${escapeHtml(en.raison)}</em></div></div>` : "";
  if (en && (en.rec || en.vis)) {
    const lg = (nom, c) => c ? `<div class="enjeu-ligne"><strong>${escapeHtml(nom)}</strong> — ${c.pos}e/${en.taille} · ${c.pts} pt${c.pts > 1 ? "s" : ""} (${c.j} match${c.j > 1 ? "s" : ""})</div>` : "";
    return `<div class="enjeu-classement">${lg(get(row, "Recevant") || "Recevant", en.rec)}${lg(get(row, "Visiteur / événement") || "Visiteur", en.vis)}${en.enjeu ? `<div class="enjeu-ligne"><em>${escapeHtml(en.enjeu)}</em></div>` : ""}</div>`;
  }
  const codeComp = get(row, "Code compétition");
  const cR = classementPour_(
    get(row, "Code club recevant"), codeComp,
    get(row, "N° équipe recevant") || numeroEquipeDepuisNom_(get(row, "Recevant"))
  );
  const cV = classementPour_(
    get(row, "Code club visiteur"), codeComp,
    get(row, "N° équipe visiteur") || numeroEquipeDepuisNom_(get(row, "Visiteur / événement"))
  );
  if (!cR && !cV) return raisonTxt;

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
  const groupes = [
    ["Rencontre", [
      ["Compétition", get(row, "Libellé compétition"), true],
      ["N° rencontre", get(row, "N° rencontre")], ["Code e-Marque", get(row, "Code e-Marque")],
      ["Recevant", get(row, "Recevant"), true], ["Visiteur / événement", get(row, "Visiteur / événement"), true]
    ]],
    ["Lieu et trajet", [
      ["Salle", get(row, "Salle"), true], ["Adresse", get(row, "Adresse"), true],
      ["Ville", get(row, "Ville")],
      ["KM A/R", row._double
        ? `${formatNumber(row._kmEff, " km")} (doublé : ${formatNumber(Math.round(row._kmEff * row._double.taille), " km")} A/R partagés sur ${row._double.taille} matchs)`
        : (row._km ? formatNumber(row._km, " km") : "")]
    ]],
    ["Équipe arbitrale", [
      ["Mon rôle", get(row, "Mon rôle")], ["Collègue", get(row, "Collègue nom"), true],
      ["Tél. collègue", formatPhoneFr(get(row, "Collègue téléphone"))], ["Rôle collègue", get(row, "Collègue rôle")],
      ["Référent 3x3", get(row, "Référent 3x3"), true], ["Observateur", get(row, "Observateur"), true],
      ["Contact collègue", get(row, "Contact collègue")]
    ]],
    ["Points de contrôle", [["Warnings", warningsReels(row).join(" | "), true]]]
  ];

  return groupes.map(([titre, details]) => {
    const visibles = details.filter(([, v]) => v !== "" && v !== null && v !== undefined);
    if (!visibles.length) return "";
    return `<section class="detail-section"><h4>${escapeHtml(titre)}</h4><div class="detail-grid">${visibles.map(([l, v, wide]) => `
      <div class="detail${wide ? " detail--wide" : ""}"><label>${escapeHtml(l)}</label><span>${escapeHtml(String(v))}</span></div>`).join("")}</div></section>`;
  }).join("");
}

/* ---------------- Carte OSM ---------------- */

function renderMapContainer(row, uid) {
  const addr = get(row, "Adresse") || get(row, "Ville");
  if (!addr) return "";
  return `<div class="card-map" id="map-${uid}" data-addr="${escapeHtml(addr)}"></div>`;
}

/* Carte (03/10/2026) : cache de géocodage persistant (localStorage), timeouts,
   retry, messages lisibles, et carte recréée si le DOM a été redessiné. */
const GEO_LS_KEY = "rt-geo-v1";
function mapMsg_(el, txt) {
  if (!el) return;
  let m = el.querySelector(".card-map-msg");
  if (!txt) { if (m) m.remove(); return; }
  if (!m) { m = document.createElement("div"); m.className = "card-map-msg"; el.appendChild(m); }
  m.textContent = txt;
}
function geoCacheGet_(addr) {
  state.geocodeCache = state.geocodeCache || {};
  if (state.geocodeCache[addr]) return state.geocodeCache[addr];
  try {
    const o = JSON.parse(localStorage.getItem(GEO_LS_KEY) || "{}");
    if (o[addr]) { state.geocodeCache[addr] = o[addr]; return o[addr]; }
  } catch (e) { /* stockage indisponible */ }
  return null;
}
function geoCacheSet_(addr, v) {
  state.geocodeCache = state.geocodeCache || {};
  state.geocodeCache[addr] = v;
  try {
    const o = JSON.parse(localStorage.getItem(GEO_LS_KEY) || "{}");
    o[addr] = v; localStorage.setItem(GEO_LS_KEY, JSON.stringify(o));
  } catch (e) { /* stockage indisponible */ }
}
function fetchJsonTimeout_(url, ms) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => { if (ctl) ctl.abort(); }, ms || 8000);
  return fetch(url, { headers: { "Accept": "application/json" }, signal: ctl ? ctl.signal : undefined })
    .then(r => { clearTimeout(t); if (!r.ok) throw new Error("http " + r.status); return r.json(); })
    .catch(e => { clearTimeout(t); throw e; });
}

function initMapFor(uid, addr) {
  const el = document.getElementById(`map-${uid}`);
  if (!el || typeof L === "undefined") return;
  const ex = state.maps[uid];
  if (ex) {
    // Carte valide seulement si elle est attachée au conteneur ACTUEL
    // (renderAll recrée le DOM : l'ancienne instance resterait blanche).
    let ok = false;
    try { ok = ex.getContainer() === el && !!el.querySelector(".leaflet-pane"); } catch (e) { ok = false; }
    if (ok) { setTimeout(() => ex.invalidateSize(), 60); return; }
    try { ex.remove(); } catch (e) { /* déjà détruite */ }
    delete state.maps[uid];
  }

  const homeValide = Number(HOME.lat) && Number(HOME.lon);
  const map = L.map(el, { scrollWheelZoom: false }).setView(homeValide ? [HOME.lat, HOME.lon] : [46.6, 2.3], homeValide ? 9 : 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap"
  }).addTo(map);
  if (homeValide) L.marker([HOME.lat, HOME.lon]).addTo(map).bindPopup("Domicile");
  state.maps[uid] = map;
  mapMsg_(el, "Localisation en cours…");

  geocode(addr).then(dest => {
    if (!dest) { mapMsg_(el, "Adresse introuvable sur la carte."); return; }
    mapMsg_(el, "");
    L.marker([dest.lat, dest.lon]).addTo(map).bindPopup("Salle");
    if (!homeValide) { map.setView([dest.lat, dest.lon], 12); return; }
    mapMsg_(el, "Calcul de l'itinéraire…");
    route(HOME, dest).then(r => {
      mapMsg_(el, "");
      if (r && r.geometry) {
        const line = L.geoJSON(r.geometry, { style: { color: "#E4002B", weight: 4, opacity: 0.85 } }).addTo(map);
        map.fitBounds(line.getBounds().pad(0.2));
        const km = Math.round(r.distanceKm * 2);
        L.popup().setLatLng([dest.lat, dest.lon])
          .setContent(`<b>${km} km A/R</b><br>${(km * 0.4).toFixed(2)} € remboursés`).openOn(map);
      } else {
        L.polyline([[HOME.lat, HOME.lon], [dest.lat, dest.lon]], { color: "#E4002B", weight: 3, dashArray: "6 8" }).addTo(map);
        map.fitBounds(L.latLngBounds([[HOME.lat, HOME.lon], [dest.lat, dest.lon]]).pad(0.3));
        mapMsg_(el, "Itinéraire indisponible (ligne droite).");
      }
    });
  });
  setTimeout(() => map.invalidateSize(), 80);
}

function geocode(address) {
  if (!address) return Promise.resolve(null);
  const hit = geoCacheGet_(address);
  if (hit) return Promise.resolve(hit);
  const parts = String(address).split(",").map(x => x.trim()).filter(Boolean);
  const cands = [address];
  if (parts.length > 2) cands.push(parts.slice(-2).join(", "));
  const essai = (q, retry) => fetchJsonTimeout_("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q), 8000)
    .then(d => (d && d.length) ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null)
    .catch(() => retry ? new Promise(r => setTimeout(r, 1200)).then(() => essai(q, false)) : null);
  return cands.reduce((p, q) => p.then(res => res || essai(q, true)), Promise.resolve(null))
    .then(res => { if (res) geoCacheSet_(address, res); return res; });
}

function route(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const essai = retry => fetchJsonTimeout_(url, 10000)
    .then(d => (d.routes && d.routes.length) ? { geometry: d.routes[0].geometry, distanceKm: d.routes[0].distance / 1000 } : null)
    .catch(() => retry ? new Promise(r => setTimeout(r, 1000)).then(() => essai(false)) : null);
  return essai(true);
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
  return date.toLocaleDateString("fr-FR", { weekday: "long" }) + " " + formatDateShort(date); // ex. "samedi 04/10/2026"
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
  const heure = fmtHeure(cleanText(get(row, "Heure/RDV")));
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
  if (address) links.push(`<a class="action-link gold" href="https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes" target="_blank" rel="noopener">Waze</a>`);
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

function paiementRegime_(row) {
  const explicite = cleanText(get(row, "Régime"));
  if (explicite) return explicite;
  if (get(row, "Statut paiement") === BENEVOLE) return "benevole";
  const texte = normaliserRecherche(get(row, "Indemnisé par") + " " + get(row, "Paiement Type"));
  if (texte.includes("parts egales")) return "parts_egales";
  if (texte.includes("association recevante") || texte.includes("paiement club")) return "recevante";
  if (texte.includes("federation")) return "federation";
  if (texte.includes("ligue") || texte.includes("region")) return "region";
  if (texte.includes("departement") || texte.includes("cd67")) return "cd67";
  return "";
}

function paiementPayeur_(regime) {
  return ({ cd67: "CD67", region: "Région", federation: "FFBB" })[regime] || "Organisme payeur";
}

function dateInputValue_(v) {
  const d = parseFrDate(v);
  if (!d) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function paymentStatusClass_(status) {
  if (status === "Reçu") return "is-paid";
  if (status === "Bénévole") return "is-volunteer";
  if (status === "En retard" || status === "À vérifier") return "is-warning";
  return "is-open";
}

function paymentModeOptions_(current) {
  return ["", "Espèces", "Chèque", "Virement"].map(mode =>
    `<option value="${escapeHtml(mode)}"${mode === current ? " selected" : ""}>${escapeHtml(mode || "Mode à choisir…")}</option>`
  ).join("");
}

function renderPaymentClub_(row, cote, visible) {
  if (!visible) return "";
  const suffix = cote === "recevant" ? "recevant" : "visiteur";
  const nom = cote === "recevant" ? (get(row, "Recevant") || "Club recevant") : (get(row, "Visiteur / événement") || "Club visiteur");
  const attendu = toNumber(get(row, `Attendu ${suffix}`));
  const recu = get(row, `Reçu ${suffix}`);
  const mode = get(row, `Mode ${suffix}`);
  const date = get(row, `Date reçu ${suffix}`);
  return `
    <div class="payment-party">
      <div class="payment-party-head"><strong>${escapeHtml(nom)}</strong><span>Attendu ${formatMoney(attendu)}</span></div>
      <div class="payment-fields">
        <label><span>Montant reçu</span><input name="recu_${suffix}" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(recu)}" placeholder="0,00" /></label>
        <label><span>Mode</span><select name="mode_${suffix}">${paymentModeOptions_(mode)}</select></label>
        <label><span>Date reçue</span><input name="date_recu_${suffix}" type="date" value="${escapeHtml(dateInputValue_(date))}" /></label>
      </div>
    </div>`;
}

function renderPaymentControl(row) {
  const uid = escapeHtml(get(row, "UID"));
  const status = get(row, "Statut paiement") || "À recevoir";
  const regime = paiementRegime_(row);
  const total = row._amount || toNumber(get(row, "Indemnité totale"));
  const recuTotal = toNumber(get(row, "Reçu recevant")) + toNumber(get(row, "Reçu visiteur")) || toNumber(get(row, "Montant reçu"));
  const due = get(row, "Date attendue") || get(row, "Date paiement");
  const aTrancher = get(row, "À trancher") === "Oui" || Boolean(get(row, "Raison à trancher"));
  const raison = get(row, "Raison à trancher");
  const note = get(row, "Note paiement");
  const institutionnel = ["cd67", "region", "federation"].includes(regime);
  const club = regime === "parts_egales" || regime === "recevante";
  const overdue = paiementEnRetard(row);

  if (status === BENEVOLE || regime === "benevole") {
    return `
      <section class="payment-panel is-volunteer">
        <div class="payment-panel-head"><div><strong>Paiement</strong><span>Mission marquée bénévole manuellement</span></div><span class="payment-status is-volunteer">Bénévole</span></div>
        <div class="payment-actions"><button type="button" class="small-btn secondary payment-action" data-action="unvolunteer" data-uid="${uid}">Annuler le bénévolat</button></div>
      </section>`;
  }

  return `
    <section class="payment-panel ${paymentStatusClass_(status)}">
      <div class="payment-panel-head">
        <div><strong>Suivi du paiement</strong><span>${escapeHtml(due ? "Échéance : " + due : "Échéance à déterminer")}</span></div>
        <span class="payment-status ${paymentStatusClass_(status)}">${escapeHtml(status)}</span>
      </div>
      ${overdue ? `<div class="payment-warning">Warning : paiement non soldé. Vérification et éventuelle relance à gérer manuellement.</div>` : ""}
      ${aTrancher ? `<div class="payment-decision">À trancher${raison ? " : " + escapeHtml(raison) : ""}</div>` : ""}
      ${institutionnel ? `
        <div class="payment-institution">
          <div><span>Payé par</span><strong>${escapeHtml(paiementPayeur_(regime))}</strong></div>
          <div><span>Montant dû</span><strong>${formatMoney(total)}</strong></div>
          <div><span>Déjà reçu</span><strong>${formatMoney(recuTotal)}</strong></div>
        </div>
        <div class="payment-actions">
          ${status !== "Reçu" ? `<button type="button" class="small-btn payment-action" data-action="received" data-uid="${uid}">Marquer reçu</button>` : ""}
          <button type="button" class="small-btn secondary payment-action" data-action="verify" data-uid="${uid}">Marquer à vérifier</button>
          <button type="button" class="small-btn secondary payment-action" data-action="volunteer" data-uid="${uid}">Marquer bénévole</button>
        </div>` : ""}
      ${club ? `
        <form class="payment-form" data-uid="${uid}">
          ${renderPaymentClub_(row, "recevant", true)}
          ${renderPaymentClub_(row, "visiteur", regime === "parts_egales")}
          ${regime === "parts_egales" ? `<div class="payment-shortcuts"><span>Un seul club a tout payé :</span><button type="button" class="small-btn secondary payment-all" data-side="recevant">Recevant</button><button type="button" class="small-btn secondary payment-all" data-side="visiteur">Visiteur</button></div>` : ""}
          <div class="payment-progress"><span style="width:${Math.min(100, total > 0 ? recuTotal / total * 100 : 0)}%"></span></div>
          <div class="payment-balance"><span>Reçu ${formatMoney(recuTotal)}</span><strong>${recuTotal === total ? "Soldé" : `Reste ${formatMoney(Math.max(0, total - recuTotal))}`}</strong><span>Dû ${formatMoney(total)}</span></div>
          <label class="payment-note"><span>Note</span><input name="note" type="text" value="${escapeHtml(note)}" placeholder="Information utile sur ce règlement" /></label>
          <div class="payment-actions">
            <button type="submit" class="small-btn">Enregistrer le paiement</button>
            <button type="button" class="small-btn secondary payment-action" data-action="verify" data-uid="${uid}">Marquer à vérifier</button>
            <button type="button" class="small-btn secondary payment-action" data-action="volunteer" data-uid="${uid}">Marquer bénévole</button>
          </div>
        </form>` : ""}
      ${!institutionnel && !club ? `
        <div class="payment-decision">Régime de paiement à choisir.</div>
        <form class="payment-regime-form" data-uid="${uid}">
          <select name="regime" aria-label="Régime de paiement">
            <option value="">Choisir le régime…</option>
            <option value="cd67">CD67</option><option value="region">Région</option><option value="federation">FFBB</option>
            <option value="parts_egales">Deux clubs à parts égales</option><option value="recevante">Club recevant</option>
          </select>
          <button type="submit" class="small-btn">Valider</button>
          <button type="button" class="small-btn secondary payment-action" data-action="volunteer" data-uid="${uid}">Marquer bénévole</button>
        </form>` : ""}
      ${renderManualStatus_(uid, get(row, "Statut manuel"))}
    </section>`;
}

/* Contrôle manuel du statut (réintroduit 28/09/2026).
   Auto par défaut ; on peut verrouiller un statut à la main, puis repasser en auto.
   Le bénévolat garde ses propres boutons et n'apparaît pas ici. */
function renderManualStatus_(uid, statutManuel) {
  const opts = ["À recevoir", "Reçu partiel", "Reçu", "En retard", "À vérifier"];
  const cur = String(statutManuel || "").trim();
  return `
    <details class="payment-manuel"${cur ? " open" : ""}>
      <summary>Contrôle manuel du statut${cur ? ` <span class="manual-lock">verrouillé : ${escapeHtml(cur)}</span>` : ""}</summary>
      <div class="payment-manuel-body">
        <select class="manual-status-select" aria-label="Forcer le statut">
          ${opts.map(o => `<option value="${escapeHtml(o)}"${o === cur ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        </select>
        <button type="button" class="small-btn payment-action" data-action="force-status" data-uid="${uid}">Forcer ce statut</button>
        ${cur ? `<button type="button" class="small-btn secondary payment-action" data-action="auto-status" data-uid="${uid}">Repasser en auto</button>` : ""}
      </div>
    </details>`;
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

/* Warnings de paiement : aucune relance n'est envoyée automatiquement.
   L'écran signale seulement les dossiers à traiter manuellement. */
function renderRelance45_(rows) {
  const aRelancer = rows.filter(paiementEnRetard)
    .map(r => {
      const d = parseFrDate(get(r, "Date attendue") || get(r, "Date paiement"));
      return { r, j: d ? Math.max(1, Math.floor((Date.now() - d.getTime()) / 86400000)) : 0 };
    })
    .sort((a, b) => b.j - a.j);
  if (!aRelancer.length) return "";
  const total = aRelancer.reduce((t, x) => t + (x.r._reste || x.r._amount), 0);
  return `
    <div class="relance-box">
      <h2 class="section-title relance-title">Warnings à gérer manuellement <span class="count">${aRelancer.length}</span></h2>
      <div class="relance-sub">${formatMoney(total)} non soldés après l'échéance. Aucune relance n'a été envoyée automatiquement.</div>
      <div class="cards">${aRelancer.map(x => renderMatchCard(x.r)).join("")}</div>
    </div>`;
}

/* ---- Page Paiements : vue du mois et suivi par payeur ----
   Dû = reste à percevoir de chaque mission (hors bénévolat/annulé), classé par échéance
   (« Date attendue ») : en retard (avant ce mois), ce mois-ci, mois suivant, ensuite, sans date.
   Payeur : Ligue / Comité / FFBB / Clubs (mêmes règles que le rapprochement bancaire). */
const PAYEURS_LIB_ = { ligue: "Ligue (LRGEB)", cd: "Comité 67", ffbb: "FFBB", club: "Clubs" };
function moisPaiementsData_() {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), 1), d1 = new Date(now.getFullYear(), now.getMonth() + 1, 1), d2 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const z = () => ({ ret: 0, mois: 0, suiv: 0, plus: 0, sans: 0, nbMois: 0, nbRet: 0, recu: 0, delais: [] });
  const par = { ligue: z(), cd: z(), ffbb: z(), club: z() }, tot = z();
  state.allRows.forEach(r => {
    if (!r._isActive || r._format === "Alerte" || r._benevole) return;
    const c = par[rbClasse_(r)] || par.club;
    const rd = parseFrDate(get(r, "Date reçu recevant") || get(r, "Date reçu visiteur"));
    if (r._encaisse > 0 && state.filteredRows.includes(r)) { c.recu += r._encaisse; tot.recu += r._encaisse; }
    if (rd && r._date) { const j = Math.round((rd - r._date) / 86400000); if (j >= 0 && j < 400) { c.delais.push(j); tot.delais.push(j); } }
    if (!(r._reste > 0)) return;
    const att = parseFrDate(get(r, "Date attendue") || get(r, "Date paiement"));
    [c, tot].forEach(o => {
      if (!att) o.sans += r._reste;
      else if (att < d0) { o.ret += r._reste; o.nbRet++; }
      else if (att < d1) { o.mois += r._reste; o.nbMois++; }
      else if (att < d2) o.suiv += r._reste;
      else o.plus += r._reste;
    });
  });
  return { par, tot, mois: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), fin: new Date(d1 - 86400000) };
}
function renderMoisPaiements_() {
  const m = moisPaiementsData_(), t = m.tot;
  const moy = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) + " j" : "—";
  const lignes = Object.keys(m.par).map(k => { const c = m.par[k]; const du = c.ret + c.mois + c.suiv + c.plus + c.sans; return du || c.recu ? `<tr><td>${PAYEURS_LIB_[k]}</td><td class="num${c.ret ? " mp-ret" : ""}">${c.ret ? formatMoney(c.ret) : "—"}</td><td class="num"><strong>${c.mois ? formatMoney(c.mois) : "—"}</strong></td><td class="num">${c.suiv ? formatMoney(c.suiv) : "—"}</td><td class="num">${(c.plus + c.sans) ? formatMoney(c.plus + c.sans) : "—"}</td><td class="num">${formatMoney(c.recu)}</td><td class="num">${moy(c.delais)}</td></tr>` : ""; }).join("");
  return `
    <div class="kpi-grid mp-kpis">
      <div class="kpi hero"><label>À recevoir en ${escapeHtml(m.mois)}</label><strong>${formatMoney(t.mois)}</strong><span class="sub">${t.nbMois} mission(s) · échéance au plus tard le ${m.fin.toLocaleDateString("fr-FR")}</span></div>
      <div class="kpi${t.ret > 0 ? " kpi-alert" : ""}"><label>En retard (avant ce mois)</label><strong>${formatMoney(t.ret)}</strong><span class="sub">${t.nbRet} mission(s)</span></div>
      <div class="kpi"><label>Mois suivant</label><strong>${formatMoney(t.suiv)}</strong></div>
      <div class="kpi"><label>Plus tard / sans échéance</label><strong>${formatMoney(t.plus + t.sans)}</strong></div>
    </div>
    ${lignes ? `<div class="table-card"><div class="table-wrap"><table class="cf-table mp-table">
      <thead><tr><th>Payeur</th><th>En retard</th><th>Ce mois</th><th>Mois suivant</th><th>Plus tard</th><th>Déjà reçu</th><th>Délai réel</th></tr></thead>
      <tbody>${lignes}</tbody></table></div></div>` : ""}`;
}

function renderPaiements() {
  const root = document.getElementById("paiements");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte" && r._isActive).sort(sortByPaymentThenDate);
  if (!rows.length) { root.innerHTML = empty("Aucun paiement pour cette saison."); return; }

  // Les dossiers en retard figurent déjà dans le bloc « Warnings » : pas de doublon dessous.
  const dejaRelance = new Set(rows.filter(paiementEnRetard).map(r => get(r, "UID")));
  const grouped = groupBy(rows.filter(r => !dejaRelance.has(get(r, "UID"))), r => get(r, "Statut paiement") || "À recevoir");
  const order = ["En retard", "À recevoir", "Reçu partiel", "À vérifier", "Écart à vérifier", "Reçu", BENEVOLE];

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
  const RECENTS_VISIBLES = Infinity;
  // MODIFICATION 19/09/2026 — ce qui est déjà soldé (Reçu, Bénévole) ne
  // doit plus encombrer l'écran : replié par défaut dans un menu déroulant,
  // même en dessous du seuil de 8. Ce qui reste à pointer (À recevoir,
  // Écart/À vérifier) reste affiché en clair comme avant.
  const TOUJOURS_REPLIES = ["Reçu", BENEVOLE];

  root.innerHTML = `
    <h2 class="section-title">Paiements</h2>
    <div class="kpi-grid">
      <div class="kpi"><label>En attente de paiement</label><strong>${formatMoney(totalDu)}</strong></div>
      <div class="kpi"><label>Déjà reçu</label><strong>${formatMoney(totalRecu)}</strong></div>
      ${benevoles.length ? `<div class="kpi"><label>Arbitré bénévolement</label><strong>${benevoles.length}</strong><span class="sub">mission(s), aucune indemnité attendue</span></div>` : ""}
    </div>
    ${renderMoisPaiements_()}
    ${foldable_("Rapprochement bancaire", `<div id="rbZone">${rbHtml_()}</div>`, { open: RB.ouvert || RB.lignes.length > 0 })}
    ${renderRelance45_(rows)}
    ${order.filter(k => grouped[k]).map(status => {
      const liste = grouped[status].slice().sort(sortByDateAsc);
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
  attachRapprochement_(root);
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
  const envoyer = async (params, button) => {
    if (button) button.disabled = true;
    setStatus("Enregistrement du paiement…", "");
    try {
      const res = await jsonp("payment.update", params);
      if (!res || res.success === false) throw new Error((res && res.error) || "Mise à jour refusée");
      // Le serveur renvoie la ligne mise à jour (res.row) : on la remplace
      // sur place, sans retélécharger les ~200 lignes. Ancien backend : repli
      // sur le rechargement complet.
      let patche = false;
      if (res.row && get(res.row, "UID")) {
        const brut = state.allRows.map(rawOf_);
        const i = brut.findIndex(r => get(r, "UID") === get(res.row, "UID"));
        if (i >= 0) {
          brut[i] = res.row;
          state.allRows = normalizeRows(brut);
          patche = true;
          try { if (typeof _cacheEcrire === "function") _cacheEcrire(_cacheKey("matchs", {}), { success: true, data: brut }); } catch (e) {}
        }
      }
      if (!patche) {
        const frais = await jsonpFrais("matchs");
        if (!frais || frais.success === false) throw new Error((frais && frais.error) || "Rafraîchissement impossible");
        const lignesMaj = normalizeRows(frais.data || []);
        // Le paiement est déjà enregistré côté serveur. Si le rafraîchissement
        // revient vide (hoquet), on garde les lignes actuelles au lieu de tout perdre.
        if (lignesMaj.length || !state.allRows.length) state.allRows = lignesMaj;
      }
      state._lastLoadTs = Date.now();
      AN.statsCache = {};
      setStatus("Paiement enregistré", "ok");
      buildQuickFilterSelects_();
      renderAll();
      loadStats(true);
    } catch (err) {
      setStatus("Erreur paiement : " + err.message, "error");
      if (button) button.disabled = false;
    }
  };

  root.querySelectorAll(".payment-action").forEach(button => {
    button.addEventListener("click", () => {
      const uid = button.dataset.uid;
      const action = button.dataset.action;
      const params = { uid };
      if (action === "received") params.marquer_recu = "1";
      if (action === "verify") params.a_verifier = "1";
      if (action === "volunteer") params.benevole = "1";
      if (action === "unvolunteer") params.benevole = "0";
      if (action === "force-status") {
        const sel = button.closest(".payment-manuel").querySelector(".manual-status-select");
        if (!sel || !sel.value) { setStatus("Choisis un statut à forcer", "error"); return; }
        params.forcer_statut = sel.value;
      }
      if (action === "auto-status") params.liberer_statut = "1";
      envoyer(params, button);
    });
  });

  root.querySelectorAll(".payment-all").forEach(button => {
    button.addEventListener("click", () => {
      const form = button.closest(".payment-form");
      const row = state.allRows.find(r => get(r, "UID") === form.dataset.uid);
      if (!row) return;
      const total = toNumber(get(row, "Indemnité totale"));
      const cote = button.dataset.side;
      form.elements.recu_recevant.value = cote === "recevant" ? total.toFixed(2) : "0.00";
      form.elements.recu_visiteur.value = cote === "visiteur" ? total.toFixed(2) : "0.00";
    });
  });

  root.querySelectorAll(".payment-form").forEach(form => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const data = new FormData(form);
      const params = { uid: form.dataset.uid };
      ["recu_recevant", "mode_recevant", "date_recu_recevant", "recu_visiteur", "mode_visiteur", "date_recu_visiteur", "note"]
        .forEach(k => { if (data.has(k)) params[k] = data.get(k); });
      envoyer(params, form.querySelector('button[type="submit"]'));
    });
  });

  root.querySelectorAll(".payment-regime-form").forEach(form => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const regime = form.elements.regime.value;
      if (!regime) { setStatus("Choisis un régime de paiement", "error"); return; }
      envoyer({ uid: form.dataset.uid, regime }, form.querySelector('button[type="submit"]'));
    });
  });
}

/* ===================================================================
   RAPPROCHEMENT BANCAIRE (05/10/2026)
   Import d'un relevé Excel/CSV lu UNIQUEMENT dans le navigateur : rien n'est
   envoyé ni stocké. Seuls les UID des missions validées partent vers le
   serveur (payment.update / marquer_recu), comme le bouton « Marquer reçu ».
   Principe : chaque virement entrant est comparé aux montants restant dus ;
   on cherche 1 mission, ou une somme de 2 à 6 missions (virement groupé),
   dont le total égale le virement (± tolérance). Validation toujours manuelle.
   =================================================================== */
const RB = { brut: [], entete: -1, cols: {}, lignes: [], props: [], tol: 0, fichier: "", msg: "", ouvert: false, busy: false };
const RB_STOP_ = new Set(["basket", "club", "association", "comite", "region", "regional", "regionale", "departemental", "departementale", "championnat", "match", "senior", "seniors", "feminin", "feminine", "masculin", "masculine", "saint", "sainte", "coupe", "U13", "U15", "U18", "U20", "excellence", "pre", "nationale", "region", "poule", "phase", "equipe", "ffbb", "virement", "vir", "sepa", "recu", "inst", "association", "assoc", "frais", "arbitrage", "arbitre", "amical", "faveur", "votre", "remise", "cheque"]);

const RB_IGNORE_ = /salaire|pension|epargne|rachat|assur|\basp\b|agence comptable|inst de|elite basket|\bebc\b|loyer|caf\b|impot|dgfip|remboursement secu|cpam/;
function rbNorm_(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

function rbCents_(v) {
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v == null ? "" : v).replace(/[\s €$]/g, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, "");
  const n = Number(s.replace(/^\+/, ""));
  return isFinite(n) ? Math.round(n * 100) : null;
}

function rbDate_(v) {
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600e3); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12); }
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); return new Date(y, Number(m[2]) - 1, Number(m[1]), 12); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return null;
}

function rbFmtDate_(d) { return d ? d.toLocaleDateString("fr-FR") : "—"; }

function rbCsv_(txt) {
  const sep = ((txt.split("\n")[0] || "").match(/;/g) || []).length >= ((txt.split("\n")[0] || "").match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

function rbChargerXlsx_() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = ok; s.onerror = () => ko(new Error("Lecteur Excel indisponible (réseau). Exporte le relevé en CSV."));
    document.head.appendChild(s);
  });
}

function rbDevinerCols_() {
  const h = (RB.brut[RB.entete] || []).map(rbNorm_);
  const f = re => { const i = h.findIndex(x => re.test(x)); return i >= 0 ? i : -1; };
  RB.cols = {
    date: f(/date/), libelle: f(/libell|intitul|descr|motif|detail|operation|reference/),
    credit: f(/credit/), debit: f(/debit/), montant: f(/montant|amount|somme/)
  };
  if (RB.cols.credit >= 0) RB.cols.montant = -1;
}

function rbExtraire_() {
  const c = RB.cols; const out = []; let ign = 0;
  for (let i = RB.entete + 1; i < RB.brut.length; i++) {
    const r = RB.brut[i];
    const d = c.date >= 0 ? rbDate_(r[c.date]) : null;
    let cents = null;
    if (c.credit >= 0) { cents = rbCents_(r[c.credit]); }
    else if (c.montant >= 0) { cents = rbCents_(r[c.montant]); }
    if (!cents || cents <= 0) continue;                 // seuls les crédits comptent
    const lib = c.libelle >= 0 ? String(r[c.libelle] == null ? "" : r[c.libelle]).trim() : r.filter(x => typeof x === "string" && x.trim() && !rbDate_(x) && rbCents_(x) === null).join(" ");
    const n = rbNorm_(lib);
    if (RB_IGNORE_.test(n) && !/arbitr|\barb\b|frais arb|indemn/.test(n)) { ign++; continue; }   // salaire, épargne, pension…
    out.push({ id: out.length, date: d, libelle: lib, cents, n, words: new Set(n.split(/[^a-z0-9]+/)) });
  }
  RB.ign = ign;
  RB.lignes = out.sort((a, b) => (a.date || 0) - (b.date || 0));
}

/* Qui paie quoi (règles de Clément) :
   Régional → LIGUE (LRGEB) ; Départemental et 3x3 → COMITÉ (CD67) ;
   Championnat de France séniors (NF3) → FFBB ; CF jeunes (U15/U18 France), amical, autre → CLUB. */
function rbClasse_(r) {
  const niv = rbNorm_(get(r, "Niveau administratif")), code = rbNorm_([get(r, "Code compétition"), get(r, "Libellé compétition"), get(r, "Catégorie d'âge")].join(" "));
  if (r._format === "3x3") return "cd";
  const rg = paiementRegime_(r);   // régime déjà lu sur la convocation (« Indemnisé par »)
  if (rg) return { cd67: "cd", region: "ligue", federation: "ffbb" }[rg] || "club";
  if (/departement/.test(niv)) return "cd";
  if (/regional/.test(niv)) return "ligue";
  if (/france/.test(niv)) return /u ?1[0-9]|jeune|cadet|minime/.test(code) && !/nf3|senior/.test(code) ? "club" : "ffbb";
  return "club";
}
const RB_MEM_KEY_ = "rt_rb_payeurs_v1";
function rbMemLire_() { try { return JSON.parse(localStorage.getItem(RB_MEM_KEY_) || "{}") || {}; } catch (e) { return {}; } }
function rbMemEcrire_(m) { try { localStorage.setItem(RB_MEM_KEY_, JSON.stringify(m)); } catch (e) { /* stockage indisponible : sans effet */ } }
/* Clé stable d'un payeur : nom de l'émetteur sans références (VG62…, numéros). Reste dans le navigateur. */
function rbCle_(n) {
  return String(n || "").replace(/virement en votre faveur|remise de cheque|versement d'especes/g, "").replace(/^[\s-]+/, "").split(" - ")[0].split(/\n/)[0]
    .replace(/\b[a-z]*\d[a-z0-9]*\b/g, "").replace(/\s+/g, " ").trim();
}
function rbPayeur_(n) {
  const m = rbMemLire_()[rbCle_(n)];
  if (m && m.cls) return m.cls;
  if (/ligue regionale|lrgeb|grand est/.test(n)) return "ligue";
  if (/comite|bas rhin|\bcd ?67\b/.test(n)) return "cd";
  if (/federation francaise|\bffbb\b/.test(n)) return "ffbb";
  return "";
}
function rbCandidats_() {
  return state.allRows
    .filter(r => r._isActive && r._format !== "Alerte" && !r._benevole && r._reste > 0)
    .map(r => {
      const toks = new Set();
      [get(r, "Recevant"), get(r, "Visiteur / événement"), get(r, "Libellé compétition"), get(r, "Code compétition")].forEach(t =>
        rbNorm_(t).split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 3 && !RB_STOP_.has(w)) toks.add(w); }));
      return { uid: get(r, "UID"), c: Math.round(r._reste * 100), date: r._date, toks: [...toks], niv: rbNorm_(get(r, "Niveau administratif")), cls: rbClasse_(r), att: parseFrDate(get(r, "Date attendue")) };
    })
    .filter(x => x.uid && x.c > 0)
    .sort((a, b) => (a.date || 0) - (b.date || 0));
}

/* Analyse par montant d'un crédit sans correspondance exacte : mission déjà reçue de même
   montant, ou missions les plus proches (écart signé = virement − indemnité due). */
function rbAnalyse_(t, deja, tolC, lv, pris) {
  const dj = deja.find(x => Math.abs(x.c - t.cents) <= tolC);
  if (dj) return { txt: "Montant identique à une mission déjà marquée reçue : " + dj.lib, part: [] };
  const lst = state.allRows.filter(r => r._isActive && r._format !== "Alerte" && !r._benevole && r._amountTheorique > 0 && (!r._date || !t.date || r._date <= t.date) && (!lv || rbClasse_(r) === lv) && !(pris && pris.has(get(r, "UID"))))
    .map(r => {
      const du = Math.round(r._amountTheorique * 100), h = rbTokensRow_(r).filter(w => t.words.has(w) || (t.mtoks || []).includes(w)).length;
      return { r, ecart: t.cents - du, h, ab: Math.abs(t.cents - du) };
    })
    .filter(x => x.h > 0 || x.ab <= Math.max(300, t.cents * 0.15) || (lv && x.ecart < 0 && t.cents >= Math.round(x.r._amountTheorique * 100) * 0.4))
    .sort((a, b) => b.h - a.h || a.ab - b.ab).slice(0, 3);
  if (!lst.length) return { txt: "Aucune mission d'un montant proche.", part: [] };
  const txt = "Missions les plus proches : " + lst.map(x => {
    const nm = [get(x.r, "Recevant"), get(x.r, "Visiteur / événement")].filter(Boolean).join(" / ");
    const e = x.ecart / 100;
    return `${nm} (${rbFmtDate_(x.r._date)}, dû ${money(x.r._amountTheorique)}, ${get(x.r, "Statut paiement") || "À recevoir"}) → écart ${(e > 0 ? "+" : "") + money(e)}${x.ecart > 0 ? " (trop-perçu ?)" : x.ecart < 0 ? " (paiement partiel ?)" : ""}`;
  }).join(" ; ");
  // Paiement partiel proposé : virement inférieur au dû, mission encore à solder
  const part = lst.filter(x => x.ecart < 0 && x.r._reste > 0).map(x => ({ uid: get(x.r, "UID"), nom: [get(x.r, "Recevant"), get(x.r, "Visiteur / événement")].filter(Boolean).join(" / ") }));
  return { txt, part };
}
function rbMode_(n) { return /cheque/.test(n) ? "Chèque" : /especes/.test(n) ? "Espèces" : "Virement"; }
function rbIso_(d) { return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : ""; }
function rbTokensRow_(r) {
  const o = [];
  [get(r, "Recevant"), get(r, "Visiteur / événement"), get(r, "Libellé compétition"), get(r, "Code compétition")].forEach(t =>
    rbNorm_(t).split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 3 && !RB_STOP_.has(w) && !o.includes(w)) o.push(w); }));
  return o;
}

function rbRapprocher_() {
  const tolC = Math.round((Number(RB.tol) || 0) * 100);
  const cands = rbCandidats_();
  const pris = new Set();
  const deja = state.allRows.filter(r => r._isActive && r._encaisse > 0).map(r => ({ c: Math.round(r._encaisse * 100), lib: (get(r, "Recevant") || "") + " / " + (get(r, "Visiteur / événement") || ""), d: r._date }));
  const resoudre = t => {
    t.mtoks = (rbMemLire_()[rbCle_(t.n)] || {}).toks || [];
    const hint = x => x.toks.filter(w => t.words.has(w) || (t.mtoks || []).includes(w)).length;
    let pool = cands.filter(x => !pris.has(x.uid) && (!x.date || !t.date || x.date <= t.date)).map(x => ({ ...x, h: hint(x) }));
    /* Payeur institutionnel reconnu dans le libellé → on ne garde que son niveau de compétition
       (Ligue/LRGEB/Grand Est = Régional ; Comité/CD = Départemental ; FFBB = Championnat de France). */
    const lv = rbPayeur_(t.n);
    const anonyme = /remise de cheque|especes/.test(t.n);   // chèque/espèces : payeur inconnu, toutes classes possibles
    /* STRICT dans tous les sens : Ligue = Régional seulement ; Comité = Départemental + 3x3 ; FFBB = CF séniors ;
       un virement dont l'émetteur n'est pas une institution (club) ne peut payer qu'un match « club ». */
    if (lv) pool = pool.filter(x => x.cls === lv).map(x => ({ ...x, h: x.h + 1 }));
    else if (!anonyme) pool = pool.filter(x => x.cls === "club");
    pool.sort((a, b) => b.h - a.h || (a.date || 0) - (b.date || 0));
    pool = pool.slice(0, 40);
    pool.sort((a, b) => b.c - a.c);
    const rest = new Array(pool.length + 1).fill(0);
    for (let i = pool.length - 1; i >= 0; i--) rest[i] = rest[i + 1] + pool[i].c;
    const sols = []; let noeuds = 0;
    const lo = t.cents - tolC, hi = t.cents + tolC;
    (function dfs(i, somme, pick) {
      if (sols.length >= 30 || noeuds++ > 300000) return;
      if (somme >= lo && somme <= hi && pick.length) { sols.push(pick.slice()); return; }
      if (pick.length >= 6 || i >= pool.length || somme + rest[i] < lo) return;
      for (let j = i; j < pool.length; j++) {
        if (somme + pool[j].c > hi) continue;
        pick.push(pool[j]); dfs(j + 1, somme + pool[j].c, pick); pick.pop();
        if (sols.length >= 30 || noeuds > 300000) return;
      }
    })(0, 0, []);
    const sc = s => ({ items: s, h: s.reduce((a, x) => a + x.h, 0), n: s.length, d: s.reduce((a, x) => a + (x.date ? x.date.getTime() : 0), 0) / s.length,
      e: t.date ? s.reduce((a, x) => a + Math.abs(t.date - (x.att || x.date || t.date)), 0) / s.length : 0 });   // écart à la date attendue
    const alts = sols.map(sc).sort((a, b) => b.h - a.h || a.e - b.e || a.n - b.n || a.d - b.d).slice(0, 5);
    let conf = "aucune";
    if (alts.length) {
      const [a, b] = alts;
      if (alts.length === 1) conf = (a.n === 1 || a.h > 0) ? "haute" : "moyenne";
      else if (a.h > b.h && a.h > 0) conf = "haute";
      else if (a.h > 0 && alts.every(z => z.h === a.h && z.items.map(x => x.c).sort().join() === a.items.map(x => x.c).sort().join())) conf = "haute";   // missions interchangeables (même club, même montant)
      else conf = "ambigu";
      if (conf === "haute" || conf === "moyenne") a.items.forEach(x => pris.add(x.uid));
    }
    const an = alts.length ? { txt: "", part: [] } : rbAnalyse_(t, deja, tolC, lv, pris);
    const note = an.txt;
    if (t.multi && conf === "haute") conf = "moyenne";
    // Match CF jeunes / club : pointé à la main par défaut, jamais pré-coché sans nom de club reconnu.
    if (conf === "haute" && alts[0].items.some(x => x.cls === "club") && !alts[0].items.every(x => x.h > (lv ? 1 : 0))) conf = "moyenne";
    return { t, alts, sel: 0, conf, note, part: an.part, coches: new Set(alts.length && conf === "haute" ? alts[0].items.map(x => x.uid) : []), faits: new Set() };
  };
  RB.props = RB.lignes.map(resoudre);
  /* 2e passe : un règlement coupé en 2 virements/dépôts (ex. 70 € espèces + 2 € ailleurs
     pour une mission de 72 €). On essaie les paires de crédits restés sans correspondance
     à moins de 21 jours ; résultat toujours « à contrôler » (jamais pré-coché). */
  const libres = RB.props.filter(p => !p.alts.length && p.t.date);
  const absorbes = new Set();
  for (let i = 0; i < libres.length; i++) for (let j = i + 1; j < libres.length; j++) {
    const a = libres[i], b = libres[j];
    if (absorbes.has(a) || absorbes.has(b) || Math.abs(a.t.date - b.t.date) > 21 * 86400000) continue;
    const t = { id: "m" + a.t.id + "_" + b.t.id, date: a.t.date > b.t.date ? a.t.date : b.t.date, cents: a.t.cents + b.t.cents, multi: true,
      libelle: a.t.libelle + " + " + b.t.libelle, n: a.t.n + " " + b.t.n, words: new Set([...a.t.words, ...b.t.words]) };
    const m = resoudre(t);
    if (m.alts.length && m.conf !== "ambigu") { absorbes.add(a); absorbes.add(b); RB.props[RB.props.indexOf(a)] = m; }
  }
  RB.props = RB.props.filter(p => !absorbes.has(p));
}

function rbLigneMatch_(uid, coche, fait) {
  const r = state.allRows.find(x => get(x, "UID") === uid);
  if (!r) return `<li class="rb-m">Mission introuvable (${escapeHtml(uid)})</li>`;
  const equipes = [get(r, "Recevant"), get(r, "Visiteur / événement")].filter(Boolean).join(" / ") || get(r, "Libellé compétition") || "Mission";
  return `<li class="rb-m"><label><input type="checkbox" data-rb-uid="${escapeHtml(uid)}"${coche ? " checked" : ""}${fait ? " disabled" : ""}>
    <span class="rb-m-t"><strong>${escapeHtml(equipes)}</strong><small>${escapeHtml(rbFmtDate_(r._date))} · ${escapeHtml(get(r, "Libellé compétition") || "")}</small></span>
    <span class="rb-m-v">${formatMoney(r._reste)}</span></label></li>`;
}

function rbHtmlProp_(p, i) {
  const c = p.conf;
  const lib = { haute: "Correspondance probable", moyenne: p.t.multi ? "Cumul de virements" : "À contrôler", ambigu: "Plusieurs possibilités", aucune: "Aucune correspondance" }[c];
  const valide = p.alts.length && [...p.coches].length && [...p.coches].every(u => p.faits.has(u));
  const alt = p.alts[p.sel];
  const sel = p.alts.length > 1 ? `<select class="rb-alt" data-rb-i="${i}" aria-label="Combinaison">${p.alts.map((a, k) => `<option value="${k}"${k === p.sel ? " selected" : ""}>Combinaison ${k + 1} · ${a.n} mission(s)</option>`).join("")}</select>` : "";
  return `<div class="rb-card rb-${valide ? "ok" : c}" data-rb-card="${i}">
    <div class="rb-head"><span class="rb-d">${escapeHtml(rbFmtDate_(p.t.date))}</span><span class="rb-l" title="${escapeHtml(p.t.libelle)}">${escapeHtml(p.t.libelle || "(sans libellé)")}</span><strong class="rb-v">${formatMoney(p.t.cents / 100)}</strong>
    <span class="rb-b rb-b-${valide ? "ok" : c}">${valide ? "Validé" : lib}</span></div>
    ${alt ? `${sel}<ul class="rb-ms">${alt.items.map(x => rbLigneMatch_(x.uid, p.coches.has(x.uid), p.faits.has(x.uid))).join("")}</ul>` : (p.note ? `<div class="rb-note">${escapeHtml(p.note)}</div>${(p.part || []).map(q => `<button type="button" class="rb-part" data-rb-part="${i}" data-rb-uid2="${escapeHtml(q.uid)}"${p.faits.has(q.uid) ? " disabled" : ""}>${p.faits.has(q.uid) ? "Enregistré" : "Enregistrer " + formatMoney(p.t.cents / 100) + " en paiement partiel — " + escapeHtml(q.nom)}</button>`).join("")}` : "")}
  </div>`;
}

function rbHtml_() {
  const colSel = (k, lab) => {
    const h = RB.brut[RB.entete] || [];
    return `<label class="field rb-f"><span>${lab}</span><select data-rb-col="${k}"><option value="-1">—</option>${h.map((x, j) => `<option value="${j}"${RB.cols[k] === j ? " selected" : ""}>${escapeHtml(String(x || "Col. " + (j + 1)))}</option>`).join("")}</select></label>`;
  };
  const zoneFichier = `
    <p class="rb-aide">Charge l'export Excel/CSV de tes mouvements bancaires. Le fichier est lu dans ton navigateur : rien n'est envoyé ni enregistré. Seules les missions que tu valides sont marquées « Reçu ».</p>
    <div class="rb-bar"><label class="btn rb-file"><input type="file" id="rbFile" accept=".xlsx,.xls,.csv,.txt" hidden>Choisir le relevé</label>
    ${RB.fichier ? `<span class="rb-fn">${escapeHtml(RB.fichier)}</span>` : ""}
    <label class="field rb-f"><span>Tolérance (€)</span><input type="number" id="rbTol" min="0" max="5" step="0.01" value="${escapeHtml(String(RB.tol))}"></label></div>
    ${RB.msg ? `<div class="rb-note">${escapeHtml(RB.msg)}</div>` : ""}`;
  if (!RB.brut.length) return zoneFichier;
  const sel = RB.props.reduce((a, p) => a + [...p.coches].filter(u => !p.faits.has(u)).length, 0);
  const tot = RB.props.reduce((a, p) => a + [...p.coches].filter(u => !p.faits.has(u)).reduce((s, u) => { const r = state.allRows.find(x => get(x, "UID") === u); return s + (r ? r._reste : 0); }, 0), 0);
  const avec = RB.props.filter(p => p.alts.length), sans = RB.props.filter(p => !p.alts.length);
  return `${zoneFichier}
    <div class="rb-cols">${colSel("date", "Date")}${colSel("libelle", "Libellé")}${colSel("credit", "Crédit")}${colSel("montant", "Montant (si pas de colonne Crédit)")}</div>
    <div class="rb-sum"><strong>${RB.lignes.length}</strong> virement(s) entrant(s) · <strong>${avec.length}</strong> rapproché(s) · <strong>${sans.length}</strong> sans correspondance${RB.ign ? ` · ${RB.ign} ignoré(s) (salaire, épargne, pension…)` : ""}</div>
    ${avec.map(p => rbHtmlProp_(p, RB.props.indexOf(p))).join("")}
    ${sans.length ? `<details class="rb-sans"><summary>Sans correspondance (${sans.length})</summary>${sans.map(p => rbHtmlProp_(p, RB.props.indexOf(p))).join("")}</details>` : ""}
    <div class="rb-foot"><button type="button" class="btn rb-go" id="rbValider"${sel && !RB.busy ? "" : " disabled"}>Valider la sélection — ${sel} mission(s), ${formatMoney(tot)}</button></div>`;
}

async function rbValider_(zone) {
  const uids = [...new Set(RB.props.flatMap(p => [...p.coches].filter(u => !p.faits.has(u))))];
  if (!uids.length) return;
  RB.busy = true; const erreurs = [];
  for (let i = 0; i < uids.length; i++) {
    setStatus(`Validation ${i + 1}/${uids.length}…`, "");
    try {
      const pr = RB.props.find(p => p.coches.has(uids[i]));
      const params = { uid: uids[i], marquer_recu: "1" };
      if (pr && pr.t.date) { params.date_recu_recevant = rbIso_(pr.t.date); params.mode_recevant = rbMode_(pr.t.n); }   // date réelle du virement
      const res = await jsonp("payment.update", params);
      if (!res || res.success === false) throw new Error((res && res.error) || "refusé");
      RB.props.forEach(p => { if (p.coches.has(uids[i])) p.faits.add(uids[i]); });
    } catch (e) { erreurs.push(e.message || String(e)); }
  }
  RB.busy = false;
  // Mémoire des payeurs (navigateur uniquement) : libellé validé → classe de payeur + équipes (pour les clubs).
  try {
    const mem = rbMemLire_();
    RB.props.forEach(p => {
      const items = p.alts[p.sel] ? p.alts[p.sel].items.filter(x => p.faits.has(x.uid)) : [];
      const k = rbCle_(p.t.n); const cl = new Set(items.map(x => x.cls));
      if (!items.length || !k || cl.size !== 1 || /^(remise de cheque|espèces|especes)/.test(k)) return;
      const c = [...cl][0];
      mem[k] = { cls: c, toks: c === "club" ? [...new Set(items.flatMap(x => x.toks))].filter(w => p.t.words && p.t.words.has(w)).slice(0, 12) : [] };
    });
    rbMemEcrire_(mem);
  } catch (e) { /* mémoire facultative */ }
  try {
    const frais = await jsonpFrais("matchs");
    if (frais && frais.success !== false && (frais.data || []).length) state.allRows = normalizeRows(frais.data);
  } catch (e) { /* le paiement est déjà enregistré côté serveur */ }
  state._lastLoadTs = Date.now(); AN.statsCache = {};
  setStatus(erreurs.length ? `${uids.length - erreurs.length} validé(s), ${erreurs.length} erreur(s) : ${erreurs[0]}` : `${uids.length} paiement(s) marqué(s) reçu(s)`, erreurs.length ? "error" : "ok");
  RB.ouvert = true; renderAll(); loadStats(true);
}

function attachRapprochement_(root) {
  const zone = root.querySelector("#rbZone"); if (!zone) return;
  const fold = zone.closest("details");
  if (fold) fold.addEventListener("toggle", () => { RB.ouvert = fold.open; });
  const redessiner = () => { const z = document.getElementById("rbZone"); if (z) z.innerHTML = rbHtml_(); };
  zone.addEventListener("change", async e => {
    const t = e.target;
    if (t.id === "rbFile" && t.files && t.files[0]) {
      const f = t.files[0]; RB.msg = ""; RB.fichier = f.name;
      if (f.size > 8e6) { RB.msg = "Fichier trop volumineux (8 Mo max)."; RB.brut = []; redessiner(); return; }
      try {
        if (/\.(csv|txt)$/i.test(f.name)) RB.brut = rbCsv_(await f.text());
        else {
          await rbChargerXlsx_();
          const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
          RB.brut = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
        }
        RB.entete = Math.max(0, RB.brut.slice(0, 30).findIndex(r => r.filter(x => /date|libell|montant|credit|crédit|debit|débit|operation|opération|intitul/i.test(String(x))).length >= 2));
        rbDevinerCols_(); rbExtraire_(); rbRapprocher_();
        if (!RB.lignes.length) RB.msg = "Aucun virement entrant détecté : vérifie les colonnes ci-dessous.";
      } catch (err) { RB.msg = "Lecture impossible : " + err.message; RB.brut = []; RB.props = []; }
      redessiner(); return;
    }
    if (t.id === "rbTol") { RB.tol = Math.min(5, Math.max(0, Number(t.value) || 0)); if (RB.lignes.length) rbRapprocher_(); redessiner(); return; }
    if (t.dataset.rbCol) { RB.cols[t.dataset.rbCol] = Number(t.value); if (t.dataset.rbCol === "credit" && Number(t.value) >= 0) RB.cols.montant = -1; rbExtraire_(); rbRapprocher_(); redessiner(); return; }
    if (t.classList.contains("rb-alt")) { const p = RB.props[Number(t.dataset.rbI)]; p.sel = Number(t.value); p.coches = new Set(p.alts[p.sel].items.map(x => x.uid)); redessiner(); return; }
    if (t.dataset.rbUid) {
      const card = t.closest("[data-rb-card]"); const p = RB.props[Number(card.dataset.rbCard)];
      if (t.checked) p.coches.add(t.dataset.rbUid); else p.coches.delete(t.dataset.rbUid);
      redessiner();
    }
  });
  zone.addEventListener("click", async e => {
    if (e.target.id === "rbValider") { rbValider_(zone); return; }
    const b = e.target.closest("[data-rb-part]"); if (!b) return;
    const p = RB.props[Number(b.dataset.rbPart)], uid = b.dataset.rbUid2;
    const r = state.allRows.find(x => get(x, "UID") === uid); if (!p || !r) return;
    b.disabled = true;
    try {
      const params = { uid, recu_recevant: round2((r._recu || 0) + p.t.cents / 100).toFixed(2), recu_visiteur: "0.00", mode_recevant: rbMode_(p.t.n) };
      if (p.t.date) params.date_recu_recevant = rbIso_(p.t.date);
      const res = await jsonp("payment.update", params);
      if (!res || res.success === false) throw new Error((res && res.error) || "refusé");
      p.faits.add(uid);
      const frais = await jsonpFrais("matchs");
      if (frais && frais.success !== false && (frais.data || []).length) state.allRows = normalizeRows(frais.data);
      AN.statsCache = {}; setStatus("Paiement partiel enregistré", "ok"); RB.ouvert = true; renderAll(); loadStats(true);
    } catch (err) { setStatus("Erreur paiement partiel : " + err.message, "error"); b.disabled = false; }
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
  FOLD_OFF_ = true;
  try { renderStatsInner_(); } finally { FOLD_OFF_ = false; }
}
let FOLD_OFF_ = false;
function renderStatsInner_() {
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

  const kpis = `
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
    </div>`;
  const efficacite = foldable_("Efficacité", `
    <div class="kpi-grid">
      <div class="kpi"><label>€ / km (indemnité)</label><strong>${money(m.eur_par_km)}</strong><span class="sub">0,40 €/km + match</span></div>
      <div class="kpi"><label>€ / heure (net réel)</label><strong>${money(m.eur_par_heure_moyen)}</strong><span class="sub">trajet inclus</span></div>
      <div class="kpi"><label>Coût réel / 100 km</label><strong>${money(m.cout_reel_par_100km)}</strong></div>
      <div class="kpi"><label>KM total A/R</label><strong>${formatNumber(t.km_total_AR, " km")}</strong></div>
      <div class="kpi"><label>Net moyen / mission</label><strong>${money(m.net_reel_par_mission)}</strong></div>
      <div class="kpi"><label>Indemnité moy. 5×5</label><strong>${money(m.indemnite_par_5x5)}</strong></div>
      <div class="kpi"><label>Indemnité moy. 3×3</label><strong>${money(m.indemnite_par_3x3)}</strong></div>
    </div>
    ${s.note_3x3 ? `<div class="stat-note">${escapeHtml(s.note_3x3)}</div>` : ""}`, { open: true });

  const THEMES = [["argent", "Argent"], ["km", "Km et trajets"], ["lieux", "Lieux, clubs, collègues"], ["suivi", "Suivi"]];
  const theme = THEMES.some(x => x[0] === state.statsTheme) ? state.statsTheme : "argent";
  const blocs = {
    argent: `${kpis}
      ${renderCashFlow_(s.cash_flow)}
      ${renderComparaisonN1_(s.comparaison_saison_precedente)}
      ${renderAggTable("Par saison", s.par_saison, "Saison")}
      ${renderAggTable("Par mois", s.par_mois, "Mois")}
      ${renderAggTable("Par niveau", s.par_niveau, "Niveau")}`,
    km: `${efficacite}
      ${renderKmParMois_()}
      ${renderRecords(rec)}`,
    lieux: `${renderTop("Top 3 clubs (5×5)", s.top_clubs)}
      ${renderTop("Top 3 salles (5×5)", s.top_salles)}
      ${renderTop("Top 3 villes", s.top_villes)}
      ${renderTop("Top 3 collègues (5×5)", s.top_collegues)}
      ${renderAggTable("Événements 3×3", s.evenements_3x3, "Événement")}
      ${renderRepartitionRoles()}`,
    suivi: `${renderDoublesStats_()}
      ${renderMatchsAnnules()}
      ${renderFormations()}`
  };
  root.innerHTML = `
    <div class="stats-themes" role="tablist">${THEMES.map(x => `<button type="button" role="tab" class="stats-theme-btn${x[0] === theme ? " active" : ""}" data-stheme="${x[0]}">${x[1]}</button>`).join("")}</div>
    ${blocs[theme]}
  `;
  root.querySelectorAll("[data-stheme]").forEach(btn => btn.addEventListener("click", () => { state.statsTheme = btn.dataset.stheme; renderStats(); }));
  attachFormationsListeners_(root);
}

/* Km, carburant et entretien par mois (calcul local, doublés partagés). */
function renderKmParMois_() {
  const rows = state.filteredRows.filter(r => r._isActive && r._format !== "Alerte" && r._date);
  if (!rows.length) return "";
  const mois = {};
  rows.forEach(r => {
    const k = r._date.getFullYear() + "-" + String(r._date.getMonth() + 1).padStart(2, "0");
    const km = r._kmEff != null ? r._kmEff : (r._km || 0);
    const o = mois[k] = mois[k] || { n: 0, km: 0, carb: 0, ent: 0 };
    o.n++; o.km += km; o.carb += realFuelCostClient(km, r._date); o.ent += km * entretienKmClient_(r._date);
  });
  const cles = Object.keys(mois).sort().reverse();
  const tot = cles.reduce((t, k) => ({ n: t.n + mois[k].n, km: t.km + mois[k].km, carb: t.carb + mois[k].carb, ent: t.ent + mois[k].ent }), { n: 0, km: 0, carb: 0, ent: 0 });
  return `<h2 class="section-title">Km par mois</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Mois</th><th class="num">Matchs</th><th class="num">Km A/R</th><th class="num">Carburant</th><th class="num">Entretien</th></tr></thead>
      <tbody>${cles.map(k => `<tr><td>${k.slice(5)}/${k.slice(0, 4)}</td><td class="num">${mois[k].n}</td><td class="num">${formatNumber(Math.round(mois[k].km), " km")}</td><td class="num">${formatMoney(mois[k].carb)}</td><td class="num">${formatMoney(mois[k].ent)}</td></tr>`).join("")}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${tot.n}</strong></td><td class="num"><strong>${formatNumber(Math.round(tot.km), " km")}</strong></td><td class="num"><strong>${formatMoney(tot.carb)}</strong></td><td class="num"><strong>${formatMoney(tot.ent)}</strong></td></tr></tbody>
    </table></div></div>
    <p class="card-sub">Km réellement parcourus (un doublé ne compte qu'un seul aller-retour). Entretien selon ton enveloppe annuelle de Mon profil.</p>`;
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
  const body = `<div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Format</th><th>Rencontre</th><th>Lieu</th><th>Annulation</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(get(r, "Date match"))}</td>
        <td>${escapeHtml(r._format)}</td>
        <td>${escapeHtml(rencontreLabel(r))}</td>
        <td>${escapeHtml(get(r, "Ville") || get(r, "Salle"))}</td>
        <td>${escapeHtml(get(r, "Warning général") || "—")}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`;
  return foldable_("Matchs annulés", body, { count: rows.length });
}

/* Section STATS repliable (01/10/2026) — <details> natif : titre cliquable
   (summary) + corps masqué par défaut pour désencombrer l'onglet Stats.
   Le <h2 class="section-title"> des tableaux devient le <summary>, même DA. */
function foldable_(title, body, opts) {
  if (!body) return "";
  const o = opts || {};
  if (FOLD_OFF_) {
    const cnt = (o.count !== undefined && o.count !== null && o.count !== "") ? ` <span class="count">${escapeHtml(String(o.count))}</span>` : "";
    return `<h2 class="section-title">${escapeHtml(title)}${cnt}</h2>${body}`;
  }
  const count = (o.count !== undefined && o.count !== null && o.count !== "")
    ? ` <span class="count">${escapeHtml(String(o.count))}</span>` : "";
  return `<details class="stat-fold"${o.open ? " open" : ""}>
    <summary class="section-title stat-fold-sum">${escapeHtml(title)}${count}<svg class="stat-fold-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></summary>
    <div class="stat-fold-body">${body}</div>
  </details>`;
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
  return foldable_("Répartition des rôles (5×5)", `
    <div class="kpi-grid">
      <div class="kpi"><label>1er arbitre (Crew Chief)</label><strong>${n1}</strong><span class="sub">${pct(n1)} % des missions</span></div>
      <div class="kpi"><label>2ème arbitre</label><strong>${n2}</strong><span class="sub">${pct(n2)} % des missions</span></div>
      ${autre ? `<div class="kpi"><label>Rôle non renseigné</label><strong>${autre}</strong></div>` : ""}
    </div>`);
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

  const rows = state.formations.slice().sort((a, b) => {
    const da = parseFrDate(a.date), db = parseFrDate(b.date);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  const parSaison = {};
  rows.forEach(f => {
    const d = parseFrDate(f.date);
    const k = d ? normalizeSeason("", d) : "Sans date";
    const o = parSaison[k] = parSaison[k] || { n: 0, km: 0, c: 0 };
    o.n++; o.km += f.km; o.c += realFuelCostClient(f.km, d);
  });
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
    <div class="table-card" style="margin-bottom:12px"><div class="table-wrap"><table>
      <thead><tr><th>Saison</th><th class="num">Déplacements</th><th class="num">Km A/R</th><th class="num">Carburant</th></tr></thead>
      <tbody>${Object.keys(parSaison).sort().reverse().map(k => `<tr><td>${escapeHtml(k)}</td><td class="num">${parSaison[k].n}</td><td class="num">${formatNumber(parSaison[k].km, "")}</td><td class="num">${formatMoney(parSaison[k].c)}</td></tr>`).join("")}</tbody>
    </table></div></div>
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
        <form id="formationForm" class="toolbar form-formation" style="align-items:end; margin-top:10px">
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
        const [yy, mm, dd] = String(date).split("-");
        state.formations = (state.formations || []).concat([{ date: dd + "/" + mm + "/" + yy, intitule, lieu, km: Number(km) || 0, notes }]);
        renderStats();
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

/* « GES - LIGUE REGIONALE GRAND EST » (extranet FFBB) → libellé lisible. */
function libelleSaisiPar_(v) {
  const t = cleanText(v);
  if (!t) return "—";
  if (/^GES\b/i.test(t) || /GES\s*-\s*LIGUE/i.test(t)) return "Ligue Régionale de Basket GES";
  return t;
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

    <h2 class="section-title">Plan de travail (exams QCM)</h2>
    ${(state.qcmStats && state.qcmStats.faiblesses_top && state.qcmStats.faiblesses_top.length) ? `
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Thème du règlement</th><th class="num">Erreurs cumulées (exams)</th></tr></thead>
      <tbody>${state.qcmStats.faiblesses_top.map(f => `<tr><td>${escapeHtml(f.theme)}</td><td class="num">${f.n}</td></tr>`).join("")}</tbody>
    </table></div></div>
    <p class="card-sub">Classement des thèmes où tu te trompes le plus sur l'ensemble de tes exams. Sert de base de travail avec les axes issus des évaluations.</p>`
    : empty("Passe un exam dans l'onglet QCM : tes thèmes faibles apparaîtront ici.")}

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
      <div class="actions" style="margin-top:10px">
        <button class="small-btn secondary" type="button" id="importAllEvalsBtn">Importer toutes les évals du Drive</button>
      </div>
    </div>

    ${evaluations.length ? `
    <div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Déposé le</th><th>Match lié</th><th>Fichier</th><th>Statut IA</th><th></th></tr></thead>
      <tbody>${evaluations.map(ev => `<tr>
        <td>${escapeHtml(ev.dateDepot)}</td>
        <td>${escapeHtml(ev.rencontre || "Non identifié")}</td>
        <td><a href="${escapeHtml(safeUrl_(ev.lien))}" target="_blank" rel="noopener">${escapeHtml(ev.fichier)}</a></td>
        <td>${escapeHtml(ev.statut || "—")}</td>
        <td><button type="button" class="action-link" data-del-eval-lien="${escapeHtml(ev.lien)}" data-del-eval-fichier="${escapeHtml(ev.fichier)}">Supprimer</button></td>
      </tr>${ev.synthese ? `<tr><td colspan="5" style="padding-top:0">
        <details class="past-block"><summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Voir la synthèse IA</span></span></summary>
        <div class="past-body" style="white-space:pre-wrap; font-size:13px; line-height:1.5">${escapeHtml(ev.synthese)}</div></details>
      </td></tr>` : ""}`).join("")}</tbody>
    </table></div></div>` : ""}

    <h2 class="section-title">Historique du niveau</h2>
    ${niveaux.length ? `
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Type d'officiel</th><th>Niveau</th><th>Couleur</th><th>Début</th><th>Fin</th><th>Groupement</th><th>Saisi par</th><th></th></tr></thead>
      <tbody>${niveaux.map(n => `<tr>
        <td>${escapeHtml(n.typeOfficiel || "—")}</td>
        <td>${escapeHtml(n.niveau || "—")}</td>
        <td>${escapeHtml(n.couleur || "—")}</td>
        <td>${escapeHtml(n.dateDebut || "—")}</td>
        <td>${escapeHtml(n.dateFin || "—")}</td>
        <td>${escapeHtml(n.groupement || "—")}</td>
        <td>${escapeHtml(libelleSaisiPar_(n.saisiPar))}</td>
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

  // Supprimer une évaluation importée (le PDF reste dans le Drive)
  root.querySelectorAll("[data-del-eval-lien]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Retirer cette évaluation du suivi ? (le PDF reste dans le Drive)")) return;
      btn.disabled = true; btn.textContent = "Suppression…";
      try {
        const res = await jsonp("deleteEvaluation", { lien: btn.dataset.delEvalLien, fichier: btn.dataset.delEvalFichier });
        if (!res.success || !res.result || !res.result.ok) throw new Error((res.result && res.result.error) || res.error || "Erreur suppression");
        state.evaluations = null;
        loadEvaluations();
      } catch (err) {
        btn.disabled = false; btn.textContent = "Supprimer";
        setStatus("Erreur : " + err.message, "error");
      }
    });
  });

  // Importer en masse les PDF du dossier Drive d'évaluations
  const importAllBtn = root.querySelector("#importAllEvalsBtn");
  if (importAllBtn) importAllBtn.addEventListener("click", async () => {
    importAllBtn.disabled = true;
    setStatus("Import des évaluations du Drive… (OCR + IA, patiente)", "");
    try {
      const res = await jsonp("importAllEvaluations");
      const r = res && res.result;
      if (!res.success || !r || !r.ok) throw new Error((r && r.error) || res.error || "Erreur import");
      let msg = r.importes + " importée(s), " + r.ignores + " déjà présente(s)";
      if (r.restants) msg += ", " + r.restants + " restante(s) — relance pour continuer";
      if (r.erreurs && r.erreurs.length) msg += " · " + r.erreurs.length + " erreur(s)";
      setStatus(msg, "ok");
      state.evaluations = null;
      loadEvaluations();
    } catch (err) {
      setStatus("Erreur : " + err.message, "error");
    } finally {
      importAllBtn.disabled = false;
    }
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
      rerenderPerso_();
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
      rerenderPerso_();
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

  const vue = state.contactsSubView;
  const btn = (v, id, lib) => `<button type="button" class="tabs-mini-btn${vue === v ? " active" : ""}" id="${id}">${lib}</button>`;
  const panneau = vue === "contacts" ? renderContactsPanel_() : renderProceduresPanel_();
  root.innerHTML = `
    <h2 class="section-title">Procédures &amp; contacts</h2>
    <div class="tabs-mini">
      ${btn("procedures", "contactsSubProceduresBtn", "Procédures")}
      ${btn("contacts", "contactsSubContactsBtn", "Contacts")}
    </div>
    <div id="contactsSubPanel">${panneau}</div>
  `;

  root.querySelector("#contactsSubContactsBtn").addEventListener("click", () => setContactsSubView_("contacts"));
  root.querySelector("#contactsSubProceduresBtn").addEventListener("click", () => setContactsSubView_("procedures"));

  attachContactsPanelListeners_(root);
  attachPersoListeners_(root);
}

function renderChargementErreur_(message, retryId) {
  return `
    <h2 class="section-title">Procédures</h2>
    <div class="table-card" style="padding:16px; text-align:center">
      <p class="card-sub" style="margin:0 0 10px">Impossible de charger cette partie (${escapeHtml(message)}).</p>
      <button type="button" class="small-btn secondary" id="${retryId}">Réessayer</button>
    </div>`;
}


/* Fenêtre de modification générique (engrenage) : champs + Enregistrer, Supprimer tout en bas. */
const ICONE_ENGRENAGE_ = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
function ouvrirModaleEdition_(cfg) {
  const ancien = document.getElementById("rtmDialog"); if (ancien) ancien.remove();
  const ov = document.createElement("div");
  ov.id = "rtmDialog"; ov.className = "rtm-ov";
  const champ = f => {
    const id = "rtm_" + f.id;
    const ctrl = f.type === "textarea" ? `<textarea id="${id}" rows="${f.rows || 5}">${escapeHtml(f.value || "")}</textarea>`
      : f.type === "select" ? `<select id="${id}">${f.options.map(o => `<option${o === f.value ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`
      : `<input id="${id}" type="${f.type || "text"}" value="${escapeHtml(f.value || "")}"${f.required ? " required" : ""} />`;
    return `<div class="field${f.large ? " rtm-large" : ""}"><label for="${id}">${escapeHtml(f.label)}</label>${ctrl}</div>`;
  };
  ov.innerHTML = `<div class="rtm" role="dialog" aria-modal="true" aria-label="${escapeHtml(cfg.titre)}">
    <div class="rtm-head"><h3>${escapeHtml(cfg.titre)}</h3><button type="button" class="rtm-x" aria-label="Fermer">×</button></div>
    <form class="rtm-form">${cfg.champs.map(champ).join("")}
      <div class="rtm-act"><span class="card-sub rtm-msg"></span><button type="submit" class="small-btn">Enregistrer</button></div>
    </form>
    ${cfg.onDelete ? `<div class="rtm-del"><button type="button" class="rtm-delbtn">${escapeHtml(cfg.libSuppr || "Supprimer")}</button></div>` : ""}
  </div>`;
  document.body.appendChild(ov);
  const fermer = () => ov.remove();
  const msg = ov.querySelector(".rtm-msg");
  ov.addEventListener("click", e => { if (e.target === ov) fermer(); });
  ov.querySelector(".rtm-x").addEventListener("click", fermer);
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { fermer(); document.removeEventListener("keydown", esc); } });
  ov.querySelector("form").addEventListener("submit", async e => {
    e.preventDefault();
    const vals = {}; cfg.champs.forEach(f => { vals[f.id] = ov.querySelector("#rtm_" + f.id).value; });
    msg.textContent = "Enregistrement…";
    try { await cfg.onSave(vals); fermer(); } catch (err) { msg.textContent = "Erreur : " + err.message; }
  });
  const d = ov.querySelector(".rtm-delbtn");
  if (d) d.addEventListener("click", async () => {
    if (!confirm(cfg.confirmSuppr || "Supprimer définitivement ?")) return;
    msg.textContent = "Suppression…";
    try { await cfg.onDelete(); fermer(); } catch (err) { msg.textContent = "Erreur : " + err.message; }
  });
  const premier = ov.querySelector("input,textarea,select"); if (premier) premier.focus();
}

const ICONE_INFO_ = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>';
function ouvrirModaleInfo_(titre, html) {
  const ancien = document.getElementById("rtmDialog"); if (ancien) ancien.remove();
  const ov = document.createElement("div");
  ov.id = "rtmDialog"; ov.className = "rtm-ov";
  ov.innerHTML = `<div class="rtm" role="dialog" aria-modal="true" aria-label="${escapeHtml(titre)}">
    <div class="rtm-head"><h3>${escapeHtml(titre)}</h3><button type="button" class="rtm-x" aria-label="Fermer">×</button></div>
    <div class="stat-note">${html}</div></div>`;
  document.body.appendChild(ov);
  const f = () => ov.remove();
  ov.addEventListener("click", e => { if (e.target === ov) f(); });
  ov.querySelector(".rtm-x").addEventListener("click", f);
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { f(); document.removeEventListener("keydown", esc); } });
}

function renderContactsPanel_() {
  const contacts = state.contacts || [];
  const q = normaliserRecherche(state.contactsSearch || "");
  const tri = state.contactsTri || "organisation";
  const filtres = (q
    ? contacts.filter(c => normaliserRecherche([c.nom, c.role, c.organisation, c.telephone, c.email, c.championnat, c.situation, c.notes].filter(Boolean).join(" ")).indexOf(q) >= 0)
    : contacts).slice();
  const cle = c => String(tri === "nom" ? c.nom : tri === "role" ? c.role : tri === "championnat" ? c.championnat : c.organisation || "").trim();
  const cmp = (a, b) => String(cle(a) || "~").localeCompare(String(cle(b) || "~"), "fr", { sensitivity: "base" }) || String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity: "base" });
  filtres.sort(cmp);
  const carte = c => `<article class="ct-card">
      <div class="ct-top"><div><strong class="ct-nom">${escapeHtml(c.nom || "—")}</strong>${c.role ? `<span class="ct-role">${escapeHtml(c.role)}</span>` : ""}</div>
        <button type="button" class="ct-gear" data-edit-contact-id="${c.id}" aria-label="Modifier ${escapeHtml(c.nom || "le contact")}" title="Modifier">${ICONE_ENGRENAGE_}</button></div>
      ${c.organisation ? `<div class="ct-org">${escapeHtml(c.organisation)}</div>` : ""}
      ${c.championnat ? `<span class="badge">${escapeHtml(c.championnat)}</span>` : ""}
      <div class="ct-liens">${c.telephone ? `<a href="tel:${escapeHtml(c.telephone)}">${escapeHtml(c.telephone)}</a>` : ""}${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ""}</div>
      ${c.situation ? `<div class="ct-note"><strong>Quand :</strong> ${escapeHtml(c.situation)}</div>` : ""}
      ${c.notes ? `<div class="ct-note">${escapeHtml(c.notes)}</div>` : ""}
    </article>`;
  let liste = "";
  if (filtres.length) {
    if (tri === "nom") liste = `<div class="ct-grid">${filtres.map(carte).join("")}</div>`;
    else {
      const groupes = [];
      filtres.forEach(c => { const g = String(cle(c) || "Sans " + (tri === "role" ? "rôle" : tri === "championnat" ? "championnat" : "organisation")); const last = groupes[groupes.length - 1]; if (last && last.t === g) last.l.push(c); else groupes.push({ t: g, l: [c] }); });
      liste = groupes.map(g => `<h3 class="ct-group">${escapeHtml(g.t)} <span class="count">${g.l.length}</span></h3><div class="ct-grid">${g.l.map(carte).join("")}</div>`).join("");
    }
  } else liste = empty(q ? "Aucun contact ne correspond à cette recherche." : "Aucun contact enregistré pour l'instant.");

  return `
    <div class="toolbar" style="grid-template-columns: minmax(220px, 360px) 200px; margin-top:12px">
      <div class="field"><label for="contactsSearchInput">Recherche</label><input id="contactsSearchInput" type="text" placeholder="Nom, club, téléphone…" value="${escapeHtml(state.contactsSearch || "")}" /></div>
      <div class="field"><label for="contactsTriSel">Trier par</label><select id="contactsTriSel">${[["organisation", "Organisation"], ["nom", "Nom"], ["role", "Rôle"], ["championnat", "Championnat"]].map(o => `<option value="${o[0]}"${o[0] === tri ? " selected" : ""}>${o[1]}</option>`).join("")}</select></div>
    </div>
    ${liste}

    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter un contact</span></span></summary>
      <div class="past-body">
        <form id="contactForm" class="toolbar" style="grid-template-columns: repeat(3, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="contactNom">Nom</label><input id="contactNom" type="text" required /></div>
          <div class="field"><label for="contactRole">Rôle</label><input id="contactRole" type="text" placeholder="Ex. Répartiteur, CRA, Responsable ligue…" /></div>
          <div class="field"><label for="contactOrganisation">Organisation / Club</label><input id="contactOrganisation" type="text" /></div>
          <div class="field"><label for="contactChampionnat">Championnat / Astreinte</label><input id="contactChampionnat" type="text" placeholder="Ex. Régional, CF Jeunes, Départemental…" /></div>
          <div class="field"><label for="contactSituation">Situation (quand contacter)</label><input id="contactSituation" type="text" placeholder="Ex. Annulation, blessure, litige paiement…" /></div>
          <div class="field"><label for="contactTelephone">Téléphone</label><input id="contactTelephone" type="tel" /></div>
          <div class="field"><label for="contactEmail">Email</label><input id="contactEmail" type="email" /></div>
          <div class="field"><label for="contactNotes">Notes / procédure de contact</label><input id="contactNotes" type="text" /></div>
        </form>
        <div class="actions" style="margin-top:10px"><button class="small-btn secondary" type="submit" form="contactForm">Enregistrer</button></div>
      </div>
    </details>
  `;
}

/* Tri des procédures : Contact d'abord (le plus actionnable en situation),
   puis par catégorie, puis par titre. */
function trierProcedures_(procedures) {
  const ordre = ["Formation", "Observations", "Classement des arbitres", "Contact", "Règlement", "Logistique", "Administratif", "Autre"];
  const rang = c => { const i = ordre.indexOf(c || "Autre"); return i < 0 ? 99 : i; };
  return procedures.slice().sort((a, b) =>
    rang(a.categorie) - rang(b.categorie) || String(a.titre || "").localeCompare(String(b.titre || "")));
}

function mailsDe_(t) { const r = String(t || "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || []; return r.filter((m, i) => r.indexOf(m) === i).slice(0, 3); }
function renderProceduresPanel_() {
  const procedures = state.procedures || [];
  const tri = state.proceduresTri || "categorie";
  const q = normaliserRecherche(state.proceduresSearch || "");
  const liste0 = q ? procedures.filter(p => normaliserRecherche([p.titre, p.categorie, p.contenu].join(" ")).indexOf(q) >= 0) : procedures;
  const item = p => `<div class="pr-item">
      <details class="pr-det"><summary><span class="pr-titre">${escapeHtml(p.titre || "—")}</span>${p.lien ? `<a class="pr-lien" href="${escapeHtml(safeUrl_(p.lien))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Lien</a>` : ""}</summary>
        <div class="pr-corps">${escapeHtml(p.contenu || "—")}</div>${mailsDe_(p.contenu + " " + (p.lien || "")).map(m => `<a class="pr-cta" href="mailto:${escapeHtml(m)}?subject=${encodeURIComponent(p.titre || "")}">Écrire à ${escapeHtml(m)}</a>`).join("")}</details>
      <button type="button" class="ct-gear" data-edit-procedure-id="${p.id}" aria-label="Modifier ${escapeHtml(p.titre || "la procédure")}" title="Modifier">${ICONE_ENGRENAGE_}</button>
    </div>`;
  let corps;
  if (!liste0.length) corps = empty(q ? "Aucune procédure ne correspond." : "Aucune procédure enregistrée pour l'instant.");
  else if (tri === "titre") corps = `<div class="pr-liste">${liste0.slice().sort((a, b) => String(a.titre || "").localeCompare(String(b.titre || ""), "fr", { sensitivity: "base" })).map(item).join("")}</div>`;
  else {
    const groupes = {};
    trierProcedures_(liste0).forEach(p => { const k = p.categorie || "Autre"; (groupes[k] = groupes[k] || []).push(p); });
    corps = Object.keys(groupes).map(k => `<h3 class="ct-group">${escapeHtml(k)} <span class="count">${groupes[k].length}</span></h3><div class="pr-liste">${groupes[k].map(item).join("")}</div>`).join("");
  }
  return `
    <div class="toolbar" style="grid-template-columns: minmax(220px, 360px) 200px; margin-top:12px">
      <div class="field"><label for="procSearchInput">Recherche</label><input id="procSearchInput" type="text" placeholder="Titre, contenu…" value="${escapeHtml(state.proceduresSearch || "")}" /></div>
      <div class="field"><label for="procTriSel">Trier par</label><select id="procTriSel"><option value="categorie"${tri === "categorie" ? " selected" : ""}>Catégorie</option><option value="titre"${tri === "titre" ? " selected" : ""}>Titre</option></select></div>
    </div>
    ${corps}

    <details class="past-block" id="procedureBlock" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title" id="procedureBlockTitre">Ajouter une procédure</span></span></summary>
      <div class="past-body">
        <form id="procedureForm" class="toolbar" style="grid-template-columns: 1fr 1fr; align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="procedureTitre">Titre</label><input id="procedureTitre" type="text" required /></div>
          <div class="field">
            <label for="procedureCategorie">Catégorie</label>
            <select id="procedureCategorie">
              <option value="Formation">Formation</option>
              <option value="Observations">Observations</option>
              <option value="Classement des arbitres">Classement des arbitres</option>
              <option value="Contact">Contact</option>
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

  const rerPanel = () => { const panel = root.querySelector("#contactsSubPanel"); if (panel) { panel.innerHTML = state.contactsSubView === "contacts" ? renderContactsPanel_() : renderProceduresPanel_(); attachContactsPanelListeners_(root); } };
  const triSel = root.querySelector("#contactsTriSel");
  if (triSel) triSel.addEventListener("change", e => { state.contactsTri = e.target.value; rerPanel(); });
  const procSearch = root.querySelector("#procSearchInput");
  if (procSearch) procSearch.addEventListener("input", e => { state.proceduresSearch = e.target.value; rerPanel(); const i = root.querySelector("#procSearchInput"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
  const procTri = root.querySelector("#procTriSel");
  if (procTri) procTri.addEventListener("change", e => { state.proceduresTri = e.target.value; rerPanel(); });
  root.querySelectorAll("[data-edit-contact-id]").forEach(btn => btn.addEventListener("click", () => {
    const c = (state.contacts || []).find(x => String(x.id) === btn.dataset.editContactId);
    if (!c) return;
    ouvrirModaleEdition_({
      titre: "Modifier le contact",
      champs: [
        { id: "nom", label: "Nom", value: c.nom, required: true }, { id: "role", label: "Rôle", value: c.role },
        { id: "organisation", label: "Organisation / Club", value: c.organisation }, { id: "championnat", label: "Championnat / Astreinte", value: c.championnat },
        { id: "situation", label: "Situation (quand contacter)", value: c.situation, large: true }, { id: "telephone", label: "Téléphone", value: c.telephone, type: "tel" },
        { id: "email", label: "Email", value: c.email, type: "email" }, { id: "notes", label: "Notes / procédure de contact", value: c.notes, type: "textarea", rows: 3, large: true }
      ],
      onSave: async v => { const res = await jsonp("updateContact", Object.assign({ id: c.id }, v)); if (!res.success) throw new Error(res.error || "Erreur"); state.contacts = null; loadContacts(); },
      onDelete: async () => { const res = await jsonp("deleteContact", { id: c.id }); if (!res.success) throw new Error(res.error || "Erreur"); state.contacts = null; loadContacts(); },
      libSuppr: "Supprimer ce contact", confirmSuppr: "Supprimer ce contact ?"
    });
  }));

  const contactForm = root.querySelector("#contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", async e => {
      e.preventDefault();
      const payload = {
        nom: document.getElementById("contactNom").value,
        role: document.getElementById("contactRole").value,
        organisation: document.getElementById("contactOrganisation").value,
        championnat: document.getElementById("contactChampionnat").value,
        situation: document.getElementById("contactSituation").value,
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
        const editId = procedureForm.dataset.editId;
        const res = editId ? await jsonp("updateProcedure", Object.assign({ id: editId }, payload)) : await jsonp("addProcedure", payload);
        if (!res.success) throw new Error(res.error || "Erreur enregistrement");
        setStatus("Procédure enregistrée", "ok");
        state.procedures = null;
        loadProcedures();
      } catch (err) {
        setStatus("Erreur : " + err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-edit-procedure-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = (state.procedures || []).find(x => String(x.id) === btn.dataset.editProcedureId);
      if (!p) return;
      ouvrirModaleEdition_({
        titre: "Modifier la procédure",
        champs: [
          { id: "titre", label: "Titre", value: p.titre, required: true, large: true },
          { id: "categorie", label: "Catégorie", value: p.categorie || "Autre", type: "select", options: ["Formation", "Observations", "Classement des arbitres", "Contact", "Règlement", "Logistique", "Administratif", "Autre"] },
          { id: "lien", label: "Lien", value: p.lien, type: "url" },
          { id: "contenu", label: "Contenu", value: p.contenu, type: "textarea", rows: 10, large: true }
        ],
        onSave: async v => { const res = await jsonp("updateProcedure", Object.assign({ id: p.id }, v)); if (!res.success) throw new Error(res.error || "Erreur"); state.procedures = null; loadProcedures(); },
        onDelete: async () => { const res = await jsonp("deleteProcedure", { id: p.id }); if (!res.success) throw new Error(res.error || "Erreur"); state.procedures = null; loadProcedures(); },
        libSuppr: "Supprimer cette procédure", confirmSuppr: "Supprimer cette procédure ?"
      });
    });
  });

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

/* Suivi des doublés (03/10/2026) : plusieurs matchs le même jour au même
   lieu = un seul A/R. Économie = km (et carburant) des trajets évités. */
function renderDoublesStats_() {
  const rows = (state.filteredRows || []).filter(r => r._double && r._isActive && r._date);
  if (!rows.length) return foldable_("Doublés", `<div class="stat-note">Aucun doublé sur la période filtrée.</div>`);
  const groupes = {};
  rows.forEach(r => { const k = ymd_(r._date) + "|" + lieuDouble_(r); (groupes[k] = groupes[k] || []).push(r); });
  const liste = Object.keys(groupes).map(k => {
    const g = groupes[k], n = (g[0]._double && g[0]._double.taille) || g.length, d = g[0]._date;
    const kmTrajet = (g[0]._kmEff || 0) * n;
    const kmEco = kmTrajet * (n - 1);
    return {
      date: d, season: g[0]._season, n,
      lieu: get(g[0], "Salle") || get(g[0], "Ville") || "—",
      kmTrajet, kmEco,
      carbEco: realFuelCostClient(kmEco, d),
      indem: g.reduce((t, r) => t + (r._amount || 0), 0),
      net: g.reduce((t, r) => t + (r._amount || 0), 0) - realFuelCostClient(kmTrajet, d)
    };
  }).sort((a, b) => b.date - a.date);
  const tot = liste.reduce((t, x) => ({ n: t.n + 1, m: t.m + x.n, km: t.km + x.kmEco, c: t.c + x.carbEco, i: t.i + x.indem }), { n: 0, m: 0, km: 0, c: 0, i: 0 });
  const parSaison = {};
  liste.forEach(x => { const o = parSaison[x.season] = parSaison[x.season] || { n: 0, m: 0, km: 0, c: 0 }; o.n++; o.m += x.n; o.km += x.kmEco; o.c += x.carbEco; });
  const body = `
    <div class="kpi-grid">
      <div class="kpi"><label>Doublés</label><strong>${tot.n}</strong><span class="sub">${tot.m} matchs concernés</span></div>
      <div class="kpi"><label>KM économisés</label><strong>${formatNumber(tot.km, " km")}</strong></div>
      <div class="kpi"><label>Carburant économisé</label><strong>${money(tot.c)}</strong></div>
      <div class="kpi"><label>Indemnités des doublés</label><strong>${money(tot.i)}</strong></div>
    </div>
    <div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Saison</th><th class="num">Doublés</th><th class="num">Matchs</th><th class="num">KM éco.</th><th class="num">Carburant éco.</th></tr></thead>
      <tbody>${Object.keys(parSaison).sort().reverse().map(k => `<tr><td>${escapeHtml(k)}</td><td class="num">${parSaison[k].n}</td><td class="num">${parSaison[k].m}</td><td class="num">${formatNumber(parSaison[k].km, "")}</td><td class="num">${money(parSaison[k].c)}</td></tr>`).join("")}</tbody>
    </table></div></div>
    <div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Lieu</th><th class="num">Matchs</th><th class="num">KM A/R trajet</th><th class="num">KM éco.</th><th class="num">Indemnités</th><th class="num">Net</th></tr></thead>
      <tbody>${liste.map(x => `<tr><td>${escapeHtml(x.date.toLocaleDateString("fr-FR"))}</td><td>${escapeHtml(x.lieu)}</td><td class="num">${x.n}</td><td class="num">${formatNumber(x.kmTrajet, "")}</td><td class="num">${formatNumber(x.kmEco, "")}</td><td class="num">${money(x.indem)}</td><td class="num">${money(x.net)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
  return foldable_("Doublés", body, { count: tot.n });
}

function renderRecords(rec) {
  if (!rec) return "";
  const items = [];
  if (rec.plus_gros_deplacement) items.push(["Plus gros déplacement", `${rec.plus_gros_deplacement.km} km — ${rec.plus_gros_deplacement.lieu}`]);
  if (rec.plus_grosse_indemnite) items.push(["Plus grosse indemnité", `${formatMoney(rec.plus_grosse_indemnite.montant)} — ${rec.plus_grosse_indemnite.lieu}`]);
  if (rec.meilleur_net_reel) items.push(["Meilleur net réel", `${formatMoney(rec.meilleur_net_reel.net)} — ${rec.meilleur_net_reel.lieu}`]);
  if (rec.pire_rentabilite_horaire) items.push(["Pire rentabilité horaire", `${money(rec.pire_rentabilite_horaire.eur_heure)}/h — ${rec.pire_rentabilite_horaire.lieu}`]);
  if (!items.length) return "";
  return foldable_("Records", `<div class="kpi-grid">${items.map(([l, v]) =>
    `<div class="kpi"><label>${escapeHtml(l)}</label><strong style="font-size:15px">${escapeHtml(v)}</strong></div>`).join("")}</div>`);
}

function renderAggTable(title, rows, keyLabel) {
  if (!rows || !rows.length) return "";
  const body = `<div class="table-card"><div class="table-wrap"><table>
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
  return foldable_(title, body, { count: rows.length });
}

/* Top 3 uniquement : au-delà, la table encombre plus qu'elle n'informe.
   Le serveur peut renvoyer davantage de lignes (rétrocompatibilité), on
   tronque toujours côté client. */
function renderTop(title, rows) {
  if (!rows || !rows.length) return "";
  const top3 = rows.slice(0, 3);
  const body = `<div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th class="num">Nombre</th><th class="num">Indemnités</th><th class="num">Net réel</th></tr></thead>
      <tbody>${top3.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td><td class="num">${formatMoney(r.indemnite)}</td><td class="num pos">${formatMoney(r.net_reel)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
  return foldable_(title, body);
}

/* Calcul local, sur la saison réellement sélectionnée. Sert quand les
   statistiques serveur manquent ou portent sur une autre période.
   @param {string|null} periodeRecue  la période des stats serveur en mémoire,
                                      si elle ne correspond pas à la sélection. */
function renderStatsClient(periodeRecue) {
  const periode = state.selectedSeason || "Toutes les saisons";
  const rows = state.filteredRows.filter(r => r._isActive && r._format !== "Alerte");

  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._kmEff, r._date), 0);
  const km = rows.reduce((t, r) => t + (r._kmEff || 0), 0);
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

/* ---------------- QCM arbitrage (b5) ----------------
   Deux modes, une question à la fois :
   - Entraînement : pas de chrono, correction immédiate (extrait du règlement
     si faux), pause / retour / abandon. Non enregistré.
   - Exam : 20 questions, 10 min, aucune correction avant la fin ; la
     correction (ma réponse > bonne réponse > règlement) est exportable en
     PDF ; le score et les thèmes ratés alimentent Progression. */

const QCM_DUREE_SEC = 600; // exam : 10 minutes
const QCM_LETTRES = ["A", "B", "C", "D", "E", "F"];

function loadQcmStats() {
  jsonp("qcmStats")
    .then(res => {
      if (res && res.success) {
        state.qcmStats = res.stats;
        if (state.activeTab === "qcm" && !state.qcmSession) renderQcm();
        if (state.activeTab === "progression") renderAllSoon_();
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

function qcmTheme_(q) {
  const t = String(q.sheet || "Divers").trim();
  return t.replace(/^ART\s*/i, "Art. ").replace(/\s+/g, " ");
}
function qcmOk_(q, choisi) {
  const a = (choisi || []).slice().sort(), c = (q.correct || []).slice().sort();
  return a.length === c.length && a.every((v, i) => v === c[i]);
}
function qcmLettres_(q, idxs) {
  return (idxs || []).slice().sort().map(i => QCM_LETTRES[i] + ". " + q.answers[i]).join("  |  ") || "— aucune réponse —";
}
function qcmExtrait_(q, max) {
  const t = String(q.explanation || "").trim();
  if (!t) return "";
  return max && t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

function demarrerSerieQcm(mode) {
  if (!state.qcmBank || !state.qcmBank.length) { setStatus("Banque de questions non chargée, réessaie dans un instant", "error"); return; }
  const exam = mode === "exam";
  state.qcmSession = {
    mode: exam ? "exam" : "train",
    questions: melanger_(state.qcmBank).slice(0, 20),
    reponses: {}, valides: {}, i: 0, pause: false,
    debut: Date.now(),
    fin: exam ? Date.now() + QCM_DUREE_SEC * 1000 : null,
    resultat: null
  };
  if (exam) demarrerTimerQcm_(); else arreterTimerQcm_();
  renderQcm();
}

function demarrerTimerQcm_() {
  arreterTimerQcm_();
  state._qcmTimerId = setInterval(() => {
    const s = state.qcmSession;
    if (!s || s.resultat || !s.fin) { arreterTimerQcm_(); return; }
    const restant = s.fin - Date.now();
    const el = document.getElementById("qcmChrono");
    if (el) el.textContent = formatChronoQcm_(restant);
    if (restant <= 0) { arreterTimerQcm_(); terminerSerieQcm_(true); }
  }, 1000);
}
function arreterTimerQcm_() {
  if (state._qcmTimerId) { clearInterval(state._qcmTimerId); state._qcmTimerId = null; }
}
function formatChronoQcm_(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

async function terminerSerieQcm_(auto) {
  const s = state.qcmSession;
  if (!s || s.resultat) return;
  arreterTimerQcm_();
  let bonnes = 0;
  const faib = {};
  const details = s.questions.map(q => {
    const choisi = (s.reponses[q.id] || []).slice().sort();
    const ok = qcmOk_(q, choisi);
    if (ok) bonnes++; else { const t = qcmTheme_(q); faib[t] = (faib[t] || 0) + 1; }
    return { q, choisi, ok };
  });
  const dureeMin = Math.round(((Date.now() - s.debut) / 60000) * 10) / 10;
  s.resultat = { bonnes, total: s.questions.length, details, auto: Boolean(auto), duree: dureeMin, mode: s.mode };
  renderQcm();
  const estExam = s.mode === "exam";
  try {
    const faiblesses = JSON.stringify(Object.keys(faib).map(k => ({ theme: k, n: faib[k] })));
    const res = await jsonp("addQcmSession", { score: bonnes, total: s.questions.length, duree: dureeMin, mode: estExam ? "exam" : "entrainement", faiblesses });
    if (!res.success) throw new Error(res.error || "Erreur enregistrement");
    setStatus((estExam ? "Exam" : "Entraînement") + " enregistré (" + bonnes + "/" + s.questions.length + ")", "ok");
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
  const pret = !!state.qcmBank;
  root.innerHTML = `
    <h2 class="section-title">QCM arbitrage</h2>
    <div class="qz-modes">
      <div class="qz-mode">
        <h3>Entraînement</h3>
        <p>20 questions, sans chrono. Correction après chaque question avec l'extrait du règlement. Pause, retour et abandon possibles. Enregistré dans l'historique d'entraînement, sans effet sur ta moyenne.</p>
        <button class="small-btn" id="btnQcmTrain"${pret ? "" : " disabled"}>${pret ? "Commencer l'entraînement" : "Chargement…"}</button>
      </div>
      <div class="qz-mode">
        <h3>Exam</h3>
        <p>20 questions, 10 minutes. Aucune correction avant la fin, toutes les questions sont obligatoires. Résultat enregistré et utilisé dans Progression.</p>
        <button class="small-btn" id="btnQcmExam"${pret ? "" : " disabled"}>${pret ? "Lancer l'exam" : "Chargement…"}</button>
      </div>
    </div>

    ${s && s.nb ? `
    <h2 class="section-title">Résultats</h2>
    <div class="kpi-grid">
      <div class="kpi hero"><label>Moyenne</label><strong>${s.moyenne_pct}%</strong><span class="sub">${s.nb} série(s) enregistrée(s)</span></div>
      ${s.meilleur_score ? `<div class="kpi"><label>Meilleur score</label><strong>${s.meilleur_score.score}/${s.meilleur_score.total}</strong><span class="sub">${escapeHtml(s.meilleur_score.date)}</span></div>` : ""}
      ${s.tendance ? `<div class="kpi"><label>Tendance récente</label><strong style="font-size:15px">${escapeHtml(s.tendance)}</strong></div>` : ""}
    </div>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Mode</th><th class="num">Score</th><th class="num">%</th><th class="num">Durée</th><th></th></tr></thead>
      <tbody>${s.sessions.map(r => `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${r.mode === "exam" ? "Exam" : (r.mode === "entrainement" ? "Entraînement" : "Saisie")}</td>
        <td class="num">${r.score}/${r.total}</td>
        <td class="num">${r.pourcentage}%</td>
        <td class="num">${r.duree ? r.duree + " min" : "—"}</td>
        <td>${r.id ? `<button type="button" class="action-link" data-del-qcm="${r.id}">Supprimer</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`
    : (s && !(s.entrainements && s.entrainements.length) ? empty("Aucune série enregistrée pour l'instant.") : "")}
    ${s && s.entrainements && s.entrainements.length ? `
    <h2 class="section-title">Historique d'entraînement <span class="count">${s.entrainements.length}</span></h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="num">Score</th><th class="num">%</th><th class="num">Durée</th><th></th></tr></thead>
      <tbody>${s.entrainements.map(r => `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td class="num">${r.score}/${r.total}</td>
        <td class="num">${r.pourcentage}%</td>
        <td class="num">${r.duree ? r.duree + " min" : "—"}</td>
        <td>${r.id ? `<button type="button" class="action-link" data-del-qcm="${r.id}">Supprimer</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>` : ""}
  `;

  const t = document.getElementById("btnQcmTrain"); if (t) t.addEventListener("click", () => demarrerSerieQcm("train"));
  const e = document.getElementById("btnQcmExam"); if (e) e.addEventListener("click", () => demarrerSerieQcm("exam"));
  root.querySelectorAll("[data-del-qcm]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Supprimer ce résultat ?")) return;
    try {
      const res = await jsonp("deleteQcmSession", { id: btn.dataset.delQcm });
      if (!res.success) throw new Error(res.error || "Erreur suppression");
      state.qcmStats = null; loadQcmStats();
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  }));
}

function renderQcmOptionsHtml_(q, s, verrouille) {
  const choisi = s.reponses[q.id] || [];
  return q.answers.map((a, idx) => {
    const sel = choisi.includes(idx);
    let cls = "qz-opt" + (sel ? " is-selected" : "");
    if (verrouille) {
      cls += " is-locked";
      if ((q.correct || []).includes(idx)) cls += " is-correct";
      else if (sel) cls += " is-wrong";
    }
    return `<label class="${cls}">
      <input type="${q.multiple ? "checkbox" : "radio"}" name="qz-${q.id}" data-idx="${idx}"${sel ? " checked" : ""}${verrouille ? " disabled" : ""} />
      <span class="qz-mark">${QCM_LETTRES[idx] || idx + 1}</span>
      <span class="qz-txt">${escapeHtml(a)}</span>
    </label>`;
  }).join("");
}

function renderQcmSession_(root) {
  const s = state.qcmSession;
  if (s.resultat) { renderQcmCorrection_(root, s); return; }

  const exam = s.mode === "exam";
  const n = s.questions.length;
  const q = s.questions[s.i];
  const valide = !exam && !!s.valides[q.id];
  const ok = valide && qcmOk_(q, s.reponses[q.id]);
  const nbRep = s.questions.filter(x => (s.reponses[x.id] || []).length).length;

  if (s.pause) {
    root.innerHTML = `
      <div class="qz-pause">
        <h2 class="section-title">Série en pause</h2>
        <p class="card-sub">Question ${s.i + 1}/${n} · ${nbRep} répondue(s)</p>
        <div class="actions"><button class="small-btn" id="qzResume">Reprendre</button>
        <button class="small-btn secondary" id="qzQuit">Abandonner la série</button></div>
      </div>`;
    root.querySelector("#qzResume").addEventListener("click", () => { s.pause = false; renderQcm(); });
    root.querySelector("#qzQuit").addEventListener("click", () => { if (confirm("Abandonner la série ? Rien ne sera enregistré.")) quitterSerieQcm(); });
    return;
  }

  const dernier = s.i === n - 1;
  const aRepondu = (s.reponses[q.id] || []).length > 0;
  let btnPrincipal;
  if (exam) btnPrincipal = dernier ? "Terminer l'exam" : "Valider et suivant";
  else btnPrincipal = !valide ? "Valider" : (dernier ? "Voir le résultat" : "Question suivante");

  root.innerHTML = `
    <div class="qz-top">
      <div class="qz-top-l"><strong>${exam ? "Exam" : "Entraînement"}</strong> · Question ${s.i + 1}/${n}
        ${exam ? `<span class="qz-chrono" id="qcmChrono">${formatChronoQcm_(s.fin - Date.now())}</span>` : ""}</div>
      <div class="qz-top-r">
        ${s.i > 0 ? `<button type="button" class="small-btn secondary" id="qzPrev">Précédent</button>` : ""}
        ${!exam ? `<button type="button" class="small-btn secondary" id="qzPause">Pause</button>` : ""}
        <button type="button" class="small-btn secondary" id="qzQuit">${exam ? "Abandonner" : "Quitter"}</button>
      </div>
    </div>
    <div class="qz-bar"><div style="width:${Math.round(((s.i + (valide ? 1 : 0)) / n) * 100)}%"></div></div>

    <div class="qz-q">
      <p class="qz-qtext">${escapeHtml(q.question)}</p>
      ${q.multiple ? `<p class="qz-hint">Plusieurs réponses possibles</p>` : ""}
      <div class="qz-opts">${renderQcmOptionsHtml_(q, s, valide)}</div>
      ${valide ? `<div class="qz-fb ${ok ? "ok" : "ko"}">
        <strong>${ok ? "Correct" : "Faux"}</strong>
        ${ok ? "" : `<div class="qz-fb-line">Bonne réponse : ${escapeHtml(qcmLettres_(q, q.correct))}</div>`}
        ${q.explanation ? `<div class="qz-fb-reg"><span>Règlement</span> ${escapeHtml(qcmExtrait_(q, ok ? 160 : 420))}</div>` : ""}
      </div>` : ""}
    </div>
    <div class="actions qz-actions"><button class="small-btn" id="qzNext"${(!valide && !aRepondu) ? " disabled" : ""}>${btnPrincipal}</button>
      ${exam ? `<span class="qz-count">${nbRep}/${n} répondues</span>` : ""}</div>
  `;

  root.querySelectorAll(".qz-opt input").forEach(inp => inp.addEventListener("change", () => {
    const idx = Number(inp.dataset.idx);
    let cur = (s.reponses[q.id] || []).slice();
    if (q.multiple) cur = inp.checked ? cur.concat(idx) : cur.filter(v => v !== idx);
    else cur = [idx];
    s.reponses[q.id] = cur;
    root.querySelectorAll(".qz-opt").forEach((lbl, k) => lbl.classList.toggle("is-selected", cur.includes(k)));
    const nx = root.querySelector("#qzNext"); if (nx) nx.disabled = cur.length === 0;
    const c = root.querySelector(".qz-count"); if (c) c.textContent = s.questions.filter(x => (s.reponses[x.id] || []).length).length + "/" + n + " répondues";
  }));

  const prev = root.querySelector("#qzPrev"); if (prev) prev.addEventListener("click", () => { s.i = Math.max(0, s.i - 1); renderQcm(); });
  const pz = root.querySelector("#qzPause"); if (pz) pz.addEventListener("click", () => { s.pause = true; renderQcm(); });
  root.querySelector("#qzQuit").addEventListener("click", () => { if (confirm("Abandonner la série ? Rien ne sera enregistré.")) quitterSerieQcm(); });
  root.querySelector("#qzNext").addEventListener("click", () => {
    if (exam) {
      if (!(s.reponses[q.id] || []).length) return;
      if (dernier) {
        const manque = s.questions.filter(x => !(s.reponses[x.id] || []).length).length;
        if (manque) { setStatus(manque + " question(s) sans réponse : réponds à toutes avant de terminer", "error"); return; }
        terminerSerieQcm_(false);
      } else { s.i++; renderQcm(); }
      return;
    }
    if (!valide) { s.valides[q.id] = true; renderQcm(); return; }
    if (dernier) terminerSerieQcm_(false); else { s.i++; renderQcm(); }
  });
}

function renderQcmCorrection_(root, s) {
  const r = s.resultat;
  const pct = Math.round((r.bonnes / r.total) * 100);
  root.innerHTML = `
    <h2 class="section-title">${r.mode === "exam" ? "Exam terminé" : "Entraînement terminé"}${r.auto ? " (temps écoulé)" : ""}</h2>
    <div class="kpi-grid"><div class="kpi hero"><label>Score</label><strong>${r.bonnes}/${r.total}</strong><span class="sub">${pct}% · ${r.duree} min${r.mode === "exam" ? " · enregistré" : " · non enregistré"}</span></div></div>
    <div class="actions" style="margin:12px 0">
      <button class="small-btn" id="qzPdf">Exporter la correction en PDF</button>
      <button class="small-btn secondary" id="qzAgain">Retour au QCM</button>
    </div>
    <div class="qz-corr">${r.details.map((d, i) => `
      <div class="qz-crow ${d.ok ? "ok" : "ko"}">
        <div class="qz-chead"><span class="qz-cnum">${i + 1}</span><span class="qz-ctag">${d.ok ? "Correct" : "Faux"}</span><span class="qz-ctheme">${escapeHtml(qcmTheme_(d.q))}</span></div>
        <p class="qz-qtext">${escapeHtml(d.q.question)}</p>
        <p class="qz-cl"><span>Ma réponse</span>${escapeHtml(qcmLettres_(d.q, d.choisi))}</p>
        <p class="qz-cl"><span>Bonne réponse</span>${escapeHtml(qcmLettres_(d.q, d.q.correct))}</p>
        ${d.q.explanation ? `<p class="qz-cl"><span>Règlement</span>${escapeHtml(qcmExtrait_(d.q, 0))}</p>` : ""}
      </div>`).join("")}</div>`;
  root.querySelector("#qzAgain").addEventListener("click", quitterSerieQcm);
  root.querySelector("#qzPdf").addEventListener("click", () => exporterCorrectionQcmPdf_(r));
}

function exporterCorrectionQcmPdf_(r) {
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) { setStatus("Bibliothèque PDF non chargée — recharge la page (Cmd+Maj+R)", "error"); return; }
  const doc = new J({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 14, LW = W - 2 * M;
  let y = M;
  const saut = h => { if (y + h > 285) { doc.addPage(); y = M; } };
  const para = (txt, taille, gras, rgb, indent) => {
    doc.setFontSize(taille); doc.setFont("helvetica", gras ? "bold" : "normal"); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const lignes = doc.splitTextToSize(String(txt), LW - (indent || 0));
    lignes.forEach(l => { saut(taille * 0.5); doc.text(l, M + (indent || 0), y); y += taille * 0.45; });
  };
  para("Correction QCM arbitrage — " + (r.mode === "exam" ? "Exam" : "Entraînement"), 15, true, [12, 23, 48]); y += 1;
  para("Score : " + r.bonnes + "/" + r.total + " (" + Math.round(r.bonnes / r.total * 100) + "%) · " + r.duree + " min · " + new Date().toLocaleDateString("fr-FR"), 10, false, [90, 100, 120]); y += 4;
  r.details.forEach((d, i) => {
    saut(30);
    para((i + 1) + ". " + (d.ok ? "CORRECT" : "FAUX") + " — " + qcmTheme_(d.q), 9, true, d.ok ? [20, 120, 70] : [190, 40, 40]);
    para(d.q.question, 10, true, [12, 23, 48]); y += 1;
    para("Ma réponse : " + qcmLettres_(d.q, d.choisi), 9, false, [40, 40, 40], 3);
    para("Bonne réponse : " + qcmLettres_(d.q, d.q.correct), 9, false, [20, 120, 70], 3);
    if (d.q.explanation) para("Règlement : " + qcmExtrait_(d.q, 0), 8.5, false, [90, 100, 120], 3);
    y += 4;
  });
  doc.save("correction-qcm-" + new Date().toISOString().slice(0, 10) + ".pdf");
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
  const time = fmtHeure(get(row, "Heure/RDV"));
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

/* Alertes (03/10/2026) : chaque alerte affiche son motif et peut être
   marquée « traitée » (stockage local). Une alerte traitée réapparaît si son
   motif change (ex. nouveau retard, nouveau warning). */
const ALERTES_TRAITEES_KEY = "rt-alertes-traitees-v2";
let ALERTES_MEM_ = null;   // repli si le stockage du navigateur est indisponible (navigation privée, iOS)
function alertesTraitees_() {
  if (ALERTES_MEM_) return ALERTES_MEM_;
  try { return JSON.parse(localStorage.getItem(ALERTES_TRAITEES_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function alertesSetTraitee_(id, sig) {
  const o = Object.assign({}, alertesTraitees_());
  if (sig === null) delete o[id]; else o[id] = sig;
  ALERTES_MEM_ = o;
  try { localStorage.setItem(ALERTES_TRAITEES_KEY, JSON.stringify(o)); } catch (e) { /* mémoire seule */ }
}
/* Signature stable d'une alerte : ne change pas quand seuls des chiffres variables
   (jours, montants affichés) bougent, sinon une alerte « traitée » réapparaissait. */
function sigAlerte_(r) {
  if (r._format === "Alerte" || hasWarningReel(r)) return "W:" + warningsReels(r).join("|").replace(/\d+/g, "#").slice(0, 200);
  if (cleanText(get(r, "Statut paiement")) === "À vérifier") return "V";
  return "R";
}
function idAlerte_(r) {
  return get(r, "UID") || (get(r, "Date match") + "|" + (rencontreLabel(r) || ""));
}
function estAlerte_(r) {
  return (r._format === "Alerte" ||
    hasWarningReel(r) ||
    cleanText(get(r, "Statut paiement")) === "À vérifier" ||
    paiementEnRetard(r)) && !estAlerteParasite_(r);
}
function motifAlerte_(r) {
  if (r._format === "Alerte" || hasWarningReel(r)) {
    const w = warningsReels(r).join(" | ");
    return "Warning : " + (w || "import en alerte, à vérifier dans le Sheet");
  }
  if (cleanText(get(r, "Statut paiement")) === "À vérifier") return "Statut de paiement à vérifier";
  const prevu = get(r, "Date attendue") || get(r, "Date paiement");
  const du = toNumber(get(r, "Indemnité totale"));
  const recu = toNumber(get(r, "Reçu recevant")) + toNumber(get(r, "Reçu visiteur")) || toNumber(get(r, "Montant reçu"));
  return "Paiement en retard" + (prevu ? " (attendu le " + prevu + ")" : "") + " : reçu " + money(recu) + " sur " + money(du);
}
function alertesSplit_(rows) {
  const tr = alertesTraitees_();
  const actives = [], traitees = [];
  (rows || []).forEach(r => {
    if (!estAlerte_(r)) return;
    const id = idAlerte_(r);
    if (tr[id] !== undefined && tr[id] === sigAlerte_(r)) traitees.push(r); else actives.push(r);
  });
  return { actives, traitees };
}

function renderAlertes() {
  const root = document.getElementById("alertes");
  const { actives, traitees } = alertesSplit_(state.filteredRows);
  const base = actives;

  const aCorriger = [], aTrancher = [], enRetard = [];
  base.forEach(r => {
    if (r._format === "Alerte" || hasWarningReel(r)) aCorriger.push(r);
    else if (cleanText(get(r, "Statut paiement")) === "À vérifier") aTrancher.push(r);
    else if (paiementEnRetard(r)) enRetard.push(r);
  });
  const groupes = [
    ["À corriger", "Imports ratés ou warnings de traitement à lever.", aCorriger, "corriger",
      '<path d="M12 3 2 20h20z"/><path d="M12 9v5"/><path d="M12 17h.01"/>'],
    ["Statut à trancher", "Missions dont le paiement reste à qualifier.", aTrancher, "trancher",
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    ["Retard de paiement", "Échéance dépassée : contrôle et éventuelle relance à effectuer manuellement.", enRetard, "retard",
      '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 10v4"/><path d="M12 16h.01"/>']
  ];
  const item = (r, traite) => `<div class="alerte-item">${renderMatchCard(r)}
      <div class="alerte-motif"><span class="alerte-motif-txt">${escapeHtml(motifAlerte_(r))}</span>
      <button type="button" class="small-btn secondary" data-alerte-${traite ? "retablir" : "traitee"}="${escapeHtml(idAlerte_(r))}">${traite ? "Rétablir" : "Marquer traité"}</button></div></div>`;

  const vide = !base.length
    ? empty("Aucune alerte active. Rien à corriger, rien à relancer.") : "";
  root.innerHTML = `
    <h2 class="section-title">Alertes <span class="count">${base.length}</span></h2>
    ${vide}
    ${groupes.filter(g => g[2].length).map(g => `
      <section class="alerte-bloc alerte-bloc--${g[3]}">
        <div class="alerte-bloc-head">
          <span class="alerte-bloc-ic"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${g[4]}</svg></span>
          <h2 class="section-title alerte-groupe">${escapeHtml(g[0])} <span class="count">${g[2].length}</span></h2>
        </div>
        <div class="alerte-groupe-sub">${escapeHtml(g[1])}</div>
        <div class="cards">${g[2].slice().sort(sortByDateAsc).map(r => item(r, false)).join("")}</div>
      </section>
    `).join("")}
    ${traitees.length ? foldable_("Alertes traitées", `<div class="cards">${traitees.slice().sort(sortByDateAsc).map(r => item(r, true)).join("")}</div>`, { count: traitees.length }) : ""}`;
  attachCardListeners(root);
  attachPaymentListeners(root);
  attachContactListeners(root);
  const maj = () => { renderAlertes(); renderTabBadges_(); };
  root.querySelectorAll("[data-alerte-traitee]").forEach(b => b.addEventListener("click", () => {
    const id = b.getAttribute("data-alerte-traitee");
    const r = state.filteredRows.find(x => idAlerte_(x) === id);
    if (r) { alertesSetTraitee_(id, sigAlerte_(r)); maj(); }
  }));
  root.querySelectorAll("[data-alerte-retablir]").forEach(b => b.addEventListener("click", () => {
    alertesSetTraitee_(b.getAttribute("data-alerte-retablir"), null); maj();
  }));
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
const EXPORT_TOUTES = "Toutes les saisons";

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
    .filter(r => state.exportSeason === EXPORT_TOUTES || r._season === state.exportSeason)
    .filter(r => !state.exportMonth || monthKeyOf(r._date) === state.exportMonth)
    .slice()
    .sort(sortByDateAsc);
}

function exportTotals(rows) {
  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._kmEff, r._date), 0);
  return {
    gross, cost, net: gross - cost,
    km: rows.reduce((t, r) => t + (r._kmEff || 0), 0),
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
  return state.exportMonth ? monthLabelOf(state.exportMonth) : (state.exportSeason === EXPORT_TOUTES ? EXPORT_TOUTES : `Saison complète ${state.exportSeason}`);
}

function renderExport() {
  const root = document.getElementById("export");

  // Valeurs par défaut : la saison courante, tous les mois, mode saison.
  const seasons = getSeasonsFrom2022ToCurrent();
  if (!state.exportSeason || (state.exportSeason !== EXPORT_TOUTES && seasons.indexOf(state.exportSeason) === -1)) {
    state.exportSeason = seasons.indexOf(state.selectedSeason) !== -1 ? state.selectedSeason : getCurrentSeason();
  }
  const toutes = state.exportSeason === EXPORT_TOUTES;
  const months = toutes ? [] : monthsOfSeason(state.exportSeason);
  if (toutes || (state.exportMonth && !months.some(m => m.value === state.exportMonth))) state.exportMonth = "";
  if (!state.exportMode) state.exportMode = "season";

  const rng = state.exportMode === "range";
  const rows = exportRows();
  const t = exportTotals(rows);

  root.innerHTML = `
    <h2 class="section-title">Export</h2>

    <section class="toolbar" style="grid-template-columns: 1fr 1fr;">
      <div class="field">
        <label for="exportSeasonSelect">Saison</label>
        <select id="exportSeasonSelect"${rng ? " disabled" : ""}>
          <option value="${EXPORT_TOUTES}"${toutes ? " selected" : ""}>${EXPORT_TOUTES}</option>
          ${seasons.map(s => `<option value="${s}"${s === state.exportSeason ? " selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="exportMonthSelect">Mois</label>
        <select id="exportMonthSelect"${toutes || rng ? " disabled" : ""}>
          <option value="">${toutes ? "Toutes les saisons" : "Toute la saison"}</option>
          ${months.map(m => `<option value="${m.value}"${m.value === state.exportMonth ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
        </select>
      </div>
      <label class="export-check" style="grid-column:1 / -1"><input type="checkbox" id="exportRangeChk"${rng ? " checked" : ""} /> Filtrer par plage de dates</label>
      ${rng ? `<div class="field"><label for="exportFromInput">Du</label><input type="date" id="exportFromInput" value="${state.exportFrom || ""}" /></div>
      <div class="field"><label for="exportToInput">Au</label><input type="date" id="exportToInput" value="${state.exportTo || ""}" /></div>` : ""}
    </section>

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
    </div>

    <div class="table-card" style="padding:14px; margin-top:14px">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap">
        <strong>Carte des salles — nombre de fois arbitré</strong>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button class="small-btn secondary" type="button" id="exportMapBtn"${rows.length ? "" : " disabled"}>Afficher la carte</button>
          <button class="small-btn" type="button" id="exportMapImgBtn" hidden>Exporter la carte en PDF</button>
        </div>
      </div>
      <p class="card-sub" style="margin:6px 0 0">Géocodage un peu lent (respect du quota de l'API OSM gratuite, ~1 salle/seconde) — normal.</p>
      <div id="exportMapStatus" class="map-status" hidden></div>
      <div id="exportMap" style="height:440px; border-radius:12px; margin-top:10px; display:none"></div>
    </div>

    ${rows.length ? `
    <details class="rt-details" style="margin-top:14px">
      <summary>Détail des missions (${rows.length}) — afficher le tableau</summary>
      <div class="table-card" style="margin-top:10px">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Format</th><th>Niveau</th><th>Rencontre</th><th>Lieu</th>
                  <th class="num">Km</th><th class="num">Brut</th><th class="num">Carburant</th><th class="num">Net</th><th>Paiement</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const c = realFuelCostClient(r._kmEff, r._date);
                return `<tr>
                  <td>${escapeHtml(get(r, "Date match"))}</td>
                  <td>${escapeHtml(r._format)}</td>
                  <td>${escapeHtml(get(r, "Niveau administratif"))}</td>
                  <td>${escapeHtml(rencontreLabel(r))}</td>
                  <td>${escapeHtml(get(r, "Ville") || get(r, "Salle"))}</td>
                  <td class="num">${formatNumber(r._kmEff, "")}</td>
                  <td class="num">${formatMoney(r._amount)}</td>
                  <td class="num">${formatMoney(c)}</td>
                  <td class="num pos">${formatMoney(r._amount - c)}</td>
                  <td>${escapeHtml(get(r, "Statut paiement"))}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </details>` : empty("Aucune mission pour cette période.")}
  `;

  document.getElementById("exportRangeChk").addEventListener("change", e => { state.exportMode = e.target.checked ? "range" : "season"; renderExport(); });
  if (rng) {
    document.getElementById("exportFromInput").addEventListener("change", e => { state.exportFrom = e.target.value; renderExport(); });
    document.getElementById("exportToInput").addEventListener("change", e => { state.exportTo = e.target.value; renderExport(); });
  } else {
    document.getElementById("exportSeasonSelect").addEventListener("change", e => { state.exportSeason = e.target.value; state.exportMonth = ""; renderExport(); });
    document.getElementById("exportMonthSelect").addEventListener("change", e => { state.exportMonth = e.target.value; renderExport(); });
  }

  const pdfBtn = document.getElementById("genPdfBtn");
  if (pdfBtn) pdfBtn.addEventListener("click", generateExportPdf);

  const csvBtn = document.getElementById("exportCsvBtn");
  if (csvBtn) csvBtn.addEventListener("click", downloadExportCsv);

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
  state.exportMapRows = rows;
  const stat = document.getElementById("exportMapStatus");
  const imgBtn0 = document.getElementById("exportMapImgBtn");
  if (imgBtn0) imgBtn0.hidden = true;
  if (stat) { stat.hidden = false; stat.className = "map-status"; stat.textContent = "Génération de la carte… 0/" + entrees.length; }
  let fait = 0;

  if (state.exportMapInstance) { state.exportMapInstance.remove(); state.exportMapInstance = null; }
  const homeValide = Number(HOME.lat) && Number(HOME.lon);
  const carte = L.map(conteneur, { scrollWheelZoom: false }).setView(homeValide ? [HOME.lat, HOME.lon] : [46.6, 2.3], homeValide ? 8 : 5);
  // crossOrigin : indispensable pour que html2canvas puisse capturer les
  // tuiles OSM (sinon canvas "tainted" → export image impossible).
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap", crossOrigin: true
  }).addTo(carte);
  if (homeValide) L.marker([HOME.lat, HOME.lon]).addTo(carte).bindPopup("Domicile");
  state.exportMapInstance = carte;

  const points = homeValide ? [[HOME.lat, HOME.lon]] : [];

  for (const e of entrees) {
    const dejaEnCache = !!geoCacheGet_(e.adresse);
    const dest = await geocodeAvecCache_(e.adresse);
    if (dest) {
      const icon = L.divIcon({
        className: "",
        html: `<div class="frequency-marker"><span>${e.count}</span></div>`,
        iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30]
      });
      L.marker([dest.lat, dest.lon], { icon }).addTo(carte).bindPopup(`<b>${escapeHtml(e.salle)}</b><br>${e.count} fois arbitré`);
      points.push([dest.lat, dest.lon]);
    }
    fait++;
    if (stat) stat.textContent = "Génération de la carte… " + fait + "/" + entrees.length;
    // Respecte le quota Nominatim (max 1 requête/seconde) — seulement quand
    // l'appel vient réellement d'interroger le réseau (pas un hit de cache).
    if (!dejaEnCache) await new Promise(res => setTimeout(res, 1100));
  }

  // Cadre la carte sur la zone où tu as arbitré (un peu élargie), pas sur la France.
  if (points.length > 1) carte.fitBounds(points, { padding: [40, 40], maxZoom: 11 });
  else if (points.length === 1) carte.setView(points[0], 11);
  setTimeout(() => carte.invalidateSize(), 80);

  bouton.disabled = false;
  bouton.textContent = "Actualiser la carte";
  if (stat) { stat.className = "map-status is-ready"; stat.textContent = "✓ Carte prête — " + entrees.length + " salle(s). Tu peux l'exporter en PDF."; }

  // Export image : disponible seulement une fois la carte générée.
  const imgBtn = document.getElementById("exportMapImgBtn");
  if (imgBtn) { imgBtn.hidden = false; imgBtn.onclick = exporterCartePdf_; }
}

/* Charge html2canvas à la demande (évite ~30 Ko au chargement initial). */
function ensureHtml2Canvas_() {
  return new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error("html2canvas indisponible"));
    document.head.appendChild(s);
  });
}

/* Export PNG de la carte des salles. Tuiles en crossOrigin + useCORS :
   capture le fond de carte sans "tainted canvas". */
async function exporterCarteImage_() {
  const conteneur = document.getElementById("exportMap");
  if (!conteneur) return;
  try {
    setStatus("Génération de l'image…", "");
    const h2c = await ensureHtml2Canvas_();
    const canvas = await h2c(conteneur, { useCORS: true, backgroundColor: "#ffffff", scale: 2 });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `carte-salles-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setStatus("Image de la carte exportée", "ok");
  } catch (e) {
    console.error("Export carte image :", e);
    setStatus("Export image impossible — réessaie une fois la carte entièrement affichée.", "error");
  }
}

/* Récap par ville : clubs, salles, nombre de matchs, km A/R réellement parcourus
   (_kmEff = km partagés entre matchs d'un même doublé, donc pas de double compte). */
function recapVilles_(rows) {
  const m = {};
  rows.forEach(r => {
    const ville = cleanText(get(r, "Ville")) || cleanText(get(r, "Salle")) || "—";
    const o = m[ville] = m[ville] || { ville, clubs: new Set(), salles: new Set(), n: 0, km: 0 };
    const club = cleanText(get(r, "Recevant"));
    if (club) o.clubs.add(club);
    const salle = cleanText(get(r, "Salle"));
    if (salle) o.salles.add(salle);
    o.n++;
    o.km += (r._kmEff != null ? r._kmEff : r._km) || 0;
  });
  return Object.values(m).sort((a, b) => b.km - a.km);
}

/* Export de la carte en PDF : image de la carte cadrée sur la zone arbitrée,
   puis tableau récap (villes, clubs, salles, matchs, km A/R). */
async function exporterCartePdf_() {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  const conteneur = document.getElementById("exportMap");
  if (!jsPDFCtor || !conteneur) { setStatus("Bibliothèque PDF non chargée — recharge la page (Cmd+Maj+R)", "error"); return; }
  const rows = state.exportMapRows || exportRows();
  const stat = document.getElementById("exportMapStatus");
  const info = t => { setStatus(t, ""); if (stat) { stat.className = "map-status"; stat.textContent = t; } };
  info("Création du PDF de la carte…");

  const navy = [10, 31, 68], gold = [245, 180, 0], grey = [91, 104, 132];
  const doc = new jsPDFCtor({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(navy[0], navy[1], navy[2]); doc.rect(0, 0, pageW, 20, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("CARTE DES SALLES ARBITRÉES", 12, 13);
  doc.setTextColor(gold[0], gold[1], gold[2]); doc.setFontSize(9);
  doc.text(pdfSafe(exportPeriodLabel()), pageW - 12, 13, { align: "right" });

  let y = 26, imageOk = false;
  try {
    const h2c = await ensureHtml2Canvas_();
    if (state.exportMapInstance) state.exportMapInstance.invalidateSize();
    await new Promise(r => setTimeout(r, 600));   // laisse les tuiles finir de s'afficher
    const canvas = await h2c(conteneur, { useCORS: true, backgroundColor: "#ffffff", scale: 2 });
    const w = pageW - 24, hMax = 112, ratio = canvas.height / canvas.width;
    let iw = w, ih = w * ratio;
    if (ih > hMax) { ih = hMax; iw = hMax / ratio; }
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 12 + (w - iw) / 2, y, iw, ih);
    y += ih + 6;
    imageOk = true;
  } catch (e) { console.warn("Capture carte :", e); }

  const recap = recapVilles_(rows);
  const totKm = recap.reduce((t, o) => t + o.km, 0), totN = recap.reduce((t, o) => t + o.n, 0);
  doc.autoTable({
    startY: y,
    head: [["Ville", "Club(s) recevant", "Salle(s)", "Matchs", "Km A/R"]],
    body: recap.map(o => [pdfSafe(o.ville), pdfSafe(Array.from(o.clubs).join(" · ")), pdfSafe(Array.from(o.salles).join(" · ")), String(o.n), pdfSafe(formatNumber(Math.round(o.km * 10) / 10, ""))]),
    foot: [["TOTAL", "", "", String(totN), pdfSafe(formatNumber(Math.round(totKm * 10) / 10, " km"))]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, textColor: [12, 23, 48], lineColor: [220, 227, 239] },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [242, 245, 251], textColor: navy, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 248, 252] },
    columnStyles: { 3: { halign: "right", cellWidth: 18 }, 4: { halign: "right", cellWidth: 24 } },
    margin: { left: 12, right: 12 }
  });
  if (!imageOk) { try { ajouterCarteSallesPdf_(doc, rows, { navy, gold, grey, green: [14, 123, 71] }); } catch (e) {} }
  doc.save(`carte-salles-${new Date().toISOString().slice(0, 10)}.pdf`);
  if (stat) { stat.className = "map-status is-ready"; stat.textContent = "✓ PDF de la carte téléchargé."; }
  setStatus("PDF de la carte exporté", "ok");
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
    const c = realFuelCostClient(r._kmEff, r._date);
    lines.push([
      get(r, "Date match"), r._format, get(r, "Niveau administratif"), rencontreLabel(r), get(r, "Ville") || get(r, "Salle"),
      r._kmEff, r._amount.toFixed(2), c.toFixed(2), (r._amount - c).toFixed(2), get(r, "Statut paiement")
    ].map(csvEscape).join(";"));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `referee-tracker-export-${state.exportMode === "range" ? (state.exportFrom || "debut") + "_" + (state.exportTo || "fin") : (state.exportSeason === EXPORT_TOUTES ? "toutes-saisons" : state.exportSeason.replace("/", "-"))}.csv`;
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
      const c = realFuelCostClient(r._kmEff, r._date);
      return `- ${get(r, "Date match")} ${get(r, "Heure/RDV")} | ${r._format} | ${get(r, "Niveau administratif")} | ${rencontreLabel(r)} | ind ${formatMoney(r._amount)} | carb ${formatMoney(c)} | net ${formatMoney(r._amount - c)} | ${formatNumber(r._kmEff, " km")}`;
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
    const c = realFuelCostClient(r._kmEff, r._date);
    return [
      pdfSafe(get(r, "Date match")),
      pdfSafe(get(r, "Heure/RDV")),
      pdfSafe(r._format),
      pdfSafe(get(r, "Niveau administratif")),
      pdfSafe(rencontreLabel(r)),
      pdfSafe(get(r, "Ville") || get(r, "Salle")),
      pdfSafe(formatNumber(r._kmEff != null ? r._kmEff : r._km, "")),
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

  // Carte des salles (vectorielle, à partir des coords déjà géocodées)
  try { ajouterCarteSallesPdf_(doc, rows, { navy, gold, grey, green }); }
  catch (e) { console.warn("Carte PDF ignorée :", e && e.message); }

  const suffix = state.exportMonth || (state.exportSeason === EXPORT_TOUTES ? "toutes-saisons" : state.exportSeason.replace("/", "-"));
  doc.save(`referee-tracker-${suffix}.pdf`);
  setStatus(`PDF généré — ${rows.length} mission(s)`, "ok");
}

/* Carte vectorielle des salles dans le PDF (01/10/2026). Les tuiles OSM ne se
   rastérisent pas de façon fiable (CORS → canvas souillé), donc on dessine en
   vectoriel jsPDF à partir des coords DÉJÀ géocodées à l'écran (geocodeCache) :
   aucune requête réseau, instantané. Salles non géocodées = ignorées (afficher
   la carte dans l'onglet Export peuple le cache et les inclut toutes). */
function ajouterCarteSallesPdf_(doc, rows, couleurs) {
  const cache = state.geocodeCache || {};
  const navy = couleurs.navy, gold = couleurs.gold, grey = couleurs.grey;

  const parSalle = {};
  rows.forEach(r => {
    const salle = cleanText(get(r, "Salle")) || cleanText(get(r, "Ville"));
    if (!salle) return;
    const adresse = cleanText(get(r, "Adresse")) || salle;
    if (!parSalle[adresse]) parSalle[adresse] = { salle, adresse, count: 0 };
    parSalle[adresse].count++;
  });

  const pts = [];
  Object.values(parSalle).forEach(e => {
    const g = cache[e.adresse];
    if (g && isFinite(g.lat) && isFinite(g.lon)) pts.push({ lat: +g.lat, lon: +g.lon, count: e.count, salle: e.salle });
  });
  if (!pts.length) return; // rien de géocodé : pas de page carte

  const homeValide = Number(HOME.lat) && Number(HOME.lon);
  doc.addPage("a4", "landscape");
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(0, 0, pageW, 20, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("CARTE DES SALLES", 12, 13);
  doc.setTextColor(gold[0], gold[1], gold[2]); doc.setFontSize(9);
  doc.text("Nombre de fois arbitré", pageW - 12, 13, { align: "right" });

  const boxX = 14, boxY = 28, boxW = pageW - 28, boxH = pageH - 44;

  const tous = pts.slice();
  if (homeValide) tous.push({ lat: +HOME.lat, lon: +HOME.lon, count: 0, salle: "Domicile", _home: true });
  const latMoy = tous.reduce((s, p) => s + p.lat, 0) / tous.length;
  const k = Math.cos(latMoy * Math.PI / 180) || 1;
  tous.forEach(p => { p.px = p.lon * k; p.py = p.lat; });

  const pxMin = Math.min(...tous.map(p => p.px)), pxMax = Math.max(...tous.map(p => p.px));
  const pyMin = Math.min(...tous.map(p => p.py)), pyMax = Math.max(...tous.map(p => p.py));
  const rangeX = (pxMax - pxMin) || 1e-6, rangeY = (pyMax - pyMin) || 1e-6;
  const pad = 10;
  const scale = Math.min((boxW - 2 * pad) / rangeX, (boxH - 2 * pad) / rangeY);
  const drawnW = rangeX * scale, drawnH = rangeY * scale;
  const offX = boxX + (boxW - drawnW) / 2, offY = boxY + (boxH - drawnH) / 2;
  const projX = p => offX + (p.px - pxMin) * scale;
  const projY = p => offY + (pyMax - p.py) * scale;

  doc.setDrawColor(220, 227, 239); doc.setLineWidth(0.3);
  doc.rect(boxX, boxY, boxW, boxH);

  if (homeValide) {
    const h = tous.find(p => p._home);
    const hx = projX(h), hy = projY(h), s = 2.4;
    doc.setFillColor(gold[0], gold[1], gold[2]);
    doc.triangle(hx, hy - s, hx - s, hy + s, hx + s, hy + s, "F");
    doc.setFontSize(6.5); doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text("Domicile", hx, hy + s + 3, { align: "center" });
  }

  const maxCount = Math.max(...pts.map(p => p.count), 1);
  const rayon = c => 1.4 + (c / maxCount) * 3.2;
  pts.forEach(p => {
    const x = projX(p), y = projY(p), r = rayon(p.count);
    doc.setFillColor(navy[0], navy[1], navy[2]);
    doc.circle(x, y, r, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(5, Math.min(8, r * 2)));
    doc.text(String(p.count), x, y + 0.8, { align: "center" });
  });

  if (pts.length <= 25) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.5); doc.setTextColor(grey[0], grey[1], grey[2]);
    pts.forEach(p => {
      const x = projX(p), y = projY(p), r = rayon(p.count);
      doc.text(pdfSafe(p.salle).slice(0, 22), x, y + r + 2.4, { align: "center" });
    });
  }

  doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(grey[0], grey[1], grey[2]);
  const nbTotalSalles = Object.keys(parSalle).length;
  const note = pts.length < nbTotalSalles
    ? `${pts.length}/${nbTotalSalles} salles placées — affiche la carte dans l'onglet Export pour géocoder les autres.`
    : `${pts.length} salles — carte schématique (positions relatives, sans fond de carte).`;
  doc.text(note, 14, pageH - 8);
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
    "2026-06": 1.868,
    "2026-08": 2.26,
    "2026-09": 2.26
};

const PRIX_DEFAUT = 1.95;

const numMois_ = c => { const p = String(c).split("-"); return Number(p[0]) * 12 + Number(p[1]); };

/* Réglages « Mon profil » : prix par période (dernière ligne <= date). */
function prixPeriode_(date) {
  const l = state.couts && state.couts.prix;
  if (!date || !l || !l.length) return 0;
  const iso = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  let r = 0;
  l.forEach(p => { if (p.depuis <= iso) r = Number(p.prix) || r; });
  return r;
}

/* Appelé par rt-auth.js après enregistrement des réglages carburant/entretien. */
window.rtCoutsMaj = function (c) {
  state.couts = c;
  try { loadStats(true); } catch (e) {}
  renderAllSoon_();
};

function prixCarburantPour(date) {
  const pp = prixPeriode_(date);
  if (pp) return pp;
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

/* Consommation (L/100) du véhicule utilisé à cette date : même source que le
   serveur (Mon profil → véhicules). Repli : valeurs historiques 108 / Audi. */
function consoPour_(date) {
  const l = state.vehicles;
  if (date && Array.isArray(l) && l.length) {
    const iso = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    let v = null;
    l.forEach(x => { const d = String(x.depuis || ""); if (/^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) <= iso && Number(x.consoL100 || x.conso)) v = x; });
    if (v) return Number(v.consoL100 || v.conso);
  }
  return (date && date >= new Date(2026, 7, 1)) ? 6.0 : 6.58;
}
function realFuelCostClient(km, date) {
  const k = Number(km) || 0;
  if (!k) return 0;
  return round2((k * consoPour_(date) / 100) * prixCarburantPour(date));
}

/* ---------------- Utils ---------------- */

function get(row, key) { return row && row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : ""; }
function firstValue(row, keys) { for (const k of keys) { const v = get(row, k); if (v) return v; } return ""; }
function hasWarning(row) { return Boolean(get(row, "Warning général") || get(row, "Warning finance") || get(row, "Warning FBI")); }

/* « Paiement club à vérifier » n'est pas une anomalie : c'est un mode de
   règlement, vrai dès l'import et pour toujours. Posé en warning, il
   remplissait l'onglet Alertes en permanence. Il est signalé sur la carte
   (voir reglementSpecial) et retiré d'ici. */
/* Audit 25/09/2026 — Nettoyage des alertes.
   Les 6 dénominations officielles « INDEMNISÉ PAR » ne sont PAS des anomalies :
   quand elles atterrissent en warning (amicaux, coupe, parts égales…), c'est
   juste l'info de payeur, pas un problème → on les ignore côté alertes. */
const WARNINGS_IGNORES = [
  "Paiement club à vérifier",
  "LE COMITE DEPARTEMENTAL",
  "LA LIGUE REGIONALE",
  "L'ASSOCIATION RECEVANTE",
  "LA FEDERATION",
  "LES ASSOCIATIONS A PARTS EGALES",
  "L\u2019ASSOCIATION RECEVANTE"
];
/* Fausses lignes « Alerte » issues d'e-mails marketing/automatiques parsés à
   tort (ex. « Your Superagent can now make phone calls »). On ne filtre QUE
   les lignes _format === "Alerte" : jamais un vrai match. */
const SPAM_ALERTE_MARQUEURS = ["superagent", "phone call", "make phone", "unsubscribe", "se désinscrire", "se desinscrire", "newsletter", "no-reply", "noreply", "do not reply", "mailjet", "notification email"];
function estAlerteParasite_(row) {
  if (row._format !== "Alerte") return false;
  const txt = (String(rencontreLabel(row) || "") + " " + String(get(row, "Warning général") || "") + " " + String(get(row, "Recevant") || "") + " " + String(get(row, "Salle") || "")).toLowerCase();
  return SPAM_ALERTE_MARQUEURS.some(m => txt.indexOf(m) !== -1);
}

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

function paiementEnRetard(row) {
  const statut = cleanText(get(row, "Statut paiement"));
  if (statut === "Reçu" || statut === BENEVOLE) return false;
  if (statut === "En retard") return true;
  const prevu = parseFrDate(get(row, "Date attendue") || get(row, "Date paiement"));
  if (!prevu) return false;
  prevu.setHours(23, 59, 59, 999);
  const du = toNumber(get(row, "Indemnité totale"));
  const recu = toNumber(get(row, "Reçu recevant")) + toNumber(get(row, "Reçu visiteur")) || toNumber(get(row, "Montant reçu"));
  return Date.now() > prevu.getTime() && recu < du;
}

/* Compatibilité avec les anciens appels : retourne uniquement un warning,
   sans déclencher ni envoyer de relance. */
function paiementARelancer(row) {
  return paiementEnRetard(row);
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
function fmtHeure(h) {
  const t = parseHeure(h);        // gère "20:30", "20h30", "20 h 30", "20.30"
  return t ? formatHeureFr(t) : String(h || "").trim();   // -> "20h30"
}
function badge(text, cls = "") { return text ? `<span class="badge ${cls}">${escapeHtml(text)}</span>` : ""; }
function empty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }

let _statusTimer = 0;
function setStatus(message, type) {
  const bar = document.getElementById("statusBar");
  bar.textContent = message;
  bar.className = "status-bar show" + (type ? " " + type : "");
  clearTimeout(_statusTimer);
  // Succès et infos : disparaissent seuls (plus de bandeau jaune permanent).
  // Les erreurs restent jusqu'au message suivant.
  if (type !== "error") _statusTimer = setTimeout(() => bar.classList.remove("show"), type === "ok" ? 2600 : 3500);
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
function safeUrl_(u) { u = String(u == null ? "" : u).trim(); return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : "#"; }
function escapeHtml(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

/* Clé de tri = date + heure (RDV, à défaut heure du match). Sans heure : fin
   de journée. Mise en cache sur la ligne (recalculée à chaque rechargement). */
function tsMission_(r) {
  if (r._ts != null) return r._ts;
  let ts = 0;
  if (r._date) {
    const txt = heureDe_(r);
    let t = parseHeure(txt);
    if (!t) { const m = String(txt).match(/(\d{1,2})\s*h\b/i); if (m && Number(m[1]) < 24) t = { h: Number(m[1]), m: 0 }; }
    ts = r._date.getTime() + (t ? t.h * 60 + t.m : 24 * 60 - 1) * 60000;
  }
  r._ts = ts;
  return ts;
}
function sortByDateAsc(a, b) { return tsMission_(a) - tsMission_(b); }
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

/* ---------------- Estimation de fin de saison (b6) ----------------
   Méthode (mélange de trois sources) :
   1. CALENDRIER CONNU : matchs déjà désignés à venir, valorisés exactement
      (indemnité, km réels, carburant au prix de la période, entretien).
   2. RYTHME DE LA SAISON PASSÉE : nombre de matchs que tu avais arbitrés
      sur la même période restante l'an dernier.
   3. RYTHME ACTUEL : ratio (matchs de cette saison / matchs de l'an dernier
      à la même date), lissé et borné [0,6 ; 1,6] pour éviter les emballements.
   Matchs attendus d'ici la fin = max(calendrier connu, restant N-1 x ratio).
   Bas = calendrier connu seul ; haut = estimation centrale + 25 %.
   Les matchs "à prévoir" sont valorisés à la moyenne de la saison en cours. */

function saisonDebutAnnee_() {
  const s = state.selectedSeason;
  if (s && s !== "Toutes les saisons") { const y = parseInt(s, 10); if (y) return y; }
  const n = new Date();
  return n >= new Date(n.getFullYear(), 6, 30) ? n.getFullYear() : n.getFullYear() - 1;
}
function entretienKmClient_(date) {
  const l = state.couts && state.couts.entretien;
  // Avant les périodes saisies : même repli que le serveur (108 = 0,12 €/km, Audi = 0,1875).
  const repli = (date && date < new Date(2026, 7, 1)) ? 0.12 : 0.1875;
  if (!date || !l || !l.length) return repli;
  const iso = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  let r = repli;
  l.forEach(p => { if (p.depuis <= iso && Number(p.eur_km)) r = Number(p.eur_km); });
  return r;
}
function agregEstim_(rows) {
  const o = { n: 0, ind: 0, km: 0, carb: 0, ent: 0 };
  rows.forEach(r => {
    const km = r._kmEff != null ? r._kmEff : (r._km || 0);
    o.n++; o.ind += r._amount || 0; o.km += km;
    o.carb += realFuelCostClient(km, r._date);
    o.ent += km * entretienKmClient_(r._date);
  });
  o.ind = round2(o.ind); o.km = Math.round(o.km); o.carb = round2(o.carb); o.ent = round2(o.ent);
  return o;
}
function calculerEstimation_() {
  const Y = saisonDebutAnnee_();
  const debut = new Date(Y, 6, 30), fin = new Date(Y + 1, 6, 29, 23, 59, 59);
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const actifs = state.allRows.filter(r => r._isActive && r._format !== "Alerte" && r._date);
  const saison = actifs.filter(r => r._date >= debut && r._date <= fin);
  const faits = saison.filter(r => r._date < auj);
  const avenir = saison.filter(r => r._date >= auj);

  const decale = d => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
  const prevDebut = decale(debut), prevAuj = decale(auj), prevFin = decale(fin);
  const prev = actifs.filter(r => r._date >= prevDebut && r._date <= prevFin);
  const prevEcoule = prev.filter(r => r._date < prevAuj).length;
  const prevReste = prev.filter(r => r._date >= prevAuj).length;

  const semainesRestantes = Math.max(0, (fin - auj) / (7 * 86400000));
  const semainesEcoulees = Math.max(1, (auj - debut) / (7 * 86400000));
  let ratio = 1, methode;
  if (prev.length && prevReste > 0) {
    ratio = Math.min(1.6, Math.max(0.6, (faits.length + 3) / (prevEcoule + 3)));
    methode = "calendrier connu + rythme de la saison passée (x" + ratio.toFixed(2).replace(".", ",") + " selon ton rythme actuel)";
  } else {
    methode = "calendrier connu + rythme actuel (pas d'historique N-1 comparable, estimation prudente)";
  }
  let restantCentral;
  if (prev.length && prevReste > 0) restantCentral = Math.max(avenir.length, Math.round(prevReste * ratio));
  else restantCentral = avenir.length + Math.round((faits.length / semainesEcoulees) * semainesRestantes * 0.6);
  const restantHaut = Math.max(restantCentral, Math.round(restantCentral * 1.25));
  const extraC = Math.max(0, restantCentral - avenir.length);
  const extraH = Math.max(0, restantHaut - avenir.length);

  const base = (faits.length + avenir.length) ? faits.concat(avenir) : prev;
  const moy = agregEstim_(base);
  const m = { ind: base.length ? moy.ind / base.length : 0, km: base.length ? moy.km / base.length : 0 };
  const carbMoy = realFuelCostClient(m.km, auj), entMoy = m.km * entretienKmClient_(auj);
  const extraVal = n => ({ n, ind: round2(n * m.ind), km: Math.round(n * m.km), carb: round2(n * carbMoy), ent: round2(n * entMoy) });

  const rF = agregEstim_(faits), rA = agregEstim_(avenir), rC = extraVal(extraC), rH = extraVal(extraH);

  // Hôtels : payés (saison) + nuits conseillées à venir non encore saisies
  const hotelsPayes = (state.hotels || []).filter(h => { const d = parseFrDate(h.date); return d && d >= debut && d <= fin; })
    .reduce((t, h) => t + h.prix + h.repas, 0);
  const aVenirHotel = Object.keys(state.hotelInfo || {}).map(k => state.hotelInfo[k])
    .filter(e => e.actif && e.date >= auj && e.date <= fin && !hotelNuitEnregistree_(e.date));
  const hotelPrevu = aVenirHotel.length * HOTEL_CFG.budget;
  const ecoHotel = round2(aVenirHotel.reduce((t, e) => t + (e.ecoEur || 0), 0));

  const net = (ag, hotel) => round2(ag.ind - ag.carb - ag.ent - hotel);
  const recuSaison = round2(saison.reduce((t, r) => t + (r._encaisse || 0), 0));
  const resteConnu = round2(saison.reduce((t, r) => t + (r._reste || 0), 0));
  const tot = (a, b, c) => ({ n: a.n + b.n + c.n, ind: round2(a.ind + b.ind + c.ind), km: a.km + b.km + c.km, carb: round2(a.carb + b.carb + c.carb), ent: round2(a.ent + b.ent + c.ent) });
  const totC = tot(rF, rA, rC), totB = tot(rF, rA, { n: 0, ind: 0, km: 0, carb: 0, ent: 0 }), totH = tot(rF, rA, rH);
  const hotelsFin = round2(hotelsPayes + hotelPrevu);
  return {
    Y, rF, rA, rC, totC, totB, totH, hotelsPayes: round2(hotelsPayes), hotelPrevu, nbHotelPrevu: aVenirHotel.length, ecoHotel,
    hotelsFin, netC: net(totC, hotelsFin), netB: net(totB, hotelsFin), netH: net(totH, hotelsFin),
    recuSaison, resteConnu, aToucherFin: round2(resteConnu + rC.ind), aToucherHaut: round2(resteConnu + rH.ind),
    restantCentral, extraC, methode, semainesRestantes: Math.round(semainesRestantes), prevN: prev.length, m
  };
}

function renderEstimation() {
  const root = document.getElementById("statsEstimation");
  if (!root) return;
  if (state.hotels === undefined || state.hotels === null) loadHotels();
  const e = calculerEstimation_();
  const F = formatMoney, N = v => formatNumber(v, " km");
  const ligne = (lab, f, a, c, t, fmt) => `<tr><td>${lab}</td><td class="num">${fmt(f)}</td><td class="num">${fmt(a)}</td><td class="num">${fmt(c)}</td><td class="num"><strong>${fmt(t)}</strong></td></tr>`;
  const entier = v => String(v);
  const neg = v => v > 0 ? "−" + F(v) : F(0);
  const hFait = e.hotelsPayes, hPrevu = e.hotelPrevu;
  root.innerHTML = `
    <h2 class="section-title">Estimation fin de saison <span class="count">${e.Y}/${e.Y + 1}</span> <button type="button" class="info-btn" id="estInfoBtn" aria-label="Comment c'est calculé" title="Comment c'est calculé">${ICONE_INFO_}</button></h2>
    <div class="kpi-grid">
      <div class="kpi hero"><label>Net estimé fin de saison</label><strong>${F(e.netC)}</strong>
        <span class="sub">fourchette ${F(e.netB)} (calendrier connu seul) à ${F(e.netH)}</span></div>
      <div class="kpi"><label>Montants à toucher d'ici la fin</label><strong>${F(e.aToucherFin)}</strong><span class="sub">dont ${F(e.resteConnu)} déjà dus · jusqu'à ${F(e.aToucherHaut)}</span></div>
      <div class="kpi"><label>Déjà encaissé cette saison</label><strong>${F(e.recuSaison)}</strong></div>
      <div class="kpi"><label>Km prévus (saison)</label><strong>${N(e.totC.km)}</strong><span class="sub">${N(e.rA.km + e.rC.km)} restants</span></div>
      <div class="kpi"><label>Carburant + entretien prévus</label><strong>−${F(e.totC.carb + e.totC.ent)}</strong><span class="sub">carburant ${F(e.totC.carb)} · entretien ${F(e.totC.ent)}</span></div>
      <div class="kpi"><label>Matchs attendus</label><strong>${e.totC.n}</strong><span class="sub">${e.rF.n} faits · ${e.rA.n} désignés · ${e.rC.n} à prévoir</span></div>
    </div>

    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th></th><th class="num">Réalisé</th><th class="num">À venir (désignés)</th><th class="num">À prévoir</th><th class="num">Total saison</th></tr></thead>
      <tbody>
        ${ligne("Matchs", e.rF.n, e.rA.n, e.rC.n, e.totC.n, entier)}
        ${ligne("Indemnités", e.rF.ind, e.rA.ind, e.rC.ind, e.totC.ind, F)}
        ${ligne("Km A/R", e.rF.km, e.rA.km, e.rC.km, e.totC.km, N)}
        ${ligne("Carburant", e.rF.carb, e.rA.carb, e.rC.carb, e.totC.carb, neg)}
        ${ligne("Entretien", e.rF.ent, e.rA.ent, e.rC.ent, e.totC.ent, neg)}
        <tr><td>Hôtels &amp; repas</td><td class="num">${neg(hFait)}</td><td class="num">${neg(hPrevu)}</td><td class="num">—</td><td class="num"><strong>${neg(e.hotelsFin)}</strong></td></tr>
      </tbody>
    </table></div></div>

    <p class="card-sub">Carburant au prix de ta période, entretien selon ton enveloppe annuelle. Recalcul à chaque désignation.</p>
  `;
  const bi = root.querySelector("#estInfoBtn");
  if (bi) bi.addEventListener("click", () => ouvrirModaleInfo_("Comment c'est calculé", estInfoHtml_(e)));
}

function estInfoHtml_(e) {
  const F = v => formatMoney(v);
  return `<p><strong>Méthode</strong> : ${escapeHtml(e.methode)}.</p>
    ${e.nbHotelPrevu ? `<p>Hôtels prévus : ${e.nbHotelPrevu} nuit(s) conseillée(s) à ${HOTEL_CFG.budget} € max (économie de carburant correspondante : ${F(e.ecoHotel)}, non déduite des km).</p>` : ""}
    <p><strong>Réalisé</strong> : matchs passés, valeurs réelles.</p>
    <p><strong>À venir (désignés)</strong> : désignations reçues, valorisées exactement (km réels, prix du carburant de la période).</p>
    <p><strong>À prévoir</strong> : matchs pas encore reçus. Base : matchs arbitrés l'an dernier sur la même période restante, multipliés par ton rythme actuel (borné entre 0,6 et 1,6). Sans historique N-1 : rythme actuel réduit de 40 %. Valorisés à ta moyenne saison (${F(e.m.ind)} d'indemnité, ${Math.round(e.m.km)} km).</p>
    <p><strong>Fourchette</strong> : basse = désignations connues seules ; haute = estimation centrale + 25 %.</p>
    <p><strong>Nouvelle désignation</strong> : tout se recalcule. Elle remplace un match « à prévoir » (le total attendu est le plus grand des deux), puis elle est comptée exactement : le net ne bouge beaucoup que si tu dépasses l'estimation.</p>
    <p>Hôtels : nuits saisies + nuits conseillées à venir, au budget maximum réglé.</p>`;
}

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
  const km = (r._kmEff != null ? r._kmEff : (r._km || 0));
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
    const conso = consoPour_(r._date);
    return t + ((r._kmEff != null ? r._kmEff : r._km) * conso / 100);
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
    m.km += (r._kmEff != null ? r._kmEff : r._km); m.heures += r._heuresTotal; m.count++;
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
    g.net += r._net; g.brut += r._brut; g.km += (r._kmEff != null ? r._kmEff : r._km); g.count++; g.heures += r._heuresTotal;
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
  const pts = rows.filter(r => (r._kmEff || r._km) > 0 && r._eurHeure !== 0);

  AN.charts.nuage = new Chart(c, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "5×5",
          data: pts.filter(r => r._format === "5x5").map(r => ({ x: (r._kmEff != null ? r._kmEff : r._km), y: r._eurHeure, lieu: firstValue(r, ["Recevant", "Visiteur / événement"]), date: get(r, "Date match") })),
          backgroundColor: AN.COLORS.navyMid, pointRadius: 5, pointHoverRadius: 7
        },
        {
          label: "3×3",
          data: pts.filter(r => r._format === "3x3").map(r => ({ x: (r._kmEff != null ? r._kmEff : r._km), y: r._eurHeure, lieu: firstValue(r, ["Visiteur / événement", "Recevant"]), date: get(r, "Date match") })),
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
  const withKm = rows.filter(r => (r._kmEff != null ? r._kmEff : r._km) > 0);
  const g = groupBySimple(withKm, r => trancheDe(r._kmEff != null ? r._kmEff : r._km))
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
  const pts = rows.filter(r => (r._kmEff != null ? r._kmEff : r._km) > 0 && r._eurHeure !== 0);
  if (pts.length < 3) return "";
  const pire = pts.reduce((a, b) => b._eurHeure < a._eurHeure ? b : a);
  const meilleure = pts.reduce((a, b) => b._eurHeure > a._eurHeure ? b : a);
  return `<div class="insight warn">
    Mission la moins rentable : <b>${escapeHtml(firstValue(pire, ["Recevant", "Visiteur / événement"]) || "—")}</b>
    le ${escapeHtml(get(pire, "Date match"))} — ${formatNumber(pire._kmEff != null ? pire._kmEff : pire._km, " km")} pour ${money(pire._eurHeure)}/h.
    À l'inverse, ${escapeHtml(firstValue(meilleure, ["Recevant", "Visiteur / événement"]) || "—")} monte à ${money(meilleure._eurHeure)}/h.
  </div>`;
}

function insightTranches(rows) {
  const withKm = rows.filter(r => (r._kmEff != null ? r._kmEff : r._km) > 0);
  if (withKm.length < 4) return "";
  const g = groupBySimple(withKm, r => trancheDe(r._kmEff != null ? r._kmEff : r._km))
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

/* =====================================================================
   HÔTEL (b3, 04/10/2026)
   Règle validée :
   A. Match J1 loin de chez toi (>= 180 km OU >= 1h30 de route, aller) ET
      match J2 le lendemain / même week-end dans le même club, ou avec une
      économie >= 150 km (= km domicile-J1 + km domicile-J2 - km J1-J2).
   B. Retour estimé après 00h30 (coup d'envoi + 2h20 + trajet retour).
   Indemnités toujours calculées depuis chez toi : l'hôtel est un confort,
   son coût n'entre que dans le suivi (onglet Hôtel + Stats).
   ===================================================================== */
const HOTEL_CFG = {
  seuilKm: 180, seuilMin: 90, vitesseKmh: 80, ecoMinKm: 150,
  matchMin: 140, retourMaxMin: 24 * 60 + 30, budget: 60, facteurRoute: 1.3
};

function isoLocal_(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function hhmmMin_(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + "h" + String(m % 60).padStart(2, "0");
}
function dureeTxt_(min) {
  const m = Math.round(min);
  return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
}
function haversineKm_(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function hotelFinaliser_(e) {
  if (e.sameLieu) { e.eco = e.d1 + (e.d2 || e.d1); }
  else if (e.d12 !== null && e.d12 >= 0 && e.m2uid) { e.eco = e.d1 + e.d2 - e.d12; }
  else { e.eco = null; }
  e.a = !!(e.distA && e.m2uid && e.eco !== null && (e.sameLieu || e.eco >= HOTEL_CFG.ecoMinKm));
  e.actif = e.a || e.b;
  if (!e.a) e.ecoEff = 0; else e.ecoEff = Math.max(0, e.eco);
  e.ecoEur = e.ecoEff > 0 ? realFuelCostClient(e.ecoEff, e.date) : 0;
  e.net = round2(e.ecoEur - HOTEL_CFG.budget);
}

function hotelCalculerBase_() {
  const jours = {};
  state.allRows.forEach(r => {
    if (!r._isActive || r._format === "Alerte" || !r._date) return;
    (jours[ymd_(r._date)] = jours[ymd_(r._date)] || []).push(r);
  });
  const limite = new Date(); limite.setHours(0, 0, 0, 0); limite.setDate(limite.getDate() - 14);
  const debutMin = r => { const t = parseHeure(heureDe_(r)); return t ? t.h * 60 + t.m : -1; };
  const villeN = r => normaliserRecherche(get(r, "Ville"));
  const kmAller = (rows, lieu) => Math.max.apply(null, rows.filter(r => lieuDouble_(r) === lieu).map(r => r._km || 0).concat([0])) / 2;
  const adresseDe = r => cleanText(get(r, "Adresse")) || [get(r, "Salle"), get(r, "Ville")].map(cleanText).filter(Boolean).join(", ");

  const info = {}, veille = {}, aGeocoder = [];
  state._hotelD12 = state._hotelD12 || {};

  Object.keys(jours).forEach(k => {
    const rows = jours[k], d = rows[0]._date;
    if (d < limite) return;
    const m1 = rows.slice().sort((a, b) => debutMin(b) - debutMin(a))[0];
    const lieu1 = lieuDouble_(m1);
    const d1 = kmAller(rows, lieu1);
    if (!(d1 > 0)) return;
    const t1 = d1 / HOTEL_CFG.vitesseKmh * 60;
    const distA = d1 >= HOTEL_CFG.seuilKm || t1 >= HOTEL_CFG.seuilMin;
    const t0 = debutMin(m1);
    const arrivee = t0 >= 0 ? t0 + HOTEL_CFG.matchMin + t1 : null;
    const b = arrivee !== null && arrivee > HOTEL_CFG.retourMaxMin;

    let m2 = null, rows2 = null;
    const offs = d.getDay() === 5 ? [1, 2] : [1];
    for (const o of offs) {
      const dd = new Date(d); dd.setDate(d.getDate() + o);
      const rr = jours[ymd_(dd)];
      if (rr && rr.length) { rows2 = rr; m2 = rr.slice().sort((a, b2) => debutMin(a) - debutMin(b2))[0]; break; }
    }
    const e = {
      uid: get(m1, "UID"), date: d, nuit: isoLocal_(d), distA, d1, t1, arrivee, b,
      heure: fmtHeure(heureDe_(m1)), adresse: adresseDe(m1),
      lieuLabel: cleanText(get(m1, "Ville")) || cleanText(get(m1, "Salle")),
      m2uid: m2 ? get(m2, "UID") : "", d2: 0, sameLieu: false, d12: null, adresse2: ""
    };
    if (m2) {
      const lieu2 = lieuDouble_(m2);
      e.d2 = kmAller(rows2, lieu2);
      e.sameLieu = (!!lieu1 && lieu1 === lieu2) || (!!villeN(m1) && villeN(m1) === villeN(m2));
      e.adresse2 = adresseDe(m2);
      const cle = e.adresse + "|" + e.adresse2;
      if (!e.sameLieu && e.d2 > 0 && e.adresse && e.adresse2) {
        if (state._hotelD12[cle] !== undefined) e.d12 = state._hotelD12[cle];
        else if (distA) aGeocoder.push(e);
      }
    }
    hotelFinaliser_(e);
    info[e.uid] = e;
    if (e.a && e.m2uid) veille[e.m2uid] = e.uid;
  });
  state.hotelInfo = info; state.hotelVeille = veille;
  return aGeocoder;
}

let _hotelGeoBusy = false;
async function hotelGeocoder_(liste) {
  if (_hotelGeoBusy || !liste.length) return;
  _hotelGeoBusy = true;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const geo = async adr => {
    const hit = geoCacheGet_(adr);
    if (hit) return hit;
    await pause(1100);
    return geocode(adr);
  };
  try {
    for (const e of liste) {
      const cle = e.adresse + "|" + e.adresse2;
      if (state._hotelD12[cle] !== undefined) continue;
      let d12 = -1;
      try {
        const g1 = await geo(e.adresse), g2 = await geo(e.adresse2);
        if (g1 && g2) d12 = haversineKm_(g1, g2) * HOTEL_CFG.facteurRoute;
      } catch (err) { d12 = -1; }
      state._hotelD12[cle] = d12;
    }
  } finally { _hotelGeoBusy = false; }
  state._hotelRowsRef = null;   // force le recalcul avec les distances J1-J2
  renderAllSoon_();
}

/* Appelé à chaque renderAll : ne recalcule que si les lignes ont changé. */
function hotelScan_() {
  if (state._hotelRowsRef === state.allRows) return;
  state._hotelRowsRef = state.allRows;
  const aGeo = hotelCalculerBase_();
  if (aGeo.length) hotelGeocoder_(aGeo);
}

function hotelNuitEnregistree_(date) {
  if (!state.hotels || !date) return false;
  const k = ymd_(date);
  return state.hotels.some(h => ymd_(parseFrDate(h.date)) === k);
}

function renderHotelBadge_(row) {
  const uid = get(row, "UID");
  const e = state.hotelInfo && state.hotelInfo[uid];
  if (e && e.actif) return `<span class="badge badge-hotel" title="Hôtel conseillé la nuit du ${escapeHtml(formatDateShort(e.date))}">Hôtel</span>`;
  if (state.hotelVeille && state.hotelVeille[uid]) return `<span class="badge badge-hotel badge-hotel--veille" title="Nuit d'hôtel conseillée la veille">Hôtel la veille</span>`;
  return "";
}

function hotelLiens_(e) {
  const ci = e.nuit;
  const co = isoLocal_(new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate() + 1));
  const lieu = e.adresse || e.lieuLabel;
  const nflt = encodeURIComponent("price=EUR-min-" + HOTEL_CFG.budget + "-1;mealplan=1");
  const booking = "https://www.booking.com/searchresults.fr.html?ss=" + encodeURIComponent(lieu) +
    "&checkin=" + ci + "&checkout=" + co + "&group_adults=1&no_rooms=1&group_children=0&selected_currency=EUR" +
    "&order=distance_from_search&nflt=" + nflt;
  const maps = "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("B&B Hôtel OR Ibis Budget OR hotelF1 près de " + lieu);
  return { booking, maps };
}

function renderHotelPanel_(row) {
  const e = state.hotelInfo && state.hotelInfo[get(row, "UID")];
  if (!e || !e.actif) return "";
  const raisons = [];
  const dist = Math.round(e.d1) + " km (~" + dureeTxt_(e.t1) + ")";
  if (e.a) {
    raisons.push(e.sameLieu
      ? "Match loin de chez toi (" + dist + ") et match le lendemain dans le même club."
      : "Match loin de chez toi (" + dist + ") et match le lendemain : en dormant sur place tu évites " + Math.round(e.ecoEff) + " km.");
  }
  if (e.b) raisons.push("Retour estimé vers " + hhmmMin_(e.arrivee) + " (coup d'envoi " + e.heure + " + 2h20 + " + dureeTxt_(e.t1) + " de route).");
  const l = hotelLiens_(e);
  const deja = hotelNuitEnregistree_(e.date);
  return `
    <details class="hotel-panel">
      <summary><span class="hotel-sum">Hôtel conseillé — nuit du ${escapeHtml(formatDateShort(e.date))}</span></summary>
      <div class="hotel-body">
        <ul class="hotel-why">${raisons.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        <div class="money-strip">
          <div class="money-cell"><label>Km économisés</label><strong>${formatNumber(Math.round(e.ecoEff), " km")}</strong></div>
          <div class="money-cell"><label>Carburant économisé</label><strong>${formatMoney(e.ecoEur)}</strong></div>
          <div class="money-cell"><label>Hôtel (max)</label><strong>−${formatMoney(HOTEL_CFG.budget)}</strong></div>
          <div class="money-cell net"><label>Net</label><strong>${formatMoney(e.net)}</strong></div>
        </div>
        <p class="card-sub">Max ${HOTEL_CFG.budget} € TTC · petit-déjeuner inclus · proche de la salle · B&amp;B, Ibis Budget ou hotelF1. Indemnités inchangées (calculées depuis chez toi).</p>
        <div class="actions">
          <a class="action-link gold" href="${escapeHtml(l.booking)}" target="_blank" rel="noopener">Booking (filtres appliqués)</a>
          <a class="action-link secondary" href="${escapeHtml(l.maps)}" target="_blank" rel="noopener">Chaînes sur la carte</a>
          ${deja ? `<span class="badge green">Nuit enregistrée</span>`
                 : `<button type="button" class="action-link secondary" data-hotel-add="${escapeHtml(e.nuit)}" data-hotel-uid="${escapeHtml(e.uid)}" data-hotel-lieu="${escapeHtml(e.lieuLabel)}">Enregistrer le prix payé</button>`}
        </div>
      </div>
    </details>`;
}

/* ---- Données ---- */
function loadHotels() {
  if (state._hotelsEnCours) return;
  state._hotelsEnCours = true;
  jsonp("hotels")
    .then(res => {
      state.hotels = (res && res.success) ? (res.data || []) : [];
      state._hotelsEnCours = false;
      renderAllSoon_();
    })
    .catch(() => { state._hotelsEnCours = false; if (!state.hotels) state.hotels = []; renderAllSoon_(); });
}

function hotelWeekend_(date, vus) {
  const k0 = ymd_(date);
  const d2 = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const k1 = ymd_(d2);
  const rows = state.allRows.filter(r => r._isActive && r._format !== "Alerte" && r._date && (ymd_(r._date) === k0 || ymd_(r._date) === k1) && !(vus && vus.has(get(r, "UID"))));
  if (vus) rows.forEach(r => vus.add(get(r, "UID")));
  const brut = rows.reduce((t, r) => t + (r._amount || 0), 0);
  const carb = rows.reduce((t, r) => t + realFuelCostClient(r._kmEff != null ? r._kmEff : r._km, r._date), 0);
  return { n: rows.length, brut: round2(brut), carb: round2(carb) };
}

/* Ouvre la carte d'un match dans son onglet (5x5 ou 3x3). */
function ouvrirMatch(uid) {
  const r = state.allRows.find(x => get(x, "UID") === uid);
  const tab = (r && r._format === "3x3") ? "troisx3" : "matchs";
  setActiveTab(tab);
  setTimeout(() => {
    document.querySelectorAll("#" + tab + " .match-card").forEach(c => {
      if (c.dataset.uid === uid) { c.classList.add("open"); c.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
  }, 0);
}

/* Matchs liés à une nuit : ceux du jour J et de J+1 (hors alertes). */
function hotelMatchsDeNuit_(isoDate) {
  const d = isoDate ? new Date(isoDate + "T00:00:00") : null;
  if (!d || isNaN(d)) return [];
  const k0 = ymd_(d), k1 = ymd_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  return state.allRows.filter(r => r._isActive && r._format !== "Alerte" && r._date && (ymd_(r._date) === k0 || ymd_(r._date) === k1))
    .sort((a, b) => a._date - b._date || (parseHeure(heureDe_(a)) ? parseHeure(heureDe_(a)).h : 0) - (parseHeure(heureDe_(b)) ? parseHeure(heureDe_(b)).h : 0));
}
function hotelMatchLabel_(r) {
  return formatDateShort(r._date) + " · " + (fmtHeure(heureDe_(r)) || "—") + " · " + (cleanText(get(r, "Recevant")) || "?") + " (" + (cleanText(get(r, "Ville")) || cleanText(get(r, "Salle")) || "?") + ")";
}
function hotelMatchOptions_(isoDate, choisi) {
  const ms = hotelMatchsDeNuit_(isoDate);
  const info = Object.keys(state.hotelInfo || {}).map(k => state.hotelInfo[k]).find(e => e.nuit === isoDate);
  const def = choisi || (info ? info.uid : (ms[0] ? get(ms[0], "UID") : ""));
  return `<option value="">— Aucun match —</option>` + ms.map(r => `<option value="${escapeHtml(get(r, "UID"))}"${get(r, "UID") === def ? " selected" : ""}>${escapeHtml(hotelMatchLabel_(r))}</option>`).join("");
}
function fichierEnBase64_(f) {
  return new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => ko(new Error("Lecture du fichier impossible"));
    fr.readAsDataURL(f);
  });
}

/* ---- Onglet Hôtel ---- */
function renderHotel() {
  const root = document.getElementById("hotel");
  if (!root) return;
  if (state.hotels === undefined || state.hotels === null) {
    loadHotels();
    root.innerHTML = `<p class="card-sub">Chargement…</p>`;
    return;
  }
  const hs = state.hotels.slice().sort((a, b) => {
    const da = parseFrDate(a.date), db = parseFrDate(b.date);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  const totHotel = hs.reduce((t, h) => t + h.prix, 0);
  const totRepas = hs.reduce((t, h) => t + h.repas, 0);

  const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
  const conseilles = Object.keys(state.hotelInfo || {}).map(k => state.hotelInfo[k])
    .filter(e => e.actif && e.date >= aujourdhui && !hotelNuitEnregistree_(e.date))
    .sort((a, b) => a.date - b.date);

  const pre = state.hotelPrefill || {};
  root.innerHTML = `
    <h2 class="section-title">Hôtel &amp; repas <span class="count">${hs.length}</span></h2>
    <div class="kpi-grid">
      <div class="kpi"><label>Nuits d'hôtel</label><strong>${hs.length}</strong></div>
      <div class="kpi"><label>Hôtels payés</label><strong>${formatMoney(totHotel)}</strong></div>
      <div class="kpi"><label>Repas</label><strong>${formatMoney(totRepas)}</strong></div>
      <div class="kpi hero"><label>Total week-ends (hôtel + repas)</label><strong>${formatMoney(totHotel + totRepas)}</strong>
        <span class="sub">${hs.length ? formatMoney((totHotel + totRepas) / hs.length) + " par nuit" : "aucune nuit enregistrée"}</span></div>
    </div>

    ${conseilles.length ? `
    <h3 class="section-title">Nuits conseillées à venir</h3>
    <div class="table-card" style="margin-bottom:12px"><div class="table-wrap"><table>
      <thead><tr><th>Nuit du</th><th>Lieu</th><th>Raison</th><th class="num">Net estimé</th><th></th></tr></thead>
      <tbody>${conseilles.map(e => {
        const l = hotelLiens_(e);
        return `<tr>
          <td>${escapeHtml(formatDateShort(e.date))}</td>
          <td>${escapeHtml(e.lieuLabel)}</td>
          <td>${e.a ? "Trajet long + match le lendemain" : ""}${e.a && e.b ? " · " : ""}${e.b ? "Retour tardif (~" + escapeHtml(hhmmMin_(e.arrivee)) + ")" : ""}</td>
          <td class="num">${formatMoney(e.net)}</td>
          <td><a class="action-link gold" href="${escapeHtml(l.booking)}" target="_blank" rel="noopener">Booking</a>
              <button type="button" class="action-link secondary" data-hotel-add="${escapeHtml(e.nuit)}" data-hotel-uid="${escapeHtml(e.uid)}" data-hotel-lieu="${escapeHtml(e.lieuLabel)}">Enregistrer</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div></div>` : ""}

    ${foldable_("Ajouter une nuit", `<form id="hotelForm" class="toolbar form-formation" style="align-items:end">
      <div class="field"><label for="hotelDate">Nuit du</label><input id="hotelDate" type="date" required value="${escapeHtml(pre.date || "")}" /></div>
      <div class="field" style="min-width:240px"><label for="hotelMatch">Match lié</label><select id="hotelMatch">${hotelMatchOptions_(pre.date || "", pre.uid || "")}</select></div>
      <div class="field"><label for="hotelLieu">Ville / lieu</label><input id="hotelLieu" type="text" placeholder="Ville du match" value="${escapeHtml(pre.lieu || "")}" /></div>
      <div class="field"><label for="hotelNom">Hôtel</label><input id="hotelNom" type="text" placeholder="B&B, Ibis Budget…" /></div>
      <div class="field"><label for="hotelPrix">Prix payé (€ TTC)</label><input id="hotelPrix" type="text" inputmode="decimal" placeholder="58,00" required /></div>
      <div class="field"><label for="hotelRepas">Repas dépensés (€)</label><input id="hotelRepas" type="text" inputmode="decimal" placeholder="0" /></div>
      <div class="field"><label for="hotelFacture">Facture (PDF/JPG/PNG, Drive)</label><input id="hotelFacture" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
      <div class="field"><label for="hotelNotes">Notes</label><input id="hotelNotes" type="text" placeholder="Optionnel" /></div>
      <button class="small-btn secondary" type="submit">Enregistrer</button>
    </form>`, { open: !!pre.date })}

    <h3 class="section-title" style="margin-top:16px">Historique</h3>
    ${hs.length ? `<div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nuit du</th><th>Match</th><th>Lieu</th><th>Hôtel</th><th class="num">Prix</th><th class="num">Repas</th><th class="num">Indemnités WE</th><th class="num">Carburant WE</th><th class="num">Net WE</th><th>Facture</th><th></th></tr></thead>
      <tbody>${hs.map(h => {
        const d = parseFrDate(h.date);
        const w = d ? hotelWeekend_(d) : { n: 0, brut: 0, carb: 0 };
        const net = round2(w.brut - w.carb - h.prix - h.repas);
        return `<tr>
          <td>${escapeHtml(h.date)}</td><td>${(() => { const m = h.matchUid && state.allRows.find(r => get(r, "UID") === h.matchUid); return m ? `<a href="#" class="action-link" data-open-match="${escapeHtml(h.matchUid)}">${escapeHtml(cleanText(get(m, "Recevant")) || "Match")}</a>` : "—"; })()}</td><td>${escapeHtml(h.lieu || "—")}</td><td>${escapeHtml(h.hotel || "—")}</td>
          <td class="num">${formatMoney(h.prix)}</td><td class="num">${formatMoney(h.repas)}</td>
          <td class="num">${w.n ? formatMoney(w.brut) : "—"}</td><td class="num">${w.n ? "−" + formatMoney(w.carb) : "—"}</td>
          <td class="num">${w.n ? formatMoney(net) : "—"}</td>
          <td>${h.facture ? `<a class="action-link gold" href="${escapeHtml(safeUrl_(h.facture))}" target="_blank" rel="noopener">Voir</a>` : "—"}</td>
          <td><button type="button" class="action-link" data-del-hotel="${escapeHtml(h.id)}">Supprimer</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div></div>
    <p class="card-sub">Net WE = indemnités des matchs de la nuit et du lendemain − carburant − hôtel − repas.</p>`
    : empty("Aucune nuit d'hôtel enregistrée.")}
  `;
  state.hotelPrefill = null;

  const form = root.querySelector("#hotelForm");
  const dEl = root.querySelector("#hotelDate");
  if (dEl) dEl.addEventListener("change", () => {
    const sel = root.querySelector("#hotelMatch");
    if (sel) sel.innerHTML = hotelMatchOptions_(dEl.value, "");
    const m = hotelMatchsDeNuit_(dEl.value)[0], l = root.querySelector("#hotelLieu");
    if (m && l && !l.value) l.value = cleanText(get(m, "Ville")) || cleanText(get(m, "Salle"));
  });
  root.querySelectorAll("[data-open-match]").forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault();
    ouvrirMatch(a.dataset.openMatch);
  }));
  if (form) form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const v = id => document.getElementById(id).value;
    setStatus("Enregistrement de la nuit…", "");
    try {
      const f = document.getElementById("hotelFacture").files[0];
      if (f && f.size > 4 * 1024 * 1024) throw new Error("Facture > 4 Mo : réduis ou compresse le fichier");
      const extra = { date: v("hotelDate"), lieu: v("hotelLieu"), hotel: v("hotelNom"), prix: v("hotelPrix"), repas: v("hotelRepas"), notes: v("hotelNotes"), matchUid: v("hotelMatch") };
      if (f) { extra.fNom = f.name; extra.fMime = f.type; extra.fData = await fichierEnBase64_(f); }
      const res = await jsonp("addHotel", extra);
      if (!res.success) throw new Error(res.error || "Erreur enregistrement");
      setStatus("Nuit enregistrée", "ok");
      state.hotels = null; state._hotelRowsRef = null;
      loadHotels();
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  });
  root.querySelectorAll("[data-del-hotel]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Supprimer cette nuit ?")) return;
    try {
      const res = await jsonp("deleteHotel", { id: btn.dataset.delHotel });
      if (!res.success) throw new Error(res.error || "Erreur suppression");
      state.hotels = null;
      loadHotels();
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  }));
}

/* Bouton « Enregistrer le prix payé » (carte match / liste des nuits conseillées). */
document.addEventListener("click", ev => {
  const b = ev.target.closest && ev.target.closest("[data-hotel-add]");
  if (!b) return;
  state.hotelPrefill = { date: b.getAttribute("data-hotel-add"), lieu: b.getAttribute("data-hotel-lieu") || "", uid: b.getAttribute("data-hotel-uid") || "" };
  setActiveTab("hotel");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---- Stats : suivi des hôtels ---- */
function renderHotelsStats_() {
  if (state.hotels === undefined || state.hotels === null) { loadHotels(); return ""; }
  const saison = state.selectedSeason && state.selectedSeason !== "Toutes les saisons" ? state.selectedSeason : "";
  const hs = state.hotels.filter(h => {
    if (!saison) return true;
    const d = parseFrDate(h.date);
    return d && normalizeSeason("", d) === saison;
  });
  if (!hs.length) return foldable_("Hôtels & repas", empty("Aucune nuit d'hôtel enregistrée sur cette période."));
  let tH = 0, tR = 0, net = 0;
  const parSaison = {}, vusWE_ = new Set();
  hs.slice().sort((a, b) => ((parseFrDate(a.date) || 0) - (parseFrDate(b.date) || 0))).forEach(h => {
    const d = parseFrDate(h.date);
    const w = d ? hotelWeekend_(d, vusWE_) : { n: 0, brut: 0, carb: 0 };
    const nWE = round2(w.brut - w.carb - h.prix - h.repas);
    tH += h.prix; tR += h.repas; net += nWE;
    const k = d ? normalizeSeason("", d) : "Sans date";
    const o = parSaison[k] = parSaison[k] || { n: 0, h: 0, r: 0, net: 0 };
    o.n++; o.h += h.prix; o.r += h.repas; o.net += nWE;
  });
  return foldable_("Hôtels & repas", `
    <div class="kpi-grid">
      <div class="kpi"><label>Nuits</label><strong>${hs.length}</strong></div>
      <div class="kpi"><label>Hôtels</label><strong>${formatMoney(tH)}</strong><span class="sub">${formatMoney(tH / hs.length)} par nuit</span></div>
      <div class="kpi"><label>Repas</label><strong>${formatMoney(tR)}</strong></div>
      <div class="kpi"><label>Dépense totale</label><strong>${formatMoney(tH + tR)}</strong><span class="sub">${formatMoney((tH + tR) / hs.length)} par week-end</span></div>
      <div class="kpi"><label>Net des week-ends</label><strong>${formatMoney(net)}</strong><span class="sub">après carburant, hôtel et repas</span></div>
    </div>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Saison</th><th class="num">Nuits</th><th class="num">Hôtels</th><th class="num">Repas</th><th class="num">Net WE</th></tr></thead>
      <tbody>${Object.keys(parSaison).sort().reverse().map(k => `<tr><td>${escapeHtml(k)}</td><td class="num">${parSaison[k].n}</td><td class="num">${formatMoney(parSaison[k].h)}</td><td class="num">${formatMoney(parSaison[k].r)}</td><td class="num">${formatMoney(parSaison[k].net)}</td></tr>`).join("")}</tbody>
    </table></div></div>`, { count: hs.length });
}


/* =====================================================================
   MODULES PERSO (05/10/2026) — e-Licence, Indispos FBI, Rapports.
   Sous-vues de l'onglet « Procédures » (state.contactsSubView).
   ===================================================================== */
function isoL_(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function dmy_(iso) { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }

function msgServeur_(m) {
  return /404|en cours de d[ée]veloppement/i.test(String(m)) ? "Le serveur ne reconnaît pas cette action : le déploiement Apps Script est ancien ou une route intercepte la requête (voir Auth.gs, RT2_route)." : m;
}
function persoCharger_(cle, action, assign) {
  const flag = "_" + cle + "En";
  if (state[flag]) return;
  state[flag] = true;
  jsonp(action)
    .then(res => {
      if (res && res.success !== false) { assign(res); state["_" + cle + "Err"] = ""; }
      else state["_" + cle + "Err"] = msgServeur_((res && res.error) || "Erreur serveur");
    })
    .catch(e => { state["_" + cle + "Err"] = msgServeur_((e && e.message) || "Erreur de chargement"); })
    .finally(() => {
      state[flag] = false;
      rerenderPerso_();
      try { renderTabBadges_(); } catch (e) {}
      if (state.activeTab === "accueil") renderAllSoon_();
    });
}
/* Redessine l'écran perso actif (e-Licence, Indispos, Rapports sont des onglets du menu gauche). */
function rerenderPerso_() {
  const t = state.activeTab;
  if (t === "contacts") renderContacts();
  else if (t === "elicence" || t === "indispos" || t === "rapports") renderTab_(t);
}
function renderPersoTab_(id, titre, fn) {
  const root = document.getElementById(id);
  if (!root) return;
  if (state.contacts === null && !state._contactsErreur && (id === "indispos" || id === "rapports")) loadContacts();
  root.innerHTML = `<h2 class="section-title">${escapeHtml(titre)}</h2>${fn()}`;
  attachPersoListeners_(root);
}
function loadElicence() { persoCharger_("elic", "elicence", r => { state.elicence = r.data || {}; }); }
function loadIndispos() { persoCharger_("indis", "indispos", r => { state.indispos = r.data || []; }); }
function loadRapports() { persoCharger_("rapp", "rapports", r => { state.rapports = (r.data && r.data.rapports) || []; state.rapportsDossier = (r.data && r.data.dossier) || {}; }); }
function erreurPerso_(msg, id) {
  return `<div class="table-card" style="padding:16px;text-align:center;margin-top:12px"><p class="card-sub" style="margin:0 0 10px">Chargement impossible (${escapeHtml(msg)}).</p><button type="button" class="small-btn secondary" id="${id}">Réessayer</button></div>`;
}
function chargementPerso_() { return `<p class="card-sub" style="margin-top:12px">Chargement…</p>`; }

/* ---------- e-Licence ---------- */
function elicCarteHtml_(e, grand) {
  const val = e.validite ? new Date(e.validite + "T12:00:00") : null;
  const jr = val ? Math.ceil((val - new Date()) / 86400000) : null;
  const badge = val ? (jr < 0 ? `<span class="elic-badge is-bad">Expirée depuis ${-jr} j</span>`
    : jr <= 60 ? `<span class="elic-badge is-warn">Renouvellement dans ${jr} j</span>`
    : `<span class="elic-badge is-ok">Valide · ${jr} j</span>`) : "";
  return `<div class="elic-card${grand ? " elic-grand" : ""}">
    <div class="elic-top"><span class="elic-brand">Ma licence</span>${badge}</div>
    <div class="elic-main">
      <div class="elic-photo">${e.photo ? `<img src="${escapeHtml(e.photo)}" alt="Photo" />` : `<span>Photo</span>`}</div>
      <div class="elic-id">
        <strong>${escapeHtml(e.nom || "—")}</strong>
        <span>N° ${escapeHtml(e.numero || "—")}</span>
        <span>${escapeHtml(e.niveau || "Niveau non renseigné")}</span>
        <span>${val ? "Valide jusqu'au " + escapeHtml(dmy_(e.validite)) : "Validité non renseignée"}</span>
      </div>
    </div>
    <div class="elic-qr" data-qr="${escapeHtml(e.qr || e.numero || "")}"></div>
  </div>`;
}
function remplirQr_(root) {
  root.querySelectorAll(".elic-qr").forEach(el => {
    const t = el.getAttribute("data-qr") || "";
    if (!t) { el.innerHTML = `<small>QR : renseigne un n° de licence</small>`; return; }
    try {
      if (typeof qrcode !== "function") throw new Error("lib");
      const q = qrcode(0, "M"); q.addData(t); q.make();
      el.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (err) { el.innerHTML = `<small>${escapeHtml(t)}</small>`; }
  });
}
function renderElicencePanel_() {
  if (state._elicErr) return erreurPerso_(state._elicErr, "retryElic");
  if (state.elicence === undefined) { loadElicence(); return chargementPerso_(); }
  const e = state.elicence || {};
  return `
    <div class="elic-wrap">
      ${elicCarteHtml_(e, false)}
      <div class="elic-actions">
        <button type="button" class="small-btn" id="elicPlein">Plein écran (à présenter)</button>
        <p class="card-sub">Copie personnelle pour l'avoir sous la main. Elle ne remplace pas l'e-Licence officielle.</p>
      </div>
    </div>
    <details class="past-block" style="margin-top:12px"${(e.nom || e.numero) ? "" : " open"}>
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Modifier ma licence</span></span></summary>
      <div class="past-body">
        <form id="elicForm" class="toolbar" style="grid-template-columns: repeat(3, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="elicNom">Nom</label><input id="elicNom" type="text" value="${escapeHtml(e.nom || "")}" required /></div>
          <div class="field"><label for="elicNumero">N° de licence</label><input id="elicNumero" type="text" value="${escapeHtml(e.numero || "")}" required /></div>
          <div class="field"><label for="elicNiveau">Niveau</label><input id="elicNiveau" type="text" placeholder="Ex. Arbitre régional" value="${escapeHtml(e.niveau || "")}" /></div>
          <div class="field"><label for="elicValidite">Valide jusqu'au</label><input id="elicValidite" type="date" value="${escapeHtml(e.validite || "")}" /></div>
          <div class="field"><label for="elicQr">Contenu du QR (optionnel)</label><input id="elicQr" type="text" placeholder="Par défaut : n° de licence" value="${escapeHtml(e.qr || "")}" /></div>
          <div class="field"><label for="elicPhoto">Photo</label><input id="elicPhoto" type="file" accept="image/*" /></div>
          <div style="grid-column: 1 / -1; display:flex; gap:8px; flex-wrap:wrap">
            <button type="submit" class="small-btn">Enregistrer</button>
            ${e.photo ? `<button type="button" class="small-btn secondary" id="elicPhotoDel">Retirer la photo</button>` : ""}
            <span class="card-sub" id="elicMsg"></span>
          </div>
        </form>
      </div>
    </details>`;
}
function photoRedim_(file) {
  return new Promise((ok, ko) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const W = 220, H = 280, c = document.createElement("canvas");
      c.width = W; c.height = H;
      const k = Math.max(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(u);
      let q = 0.85, out = c.toDataURL("image/jpeg", q);
      while (out.length > 44000 && q > 0.3) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      out.length > 46000 ? ko(new Error("Photo trop lourde")) : ok(out);
    };
    img.onerror = () => { URL.revokeObjectURL(u); ko(new Error("Image illisible")); };
    img.src = u;
  });
}
async function sauverElicence_(extra) {
  const g = id => (document.getElementById(id) || {}).value || "";
  const msg = document.getElementById("elicMsg");
  const donnees = { nom: g("elicNom"), numero: g("elicNumero"), niveau: g("elicNiveau"), validite: g("elicValidite"), qr: g("elicQr") };
  const f = document.getElementById("elicPhoto") && document.getElementById("elicPhoto").files[0];
  try {
    if (f) donnees.photo = await photoRedim_(f);
    if (extra && extra.photoEffacer) donnees.photoEffacer = "1";
    if (msg) msg.textContent = "Enregistrement…";
    const res = await jsonp("elicence.set", donnees);
    if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
    state.elicence = res.data;
    renderContacts();
  } catch (err) { if (msg) msg.textContent = "Erreur : " + err.message; }
}
function elicPleinEcran_() {
  const e = state.elicence || {};
  const ov = document.createElement("div");
  ov.className = "elic-overlay";
  ov.innerHTML = `${elicCarteHtml_(e, true)}<p class="elic-fermer">Touche l'écran pour fermer</p>`;
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
  remplirQr_(ov);
}

/* ---------- Indispos ---------- */
function weekendsAVenir_(n) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const sam = new Date(t), dow = t.getDay();
  sam.setDate(sam.getDate() + (dow === 0 ? -1 : 6 - dow));
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = new Date(sam); s.setDate(sam.getDate() + 7 * i);
    const d = new Date(s); d.setDate(s.getDate() + 1);
    out.push({ sam: s, dim: d });
  }
  return out;
}
function statutWeekends_() {
  const ind = state.indispos || [];
  const couvert = iso => ind.some(x => x.debut <= iso && iso <= x.fin);
  const actifs = (state.allRows || []).filter(r => r._isActive && r._date);
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  return weekendsAVenir_(10).map(w => {
    const s = isoL_(w.sam), d = isoL_(w.dim);
    const ms = actifs.filter(r => { const k = isoL_(r._date); return k === s || k === d; });
    const cs = couvert(s), cd = couvert(d);
    const statut = ms.length ? "designe" : (cs && cd ? "indispo" : (cs || cd ? "partiel" : "dispo"));
    const conflit = false;
    const jours = Math.round((w.sam - auj) / 86400000);
    return { w, s, d, ms, statut, conflit, alerte: (statut === "dispo" || statut === "partiel") && jours <= 14 && w.dim >= auj };
  });
}
function libelleWeekend_(w) {
  const o = { day: "numeric", month: "long" };
  return w.sam.toLocaleDateString("fr-FR", o) + " – " + w.dim.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function mailRepartiteurs_(wk) {
  const dest = (state.contacts || []).filter(c => c.email && /r[ée]partiteur|d[ée]signat/i.test((c.role || "") + " " + (c.situation || ""))).map(c => c.email);
  const sujet = "Disponibilité — week-end du " + libelleWeekend_(wk.w);
  const corps = "Bonjour,\n\nJe suis disponible le week-end du " + libelleWeekend_(wk.w) + " et je n'ai pas de désignation à ce jour. Pouvez-vous me proposer des matchs si besoin ?\n\nCordialement,\nClément";
  return "mailto:" + dest.join(",") + "?subject=" + encodeURIComponent(sujet) + "&body=" + encodeURIComponent(corps);
}
function nbAlertesIndispos_() {
  return state.indispos ? statutWeekends_().filter(x => x.alerte).length : 0;
}
function indispoBanner_() {
  const n = state.indispos ? statutWeekends_().filter(x => x.alerte).length : 0;
  return n ? `<button type="button" class="acc-alerte-indispo" onclick="allerIndispos_()">${n} week-end${n > 1 ? "s" : ""} où tu es dispo sans désignation · voir et écrire aux répartiteurs</button>` : "";
}
function allerIndispos_() { setActiveTab("indispos"); }
function renderIndisposPanel_() {
  if (state._indisErr) return erreurPerso_(state._indisErr, "retryIndis");
  if (state.indispos === undefined) { loadIndispos(); return chargementPerso_(); }
  if (state.contacts === null && !state._contactsErreur) loadContacts();
  const wk = statutWeekends_();
  const lib = { designe: ["Désigné", "is-ok"], indispo: ["Indisponible", ""], partiel: ["Partiellement indisponible, rien de désigné", "is-warn"], dispo: ["Dispo, aucune désignation", "is-warn"] };
  const ind = state.indispos;
  return `
    <p class="card-sub" style="margin-top:12px">Saisis ici tes indispos (ou colle-les en bloc depuis FBI). Alerte quand un week-end à moins de 14 jours n'a ni désignation ni indispo.</p>
    <div class="table-card" style="margin-top:8px"><div class="table-wrap"><table>
      <thead><tr><th>Week-end</th><th>Statut</th><th></th></tr></thead>
      <tbody>${wk.map(x => `<tr>
        <td>${escapeHtml(libelleWeekend_(x.w))}</td>
        <td><span class="indis-st ${lib[x.statut][1]}">${lib[x.statut][0]}</span>${x.ms.length ? ` · ${x.ms.length} match${x.ms.length > 1 ? "s" : ""}` : ""}${x.conflit ? ` <span class="indis-st is-bad">match sur créneau indispo</span>` : ""}</td>
        <td>${x.alerte ? `<a class="action-link" href="${escapeHtml(mailRepartiteurs_(x))}">Écrire aux répartiteurs</a>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>
    ${(state.contacts || []).some(c => c.email && /r[ée]partiteur|d[ée]signat/i.test((c.role || "") + " " + (c.situation || ""))) ? "" : `<p class="card-sub">Aucun contact « répartiteur » avec e-mail dans Contacts : le mail s'ouvrira sans destinataire.</p>`}
    <details class="past-block" style="margin-top:12px">
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter / importer des indispos</span></span></summary>
      <div class="past-body">
        <form id="indisForm" class="toolbar" style="grid-template-columns: repeat(3, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field"><label for="indisDebut">Du</label><input id="indisDebut" type="date" required /></div>
          <div class="field"><label for="indisFin">Au (vide = 1 jour)</label><input id="indisFin" type="date" /></div>
          <div class="field"><label for="indisNote">Note</label><input id="indisNote" type="text" /></div>
          <div style="grid-column:1 / -1"><button type="submit" class="small-btn">Ajouter</button> <span class="card-sub" id="indisMsg"></span></div>
        </form>
        <div class="field" style="margin-top:14px"><label for="indisColle">Coller depuis FBI (une période par ligne : 12/10/2026 ou 12/10/2026 - 18/10/2026)</label>
          <textarea id="indisColle" rows="4" style="width:100%"></textarea></div>
        <button type="button" class="small-btn secondary" id="indisImport" style="margin-top:8px">Importer</button>
      </div>
    </details>
    ${ind.length ? `<div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Du</th><th>Au</th><th>Note</th><th></th></tr></thead>
      <tbody>${ind.map(x => `<tr><td>${escapeHtml(dmy_(x.debut))}</td><td>${escapeHtml(dmy_(x.fin))}</td><td>${escapeHtml(x.note || "—")}</td><td><button type="button" class="action-link" data-del-indis="${escapeHtml(x.id)}">Supprimer</button></td></tr>`).join("")}</tbody>
    </table></div></div>` : empty("Aucune indispo enregistrée.")}`;
}

/* ---------- Rapports ---------- */
const RAPP_ROLES_ = ["Table de marque", "Responsable de salle", "Coach", "Capitaine"];
const RAPP_48H_ = ["Table de marque", "Responsable de salle"];
const RAPP_CRITERES_ = ["Autorité et maîtrise du match", "Communication (table, coachs, capitaines)", "Cohérence des décisions", "Gestion des comportements", "Placement et condition physique"];
function rapportsRetard_() {
  const now = Date.now();
  return (state.rapports || []).filter(r => r.statut === "Demandé" && r.echeance && new Date(r.echeance).getTime() < now);
}
function rapportMailto_(r) {
  const delai = RAPP_48H_.indexOf(r.role) >= 0 ? "\n\nMerci de me le retourner sous 48 h." : "";
  const sujet = "Rapport — " + r.role + " — " + r.match;
  const corps = "Bonjour" + (r.contactNom ? " " + r.contactNom : "") + ",\n\nPourriez-vous remplir le rapport (" + r.role + ") concernant : " + r.match + "." + (r.notes ? "\n\n" + r.notes : "") + delai + "\n\nMerci,\nClément";
  return "mailto:" + (r.contactEmail || "") + "?subject=" + encodeURIComponent(sujet) + "&body=" + encodeURIComponent(corps);
}
function matchsPourRapports_() {
  return (state.allRows || []).filter(r => r._isActive && r._date && r._format !== "Alerte")
    .sort((a, b) => b._date - a._date).slice(0, 40);
}
/* --- Partie 1 : modèles vierges (générés ici, en PDF) --- */
const RAPP_TYPES_SAISIE_ = ["Incident(s) disciplinaire(s)", "Faute(s) disqualifiante(s)", "Réclamation", "Incident(s) matériel(s)", "Commotion cérébrale", "Autre rapport"];
const RAPP_MES_TYPES_ = RAPP_TYPES_SAISIE_.concat(["Rapport d'incident", "Rapport technique / disqualifiante", "Rapport de comportement"]);
const RAPP_OFFICIELS_ = [
  { id: "disciplinaire", fichier: "docs/rapports/incident-disciplinaire.pdf", titre: "Incident(s) disciplinaire(s)", desc: "FFBB — Commission fédérale de discipline." },
  { id: "disqualifiante", fichier: "docs/rapports/faute-disqualifiante.pdf", titre: "Faute(s) disqualifiante(s)", desc: "FFBB — Commission fédérale de discipline." },
  { id: "reclamation", fichier: "docs/rapports/reclamation.pdf", titre: "Réclamation", desc: "FFBB — Commission fédérale 5x5." },
  { id: "materiel", fichier: "docs/rapports/incident-materiel.pdf", titre: "Incident(s) matériel(s)", desc: "FFBB — Commission fédérale équipements." },
  { id: "commotion", fichier: "docs/rapports/commotion-cerebrale.pdf", titre: "Protocole commotion cérébrale", desc: "FFBB — Commission fédérale médicale." }
];
const RAPP_MODELES_ = [
  { id: "incident", titre: "Rapport d'incident / comportement", desc: "Faits, personnes concernées, décision prise, témoins, signature." },
  { id: "tdm", titre: "Évaluation — Table de marque", role: "Table de marque", desc: "5 critères notés de 1 à 5, commentaire, signature." },
  { id: "rds", titre: "Évaluation — Responsable de salle", role: "Responsable de salle", desc: "5 critères notés de 1 à 5, commentaire, signature." },
  { id: "coach", titre: "Évaluation — Coach", role: "Coach", desc: "5 critères notés de 1 à 5, commentaire, signature." },
  { id: "capitaine", titre: "Évaluation — Capitaine", role: "Capitaine", desc: "5 critères notés de 1 à 5, commentaire, signature." }
];
function modelePdf_(m) {
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error("Générateur PDF indisponible");
  const d = new J({ unit: "mm", format: "a4" });
  const L = 15, R = 195;
  let y = 20;
  const ligne = (lab, x2) => { d.setFontSize(10); d.text(pdfSafe(lab), L, y); d.line(L + d.getTextWidth(pdfSafe(lab)) + 2, y + 0.5, x2 || R, y + 0.5); y += 8; };
  const cadre = (titre, h) => { d.setFontSize(10); d.text(pdfSafe(titre), L, y); y += 2; d.rect(L, y, R - L, h); y += h + 6; };
  d.setFontSize(16); d.text(pdfSafe(m.titre), L, y); y += 5;
  d.setFontSize(9); d.setTextColor(110); d.text(pdfSafe("Modele vierge - Referee Tracker"), L, y); d.setTextColor(0); y += 9;
  ligne("Rencontre :"); ligne("Date :   ______ / ______ / __________      Salle :", R); ligne("Arbitres :");
  y += 2;
  if (m.role) {
    d.setFontSize(10); d.text(pdfSafe("Rempli par (" + m.role + ") : nom, club / fonction"), L, y); y += 8; d.line(L, y - 3, R, y - 3); y += 2;
    RAPP_CRITERES_.forEach(c => {
      d.setFontSize(10); d.text(pdfSafe(c), L, y);
      for (let k = 1; k <= 5; k++) { const x = 130 + (k - 1) * 13; d.rect(x, y - 4, 7, 7); d.setFontSize(8); d.text(String(k), x + 2.4, y + 9 - 5.4 + 0.2 - 3.6); }
      y += 12;
    });
    y += 2; cadre("Commentaire", 50);
  } else {
    ligne("Personne concernee (nom, prenom, n° licence) :"); ligne("Equipe / fonction :"); ligne("Moment (periode, chrono, score) :");
    y += 2; cadre("Description des faits", 55); cadre("Decision prise", 25); ligne("Temoins :");
  }
  d.setFontSize(10); d.text("Date :", L, y + 6); d.text("Signature :", 80, y + 6); d.rect(105, y - 2, 70, 22);
  return d;
}
function modeleBase64_(d) { return d.output("datauristring").split(",")[1]; }

/* --- Partie 2 : mes rapports de match (stockage) --- */
function renderRapportsPanel_() {
  if (state._rappErr) return erreurPerso_(state._rappErr, "retryRapp");
  if (state.rapports === undefined) { loadRapports(); return chargementPerso_(); }
  const L = state.rapports, dos = state.rapportsDossier || {};
  const ms = matchsPourRapports_();
  const mes = L.filter(r => RAPP_MES_TYPES_.indexOf(r.role) >= 0);
  const anciens = L.filter(r => RAPP_MES_TYPES_.indexOf(r.role) < 0);
  const actions = r => `${r.fichier ? `<a class="action-link" href="${escapeHtml(safeUrl_(r.fichier))}" target="_blank" rel="noopener">Voir / imprimer</a> <button type="button" class="action-link" data-rapp-send="${escapeHtml(r.id)}">Envoyer par mail</button>` : `<label class="action-link" style="cursor:pointer">Ajouter le fichier<input type="file" hidden accept="application/pdf,image/*" data-rapp-file="${escapeHtml(r.id)}"></label>`} <button type="button" class="action-link" data-rapp-del="${escapeHtml(r.id)}">Supprimer</button>`;
  return `
    <h3 class="section-title" style="margin-top:4px">Rapport brut</h3>
    <p class="card-sub">Formulaires officiels vierges : voir, imprimer ou envoyer par mail.</p>
    <div class="rapp-modeles">${RAPP_OFFICIELS_.map(m => `<div class="rapp-modele">
      <strong>${escapeHtml(m.titre)}</strong><span class="card-sub">${escapeHtml(m.desc)}</span>
      <div class="rapp-act"><button type="button" class="small-btn secondary" data-mod-voir="${m.id}">Voir</button> <button type="button" class="small-btn secondary" data-mod-imp="${m.id}">Imprimer</button> <button type="button" class="small-btn" data-mod-send="${m.id}">Envoyer par mail</button></div>
    </div>`).join("")}</div>

    <h3 class="section-title" style="margin-top:24px">Sauvegarde de rapports</h3>
    <div class="rapp-dossier">
      <span>Dossier Drive : <strong>${escapeHtml(dos.nom || "non créé")}</strong>${dos.url ? ` · <a href="${escapeHtml(safeUrl_(dos.url))}" target="_blank" rel="noopener">ouvrir</a>` : ""}</span>
      <form id="rappDossierForm" class="rapp-inline"><input id="rappDossierNom" type="text" placeholder="Renommer le dossier" /><button type="submit" class="small-btn secondary">Renommer</button></form>
    </div>
    <details class="past-block" style="margin-top:12px" ${mes.length ? "" : "open"}>
      <summary class="past-summary"><span class="past-summary-inner"><span class="past-chevron" aria-hidden="true"></span><span class="past-title">Ajouter un rapport</span></span></summary>
      <div class="past-body">
        <form id="rappForm" class="toolbar" style="grid-template-columns: repeat(3, 1fr); align-items:end; margin-top:10px; row-gap:12px">
          <div class="field" style="grid-column: span 2"><label for="rappMatch">Match</label><select id="rappMatch">${ms.map(r => `<option value="${escapeHtml(get(r, "UID"))}">${escapeHtml(hotelMatchLabel_(r))}</option>`).join("")}</select></div>
          <div class="field"><label for="rappRole">Type</label><select id="rappRole">${RAPP_TYPES_SAISIE_.map(x => `<option>${escapeHtml(x)}</option>`).join("")}</select></div>
          <div class="field" style="grid-column: span 2"><label for="rappNotes">Notes (optionnel)</label><input id="rappNotes" type="text" /></div>
          <div class="field"><label for="rappFichier">Fichier (PDF / photo, 4 Mo max)</label><input id="rappFichier" type="file" accept="application/pdf,image/*" required /></div>
          <div style="grid-column:1 / -1"><button type="submit" class="small-btn">Enregistrer</button> <span class="card-sub" id="rappMsg"></span></div>
        </form>
      </div>
    </details>
    ${mes.length ? `<div class="table-card" style="margin-top:12px"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Match</th><th>Type</th><th>Notes</th><th></th></tr></thead>
      <tbody>${mes.map(r => `<tr><td>${escapeHtml(dmy_(r.cree))}</td><td>${escapeHtml(r.match)}</td><td>${escapeHtml(r.role)}</td><td>${escapeHtml(r.notes || "—")}</td><td class="rapp-act">${actions(r)}</td></tr>`).join("")}</tbody>
    </table></div></div>` : empty("Aucun rapport enregistré.")}
    ${anciens.length ? foldable_("Anciennes demandes d'évaluation", `<div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Match</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
      <tbody>${anciens.map(r => `<tr><td>${escapeHtml(dmy_(r.cree))}</td><td>${escapeHtml(r.match)}</td><td>${escapeHtml(r.role)}</td><td>${escapeHtml(r.statut)}</td><td class="rapp-act">${actions(r)}</td></tr>`).join("")}</tbody>
    </table></div></div>`, { count: anciens.length }) : ""}`;
}
function rapportPdfDepuisForm_(match, role) {
  const note = i => (document.getElementById("rappC" + i) || {}).value || "";
  const par = (document.getElementById("rappPar") || {}).value || "";
  const com = (document.getElementById("rappCom") || {}).value || "";
  const cv = document.getElementById("rappSign");
  const veutPdf = par || com || RAPP_CRITERES_.some((c, i) => note(i));
  if (!veutPdf) return null;
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error("Générateur PDF indisponible");
  const doc = new J({ unit: "mm", format: "a4" });
  let y = 20;
  doc.setFontSize(16); doc.text(pdfSafe("Rapport — " + role), 15, y); y += 8;
  doc.setFontSize(11); doc.text(pdfSafe(match), 15, y); y += 6;
  doc.text(pdfSafe("Rempli par : " + (par || "—") + "   le " + new Date().toLocaleDateString("fr-FR")), 15, y); y += 10;
  RAPP_CRITERES_.forEach((c, i) => { doc.text(pdfSafe(c) + " : " + (note(i) || "—") + " / 5", 15, y); y += 7; });
  y += 4; doc.text("Commentaire :", 15, y); y += 6;
  doc.splitTextToSize(pdfSafe(com || "—"), 180).forEach(l => { if (y > 250) { doc.addPage(); y = 20; } doc.text(l, 15, y); y += 5.5; });
  if (cv && cv.dataset.signe === "1") { y = Math.min(y + 8, 262); doc.text("Signature :", 15, y); doc.addImage(cv.toDataURL("image/png"), "PNG", 15, y + 2, 60, 20); }
  const uri = doc.output("datauristring");
  return uri.split(",")[1];
}
function initSignature_(root) {
  const cv = root.querySelector("#rappSign");
  if (!cv) return;
  const g = cv.getContext("2d");
  g.lineWidth = 2; g.lineCap = "round"; g.strokeStyle = "#111";
  let dessine = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", e => { dessine = true; const p = pos(e); g.beginPath(); g.moveTo(p[0], p[1]); cv.dataset.signe = "1"; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", e => { if (!dessine) return; const p = pos(e); g.lineTo(p[0], p[1]); g.stroke(); });
  ["pointerup", "pointercancel"].forEach(ev => cv.addEventListener(ev, () => { dessine = false; }));
  const eff = root.querySelector("#rappSignClear");
  if (eff) eff.addEventListener("click", () => { g.clearRect(0, 0, cv.width, cv.height); cv.dataset.signe = ""; });
}
async function fichierRapport_(f) {
  if (!f) return null;
  if (f.size > 4 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 4 Mo)");
  const mime = f.type || "application/pdf";
  return { fNom: f.name, fMime: mime, fData: await fichierEnBase64_(f) };
}

function attachPersoListeners_(root) {
  const clic = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener("click", fn));
  const retry = (id, cle, fn) => { const b = root.querySelector("#" + id); if (b) b.addEventListener("click", () => { state[cle] = ""; fn(); rerenderPerso_(); }); };
  retry("retryElic", "_elicErr", loadElicence); retry("retryIndis", "_indisErr", loadIndispos); retry("retryRapp", "_rappErr", loadRapports);

  // e-Licence
  const ef = root.querySelector("#elicForm");
  if (ef) ef.addEventListener("submit", e => { e.preventDefault(); sauverElicence_(); });
  const ed = root.querySelector("#elicPhotoDel");
  if (ed) ed.addEventListener("click", () => sauverElicence_({ photoEffacer: true }));
  const ep = root.querySelector("#elicPlein");
  if (ep) ep.addEventListener("click", elicPleinEcran_);
  remplirQr_(root);

  // Indispos (saisie manuelle)
  const nf = root.querySelector("#indisForm");
  if (nf) nf.addEventListener("submit", async e => {
    e.preventDefault();
    const m = root.querySelector("#indisMsg");
    try {
      const res = await jsonp("indispo.add", { debut: root.querySelector("#indisDebut").value, fin: root.querySelector("#indisFin").value, note: root.querySelector("#indisNote").value });
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      state.indispos = undefined; loadIndispos(); rerenderPerso_();
    } catch (err) { if (m) m.textContent = "Erreur : " + err.message; }
  });
  const ni = root.querySelector("#indisImport");
  if (ni) ni.addEventListener("click", async () => {
    const t = root.querySelector("#indisColle").value;
    if (!t.trim()) return;
    try {
      const res = await jsonp("indispo.import", { texte: t });
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      const r = res.result || {};
      setStatus(`Import : ${r.ajoutes || 0} ajoutée(s), ${r.doublons || 0} déjà présente(s), ${r.ignores || 0} ligne(s) ignorée(s)`, "ok");
      state.indispos = undefined; loadIndispos(); rerenderPerso_();
    } catch (err) { setStatus("Erreur import : " + err.message, "error"); }
  });
  clic("[data-del-indis]", async e => {
    try { await jsonp("indispo.delete", { id: e.currentTarget.getAttribute("data-del-indis") }); state.indispos = undefined; loadIndispos(); rerenderPerso_(); }
    catch (err) { setStatus("Erreur : " + err.message, "error"); }
  });

  // Rapports
  initSignature_(root);
  const df = root.querySelector("#rappDossierForm");
  if (df) df.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const res = await jsonp("rapport.dossier", { nom: root.querySelector("#rappDossierNom").value });
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      state.rapportsDossier = res.result; rerenderPerso_();
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  });
  const rf = root.querySelector("#rappForm");
  if (rf) rf.addEventListener("submit", async e => {
    e.preventDefault();
    const m = root.querySelector("#rappMsg");
    const sel = root.querySelector("#rappMatch");
    try {
      if (!sel.value) throw new Error("Choisis un match");
      const f = await fichierRapport_(root.querySelector("#rappFichier").files[0]);
      if (!f) throw new Error("Choisis un fichier");
      if (m) m.textContent = "Enregistrement…";
      const res = await jsonp("rapport.add", Object.assign({ matchUid: sel.value, match: sel.options[sel.selectedIndex].text, role: root.querySelector("#rappRole").value, notes: root.querySelector("#rappNotes").value }, f));
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      state.rapports = undefined; loadRapports(); rerenderPerso_();
    } catch (err) { if (m) m.textContent = "Erreur : " + err.message; }
  });
  const modele = id => RAPP_OFFICIELS_.concat(RAPP_MODELES_).find(x => x.id === id);
  const pdfB64_ = async mo => {
    if (!mo.fichier) return modeleBase64_(modelePdf_(mo));
    const r = await fetch(mo.fichier); if (!r.ok) throw new Error("Fichier introuvable");
    const buf = new Uint8Array(await r.arrayBuffer()); let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  clic("[data-mod-voir]", e => { try { const mo = modele(e.currentTarget.getAttribute("data-mod-voir")); window.open(mo.fichier || modelePdf_(mo).output("bloburl"), "_blank", "noopener"); } catch (err) { setStatus("Erreur : " + err.message, "error"); } });
  clic("[data-mod-imp]", e => {
    try {
      const mo = modele(e.currentTarget.getAttribute("data-mod-imp"));
      if (!mo.fichier) { const d = modelePdf_(mo); d.autoPrint(); window.open(d.output("bloburl"), "_blank"); return; }
      const fr = document.createElement("iframe"); fr.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0";
      fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (_) { window.open(mo.fichier, "_blank", "noopener"); } setTimeout(() => fr.remove(), 60000); };
      fr.src = mo.fichier; document.body.appendChild(fr);
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  });
  clic("[data-mod-send]", async e => {
    const mo = modele(e.currentTarget.getAttribute("data-mod-send"));
    const dest = window.prompt("Envoyer « " + mo.titre + " » à quelle adresse e-mail ?", "");
    if (!dest) return;
    try {
      setStatus("Envoi en cours…", "");
      const res = await jsonp("rapport.modele.send", { email: dest, titre: mo.titre, fNom: (mo.fichier ? mo.fichier.split("/").pop() : "modele_" + mo.id + ".pdf"), fMime: "application/pdf", fData: await pdfB64_(mo) });
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      setStatus("Document envoyé à " + dest, "ok");
    } catch (err) { setStatus("Erreur d'envoi : " + err.message, "error"); }
  });
  root.querySelectorAll("[data-rapp-file]").forEach(inp => inp.addEventListener("change", async () => {
    try {
      const f = await fichierRapport_(inp.files[0]);
      if (!f) return;
      const res = await jsonp("rapport.file", Object.assign({ id: inp.getAttribute("data-rapp-file") }, f));
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      state.rapports = undefined; loadRapports(); rerenderPerso_();
    } catch (err) { setStatus("Erreur : " + err.message, "error"); }
  }));
  clic("[data-rapp-del]", async e => {
    if (!window.confirm("Supprimer cette ligne de suivi ? (le fichier reste dans Drive)")) return;
    try { await jsonp("rapport.delete", { id: e.currentTarget.getAttribute("data-rapp-del") }); state.rapports = undefined; loadRapports(); rerenderPerso_(); }
    catch (err) { setStatus("Erreur : " + err.message, "error"); }
  });
  clic("[data-rapp-send]", async e => {
    const id = e.currentTarget.getAttribute("data-rapp-send");
    const r = (state.rapports || []).find(x => x.id === id);
    const dest = window.prompt("Envoyer le rapport à quelle adresse e-mail ?", (r && r.contactEmail) || "");
    if (!dest) return;
    try {
      const res = await jsonp("rapport.send", { id, email: dest });
      if (!res || res.success === false) throw new Error((res && res.error) || "Erreur");
      setStatus("Rapport envoyé à " + dest + (res.result && res.result.piece ? "" : " (sans pièce jointe)"), "ok");
    } catch (err) { setStatus("Erreur d'envoi : " + err.message, "error"); }
  });
}
