/* b143 — FORMAT FRANÇAIS À L'AFFICHAGE : « 59.35 % » → « 59,35 % », « 61.8 € » → « 61,80 € ».
   Beaucoup de chiffres arrivent tels quels du moteur ; plutôt que de corriger chaque écran, on corrige
   le texte affiché (jamais les champs de saisie, les scripts ni les graphiques SVG).
   shortcut : ne touche que les nombres suivis d'une unité ; un nouvel écran qui formate lui-même reste la bonne pratique. */
(function () {
  "use strict";
  var RE = /(\d)\.(\d+)(\s?)(%|€|km|kg|h\b|L\b|\/\s?100|pts?\b)/g;
  var EUR = /(\d+),(\d)(\s?)€/g;   // un seul chiffre après la virgule sur un montant : « 61,8 € » → « 61,80 € »
  var IGNORE = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1 };
  function corriger(t) {
    var v = t.nodeValue;
    if (!v || v.indexOf(".") === -1 && v.indexOf("€") === -1) return;
    var n = v.replace(RE, "$1,$2$3$4").replace(EUR, "$1,$20$3€");
    if (n !== v) t.nodeValue = n;
  }
  function parcourir(racine) {
    if (!racine) return;
    if (racine.nodeType === 3) { var v0 = racine.nodeValue; if (!v0 || v0.indexOf(".") === -1 && v0.indexOf("€") === -1) return; var p = racine.parentNode; if (p && !IGNORE[p.nodeName] && !(p.closest && p.closest("svg,code,pre,textarea"))) corriger(racine); return; }
    if (racine.nodeType !== 1 || IGNORE[racine.nodeName] || (racine.closest && racine.closest("svg"))) return;
    // b157 — test du texte AVANT de remonter les parents (closest) : la grande majorité des textes n'ont ni « . » ni « € »
    var w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var v = n.nodeValue; if (!v || v.indexOf(".") === -1 && v.indexOf("€") === -1) return 2;
      var p = n.parentNode; return p && !IGNORE[p.nodeName] && !(p.closest && p.closest("svg,code,pre,textarea")) ? 1 : 2; } });
    var n; while ((n = w.nextNode())) corriger(n);
  }
  function demarrer() {
    parcourir(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { if (m.type === "characterData") parcourir(m.target); else m.addedNodes.forEach(parcourir); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
})();
