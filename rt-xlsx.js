/* rt-xlsx.js — b89 : export Excel (.xlsx) sans bibliothèque externe.
   window.rtXlsx(nomFichier, [{ nom: "Feuille", lignes: [[...entêtes], [...], ...] }])
   Nombres → cellules numériques ; dates ISO → texte lisible ; le reste → texte. */
(function () {
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const col = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const dateIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  function cellule(v, ref, entete) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "boolean" || v === "true" || v === "false") v = (v === true || v === "true") ? "oui" : "non";
    if (typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"' + (entete ? ' s="1"' : "") + "><v>" + v + "</v></c>";
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 && !/^0\d/.test(v)) return '<c r="' + ref + '"><v>' + v + "</v></c>";
    if (typeof v === "string" && dateIso.test(v)) { const d = new Date(v); if (!isNaN(d)) v = d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); }
    if (typeof v === "object") v = JSON.stringify(v);
    return '<c r="' + ref + '" t="inlineStr"' + (entete ? ' s="1"' : "") + "><is><t>" + xml(v) + "</t></is></c>";
  }
  function feuille(lignes) {
    const larg = [];
    lignes.forEach((l) => l.forEach((v, j) => { larg[j] = Math.min(60, Math.max(larg[j] || 8, String(v == null ? "" : v).length + 2)); }));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (larg.length ? "<cols>" + larg.map((w, j) => '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>" : "") +
      "<sheetData>" + lignes.map((l, i) => '<row r="' + (i + 1) + '">' + l.map((v, j) => cellule(v, col(j) + (i + 1), i === 0)).join("") + "</row>").join("") + "</sheetData>" +
      (lignes.length > 1 && lignes[0].length ? '<autoFilter ref="A1:' + col(lignes[0].length - 1) + lignes.length + '"/>' : "") + "</worksheet>";
  }
  function zip(fichiers) {   // archive ZIP « stockée » (sans compression) : lisible par Excel, Numbers, LibreOffice
    const parts = [], centre = []; let off = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    fichiers.forEach((f) => {
      const nom = enc.encode(f.nom), data = enc.encode(f.contenu), c = crc32(data);
      const loc = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nom.length), ...u16(0)]);
      parts.push(loc, nom, data);
      centre.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nom.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nom);
      off += loc.length + nom.length + data.length;
    });
    const tailleC = centre.reduce((t, p) => t + p.length, 0);
    const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(fichiers.length), ...u16(fichiers.length), ...u32(tailleC), ...u32(off), ...u16(0)]);
    return new Blob([...parts, ...centre, fin], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  window.rtXlsx = function (nomFichier, feuilles) {
    const fs = feuilles.filter((f) => f && f.lignes && f.lignes.length);
    const noms = fs.map((f, i) => (String(f.nom || "Feuille " + (i + 1)).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31)));
    const fichiers = [
      { nom: "[Content_Types].xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + fs.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + "</Types>" },
      { nom: "_rels/.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nom: "xl/workbook.xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + noms.map((n, i) => '<sheet name="' + xml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>" },
      { nom: "xl/_rels/workbook.xml.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + fs.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + '<Relationship Id="rId' + (fs.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { nom: "xl/styles.xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ].concat(fs.map((f, i) => ({ nom: "xl/worksheets/sheet" + (i + 1) + ".xml", contenu: feuille(f.lignes) })));
    const url = URL.createObjectURL(zip(fichiers)), a = document.createElement("a");
    a.href = url; a.download = /\.xlsx$/i.test(nomFichier) ? nomFichier : nomFichier + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  // objets → lignes (entêtes = union des clés, libellés lisibles)
  window.rtXlsxLignes = function (objets, libelles) {
    const cles = []; (objets || []).forEach((o) => Object.keys(o || {}).forEach((k) => { if (!cles.includes(k)) cles.push(k); }));
    return [cles.map((k) => (libelles && libelles[k]) || k.replace(/_/g, " "))].concat((objets || []).map((o) => cles.map((k) => o[k])));
  };
})();
