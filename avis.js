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
  function appel(corps) {
    return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || "ERREUR"); return j; }); });
  }
  function cocher(nom, v) { if (v === null || v === undefined) return; var el = $(nom + v); if (el) el.checked = true; }

  echelle($("note"), "note", 1, 5);
  echelle($("reco"), "reco", 0, 10);

  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{10,}$/.test(t)) { fin("Lien incomplet", "Ouvre le questionnaire depuis le bouton du mail reçu. Un souci ? Écris à contact@referee-tracker.fr."); return; }

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
    fin("Lien non valable", e.message === "LIEN_INVALIDE" ? "Ce lien n'est pas valable. Ouvre le questionnaire depuis le bouton du mail reçu." : "Le questionnaire ne répond pas pour l'instant. Réessaie dans quelques minutes.");
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
