/* © 2026 Clément REBHOLZ — Referee Tracker. Tous droits réservés.
   b88 — Équipement & frais de l'arbitre (tenue, chaussures, matériel, licence, formation).
   Données : table Supabase `depenses` (RLS : chaque arbitre ne voit que ses lignes).
   Factures : bucket privé `factures/<identifiant>/…` (lien temporaire de 5 min pour les ouvrir).
   Lecture automatique des factures PDF (FFBB Store et format générique) par pdf.js, dans le navigateur :
   rien n'est envoyé à un service tiers. */
(function () {
  "use strict";
  const CATS = [["tenue", "Tenue"], ["chaussures", "Chaussures"], ["materiel", "Matériel"], ["licence", "Licence / cotisation"], ["formation", "Formation"], ["peage", "Péage"], ["parking", "Parking"], ["deplacement", "Autre frais de trajet"], ["autre", "Autre"]];
  const FRAIS_MATCH = ["peage", "parking", "deplacement"];
  const libCat = k => (CATS.find(c => c[0] === k) || [k, k])[1];
  const num = v => { const n = Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const r2 = n => Math.round(n * 100) / 100;
  const esc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
  const eur = n => (typeof formatMoney === "function" ? formatMoney(n) : r2(n) + " €");
  const ST = { liste: null, charge: false, brouillon: null, fichier: null, msg: "" };

  // Saison sportive d'une date ISO (bascule au 30 juillet, comme le moteur)
  function saisonDe(iso) {
    const d = new Date(iso + "T12:00:00"); if (isNaN(d)) return "?";
    const y = d.getFullYear(), bascule = new Date(y, 6, 30);
    return d >= bascule ? y + "/" + (y + 1) : (y - 1) + "/" + y;
  }
  function saisonCourante() { const d = new Date(); return saisonDe(d.toISOString().slice(0, 10)); }

  async function charger(force) {
    if (ST.charge && !force) return;
    ST.charge = true;
    try { ST.liste = await SB.get("depenses?select=*&order=date_achat.desc,id.desc&limit=1000"); ST.msg = ""; }
    catch (e) {
      ST.charge = false;   // b88.1 — session pas encore prête au démarrage : nouvel essai automatique
      if (/session/i.test(e.message || "") && (ST.essais = (ST.essais || 0) + 1) < 15) { setTimeout(() => charger(false), 1500); return; }
      ST.liste = []; ST.msg = "Lecture impossible : " + e.message;
    }
    window.RT_EQUIPEMENT = ST.liste;
    rendre();
    try { if (state.activeTab !== "equipement" && typeof renderAllSoon_ === "function") renderAllSoon_(); } catch (e) {}
  }

  /* ---------- Lecture d'une facture PDF ---------- */
  async function texteDuPdf(file) {
    const lib = await chargerPdfJs_();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise;
    const lignes = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
      const page = await pdf.getPage(p), tc = await page.getTextContent(), parY = {};
      tc.items.forEach(it => { const y = Math.round(it.transform[5] / 3) * 3; (parY[y] = parY[y] || []).push(it); });
      Object.keys(parY).map(Number).sort((a, b) => b - a).forEach(y => {
        lignes.push(parY[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
      });
    }
    return lignes.filter(Boolean);
  }
  function lireFacture(lignes) {
    const tout = lignes.join("\n"), out = { lignes: [] };
    const iso = s => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + "-" + m[2] + "-" + m[1] : ""; };
    const iDate = lignes.findIndex(l => /date de facturation|^facture\b/i.test(l));
    out.date = iDate >= 0 ? (iso(lignes[iDate]) || iso(lignes.slice(iDate, iDate + 3).join(" "))) : "";
    if (!out.date) out.date = iso(tout);
    const mNum = tout.match(/#?\b(FA\d{4,})\b/) || tout.match(/(?:facture|invoice)\s*(?:n[°o]\s*)?[:#]?\s*([A-Z0-9-]{5,20})/i);
    out.numero = mNum ? mNum[1] : "";
    out.fournisseur = /FFBB\s?STORE/i.test(tout) ? "FFBB Store" : "";
    const PRIX = /\d{1,3}(?:[ \u202f]\d{3})*,\d{2}\s?€/g;
    const prix = s => (s.match(PRIX) || []).map(x => num(x.replace("€", "")));
    // Total TTC : dernière ligne « Total … € » qui n'est ni « Total produits » ni « Total (HT) »
    const tot = lignes.filter(l => /(^|\s)Total\s+(TTC\s+)?\d/.test(l) && !/produits|\(HT\)|HT\b/i.test(l));
    out.total = tot.length ? prix(tot[tot.length - 1]).pop() || 0 : 0;
    const port = lignes.find(l => /frais de (livraison|port|exp[ée]dition)/i.test(l));
    const tva = /20[.,]?0*\s?%/.test(tout) ? 1.2 : 1;
    out.port = port ? r2((prix(port).pop() || 0) * (/\bHT\b|\(HT\)/i.test(tout) ? tva : 1)) : 0;
    // Lignes produits : « RÉF  LIBELLÉ  20 %  … prix … qté  total »
    for (let i = 0; i < lignes.length; i++) {
      const m = lignes[i].match(/^([A-Z]{3,8}\d{1,5})\s+(.+?)\s+\d{1,2}\s?%\s+(.*)$/);
      if (!m) continue;
      let lib = m[2].replace(/\s+/g, " ").trim();
      const suite = lignes[i + 1] || "";
      if (suite && !/^[A-Z]{3,8}\d/.test(suite) && !/€|d[ée]tail|taxe|total/i.test(suite) && suite.length < 60) lib += " " + suite.trim();
      const p = prix(m[3]), q = (m[3].match(/\s(\d{1,3})\s+\d{1,3}(?:[ \u202f]\d{3})*,\d{2}\s?€\s*$/) || [])[1];
      out.lignes.push({ ref: m[1], libelle: lib.slice(0, 120), qte: Number(q) || 1, total_ht: p.length ? p[p.length - 1] : 0 });
    }
    const txt = out.lignes.map(l => l.libelle).join(" ").toUpperCase();
    out.categorie = /CHEMISE|PANTALON|VESTE|CEINTURE|T-?SHIRT|MAILLOT|SHORT|POLO|SURVET/.test(txt) ? "tenue"
      : /CHAUSSURE|BASKET\b/.test(txt) ? "chaussures" : /SIFFLET|TROLLEY|SAC|CHRONO|CARTON/.test(txt) ? "materiel" : "tenue";
    const court = l => {
      const t = (l.libelle.match(/taille[^:]*:\s*([A-Z0-9]{1,4})/i) || [])[1] || "";
      const n = l.libelle.replace(/\(.*?\)/g, "").replace(/\b(ARBITRES?|FFBB|OFFICIEL(LE)?S?|HOMME|FEMME|20\d\d)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
      return (n.charAt(0).toUpperCase() + n.slice(1)) + (t ? " " + t.toUpperCase() : "") + (l.qte > 1 ? " ×" + l.qte : "");
    };
    out.libelle = out.lignes.length ? out.lignes.slice(0, 5).map(court).join(", ").slice(0, 155) + (out.lignes.length > 5 ? "…" : "") : "";
    return out;
  }

  /* ---------- Rendu ---------- */
  function rendre() {
    const root = document.getElementById("equipement");
    if (!root || !root.classList.contains("active")) return;
    if (ST.liste === null) { root.innerHTML = '<h2 class="section-title">Équipement</h2><p class="card-sub">Chargement…</p>'; charger(); return; }
    const L = ST.liste, sc = saisonCourante();
    const deSaison = L.filter(x => saisonDe(x.date_achat) === sc), total = L.reduce((t, x) => t + num(x.montant_ttc), 0), totS = deSaison.reduce((t, x) => t + num(x.montant_ttc), 0);
    const indemS = (state.allRows || []).filter(r => r._season === sc && r._isActive && r._format !== "Alerte").reduce((t, r) => t + (r._amount || 0), 0);
    const parSaison = {}; L.forEach(x => { const s = saisonDe(x.date_achat); (parSaison[s] = parSaison[s] || []).push(x); });
    const parCat = {}; L.forEach(x => { parCat[x.categorie] = (parCat[x.categorie] || 0) + num(x.montant_ttc); });
    const b = ST.brouillon || {};
    root.innerHTML = `
      <h2 class="section-title">Équipement &amp; frais <span class="count">${L.length}</span></h2>
      <div class="kpi-grid">
        <div class="kpi hero"><label>Dépensé cette saison (${esc(sc)})</label><strong>${eur(totS)}</strong><span class="sub">${indemS ? Math.round(totS / indemS * 100) + " % de tes indemnités de la saison" : "aucune indemnité cette saison"}</span></div>
        <div class="kpi"><label>Total depuis le début</label><strong>${eur(total)}</strong></div>
        <div class="kpi"><label>Achats</label><strong>${L.length}</strong></div>
        <div class="kpi"><label>Gain de la saison après équipement</label><strong>${eur(indemS - totS)}</strong><span class="sub">indemnités − équipement (hors carburant)</span></div>
      </div>
      ${Object.keys(parCat).length ? `<div class="eq-cats">${Object.keys(parCat).sort((a, c) => parCat[c] - parCat[a]).map(k => `<span class="eq-cat eq-cat--${esc(k)}">${esc(libCat(k))} <b>${eur(parCat[k])}</b></span>`).join("")}</div>` : ""}

      <div class="table-card eq-ajout">
        <div class="eq-ajout-t"><strong>Ajouter un achat</strong><span class="card-sub">Dépose la facture : date, montant, frais de port et articles sont lus automatiquement (PDF). Une photo est aussi acceptée.</span></div>
        <label class="eq-drop" for="eqFichier"><input id="eqFichier" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" />
          <span>${ST.fichier ? "Fichier : " + esc(ST.fichier.name) : "Choisir une facture (PDF, JPG, PNG — 5 Mo max)"}</span></label>
        <form id="eqForm" class="toolbar form-formation" style="align-items:end">
          <div class="field"><label for="eqDate">Date d'achat</label><input id="eqDate" type="date" required value="${esc(b.date || "")}" /></div>
          <div class="field"><label for="eqFour">Boutique</label><input id="eqFour" type="text" maxlength="80" placeholder="FFBB Store, Decathlon…" value="${esc(b.fournisseur || "")}" /></div>
          <div class="field"><label for="eqCat">Catégorie</label><select id="eqCat">${CATS.map(([k, l]) => `<option value="${k}"${(b.categorie || "tenue") === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="field" style="min-width:240px;flex:2"><label for="eqLib">Articles</label><input id="eqLib" type="text" required maxlength="160" placeholder="Chemise noire M, pantalon S…" value="${esc(b.libelle || "")}" /></div>
          <div class="field"><label for="eqMt">Total payé (€ TTC)</label><input id="eqMt" type="text" inputmode="decimal" required placeholder="68,35" value="${b.total ? String(b.total).replace(".", ",") : ""}" /></div>
          <div class="field"><label for="eqPort">dont livraison (€)</label><input id="eqPort" type="text" inputmode="decimal" placeholder="0" value="${b.port ? String(b.port).replace(".", ",") : ""}" /></div>
          <div class="field"><label for="eqNum">N° de facture</label><input id="eqNum" type="text" maxlength="40" value="${esc(b.numero || "")}" /></div>
          <button class="small-btn" type="submit" id="eqSave">Enregistrer</button>
        </form>
        ${b.lignes && b.lignes.length ? `<p class="card-sub">Lu sur la facture : ${b.lignes.length} article(s)${b.total ? " · total " + eur(b.total) : ""}${b.port ? " · livraison " + eur(b.port) : ""}</p>` : ""}
        <p class="card-sub" id="eqMsg">${esc(ST.msg || "")}</p>
      </div>

      ${L.length ? Object.keys(parSaison).sort().reverse().map(s => {
        const it = parSaison[s], ts = it.reduce((t, x) => t + num(x.montant_ttc), 0);
        return `<h3 class="section-title" style="margin-top:16px">Saison ${esc(s)} <span class="count">${eur(ts)}</span></h3>
        <div class="eq-liste">${it.map(x => `<article class="eq-item">
          <div class="eq-date"><strong>${esc(x.date_achat.split("-").reverse().join("/"))}</strong><span>${esc(x.fournisseur || "")}</span></div>
          <div class="eq-main"><span class="eq-cat eq-cat--${esc(x.categorie)}">${esc(libCat(x.categorie))}</span><p>${esc(x.libelle)}</p>
            ${Array.isArray(x.lignes) && x.lignes.length ? `<details><summary>${x.lignes.length} article(s)</summary><ul>${x.lignes.map(l => `<li>${esc(l.libelle)}${l.qte > 1 ? " ×" + l.qte : ""}${l.total_ht ? " — " + eur(l.total_ht) + " HT" : ""}</li>`).join("")}</ul></details>` : ""}
            ${x.numero_facture ? `<small>Facture ${esc(x.numero_facture)}</small>` : ""}</div>
          <div class="eq-side"><strong>${eur(num(x.montant_ttc))}</strong>${num(x.frais_port) ? `<small>dont ${eur(num(x.frais_port))} de port</small>` : ""}
            <div class="eq-act">${x.facture_path ? `<button type="button" class="action-link gold" data-eq-voir="${esc(x.facture_path)}">Facture</button>` : `<label class="action-link secondary eq-joindre">Joindre<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" data-eq-joindre="${x.id}" /></label>`}
            <button type="button" class="action-link" data-eq-suppr="${x.id}">Supprimer</button></div></div>
        </article>`).join("")}</div>`;
      }).join("") : (typeof empty === "function" ? empty("Aucun achat enregistré. Dépose ta première facture ci-dessus.") : "")}
      <p class="card-sub" style="margin-top:12px">Garde tes factures : elles prouvent tes frais si tu dépasses un jour le plafond d'exonération (onglet Export → Année civile) ou si ton comité te rembourse une partie de la tenue. Information indicative.</p>`;
    brancher(root);
  }

  async function televerser(file) {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) throw new Error("Fichier trop lourd (5 Mo maximum)");
    const sub = rtSubDuJeton_(), t = await SB.token();
    if (!sub || !t) throw new Error("Session expirée");
    const nom = (Date.now() + "_" + file.name).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
    const r = await fetch(SB_URL + "/storage/v1/object/factures/" + encodeURIComponent(sub) + "/" + encodeURIComponent(nom), { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
    if (!r.ok) throw new Error("Envoi de la facture impossible (" + r.status + ")");
    return sub + "/" + nom;
  }

  function brancher(root) {
    const dire = (t, err) => { ST.msg = t; const m = root.querySelector("#eqMsg"); if (m) { m.textContent = t; m.classList.toggle("is-err", !!err); } };
    const inp = root.querySelector("#eqFichier");
    if (inp) inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      ST.fichier = f;
      if (f.type === "application/pdf") {
        try {
          dire("Lecture de la facture…");
          const d = lireFacture(await texteDuPdf(f));
          ST.brouillon = Object.assign({}, ST.brouillon || {}, Object.fromEntries(Object.entries(d).filter(([, v]) => v && (!Array.isArray(v) || v.length))));
          ST.msg = d.total ? "Facture lue : vérifie les champs puis Enregistrer." : "Facture déposée : complète les champs (lecture partielle).";
        } catch (e) { ST.msg = "Lecture automatique impossible : complète les champs."; }
      } else ST.msg = "Photo déposée : complète les champs.";
      rendre();
    });
    const form = root.querySelector("#eqForm");
    if (form) form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const v = id => (root.querySelector("#" + id).value || "").trim();
      const ligne = { date_achat: v("eqDate"), fournisseur: v("eqFour") || null, categorie: v("eqCat"), libelle: v("eqLib"), montant_ttc: r2(num(v("eqMt"))), frais_port: r2(num(v("eqPort"))), numero_facture: v("eqNum") || null, lignes: (ST.brouillon && ST.brouillon.lignes) || [] };
      if (!ligne.date_achat || !ligne.libelle || !(ligne.montant_ttc > 0)) { dire("Date, articles et montant sont obligatoires.", true); return; }
      if (ligne.frais_port > ligne.montant_ttc) { dire("Les frais de livraison dépassent le total.", true); return; }
      const btn = root.querySelector("#eqSave"); btn.disabled = true;
      try {
        dire("Enregistrement…");
        ligne.facture_path = await televerser(ST.fichier);
        await SB.write("POST", "depenses", ligne);
        ST.brouillon = null; ST.fichier = null; ST.msg = "Achat enregistré.";
        if (typeof setStatus === "function") setStatus("Achat d'équipement enregistré", "ok");
        await charger(true);
      } catch (e) { btn.disabled = false; dire(e.message || "Échec", true); }
    });
    root.querySelectorAll("[data-eq-voir]").forEach(bt => bt.addEventListener("click", async () => {
      try {
        const t = await SB.token(), chemin = bt.dataset.eqVoir;
        const r = await fetch(SB_URL + "/storage/v1/object/sign/factures/" + chemin.split("/").map(encodeURIComponent).join("/"), { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }) });
        const j = await r.json(); if (!r.ok || !j.signedURL) throw new Error("Lien indisponible");
        window.open(SB_URL + "/storage/v1" + j.signedURL, "_blank", "noopener");
      } catch (e) { if (typeof setStatus === "function") setStatus(e.message, "error"); }
    }));
    root.querySelectorAll("[data-eq-joindre]").forEach(fi => fi.addEventListener("change", async () => {
      const f = fi.files && fi.files[0]; if (!f) return;
      try { const p = await televerser(f); await SB.write("PATCH", "depenses?id=eq." + Number(fi.dataset.eqJoindre), { facture_path: p, updated_at: new Date().toISOString() }); if (typeof setStatus === "function") setStatus("Facture jointe", "ok"); await charger(true); }
      catch (e) { if (typeof setStatus === "function") setStatus(e.message, "error"); }
    }));
    root.querySelectorAll("[data-eq-suppr]").forEach(bt => bt.addEventListener("click", async () => {
      const x = (ST.liste || []).find(y => String(y.id) === bt.dataset.eqSuppr); if (!x) return;
      if (!confirm("Supprimer l'achat « " + x.libelle + " » (" + eur(num(x.montant_ttc)) + ") et sa facture ?")) return;
      try {
        if (x.facture_path) { const t = await SB.token(); await fetch(SB_URL + "/storage/v1/object/factures/" + x.facture_path.split("/").map(encodeURIComponent).join("/"), { method: "DELETE", headers: { apikey: SB_KEY, Authorization: "Bearer " + t } }); }
        await SB.write("DELETE", "depenses?id=eq." + Number(x.id));
        await charger(true);
      } catch (e) { if (typeof setStatus === "function") setStatus(e.message, "error"); }
    }));
  }


  /* ---------- b88 — frais de déplacement d'un match (péage, parking) ---------- */
  const fraisDe = uid => (ST.liste || []).filter(x => x.match_uid === uid && FRAIS_MATCH.indexOf(x.categorie) >= 0);
  window.rtFraisMatch = uid => fraisDe(uid).reduce((t, x) => t + num(x.montant_ttc), 0);
  window.rtFraisMatchHtml = function (row) {
    const uid = get(row, "UID"); if (!uid || get(row, "Format") === "Alerte") return "";
    const l = fraisDe(uid);
    return `<div class="frais-match" data-fm="${esc(uid)}" data-fm-date="${row._date ? row._date.toISOString().slice(0, 10) : ""}">
      <span class="frais-match-t">Péage, parking</span>
      ${l.map(x => `<span class="frais-chip">${esc(libCat(x.categorie))} <b>${eur(num(x.montant_ttc))}</b><button type="button" aria-label="Supprimer" data-fm-del="${x.id}">×</button></span>`).join("")}
      <button type="button" class="frais-add" data-fm-add>+ Ajouter</button>
      <form class="frais-form" hidden><select aria-label="Type"><option value="peage">Péage</option><option value="parking">Parking</option><option value="deplacement">Autre (train, ticket…)</option></select>
        <input type="text" inputmode="decimal" placeholder="Montant €" aria-label="Montant" required maxlength="8"><button type="submit" class="small-btn">OK</button></form>
    </div>`;
  };
  document.addEventListener("click", async ev => {
    const t = ev.target; if (!t || !t.closest) return;
    const box = t.closest(".frais-match"); if (!box) return;
    ev.stopPropagation();
    if (t.closest("[data-fm-add]")) { const f = box.querySelector(".frais-form"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); return; }
    const del = t.closest("[data-fm-del]");
    if (del) { try { await SB.write("DELETE", "depenses?id=eq." + Number(del.dataset.fmDel)); await charger(true); } catch (e) { if (typeof setStatus === "function") setStatus(e.message, "error"); } }
  });
  document.addEventListener("submit", async ev => {
    const f = ev.target; if (!f || !f.classList || !f.classList.contains("frais-form")) return;
    ev.preventDefault(); ev.stopPropagation();
    const box = f.closest(".frais-match"), cat = f.querySelector("select").value, mt = r2(num(f.querySelector("input").value));
    if (!(mt > 0 && mt < 1000)) { if (typeof setStatus === "function") setStatus("Montant invalide", "error"); return; }
    f.querySelector("button").disabled = true;
    try {
      await SB.write("POST", "depenses", { date_achat: box.dataset.fmDate || new Date().toISOString().slice(0, 10), categorie: cat, libelle: libCat(cat), montant_ttc: mt, match_uid: box.dataset.fm });
      if (typeof setStatus === "function") setStatus(libCat(cat) + " ajouté : déduit du net du match", "ok");
      await charger(true);
    } catch (e) { f.querySelector("button").disabled = false; if (typeof setStatus === "function") setStatus(e.message, "error"); }
  });
  // Chargement au démarrage (les cartes de match affichent les frais, le net en tient compte)
  setTimeout(function essai(n) { if (typeof SB !== "undefined" && SB.session) charger(false); else if (n < 20) setTimeout(() => essai(n + 1), 1500); }, 2500, 0);
  // Total d'équipement d'une année civile (utilisé par l'export annuel)
  window.rtEquipementAnnee = function (annee) { return (ST.liste || []).filter(x => String(x.date_achat).slice(0, 4) === String(annee) && FRAIS_MATCH.indexOf(x.categorie) < 0).reduce((t, x) => t + num(x.montant_ttc), 0); };
  window.rtEquipementCharger = () => charger(false);
  window.renderEquipement = rendre;
  window.__rtLireFacture = lireFacture;   // tests
})();
