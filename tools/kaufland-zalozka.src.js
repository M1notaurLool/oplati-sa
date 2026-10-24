// Záložka „Oplatí sa → Kaufland“ (bookmarklet). Zdroj; hotovú záložku vyrobí tools/build-bookmarklet.js.
// Spúšťa ju človek na stránke s akciami Kauflandu, ktorú má práve otvorenú (overenie „nie som robot“
// potvrdzuje sám). Prečíta len dlaždice akcií z tejto stránky – nič ďalšie nesťahuje ani neodosiela –
// a uloží ich do Stiahnutých súborov ako kaufland-SK-<čas>.raw.json.
(() => {
  const host = location.hostname;
  const country = /(^|\.)kaufland\.cz$/.test(host) ? 'CZ' : /(^|\.)kaufland\.sk$/.test(host) ? 'SK' : null;
  if (!country) {
    alert('Oplatí sa: otvor najprv akcie na kaufland.sk alebo kaufland.cz a na záložku klikni tam.');
    return;
  }
  const PRICE = /\d+[.,]\d{2}/g;
  const count = (t) => (t.match(PRICE) || []).length;
  const nameish = (t) => t.split('\n').some((l) => /\p{L}{4,}/u.test(l) && !/kaufland card|%/i.test(l));
  const cands = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.children.length) continue;
    const raw = el.textContent || '';
    if (raw.length < 8 || raw.length > 1500 || count(raw) < 2) continue;
    if (!(el.querySelector('img') || el.matches('a,article,li'))) continue;
    const t = el.innerText || '';
    if (t.length > 700 || count(t) < 2 || !nameish(t)) continue;
    cands.push(el);
  }
  const tiles = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
  if (!tiles.length) {
    alert('Oplatí sa: na tejto stránke som nenašiel akcie. Otvor stránku s akciami, nechaj ju celú načítať (posuň sa nadol) a klikni znova.');
    return;
  }
  const parts = (el) => {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName || '') ? 2 : 1) });
    for (let n = walk.nextNode(); n && out.length < 80; n = walk.nextNode()) {
      const s = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (s) out.push(s.slice(0, 200));
    }
    return out;
  };
  const items = tiles.map((el) => ({
    text: el.innerText.trim().slice(0, 700),
    parts: parts(el),
    href: (el.matches('a[href]') ? el : el.querySelector('a[href]') || el.closest('a[href]'))?.href || null,
    img: el.querySelector('img[alt]')?.alt?.slice(0, 200) || null,
    html: el.outerHTML.slice(0, 1500),
  }));
  const dates = (document.body.innerText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length < 160 && /\d{1,2}\.\s?\d{1,2}\./.test(l) && /plat|od |do |–|-/i.test(l))
    .slice(0, 40);
  const raw = { source: `kaufland-${country}`, kind: 'kaufland-page', url: location.href, title: document.title, fetchedAt: new Date().toISOString(), dates, items };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: 'application/json' }));
  a.download = `kaufland-${country}-${Date.now()}.raw.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  alert(`Oplatí sa: uložených ${items.length} akcií z tejto stránky (súbor ${a.download} v Stiahnutých súboroch). Pokračuj ďalšou kategóriou alebo hotovo.`);
})();
