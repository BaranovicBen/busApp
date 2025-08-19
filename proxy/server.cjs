// server.cjs — Node.js/Express proxy pre SOAP ASMX (dispecing.info)
// Volá SOAP POST (nie GET), má DEBUG logy a /api/health + /api/debug

const express = require('express');
const { XMLParser } = require('fast-xml-parser');

const PORT = process.env.PORT || 8787;

// ZÁKLADNÁ URL služby:
// <-- ak by dopravca poskytol inú URL, zmeň tu alebo cez env premennú
const TABLE_BASE = 'http://www.dispecing.info:808/TableData/Service.asmx';

const USER_ID = process.env.TABLEDATA_USER_ID || 'school-website'; // <-- tu daj identifikátor školy, ak chceš
const BUS_STOP_ID = 22304;      // <-- tvoja zastávka
const SNR = 22304001;                    // <-- tvoj snr (ID tabule)
const DEBUG = process.env.DEBUG == '1';                            // export DEBUG=1 pre verbose logy

// SOAP namespace – bežné pre .asmx je tempuri.org (ak by dopravca mal iné, zmeň tu)
const NS = process.env.SOAP_NS || "http://www.emtest.sk/cp/";
const SOAP_VERSION_ONLINE = process.env.SOAP_VERSION_ONLINE || process.env.SOAP_VERSION || '1.1';


const app = express();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' });

function log(...args){ if (DEBUG) console.log('[DEBUG]', ...args); }

function buildHeadersFor(version, method) {
  // SOAP 1.2
  if (String(version) === '1.2') {
    return {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${NS}${method}"`
    };
  }
  // SOAP 1.1 (default pre .asmx)
  return {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': `"${NS}${method}"`
  };
}

// 👇 pridaj niekam nad mapDsToRows
function normalizeLine({ ln, lnt }) {
  const t = String(lnt || '').trim();
  // ak je to už 1–3 cifry (napr. "527"), nechaj tak
  if (/^\d{1,3}$/.test(t)) return t;

  // 010 + 3 cifry → zober 3 cifry (napr. "010527" -> "527")
  const m010 = t.match(/^010(\d{3})$/);
  if (m010) return m010[1];

  // leading zeros pred 3 ciferkou (napr. "000527") → odstráň nuly
  const mZeros = t.match(/^0+(\d{3})$/);
  if (mZeros) return mZeros[1];

  // fallback: skús posledné 3 cifry z ln (napr. "10527" -> "527")
  const lnStr = String(ln || '');
  const mTail3 = lnStr.match(/(\d{3})$/);
  if (mTail3) return mTail3[1];

  // posledná poistka – vráť pôvodné texty
  return t || lnStr || '?';
}

// Pomocná funkcia – zapíše SOAP envelope a vráti text odpovede
async function soapCall(method, bodyInnerXml) {
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body>` +
        `<${method} xmlns="${NS}">` +
          bodyInnerXml +
        `</${method}>` +
      `</soap:Body>` +
    `</soap:Envelope>`;

  const r = await fetch(TABLE_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${NS}${method}"`,
    },
    body: envelope,
  });

  const txt = await r.text();
  log(method, 'HTTP', r.status, 'len', txt.length, 'peek:', txt.slice(0, 160));
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}`);

  const xml = parser.parse(txt);
  const body = xml?.['soap:Envelope']?.['soap:Body'] || xml?.['Envelope']?.['Body'] || xml?.['s:Envelope']?.['s:Body'];
  const resp = body?.[`${method}Response`];
  const resultStr = resp?.[`${method}Result`];

  if (typeof resultStr !== 'string') {
    throw new Error(`${method}Result not found in SOAP response`);
  }
  return resultStr; // je to reťazec s XML <DS>…</DS>
}

// Textový reťazec XML → objekt DS (alebo null)
function dsFromXmlText(text) {
  try {
    const ds = parser.parse(text)?.DS;
    return ds || null;
  } catch {
    // niekedy je XML escapnuté – skús premapovať entity
    const cleaned = text
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      .replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    try { return parser.parse(cleaned)?.DS || null; }
    catch { return null; }
  }
}

function parseSkDateTime(s) {
  // návratové časy sú v tvare "3.9.15 0:17" alebo "3.9.2015 0:17"
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
    // ⬇⬇⬇ KĽÚČOVÁ ZMENA: preferuj lnt (textová linka), fallback na ln
    const line = normalizeLine({ ln: d.ln, lnt: d.lnt }); // <-- NOVÉ

    // ⬇⬇⬇ KĽÚČOVÁ ZMENA: preferuj pt (platforma v offline), fallback na p (niektoré odpovede online)
    const platform = d.pt != null ? d.pt : d.p;

    // čas: ta (arrival) alebo td (departure)
    const plannedStr = (d.ta || d.td || '').trim();
    const raw = parseSkDateTime(plannedStr);

    // smer (end/board name)
    const headsign = d.ebn != null ? d.ebn : (d.en || d.eb || '');

    const delaySec =
      d.de != null ? Number(d.de) :
      d.del != null ? Number(d.del) : undefined;

    return {
      line: String(line ?? ''),
      headsign: String(headsign ?? ''),
      platform: String(platform ?? ''),
      planned: plannedStr,
      plannedType: d.ta ? 'arrival' : 'departure',
      delaySec,
      flags: typeof d.fl === 'string' ? d.fl.split(',') : undefined,
      rawTime: raw
    };
  }).filter(r =>
    r.line && r.headsign && r.platform && r.planned && !isNaN(r.rawTime.getTime())
  );

  // zoradené najbližšie navrchu
  rows.sort((a, b) => a.rawTime - b.rawTime);
  return rows;
}

// ISO "yyyy-MM-ddTHH:mm:ss" (pre DateTime parametre v SOAP)
// Pozn.: dokument ukazuje formát výstupu, no vstupné DateTime bývajú XML schema dateTime.
function iso(dt){
  const z = n => String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${z(dt.getMonth()+1)}-${z(dt.getDate())}T${z(dt.getHours())}:${z(dt.getMinutes())}:${z(dt.getSeconds())}`;
}

// --------- ONLINE ----------
async function callOnline({ busStopID, count, platforms, getArrivals, orderByDelay, snr }) {
    // !!! KĽÚČOVÉ: názov elementu je busStopID (veľké S)  // <--
    const envelope =
  `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetOnlineStopTime xmlns="${NS}">
        <busStopID>${busStopID}</busStopID>        <!-- <-- -->
        <count>${count}</count>
        <platformNumbers>${platforms}</platformNumbers>
        <getArrivals>${getArrivals ? 'true':'false'}</getArrivals>
        <orderByDelay>${orderByDelay ? 'true':'false'}</orderByDelay>
        <snr>${snr}</snr>
        <!-- NEPOSIELAME userID, keďže ukážka ho neuvádza -->
      </GetOnlineStopTime>
    </soap:Body>
  </soap:Envelope>`;

  const headers = buildHeadersFor(SOAP_VERSION_ONLINE, 'GetOnlineStopTime');
  if (process.env.DEBUG) {
    console.log('[DEBUG] ONLINE SOAP headers:', headers);
    console.log('[DEBUG] ONLINE SOAP envelope:', envelope);
  }

  const r = await fetch(TABLE_BASE, { method: 'POST', headers, body: envelope });
  const txt = await r.text();
  if (process.env.DEBUG) console.log('[DEBUG] ONLINE HTTP', r.status, 'len', txt.length);

  if (!r.ok) throw new Error(`GetOnlineStopTime HTTP ${r.status}`);

  // vytiahni string s <DS> z GetOnlineStopTimeResult (je to XML-výsledok v stringu)
  const m = txt.match(/<GetOnlineStopTimeResult>([\s\S]*?)<\/GetOnlineStopTimeResult>/);
  const payload = m ? m[1] : '';
  return payload; // napr. &lt;DS&gt;...&lt;/DS&gt;
}

// --------- OFFLINE ----------
async function callOffline(platform, count) {
const now = new Date();
const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
const endTomorrowPlus = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
  const inner =
    `<busStopID>${BUS_STOP_ID}</busStopID>` +
    `<platformNumbers>${platform}</platformNumbers>` +
    `<getArrivals>false</getArrivals>` +
    `<dateFrom>${iso(startToday)}</dateFrom>` +
    `<dateTo>${iso(endTomorrowPlus)}</dateTo>` +
    `<Count>${count}</Count>`;
  const resultStr = await soapCall('GetAVLStopTime', inner);
  const ds = dsFromXmlText(resultStr);
  if (!ds) { log('Offline: DS not found'); return []; }
  const rows = mapDsToRows(ds);
  log('Offline rows:', rows.length);
  return rows;
}

app.use((req, res, next) => {
  // počas vývoja pokojne '*', v produkcii radšej konkrétnu doménu:
  res.setHeader('Access-Control-Allow-Origin', 'https://dev.narniapk.sk'); // alebo '*'
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


// --------- ROUTES ----------
app.get('/api/stop-times', async (req, res) => {
  try {
    const platform = String(req.query.platform || '1');
    const count = Math.max(1, Math.min(20, Number(req.query.count) || 8));

    let rows = [];
    let online = false; // default false, prepne sa na true, ak online dá DS

    // ===== ONLINE najprv – identicky ako v /api/debug =====
    try {
      const rOnline = await soapCall(
        'GetOnlineStopTime',
        `<busStopID>${BUS_STOP_ID}</busStopID>` +
        `<count>${count}</count>` +
        `<platformNumbers>${platform}</platformNumbers>` +
        `<getArrivals>false</getArrivals>` +
        `<orderByDelay>true</orderByDelay>` +
        `<snr>${SNR}</snr>`
      );
      const dsOn = dsFromXmlText(rOnline);
      if (dsOn) {
        rows = mapDsToRows(dsOn);
        online = true;
        if (process.env.DEBUG) console.log('[DEBUG] stop-times ONLINE rows:', rows.length);
      } else {
        if (process.env.DEBUG) console.log('[DEBUG] stop-times ONLINE DS empty -> fallback offline');
      }
    } catch (e) {
      if (process.env.DEBUG) console.log('[DEBUG] stop-times ONLINE error:', e.message);
    }

    // ===== OFFLINE fallback, ak online nič nedalo =====
    if (!rows.length) {
      try {
        rows = await callOffline(platform, count);
        online = false;
        if (process.env.DEBUG) console.log('[DEBUG] stop-times OFFLINE rows:', rows.length);
      } catch (e2) {
        if (process.env.DEBUG) console.log('[DEBUG] stop-times OFFLINE error:', e2.message);
      }
    }

    // --- PREFERUJ DNES ---
    const now = new Date();
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // pozor: pri online musí mať každá položka korektne vyplnené rawTime
    const toDate = x => new Date(x.rawTime || x.planned);
    let upcoming = rows.filter(r => {
      const t = toDate(r);
      return t >= now && isFinite(t.getTime());
    });

    const todayUpcoming = upcoming.filter(r => {
      const t = toDate(r);
      return t <= endToday;
    });

    rows = (todayUpcoming.length ? todayUpcoming : (upcoming.length ? upcoming : rows)).slice(0, count);

    res.json({ online, source: online ? 'online' : 'offline', rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/board', async (req, res) => {
  try {
    const count = Math.max(1, Math.min(20, Number(req.query.count) || 10));
    const [p1, p2] = await Promise.all([
      fetchJson(`http://127.0.0.1:${PORT}/api/stop-times?platform=1&count=${count}`),
      fetchJson(`http://127.0.0.1:${PORT}/api/stop-times?platform=2&count=${count}`),
    ]);
    // preferuj cache na pár sekúnd v prehliadači
    res.setHeader('Cache-Control', 'max-age=5');
    res.json({ p1, p2, at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Upstream ${r.status}`);
  return r.json();
}


// Health – aby si nevidel viac „Cannot GET…“
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Debug – vráti statusy a počty riadkov
app.get('/api/debug', async (req, res) => {
  const platform = String(req.query.platform || '1');
  const count = Math.max(1, Math.min(20, Number(req.query.count) || 8));
  const out = { platform, count };

  try {
    const rOnline = await soapCall(
      'GetOnlineStopTime',
      `<busStopID>${BUS_STOP_ID}</busStopID>` +       // POZOR: veľké "S"
      `<count>${count}</count>` +
      `<platformNumbers>${platform}</platformNumbers>` +
      `<getArrivals>false</getArrivals>` +
      `<orderByDelay>true</orderByDelay>` +
      `<snr>${SNR}</snr>`
      // userID zámerne NEPOSIELAME, ukážka ho nemá
    );
    const dsOn = dsFromXmlText(rOnline);
    out.online = {
      hasDS: !!dsOn,
      rows: dsOn ? mapDsToRows(dsOn).length : 0,
      peek: String(rOnline).slice(0, 400)
    };

  } catch (e) { out.online = { error: String(e) }; }

  try {
    const now = new Date(), later = new Date(Date.now()+2*60*60*1000);
    const rOffline = await soapCall('GetAVLStopTime',
      `<busstopID>${BUS_STOP_ID}</busstopID><platformNumbers>${platform}</platformNumbers><getArrivals>false</getArrivals><dateFrom>${iso(now)}</dateFrom><dateTo>${iso(later)}</dateTo><Count>${count}</Count>`
    );
    const dsOff = dsFromXmlText(rOffline);
    out.offline = { hasDS: !!dsOff, rows: dsOff ? mapDsToRows(dsOff).length : 0, peek: String(rOffline).slice(0, 200) };
  } catch (e) { out.offline = { error: String(e) }; }

  res.json(out);
});

app.listen(PORT, () => {
  console.log(`Bus proxy listening on :${PORT}`);
  console.log(`Using BUS_STOP_ID=${BUS_STOP_ID}, SNR=${SNR}, TABLE_BASE=${TABLE_BASE}`);
});