
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";
const PAYMENT_STATUSES = ["À recevoir", "Reçu", "Écart à vérifier", "À vérifier"];

let allMatches = [];
let currentView = "home";

const appContent = document.getElementById("appContent");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");

refreshBtn.addEventListener("click", loadMatches);

document.querySelectorAll(".tab-btn").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    currentView = button.dataset.view;
    renderCurrentView();
  });
});

appContent.addEventListener("click", event => {
  const saveBtn = event.target.closest(".save-payment-btn");
  if (saveBtn) {
    const uid = saveBtn.dataset.uid;
    const select = [...document.querySelectorAll(".payment-select")].find(el => el.dataset.uid === uid);
    if (select) updatePaymentStatus(uid, select.value);
    return;
  }

  const copyBtn = event.target.closest(".copy-btn");
  if (copyBtn) {
    const box = document.getElementById("exportBox");
    if (box) {
      box.select();
      document.execCommand("copy");
      setStatus("Récap copié.", "success");
    }
    return;
  }

  const summary = event.target.closest(".match-summary");
  if (summary) summary.closest(".match-card").classList.toggle("open");
});

loadMatches();

function loadMatches() {
  setStatus("Chargement des données...", "");
  const url = `${API_BASE_URL}?key=${encodeURIComponent(API_KEY)}&action=matchs&v=${Date.now()}`;

  jsonp(url)
    .then(response => {
      if (!response.success) throw new Error(response.error || "Erreur API");
      allMatches = response.data || [];
      updateHeaderSummary();
      renderCurrentView();
      setStatus(`Données chargées : ${allMatches.length} ligne(s).`, "");
    })
    .catch(error => {
      setStatus("Erreur de chargement : " + error.message, "error");
      appContent.innerHTML = "";
    });
}

function updatePaymentStatus(uid, status) {
  setStatus("Mise à jour du statut paiement...", "");
  const url = `${API_BASE_URL}?key=${encodeURIComponent(API_KEY)}&action=updatePaymentStatus&uid=${encodeURIComponent(uid)}&status=${encodeURIComponent(status)}&v=${Date.now()}`;

  jsonp(url)
    .then(response => {
      if (!response.success) throw new Error(response.error || "Erreur de mise à jour");
      setStatus("Statut paiement mis à jour.", "success");
      loadMatches();
    })
    .catch(error => setStatus("Erreur mise à jour paiement : " + error.message, "error"));
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = "rtCallback_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const script = document.createElement("script");
    window[callbackName] = data => {
      delete window[callbackName];
      if (script.parentNode) document.body.removeChild(script);
      resolve(data);
    };
    script.onerror = () => {
      delete window[callbackName];
      if (script.parentNode) document.body.removeChild(script);
      reject(new Error("Impossible de contacter l'API"));
    };
    script.src = url + "&callback=" + callbackName;
    document.body.appendChild(script);
  });
}

function setStatus(message, type) {
  statusBox.classList.remove("error", "success");
  if (type) statusBox.classList.add(type);
  statusBox.textContent = message;
}

function renderCurrentView() {
  if (currentView === "home") renderHome();
  if (currentView === "payments") renderPayments();
  if (currentView === "stats") renderStats();
  if (currentView === "alerts") renderAlerts();
  if (currentView === "export") renderExport();
}

function rows() {
  return allMatches.map(normalizeMatch).filter(m => m.uid);
}

function workingRows() {
  return rows().filter(m => !m.isAlert && !m.isCancelled);
}

function updateHeaderSummary() {
  const r = rows();
  document.getElementById("activeCount").textContent = r.filter(m => m.status === "Actif").length;
  document.getElementById("warningCount").textContent = r.filter(m => m.hasWarning).length;
  document.getElementById("amountDue").textContent = formatMoney(r.filter(m => m.paymentStatus === "À recevoir").reduce((s, m) => s + m.amount, 0));
}

function renderHome() {
  const today = startOfDay(new Date());
  const upcoming = workingRows().filter(m => m.dateObj && m.dateObj >= today).sort((a, b) => a.dateTime - b.dateTime);
  const next = upcoming[0];

  appContent.innerHTML = `
    ${next ? renderNextMatch(next) : `<div class="empty">Aucun prochain match trouvé.</div>`}
    <h2 class="section-title">Matchs à venir</h2>
    <div class="match-list">${upcoming.length ? upcoming.map(renderMatchCard).join("") : `<div class="empty">Aucun match à venir.</div>`}</div>
  `;
}

function renderNextMatch(m) {
  return `
    <section class="next-card">
      <h2 class="next-title">Prochain match</h2>
      <div class="grid-two">
        <div>
          ${detail("Niveau", m.level)}
          ${detail("Recevant", m.home)}
          ${detail("Date", `${m.dateLabel} ${m.time ? "• " + m.time : ""}`)}
          ${detail("Salle", m.hall)}
          ${detail("Adresse", m.address)}
        </div>
        <div>
          ${detail("Collègue", m.colleague)}
          ${detail("Téléphone", m.colleaguePhoneDisplay)}
          ${detail("Indemnité", m.amount ? formatMoney(m.amount) : "")}
          ${detail("Statut paiement", m.paymentStatus)}
        </div>
      </div>
      <div class="actions">
        ${m.address ? `<a class="action-link" target="_blank" href="${wazeUrl(m.address)}">Ouvrir Waze</a>` : ""}
        ${m.colleaguePhone ? `<a class="action-link secondary" href="sms:${m.colleaguePhone}">SMS collègue</a>` : ""}
        ${m.shouldShowFbi ? `<a class="action-link warning" target="_blank" href="https://extranet.ffbb.com/fbi/connexion.fbi">Ouvrir FBI</a>` : ""}
      </div>
    </section>
  `;
}

function renderMatchCard(m) {
  return `
    <article class="match-card">
      <button class="match-summary" type="button">
        <div class="match-summary-main">
          <div class="summary-line-1">${badge(m.level)} ${badge(m.format)}</div>
          <div class="summary-line-2">${escapeHtml(m.home || m.title)}</div>
        </div>
        <div class="match-summary-side">
          <span class="date-pill">${escapeHtml(m.dateLabel)} ${m.time ? "• " + escapeHtml(m.time) : ""}</span>
          <span class="chevron">›</span>
        </div>
      </button>
      <div class="match-body">
        <div class="match-details">
          ${detail("Compétition", m.competition)}
          ${detail("Recevant", m.home)}
          ${detail("Visiteur / événement", m.away)}
          ${detail("Salle", m.hall)}
          ${detail("Adresse", m.address)}
          ${detail("Code e-Marque", m.emarque)}
          ${detail("Collègue", m.colleague)}
          ${detail("Téléphone collègue", m.colleaguePhoneDisplay)}
          ${detail("Observateur", m.observer)}
        </div>
        ${renderFinanceBox(m)}
        ${renderWarningBox(m)}
        <div class="actions">
          ${m.address ? `<a class="action-link" target="_blank" href="${wazeUrl(m.address)}">Ouvrir Waze</a>` : ""}
          ${m.colleaguePhone ? `<a class="action-link secondary" href="sms:${m.colleaguePhone}">SMS collègue</a>` : ""}
          ${m.shouldShowFbi ? `<a class="action-link warning" target="_blank" href="https://extranet.ffbb.com/fbi/connexion.fbi">Ouvrir FBI</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderFinanceBox(m) {
  if (!m.amount && !m.paymentStatus && !m.paymentDate && !m.receiptDate && !m.receivedAmount) return "";
  const options = PAYMENT_STATUSES.map(st => `<option value="${escapeAttr(st)}" ${st === m.paymentStatus ? "selected" : ""}>${escapeHtml(st)}</option>`).join("");
  return `
    <div class="finance-box">
      ${detail("Indemnité totale", m.amount ? formatMoney(m.amount) : "")}
      ${detail("Statut paiement", m.paymentStatus)}
      ${detail("Date paiement prévue", formatDateDisplay(m.paymentDate))}
      ${detail("Date réception", formatDateDisplay(m.receiptDate))}
      ${detail("Montant reçu", m.receivedAmount ? formatMoney(m.receivedAmount) : "")}
      <div class="payment-editor">
        <label>Modifier paiement</label>
        <select class="payment-select" data-uid="${escapeAttr(m.uid)}">${options}</select>
        <button class="save-payment-btn" data-uid="${escapeAttr(m.uid)}" type="button">Enregistrer</button>
      </div>
    </div>
  `;
}

function renderWarningBox(m) {
  if (!m.warningGeneral && !m.warningFinance && !m.warningFbi) return "";
  return `
    <div class="warning-box">
      ${m.warningGeneral ? `<div>⚠️ ${escapeHtml(m.warningGeneral)}</div>` : ""}
      ${m.warningFinance ? `<div>💶 ${escapeHtml(m.warningFinance)}</div>` : ""}
      ${m.warningFbi ? `<div>🏀 ${escapeHtml(m.warningFbi)}</div>` : ""}
    </div>
  `;
}

function renderPayments() {
  const r = workingRows().sort((a, b) => b.dateTime - a.dateTime);
  const due = r.filter(m => m.paymentStatus === "À recevoir");
  const received = r.filter(m => m.paymentStatus === "Reçu");
  const check = r.filter(m => ["À vérifier", "Écart à vérifier"].includes(m.paymentStatus));
  appContent.innerHTML = `
    <h2 class="section-title">Paiements</h2>
    ${paymentBlock("À recevoir", due)}
    ${paymentBlock("Reçu", received)}
    ${paymentBlock("À vérifier / écart", check)}
  `;
}

function paymentBlock(title, r) {
  return `<section class="panel"><h3 class="sub-title">${escapeHtml(title)} — ${formatMoney(sum(r, "amount"))}</h3><div class="match-list">${r.length ? r.map(renderPaymentCard).join("") : `<div class="empty">Aucun élément.</div>`}</div></section>`;
}

function renderPaymentCard(m) {
  return `
    <article class="match-card">
      <div class="match-body" style="display:block;border-top:none;">
        <div class="match-details">
          ${detail("Date", `${m.dateLabel} ${m.time ? "• " + m.time : ""}`)}
          ${detail("Niveau", m.level)}
          ${detail("Recevant", m.home)}
          ${detail("Indemnité", m.amount ? formatMoney(m.amount) : "")}
          ${detail("Date paiement prévue", formatDateDisplay(m.paymentDate))}
          ${detail("Statut paiement", m.paymentStatus)}
        </div>
        ${renderFinanceBox(m)}
      </div>
    </article>
  `;
}

function renderStats() {
  const r = workingRows().filter(m => m.dateObj);
  const totalAmount = sum(r, "amount");
  const totalKm = sum(r, "km");
  const count = r.length;
  const byWeekend = groupRows(r, m => weekendKey(m.dateObj), m => weekendLabel(m.dateObj));
  const byMonth = groupRows(r, m => monthKey(m.dateObj), m => monthLabel(m.dateObj));
  const bySeason = groupRows(r, m => m.season || "Sans saison", m => m.season || "Sans saison");
  const rec = computeRecords(r);

  appContent.innerHTML = `
    <h2 class="section-title">Statistiques</h2>
    <section class="grid-three">
      ${kpi("Total indemnités", formatMoney(totalAmount))}
      ${kpi("Total kilomètres", `${formatNumber(totalKm)} km`)}
      ${kpi("Matchs arbitrés", count)}
      ${kpi("Moyenne indemnité / match", formatMoney(count ? totalAmount / count : 0))}
      ${kpi("Moyenne KM / match", `${formatNumber(count ? totalKm / count : 0)} km`)}
      ${kpi("Saisons suivies", new Set(r.map(m => m.season).filter(Boolean)).size)}
    </section>

    <h3 class="section-title">Records / analyse</h3>
    <section class="grid-two">
      ${kpi("Salle la plus fréquentée", rec.topHall)}
      ${kpi("Ville la plus fréquente", rec.topCity)}
      ${kpi("Club recevant le plus arbitré", rec.topClub)}
      ${kpi("Niveau le plus arbitré", rec.topLevel)}
      ${kpi("Collègue le plus fréquent", rec.topColleague)}
      ${kpi("Plus gros déplacement", rec.maxKm)}
      ${kpi("Plus grosse indemnité", rec.maxAmount)}
      ${kpi("Mois le plus chargé", rec.topMonth)}
      ${kpi("Week-end le plus chargé", rec.topWeekend)}
    </section>

    <h3 class="section-title">Indemnités et KM par week-end</h3>${renderAggTable(byWeekend)}
    <h3 class="section-title">Indemnités et KM par mois</h3>${renderAggTable(byMonth)}
    <h3 class="section-title">Indemnités et KM par saison</h3>${renderAggTable(bySeason)}

    <h3 class="section-title">Top 5</h3>
    <section class="grid-two">
      ${renderTopTable("Top clubs", topCounts(r, "home"))}
      ${renderTopTable("Top salles", topCounts(r, "hall"))}
      ${renderTopTable("Top villes", topCounts(r, "city"))}
      ${renderTopTable("Top collègues", topCounts(r, "colleague"))}
    </section>
  `;
}

function renderAggTable(groups) {
  const r = [...groups.values()].sort((a, b) => b.sortValue - a.sortValue);
  if (!r.length) return `<div class="empty">Aucune donnée.</div>`;
  return `
    <table class="table"><thead><tr><th>Période</th><th>Matchs</th><th>Indemnités</th><th>KM</th></tr></thead>
    <tbody>${r.map(g => `<tr><td>${escapeHtml(g.label)}</td><td>${g.count}</td><td>${escapeHtml(formatMoney(g.amount))}</td><td>${escapeHtml(formatNumber(g.km))} km</td></tr>`).join("")}</tbody></table>
  `;
}

function renderTopTable(title, r) {
  return `
    <div><h4 class="sub-title">${escapeHtml(title)}</h4>
    <table class="table"><thead><tr><th>Nom</th><th>Nb</th></tr></thead>
    <tbody>${r.length ? r.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${x.count}</td></tr>`).join("") : `<tr><td colspan="2">Aucune donnée</td></tr>`}</tbody></table></div>
  `;
}

function renderAlerts() {
  const alertRows = rows().filter(m => m.hasWarning || m.isAlert);
  appContent.innerHTML = `
    <h2 class="section-title">Alertes</h2>
    <div class="match-list">${alertRows.length ? alertRows.map(renderAlertCard).join("") : `<div class="empty">Aucune alerte.</div>`}</div>
  `;
}

function renderAlertCard(m) {
  return `<article class="panel">${detail("Date", m.dateLabel)}${detail("Niveau", m.level)}${detail("Recevant", m.home)}${detail("Sujet", m.title)}${renderWarningBox(m)}${m.shouldShowFbi ? `<div class="actions"><a class="action-link warning" target="_blank" href="https://extranet.ffbb.com/fbi/connexion.fbi">Ouvrir FBI</a></div>` : ""}</article>`;
}

function renderExport() {
  appContent.innerHTML = `
    <h2 class="section-title">Export récap</h2>
    <section class="panel">
      <button class="copy-btn" type="button">Copier le récap</button><br><br>
      <textarea id="exportBox" class="export-box">${escapeHtml(buildExportText())}</textarea>
    </section>
  `;
}

function buildExportText() {
  const r = workingRows().filter(m => m.dateObj);
  const bySeason = groupRows(r, m => m.season || "Sans saison", m => m.season || "Sans saison");
  const seasonLines = [...bySeason.values()].sort((a, b) => String(a.label).localeCompare(String(b.label))).map(g => `- ${g.label} : ${g.count} match(s), ${formatMoney(g.amount)}, ${formatNumber(g.km)} km`).join("\n");
  return `RÉCAP ARBITRAGE

Total matchs : ${r.length}
Total indemnités : ${formatMoney(sum(r, "amount"))}
Total KM : ${formatNumber(sum(r, "km"))} km

À recevoir : ${formatMoney(sum(r.filter(m => m.paymentStatus === "À recevoir"), "amount"))}
Reçu : ${formatMoney(sum(r.filter(m => m.paymentStatus === "Reçu"), "amount"))}

Par saison :
${seasonLines}`;
}

function normalizeMatch(raw) {
  const dateValue = get(raw, "Date match");
  const dateObj = parseDate(dateValue);
  const time = normalizeTime(get(raw, "Heure/RDV"));
  const dateTime = parseDateTime(dateValue, time);
  const warningGeneral = normalizeWarning(get(raw, "Warning général"));
  const warningFinance = normalizeWarning(get(raw, "Warning finance"));
  const warningFbi = normalizeWarning(get(raw, "Warning FBI"));
  const address = cleanAddressForDisplay(get(raw, "Adresse"));
  const phone = cleanPhone(get(raw, "Collègue téléphone"));
  const format = get(raw, "Format");
  const competition = get(raw, "Libellé compétition");
  const home = get(raw, "Recevant");
  const away = get(raw, "Visiteur / événement");
  const title = format === "3x3" ? away || competition || "Mission 3x3" : home || competition || "Désignation";

  return {
    raw,
    uid: get(raw, "UID") || get(raw, "Unique_Key"),
    source: get(raw, "Source"),
    format,
    season: get(raw, "Saison"),
    status: get(raw, "Statut"),
    dateObj,
    dateTime: dateTime || new Date(0),
    dateLabel: formatDateDisplay(dateValue),
    time,
    level: get(raw, "Niveau administratif"),
    competition,
    code: get(raw, "Code compétition"),
    home,
    away,
    title,
    hall: get(raw, "Salle"),
    address,
    city: get(raw, "Ville") || extractCityFromAddress(address),
    emarque: get(raw, "Code e-Marque"),
    colleague: get(raw, "Collègue nom"),
    colleaguePhone: phone,
    colleaguePhoneDisplay: phone ? formatPhoneDisplay(phone) : "",
    observer: get(raw, "Observateur"),
    km: toNumber(get(raw, "Km A/R stats")),
    amount: toNumber(get(raw, "Indemnité totale")),
    paymentDate: get(raw, "Date paiement"),
    paymentStatus: get(raw, "Statut paiement"),
    receiptDate: get(raw, "Date réception"),
    receivedAmount: toNumber(get(raw, "Montant reçu")),
    warningGeneral,
    warningFinance,
    warningFbi,
    hasWarning: Boolean(warningGeneral || warningFinance || warningFbi),
    isAlert: ["Alerte", "PDF", "FBI", "Mail"].includes(format) || get(raw, "Type compétition") === "Alerte",
    isCancelled: String(get(raw, "Statut")).toLowerCase().includes("annul"),
    shouldShowFbi: `${warningGeneral} ${warningFbi}`.toLowerCase().includes("fbi")
  };
}

function computeRecords(r) {
  const maxKm = maxBy(r, "km");
  const maxAmount = maxBy(r, "amount");
  const byMonth = groupRows(r, m => monthKey(m.dateObj), m => monthLabel(m.dateObj));
  const topMonth = [...byMonth.values()].sort((a, b) => b.count - a.count)[0];
  const byWeekend = groupRows(r, m => weekendKey(m.dateObj), m => weekendLabel(m.dateObj));
  const topWeekend = [...byWeekend.values()].sort((a, b) => b.count - a.count)[0];

  return {
    topHall: topCounts(r, "hall")[0]?.label || "—",
    topCity: topCounts(r, "city")[0]?.label || "—",
    topClub: topCounts(r, "home")[0]?.label || "—",
    topLevel: topCounts(r, "level")[0]?.label || "—",
    topColleague: topCounts(r, "colleague")[0]?.label || "—",
    maxKm: maxKm ? `${maxKm.title || maxKm.city || "Déplacement"} — ${formatNumber(maxKm.km)} km` : "—",
    maxAmount: maxAmount ? `${maxAmount.title || maxAmount.level || "Match"} — ${formatMoney(maxAmount.amount)}` : "—",
    topMonth: topMonth ? `${topMonth.label} — ${topMonth.count} match(s)` : "—",
    topWeekend: topWeekend ? `${topWeekend.label} — ${topWeekend.count} match(s)` : "—"
  };
}

function groupRows(r, keyFn, labelFn) {
  const map = new Map();
  r.forEach(m => {
    const key = keyFn(m);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, label: labelFn(m), sortValue: m.dateObj ? m.dateObj.getTime() : 0, count: 0, amount: 0, km: 0 });
    const g = map.get(key);
    g.count += 1;
    g.amount += m.amount || 0;
    g.km += m.km || 0;
  });
  return map;
}

function topCounts(r, field) {
  const map = new Map();
  r.forEach(m => {
    const value = String(m[field] || "").trim();
    if (value) map.set(value, (map.get(value) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, label: `${name} — ${count}`, count }));
}

function maxBy(r, field) {
  return r.filter(m => Number(m[field]) > 0).sort((a, b) => b[field] - a[field])[0];
}

function sum(r, field) {
  return r.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function kpi(label, value) {
  return `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function detail(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `<div class="detail-row"><div class="detail-label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`;
}

function badge(value) {
  if (!value) return "";
  return `<span class="badge">${escapeHtml(value)}</span>`;
}

function normalizeWarning(value) {
  const text = String(value || "").trim();
  const simplified = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (!text) return "";
  if (["NON", "NO", "N", "FALSE", "0", "OUI", "YES", "Y", "TRUE", "1"].includes(simplified)) return "";
  return text;
}

function cleanAddressForDisplay(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\s+B\.\s*GROUPEMENT SPORTIF VISITEUR\s*:.*$/i, "");
  text = text.replace(/\s+GROUPEMENT SPORTIF VISITEUR\s*:.*$/i, "");
  text = text.replace(/\s+Correspondant\s*:.*$/i, "");
  text = text.replace(/\s+Téléphone\(s\)\s*:.*$/i, "");
  text = text.replace(/\s+Telephone\(s\)\s*:.*$/i, "");
  text = text.replace(/\s+C\.\s*Arbitre.*$/i, "");
  text = text.replace(/\(T[ée]l\.?\s*:?\s*[^)]*\)/gi, "");
  text = text.replace(/\(Tel\.?\s*:?\s*[^)]*\)/gi, "");
  return text.replace(/\s+/g, " ").trim();
}

function get(obj, key) {
  return obj && obj[key] !== undefined && obj[key] !== null ? String(obj[key]).trim() : "";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return pad2(m[1]) + ":" + pad2(m[2]);
  m = text.match(/T(\d{1,2}):(\d{2})/);
  if (m) return pad2(m[1]) + ":" + pad2(m[2]);
  m = text.match(/\b(\d{1,2})h(\d{0,2})\b/i);
  if (m) return pad2(m[1]) + ":" + pad2(m[2] || "00");
  return text;
}

function parseDate(value) {
  if (!value) return null;
  let text = String(value).trim().replace(/^[a-zà-ÿ]{3,9}\.?\s+/i, "");
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${pad2(m[2])}-${pad2(m[1])}T00:00:00`);
  return null;
}

function parseDateTime(dateValue, timeValue) {
  const d = parseDate(dateValue);
  if (!d) return null;
  const m = (normalizeTime(timeValue) || "00:00").match(/(\d{1,2}):(\d{2})/);
  if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

function formatDateDisplay(value) {
  const d = parseDate(value);
  if (!d || isNaN(d.getTime())) return value || "";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function toNumber(value) {
  if (!value) return 0;
  const n = Number(String(value).replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function cleanPhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length === 9) digits = "0" + digits;
  return digits;
}

function formatPhoneDisplay(value) {
  const digits = cleanPhone(value);
  if (digits.length !== 10) return digits;
  return digits.replace(/(\d{2})(?=\d)/g, "$1.").replace(/\.$/, "");
}

function wazeUrl(address) {
  return "https://waze.com/ul?q=" + encodeURIComponent(address) + "&navigate=yes";
}

function extractCityFromAddress(address) {
  const m = String(address || "").match(/\b\d{5}\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)$/i);
  return m ? m[1].trim() : "";
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function monthKey(d) {
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` : "";
}

function monthLabel(d) {
  return d ? d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
}

function weekendStart(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diffToSaturday = day === 0 ? -1 : 6 - day;
  x.setDate(x.getDate() + diffToSaturday);
  return x;
}

function weekendKey(d) {
  const w = weekendStart(d);
  return w.toISOString().slice(0, 10);
}

function weekendLabel(d) {
  const w = weekendStart(d);
  return "Week-end du " + w.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function pad2(value) {
  return String(value || "0").padStart(2, "0");
}
