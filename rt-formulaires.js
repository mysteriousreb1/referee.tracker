/* Referee Tracker — remplissage des formulaires officiels de rapport (b73).
   Écrit les réponses aux emplacements prévus du PDF officiel (champs, cases, lignes de description),
   sans modifier le document d'origine. Navigateur (window.PDFLib) ou Node (require("pdf-lib")).
   Données attendues : { champs: {cle: texte}, cases: {id: true}, description: "texte long" }. */
(function (racine) {
  "use strict";
  const lib = () => (typeof PDFLib !== "undefined" ? PDFLib : require("pdf-lib"));

  /* Helvetica (WinAnsi) : on remplace ce qu'elle ne sait pas dessiner. */
  function propre(t) {
    return String(t == null ? "" : t)
      .replace(/[‘’ʼ]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-")
      .replace(/…/g, "...").replace(/ | /g, " ").replace(/\t/g, " ")
      .replace(/[^\x0A\x20-\x7E -ÿŒœ€]/g, "");
  }
  /* Coupe un texte en lignes de largeur max (en points). */
  function couper(texte, police, taille, largeur) {
    const out = [];
    propre(texte).split(/\n/).forEach(par => {
      const mots = par.split(/\s+/).filter(Boolean);
      if (!mots.length) { out.push(""); return; }
      let ligne = "";
      mots.forEach(m => {
        const essai = ligne ? ligne + " " + m : m;
        if (police.widthOfTextAtSize(essai, taille) <= largeur) { ligne = essai; return; }
        if (ligne) out.push(ligne);
        // mot plus long que la ligne : on le tronçonne
        let reste = m;
        while (police.widthOfTextAtSize(reste, taille) > largeur && reste.length > 1) {
          let n = reste.length;
          while (n > 1 && police.widthOfTextAtSize(reste.slice(0, n), taille) > largeur) n--;
          out.push(reste.slice(0, n)); reste = reste.slice(n);
        }
        ligne = reste;
      });
      if (ligne) out.push(ligne);
    });
    return out;
  }
  /* Taille de police qui fait tenir un texte court dans [x, max]. */
  function ajuster(texte, police, largeur, base) {
    let t = base;
    while (t > 6 && police.widthOfTextAtSize(texte, t) > largeur) t -= 0.5;
    return t;
  }

  async function remplir(pdfOctets, carte, donnees) {
    const { PDFDocument, StandardFonts, rgb } = lib();
    const doc = await PDFDocument.load(pdfOctets);
    const police = await doc.embedFont(StandardFonts.Helvetica);
    const gras = await doc.embedFont(StandardFonts.HelveticaBold);
    const encre = rgb(0.05, 0.12, 0.45);   // bleu stylo : on distingue la saisie du formulaire
    const pages = doc.getPages();
    const d = donnees || {};
    const restes = [];

    /* 1. Formulaire à champs (AcroForm) : on remplit par nom de champ. */
    if (carte.acroform) {
      const form = doc.getForm();
      Object.entries(d.champs || {}).forEach(([nom, val]) => {
        try { const f = form.getTextField(nom); f.setText(propre(val)); } catch (e) { restes.push(nom); }
      });
      Object.entries(d.cases || {}).forEach(([nom, coche]) => {
        if (!coche) return;
        try { form.getCheckBox(nom).check(); } catch (e) { restes.push(nom); }
      });
      try { form.updateFieldAppearances(police); } catch (e) {}
      return { octets: await doc.save(), restes };
    }

    /* 2. Formulaire « à plat » : on écrit aux coordonnées relevées. */
    (carte.champs || []).forEach(c => {
      const v = propre((d.champs || {})[c.key]);
      if (!v) return;
      const larg = Math.max(20, c.max - c.x);
      const lignes = couper(v, police, 9, larg);
      if (lignes.length <= 1) {
        const t = ajuster(v, police, larg, 9.5);
        pages[c.p].drawText(v, { x: c.x, y: c.y, size: t, font: police, color: encre });
      } else {
        // texte trop long pour la ligne : taille réduite sur deux lignes au plus, le reste part en description
        const t2 = 7.5, l2 = couper(v, police, t2, larg);
        pages[c.p].drawText(l2[0], { x: c.x, y: c.y + 3, size: t2, font: police, color: encre });
        if (l2[1]) pages[c.p].drawText(l2.slice(1).join(" ").slice(0, 400), { x: c.x, y: c.y - 5, size: Math.min(t2, ajuster(l2.slice(1).join(" "), police, larg, t2)), font: police, color: encre });
      }
    });
    (carte.cases || []).forEach(c => {
      if (!(d.cases || {})[c.id]) return;
      const p = pages[c.p], s = Math.min(c.w, c.h);
      const x0 = c.x + s * 0.18, y0 = c.y + s * 0.18, x1 = c.x + s * 0.82, y1 = c.y + s * 0.82;
      p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 1.4, color: encre });
      p.drawLine({ start: { x: x0, y: y1 }, end: { x: x1, y: y0 }, thickness: 1.4, color: encre });
    });
    /* Description : on remplit les lignes de la page 1 puis celles du verso. */
    const desc = propre(d.description || "");
    if (desc) {
      const zones = (carte.zones || []).slice().sort((a, b) => a.p - b.p || b.rows[0] - a.rows[0]);
      let reste = [];
      zones.forEach((z, i) => {
        const larg = z.x1 - z.x0;
        if (i === 0) reste = couper(desc, police, 9.5, larg);
        else reste = couper(reste.join("\n").replace(/\n(?!\n)/g, " "), police, 9.5, larg);
        z.rows.forEach(y => {
          if (!reste.length) return;
          pages[z.p].drawText(reste.shift(), { x: z.x0, y: y, size: 9.5, font: police, color: encre });
        });
      });
      if (reste.length) {
        // plus de place : page annexe au même format, clairement titrée
        const ref = pages[pages.length - 1];
        let p = doc.addPage([ref.getWidth(), ref.getHeight()]);
        let y = ref.getHeight() - 60;
        p.drawText("SUITE DU RAPPORT (annexe)", { x: 50, y: y + 20, size: 12, font: gras, color: rgb(0, 0, 0) });
        couper(reste.join(" "), police, 10, ref.getWidth() - 100).forEach(l => {
          if (y < 60) { p = doc.addPage([ref.getWidth(), ref.getHeight()]); y = ref.getHeight() - 60; }
          p.drawText(l, { x: 50, y, size: 10, font: police, color: encre }); y -= 14;
        });
      }
    }
    if (d.signatureImage) {
      try {
        const png = await doc.embedPng(d.signatureImage);
        const s = (carte.champs || []).find(c => c.key === "signature");
        if (s) { const h = 26, w = png.width * h / png.height; pages[s.p].drawImage(png, { x: s.x, y: s.y - 10, width: Math.min(w, s.max - s.x), height: h }); }
      } catch (e) { restes.push("signature"); }
    }
    return { octets: await doc.save(), restes };
  }

  const API = { remplir, propre, couper };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else racine.RT_FORMULAIRES = API;
})(typeof window !== "undefined" ? window : globalThis);
