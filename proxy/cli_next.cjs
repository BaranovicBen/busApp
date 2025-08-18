// cli_board.cjs — pekný výpis oboch nástupíšť (1 aj 2) s odpočtom
// API základ je lokálny server, pokojne neskôr zmeň na doménu školy:
//   napr. 'https://bus.tvoja-skola.tld/api/stop-times'  // <-- tu doplň doménu školy po nasadení Caddy
const API_URL = process.env.API_URL || 'http://127.0.0.1:8787/api/stop-times'; // <-- lokálne API

// CLI voľby
const args = process.argv.slice(2);
const getArg = (k, def=null) => {
  const i = args.indexOf(k);
  return i >= 0 ? (args[i+1] ?? true) : def;
};
const ONLY_LINE = getArg('--line', null);      // napr. --line 527
const LIMIT = Number(getArg('--limit', 5));    // napr. --limit 10
const ALL_DAY = args.includes('--all-day');    // ak chceš bez filtrovania času

// pomocné funkcie
const pad2 = n => String(n).padStart(2, '0');
const skClock = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const msUntil = d => (new Date(d).getTime() - Date.now());
const fmtCountdown = ms => {
  if (ms <= 0) return 'odchádza';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} h ${mm} m` : `${mm} m`;
};
const withinWindow = (t, minutesPast = 1, minutesAhead = 180) => {
  const ms = msUntil(t);
  return ms >= -minutesPast * 60000 && ms <= minutesAhead * 60000;
};

async function getPlatform(p, count=30) {
  const url = `${API_URL}?platform=${encodeURIComponent(p)}&count=${count}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  const json = await r.json();
  // očakávame rows s rawTime (ISO) – pochádza zo servera
  let rows = (json.rows || []).map(x => ({...x, when: new Date(x.rawTime ?? x.planned)}));
  // voliteľný filter na linku
  if (ONLY_LINE) rows = rows.filter(r => String(r.line) === String(ONLY_LINE));
  // ponechaj len nadchádzajúce (ak nie je --all-day)
  if (!ALL_DAY) rows = rows.filter(r => withinWindow(r.when));
  // zoradenie podľa času
  rows.sort((a,b) => a.when - b.when);
  return { platform: String(p), source: json.source, rows };
}

(async () => {
  try {
    const [p1, p2] = await Promise.all([getPlatform(1), getPlatform(2)]);
    const blocks = [p1, p2];

    for (const b of blocks) {
      console.log('');
      console.log(`========== Nástupište ${b.platform} (${b.source}) ==========`); // zobraz aj zdroj (online/offline)
      if (!b.rows.length) {
        console.log('Žiadne nadchádzajúce odchody v najbližších 3 hodinách.');
        continue;
      }
      const take = b.rows.slice(0, Math.max(1, LIMIT));
      for (const r of take) {
        const when = r.when;
        console.log(
          `${skClock(when)}  (o ${fmtCountdown(msUntil(when))})  ` +
          `linka ${r.line}  →  ${r.headsign}`
        );
      }
    }

    console.log('');
    console.log('Tipy:');
    console.log('  node cli_board.cjs --line 527         # iba linka 527 na oboch nástupištiach');
    console.log('  node cli_board.cjs --limit 10         # zobraz viac odchodov');
    console.log('  node cli_board.cjs --all-day          # vypni filtrovací čas (debug)');
    console.log('');
  } catch (e) {
    console.error('Chyba CLI:', e.message || e);
    console.error('Skús test API:');
    console.error(`  curl '${API_URL}?platform=1'`);
    console.error(`  curl '${API_URL}?platform=2'`);
    process.exit(1);
  }
})();