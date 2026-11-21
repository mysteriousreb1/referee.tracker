/* b163 — anti-clickjacking. GitHub Pages ne permet pas d'envoyer X-Frame-Options ni « frame-ancestors »
   (ignoré dans une balise <meta>) : si la page est affichée dans le cadre d'un autre site, elle se masque
   et tente de reprendre toute la fenêtre. Chargé en premier, sans « defer ». */
(function () {
  "use strict";
  if (window.top === window.self) return;
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch (e) { /* cadre « sandbox » : la page reste masquée */ }
})();
