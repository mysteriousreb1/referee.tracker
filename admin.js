/* Referee Tracker — interface d'administration (b60).
   Accès : compte présent dans la table `admins` + double authentification (TOTP, session aal2).
   Toutes les données passent par l'Edge Function « admin », qui journalise chaque action. */
"use strict";
(function () {
  const SB_URL = "https://jlstedchnmdteazuqbly.supabase.co";
  const SB_KEY = "sb_publishable_B1w244FrkzbIn-SZ-T_z8w_4HVg9stb";   // clé publique (publiable par conception)
  const STORE = "rt_sb_session";                                       // même session que l'app
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const voir = (id) => ["vLogin", "vMfa", "vAdmin"].forEach((v) => $(v).classList.toggle("hidden", v !== id));
  const fmt = (d) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

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
  async function admin(action, extra) {
    const t = await jeton();
    const r = await fetch(SB_URL + "/functions/v1/admin", { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, extra || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "Erreur " + r.status);
    return j;
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
      // Nettoie un enrôlement abandonné puis en crée un nouveau.
      for (const f of (u.factors || []).filter((f) => f.status !== "verified")) { try { await auth("factors/" + f.id, "DELETE"); } catch (e) {} }
      const e = await auth("factors", "POST", { factor_type: "totp", friendly_name: "Admin Referee Tracker" });
      facteur = e.id;
      $("qr").innerHTML = '<img alt="QR code" src="' + esc(e.totp.qr_code) + '">';
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

  // ---------- écrans ----------
  let liste = [];
  async function charger() {
    $("msg").textContent = "";
    const j = await admin("overview");
    liste = j.data || [];
    $("tbl").querySelector("tbody").innerHTML = liste.map((u) => {
      const etat = [u.banni ? '<span class="tag err">suspendu</span>' : u.invite ? '<span class="tag warn">invité</span>' : '<span class="tag ok">actif</span>',
        u.mfa ? '<span class="tag">2FA</span>' : "", u.admin ? '<span class="tag">admin</span>' : "", u.cgu.length ? '<span class="tag">CGU ' + esc(u.cgu.join(", ")) + "</span>" : '<span class="tag warn">CGU non acceptées</span>',
        u.appareils ? '<span class="tag">' + u.appareils + " appareil(s)</span>" : "", u.tickets_ouverts ? '<span class="tag warn">' + u.tickets_ouverts + " ticket(s)</span>" : ""].join("");
      const p = u.profil || {};
      return "<tr><td><strong>" + esc(p.prenom || "—") + "</strong><br><span class=\"mut\">" + esc(u.email) + "</span><br><span class=\"mut\">créé " + fmt(u.cree) + " · vu " + fmt(u.derniere_connexion) + "</span></td>" +
        "<td>" + etat + "</td><td>" + u.matchs + "</td><td>" + fmt(u.derniere_maj) + "</td>" +
        "<td>" + esc(p.adresse_reception || "—") + "<br><span class=\"mut\">" + (p.api_url ? "moteur ✓" : "<span class=\"warn\">pas de moteur</span>") + "</span></td>" +
        '<td><div class="row"><button data-act="matchs" data-id="' + u.id + '">Matchs</button><button data-act="profil" data-id="' + u.id + '">Profil</button>' +
        (u.admin ? "" : '<button data-act="' + (u.banni ? "reactiver" : "suspendre") + '" data-id="' + u.id + '">' + (u.banni ? "Réactiver" : "Suspendre") + "</button>") + "</div></td></tr>";
    }).join("");
  }
  function dialogue(titre, html) { $("dlgTitre").textContent = titre; $("dlgBody").innerHTML = html; $("dlg").showModal(); }
  $("dlgClose").addEventListener("click", () => $("dlg").close());

  $("tbl").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-act]"); if (!b) return;
    const u = liste.find((x) => x.id === b.dataset.id); if (!u) return;
    try {
      if (b.dataset.act === "matchs") {
        const j = await admin("user.matchs", { user_id: u.id });
        const l = j.data || [];
        dialogue("Matchs — " + (u.profil.prenom || u.email) + " (" + l.length + ")", '<p class="mut">Consultation journalisée.</p><div class="tbl"><table><thead><tr><th>Date</th><th>Rencontre</th><th>Rôle</th><th>Indemnité</th><th>Paiement</th><th>Alertes</th></tr></thead><tbody>' +
          l.map((m) => "<tr><td>" + esc(m.date_match) + " " + esc(m.heure_rdv || "") + "</td><td>" + esc(m.libelle_competition) + "<br>" + esc(m.recevant) + " – " + esc(m.visiteur_evenement) + "</td><td>" + esc(m.mon_role) + "</td><td>" + esc(m.indemnite_totale) + " €</td><td>" + esc(m.statut_paiement) + "</td><td class=\"warn\">" + esc([m.warning_general, m.warning_finance].filter(Boolean).join(" · ")) + "</td></tr>").join("") + "</tbody></table></div>");
      } else if (b.dataset.act === "profil") {
        const p = u.profil || {};
        dialogue("Profil — " + u.email, '<div class="grid"><label>Prénom<input id="pPrenom" value="' + esc(p.prenom || "") + '"></label><label>Adresse de réception<input id="pRecep" value="' + esc(p.adresse_reception || "") + '" placeholder="prenom@referee-tracker.fr"></label></div><label>URL du moteur (Apps Script /exec)<input id="pApi" value="' + esc(p.api_url || "") + '"></label><div class="row" style="margin-top:10px"><button class="pri" id="pSave">Enregistrer</button><span id="pMsg" class="mut"></span></div>');
        $("pSave").addEventListener("click", async () => {
          try { await admin("profil.set", { user_id: u.id, prenom: $("pPrenom").value.trim(), adresse_reception: $("pRecep").value.trim(), api_url: $("pApi").value.trim() || undefined }); $("pMsg").textContent = "Enregistré ✓"; charger(); }
          catch (e) { $("pMsg").textContent = e.message; }
        });
      } else if (b.dataset.act === "suspendre" || b.dataset.act === "reactiver") {
        if (!confirm((b.dataset.act === "suspendre" ? "Suspendre l'accès de " : "Réactiver ") + u.email + " ?")) return;
        await admin("user." + b.dataset.act, { user_id: u.id }); charger();
      }
    } catch (e) { $("msg").textContent = e.message; }
  });
  $("btnRefresh").addEventListener("click", () => charger().catch((e) => ($("msg").textContent = e.message)));
  $("btnInvite").addEventListener("click", async () => {
    const email = $("invEmail").value.trim();
    if (!email || !confirm("Envoyer une invitation à " + email + " ?")) return;
    try { await admin("user.inviter", { email }); $("invMsg").textContent = "Invitation envoyée à " + email + "."; $("invEmail").value = ""; charger(); }
    catch (e) { $("invMsg").textContent = e.message; }
  });
  $("btnJournal").addEventListener("click", async () => {
    try {
      const j = await admin("journal");
      $("jrn").querySelector("tbody").innerHTML = (j.data || []).map((x) => "<tr><td>" + fmt(x.at) + "</td><td>" + esc(x.action) + "</td><td class=\"mut\">" + esc(x.cible_user || "") + "</td><td class=\"mut\">" + esc(JSON.stringify(x.details || {}).slice(0, 160)) + "</td></tr>").join("");
    } catch (e) { $("msg").textContent = e.message; }
  });

  async function demarrer() {
    try {
      if (!session()) return voir("vLogin");
      if (!(await preparerMfa())) return;
      voir("vAdmin");
      await charger();
    } catch (e) {
      if (/AUTH_REQUIRED/.test(e.message)) return voir("vLogin");
      $("msg").textContent = e.message;
    }
  }
  demarrer();
})();
