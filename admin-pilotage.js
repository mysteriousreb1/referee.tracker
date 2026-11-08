/* Referee Tracker — admin « Pilotage » (b74) : tableau de bord type Power BI.
   Données : Edge Function « admin-pilotage » (admin + double authentification). Tout est calculé ici, dans le navigateur.
   3 onglets : Vue d'ensemble · Analyses & Tops · Performance arbitres. Filtres : saison, arbitre, payeur. SVG maison, aucune librairie. */
"use strict";
(function () {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => Number(String(v == null ? "" : v).replace(",", ".")) || 0;
  const eur = (v, dec) => (Number(v) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: dec ? 2 : 0, minimumFractionDigits: dec ? 2 : 0 });
  const k = (v) => { v = Number(v) || 0; return Math.abs(v) >= 10000 ? (v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k€" : eur(v); };
  const nb = (v) => (Number(v) || 0).toLocaleString("fr-FR");
  const pc = (v) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %");
  const PAYEURS = { cd67: "Comité (CD67)", region: "Ligue (LRGEB)", federation: "Fédération (CF)", parts_egales: "Clubs", recevante: "Clubs", benevole: "Bénévole" };
  const COUL = ["#1F4E9C", "#FFC400", "#2FA36B", "#E4572E", "#8E6CEF", "#17A2B8", "#9AA5B8"];
  const MOIS = ["sept", "oct", "nov", "déc", "janv", "févr", "mars", "avr", "mai", "juin", "juil", "août"];
  const S = { onglet: "vue", saison: "", arbitre: "", payeur: "" };

  /* ---------- préparation ---------- */
  function preparer(d) {
    const prof = {}; (d.profils || []).forEach((p) => { prof[p.user_id] = p; });
    const nom = (id) => { const p = prof[id] || {}; const pr = String(p.prenom || "").trim(); let no = String(p.nom_ffbb || "").trim(); if (pr) no = no.split(/\s+/).filter((w) => w.toUpperCase() !== pr.toUpperCase()).join(" "); return (pr + " " + no.toUpperCase()).trim() || "Arbitre " + String(id).slice(0, 4); };
    const L = (d.matchs || []).filter((m) => m.statut !== "Annulé" && m.saison && /^\d{4}\/\d{4}$/.test(m.saison)).map((m) => {
      const ind = n(m.indemnite_totale), ben = m.statut_paiement === "Bénévole" || m.regime === "benevole";
      let recu = m.statut_paiement === "Reçu" ? ind : n(m.recu_recevant) + n(m.recu_visiteur) || n(m.montant_recu);
      if (recu > ind && ind) recu = ind;
      const dm = m.date_match ? new Date(m.date_match + "T12:00:00") : null, dr = m.date_reception ? new Date(String(m.date_reception).slice(0, 10) + "T12:00:00") : null;
      return { u: m.user_id, nom: nom(m.user_id), saison: m.saison, d: dm, mi: dm ? (dm.getMonth() + 4) % 12 : -1, format: m.format || "Autre", payeur: PAYEURS[m.regime] || "Autre",
        comp: String(m.code_competition || m.niveau_administratif || "Autre").replace(/-\d+$/, "").slice(0, 18) || "Autre", ville: String(m.ville || "").trim() || "—",
        ind: ben ? 0 : ind, recu: ben ? 0 : recu, reste: ben ? 0 : Math.max(0, ind - recu), ben, km: n(m.km_a_r_stats), delai: dm && dr ? Math.max(0, Math.round((dr - dm) / 864e5)) : null };
    });
    const saisons = [...new Set(L.map((x) => x.saison))].sort();
    return { L, prof, nom, saisons, evals: d.evals || [], conn: d.conn || [], genere: d.genere };
  }
  const prec = (s) => { const y = Number(String(s).slice(0, 4)) - 1; return y + "/" + (y + 1); };
  const somme = (l, f) => l.reduce((a, x) => a + (typeof f === "function" ? f(x) : x[f]), 0);
  const grouper = (l, f) => { const o = {}; l.forEach((x) => { const c = f(x); (o[c] = o[c] || []).push(x); }); return o; };
  /* « à date » : même jour de saison l'an passé. */
  const jourSaison = (d) => { const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return Math.floor((d - new Date(y, 6, 1)) / 864e5); };

  /* ---------- graphiques SVG ---------- */
  function donut(series, titre) {
    const tot = somme(series, "v") || 1; let a0 = -Math.PI / 2; const R = 62, r = 38, cx = 80, cy = 80;
    const arcs = series.filter((s) => s.v > 0).map((s, i) => {
      const a1 = a0 + (s.v / tot) * Math.PI * 2, gr = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr, a) => (cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2);
      const path = s.v >= tot ? `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${COUL[i % 7]}" stroke-width="${R - r}"/>` : `<path d="M ${p(R, a0)} A ${R} ${R} 0 ${gr} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${gr} 0 ${p(r, a0)} Z" fill="${COUL[i % 7]}"><title>${esc(s.l)} : ${esc(k(s.v))}</title></path>`;
      a0 = a1; return path;
    }).join("");
    return `<div class="pb-card"><h4>${esc(titre)}</h4><div class="pb-donut"><svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="${esc(titre)}">${arcs}<text x="80" y="78" class="pb-dc">${esc(k(tot))}</text><text x="80" y="94" class="pb-dl">total</text></svg>
      <ul class="pb-leg">${series.filter((s) => s.v > 0).map((s, i) => `<li><i style="background:${COUL[i % 7]}"></i><span>${esc(s.l)}</span><b>${esc(k(s.v))}</b><small>${Math.round((s.v / tot) * 100)} %</small></li>`).join("")}</ul></div></div>`;
  }
  function vbarres(series, titre, actif) {
    const max = Math.max(1, ...series.map((s) => s.v));
    return `<div class="pb-card"><h4>${esc(titre)}</h4><div class="pb-vb">${series.map((s) => `<div class="pb-vb-c"><span class="pb-vb-v">${esc(k(s.v))}</span><i class="${s.l === actif ? "on" : s.v === 0 ? "nul" : ""}" style="height:${Math.max(2, (s.v / max) * 100)}%"></i><span class="pb-vb-l">${esc(s.l)}</span></div>`).join("")}</div></div>`;
  }
  function hbarres(series, titre, fmt, max) {
    const m = Math.max(1, ...series.map((s) => s.v));
    return `<div class="pb-card"><h4>${esc(titre)}</h4><div class="pb-hb">${series.slice(0, max || 15).map((s) => `<div class="pb-hb-l"><span title="${esc(s.l)}">${esc(s.l)}</span><i style="width:${Math.max(1, (s.v / m) * 100)}%"></i><b>${esc((fmt || k)(s.v))}</b></div>`).join("") || '<p class="pb-vide">Aucune donnée</p>'}</div></div>`;
  }
  function courbe(a, b, titre, la, lb) {   // a = N, b = N-1 : 12 valeurs (sept → août)
    const W = 900, H = 230, P = 34, max = Math.max(1, ...a.filter((v) => v != null), ...b), x = (i) => P + (i * (W - 2 * P)) / 11, y = (v) => H - 30 - (v / max) * (H - 70);
    const lisse = (v) => v.map((val, i) => val == null ? "" : (i && v[i - 1] != null ? " L " : " M ") + x(i).toFixed(1) + " " + y(val).toFixed(1)).join("");
    const pts = (v, cl) => v.map((val, i) => val ? `<circle cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="4" class="${cl}"><title>${MOIS[i]} : ${esc(eur(val))}</title></circle><text x="${x(i).toFixed(1)}" y="${(y(val) - 9).toFixed(1)}" class="pb-cv ${cl}">${esc(k(val))}</text>` : "").join("");
    return `<div class="pb-card pb-large"><h4>${esc(titre)}</h4><div class="pb-leg-h"><span><i class="pb-pa"></i>${esc(la)}</span><span><i class="pb-pb"></i>${esc(lb)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="pb-courbe" role="img" aria-label="${esc(titre)}"><path d="${lisse(b)}" class="pb-lb"/><path d="${lisse(a)}" class="pb-la"/>${pts(b, "pb-db")}${pts(a, "pb-da")}
      ${MOIS.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="pb-cx">${m}</text>`).join("")}</svg></div>`;
  }
  const spark = (v) => { const max = Math.max(1, ...v), W = 110, H = 28; return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="pb-spark"><path d="${v.map((val, i) => (i ? "L" : "M") + ((i * W) / (v.length - 1)).toFixed(1) + " " + (H - 3 - (val / max) * (H - 6)).toFixed(1)).join(" ")}"/></svg>`; };
  const tuile = (lib, val, sub, cl) => `<div class="pb-kpi ${cl || ""}"><span>${esc(lib)}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const ecart = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const fleche = (v) => v == null ? '<em class="pb-eq">—</em>' : v > 2 ? `<em class="pb-up">▲ ${esc(pc(v))}</em>` : v < -2 ? `<em class="pb-down">▼ ${esc(pc(v))}</em>` : `<em class="pb-eq">▬ ${esc(pc(v))}</em>`;

  /* ---------- rendu ---------- */
  function render(el, data, opts) {
    const D = data._prep || (data._prep = preparer(data));
    if (!S.saison || !D.saisons.includes(S.saison)) S.saison = D.saisons[D.saisons.length - 1] || "";
    const filtre = (x) => (!S.arbitre || x.u === S.arbitre) && (!S.payeur || x.payeur === S.payeur);
    const N = D.L.filter((x) => x.saison === S.saison && filtre(x)), N1s = prec(S.saison), N1 = D.L.filter((x) => x.saison === N1s && filtre(x));
    const auj = new Date(), jour = jourSaison(auj), enCours = S.saison === D.saisons[D.saisons.length - 1];
    const N1ad = enCours ? N1.filter((x) => x.d && jourSaison(x.d) <= jour) : N1;
    const arbitres = [...new Set(D.L.map((x) => x.u))].map((u) => ({ u, nom: D.nom(u) })).sort((a, b) => a.nom.localeCompare(b.nom));
    const payeurs = [...new Set(D.L.map((x) => x.payeur))].sort();
    const sel = (id, lib, val, opts2) => `<label class="pb-f"><span>${lib}</span><select id="${id}">${opts2.map((o) => `<option value="${esc(o[0])}"${o[0] === val ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>`;
    const tete = `<div class="pb-head"><div class="pb-titre"><span class="pb-logo">RT</span><h2>TABLEAU DE BORD DES ARBITRES</h2></div>
      <div class="pb-tabs">${[["vue", "Vue d'ensemble"], ["tops", "Analyses & Tops"], ["perf", "Performance arbitres"]].map(([c, l]) => `<button data-pb-tab="${c}" class="${S.onglet === c ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="pb-bar"><h3>${S.onglet === "vue" ? "SYNTHÈSE DES INDEMNITÉS & ENCAISSEMENTS" : S.onglet === "tops" ? "ANALYSE COMPARATIVE & TOPS" : "CLASSEMENT GÉNÉRAL DES ARBITRES"}</h3>
      <div class="pb-filtres">${sel("pbSaison", "Saison", S.saison, D.saisons.slice().reverse().map((s) => [s, s]))}${sel("pbArb", "Arbitre", S.arbitre, [["", "Tous"]].concat(arbitres.map((a) => [a.u, a.nom])))}${sel("pbPay", "Payeur", S.payeur, [["", "Tous"]].concat(payeurs.map((p) => [p, p])))}</div></div>`;
    const ind = somme(N, "ind"), recu = somme(N, "recu"), reste = somme(N, "reste"), km = somme(N, "km"), indN1 = somme(N1, "ind"), indN1ad = somme(N1ad, "ind");
    const payables = N.filter((x) => !x.ben && x.ind > 0), dl = N.filter((x) => x.delai != null);
    let corps = "";
    if (S.onglet === "vue") {
      corps = `<div class="pb-kpis">${tuile("Indemnités", esc(k(ind)), fleche(ecart(ind, indN1ad)) + " vs N-1 à date")}${tuile("Déjà reçu", esc(k(recu)), Math.round((recu / (ind || 1)) * 100) + " % encaissé")}${tuile("Reste à percevoir", esc(k(reste)), payables.filter((x) => x.reste > 0).length + " mission(s)", reste ? "warn" : "")}${tuile("Missions", nb(N.length), N.filter((x) => x.ben).length + " bénévole(s)")}${tuile("Km parcourus", nb(Math.round(km)), "aller-retour")}${tuile("Arbitres actifs", nb(new Set(N.map((x) => x.u)).size), "sur la saison")}${tuile("Indemnité moyenne", esc(eur(ind / (payables.length || 1))), "par mission payée")}</div>
        <div class="pb-grid4">${donut(Object.entries(grouper(N, (x) => x.payeur)).map(([l, v]) => ({ l, v: somme(v, "ind") })).sort((a, b) => b.v - a.v), "Indemnités par payeur")}
        ${donut(Object.entries(grouper(N, (x) => x.format)).map(([l, v]) => ({ l, v: somme(v, "ind") })).sort((a, b) => b.v - a.v), "Indemnités par format")}
        ${vbarres(D.saisons.slice(-6).map((s) => ({ l: s.slice(2, 4) + "/" + s.slice(7), v: somme(D.L.filter((x) => x.saison === s && filtre(x)), "ind") })), "Évolution par saison", S.saison.slice(2, 4) + "/" + S.saison.slice(7))}
        ${hbarres(Object.entries(grouper(N, (x) => x.comp)).map(([l, v]) => ({ l, v: somme(v, "ind") })).sort((a, b) => b.v - a.v), "Indemnités par compétition", k, 12)}</div>
        ${matrice(N, N1ad, enCours ? "N-1 à date" : "Indemn. N-1")}`;
    } else if (S.onglet === "tops") {
      const parMois = (l) => { const a = new Array(12).fill(0); l.forEach((x) => { if (x.mi >= 0) a[x.mi] += x.ind; }); return a.map((v) => Math.round(v * 100) / 100); };
      const moisCourant = N.filter((x) => x.d && x.d.getMonth() === auj.getMonth() && x.d.getFullYear() === auj.getFullYear());
      const top = (f) => Object.entries(grouper(N, f)).map(([l, v]) => ({ l, v: somme(v, "ind") })).sort((a, b) => b.v - a.v).slice(0, 5);
      corps = `<div class="pb-kpis">${tuile("Indemnités N", esc(k(ind)), esc(S.saison))}${tuile("Indemnités N-1", esc(k(indN1)), esc(N1s) + " complète")}${tuile("N-1 à date", esc(k(indN1ad)), enCours ? "même jour de saison" : "saison complète")}${tuile("Ce mois-ci", esc(k(somme(moisCourant, "ind"))), moisCourant.length + " mission(s)")}${tuile("Délai moyen de paiement", dl.length ? Math.round(somme(dl, "delai") / dl.length) + " j" : "—", "match → versement")}${tuile("Taux de variation", `<span class="${ecart(ind, indN1ad) < 0 ? "pb-down" : "pb-up"}">${esc(pc(ecart(ind, indN1ad)))}</span>`, "N vs N-1 à date")}</div>
        <div class="pb-grid3">${hbarres(top((x) => x.comp), "TOP 5 des compétitions", k)}${hbarres(top((x) => x.ville), "TOP 5 des villes", k)}${hbarres(top((x) => x.nom), "TOP 5 des arbitres", k)}</div>
        ${courbe(parMois(N).map((v, i) => (enCours && i > (auj.getMonth() + 4) % 12 ? null : v)), parMois(N1), "Évolution des indemnités par mois : N vs N-1", "Saison " + S.saison, "Saison " + N1s)}`;
    } else {
      corps = classement(D, N, N1ad, enCours ? "N-1 à date" : "N-1");
    }
    el.innerHTML = `<div class="pb">${tete}<div class="pb-body">${corps}</div><p class="pb-pied">Données au ${esc(new Date(D.genere).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))} · matchs annulés exclus · bénévolat compté en missions, pas en indemnités · « N-1 à date » = même jour de saison l'an passé.</p></div>`;
    el.querySelectorAll("[data-pb-tab]").forEach((b) => b.addEventListener("click", () => { S.onglet = b.dataset.pbTab; render(el, data, opts); }));
    [["pbSaison", "saison"], ["pbArb", "arbitre"], ["pbPay", "payeur"]].forEach(([id, c]) => { const s = el.querySelector("#" + id); if (s) s.addEventListener("change", () => { S[c] = s.value; render(el, data, opts); }); });
    el.querySelectorAll("[data-pb-cat]").forEach((r) => r.addEventListener("click", () => { const c = r.dataset.pbCat; el.querySelectorAll('[data-pb-sous="' + c + '"]').forEach((x) => x.classList.toggle("pb-cache")); r.classList.toggle("ferme"); }));
    el.querySelectorAll("[data-pb-u]").forEach((r) => r.addEventListener("click", () => { if (opts && opts.fiche) opts.fiche(r.dataset.pbU); }));
  }

  function matrice(N, N1, libN1) {
    const lignes = Object.entries(grouper(N, (x) => x.payeur)).map(([p, l]) => ({ p, l, ind: somme(l, "ind") })).sort((a, b) => b.ind - a.ind);
    const maxR = Math.max(1, ...N.map((x) => x.reste));
    const ligne = (lib, l, l1, cl, attr) => { const i = somme(l, "ind"), r = somme(l, "recu"), re = somme(l, "reste"), i1 = somme(l1, "ind"), t = i ? (r / i) * 100 : null;
      return `<tr class="${cl}"${attr || ""}><td>${lib}</td><td class="num">${nb(l.length)}</td><td class="num">${esc(eur(i))}</td><td class="num mut">${esc(eur(i1))}</td><td class="num pb-cell-recu">${esc(eur(r))}</td><td class="num"><span class="pb-cellbar" style="--w:${Math.round((re / Math.max(maxR, re || 1)) * 100)}%">${esc(eur(re))}</span></td><td class="num">${t == null ? "—" : (t >= 90 ? '<em class="pb-up">▲</em> ' : t >= 50 ? '<em class="pb-eq">▬</em> ' : '<em class="pb-down">▼</em> ') + Math.round(t) + " %"}</td><td class="num">${fleche(ecart(i, i1))}</td></tr>`; };
    return `<div class="pb-card pb-large"><h4>Détail par payeur et par compétition</h4><div class="pb-tbl"><table><thead><tr><th>Payeur / compétition</th><th class="num">Missions</th><th class="num">Indemn. N</th><th class="num">${esc(libN1)}</th><th class="num">Reçu</th><th class="num">Reste</th><th class="num">Encaissé</th><th class="num">Var. N-1</th></tr></thead><tbody>
      ${lignes.map((g, gi) => ligne(`<span class="pb-tog">⊟</span> <b>${esc(g.p)}</b>`, g.l, N1.filter((x) => x.payeur === g.p), "pb-cat", ` data-pb-cat="${gi}"`) +
        Object.entries(grouper(g.l, (x) => x.comp)).sort((a, b) => somme(b[1], "ind") - somme(a[1], "ind")).map(([c, l]) => ligne('<span class="pb-sous">' + esc(c) + "</span>", l, N1.filter((x) => x.payeur === g.p && x.comp === c), "", ` data-pb-sous="${gi}"`)).join("")).join("")}
      ${ligne("<b>Total</b>", N, N1, "pb-tot")}</tbody></table></div></div>`;
  }

  function classement(D, N, N1, libN1) {
    const notes = grouper(D.evals.filter((e) => n(e.note_20) > 0 && e.saison === S.saison), (e) => e.user_id);
    const j30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const usage = grouper(D.conn.filter((c) => String(c.jour) >= j30), (c) => c.user_id);
    const L = Object.entries(grouper(N, (x) => x.u)).map(([u, l]) => {
      const l1 = N1.filter((x) => x.u === u), i = somme(l, "ind"), r = somme(l, "recu"), mois = new Array(10).fill(0);
      l.forEach((x) => { if (x.mi >= 0 && x.mi < 10) mois[x.mi] += x.ind; });
      const ev = notes[u] || [];
      return { u, nom: D.nom(u), niveau: (D.prof[u] || {}).niveau || "", nbm: l.length, i, i1: somme(l1, "ind"), r, reste: somme(l, "reste"), km: somme(l, "km"), t: i ? (r / i) * 100 : null, note: ev.length ? somme(ev, (e) => n(e.note_20)) / ev.length : null, min: somme(usage[u] || [], (c) => n(c.minutes)), mois };
    }).sort((a, b) => b.i - a.i);
    const ini = (s) => s.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
    const etoile = (t) => t == null ? "" : t >= 90 ? '<span class="pb-star on">★</span>' : '<span class="pb-star">☆</span>';
    return `<div class="pb-card pb-large"><div class="pb-tbl"><table class="pb-rank"><thead><tr><th>Rang</th><th>Arbitre</th><th class="num">Missions</th><th class="num">Indemn. N</th><th class="num">${esc(libN1)}</th><th class="num">Reçu</th><th class="num">Reste</th><th class="num">Encaissé</th><th class="num">Var. N-1</th><th class="num">Km</th><th class="num">Note obs.</th><th class="num">Usage 30 j</th><th>Évolution (sept → juin)</th></tr></thead><tbody>
      ${L.map((a, i) => `<tr data-pb-u="${esc(a.u)}" class="clic"><td class="pb-rg">${i + 1}</td><td><span class="pb-av">${esc(ini(a.nom))}</span><b>${esc(a.nom)}</b>${a.niveau ? `<small>${esc(a.niveau)}</small>` : ""}</td><td class="num">${a.nbm}</td><td class="num"><b>${esc(eur(a.i))}</b></td><td class="num mut">${esc(eur(a.i1))}</td><td class="num">${etoile(a.t)} ${esc(eur(a.r))}</td><td class="num">${esc(eur(a.reste))}</td><td class="num">${a.t == null ? "—" : Math.round(a.t) + " %"}</td><td class="num">${fleche(ecart(a.i, a.i1))}</td><td class="num">${nb(Math.round(a.km))}</td><td class="num">${a.note == null ? "—" : a.note.toFixed(1) + "/20"}</td><td class="num">${a.min ? (a.min >= 60 ? Math.floor(a.min / 60) + " h " + String(Math.round(a.min % 60)).padStart(2, "0") : Math.round(a.min) + " min") : "—"}</td><td>${spark(a.mois)}</td></tr>`).join("") || '<tr><td colspan="13" class="pb-vide">Aucun arbitre sur ces filtres</td></tr>'}
    </tbody></table></div><p class="pb-note">★ = au moins 90 % encaissé · Note obs. = moyenne des évaluations /20 de la saison · clic sur une ligne = fiche arbitre.</p></div>`;
  }

  window.RT_PILOTAGE = { render };
})();
