// @ts-check
// Vyrobí kaufland-zalozka.html (návod + tlačidlo na pretiahnutie do záložiek) zo zdroja tools/kaufland-zalozka.src.js.
// Spustenie: node tools/build-bookmarklet.js
import { readFile, writeFile } from 'node:fs/promises';

const src = await readFile(new URL('./kaufland-zalozka.src.js', import.meta.url), 'utf8');
const code = src
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n')
  .replace(/\s*\n\s*/g, ' ')
  .trim();
const href = `javascript:${encodeURIComponent(code)}`;
const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const html = `<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oplatí sa – záložka pre Kaufland</title>
<style>
  :root { --bg: #f6f7f5; --card: #fff; --text: #17201c; --muted: #5b6660; --accent: #0f6b4f; --line: #dfe4e0; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111613; --card: #1a211d; --text: #e8eee9; --muted: #a3ada7; --accent: #4fc597; --line: #2c3530; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin-bottom: 16px; }
  .btn { display: inline-block; padding: 12px 18px; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 700; text-decoration: none; cursor: grab; }
  @media (prefers-color-scheme: dark) { .btn { color: #0b1410; } }
  ol { padding-left: 1.2em; margin: 0; } li { margin: 6px 0; }
  kbd { border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; padding: 0 6px; font-size: .9em; }
  .muted { color: var(--muted); font-size: .92rem; }
</style>
</head>
<body>
<main>
  <h1>Záložka „Oplatí sa → Kaufland“</h1>
  <p class="lead">Kaufland nepustí automatické sťahovanie, preto akcie uložíš ty jedným klikom priamo z ich webu.</p>

  <div class="card">
    <p><strong>1. Pridaj si záložku (raz):</strong> zobraz panel záložiek (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>) a toto tlačidlo naň potiahni myšou.</p>
    <p><a class="btn" href="${esc(href)}">Oplatí sa → Kaufland</a></p>
    <p class="muted">Kliknutie tu na stránke nič neurobí – záložka funguje až na webe Kauflandu.</p>
  </div>

  <div class="card">
    <p><strong>2. Raz za týždeň</strong> (SK leták od štvrtka, CZ od stredy):</p>
    <ol>
      <li>Otvor <strong>kaufland.sk → Aktuálna ponuka</strong> (alebo kaufland.cz → Aktuální nabídka). Ak web chce overenie „nie som robot“, potvrď ho.</li>
      <li>Otvor kategóriu (napr. Ovocie a zelenina), posuň sa až dole, aby sa načítali všetky akcie, a klikni na záložku.</li>
      <li>To isté pre ďalšie kategórie, ktoré chceš mať v apke. Každé kliknutie uloží jeden súbor do <em>Stiahnutých súborov</em>.</li>
    </ol>
  </div>

  <div class="card">
    <p><strong>3. Hotovo.</strong> Pri najbližšej automatickej aktualizácii (7:10 a 15:10) si počítač súbory vezme, pridá akcie do apky a pošle ich na GitHub. Hneď: dvojklik na <code>aktualizuj-teraz.cmd</code>.</p>
    <p class="muted">Záložka číta len akcie z otvorenej stránky – nič ďalšie nesťahuje ani neodosiela. Akciu pridá len vtedy, keď stará cena, nová cena a zľava navzájom sedia.</p>
  </div>
</main>
</body>
</html>
`;
await writeFile(new URL('../kaufland-zalozka.html', import.meta.url), html);
console.log(`Hotovo: kaufland-zalozka.html (záložka ${href.length} znakov)`);
