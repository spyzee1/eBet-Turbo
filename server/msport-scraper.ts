// ============================================================================
// MSPORT.COM SCRAPER — Live O/U Odds for GT Leagues & eAdriatic League
// API: https://www.msport.com/api/gh/facts-center/query/frontend/live-matches/list
//      ?sportId=sr:sport:137&sortBy=DEFAULT&marketIds
// ============================================================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './db.js';

const __dirname_esm = dirname(fileURLToPath(import.meta.url));
const MSPORT_RESULTS_PATH = resolve(__dirname_esm, '../msport-results.json');

// ── Cookie manager ────────────────────────────────────────────────────────────
// Az msport.com API JavaScript-által beállított session tokent igényel (bizCode 19000 nélkül).
// A felhasználó a böngésző DevTools-ból másolja be a Cookie stringet az API végpontba.
// Tárolás: memória + opcionálisan .env fájl (MSPORT_COOKIE változó).

let manualCookie = process.env.MSPORT_COOKIE || '';
if (manualCookie) {
  console.log(`[msport] env cookie betöltve (${manualCookie.length} karakter)`);
} else {
  console.log('[msport] ⚠️ MSPORT_COOKIE env nincs beállítva — auto-cookie indul');
}

/** Kívülről (API-ból) beállítható a cookie string */
export function setMsportCookie(cookie: string): void {
  manualCookie = cookie.trim();
  console.log(`[msport] cookie beállítva (${manualCookie.length} karakter)`);
  // Töröljük a cache-t, hogy az új cookie-val frissüljön
  cache = null;
}

export function getMsportCookieStatus(): { set: boolean; length: number } {
  return { set: !!manualCookie, length: manualCookie.length };
}

// Megpróbáljuk a főoldalt is (backup, ha nincs manuális cookie)
let autoCookie = '';
let autoCookieTs = 0;
const AUTO_COOKIE_TTL = 10 * 60 * 1000;

async function tryAutoSession(): Promise<void> {
  if (manualCookie) return; // ha van manuális cookie, azt használjuk
  if (autoCookie && Date.now() - autoCookieTs < AUTO_COOKIE_TTL) return;
  try {
    const resp = await axios.get('https://www.msport.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 8_000,
      maxRedirects: 5,
    });
    const setCookie = resp.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      autoCookie = setCookie.map((c: string) => c.split(';')[0]).join('; ');
      autoCookieTs = Date.now();
      console.log(`[msport] auto-cookie (${setCookie.length} db)`);
    }
  } catch {
    // silent fail
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Base URL — minden lekérésnél ezt a live-matches endpointot használjuk.
// A comingSoons mező tartalmazza a hamarosan kezdő meccseket odds-okkal.
const API_URL_LIVE =
  'https://www.msport.com/api/gh/facts-center/query/frontend/live-matches/list' +
  '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds';

// Alternatív upcoming endpoint próbák — ha a live-matches nem ad elég meccset
const API_URL_CANDIDATES = [
  // Live/upcoming kombó (ismert működő endpoint)
  API_URL_LIVE,
  // Pre-match endpoint (lehet hogy létezik)
  'https://www.msport.com/api/gh/facts-center/query/frontend/matches/list' +
    '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds',
  // Upcoming-only
  'https://www.msport.com/api/gh/facts-center/query/frontend/upcoming-matches/list' +
    '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds',
];

function buildHeaders(): Record<string, string> {
  const cookie = manualCookie || autoCookie;
  const h: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.msport.com/',
    'Origin': 'https://www.msport.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Connection': 'keep-alive',
    // Ghana operator ID — kinyerve a www.msport.com/gh homepage inline config-ból
    'operId': '3',
  };
  if (cookie) h['Cookie'] = cookie;
  return h;
}

// Tournament id → belső liga név
// sr:tournament:39749  = eAdriatic League (10 mins)
// sr:tournament:33496  = GT Leagues (12 mins)
const TOURNAMENT_MAP: Record<string, string> = {
  'sr:tournament:39749': 'eAdriatic League',
  'sr:tournament:33496': 'GT Leagues',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MsportOdds {
  playerA: string;   // home játékos neve (zárójelből kinyerve)
  playerB: string;   // away játékos neve
  teamA: string;     // csapatnév (pl. "Manchester City FC")
  teamB: string;
  league: string;    // "eAdriatic League" | "GT Leagues"
  ouLine: number;    // pl. 6.5
  oddsOver: number;
  oddsUnder: number;
  startTime: number; // Unix ms
  eventId: string;
  source: 'msport.com';
}

export interface MsportLiveScore {
  playerA: string;   // lowercase játékosnév
  playerB: string;
  scoreA: number;
  scoreB: number;
  minute: number;
  isLive: boolean;
  source: 'msport.com';
  period: number | null;
  periodName: string | null;
}

interface MsportOutcome {
  description: string;  // "Over 6.5" | "Under 6.5"
  id: string;           // "12" = over, "13" = under
  isActive: number;
  odds: string;         // "2.06"
  probability: string;
}

interface MsportMarket {
  id: number;           // 18 = Over/Under
  name: string;
  description: string;
  specifiers: string;   // "total=6.5"
  outcomes: MsportOutcome[];
  status: number;
}

interface MsportEvent {
  homeTeam: string;       // "Manchester City FC (Andrew)"
  awayTeam: string;       // "FC Bayern Munich (Conde)"
  homeTeamId: string;
  awayTeamId: string;
  category: string;       // "eAdriatic League" | "GT Sports League"
  tournament: string;     // "eAdriatic League (10 mins)" | "GT Leagues (12 mins)"
  tournamentId: string;   // "sr:tournament:39749"
  eventId: string;
  startTime: number;      // Unix ms
  markets: MsportMarket[];
  status: number;         // 0 = upcoming, >0 = live
}

interface MsportResponse {
  bizCode: number;
  data: {
    comingSoons?: MsportEvent[];
    liveMatches?: MsportEvent[];
    matches?: MsportEvent[];
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface Cache { data: MsportOdds[]; ts: number; }
let cache: Cache | null = null;
const CACHE_TTL       = 30 * 60_000;   // 30 perc normál frissítés (kevesebb msport-hívás)
const RATE_LIMIT_TTL  = 30 * 60_000;  // 30 perc backoff ha 429-et kapunk

// ── Közös rate-limit állapot — MINDEN msport API hívásra (live, fixtures, upcoming) ──
// Cloudflare IP-szinten blokkol → ha egyszer 429, az összes endpoint tiltva van.
let _rateLimitedUntil = 0; // epoch ms

export function isMsportRateLimited(): boolean {
  return Date.now() < _rateLimitedUntil;
}

function markMsportRateLimited(): void {
  _rateLimitedUntil = Date.now() + RATE_LIMIT_TTL;
  console.warn(`[msport] 🔴 429 rate limit → ${RATE_LIMIT_TTL / 60_000} perces backoff (minden msport endpoint blokkolva)`);
}

function rateLimitRemainingS(): number {
  return Math.max(0, Math.round((_rateLimitedUntil - Date.now()) / 1000));
}

// ── In-flight dedup: ne menjen 2 párhuzamos kérés egyszerre ──────────────────
let _oddsInFlight: Promise<MsportOdds[]> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * "Manchester City FC (Andrew)" → "Andrew"
 * "FC Bayern Munich (Conde)"   → "Conde"
 * Ha nincs zárójel → visszaadja a teljes nevet
 */
function extractPlayerName(fullName: string): string {
  const match = fullName.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : fullName.trim();
}

/**
 * "Manchester City FC (Andrew)" → "Manchester City FC"
 * "Donatello"                   → "" (nincs külön csapatnév, csak játékos)
 */
function extractTeamName(fullName: string): string {
  if (!fullName.includes('(')) return ''; // nincs zárójel → nincs különálló csapatnév
  return fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

/**
 * Meghatározza a belső liga nevet tournamentId vagy tournament szöveg alapján
 */
function mapLeague(ev: MsportEvent): string | null {
  // Elsőként tournamentId alapján (legmegbízhatóbb)
  if (TOURNAMENT_MAP[ev.tournamentId]) return TOURNAMENT_MAP[ev.tournamentId];
  // Fallback: szöveg alapján
  const t = (ev.tournament || ev.category || '').toLowerCase();
  if (t.includes('adriatic')) return 'eAdriatic League';
  if (t.includes('gt league') || t.includes('gt sport')) return 'GT Leagues';
  return null;
}

/**
 * Kinyeri az Over/Under oddsokat egy meccs markets tömbéből.
 * Market id 18 = Over/Under, outcome id 12 = Over, 13 = Under.
 * Megjegyzés: pre-match meccseken market.status != 0 és outcome.isActive = 0 lehet,
 * ezért ezeket a szűrőket elhagyjuk — csak az odds értékére szűrünk.
 */
function extractOU(markets: MsportMarket[]): { ouLine: number; oddsOver: number; oddsUnder: number } | null {
  if (!markets || markets.length === 0) return null;

  // 1. Keresünk market id=18 alapján (bármilyen status)
  // 2. Fallback: name alapján (Over/Under, Goals)
  let ouMarket = markets.find(m => m.id === 18);
  if (!ouMarket) {
    ouMarket = markets.find(m => {
      const n = (m.name || m.description || '').toLowerCase();
      return n.includes('over') || n.includes('total') || n.includes('goal');
    });
  }
  if (!ouMarket || !ouMarket.outcomes || ouMarket.outcomes.length === 0) return null;

  // O/U vonal a specifiers-ből: "total=6.5" → 6.5
  const lineMatch = (ouMarket.specifiers || '').match(/total=([\d.]+)/);
  const ouLine = lineMatch ? parseFloat(lineMatch[1]) : 0;
  if (!ouLine) return null;

  let oddsOver = 0, oddsUnder = 0;
  for (const o of ouMarket.outcomes) {
    // NEM szűrünk isActive-ra — pre-match outcomes-nál isActive=0 lehet
    const desc = (o.description || '').toLowerCase();
    const val = parseFloat(o.odds);
    if (isNaN(val) || val <= 1) continue;
    // id "12" = Over, "13" = Under (string vagy szám formátum)
    // desc lehet: "Over 2.5", "Total Over 2.5", "Under 2.5", "Total Under 2.5"
    const idStr = String(o.id);
    const isOver  = idStr === '12' || desc.includes('over');
    const isUnder = idStr === '13' || desc.includes('under');
    if (isOver && !isUnder) oddsOver = val;
    else if (isUnder && !isOver) oddsUnder = val;
  }

  if (!oddsOver || !oddsUnder) return null;
  return { ouLine, oddsOver, oddsUnder };
}

/**
 * Egy MsportEvent listából kinyeri az MsportOdds rekordokat
 */
function parseEvents(events: MsportEvent[]): MsportOdds[] {
  const results: MsportOdds[] = [];
  for (const ev of events) {
    const league = mapLeague(ev);
    if (!league) continue; // nem GT Leagues vagy eAdriatic League

    const ou = extractOU(ev.markets ?? []);
    if (!ou) continue; // nincs O/U odds

    const playerA = extractPlayerName(ev.homeTeam);
    const teamA   = extractTeamName(ev.homeTeam);
    const playerB = extractPlayerName(ev.awayTeam);
    const teamB   = extractTeamName(ev.awayTeam);
    // Első alkalommal logoljuk a nyers neveket — megmutatja hogy van-e csapatnév az API-ban
    if (results.length === 0) {
      console.log(`[msport] nyers nevek (${league}): home="${ev.homeTeam}" away="${ev.awayTeam}" → player="${playerA}" team="${teamA}"`);
    }
    results.push({
      playerA,
      playerB,
      teamA,
      teamB,
      league,
      ouLine:   ou.ouLine,
      oddsOver: ou.oddsOver,
      oddsUnder: ou.oddsUnder,
      startTime: ev.startTime,
      eventId:  ev.eventId,
      source:   'msport.com',
    });
  }
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Lekéri az msport.com live-matches listát és visszaadja a GT Leagues +
 * eAdriatic League O/U oddsokat. 30 mp-es cache-sel.
 */
async function fetchFromUrl(url: string): Promise<MsportOdds[]> {
  await tryAutoSession();
  const resp = await axios.get<MsportResponse>(url, { headers: buildHeaders(), timeout: 5_000 });
  if (resp.data.bizCode !== 10000) throw new Error(`bizCode ${resp.data.bizCode}`);
  const d = resp.data.data;
  const allEvents: MsportEvent[] = [
    ...(d.comingSoons ?? []),
    ...(d.liveMatches ?? []),
    ...(d.matches     ?? []),
  ];
  return parseEvents(allEvents);
}

export async function getMsportOdds(): Promise<MsportOdds[]> {
  const now = Date.now();

  // Ha rate-limitedek vagyunk, adjuk vissza a stale cache-t (vagy ürestet)
  if (isMsportRateLimited()) {
    const remaining = rateLimitRemainingS();
    if (cache) {
      console.log(`[msport] rate-limit backoff ${remaining}s → stale cache (${cache.data.length} odds)`);
      return cache.data;
    }
    console.log(`[msport] rate-limit backoff ${remaining}s → nincs cache, üres lista`);
    return [];
  }

  // Friss cache
  if (cache && now - cache.ts < CACHE_TTL) return cache.data;

  // Ha már folyamatban van egy kérés, várjuk meg azt (ne küldjünk duplikát)
  if (_oddsInFlight) return _oddsInFlight;

  _oddsInFlight = (async () => {
    const seen = new Set<string>();
    const allOdds: MsportOdds[] = [];
    let hit429 = false;

    for (const url of API_URL_CANDIDATES) {
      try {
        const odds = await fetchFromUrl(url);
        let added = 0;
        for (const o of odds) {
          const key = o.eventId || `${o.playerA}|${o.playerB}|${o.startTime}`;
          if (!seen.has(key)) { seen.add(key); allOdds.push(o); added++; }
        }
        console.log(`[msport] ✅ ${url.includes('live') ? 'live' : url.includes('upcoming') ? 'upcoming' : 'matches'} API: ${odds.length} odds (+${added} új)`);
        if (allOdds.length >= 10) break;
      } catch (e: any) {
        const status = e.response?.status ?? 0;
        const isTimeout = e.code === 'ECONNABORTED' || String(e.message).toLowerCase().includes('timeout');
        const is429 = status === 429 || String(e.message).includes('429');
        if (is429) {
          hit429 = true;
          markMsportRateLimited();
          break; // nem próbálunk több URL-t sem
        }
        if (isTimeout) {
          console.warn(`[msport] ⏱️ timeout — backoff nem aktiválva: ${url.slice(-40)}`);
        } else {
          console.warn(`[msport] ⚠️ API hiba (${e.message}): ${url.slice(-40)}`);
        }
      }
    }

    if (hit429) {
      _oddsInFlight = null;
      // Stale cache-t adunk vissza ha van
      return cache?.data ?? [];
    }

    console.log(`[msport] összesen ${allOdds.length} odds (GT: ${allOdds.filter(o => o.league === 'GT Leagues').length}, eAdr: ${allOdds.filter(o => o.league === 'eAdriatic League').length})`);
    cache = { data: allOdds, ts: Date.now() };
    _oddsInFlight = null;
    return allOdds;
  })();

  return _oddsInFlight;
}

/**
 * Egy konkrét meccshez keres O/U oddst — játékosnév alapján fuzzy egyeztetés.
 * Visszaadja a legjobb egyezést vagy null-t.
 */
export async function getMsportOddsForMatch(
  playerA: string,
  playerB: string,
): Promise<{ ouLine: number; oddsOver: number; oddsUnder: number } | null> {
  const all = await getMsportOdds();
  if (all.length === 0) {
    console.log(`[msport] getMsportOddsForMatch(${playerA}, ${playerB}): cache üres`);
    return null;
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nA = norm(playerA);
  const nB = norm(playerB);

  // 1. Pontos egyezés
  let match = all.find(o => norm(o.playerA) === nA && norm(o.playerB) === nB);
  if (!match) match = all.find(o => norm(o.playerA) === nB && norm(o.playerB) === nA);

  // 2. Fuzzy: egyik névben tartalmazza-e a másik első N karakterét
  const fuzzyLen = (a: string, b: string) => Math.min(Math.max(a.length, b.length, 4), 6);
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      const lenA = fuzzyLen(oA, nA), lenB = fuzzyLen(oB, nB);
      return (oA.startsWith(nA.slice(0, lenA)) || nA.startsWith(oA.slice(0, lenA))) &&
             (oB.startsWith(nB.slice(0, lenB)) || nB.startsWith(oB.slice(0, lenB)));
    });
  }
  // 3. Fordított fuzzy
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      const lenA = fuzzyLen(oA, nB), lenB = fuzzyLen(oB, nA);
      return (oA.startsWith(nB.slice(0, lenA)) || nB.startsWith(oA.slice(0, lenA))) &&
             (oB.startsWith(nA.slice(0, lenB)) || nA.startsWith(oB.slice(0, lenB)));
    });
  }

  if (!match) {
    // Logoljuk a miss-t: megmutatja milyen nevek vannak a cache-ben
    const sampleNames = all.slice(0, 6).map(o => `${o.playerA}|${o.playerB}(${o.league})`).join(', ');
    console.log(`[msport] ❌ nem talált: ${playerA} vs ${playerB} | cache minták: ${sampleNames}`);
    return null;
  }

  console.log(`[msport] ✅ talált: ${playerA} vs ${playerB} → ${match.playerA} vs ${match.playerB} | O/U ${match.ouLine}`);
  return { ouLine: match.ouLine, oddsOver: match.oddsOver, oddsUnder: match.oddsUnder };
}

/**
 * Schedule-kompatibilis nézet az msport upcoming meccsekhez.
 * Visszaadja az eAdriatic League ÉS a GT Leagues meccseket — csak azokat,
 * amelyekhez az msport-ban valódi O/U odds van (comingSoons ablak).
 * GT Leagues: az esoccerbet schedule ezt kiegészíti, de a dedup kiszűri az ismétléseket.
 */
export async function getMsportSchedule(): Promise<Array<{
  playerHome: string;
  playerAway: string;
  league: string;
  time: string;   // "HH:MM" — Közép-európai idő
  date: string;   // "MM/DD"
}>> {
  const all = await getMsportOdds();
  return all
    .filter(o => o.league === 'eAdriatic League' || o.league === 'GT Leagues')
    .map(o => {
      const d = new Date(o.startTime);
      const mm  = String(d.getMonth() + 1).padStart(2, '0');
      const dd  = String(d.getDate()).padStart(2, '0');
      const hh  = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return {
        playerHome: o.playerA,
        playerAway: o.playerB,
        teamHome:   o.teamA,
        teamAway:   o.teamB,
        league: o.league,
        time: `${hh}:${min}`,
        date: `${mm}/${dd}`,
      };
    });
}

// ── Upcoming schedule from fixtures API (rate-limit safe) ─────────────────────
// A live-matches API Cloudflare-védett → helyette a my-matches/fixtures API
// közelgő meccseit használjuk menetrend forrásként.
// Ez NEM hív live-matches endpointot → nincs 429 kockázat.

let _upcomingCache: { data: Array<{
  playerHome: string; playerAway: string;
  teamHome: string;   teamAway: string;
  league: string; time: string; date: string;
  startTime: number; eventId: string;
}>; ts: number } | null = null;
const UPCOMING_CACHE_TTL = 3 * 60_000; // 3 perces cache

export async function getMsportUpcomingSchedule(): Promise<Array<{
  playerHome: string; playerAway: string;
  teamHome: string;   teamAway: string;
  league: string; time: string; date: string;
  startTime: number; eventId: string;
}>> {
  if (_upcomingCache && Date.now() - _upcomingCache.ts < UPCOMING_CACHE_TTL) {
    return _upcomingCache.data;
  }

  // Rate-limit védelem — ha Cloudflare blokkolt, stale cache-t adunk vissza
  if (isMsportRateLimited()) {
    console.log(`[msport-upcoming] rate-limit backoff ${rateLimitRemainingS()}s → stale cache`);
    return _upcomingCache?.data ?? [];
  }

  const now = Date.now();
  const start = now - 30 * 60_000;   // 30 perccel ezelőtt (folyamatban lévő meccsek)
  const end   = now + 4 * 3600_000;  // 4 óra előre

  try {
    await tryAutoSession();
    const resp = await axios.get(MY_FIXTURES_API, {
      headers: buildHeaders(),
      params: { sportId: 'sr:sport:137', start, end },
      timeout: 5_000,
    });

    if (resp.data?.bizCode !== 10000) {
      console.warn(`[msport-upcoming] bizCode ${resp.data?.bizCode}`);
      return _upcomingCache?.data ?? [];
    }

    const azLeagues: any[] = resp.data?.data?.azLeagues ?? [];
    const results: typeof _upcomingCache.data = [];

    for (const leagueGroup of azLeagues) {
      const leagueName = TOURNAMENT_MAP[leagueGroup.tournamentId as string] ?? null;
      if (!leagueName) continue;

      for (const ev of (leagueGroup.events ?? [])) {
        if ((ev.status ?? 0) >= 3) continue; // csak upcoming (0) és live (1,2)

        const playerA = extractPlayerName(ev.homeTeam || '');
        const playerB = extractPlayerName(ev.awayTeam || '');
        if (!playerA || !playerB) continue;

        // Budapest CEST (UTC+2)
        const d = new Date((ev.startTime || 0) + 2 * 3600_000);
        const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd  = String(d.getUTCDate()).padStart(2, '0');
        const hh  = String(d.getUTCHours()).padStart(2, '0');
        const min = String(d.getUTCMinutes()).padStart(2, '0');

        results.push({
          playerHome: playerA,
          playerAway: playerB,
          teamHome:   extractTeamName(ev.homeTeam || ''),
          teamAway:   extractTeamName(ev.awayTeam || ''),
          league:     leagueName,
          time:       `${hh}:${min}`,
          date:       `${mm}/${dd}`,
          startTime:  ev.startTime || 0,
          eventId:    ev.eventId   || '',
        });
      }
    }

    results.sort((a, b) => a.startTime - b.startTime);
    const gt  = results.filter(r => r.league === 'GT Leagues').length;
    const eAd = results.filter(r => r.league === 'eAdriatic League').length;
    console.log(`[msport-upcoming] ✅ ${results.length} közelgő meccs (GT: ${gt}, eAdr: ${eAd})`);
    _upcomingCache = { data: results, ts: Date.now() };
    return results;
  } catch (e: any) {
    const status = (e as any).response?.status ?? 0;
    const isTimeout = (e as any).code === 'ECONNABORTED' || String(e.message).toLowerCase().includes('timeout');
    const is429 = status === 429 || String(e.message).includes('429');
    if (is429) {
      markMsportRateLimited();
    } else if (isTimeout) {
      console.warn(`[msport-upcoming] ⏱️ timeout — backoff nem aktiválva`);
    }
    console.warn(`[msport-upcoming] ⚠️ hiba: ${e.message}`);
    return _upcomingCache?.data ?? [];
  }
}

// ── Live Score ────────────────────────────────────────────────────────────────

const DETAIL_URL = 'https://www.msport.com/api/gh/facts-center/query/frontend/match/detail';

// Kis cache: eventId → {data, ts}  (10 mp TTL, meccs max 12 perc)
const detailCache = new Map<string, { data: MsportLiveScore | null; ts: number }>();
const DETAIL_CACHE_TTL = 10_000; // 10 másodperc

async function fetchMatchDetail(eventId: string): Promise<MsportLiveScore | null> {
  const cached = detailCache.get(eventId);
  if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) return cached.data;

  try {
    await tryAutoSession();
    const resp = await axios.get(DETAIL_URL, {
      headers: buildHeaders(),
      params: { eventId },
      timeout: 8_000,
    });
    const d = resp.data?.data;
    if (!d || resp.data?.bizCode !== 10000) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // status: 0 = upcoming, 1 = live, 2 = ended
    if (d.status < 1) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Score: "1:4" → scoreA=1, scoreB=4
    const scoreMatch = (d.scoreOfWholeMatch || '').match(/^(\d+):(\d+)$/);
    if (!scoreMatch) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Játékosnevek kinyerése: "Real Madrid (Liam)" → "liam"
    const playerA = extractPlayerName(d.homeTeam || '').toLowerCase();
    const playerB = extractPlayerName(d.awayTeam || '').toLowerCase();
    if (!playerA || !playerB) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Menetidő: "10'00\"" → 10, "6'44\"" → 6
    const timeStr = d.totalPlayedTime || d.playedTime || '';
    const minMatch = timeStr.match(/^(\d+)'/);
    const minute = minMatch ? parseInt(minMatch[1]) : 0;

    const result: MsportLiveScore = {
      playerA,
      playerB,
      scoreA: parseInt(scoreMatch[1]),
      scoreB: parseInt(scoreMatch[2]),
      minute,
      isLive: d.status === 1,
      source: 'msport.com',
      period: 1,   // eAdriatic/GT: egységes meccs (nincs félidő)
      periodName: null,  // null = frontend kezeli: csak {minute}' jelenik meg (volt: "${minute}'" → duplikálta)
    };

    detailCache.set(eventId, { data: result, ts: Date.now() });
    console.log(`[msport-live] ✅ ${playerA} vs ${playerB} → ${d.scoreOfWholeMatch} (${minute}')`);
    return result;
  } catch (e: any) {
    console.warn(`[msport-live] ⚠️ detail hiba (${eventId}): ${e.message}`);
    detailCache.set(eventId, { data: null, ts: Date.now() });
    return null;
  }
}

/**
 * Lekéri az élő meccsek gólállását msport detail API-n keresztül.
 * @param eventIds  A napi accumulatorból szűrt, jelenleg élő meccsek eventId listája
 */
export async function getMsportLiveScores(eventIds: string[]): Promise<MsportLiveScore[]> {
  if (eventIds.length === 0) return [];
  const results = await Promise.all(eventIds.map(id => fetchMatchDetail(id)));
  return results.filter((r): r is MsportLiveScore => r !== null);
}

// ── Match Results (lezárt meccsek előzménye) ──────────────────────────────────
// GT Leagues (sr:tournament:33496) és eAdriatic League (sr:tournament:39749)
// Több endpoint-variánst próbálunk — az msport API verzióktól függően változhat.

const BASE = 'https://www.msport.com/api/gh/facts-center/query/frontend';
const MSPORT_LEAGUES = [
  { id: 'sr:tournament:33496', league: 'GT Leagues'       },
  { id: 'sr:tournament:39749', league: 'eAdriatic League' },
] as const;

function buildResultsUrls(tournamentId: string): string[] {
  const q = `sportId=sr:sport:137&tournamentId=${tournamentId}&pageSize=500`;
  return [
    `${BASE}/results/list?${q}`,
    `${BASE}/match/list?${q}&matchStatus=3`,
    `${BASE}/match/list?${q}&type=2`,
    `${BASE}/finished-matches/list?${q}`,
  ];
}

export interface MsportMatchResult {
  eventId:   string;
  playerA:   string;   // home játékos neve (kisbetű)
  playerB:   string;   // away játékos neve
  teamA:     string;
  teamB:     string;
  scoreA:    number;   // home gólok
  scoreB:    number;   // away gólok
  startTime: number;   // Unix ms
  league:    string;
  date:      string;   // "MM/DD HH:MM" Budapest-helyi idő
}

// 3 perces cache — az eredmények nem változnak gyorsan
let resultsCache: { data: MsportMatchResult[]; ts: number } | null = null;
const RESULTS_TTL = 3 * 60 * 1000;

// In-flight mutex: ha már fut egy lekérés, a párhuzamos hívások ne indítsanak újat
let _resultsInFlight: Promise<MsportMatchResult[]> | null = null;

// ── Injected completed matches (score accumulator) ────────────────────────────
// A background poller (index.ts) tölti fel: minden végbement meccs után
// a match/detail API-ból szerzett végső eredményt ide injektálja.
// Így getMsportMatchResults() visszaadja az aznapi meccseket is — anélkül,
// hogy létezne egy dedikált "results/list" endpoint az msport-on.
const _injectedCompleted: MsportMatchResult[] = [];

/**
 * Injektál lezárt meccseket az in-memory tárolóba és Supabase-be.
 * Hívja: index.ts pollCompletedMatchScores() 60 mp-enként.
 * @returns hány új meccs került be (deduplikálva eventId alapján)
 */
export async function injectCompletedMatches(matches: MsportMatchResult[]): Promise<number> {
  const seen = new Set(_injectedCompleted.map(m => m.eventId));
  const newMatches: MsportMatchResult[] = [];
  for (const m of matches) {
    if (!seen.has(m.eventId)) {
      _injectedCompleted.push(m);
      seen.add(m.eventId);
      newMatches.push(m);
    }
  }
  if (newMatches.length > 0) {
    console.log(`[msport-accum] +${newMatches.length} completed match(es) injected (total: ${_injectedCompleted.length})`);
    // Fájl-alapú mentés (Supabase fallback) — restart után is megmaradnak az adatok
    try {
      const cutoff = Date.now() - 5 * 24 * 3600_000;
      const toSave = _injectedCompleted.filter(m => m.startTime >= cutoff);
      writeFileSync(MSPORT_RESULTS_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
    } catch (e) {
      console.error('[msport-accum] fájl mentés hiba:', e);
    }
    if (supabase) {
      try {
        await supabase.from('completed_matches').upsert(
          newMatches.map(m => ({
            event_id:   m.eventId,
            player_a:   m.playerA,
            player_b:   m.playerB,
            team_a:     m.teamA,
            team_b:     m.teamB,
            score_a:    m.scoreA,
            score_b:    m.scoreB,
            start_time: m.startTime,
            league:     m.league,
            date:       m.date,
          })),
          { onConflict: 'event_id' }
        );
      } catch (e) {
        console.error('[msport-accum] Supabase upsert hiba:', e);
      }
    }
  }
  return newMatches.length;
}

/**
 * Betölti a lezárt meccseket Supabase-ből az in-memory tárolóba (szerver induláskor).
 */
export async function initCompletedMatchesFromDb(): Promise<void> {
  // Fájl-alapú betöltés ha Supabase nincs konfigurálva
  if (!supabase) {
    try {
      const raw = readFileSync(MSPORT_RESULTS_PATH, 'utf-8');
      const saved: MsportMatchResult[] = JSON.parse(raw);
      const cutoff = Date.now() - 5 * 24 * 3600_000;
      const seen = new Set(_injectedCompleted.map(m => m.eventId));
      let loaded = 0;
      for (const m of saved) {
        if (m.startTime >= cutoff && !seen.has(m.eventId)) {
          _injectedCompleted.push(m);
          seen.add(m.eventId);
          loaded++;
        }
      }
      if (loaded > 0) console.log(`[msport-accum] ✅ ${loaded} lezárt meccs betöltve fájlból`);
    } catch {
      // fájl még nem létezik — nem gond
    }
    return;
  }
  try {
    const cutoff = Date.now() - 5 * 24 * 3600_000; // 5 nap — modell 3 napot használ, +2 nap buffer
    const { data, error } = await supabase
      .from('completed_matches')
      .select('*')
      .gt('start_time', cutoff)
      .order('start_time', { ascending: false })
      .limit(2000);
    if (error) throw error;
    if (!data || data.length === 0) return;
    const seen = new Set(_injectedCompleted.map(m => m.eventId));
    let loaded = 0;
    for (const r of data) {
      if (!seen.has(r.event_id)) {
        _injectedCompleted.push({
          eventId:   r.event_id,
          playerA:   r.player_a,
          playerB:   r.player_b,
          teamA:     r.team_a ?? '',
          teamB:     r.team_b ?? '',
          scoreA:    r.score_a,
          scoreB:    r.score_b,
          startTime: r.start_time,
          league:    r.league,
          date:      r.date,
        });
        seen.add(r.event_id);
        loaded++;
      }
    }
    console.log(`[msport-accum] ✅ ${loaded} lezárt meccs betöltve Supabase-ből`);
  } catch (e) {
    console.error('[msport-accum] initFromDb hiba:', e);
  }
}

// In-memory ringbuffer: 5 napnál régebbi meccsek törlődnek a memóriából ÉS a Supabase-ből.
// (Ingyenes Supabase tier kímélete — modell csak az utolsó 3 napot használja)
export async function clearOldInjectedMatches(): Promise<void> {
  const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;

  // In-memory takarítás
  const before = _injectedCompleted.length;
  _injectedCompleted.splice(0, _injectedCompleted.length,
    ..._injectedCompleted.filter(m => m.startTime >= cutoff)
  );
  const removed = before - _injectedCompleted.length;
  if (removed > 0) console.log(`[msport-accum] ${removed} régi rekord eltávolítva a memóriából, ${_injectedCompleted.length} maradt`);

  // Supabase takarítás — 5 napnál régebbi sorok törlése
  if (supabase) {
    try {
      const { error } = await supabase
        .from('completed_matches')
        .delete()
        .lt('start_time', cutoff);
      if (error) console.warn('[msport-accum] Supabase DELETE hiba:', error.message);
    } catch (e: any) {
      console.warn('[msport-accum] Supabase takarítás hiba:', e?.message);
    }
  }
}

function parseResultEvents(data: any, league: string): MsportMatchResult[] {
  const out: MsportMatchResult[] = [];
  // Lehetséges kulcsok a válaszban
  const arr: any[] = [
    ...(data?.results         ?? []),
    ...(data?.matches         ?? []),
    ...(data?.finishedMatches ?? []),
    ...(data?.events          ?? []),
    ...(data?.list            ?? []),
  ];
  for (const ev of arr) {
    // Score kinyerése különböző mezőkből
    const raw =
      ev.scoreOfWholeMatch ||
      ev.score             ||
      (ev.result ? `${ev.result.homeScore ?? ''}:${ev.result.awayScore ?? ''}` : '') ||
      (ev.homeScore !== undefined ? `${ev.homeScore}:${ev.awayScore}` : '');
    const sm = raw.match(/^(\d+):(\d+)$/);
    if (!sm) continue;

    const playerA = extractPlayerName(ev.homeTeam || '').toLowerCase();
    const playerB = extractPlayerName(ev.awayTeam || '').toLowerCase();
    if (!playerA || !playerB) continue;

    // Dátum Budapest-helyi időben (UTC+2)
    const d = new Date((ev.startTime || 0) + 2 * 3600 * 1000);
    const date = `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')} ` +
                 `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;

    out.push({
      eventId:   ev.eventId || '',
      playerA,
      playerB,
      teamA:     extractTeamName(ev.homeTeam || ''),
      teamB:     extractTeamName(ev.awayTeam || ''),
      scoreA:    parseInt(sm[1]),
      scoreB:    parseInt(sm[2]),
      startTime: ev.startTime || 0,
      league,
      date,
    });
  }
  return out;
}

// ── My-Matches Fixtures API ───────────────────────────────────────────────────
// MŰKÖDŐ endpoint (2026-05 felfedezve DevTools Network tab-bal):
// GET /api/gh/facts-center/query/frontend/my-matches/fixtures
//     ?sportId=sr:sport:137&start={unixMs}&end={unixMs}
//
// Visszaadja a lezárt meccsek eredményeit liganként (azLeagues tömb).
// status=3 vagy 4 → befejezett meccs, scoreOfWholeMatch = "4:2" formátum.
// Ez az esoccerbet.org-hoz hasonló "scraping" de API alapon — sokkal megbízhatóbb.
// HTML scraping nem működik (SPA / JavaScript-renderelt oldal).
//
// [DEPRECATED, NOT WORKING] Fixture Page HTML scraper was here but page is SPA.

// My-Matches Fixtures API endpoint
const MY_FIXTURES_API = 'https://www.msport.com/api/gh/facts-center/query/frontend/my-matches/fixtures';

// 15 perces cache — ritka frissítés, nem terheli az API-t
let myFixturesCache: { data: MsportMatchResult[]; ts: number } | null = null;
const MY_FIXTURES_CACHE_TTL = 15 * 60 * 1000;
let fixturesTimeoutCount = 0;
let fixturesTimeoutBackoffUntil = 0;
const FIXTURES_TIMEOUT_BACKOFF_MS = 10 * 60 * 1000; // 10 perc, ha 3x egymás után timeout

/**
 * Lezárt meccsek lekérése a my-matches/fixtures API-ból.
 * Visszaadja az utolsó `daysBack` nap összes befejezett meccsét
 * GT Leagues + eAdriatic League ligákból.
 *
 * API struktúra:
 *   data.azLeagues[].events[] → minden lezárt meccs
 *   status 3 vagy 4 = befejezett
 *   scoreOfWholeMatch = "4:2"
 *   tournamentId → liga azonosítás
 */
export async function getMsportMyFixtures(daysBack: number = 14): Promise<MsportMatchResult[]> {
  if (myFixturesCache && Date.now() - myFixturesCache.ts < MY_FIXTURES_CACHE_TTL) {
    return myFixturesCache.data;
  }

  // Timeout backoff — ha 3x egymás után timeout, 10 percig nem próbálkozunk
  if (Date.now() < fixturesTimeoutBackoffUntil) {
    const remainS = Math.round((fixturesTimeoutBackoffUntil - Date.now()) / 1000);
    console.log(`[msport-fixtures] timeout-backoff ${remainS}s → stale cache (${myFixturesCache?.data.length ?? 0} meccs)`);
    return myFixturesCache?.data ?? [];
  }

  // Rate-limit védelem — ha Cloudflare blokkolt, stale cache-t adunk vissza
  if (isMsportRateLimited()) {
    console.log(`[msport-fixtures] rate-limit backoff ${rateLimitRemainingS()}s → stale cache (${myFixturesCache?.data.length ?? 0} meccs)`);
    return myFixturesCache?.data ?? [];
  }

  const now = Date.now();
  const start = now - daysBack * 24 * 3600_000;
  const end   = now + 2 * 3600_000; // +2h buffer (folyamatban lévő meccsek)

  try {
    await tryAutoSession();
    const resp = await axios.get(MY_FIXTURES_API, {
      headers: buildHeaders(),
      params: { sportId: 'sr:sport:137', start, end },
      timeout: 5_000,
    });

    if (resp.data?.bizCode !== 10000) {
      console.warn(`[msport-fixtures] bizCode ${resp.data?.bizCode}`);
      return myFixturesCache?.data ?? [];
    }

    const azLeagues: any[] = resp.data?.data?.azLeagues ?? [];
    const results: MsportMatchResult[] = [];

    for (const leagueGroup of azLeagues) {
      // Liga azonosítás tournamentId alapján (megbízhatóbb mint a szöveg)
      const leagueName = TOURNAMENT_MAP[leagueGroup.tournamentId as string] ?? null;
      if (!leagueName) continue; // csak GT Leagues + eAdriatic

      for (const ev of (leagueGroup.events ?? [])) {
        // Csak befejezett meccsek: status 3 = ended, 4 = abandoned/walkover
        if ((ev.status ?? 0) < 3) continue;

        // Végeredmény: "4:2" formátum
        const sm = (ev.scoreOfWholeMatch || '').match(/^(\d+):(\d+)$/);
        if (!sm) continue;

        const playerA = extractPlayerName(ev.homeTeam || '').toLowerCase();
        const playerB = extractPlayerName(ev.awayTeam || '').toLowerCase();
        if (!playerA || !playerB) continue;

        // Budapest CEST (UTC+2) dátum string
        const d = new Date((ev.startTime || 0) + 2 * 3600_000);
        const date =
          `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')} ` +
          `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;

        results.push({
          eventId:   ev.eventId   || '',
          playerA,
          playerB,
          teamA:     extractTeamName(ev.homeTeam || ''),
          teamB:     extractTeamName(ev.awayTeam || ''),
          scoreA:    parseInt(sm[1]),
          scoreB:    parseInt(sm[2]),
          startTime: ev.startTime || 0,
          league:    leagueName,
          date,
        });
      }
    }

    const gt  = results.filter(r => r.league === 'GT Leagues').length;
    const eAd = results.filter(r => r.league === 'eAdriatic League').length;
    console.log(`[msport-fixtures] ✅ ${results.length} lezárt meccs (GT: ${gt}, eAdr: ${eAd}, utolsó ${daysBack} nap)`);
    myFixturesCache = { data: results, ts: Date.now() };
    fixturesTimeoutCount = 0; // sikeres kérés → számláló nullázás
    return results;
  } catch (e: any) {
    const status = (e as any).response?.status ?? 0;
    const isTimeout = (e as any).code === 'ECONNABORTED' || String(e.message).toLowerCase().includes('timeout');
    const is429 = status === 429 || String(e.message).includes('429');
    if (is429) {
      markMsportRateLimited();
      fixturesTimeoutCount = 0;
    } else if (isTimeout) {
      fixturesTimeoutCount++;
      if (fixturesTimeoutCount >= 3) {
        fixturesTimeoutBackoffUntil = Date.now() + FIXTURES_TIMEOUT_BACKOFF_MS;
        fixturesTimeoutCount = 0;
        console.warn(`[msport-fixtures] ⏱️ 3x timeout → 10 perces backoff aktiválva`);
      } else {
        console.warn(`[msport-fixtures] ⏱️ timeout (${fixturesTimeoutCount}/3)`);
      }
    }
    console.warn(`[msport-fixtures] ⚠️ hiba: ${e.message}`);
    return myFixturesCache?.data ?? [];
  }
}

/** Fixture cache törlése (pl. cookie változtatás után) */
export function clearFixtureCache(): void {
  myFixturesCache = null;
}

// scrapeMsportFixtures alias — backward compat (HTML scraper volt, most API-t hív)
export const scrapeMsportFixtures = getMsportMyFixtures;

/**
 * GT Leagues + eAdriatic League lezárt meccsek lekérése msport-ból.
 * 3 perces cache. Ha minden API endpoint sikertelen → csak az injected store marad.
 *
 * FONTOS: Az msport-on nincs dedikált "results" endpoint, ezért ez a függvény
 * valószínűleg mindig üres API-választ kap. A tényleges adatok az
 * _injectedCompleted tömbből jönnek (pollCompletedMatchScores() tölti, index.ts).
 */
export async function getMsportMatchResults(): Promise<MsportMatchResult[]> {
  // Segédfüggvény: injected + fixture adatokat deduplikálva mergeljük
  // Dedup: player páros + startTime közelisége (90mp tűrés)
  const mergeWithInjected = (base: MsportMatchResult[]): MsportMatchResult[] => {
    const extra = _injectedCompleted.filter(inj =>
      !base.some(b =>
        b.playerA === inj.playerA && b.playerB === inj.playerB &&
        Math.abs(b.startTime - inj.startTime) < 90_000
      )
    );
    return [...base, ...extra];
  };

  // ── 0. Rate-limit + cache guard (ELŐSZÖR — ne hívjuk a fixture scrappert feleslegesen) ──
  // Ha már fut egy párhuzamos lekérés → várjuk meg azt (ne indítsunk új HTTP kérést)
  if (_resultsInFlight) return _resultsInFlight;
  // Ha rate-limited: azonnal visszaadjuk a cache-t / injected-et, nincs scraper hívás → nincs log spam
  if (isMsportRateLimited()) {
    return mergeWithInjected(resultsCache?.data ?? []);
  }

  // Ha van friss results cache → nincs szükség fixture scraper hívásra sem
  if (resultsCache && Date.now() - resultsCache.ts < RESULTS_TTL) {
    return mergeWithInjected(resultsCache.data);
  }

  // ── Párhuzamos hívások összevonása: csak egy HTTP kérés fut egyszerre ────
  const doFetch = async (): Promise<MsportMatchResult[]> => {
    // ── 1. Fixture oldal scraper (elsődleges forrás, csak ha NEM rate-limited és cache lejárt) ─
    try {
      const fixtureData = await scrapeMsportFixtures();
      if (fixtureData.length > 0) {
        console.log(`[msport-results] ✅ fixture scraper: ${fixtureData.length} meccs`);
        return mergeWithInjected(fixtureData);
      }
    } catch (e: any) {
      console.warn(`[msport-results] ⚠️ fixture scraper hiba: ${e.message}`);
    }

    // ── 2. Fallback: API endpoints ─────────────────────────────────────────
    await tryAutoSession();
    const all: MsportMatchResult[] = [];
    let hit429Fallback = false;

    for (const { id: tournamentId, league } of MSPORT_LEAGUES) {
      if (hit429Fallback) break;
      for (const url of buildResultsUrls(tournamentId)) {
        try {
          const resp = await axios.get(url, { headers: buildHeaders(), timeout: 10_000 });
          if (resp.data?.bizCode !== 10000) continue;
          const parsed = parseResultEvents(resp.data.data, league);
          if (parsed.length > 0) {
            console.log(`[msport-results] ✅ API: ${league}: ${parsed.length} meccs`);
            all.push(...parsed);
            break;
          }
        } catch (e: any) {
          const status = (e as any).response?.status ?? 0;
          const isTimeout = (e as any).code === 'ECONNABORTED' || String(e.message).toLowerCase().includes('timeout');
          const is429 = status === 429 || String(e.message).includes('429');
          if (is429) {
            markMsportRateLimited();
            hit429Fallback = true;
            break;
          }
          if (isTimeout) {
            console.warn('[msport-results] ⏱️ timeout — backoff nem aktiválva');
          }
          // egyéb hiba: silent — következő URL-t próbáljuk
        }
      }
    }

    // ── 3. Fallback: csak injected accumulator ────────────────────────────
    const injectedCount = _injectedCompleted.filter(m => !all.some(r => r.eventId === m.eventId)).length;
    console.log(`[msport-results] API: ${all.length}, injected: ${injectedCount} meccs (fixture scraper sikertelen)`);
    resultsCache = { data: all, ts: Date.now() };
    return mergeWithInjected(all);
  };

  _resultsInFlight = doFetch().finally(() => { _resultsInFlight = null; });
  return _resultsInFlight;
}

/**
 * Egy játékos legutóbbi meccseinek listája msport-ból.
 * Kompatibilis a scraper.ts MatchEntry formátumával.
 */
export async function getMsportPlayerLastMatches(
  playerName: string,
  league: string,
): Promise<Array<{
  date: string; opponent: string; opponentTeam: string; team: string;
  scoreHome: number; scoreAway: number; result: 'win'|'loss'|'draw';
}>> {
  const all = await getMsportMatchResults();
  const pn = playerName.toLowerCase().trim();

  const matches: Array<{
    date: string; opponent: string; opponentTeam: string; team: string;
    scoreHome: number; scoreAway: number; result: 'win'|'loss'|'draw';
    startTime: number;
  }> = [];

  for (const m of all) {
    if (league && m.league !== league) continue;
    const isHome = m.playerA === pn;
    const isAway = m.playerB === pn;
    if (!isHome && !isAway) continue;

    const scoreHome  = isHome ? m.scoreA : m.scoreB;
    const scoreAway  = isHome ? m.scoreB : m.scoreA;
    const opponent   = isHome ? m.playerB : m.playerA;
    const team       = isHome ? m.teamA   : m.teamB;
    const oppTeam    = isHome ? m.teamB   : m.teamA;
    const result: 'win'|'loss'|'draw' =
      scoreHome > scoreAway ? 'win' : scoreHome < scoreAway ? 'loss' : 'draw';

    matches.push({ date: m.date, opponent, opponentTeam: oppTeam, team, scoreHome, scoreAway, result, startTime: m.startTime });
  }

  // Legújabb elöl
  matches.sort((a, b) => b.startTime - a.startTime);
  return matches.slice(0, 50);
}

/**
 * H2H meccsek visszaadása msport-ból (Napi Mérkőzések kártyákhoz + TopTips H2H panel).
 * Fallback: ha msport üres, a hívó oldal esoccerbet.org-ra eshet vissza.
 */
export async function getMsportH2H(
  playerA: string,
  playerB: string,
  league?: string,
): Promise<{
  matches:    Array<{ date: string; scoreA: number; scoreB: number; totalGoals: number; resultA: 'win'|'loss'|'draw' }>;
  avgGoals:   number | null;
  todayCount: number;
}> {
  const all = await getMsportMatchResults();
  const nA = playerA.toLowerCase().trim();
  const nB = playerB.toLowerCase().trim();

  const threeDaysAgo = Date.now() - 3 * 24 * 3600_000;

  const matched = all
    .filter(m => m.startTime >= threeDaysAgo) // csak az utolsó 3 nap
    .filter(m => !league || m.league === league)
    .filter(m => {
      const mA = m.playerA, mB = m.playerB;
      return (mA === nA && mB === nB) || (mA === nB && mB === nA);
    })
    .map(m => {
      const fwd = m.playerA === nA;
      const scoreA    = fwd ? m.scoreA : m.scoreB;
      const scoreB    = fwd ? m.scoreB : m.scoreA;
      const totalGoals = scoreA + scoreB;
      const resultA: 'win'|'loss'|'draw' = scoreA > scoreB ? 'win' : scoreA < scoreB ? 'loss' : 'draw';
      return { date: m.date, scoreA, scoreB, totalGoals, resultA, startTime: m.startTime };
    })
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 10)
    .map(({ startTime: _st, ...rest }) => rest);

  const avgGoals = matched.length > 0
    ? matched.reduce((s, m) => s + m.totalGoals, 0) / matched.length
    : null;

  const now = new Date();
  const todayPrefix = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  const todayCount = matched.filter(m => m.date.startsWith(todayPrefix)).length;

  return { matches: matched, avgGoals, todayCount };
}

/**
 * Debug: nyers API válasz (GET /api/msport-debug)
 */
export async function getMsportRawDebug(): Promise<unknown> {
  const testUrl = async (url: string) => {
    try {
      await tryAutoSession();
      const resp = await axios.get(url, { headers: buildHeaders(), timeout: 10_000 });
      const d = resp.data?.data;
      const allEvents: MsportEvent[] = [
        ...(d?.comingSoons ?? []),
        ...(d?.liveMatches ?? []),
        ...(d?.matches ?? []),
      ];
      const parsed = parseEvents(allEvents);

      // Első 2 event nyers market adatai
      const rawMarketSample = allEvents.slice(0, 2).map(ev => ({
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        tournamentId: ev.tournamentId,
        markets: ev.markets?.slice(0, 3).map(m => ({
          id: m.id, name: m.name, status: m.status, specifiers: m.specifiers,
          outcomes: m.outcomes?.map(o => ({ id: o.id, desc: o.description, isActive: o.isActive, odds: o.odds })),
        })),
      }));

      // Első élő event TELJES nyers struktúrája (score mezők megismeréséhez)
      const liveEvents: any[] = d?.liveMatches ?? [];
      const rawLiveSample = liveEvents.slice(0, 2).map(ev => {
        // Mindent visszaadunk, kivéve a markets tömböt (azt külön mutatjuk)
        const { markets, ...rest } = ev;
        return { ...rest, marketsCount: markets?.length ?? 0 };
      });

      // "events" kulcs vizsgálata — lehet live score adatforrás
      const eventsKey: any[] = d?.events ?? [];
      const rawEventsSample = eventsKey.slice(0, 3).map(ev => {
        const { markets, ...rest } = ev ?? {};
        return { ...rest, marketsCount: markets?.length ?? 0 };
      });

      return {
        ok: true,
        bizCode: resp.data?.bizCode,
        comingSoonsCount: d?.comingSoons?.length ?? 0,
        liveMatchesCount: d?.liveMatches?.length ?? 0,
        matchesCount: d?.matches?.length ?? 0,
        eventsKeyCount: eventsKey.length,
        totalEventsCount: allEvents.length,
        parsedOddsCount: parsed.length,
        parsedOdds: parsed.slice(0, 5),
        rawMarketSample,
        rawLiveSample,       // ← élő meccsek teljes struktúrája (score mezők!)
        rawEventsSample,     // ← "events" kulcs tartalma
        dataKeys: Object.keys(d ?? {}),
      };
    } catch (e: any) {
      return { ok: false, error: e.message, status: e.response?.status };
    }
  };

  const results: Record<string, unknown> = {};
  for (const url of API_URL_CANDIDATES) {
    const key = url.includes('upcoming-matches') ? 'upcoming' : url.includes('live-matches') ? 'live' : 'matches';
    results[key] = await testUrl(url);
    results[`${key}Url`] = url;
  }
  return results;
}
