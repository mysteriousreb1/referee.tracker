/* b140 — questionnaire des testeurs bêta. Le lien du mail porte un jeton signé (?t=uid.signature) :
   pas de connexion à l'app, et le jeton ne permet que de répondre pour soi (vérifié par la fonction « retours »). */
(function () {
  "use strict";
  var FN = "https://jlstedchnmdteazuqbly.supabase.co/functions/v1/retours";
  var t = new URLSearchParams(location.search).get("t") || "";
  var $ = function (id) { return document.getElementById(id); };

  function echelle(box, nom, min, max) {
    for (var i = min; i <= max; i++) {
      var id = nom + i;
      box.insertAdjacentHTML("beforeend", '<input type="radio" name="' + nom + '" id="' + id + '" value="' + i + '"><label for="' + id + '">' + i + "</label>");
    }
  }
  function fin(titre, texte) { $("f").hidden = true; $("fin").hidden = false; $("finTitre").textContent = titre; $("finTexte").textContent = texte; }
  // Depuis l'app : la session de l'arbitre (même site) remplace le lien du mail.
  var SB_URL = "https://jlstedchnmdteazuqbly.supabase.co", SB_KEY = "sb_publishable_B1w244FrkzbIn-SZ-T_z8w_4HVg9stb";
  function jeton() {
    var s = null; try { s = JSON.parse(localStorage.getItem("rt_sb_session") || "null"); } catch (e) {}
    if (!s || !s.refresh_token) return Promise.resolve("");
    if (s.expires_at - Date.now() / 1000 > 60) return Promise.resolve(s.access_token);
    return fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.access_token) return "";
        try { localStorage.setItem("rt_sb_session", JSON.stringify({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) })); } catch (e) {}
        return j.access_token;
      }).catch(function () { return ""; });
  }
  function appel(corps) {
    return jeton().then(function (jt) {
      var h = { "Content-Type": "application/json" }; if (jt) h.Authorization = "Bearer " + jt;
      return fetch(FN, { method: "POST", headers: h, body: JSON.stringify(corps) });
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || "ERREUR"); return j; }); });
  }
  function cocher(nom, v) { if (v === null || v === undefined) return; var el = $(nom + v); if (el) el.checked = true; }

  echelle($("note"), "note", 1, 5);
  echelle($("reco"), "reco", 0, 10);

  var connecte = false; try { connecte = !!JSON.parse(localStorage.getItem("rt_sb_session") || "null"); } catch (e) {}
  if (!connecte && !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{10,}$/.test(t)) { fin("Connecte-toi d'abord", "Ouvre l'app Referee Tracker et connecte-toi : le questionnaire te sera proposé."); return; }

  appel({ action: "lire", t: t }).then(function (j) {
    if (j.prenom) $("titre").textContent = j.prenom + ", ton avis sur la bêta";
    var r = j.reponses;
    if (r) {
      cocher("note", r.note); cocher("reco", r.recommande);
      ["utile", "manque", "bugs", "temoignage"].forEach(function (k) { $(k).value = r[k] || ""; });
      $("temoOk").checked = !!j.temoignage_ok;
      $("go").textContent = "Mettre à jour mon avis";
    }
    $("f").hidden = false;
  }).catch(function (e) {
    fin("Accès impossible", e.message === "LIEN_INVALIDE" ? "Ta session a expiré. Ouvre l'app, reconnecte-toi, puis reviens au questionnaire." : "Le questionnaire ne répond pas pour l'instant. Réessaie dans quelques minutes.");
  });

  $("f").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var note = document.querySelector('input[name="note"]:checked'), reco = document.querySelector('input[name="reco"]:checked');
    var msg = $("msg");
    if (!note) { msg.className = "msg err"; msg.textContent = "Choisis une note de 1 à 5 pour la première question."; $("note1").focus(); return; }
    var temo = $("temoignage").value.trim();
    var corps = { action: "repondre", t: t, reponses: {
      note: Number(note.value), recommande: reco ? Number(reco.value) : null,
      utile: $("utile").value, manque: $("manque").value, bugs: $("bugs").value,
      temoignage: temo, temoignage_ok: $("temoOk").checked && !!temo } };
    $("go").disabled = true; msg.className = "msg"; msg.textContent = "Envoi…";
    appel(corps).then(function () { fin("Merci !", "Ton avis est bien enregistré. Chaque réponse est lue et aide à décider de la suite."); })
      .catch(function () { msg.className = "msg err"; msg.textContent = "L'envoi n'a pas marché. Vérifie ta connexion et réessaie."; $("go").disabled = false; });
  });
})();
