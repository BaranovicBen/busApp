// cli_next.cjs — pre nástupište 1 aj 2: najbližší + ďalší odchod
const API_URL = process.env.API_URL || 'http://127.0.0.1:8787/api/stop-times'; // <-- po nasadení daj HTTPS doménu školy

const pad2 = n => String(n).padStart(2, '0');
const skClock = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const msUntil = d => (new Date(d).getTime() - Date.now());
const fmtCountdown = ms => {
  if (ms <= 0) return 'odchádza';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} h ${mm} m` : `${mm} m`;
};
const isSameYMD = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();

async function fetchPlatform(p, count=50){
  const r = await fetch(`${API_URL}?platform=${encodeURIComponent(p)}&count=${count}`);
  if(!r.ok) throw new Error(`API ${r.status}`);
  const json = await r.json();
  const rows = (json.rows || []).map(x => ({...x, when: new Date(x.rawTime ?? x.planned)}));
  const upcoming = rows.filter(r => r.when >= new Date()).sort((a,b)=>a.when-b.when);
  const chosen = upcoming.length >= 2 ? upcoming.slice(0,2)
                : (upcoming.length === 1 ? [upcoming[0], rows.find(rr => rr.when>upcoming[0].when)].filter(Boolean)
                : rows.slice(0,2));
  return { platform: String(p), source: json.source, chosen };
}

(async () => {
  try {
    const now = new Date();
    const [p1, p2] = await Promise.all([fetchPlatform(1), fetchPlatform(2)]);
    for(const blk of [p1, p2]){
      console.log('');
      console.log(`=== Nástupište ${blk.platform} (${blk.source}) ===`);
      if(!blk.chosen || !blk.chosen.length){
        console.log('Žiadne odchody na zobrazenie.');
        continue;
      }
      blk.chosen.forEach((r, idx) => {
        const label = idx === 0 ? 'Najbližší' : 'Ďalší   ';
        const dayTag = isSameYMD(r.when, now) ? 'dnes' : 'zajtra';
        console.log(`${label}: ${skClock(r.when)} (${dayTag}, o ${fmtCountdown(msUntil(r.when))})  linka ${r.line} → ${r.headsign}`);
      });
    }
    console.log('');
  } catch(e){
    console.error('Chyba CLI:', e.message || e);
    console.error(`Testni API: curl '${API_URL}?platform=1'`);
    console.error(`            curl '${API_URL}?platform=2'`);
    process.exit(1);
  }
})();