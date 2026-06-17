const API_BASE_URL = "https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";

let allMatches = [];
let currentFilter = "upcoming";

const matchesList = document.getElementById("matchesList");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");

refreshBtn.addEventListener("click", loadMatches);

document.querySelectorAll(".filter-btn").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    currentFilter = button.dataset.filter;
    renderMatches();
  });
});

loadMatches();

function loadMatches() {
  statusBox.classList.remove("error");
  statusBox.textContent = "Chargement des données...";
  const url = `${API_BASE_URL}?key=${encodeURIComponent(API_KEY)}&action=matchs&v=${Date.now()}`;
  jsonp(url)
    .then(response => {
      if (!response.success) throw new Error(response.error || "Erreur API");
      allMatches = response.data || [];
      updateSummary();
      renderMatches();
      statusBox.textContent = `Données chargées : ${allMatches.length} ligne(s).`;
    })
    .catch(error => {
      statusBox.classList.add("error");
      statusBox.textContent = "Erreur de chargement : " + error.message;
      matchesList.innerHTML = "";
    });
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

function updateSummary() {
  const active = allMatches.filter(m => get(m, "Statut") === "Actif").length;
  const warnings = allMatches.filter(m => Boolean(get(m, "Warning général") || get(m, "Warning finance") || get(m, "Warning FBI"))).length;
  const amountDue = allMatches.filter(m => get(m, "Statut paiement") === "À recevoir").reduce((sum, m) => sum + toNumber(get(m, "Indemnité totale")), 0);
  document.getElementById("activeCount").textContent = active;
  document.getElementById("warningCount").textContent = warnings;
  document.getElementById("amountDue").textContent = formatMoney(amountDue);
}

function renderMatches() {
  const filtered = getFilteredMatches();
  if (!filtered.length) {
    matchesList.innerHTML = `<div class="empty">Aucun match à afficher.</div>`;
    return;
  }
  matchesList.innerHTML = filtered.map(match => renderMatchCard(match)).join("");
}

function getFilteredMatches() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let result = [...allMatches];
  if (currentFilter === "upcoming") {
    result = result.filter(m => {
      const d = parseDate(get(m, "Date match"));
      return d && d >= today && !isCancelled(m);
    });
  }
  if (currentFilter === "warnings") result = result.filter(m => Boolean(get(m, "Warning général") || get(m, "Warning finance") || get(m, "Warning FBI")));
  if (currentFilter === "payments") result = result.filter(m => get(m, "Statut paiement") === "À recevoir");
  if (currentFilter === "cancelled") result = result.filter(m => isCancelled(m));
  result.sort((a, b) => {
    const da = parseDateTime(get(a, "Date match"), get(a, "Heure/RDV"));
    const db = parseDateTime(get(b, "Date match"), get(b, "Heure/RDV"));
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
  return result;
}

function renderMatchCard(match) {
  const status = get(match, "Statut");
  const warningGeneral = get(match, "Warning général");
  const warningFinance = get(match, "Warning finance");
  const warningFbi = get(match, "Warning FBI");
  const hasWarning = warningGeneral || warningFinance || warningFbi;
  const cardClass = ["match-card", hasWarning ? "warning" : "", isCancelled(match) ? "cancelled" : ""].join(" ");
  const title = buildTitle(match);
  const date = formatDate(get(match, "Date match"));
  const time = get(match, "Heure/RDV");
  const address = get(match, "Adresse");
  const phone = cleanPhone(get(match, "Collègue téléphone"));

  return `
    <article class="${cardClass}">
      <div class="match-top">
        <div>
          <h2 class="match-title">${escapeHtml(title)}</h2>
          <div class="match-subtitle">${escapeHtml(get(match, "Salle"))}</div>
          <div>
            ${badge(get(match, "Format"))}
            ${badge(get(match, "Niveau administratif"))}
            ${badge(get(match, "Code compétition"))}
            ${statusBadge(status)}
          </div>
        </div>
        <div><strong>${escapeHtml(date)}</strong><br><span>${escapeHtml(time)}</span></div>
      </div>
      <div class="match-details">
        ${detail("N° rencontre", get(match, "N° rencontre"))}
        ${detail("Compétition", get(match, "Libellé compétition"))}
        ${detail("Recevant", get(match, "Recevant"))}
        ${detail("Visiteur / événement", get(match, "Visiteur / événement"))}
        ${detail("Adresse", address)}
        ${detail("Code e-Marque", get(match, "Code e-Marque"))}
        ${detail("Collègue", get(match, "Collègue nom"))}
        ${detail("Téléphone collègue", get(match, "Collègue téléphone"))}
        ${detail("Observateur", get(match, "Observateur"))}
        ${detail("Indemnisé par", get(match, "Indemnisé par"))}
      </div>
      ${renderFinanceBox(match)}
      ${renderWarningBox(warningGeneral, warningFinance, warningFbi)}
      <div class="actions">
        ${address ? `<a class="action-link" target="_blank" href="${wazeUrl(address)}">Ouvrir Waze</a>` : ""}
        ${phone ? `<a class="action-link secondary" href="sms:${phone}">SMS collègue</a>` : ""}
        ${shouldShowFbiButton(warningGeneral, warningFbi) ? `<a class="action-link warning" target="_blank" href="https://extranet.ffbb.com/fbi/connexion.fbi">Ouvrir FBI</a>` : ""}
      </div>
    </article>`;
}

function renderFinanceBox(match) {
  const indemnite = get(match, "Indemnité totale");
  const statutPaiement = get(match, "Statut paiement");
  const datePaiement = get(match, "Date paiement");
  const dateReception = get(match, "Date réception");
  const montantRecu = get(match, "Montant reçu");
  if (!indemnite && !statutPaiement && !datePaiement && !dateReception && !montantRecu) return "";
  return `<div class="finance-box">
    ${detail("Indemnité totale", indemnite ? formatMoney(toNumber(indemnite)) : "")}
    ${detail("Statut paiement", statutPaiement)}
    ${detail("Date paiement prévue", formatDate(datePaiement))}
    ${detail("Date réception", formatDate(dateReception))}
    ${detail("Montant reçu", montantRecu ? formatMoney(toNumber(montantRecu)) : "")}
  </div>`;
}

function renderWarningBox(warningGeneral, warningFinance, warningFbi) {
  if (!warningGeneral && !warningFinance && !warningFbi) return "";
  return `<div class="warning-box">
    ${warningGeneral ? `<div>⚠️ ${escapeHtml(warningGeneral)}</div>` : ""}
    ${warningFinance ? `<div>💶 ${escapeHtml(warningFinance)}</div>` : ""}
    ${warningFbi ? `<div>🏀 ${escapeHtml(warningFbi)}</div>` : ""}
  </div>`;
}

function buildTitle(match) {
  const format = get(match, "Format");
  const code = get(match, "Code compétition");
  const recevant = get(match, "Recevant");
  const visiteur = get(match, "Visiteur / événement");
  if (format === "3x3") return visiteur || get(match, "Libellé compétition") || "Mission 3x3";
  if (recevant || visiteur) return `${code || "Match"} — ${recevant || ""} vs ${visiteur || ""}`;
  return get(match, "Libellé compétition") || "Désignation";
}

function detail(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `<div class="detail-row"><div class="detail-label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`;
}
function badge(value) { return value ? `<span class="badge">${escapeHtml(value)}</span>` : ""; }
function statusBadge(status) {
  if (!status) return "";
  const s = String(status).toLowerCase();
  if (s.includes("annul")) return `<span class="badge cancelled">${escapeHtml(status)}</span>`;
  if (s.includes("vérifier") || s.includes("verifier") || s.includes("réponse") || s.includes("reponse")) return `<span class="badge warning">${escapeHtml(status)}</span>`;
  return `<span class="badge">${escapeHtml(status)}</span>`;
}
function shouldShowFbiButton(warningGeneral, warningFbi) { return `${warningGeneral || ""} ${warningFbi || ""}`.toLowerCase().includes("fbi"); }
function get(obj, key) { return obj && obj[key] !== undefined && obj[key] !== null ? String(obj[key]).trim() : ""; }
function parseDate(value) {
  if (!value) return null;
  const clean = String(value).split("T")[0];
  const d = new Date(clean + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function parseDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const date = String(dateValue).split("T")[0];
  const time = timeValue || "00:00";
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d;
}
function formatDate(value) {
  const d = parseDate(value);
  if (!d) return value || "";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatMoney(value) { return Number(value || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
function toNumber(value) {
  if (!value) return 0;
  const n = Number(String(value).replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}
function cleanPhone(value) { return String(value || "").replace(/[^\d+]/g, ""); }
function wazeUrl(address) { return "https://waze.com/ul?q=" + encodeURIComponent(address) + "&navigate=yes"; }
function isCancelled(match) { return String(get(match, "Statut")).toLowerCase().includes("annul"); }
function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
