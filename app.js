/* =====================================================
   REFEREE TRACKER — INTERFACE GITHUB PAGES
   Connectée à Google Apps Script via JSONP.
   Carte : OpenStreetMap (Leaflet) + itinéraire OSRM.
   Stats : calculées côté serveur (endpoint action=stats).
   ===================================================== */

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxcCrf5UfrnaiMlfDvcKBKyFedzgnkgoDDCLhvicsxti9noP60Sz-VAGkHcnAtQP_rf/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";

const HOME = { label: "14 Rue des Faisans, 67240 Kaltenhouse", lat: 48.8241, lon: 7.8069 };
const PAYMENT_STATUSES = ["À recevoir", "Reçu", "Écart à vérifier", "À vérifier"];

let state = {
  allRows: [],
  filteredRows: [],
  serverStats: null,
  activeTab: "matchs",
  selectedSeason: "",
  search: "",
  maps: {}
};

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  buildSeasonSelect();
  loadData();
});

function bindUi() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  const refresh = document.getElementById("refreshBtn");
  refresh.addEventListener("click", () => {
    refresh.classList.remove("spin");
    void refresh.offsetWidth;
    refresh.classList.add("spin");
    loadData();
  });

  document.getElementById("seasonSelect").addEventListener("change", e => {
    state.selectedSeason = e.target.value;
    loadStats();
    renderAll();
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    state.search = e.target.value.trim().toLowerCase();
    renderAll();
  });
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
}

/* ---------------- Chargement données ---------------- */

function loadData() {
  setStatus("Chargement des données…", "");
  jsonp("matchs")
    .then(res => {
      if (!res.success) throw new Error(res.error || "Erreur API");
      state.allRows = normalizeRows(res.data || []);
      setStatus(`${state.allRows.length} ligne(s) chargée(s)`, "ok");
      loadStats();
      renderAll();
    })
    .catch(err => setStatus("Impossible de contacter l’API Apps Script : " + err.message, "error"));
}

function loadStats() {
  jsonp("stats", { season: state.selectedSeason })
    .then(res => {
      if (res && res.success) {
        state.serverStats = res.stats;
        if (state.activeTab === "stats") renderStats();
      }
    })
    .catch(() => { /* les stats serveur sont un bonus, jamais bloquantes */ });
}

/* ---------------- JSONP ---------------- */

function jsonp(action, extra = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = "rt_cb_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const params = new URLSearchParams({ key: API_KEY, action, callback: callbackName, ...extra });
    const script = document.createElement("script");
    script.src = `${APP_SCRIPT_URL}?${params.toString()}`;
    script.async = true;

    const timer = setTimeout(() => { cleanup(); reject(new Error("Timeout API")); }, 20000);
    window[callbackName] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Script bloqué ou URL invalide")); };

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    document.body.appendChild(script);
  });
}

/* ---------------- Normalisation ---------------- */

function normalizeRows(rows) {
  return rows.map(row => {
    const r = { ...row };
    r._date = parseFrDate(get(r, "Date match"));
    r._amount = toNumber(get(r, "Indemnité totale"));
    r._km = toNumber(get(r, "Km A/R stats"));
    r._format = get(r, "Format");
    r._season = normalizeSeason(get(r, "Saison"), r._date);
    r._isActive = !["annulé", "annule", "alerte"].includes(cleanText(get(r, "Statut")).toLowerCase()) && r._format !== "Alerte";
    r._isPast = isPastMission(r);
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

function renderAll() {
  state.filteredRows = filterRows(state.allRows);
  renderMatchs();
  renderTroisx3();
  renderPaiements();
  renderStats();
  renderAlertes();
  renderExport();
}

function filterRows(rows) {
  const s = state.selectedSeason, q = state.search;
  return rows.filter(row => {
    const seasonOk = s === "Toutes les saisons" || row._season === s;
    if (!seasonOk) return false;
    if (!q) return true;
    const hay = ["Recevant", "Visiteur / événement", "Salle", "Adresse", "Ville", "Collègue nom", "Libellé compétition", "Niveau administratif", "Code compétition"]
      .map(k => get(row, k)).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/* ---------------- 5x5 / 3x3 ---------------- */

function renderMatchs() { renderMatchPanel("matchs", "5x5", "5×5"); }
function renderTroisx3() { renderMatchPanel("troisx3", "3x3", "3×3"); }

function renderMatchPanel(rootId, format, label) {
  const root = document.getElementById(rootId);
  const rows = state.filteredRows.filter(r => r._format === format).sort(sortByDateAsc);
  const upcoming = rows.filter(r => !r._isPast);
  const past = rows.filter(r => r._isPast).sort(sortByDateDesc);

  root.innerHTML = `
    <h2 class="section-title">${label} à venir <span class="count">${upcoming.length}</span></h2>
    ${upcoming.length ? `<div class="cards">${upcoming.map(renderMatchCard).join("")}</div>` : empty(`Aucun match ${label} à venir pour cette saison.`)}
    <h2 class="section-title">${label} passés <span class="count">${past.length}</span></h2>
    ${past.length ? `<div class="cards">${past.map(renderMatchCard).join("")}</div>` : empty(`Aucun match ${label} passé pour cette saison.`)}
  `;
  attachCardListeners(root);
  attachPaymentListeners(root);
}

function renderMatchCard(row) {
  const uid = escapeHtml(get(row, "UID"));
  const format = get(row, "Format");
  const title = format === "3x3"
    ? firstValue(row, ["Visiteur / événement", "Recevant", "Libellé compétition"])
    : firstValue(row, ["Recevant", "Visiteur / événement", "Libellé compétition"]);

  const date = formatDateShort(row._date);
  const time = get(row, "Heure/RDV");
  const level = get(row, "Niveau administratif") || format;
  const warning = hasWarning(row);
  const paiement = get(row, "Statut paiement") || "À recevoir";
  const isPaid = paiement === "Reçu";

  const cost = realFuelCostClient(row._km, row._date);
  const net = round2(row._amount - cost);

  return `
    <article class="match-card" data-uid="${uid}">
      <div class="card-head" role="button" tabindex="0">
        <div>
          <div class="badges">
            ${badge(format || "Mission", format === "3x3" ? "red" : "gray")}
            ${badge(level, "gray")}
            ${row._isPast ? badge("Passé", "gray") : badge("À venir", "green")}
            ${warning ? badge("À vérifier", "orange") : ""}
            ${isPaid ? badge("Payé", "green") : badge(paiement, paiement === "À recevoir" ? "gold" : "orange")}
          </div>
          <h3 class="card-title">${escapeHtml(title || "Mission")}</h3>
          <p class="card-sub">${escapeHtml(get(row, "Visiteur / événement") || get(row, "Libellé compétition") || "")}</p>
        </div>
        <div class="date-pill"><strong>${escapeHtml(date)}</strong><span>${escapeHtml(time)}</span></div>
      </div>
      <div class="card-body">
        ${renderMoneyStrip(row._amount, cost, net)}
        ${renderDetails(row)}
        ${renderMapContainer(row, uid)}
        ${renderActions(row)}
        ${renderPaymentControl(row)}
      </div>
    </article>
  `;
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
    ["N° rencontre", get(row, "N° rencontre")],
    ["Recevant", get(row, "Recevant")],
    ["Visiteur / événement", get(row, "Visiteur / événement")],
    ["Salle", get(row, "Salle")],
    ["Adresse", get(row, "Adresse")],
    ["Ville", get(row, "Ville")],
    ["Code e-Marque", get(row, "Code e-Marque")],
    ["Collègue", formatColleague(row)],
    ["Référent 3x3", get(row, "Référent 3x3")],
    ["Observateur", get(row, "Observateur")],
    ["KM A/R", row._km ? formatNumber(row._km, " km") : ""],
    ["Paiement prévu", get(row, "Date paiement")],
    ["Warnings", [get(row, "Warning général"), get(row, "Warning finance"), get(row, "Warning FBI")].filter(Boolean).join(" | ")]
  ].filter(([, v]) => v !== "" && v !== null && v !== undefined);

  return `<div class="detail-grid">${details.map(([l, v]) => `
    <div class="detail"><label>${escapeHtml(l)}</label><span>${escapeHtml(String(v))}</span></div>`).join("")}</div>`;
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

/* ---------------- Actions ---------------- */

function renderActions(row) {
  const address = get(row, "Adresse");
  const phone = onlyDigits(get(row, "Collègue téléphone"));
  const links = [];
  if (address) {
    links.push(`<a class="action-link" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${HOME.lat}%2C${HOME.lon}%3B${encodeURIComponent(address)}" target="_blank" rel="noopener">Itinéraire</a>`);
    links.push(`<a class="action-link gold" href="https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes" target="_blank" rel="noopener">Waze</a>`);
  }
  if (phone) links.push(`<a class="action-link secondary" href="sms:${phone}">SMS collègue</a>`);
  if (get(row, "N° rencontre") || get(row, "Warning FBI")) {
    links.push(`<a class="action-link secondary" href="https://extranet.ffbb.com/fbi/connexion.fbi" target="_blank" rel="noopener">FBI</a>`);
  }
  return links.length ? `<div class="actions">${links.join("")}</div>` : "";
}

function renderPaymentControl(row) {
  const uid = escapeHtml(get(row, "UID"));
  const current = get(row, "Statut paiement") || "À recevoir";
  const prevu = get(row, "Date paiement");
  return `
    <div class="payment-row">
      <div>
        <strong>Statut paiement</strong>
        <div class="card-sub">${escapeHtml(prevu ? "Prévu : " + prevu : "Date à vérifier")}</div>
      </div>
      <select class="payment-select" data-uid="${uid}">
        ${PAYMENT_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${s === current ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
      </select>
    </div>`;
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

function renderPaiements() {
  const root = document.getElementById("paiements");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte").sort(sortByPaymentThenDate);
  if (!rows.length) { root.innerHTML = empty("Aucun paiement pour cette saison."); return; }

  const grouped = groupBy(rows, r => get(r, "Statut paiement") || "À recevoir");
  const order = ["À recevoir", "Écart à vérifier", "À vérifier", "Reçu"];

  const totalDu = rows.filter(r => (get(r, "Statut paiement") || "À recevoir") !== "Reçu").reduce((t, r) => t + r._amount, 0);
  const totalRecu = rows.filter(r => get(r, "Statut paiement") === "Reçu").reduce((t, r) => t + r._amount, 0);

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><label>En attente de paiement</label><strong>${formatMoney(totalDu)}</strong></div>
      <div class="kpi"><label>Déjà reçu</label><strong>${formatMoney(totalRecu)}</strong></div>
    </div>
    ${order.filter(k => grouped[k]).map(status => `
      <h2 class="section-title">${escapeHtml(status)} <span class="count">${grouped[status].length}</span></h2>
      <div class="cards">${grouped[status].map(renderMatchCard).join("")}</div>`).join("")}
  `;
  attachCardListeners(root);
  attachPaymentListeners(root);
}

function attachPaymentListeners(root) {
  root.querySelectorAll(".payment-select").forEach(select => {
    select.addEventListener("change", async e => {
      const uid = e.target.dataset.uid, status = e.target.value;
      e.target.disabled = true;
      setStatus("Mise à jour du paiement…", "");
      try {
        const res = await jsonp("updatePaymentStatus", { uid, status });
        if (!res.success) throw new Error(res.error || "Erreur update");
        const row = state.allRows.find(r => get(r, "UID") === uid);
        if (row) {
          row["Statut paiement"] = status;
          if (status === "Reçu") {
            row["Date réception"] = new Date().toLocaleDateString("fr-FR");
            if (!get(row, "Montant reçu")) row["Montant reçu"] = get(row, "Indemnité totale");
          }
          if (status === "À recevoir") { row["Date réception"] = ""; row["Montant reçu"] = ""; }
        }
        setStatus("Paiement mis à jour", "ok");
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

function renderStats() {
  const root = document.getElementById("stats");
  const s = state.serverStats;

  if (!s || !s.totaux || s.totaux.missions === undefined) {
    root.innerHTML = renderStatsClient();
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

    ${renderRecords(rec)}
    ${renderAggTable("Par saison", s.par_saison, "Saison")}
    ${renderAggTable("Par mois", s.par_mois, "Mois")}
    ${renderAggTable("Par niveau", s.par_niveau, "Niveau")}
    ${renderTop("Top clubs (5×5)", s.top_clubs)}
    ${renderTop("Top salles (5×5)", s.top_salles)}
    ${renderTop("Top villes", s.top_villes)}
    ${renderTop("Top collègues (5×5)", s.top_collegues)}
    ${renderAggTable("Événements 3×3", s.evenements_3x3, "Événement")}
  `;
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

function renderTop(title, rows) {
  if (!rows || !rows.length) return "";
  return `
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th class="num">Nombre</th><th class="num">Indemnités</th><th class="num">Net réel</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td><td class="num">${formatMoney(r.indemnite)}</td><td class="num pos">${formatMoney(r.net_reel)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
}

function renderStatsClient() {
  const rows = state.filteredRows.filter(r => r._isActive && r._format !== "Alerte");
  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._km, r._date), 0);
  return `
    <div class="kpi-grid">
      <div class="kpi hero"><label>Revenu net réel</label><strong>${formatMoney(gross - cost)}</strong><span class="sub">${rows.length} mission(s)</span></div>
      <div class="kpi"><label>Indemnités brutes</label><strong>${formatMoney(gross)}</strong></div>
      <div class="kpi"><label>Carburant réel</label><strong>−${formatMoney(cost)}</strong></div>
    </div>
    <div class="stat-note">Statistiques détaillées en cours de chargement depuis le serveur…</div>`;
}

/* ---------------- Alertes ---------------- */

function renderAlertes() {
  const root = document.getElementById("alertes");
  const rows = state.filteredRows.filter(r =>
    r._format === "Alerte" || hasWarning(r) || cleanText(get(r, "Statut paiement")) === "À vérifier"
  ).sort(sortByDateAsc);
  if (!rows.length) { root.innerHTML = empty("Aucune alerte pour cette saison."); return; }
  root.innerHTML = `<h2 class="section-title">Alertes <span class="count">${rows.length}</span></h2><div class="cards">${rows.map(renderMatchCard).join("")}</div>`;
  attachCardListeners(root);
  attachPaymentListeners(root);
}

/* ---------------- Export ---------------- */

function renderExport() {
  const root = document.getElementById("export");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte" && r._isActive);
  const gross = rows.reduce((t, r) => t + r._amount, 0);
  const cost = rows.reduce((t, r) => t + realFuelCostClient(r._km, r._date), 0);
  const five = rows.filter(r => r._format === "5x5"), three = rows.filter(r => r._format === "3x3");

  const text = [
    `REFEREE TRACKER — EXPORT`,
    `Saison : ${state.selectedSeason}`,
    ``,
    `Indemnités brutes : ${formatMoney(gross)}`,
    `Coût carburant réel : ${formatMoney(cost)}`,
    `REVENU NET RÉEL : ${formatMoney(gross - cost)}`,
    `KM total A/R : ${formatNumber(rows.reduce((t, r) => t + r._km, 0), " km")}`,
    `Matchs 5×5 : ${five.length} · Tournois 3×3 : ${three.length}`,
    ``,
    `Détail :`,
    ...rows.slice().sort(sortByDateAsc).map(r => {
      const c = realFuelCostClient(r._km, r._date);
      return `- ${get(r, "Date match")} ${get(r, "Heure/RDV")} | ${r._format} | ${firstValue(r, ["Recevant", "Visiteur / événement"])} | ind ${formatMoney(r._amount)} | carb ${formatMoney(c)} | net ${formatMoney(r._amount - c)} | ${formatNumber(r._km, " km")}`;
    })
  ].join("\n");

  root.innerHTML = `
    <h2 class="section-title">Export copiable</h2>
    <textarea class="export-box" readonly>${escapeHtml(text)}</textarea>
    <div class="actions"><button class="small-btn" type="button" id="copyExportBtn">Copier</button></div>`;
  document.getElementById("copyExportBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); setStatus("Export copié", "ok"); }
    catch { setStatus("Copie impossible — sélectionne le texte manuellement", "error"); }
  });
}

/* ---------------- Coût carburant client ----------------
   Doit rester cohérent avec le serveur (Code.gs) :
   Peugeot 108 → 6,58 L/100 avant le 01/08/2026
   Audi A3     → 6,00 L/100 à partir du 01/08/2026
   Prix carburant : modifier FUEL ci-dessous ET dans Code.gs.
------------------------------------------------------- */
function realFuelCostClient(km, date) {
  const k = Number(km) || 0;
  if (!k) return 0;
  const FUEL = 1.95;
  const cutover = new Date(2026, 7, 1);
  const conso = (date && date >= cutover) ? 6.0 : 6.58;
  return round2((k * conso / 100) * FUEL);
}

/* ---------------- Utils ---------------- */

function get(row, key) { return row && row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : ""; }
function firstValue(row, keys) { for (const k of keys) { const v = get(row, k); if (v) return v; } return ""; }
function hasWarning(row) { return Boolean(get(row, "Warning général") || get(row, "Warning finance") || get(row, "Warning FBI")); }
function formatColleague(row) { const n = get(row, "Collègue nom"), r = get(row, "Collègue rôle"), p = get(row, "Collègue téléphone"); return n ? [n, r, p].filter(Boolean).join(" — ") : ""; }
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
function onlyDigits(v) { return String(v || "").replace(/[^\d+]/g, ""); }
function escapeHtml(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function sortByDateAsc(a, b) { return (a._date ? a._date.getTime() : 0) - (b._date ? b._date.getTime() : 0); }
function sortByDateDesc(a, b) { return sortByDateAsc(b, a); }
function sortByPaymentThenDate(a, b) {
  const pa = PAYMENT_STATUSES.indexOf(get(a, "Statut paiement")), pb = PAYMENT_STATUSES.indexOf(get(b, "Statut paiement"));
  return pa !== pb ? pa - pb : sortByDateAsc(a, b);
}
function groupBy(rows, fn) { return rows.reduce((acc, r) => { const k = fn(r) || "Autre"; (acc[k] = acc[k] || []).push(r); return acc; }, {}); }
