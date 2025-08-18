const express = require('express');
const { XMLParser } = require('fast-xml-parser');

const PORT = process.env.PORT || 8787;
const TABLE_BASE = process.env.TABLEDATA_BASE_URL || 'http://www.dispecing.info:808/TableData/Service.asmx';
const USER_ID = process.env.TABLEDATA_USER_ID || 'school-website';
const BUS_STOP_ID = Number(process.env.BUS_STOP_ID || 22304);
const SNR = Number(process.env.SNR || 22304001);

const app = express();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' });

function parseSkDateTime(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return new Date(s);
  let [, d, M, y, H, min] = m;
  let year = parseInt(y, 10);
  if (year < 100) year += (year < 80 ? 2000 : 1900);
  return new Date(year, parseInt(M,10)-1, parseInt(d,10), parseInt(H,10), parseInt(min,10), 0, 0);
}

function mapDsToRows(ds) {
  const list = Array.isArray(ds?.D) ? ds.D : (ds?.D ? [ds.D] : []);
  const rows = list.map(d => {
    const plannedStr = (d.ta || d.td || '').trim();
    const raw = parseSkDateTime(plannedStr);
    return {
      line: String(d.ln ?? ''),
      headsign: String(d.ebn ?? ''),
      platform: String(d.p ?? ''),
      planned: plannedStr,
      plannedType: d.ta ? 'arrival' : 'departure',
      delaySec: d.de != null ? Number(d.de) : undefined,
      flags: typeof d.fl === 'string' ? d.fl.split(',') : undefined,
      rawTime: raw
    };
  }).filter(r => r.line && r.headsign && r.platform && r.planned && !isNaN(r.rawTime.getTime()));
  rows.sort((a,b) => a.rawTime - b.rawTime);
  return rows;
}

async function callOnline(platform, count) {
  const url = `${TABLE_BASE}/GetOnlineStopTime?busstopID=${BUS_STOP_ID}&count=${count}` +
              `&platformNumbers=${encodeURIComponent(platform)}&getArrivals=false` +
              `&userID=${encodeURIComponent(USER_ID)}&orderByDelay=true&snr=${SNR}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Online HTTP ${r.status}`);
  const txt = await r.text();
  const xml = parser.parse(txt);
  const ds = xml?.DS || xml;
  return mapDsToRows(ds);
}

function fmt(date) {
  const d = date.getDate();
  const M = date.getMonth()+1;
  const y = String(date.getFullYear()).slice(-2);
  const H = date.getHours();
  const m = String(date.getMinutes()).padStart(2,'0');
  return `${d}.${M}.${y} ${H}:${m}`;
}

async function callOffline(platform, count) {
  const now = new Date();
  const later = new Date(now.getTime() + 2*60*60*1000);
  const url = `${TABLE_BASE}/GetAVLStopTime?busstopID=${BUS_STOP_ID}` +
              `&platformNumbers=${encodeURIComponent(platform)}&getArrivals=false` +
              `&dateFrom=${encodeURIComponent(fmt(now))}&dateTo=${encodeURIComponent(fmt(later))}` +
              `&Count=${count}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Offline HTTP ${r.status}`);
  const txt = await r.text();
  const xml = parser.parse(txt);
  const ds = xml?.DS || xml;
  return mapDsToRows(ds);
}

app.get('/api/stop-times', async (req, res) => {
  try {
    const platform = String(req.query.platform || '1');
    const count = Math.max(1, Math.min(20, Number(req.query.count) || 8));
    let rows = [];
    let online = true;

    try { rows = await callOnline(platform, count); }
    catch(e) { online = false; }

    if (!rows.length) {
      try { rows = await callOffline(platform, count); online = false; }
      catch(e2) {}
    }

    res.json({ online, source: online ? 'online' : 'offline', rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Bus proxy listening on :${PORT}`);
});