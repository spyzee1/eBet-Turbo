// ============================================================================
// CLOUDBET SPORTS API SCRAPER
// Provides: O/U odds, 1X2 odds, upcoming schedule
// for eAdriatic League (+ GT Nations League when seasonally active)
//
// API: https://sports-api.cloudbet.com/pub/v2/odds/
// Auth: X-API-Key header (Trading key)
// Docs: https://cloudbet.github.io/wiki/en/docs/sports/api/
//
// Megerősített struktúra (2026-05-05):
//   - Markets: dict keyed by "esport_fifa.total_goals" (aláhúzás!)
//   - Submarkets: dict keyed by "period=ft"
//   - Selection: { outcome, params: "total=5.25", price, status }
//   - Event: home.name / away.name (közvetlen mezők, nincs name parse)
//   - Elválasztó: " v " (nem " vs ")
// ============================================================================

import axios from 'axios';

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE  = 'https://sports-api.cloudbet.com/pub/v2/odds';
const SPORT_KEY = 'esport-fifa';

// Cloudbet competition keys — formátum: esport-fifa-{category}-{id}-{name}
// Megerősítve az API válaszból (2026-05-05)
const COMPETITION_KEYS: Record<string, string> = {
  'eAdriatic League': 'esport-fifa-international-t8f63-eadriatic-league',  // ✅ megerősítve
  'GT Leagues':       'esport-fifa-international-t6fff-gt-nations-league',  // fallback — auto-discovery pótolja ha 404
};

// Dinamikusan felfedezett key-ek (ha a hardcoded key 404-et ad)
const _discoveredKeys: Record<string, string> = {};

/**
 * Ha a liga hardcoded key-e 404-et ad, lekéri az összes competition key-t és
 * megkeresi a GT Leagues-nek megfelelő bejegyzést.
 */
async function discoverKeyForLeague(league: string): Promise<string | null> {
  if (_discoveredKeys[league]) return _discoveredKeys[league];
  try {
    const url = `${API_BASE}/sports/${SPORT_KEY}`;
    const resp = await axios.get<CbSport>(url, { headers: buildHeaders(), timeout: 10_000 });
    for (const cat of (resp.data?.categories ?? [])) {
      for (const comp of (cat.competitions ?? [])) {
        const n = comp.name.toLowerCase();
        if (
          (league === 'GT Leagues' && (n.includes('gt') || n.includes('nations'))) ||
          (league === 'eAdriatic League' && n.includes('adriatic'))
        ) {
          console.log(`[cloudbet] 🔍 Auto-discovery: ${league} → ${comp.key} ("${comp.name}")`);
          _discoveredKeys[league] = comp.key;
          return comp.key;
        }
      }
    }
    console.warn(`[cloudbet] ⚠️ Auto-discovery: nem találtuk a ligát: ${league}`);
  } catch (e: any) {
    console.error(`[cloudbet] Auto-discovery hiba (${league}):`, e.message);
  }
  return null;
}

// Piac kulcsok — aláhúzásos formátum (esport_fifa.*), csak parsizáshoz használjuk
// FONTOS: a competition endpoint-on NEM szabad ?markets= filtert használni —
// azzal üres markets-t ad vissza. Filter nélkül teljes market adatot kap.
const MARKET_TOTAL_GOALS = 'esport_fifa.total_goals';
const MARKET_MATCH_ODDS  = 'esport_fifa.match_odds';

function getApiKey(): string {
  return process.env.CLOUDBET_API_KEY || '';
}

function buildHeaders(): Record<string, string> {
  const key = getApiKey();
  if (!key || key === 'IDE_ILLESZD_BE_A_KULCSOT') {
    throw new Error('CLOUDBET_API_KEY nincs beállítva a .env fájlban!');
  }
  return {
    'X-API-Key':    key,
    'Accept':       'application/json',
    'Content-Type': 'application/json',
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CloudbetOdds {
  playerA:   string;    // home játékos neve  (zárójelből: "Juventus (Andrew)" → "Andrew")
  playerB:   string;    // away játékos neve
  teamA:     string;    // csapatnév ("Juventus")
  teamB:     string;
  league:    string;    // 'eAdriatic League' | 'GT Leagues'
  ouLine:    number;    // pl. 5.25
  oddsOver:  number;    // pl. 1.78
  oddsUnder: number;    // pl. 1.93
  oddsHome:  number;    // 1X2 home odds
  oddsDraw:  number;
  oddsAway:  number;
  startTime: number;    // Unix ms
  eventId:   string;
  status:    'open' | 'live' | 'suspended' | 'closed';
  source:    'cloudbet';
}

export interface CloudbetLiveScore {
  eventId:  number;     // Feed API esemény ID (web API-val való keresztlekéréshez)
  playerA:  string;
  playerB:  string;
  teamA:    string;
  teamB:    string;
  league:   string;
  scoreA:   number;     // 0 ha az API nem adja
  scoreB:   number;
  minute:   number;     // cutoffTime alapján számolt
  periodName: string | null;
  isLive:   boolean;
  scoreKnown: boolean;  // false = csak a perc ismert, a pontszám nem
  source:   'cloudbet-api';
}

// ── Cloudbet API response types ───────────────────────────────────────────────

interface CbSelection {
  outcome:     string;   // 'over' | 'under' | 'home' | 'draw' | 'away' | 'home_draw' stb.
  params:      string;   // 'total=5.25' | 'handicap=0.5' | ''
  marketUrl:   string;   // 'esport_fifa.total_goals/over?total=5.25'
  price:       number;
  probability: number;
  status:      string;   // 'SELECTION_ENABLED' | 'SELECTION_DISABLED'
  side:        string;   // 'BACK'
  minStake?:   number;
  maxStake?:   number;
}

interface CbSubmarket {
  sequence:   string;
  selections: CbSelection[];
}

// Markets: { "esport_fifa.total_goals": { submarkets: { "period=ft": CbSubmarket } } }
interface CbMarketEntry {
  submarkets: Record<string, CbSubmarket>;
}

type CbMarketsDict = Record<string, CbMarketEntry>;

interface CbTeam {
  name:         string;   // "Juventus (Andrew)"
  key:          string;
  abbreviation: string;
}

interface CbEvent {
  id:         number;
  key:        string;
  name:       string;      // "Juventus (Andrew) v SS Lazio (Cleo)"
  status:     string;      // 'TRADING' | 'TRADING_LIVE' | 'PRE_TRADING' | 'SUSPENDED' | 'RESULTED'
  cutoffTime: string;      // ISO timestamp
  home:       CbTeam;
  away:       CbTeam;
  markets:    CbMarketsDict;
}

interface CbCompetitionResponse {
  key:    string;
  name:   string;
  events: CbEvent[];
}

interface CbCompetition {
  key:    string;
  name:   string;
  events?: CbEvent[];
}

interface CbCategory {
  key:          string;
  name:         string;
  competitions: CbCompetition[];
}

interface CbSport {
  key:        string;
  name:       string;
  categories: CbCategory[];
}

interface CbSportsListResponse {
  sports: CbSport[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * "Juventus (Andrew)" → "Andrew"
 * Ha nincs zárójel: teljes nevet adja vissza
 */
function extractPlayer(fullName: string): string {
  const m = fullName.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : fullName.trim();
}

/**
 * "Juventus (Andrew)" → "Juventus"
 */
function extractTeam(fullName: string): string {
  return fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

/**
 * "total=5.25" → 5.25
 * "total=6" → 6
 */
function parseTotalParam(params: string): number | null {
  const m = params.match(/total=([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Kibontja a Total Goals O/U oddokat.
 * Minden over/under pár ugyanabban a "period=ft" submarket-ben van.
 * A legkiegyensúlyozottabb vonalat választja (ahol |over_prob - 0.5| minimum).
 */
function extractTotalGoals(
  markets: CbMarketsDict,
): { ouLine: number; oddsOver: number; oddsUnder: number } | null {
  const ouMarket = markets[MARKET_TOTAL_GOALS];
  if (!ouMarket) return null;

  const ftSub = ouMarket.submarkets?.['period=ft'];
  if (!ftSub || !Array.isArray(ftSub.selections) || ftSub.selections.length === 0) return null;

  // Csoportosítás total érték szerint
  const lineMap = new Map<number, { over?: CbSelection; under?: CbSelection }>();
  for (const sel of ftSub.selections) {
    if (sel.status !== 'SELECTION_ENABLED') continue;
    const line = parseTotalParam(sel.params);
    if (line === null) continue;

    if (!lineMap.has(line)) lineMap.set(line, {});
    const entry = lineMap.get(line)!;
    if (sel.outcome === 'over')  entry.over  = sel;
    if (sel.outcome === 'under') entry.under = sel;
  }

  // Csak teljes párok (over + under mindkettő megvan)
  const pairs: Array<{ line: number; over: CbSelection; under: CbSelection }> = [];
  for (const [line, entry] of lineMap.entries()) {
    if (entry.over && entry.under && entry.over.price > 1 && entry.under.price > 1) {
      pairs.push({ line, over: entry.over, under: entry.under });
    }
  }
  if (pairs.length === 0) return null;

  // Legjobb vonal: legkiegyensúlyozottabb (where P(over) ≈ 0.5)
  // → |over.probability - 0.5| minimum
  pairs.sort((a, b) =>
    Math.abs(a.over.probability - 0.5) - Math.abs(b.over.probability - 0.5),
  );

  const best = pairs[0];
  return {
    ouLine:    best.line,
    oddsOver:  best.over.price,
    oddsUnder: best.under.price,
  };
}

/**
 * Kibontja az 1X2 (match_odds) oddokat.
 */
function extract1X2(
  markets: CbMarketsDict,
): { oddsHome: number; oddsDraw: number; oddsAway: number } | null {
  const m1x2 = markets[MARKET_MATCH_ODDS];
  if (!m1x2) return null;

  const ftSub = m1x2.submarkets?.['period=ft'];
  if (!ftSub || !Array.isArray(ftSub.selections)) return null;

  let oddsHome = 0, oddsDraw = 0, oddsAway = 0;
  for (const sel of ftSub.selections) {
    if (sel.status !== 'SELECTION_ENABLED') continue;
    if (sel.outcome === 'home') oddsHome = sel.price;
    if (sel.outcome === 'draw') oddsDraw = sel.price;
    if (sel.outcome === 'away') oddsAway = sel.price;
  }
  return (oddsHome > 1 && oddsAway > 1) ? { oddsHome, oddsDraw, oddsAway } : null;
}

/**
 * CbEvent → CloudbetOdds konverzió
 */
function parseEvent(ev: CbEvent, league: string): CloudbetOdds | null {
  // Játékosnév és csapatnév közvetlenül a home/away mezőkből
  const playerA = extractPlayer(ev.home?.name ?? '');
  const playerB = extractPlayer(ev.away?.name ?? '');
  const teamA   = extractTeam(ev.home?.name ?? '');
  const teamB   = extractTeam(ev.away?.name ?? '');

  if (!playerA || !playerB) return null;

  // Markets: object dict (nem array!)
  const marketsDict: CbMarketsDict = (ev.markets && !Array.isArray(ev.markets))
    ? (ev.markets as CbMarketsDict)
    : {};

  const ou   = extractTotalGoals(marketsDict);
  const m1x2 = extract1X2(marketsDict);

  // Ha nincs O/U odds, skip
  if (!ou) return null;

  const startTime = new Date(ev.cutoffTime).getTime();
  const status: CloudbetOdds['status'] =
    ev.status === 'TRADING'      ? 'open'      :
    ev.status === 'TRADING_LIVE' ? 'live'      :
    ev.status === 'SUSPENDED'    ? 'suspended' :
    ev.status === 'RESULTED'     ? 'closed'    : 'open';

  console.log(
    `[cloudbet] ✅ ${playerA} vs ${playerB} | O/U ${ou.ouLine} (${ou.oddsOver}/${ou.oddsUnder})`,
  );

  return {
    playerA, playerB, teamA, teamB, league,
    ouLine:    ou.ouLine,
    oddsOver:  ou.oddsOver,
    oddsUnder: ou.oddsUnder,
    oddsHome:  m1x2?.oddsHome ?? 0,
    oddsDraw:  m1x2?.oddsDraw ?? 0,
    oddsAway:  m1x2?.oddsAway ?? 0,
    startTime,
    eventId: String(ev.id || ev.key),
    status,
    source: 'cloudbet',
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface OddsCache { data: CloudbetOdds[]; ts: number; }
let _oddsCache: OddsCache | null = null;
const ODDS_CACHE_TTL = 3 * 60_000;    // 3 perc

let _oddsInFlight: Promise<CloudbetOdds[]> | null = null;

let _rateLimitedUntil = 0;
const RATE_LIMIT_TTL  = 5 * 60_000;  // 5 perc backoff

function isCloudbetRateLimited(): boolean { return Date.now() < _rateLimitedUntil; }
function markCloudbetRateLimited(): void {
  _rateLimitedUntil = Date.now() + RATE_LIMIT_TTL;
  console.warn(`[cloudbet] 🔴 rate limit → ${RATE_LIMIT_TTL / 60_000} perc backoff`);
}

// ── Main: Odds lekérés ────────────────────────────────────────────────────────

/**
 * Lekéri mindkét liga O/U + 1X2 oddjait a Cloudbet API-ból.
 * 3 perces cache-sel, in-flight dedup-pal.
 */
export async function getCloudbetOdds(): Promise<CloudbetOdds[]> {
  if (isCloudbetRateLimited()) {
    const rem = Math.round((_rateLimitedUntil - Date.now()) / 1000);
    console.log(`[cloudbet] rate-limit backoff ${rem}s → cache (${_oddsCache?.data.length ?? 0} odds)`);
    return _oddsCache?.data ?? [];
  }

  if (_oddsCache && Date.now() - _oddsCache.ts < ODDS_CACHE_TTL) {
    return _oddsCache.data;
  }

  if (_oddsInFlight) return _oddsInFlight;

  _oddsInFlight = (async () => {
    const allOdds: CloudbetOdds[] = [];

    for (const [league, hardcodedKey] of Object.entries(COMPETITION_KEYS)) {
      // Használjuk a dinamikusan felfedezett key-t ha van, különben a hardcodedt
      const compKey = _discoveredKeys[league] ?? hardcodedKey;

      const tryFetch = async (key: string): Promise<CbCompetitionResponse | null> => {
        const url = `${API_BASE}/competitions/${key}`;
        const resp = await axios.get<CbCompetitionResponse>(url, {
          headers: buildHeaders(),
          timeout: 15_000,
        });
        return resp.data;
      };

      try {
        let data = await tryFetch(compKey);
        const events = data?.events ?? [];
        let added = 0;
        for (const ev of events) {
          const odds = parseEvent(ev, league);
          if (odds) { allOdds.push(odds); added++; }
        }
        console.log(`[cloudbet] ✅ ${league}: ${events.length} event, ${added} odds`);
      } catch (e: any) {
        const status = e.response?.status ?? 0;
        if (status === 429) { markCloudbetRateLimited(); break; }
        if (status === 401) {
          console.error('[cloudbet] ❌ 401 Unauthorized — ellenőrizd a CLOUDBET_API_KEY-t!');
          break;
        }
        if (status === 404) {
          // 404: próbáljuk auto-discovery-vel megtalálni a helyes key-t
          console.log(`[cloudbet] ℹ️ ${league}: 404 — auto-discovery indul...`);
          const discovered = await discoverKeyForLeague(league);
          if (discovered && discovered !== compKey) {
            try {
              const data2 = await tryFetch(discovered);
              const events2 = data2?.events ?? [];
              let added2 = 0;
              for (const ev of events2) {
                const odds = parseEvent(ev, league);
                if (odds) { allOdds.push(odds); added2++; }
              }
              console.log(`[cloudbet] ✅ ${league} (discovered key): ${events2.length} event, ${added2} odds`);
            } catch (e2: any) {
              console.warn(`[cloudbet] ⚠️ ${league} discovered key is hiba: ${e2.message}`);
            }
          } else if (!discovered) {
            console.log(`[cloudbet] ℹ️ ${league}: discovery sem talált aktív ligát`);
          }
          continue;
        }
        console.warn(`[cloudbet] ⚠️ ${league} hiba: ${e.message}`);
      }
    }

    const gt  = allOdds.filter(o => o.league === 'GT Leagues').length;
    const eAd = allOdds.filter(o => o.league === 'eAdriatic League').length;
    console.log(`[cloudbet] összesen: ${allOdds.length} odds (GT: ${gt}, eAdr: ${eAd})`);

    _oddsCache = { data: allOdds, ts: Date.now() };
    _oddsInFlight = null;
    return allOdds;
  })();

  return _oddsInFlight;
}

/**
 * Egy konkrét meccshez keres O/U oddst — fuzzy játékosnév egyeztetés.
 */
export async function getCloudbetOddsForMatch(
  playerA: string,
  playerB: string,
): Promise<{ ouLine: number; oddsOver: number; oddsUnder: number } | null> {
  const all = await getCloudbetOdds();
  if (all.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nA = norm(playerA);
  const nB = norm(playerB);

  // 1. Pontos egyezés (mindkét irány)
  let match = all.find(o => norm(o.playerA) === nA && norm(o.playerB) === nB);
  if (!match) match = all.find(o => norm(o.playerA) === nB && norm(o.playerB) === nA);

  // 2. Fuzzy: prefix alapú
  const flen = (a: string, b: string) => Math.min(Math.max(a.length, b.length, 4), 6);
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      return (oA.startsWith(nA.slice(0, flen(oA, nA))) || nA.startsWith(oA.slice(0, flen(oA, nA)))) &&
             (oB.startsWith(nB.slice(0, flen(oB, nB))) || nB.startsWith(oB.slice(0, flen(oB, nB))));
    });
  }
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      return (oA.startsWith(nB.slice(0, flen(oA, nB))) || nB.startsWith(oA.slice(0, flen(oA, nB)))) &&
             (oB.startsWith(nA.slice(0, flen(oB, nA))) || nA.startsWith(oB.slice(0, flen(oB, nA))));
    });
  }

  if (!match) {
    const sample = all.slice(0, 4).map(o => `${o.playerA}|${o.playerB}`).join(', ');
    console.log(`[cloudbet] ❌ nem talált: ${playerA} vs ${playerB} | cache minta: ${sample}`);
    return null;
  }

  console.log(`[cloudbet] ✅ talált: ${playerA} vs ${playerB} → O/U ${match.ouLine}`);
  return { ouLine: match.ouLine, oddsOver: match.oddsOver, oddsUnder: match.oddsUnder };
}

/**
 * Menetrend: közelgő meccsek listája.
 * Kompatibilis a getMsportUpcomingSchedule() visszatérési formátumával.
 */
export async function getCloudbetSchedule(): Promise<Array<{
  playerHome: string; playerAway: string;
  teamHome:   string; teamAway:   string;
  league:     string; time:       string;
  date:       string; startTime:  number;
  eventId:    string;
}>> {
  const all = await getCloudbetOdds();
  const now = Date.now();

  return all
    .filter(o => o.status !== 'closed' && o.startTime > now - 30 * 60_000)
    .map(o => {
      // Budapest CEST (UTC+2)
      const d = new Date(o.startTime + 2 * 3600_000);
      return {
        playerHome: o.playerA,
        playerAway: o.playerB,
        teamHome:   o.teamA,
        teamAway:   o.teamB,
        league:     o.league,
        time:       `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`,
        date:       `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`,
        startTime:  o.startTime,
        eventId:    o.eventId,
      };
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Élő meccsek a Cloudbet Feed API-ból (TRADING_LIVE státuszú események).
 * A score-t az API-ból próbáljuk kinyerni; ha nincs, cutoffTime alapján számolunk percet.
 * Rövidebb cache: 12 mp (élő adathoz).
 */
let _liveCache: { data: CloudbetLiveScore[]; ts: number } | null = null;
const LIVE_CACHE_TTL = 12_000; // 12 mp

export async function getCloudbetApiLiveScores(): Promise<CloudbetLiveScore[]> {
  if (_liveCache && Date.now() - _liveCache.ts < LIVE_CACHE_TTL) {
    return _liveCache.data;
  }
  if (isCloudbetRateLimited()) return _liveCache?.data ?? [];

  const result: CloudbetLiveScore[] = [];
  const now = Date.now();
  const MAX_LIVE_WINDOW = 20 * 60_000; // 20 perc buffer (GT=12p + ADR=10p + tartalék)

  for (const [league, hardcodedKey] of Object.entries(COMPETITION_KEYS)) {
    const compKey = _discoveredKeys[league] ?? hardcodedKey;
    try {
      const url = `${API_BASE}/competitions/${compKey}`;
      const resp = await axios.get<CbCompetitionResponse>(url, {
        headers: buildHeaders(),
        timeout: 10_000,
      });
      const events = resp.data?.events ?? [];
      const halfLen = league === 'GT Leagues' ? 6 : 5; // percek egy félidőben

      for (const ev of events) {
        if (ev.status !== 'TRADING_LIVE') continue;

        const playerA = extractPlayer(ev.home?.name ?? '');
        const playerB = extractPlayer(ev.away?.name ?? '');
        const teamA   = extractTeam(ev.home?.name ?? '');
        const teamB   = extractTeam(ev.away?.name ?? '');
        if (!playerA || !playerB) continue;

        // Eltelt perc a cutoffTime alapján (a meccs valójában a cutoffTime-kor indul)
        const startMs = new Date(ev.cutoffTime).getTime();
        const elapsedMs = now - startMs;
        if (elapsedMs < 0 || elapsedMs > MAX_LIVE_WINDOW) continue;
        const minute = Math.min(Math.floor(elapsedMs / 60_000), halfLen * 2);

        // Score kinyerése az API válaszból (ismeretlen mezők — raw cast)
        const raw = ev as any;
        let scoreA = 0, scoreB = 0, scoreKnown = false;
        const sc = raw.metadata?.score ?? raw.score ?? raw.liveData?.score ?? null;
        if (Array.isArray(sc) && sc.length >= 2) {
          scoreA = Number(sc[0]); scoreB = Number(sc[1]); scoreKnown = true;
        } else if (sc && typeof sc === 'object' && sc.home !== undefined) {
          scoreA = Number(sc.home); scoreB = Number(sc.away); scoreKnown = true;
        }

        const periodName = minute <= halfLen ? '1. félidő' : '2. félidő';
        result.push({
          eventId: ev.id,
          playerA, playerB, teamA, teamB, league,
          scoreA, scoreB, minute, periodName,
          isLive: true, scoreKnown,
          source: 'cloudbet-api',
        });
        console.log(`[cloudbet-api] LIVE: ${playerA} vs ${playerB} | ${scoreA}-${scoreB} ${minute}'`);
      }
    } catch (e: any) {
      const status = e.response?.status ?? 0;
      if (status === 429) { markCloudbetRateLimited(); break; }
      if (status === 404) continue;
      console.warn(`[cloudbet-api] live hiba (${league}):`, e.message);
    }
  }

  _liveCache = { data: result, ts: Date.now() };
  return result;
}

/**
 * Cache törlése (pl. kulcs változásakor)
 */
export function clearCloudbetCache(): void {
  _oddsCache = null;
  _oddsInFlight = null;
  _rateLimitedUntil = 0;
  console.log('[cloudbet] cache törölve');
}

/**
 * API kulcs státusz
 */
export function getCloudbetKeyStatus(): { configured: boolean; keyLength: number } {
  const key = getApiKey();
  return {
    configured: !!key && key !== 'IDE_ILLESZD_BE_A_KULCSOT',
    keyLength:  key.length,
  };
}

/**
 * API teszt végpont
 */
export async function testCloudbetApi(): Promise<{
  ok: boolean;
  oddsCount: number;
  gtLeagues: number;
  eAdriatic: number;
  sample: CloudbetOdds[];
  error?: string;
}> {
  try {
    clearCloudbetCache();
    const odds = await getCloudbetOdds();
    return {
      ok: true,
      oddsCount: odds.length,
      gtLeagues: odds.filter(o => o.league === 'GT Leagues').length,
      eAdriatic: odds.filter(o => o.league === 'eAdriatic League').length,
      sample: odds.slice(0, 5),
    };
  } catch (e: any) {
    return { ok: false, oddsCount: 0, gtLeagues: 0, eAdriatic: 0, sample: [], error: e.message };
  }
}

/**
 * Lekéri az összes esport-fifa versenyt az API-ból.
 * Segít megtalálni az ismeretlen competition key-eket (pl. GT Nations League).
 */
export async function listCloudbetCompetitions(): Promise<Array<{
  key: string;
  name: string;
}>> {
  try {
    const url = `${API_BASE}/sports/${SPORT_KEY}`;
    const resp = await axios.get<CbSport>(url, {
      headers: buildHeaders(),
      timeout: 10_000,
    });

    const result: Array<{ key: string; name: string }> = [];
    for (const cat of (resp.data?.categories ?? [])) {
      for (const comp of (cat.competitions ?? [])) {
        result.push({ key: comp.key, name: comp.name });
      }
    }
    console.log(`[cloudbet] versenyek: ${result.length} db (${SPORT_KEY})`);
    return result;
  } catch (e: any) {
    console.error('[cloudbet] listCompetitions hiba:', e.message);
    return [];
  }
}

/**
 * Részletes verseny-lista event számokkal.
 */
export async function discoverCloudbetCompetitions(): Promise<Array<{
  key: string;
  name: string;
  category: string;
  eventCount: number;
}>> {
  try {
    const url = `${API_BASE}/sports/${SPORT_KEY}`;
    const resp = await axios.get<CbSport>(url, {
      headers: buildHeaders(),
      timeout: 15_000,
    });

    const result: Array<{ key: string; name: string; category: string; eventCount: number }> = [];
    for (const cat of (resp.data?.categories ?? [])) {
      for (const comp of (cat.competitions ?? [])) {
        result.push({
          key:        comp.key,
          name:       comp.name,
          category:   cat.name,
          eventCount: comp.events?.length ?? 0,
        });
      }
    }
    return result;
  } catch (e: any) {
    console.error('[cloudbet] discoverCompetitions hiba:', e.message);
    return [];
  }
}
