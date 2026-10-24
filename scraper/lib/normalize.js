// @ts-check
// Spoločné spracovanie dát z webov reťazcov: ceny, balenia, kategórie, dátumy, kľúče na párovanie.
// Zámerne bez importov – rovnaký kód beží v Node (GitHub Actions) aj v prehliadači.

/** Malé písmená bez diakritiky. @param {string} s */
export function norm(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * „1,49 €“ → 1.49, „24,90 Kč“ → 24.9, „1.299,00“ → 1299, „-,99“ → 0.99
 * @param {string | number | null | undefined} raw
 * @returns {number | null}
 */
export function parsePrice(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  if (!raw) return null;
  let s = String(raw).replace(/\s|€|Kč|EUR|CZK/gi, '').replace(/^-,/, '0,');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const UNITS = /** @type {Record<string, string>} */ ({ g: 'g', kg: 'kg', ml: 'ml', l: 'l', ks: 'ks', kus: 'ks', kusy: 'ks', kusov: 'ks', pc: 'ks', pcs: 'ks', cl: 'cl', dl: 'dl' });

/**
 * „250 g“, „1,5 l“, „2 x 500 ml“, „10 ks“, „cca 0,7 kg“, „cena za 1 kg“ → { amount, unit }
 * @param {string | null | undefined} raw
 * @returns {{ amount: number, unit: 'g'|'kg'|'ml'|'l'|'ks' } | null}
 */
export function parseSize(raw) {
  if (!raw) return null;
  const s = norm(String(raw)).replace(/cca\.?\s*/g, '');
  const m = s.match(/(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|dl|l|ks|kusov|kusy|kus|pcs|pc)\b/);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  let amount = Number(m[2].replace(',', '.')) * count;
  let unit = UNITS[m[3]];
  if (unit === 'cl') {
    amount *= 10;
    unit = 'ml';
  } else if (unit === 'dl') {
    amount *= 100;
    unit = 'ml';
  }
  return amount > 0 ? { amount: Math.round(amount * 1000) / 1000, unit: /** @type {any} */ (unit) } : null;
}

/**
 * Hrubé zatriedenie podľa názvu (keď reťazec kategóriu nedáva). Text je bez diakritiky a malými písmenami.
 * Poradie je dôležité: drogéria a nápoje skôr než jedlo (napr. „Felix kapsička s mäsom“, „Movino“),
 * spracované potraviny skôr než čerstvá zelenina („paradajkový pretlak“).
 * Obsahuje aj značky a skratky z letákov (Billa: „sg“ = sprchový gél, „zp“ = zubná pasta, „tp“ = toaletný papier).
 */
const CATEGORY_RULES = /** @type {Array<[string, RegExp]>} */ ([
  ['drogeria', /\b(prac|gel na pranie|avivaz|persil|ariel|silan|lenor|jar\b|savo\b|sanytol|bref\b|domestos|cif\b|wc\b|cistic|cistiac|dezinfek|odstranovac|tento\b|toaletn|tp\b|utierk|vreckovk|papierov|naturella|vlozk|intimk|tampon|pampers|plienk|plenk|colgate|lacalut|blend-a-dent|zubn|zp\b|sampon|sprchov|sg\b|old spice|dezodor|deodor|antiperspir|mydl|krmiv|granul|felix\b|whiskas|pedigree|friskies|kapsick|pre mack|pre psov|pro kock|pro psy|kvety|chryzant|ponozk|napln|parafin|sviecka|kahan|zapalovac|clatronic|kanvic|ustna voda|kefk|glade|always\b|somat|garnier|elseve|wellaflex|perwoll|parodontax|brita\b|kytica|bercoff|umyvack|lak\b|denny krem|krem na|skin krem|maska\b|balzam|serum\b|ostrikovac|nemrznouc|pytle|pytl\b|sacky na odpad|stelivo|podestylk pro|zapalov|grilovaci uhli)/],
  ['mrazene', /\b(mrazen|zmrzlin|manhattan|nanuk|pizza|feliciana|magnum|algida|hranolk|mc cain|mccain)/],
  ['snacky', /\b(cheetos|lupienk|stix\b|chrumk|chips|cips|lays\b|chio\b|vrubk|pepe\b|oreo\b|gummy|lizank|corny|manner|merci\b|milora|mozart|kolatch|douceur|nugat|pernick|piskot|roksy|doxy|jadierok|datle|figy\b|minit\b|minitky|monster munch|trolli|makronk|lizat|zele\b|bohemia chips|tuc\b|krekr|slane tycinky)/],
  ['napoje', /\b(pivo|piva|ležiak|leziak|vino\b|vina\b|movino|mionetto|prosecco|frizzante|sekt\b|sampan|gin\b|rum\b|vodka|whisk|liker|borovick|slivovic|tuzemsk|cola\b|pepsi|7up|fanta|sprite|kofola|rajec\b|gemerka|budis|mattoni|bonaqua|mineral|voda\b|vody\b|soda\b|stava|dzus|juice|nektar|happy day|jana\b|vitamin well|limon|sirup|kava|kavy|espresso|lungo|cappuccino|latte|dolce gusto|kimbo|barista|nescafe|jacobs|tchibo|lavazza|caj\b|caje|teekanne|tea\b|energ|red bull|monster|kombucha|nealko|chardonnay|cabernet|sauvignon|portugal|veltlin|tramin|frankovk|rulandsk|muller|irsai|palava|andre ros|merlot|riesling|rizling|templar|becherovk|fernet|ballantine|rtd\b|jupi\b|tatratea|professorado|republica|amundsen|hell\b|davidoff|tullamore|bumbu|captain morgan|jagermeister|finlandia|xixo|hello viva|mitick|vinice|pressburg|ribessa|zweigelt|tassimo|popradska|granko|budvar|kozel|brandy|vsop|v\.s\.o\.p|konak|cognac|jim beam|jack daniel|bourbon|tequila|metaxa|pilsner|plzen|radegast|gambrinus|staropramen|svijany|bernard|krusovic|branik|starobrno|vycep|lezak|birell|schweppes|tonic|alkohol|aperol|cider|perla ice|nescafe)/],
  ['maso', /\b(kurac|kurc|kura\b|kure|kuret|kureci|hus\b|husac|kralik|zverin|divin|bravc|brav\.|brav\b|veprov|hovadz|hov\.|hovez|telac|morc|krut|mlet|klobas|klob\.|parky|parek|sunk|salam|slanin|pecienk|rebr|uden|maso|mas\b|masit|uherak|kremesnik|prosciutto|mortadell|roastbeef|zabijack|spekack|pastet|gaspar|losos|tuniak|tunak|makrel|sardink|treska|krevet|ryb\b|ryby|rybi|filet|rezne|rizk|krkov|steh|plec|kare\b|bocik|bucek|panenk|gulas|kabanos|virsl|kur\.|vtacik|vrabec|vypeck|sushi|onigiri|jaternic|tlacenk|kacic|kachn|lalok|prejt|vysocina|cajovk|burger|jitrnic|sekana|aspik|blocek|polican|zavinac|vlassky salat|tlacenk|karbanatk|cevapcic|kotlet)/],
  ['mliecne', /\b(mliek|mliec|mlek|mlec|ml\.|maslo|masla|syr|syry|syrokrem|cottage|eidam|ementa|gouda|cheddar|leerdammer|karick|crievk|zottarell|mozzarell|burrat|halloumi|hermelin|encian|nika\b|ov nika|skyr|jogurt|jog\.|milko\b|pribinac|termix|kunin|krupick|smotan|smot\.|smetan|slahac|slahan|tvaroh|kefir|acidk|bryndz|vajc|vejc|pudink|puding|deva\b|malicremo|lacto|parenic|ostiepok|niva\b|philadelphia|actimel|danone|korbacik|grana padano|zerve|rama\b|lucina|activia|camembert|almette|jadel|gervais|olma|pomazankov|krajanka|salko|hera\b|flora\b|lipanek|smetanito|cottage|ricott|mascarpon|tvaruzk|olomouck|zlaty klas)/],
  ['pecivo', /\b(chlieb|chleb|rozok|rozky|rohlik|bagetk|baget|croissant|pecivo|toast|buchta|kolac|vianock|vanock|zemla|houska|knedl|slimak|donut|mriezk|tortill|wrap\b|la lorraine|lalorraine|pierre baguette|baguette|bochnik|puncov|snek|hreben|dalaman|bulka|veka\b|satec|duetk|kobliha|loupak|vanocka|mazanec|bageta)/],
  ['trvanlive', /\b(pretlak|pasirov|pas\.|omack|omac\.|kecup|horcic|majonez|konzerv|nakladan|steril|kompot|dzem|lekvar)/],
  ['ovocie', /\b(jablk|hrusk|banan|pomaranc|pomeranc|mandarin|citron|limetk|hrozn|jahod|malin|cucoried|zemiak|brambor|paradaj|rajcat|rajciak|uhork|okurk|paprik|cibul|mrkv|karotk|salat|avokad|zelenin|ovoc|kalerab|kapust|zeli\b|por\b|porek|cesnak|cesnek|tekvic|dyne|hrib|sampin|zampion|kiwi|mango|ananas|melon|slivk|svestk|broskyn|nektarink|brokolic|karfiol|kvetak|celer|petrzlen|petrzel|spenat|kukuric|gastan|hurmikaki|kaki\b|granatov|repa\b|cvikl|lilek|cuket|baklazan|batat|ridkev|ridkv|redkev|redkvic|fik|fiky|datl|papaj)/],
  ['snacky', /\b(cokol|cok\.|lindt|lindor|milka\b|orion\b|studentsk|studensk|mars\b|snickers|twix|bounty|kit kat|kitkat|haribo|jojo\b|toffee|karamel|caramel|cukrik|candy|bonbon|praline|pralink|oblat|oplatk|susienk|susenk|keks|cookie|chips|cips|lays\b|chio\b|chrumk|popcorn|pepe\b|tycink|oriesk|orech|kesu|cashew|nice bites|arasid|mandl|pistac|vrubk|stix\b|nutella|baklav|horalk|zuvack|zvykack|pernik|fidork|mila\b|kinder)/],
  ['trvanlive', /\b(muk|muka|cukor|cukr|ryza|ryze|cestovin|testovin|spaget|penne|makaron|maccheroni|fusilli|linguine|kolienk|fleky|motylik|vreten|trubk|panzani|olej|ocot|ocet|med\b|kakao|cereal|muesli|musli|vlock|kasa\b|kasa |prikrm|polievk|pho\b|miso\b|sol\b|korenie|koreni|olivy|dulce de leche|agar|natierk|tortell)/],
]);

/**
 * Kategória podľa názvu; keď nič nesedí, vráti fallback.
 * @param {string} name @param {string} [fallback]
 */
export function guessCategory(name, fallback = 'trvanlive') {
  const n = norm(name);
  for (const [id, re] of CATEGORY_RULES) if (re.test(n)) return id;
  return fallback;
}

/** @param {string} s */
export function slug(s) {
  return norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Kľúč na porovnanie rovnakého produktu medzi reťazcami: názov bez balastu + balenie.
 * Zámerne jednoduché; presnejšie párovanie (EAN, synonymá) príde neskôr.
 * @param {string} name @param {{ amount: number, unit: string } | null} size
 */
export function matchKey(name, size) {
  const stop = /\b(akcia|akce|novinka|cerstv|vybrane|rozne|ruzne|druhy|druh|baleni|balenie|cca)\w*/g;
  const words = norm(name)
    .replace(stop, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(kg|g|ml|l|ks)\b/g, ' ')
    .replace(/[^a-z0-9% ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1);
  const base = [...new Set(words)].sort().join('-');
  return size ? `${base}-${size.amount}${size.unit}` : base;
}

/** Stabilné ID ponuky (rovnaká akcia = rovnaké ID aj pri ďalšom behu). */
export function offerId(/** @type {string} */ country, /** @type {string} */ chain, /** @type {string} */ name, /** @type {string} */ validFrom, /** @type {{amount:number,unit:string}|null} */ size) {
  const sz = size ? `${size.amount}${size.unit}` : '';
  return `${country.toLowerCase()}-${chain}-${slug(name).slice(0, 48)}-${sz}-${validFrom}`.replace(/-+/g, '-');
}

/** HTML entity v atribútoch (&quot; &amp; &#39; &#x2F; …) → znaky. @param {string} s */
export function decodeEntities(s) {
  const named = /** @type {Record<string, string>} */ ({ quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' });
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

/**
 * Dátum (YYYY-MM-DD) v miestnom čase SK/CZ – nezávisle od časového pásma servera.
 * @param {Date | number} when Date alebo Unix sekundy
 */
export function localDate(when, timeZone = 'Europe/Bratislava') {
  const d = typeof when === 'number' ? new Date(when * 1000) : when;
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** @param {string} iso @param {number} days */
export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** ISO číslo týždňa pre dátum YYYY-MM-DD. @param {string} iso */
export function isoWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return { year: dt.getUTCFullYear(), week: Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

/**
 * Týždňový leták streda–utorok, ktorý platí v daný deň.
 * @param {string} todayIso
 */
export function wednesdayWeek(todayIso) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = nedeľa, 3 = streda
  const back = (dow - 3 + 7) % 7;
  const from = shiftDate(todayIso, -back);
  return { from, to: shiftDate(from, 6), ...isoWeek(from) };
}

/** „MEDVEDÍK PÁRKY 180G REINERT“ → „Medvedík párky 180 g reinert“ @param {string} s */
export function tidyName(s) {
  let t = String(s || '')
    .replace(/\s+[A-Z]*\d+\/\d+\b/g, '') // interné kódy typu ROZRAB71/175026
    // Interné predpony Billy: „KU (R) VB “, „KU “, „CS “, „(P) “, „MV.“, „BR “, „OV “, „ST “ a kód na konci „(70)“.
    .replace(/^\s*(?:(?:KU|CS|BR|OV|ST)\s+)?(?:\((?:R|VR|P)\)\s*)?(?:(?:VB|MB)\s+)?/i, '')
    .replace(/^\s*MV\.\s*/i, '')
    .replace(/\s+\(\d{1,3}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t && t === t.toUpperCase()) t = t.toLocaleLowerCase('sk');
  t = t.replace(/(\d)\s?(g|kg|ml|l|ks)\b/gi, (_, n, u) => `${n} ${u.toLowerCase()}`);
  return t.charAt(0).toLocaleUpperCase('sk') + t.slice(1);
}

/**
 * Obrázok produktu z webu reťazca – len bezpečná absolútna https adresa (≤ 500 znakov), inak null.
 * Apka obrázok len zobrazí z pôvodného webu (nekopírujeme ho).
 * @param {unknown} url
 * @returns {string | null}
 */
export function safeImage(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (u.length > 500 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(u) || /[\s"'<>`\\]/.test(u)) return null;
  return u;
}
