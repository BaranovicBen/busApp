#!/usr/bin/env node
// cli_next.cjs — vypíše pre nástupište 1 aj 2:
// - Najbližší spoj (čas, smer, linka) + trasu
// - Trasu pre Ďalší spoj (namiesto celej druhej vety)

const API_URL = process.env.API_URL || 'http://127.0.0.1:8787/api/stop-times';

const fs = require('fs');
const path = require('path');

// ====== ROUTES ======
let ROUTES = {};
try {
  const p = path.join(__dirname, 'routes.json'); // uisti sa, že routes.json je vedľa tohto skriptu
  ROUTES = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  ROUTES = {};
  console.error('[WARN] Nepodarilo sa načítať routes.json – trasy nebudú zobrazené.');
}

// ====== Helpers ======
const pad2 = n => String(n).padStart(2, '0');
function fmtClock(dLike) {
  const d = dLike instanceof Date ? dLike : new Date(dLike);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtRel(dLike) {
  const d = dLike instanceof Date ? dLike : new Date(dLike);
  const now = new Date();
  const ms = d - now;
  if (ms <= 0) return '(odchádza)';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const dayLabel = sameDay ? 'dnes' : 'o';
  return sameDay ? `(dnes, o ${h ? `${h} h ${mm} m` : `${mm} m`})`
                 : `(o ${h ? `${h} h ${mm} m` : `${mm} m`})`;
}

// normalizácia čísla linky (napr. "010527" -> "527")
function normalizeLineText(text) {
  const t = String(text || '').trim();
  if (/^\d{1,3}$/.test(t)) return t;           // 525, 527...
  const m010 = t.match(/^010(\d{3})$/);        // 010527 -> 527
  if (m010) return m010[1];
  const mZeros = t.match(/^0+(\d{3})$/);       // 000527 -> 527
  if (mZeros) return mZeros[1];
  const mTail3 = t.match(/(\d{3})$/);          // posledné 3 cifry ako fallback
  if (mTail3) return mTail3[1];
  return t || '?';
}

function getRoute(line, headsign) {
  const key = `${line}|${headsign}`.trim();
  const val = ROUTES[key];
  if (Array.isArray(val) && val.length) return val.join(' → ');
  return `(trasa neznáma – doplň do routes.json kľúč "${key}")`;
}

// ====== Fetch jednej platformy ======
async function fetchPlatform(plat, count = 50) {
  const url = `${API_URL}?platform=${encodeURIComponent(plat)}&count=${count}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  const json = await r.json();

  const rows = (json.rows || []).map(row => {
    const when = new Date(row.rawTime ?? row.planned);
    const line = normalizeLineText(row.line);
    return { ...row, when, line };
  });

  const now = new Date();
  const upcoming = rows.filter(x => isFinite(x.when.getTime()) && x.when >= now)
                       .sort((a, b) => a.when - b.when);

  const items = upcoming.length >= 2
    ? upcoming.slice(0, 2)
    : (upcoming.length === 1
        ? [upcoming[0], rows.find(rr => rr.when > upcoming[0].when)].filter(Boolean)
        : rows.slice(0, 2));

  const source = json.online ? 'online' : (json.source || 'offline');
  return { platform: String(plat), source, items };
}

// ====== Main ======
(async () => {
  try {
    const [p1, p2] = await Promise.all([fetchPlatform(1), fetchPlatform(2)]);
    for (const blk of [p1, p2]) {
      console.log('');
      console.log(`=== Nástupište ${blk.platform} (${blk.source}) ===`);

      if (!blk.items.length) {
        console.log('Žiadne nadchádzajúce odchody v najbližších 3 hodinách.\n');
        continue;
      }

      // Najbližší
      const a = blk.items[0];
      console.log(`Najbližší: ${fmtClock(a.when)} ${fmtRel(a.when)}  linka ${a.line} → ${a.headsign}`);
      // Trasa najbližšieho (ak nechceš zobrazovať, zmaž nasledujúci riadok)
      console.log(`Trasa (najbližší): ${getRoute(a.line, a.headsign)}`);

      // Trasa Ďalšieho (namiesto celej vety „Ďalší autobus …“)
      const b = blk.items[1];
      if (b) {
        console.log(`Trasa (ďalší): ${getRoute(b.line, b.headsign)}`);
        // Voliteľne, ak chceš ešte doplniť mini-info o čase/linie ďalšieho:
        console.log(`(ďalší: ${fmtClock(b.when)} ${fmtRel(b.when)}  linka ${b.line} → ${b.headsign})`);
      }

      console.log('');
    }
  } catch (e) {
    console.error('Chyba CLI:', e.message || e);
    console.error(`Skús API: curl '${API_URL}?platform=1'`);
    console.error(`         curl '${API_URL}?platform=2'`);
    process.exit(1);
  }
})();