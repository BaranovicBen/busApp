// next527.cjs — vytlačí najbližší odchod linky (default 527), jej smer a trasu z routes.json
// Ako zmeniť linku: node next527.cjs 527         // <-- zmeň číslo linky tu (alebo uveď ako 1. argument)
// API základ:    http://127.0.0.1:8787            // <-- ak tvoj server beží inde/na inom porte, uprav tu
const fs = require('fs');

const LINE = process.argv[2] || '527'; // <-- tu môžeš prepnúť sledovanú linku
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8787'; // <-- tu doplň iný host/port ak treba
const API_URL = `${API_BASE}/api/stop-times`;

function msUntil(date) { return new Date(date).getTime() - Date.now(); }
function fmtClock(d) { return new Date(d).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }); }
function fmtCountdown(ms) {
  if (ms <= 0) return 'odchádza';
  const s = Math.floor(ms/1000), m = Math.floor(s/60), sec = s % 60;
  if (m >= 60) { const h = Math.floor(m/60); return `${h}h ${m%60}m`; }
  return `${m}m ${String(sec).padStart(2,'0')}s`;
}
function loadRoutes() {
  try { return JSON.parse(fs.readFileSync('./routes.json','utf8')); }
  catch { return {}; }
}
function routeKey(line, headsign) { return `${line}|${headsign}`; }

async function fetchPlatform(p) {
  const url = `${API_URL}?platform=${encodeURIComponent(p)}&count=8`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json(); // { online, source, rows }
}

(async () => {
  try {
    // vezmeme obidve nástupištia 1 a 2
    const [d1, d2] = await Promise.all([fetchPlatform('1'), fetchPlatform('2')]);
    const all = [...(d1.rows||[]), ...(d2.rows||[])];

    // prefiltrovane na požadovanú linku
    const rows = all.filter(r => String(r.line) === String(LINE));

    if (!rows.length) {
      console.log(`Pre linku ${LINE} momentálne nevidím žiadne odchody (ani online, ani offline).`);
      console.log(`Skús bez filtra: curl '${API_URL}?platform=1' alebo '?platform=2'`);
      process.exit(0);
    }

    // vyber najbližší
    rows.sort((a,b) => new Date(a.rawTime) - new Date(b.rawTime));
    const next = rows[0];
    const when = new Date(next.rawTime || next.planned || Date.now());
    const eta = fmtCountdown(msUntil(when));
    const delayMin = (next.delaySec != null) ? Math.round(next.delaySec / 60) : null;

    const routes = loadRoutes();
    const rkey = routeKey(next.line, next.headsign);
    const route = routes[rkey];

    // výpis
    console.log('================ Najbližší odchod =================');
    console.log(`Linka:       ${next.line}`);
    console.log(`Smer:        ${next.headsign}`);
    console.log(`Nástupište:  ${next.platform}`);
    console.log(`Odchod:      ${fmtClock(when)}  (o ${eta})`);
    if (delayMin !== null) console.log(`Meškanie:    ${delayMin >= 0 ? '+' : ''}${delayMin} min`);
    console.log(`Zdroj dát:   ${d1.rows?.includes(next) ? d1.source : d2.source}`);
    if (route && route.length) {
      console.log('Trasa:       ' + route.join(' → '));
    } else {
      console.log('Trasa:       (neznáma – doplň v routes.json kľúč "' + rkey + '")');
    }
    console.log('===================================================');
  } catch (e) {
    console.error('Chyba:', e.message || e);
    console.error('Tip: skús test spojenia:');
    console.error(`  curl '${API_URL}?platform=1'`);
    console.error(`  curl '${API_URL}?platform=2'`);
    process.exit(1);
  }
})();