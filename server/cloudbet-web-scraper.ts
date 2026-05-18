// ============================================================================
// CLOUDBET BELSŐ WEB API SCRAPER (axios-alapú, Puppeteer NEM kell)
// Forrás: www.cloudbet.com/sports-api/c/v6/sports/events
//
// Felfedezett (2026-05-05) belső végpontok — API kulcs NEM szükséges:
//   GET https://www.cloudbet.com/sports-api/c/v6/sports/events?sport=esport-fifa&locale=en
//     → közelgő + élő meccsek, metadata.score (élő), metadata.resultedScores (végeredmény)
//
// Pusher real-time feed (jövőbeli integráció):
//   wss://ws-eu.pusher.com/app/c065c29ae4b4b2f23f53
//
// Adatok:
//   - Menetrend (mindkét liga, kulcs nélkül)
//   - Élő eredmény (metadata.score, metadata.eventStatus)
//   - Végeredmény (metadata.resultedScores)
//   - H2H adatbázis (saját akkumulátor, fájlba mentett)
// ============================================================================

import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_esm = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const INTERNAL_API = 'https://www.cloudbet.com/sports-api/c/v6';
// Ez az endpoint CSAK közelgő meccseket ad — az élőek eltűnnek belőle!
// Élő adathoz a hivatalos Cloudbet API-t (cloudbet-scraper.ts) kell használni.
const EVENTS_URL   = `${INTERNAL_API}/sports/events?sport=esport-fifa&locale=en`;

// H2H adatbázis fájl útvonala (eredmények akkumulátora)
const H2H_DB_PATH = resolve(__dirname_esm, '../cloudbet-results.json');

const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':    'https://www.cloudbet.com/en/esports/esport-fifa',
  'Accept':     'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Liga nevekhez competition key megfeleltetés
const COMPETITION_NAME_MAP: Record<string, string> = {
  'GT Nations League':  'GT Leagues',
  'eAdriatic League':   'eAdriatic League',
};

// ── Típusok ───────────────────────────────────────────────────────────────────

export interface CbWebEvent {
  id:          number;
  key:         string;
  name:        string;
  homeTeam:    string;
  awayTeam:    string;
  league:      string;
  competitionKey: string;
  status:      string;            // TRADING, TRADING_LIVE, RESULTED, PRE_TRADING
  eventStatus: string;            // not_started, in_progress, finished
  startTime:   string;            // ISO UTC
  cutoffTime:  string;
  // Élő és végeredmény
  homeScore?:  number;
  awayScore?:  number;
  matchTimeSeconds?: number;
  eventTime?:  string;            // "45+2", "90" stb
  // Egyéb
  betradarId?: number;
}

export interface CbWebLiveScore {
  eventId:     number;
  homeTeam:    string;
  awayTeam:    string;
  league:      string;
  homeScore:   number;
  awayScore:   number;
  eventStatus: string;
  matchTimeSeconds: number;
  eventTime:   string;
  updatedAt:   string;
}

// H2H adatbázis struktúra
interface H2HResult {
  eventId:   number;
  homeTeam:  string;
  awayTeam:  string;
  league:    string;
  homeScore: number;
  awayScore: number;
  date:      string;     // ISO UTC
  savedAt:   string;     // mikor mentettük
}

interface H2HDatabase {
  lastUpdated: string;
  results: H2HResult[];
}

// ── H2H adatbázis ─────────────────────────────────────────────────────────────

function loadH2HDb(): H2HDatabase {
  try {
    if (existsSync(H2H_DB_PATH)) {
      const raw = readFileSync(H2H_DB_PATH, 'utf-8');
      return JSON.parse(raw) as H2HDatabase;
    }
  } catch (_e) {}
  return { lastUpdated: new Date().toISOString(), results: [] };
}

function saveH2HDb(db: H2HDatabase): void {
  try {
    db.lastUpdated = new Date().toISOString();
    writeFileSync(H2H_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('[cloudbet-web] H2H DB mentési hiba:', e);
  }
}

/**
 * Befejezett meccs eredményét menti el a H2H adatbázisba.
 * Duplikátumot nem ment (eventId alapján).
 */
function saveResultToH2H(event: CbWebEvent): boolean {
  if (event.homeScore === undefined || event.awayScore === undefined) return false;
  const db = loadH2HDb();
  const exists = db.results.some(r => r.eventId === event.id);
  if (exists) return false;

  db.results.push({
    eventId:   event.id,
    homeTeam:  event.homeTeam,
    awayTeam:  event.awayTeam,
    league:    event.league,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    date:      event.startTime,
    savedAt:   new Date().toISOString(),
  });

  // Tartsunk csak 30 napot
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  db.results = db.results.filter(r => r.date > cutoff);

  saveH2HDb(db);
  console.log(`[cloudbet-web] H2H mentve: ${event.homeTeam} ${event.homeScore}-${event.awayScore} ${event.awayTeam} (${event.league})`);
  return true;
}

// ── Belső API hívások ──────────────────────────────────────────────────────────

/** Nyers API válasz parsálása CbWebEvent tömbbé */
function parseApiResponse(data: any): CbWebEvent[] {
  const events: CbWebEvent[] = [];

  for (const sport of (data.sports ?? [])) {
    for (const comp of (sport.competitions ?? [])) {
      const leagueName = COMPETITION_NAME_MAP[comp.name] ?? comp.name;

      for (const ev of (comp.events ?? [])) {
        const meta     = ev.metadata ?? {};
        const efv3     = meta.esportFifaV3 ?? {};
        const score    = meta.score ?? [];           // élő: [home, away]
        const resulted = meta.resultedScores ?? {};  // végeredmény object

        // Próbáljuk kinyerni a végeredményt
        let homeScore: number | undefined;
        let awayScore: number | undefined;

        if (Array.isArray(score) && score.length >= 2) {
          homeScore = Number(score[0]);
          awayScore = Number(score[1]);
        } else if (resulted && typeof resulted === 'object' && Object.keys(resulted).length > 0) {
          // resultedScores lehet: {"home": 2, "away": 1} vagy {"ft": {"home": 2, "away": 1}}
          const ft = resulted['ft'] ?? resulted;
          if (ft.home !== undefined) {
            homeScore = Number(ft.home);
            awayScore = Number(ft.away);
          }
        }

        events.push({
          id:               ev.id,
          key:              ev.key ?? '',
          name:             ev.name ?? '',
          homeTeam:         ev.home?.name ?? '',
          awayTeam:         ev.away?.name ?? '',
          league:           leagueName,
          competitionKey:   comp.key ?? '',
          status:           ev.status ?? '',
          eventStatus:      meta.eventStatus ?? 'not_started',
          startTime:        ev.startTime ?? ev.cutoffTime ?? '',
          cutoffTime:       ev.cutoffTime ?? '',
          homeScore,
          awayScore,
          matchTimeSeconds: efv3.matchTimeSeconds ?? 0,
          eventTime:        meta.eventTime ?? '',
          betradarId:       ev.betradarId,
        });
      }
    }
  }

  return events;
}

/** Fő API hívás — közelgő esport-fifa meccsek (élő meccsek NEM szerepelnek ebben) */
async function fetchAllEvents(): Promise<CbWebEvent[]> {
  if (isWebBlocked()) {
    const remSec = Math.round((_blockedUntil - Date.now()) / 1000);
    console.log(`[cloudbet-web] blokk aktív, kihagyás (még ${remSec}s)`);
    return eventsCache.data;
  }
  try {
    const resp = await axios.get(EVENTS_URL, {
      headers: AXIOS_HEADERS,
      timeout: 12000,
    });
    const events = parseApiResponse(resp.data);
    console.log(`[cloudbet-web] ${events.length} közelgő meccs betöltve`);
    return events;
  } catch (e: any) {
    const status = (e as any).response?.status ?? 0;
    if (status === 403) {
      markWebBlocked();
    } else {
      console.error('[cloudbet-web] API hiba:', e.message);
    }
    return eventsCache.data; // utolsó érvényes cache visszaadása
  }
}

// ── 403 Backoff ───────────────────────────────────────────────────────────────

let _blockedUntil = 0;
const BLOCK_TTL = 15 * 60_000; // 15 perc

function isWebBlocked(): boolean { return Date.now() < _blockedUntil; }
function markWebBlocked(): void {
  _blockedUntil = Date.now() + BLOCK_TTL;
  console.warn(`[cloudbet-web] 🔴 403 blokk → ${BLOCK_TTL / 60_000} perc backoff (${new Date(_blockedUntil).toISOString()})`);
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let eventsCache: { data: CbWebEvent[]; ts: number } = { data: [], ts: 0 };
const CACHE_TTL = 30_000; // 30 mp — közelgő meccsek listája ritkán változik

// Közelgő meccsek ID-ját tároljuk itt, hogy ha élővé válnak (eltűnnek a listából)
// akkor egyedi lekérdezéssel tudjuk lekérni az élő állapotukat
const upcomingEventMap = new Map<number, CbWebEvent>();

/** Egyedi esemény lekérése (élő meccsekhez: metadata.score tartalmaz gólokat) */
export async function fetchSingleEvent(eventId: number): Promise<CbWebEvent | null> {
  if (isWebBlocked()) return null;
  try {
    const url = `${INTERNAL_API}/sports/events/${eventId}`;
    const resp = await axios.get(url, { headers: AXIOS_HEADERS, timeout: 8000 });
    const data = resp.data;
    // Az endpoint egy eseményt ad vissza, becsomagoljuk parseApiResponse-hoz
    const compName = data.competition?.name ?? '';
    const compKey  = data.competition?.key ?? '';
    const wrapped = {
      sports: [{
        competitions: [{ name: compName, key: compKey, events: [data] }],
      }],
    };
    const parsed = parseApiResponse(wrapped);
    return parsed[0] ?? null;
  } catch (e: any) {
    const status = e?.response?.status ?? 0;
    if (status === 403) markWebBlocked();
    return null;
  }
}

async function getCachedEvents(): Promise<CbWebEvent[]> {
  if (isWebBlocked()) return eventsCache.data;
  if (Date.now() - eventsCache.ts < CACHE_TTL && eventsCache.data.length > 0) {
    return eventsCache.data;
  }
  const events = await fetchAllEvents();

  // Automatikusan mentsük a befejezett meccseket a H2H DB-be
  // és tároljuk az összes közelgő meccs ID-ját
  for (const ev of events) {
    if (
      (ev.eventStatus === 'finished' || ev.status === 'RESULTED') &&
      ev.homeScore !== undefined
    ) {
      saveResultToH2H(ev);
    }
    // Tároljuk: ez az esemény ID-ja ismert lesz, ha élővé válik
    if (ev.id && (ev.eventStatus === 'not_started' || ev.status === 'TRADING' || ev.status === 'PRE_TRADING')) {
      upcomingEventMap.set(ev.id, ev);
    }
  }

  // Töröljük a 30 percnél régebbi bejegyzéseket (biztosan véget ért)
  const cutoffMs = Date.now() - 30 * 60 * 1000;
  for (const [id, ev] of upcomingEventMap) {
    const startMs = new Date(ev.startTime).getTime();
    if (startMs < cutoffMs) upcomingEventMap.delete(id);
  }

  eventsCache = { data: events, ts: Date.now() };
  return events;
}

// ── Publikus API ──────────────────────────────────────────────────────────────

/**
 * Közelgő meccsek menetrendje (mindkét liga).
 * Ugyanaz mint getCloudbetSchedule() de kulcs nélkül a belső API-ból.
 */
export async function getCloudbetWebSchedule(leagueFilter?: string): Promise<CbWebEvent[]> {
  const events = await getCachedEvents();
  const upcoming = events.filter(ev =>
    ev.eventStatus === 'not_started' || ev.status === 'TRADING' || ev.status === 'PRE_TRADING'
  );
  if (leagueFilter) {
    return upcoming.filter(ev => ev.league === leagueFilter);
  }
  return upcoming;
}

/**
 * Élő meccsek eredményei.
 * Az upcomingEventMap-ben tárolt eseményeket egyenként kérdezi le
 * (sports/events/{id}) amíg azok a meccskezdéstől számított 20 percen belül vannak.
 * Az egyedi endpoint metadata.score-t tartalmaz élő meccsekhez.
 */
export async function getCloudbetWebLiveScores(leagueFilter?: string): Promise<CbWebLiveScore[]> {
  // Frissítsük a cache-t (és az upcomingEventMap-et)
  await getCachedEvents();

  const now = Date.now();
  const results: CbWebLiveScore[] = [];

  // Keressük azokat az eseményeket amiknek már el kellett kezdődniük
  // de még nem teltek el 20 percnél többet (FIFA eSports ~12 perc)
  const candidates: CbWebEvent[] = [];
  for (const ev of upcomingEventMap.values()) {
    const startMs = new Date(ev.startTime).getTime();
    const elapsedMs = now - startMs;
    if (elapsedMs >= 0 && elapsedMs <= 20 * 60 * 1000) {
      candidates.push(ev);
    }
  }

  if (candidates.length === 0) return [];

  console.log(`[cloudbet-web] ${candidates.length} potenciálisan élő meccs lekérése egyenként...`);

  // Minden kandidáns eseményt egyenként kérünk le
  const fetched = await Promise.all(candidates.map(c => fetchSingleEvent(c.id)));

  for (let i = 0; i < candidates.length; i++) {
    const orig = candidates[i];
    const ev   = fetched[i] ?? orig; // ha nem sikerült, az eredeti adatot használjuk

    // Szűrjük a valóban élőket (vagy azokat amiknél megvan a score)
    const isLive = ev.eventStatus === 'in_progress' || ev.status === 'TRADING_LIVE';
    const hasScore = ev.homeScore !== undefined;

    if (!isLive && !hasScore) {
      // Ha a start legalább 1 perce volt de az API még not_started-nak mondja, fogadjuk el élőnek
      const startMs = new Date(ev.startTime).getTime();
      if (now - startMs < 60_000) continue; // nem indult el még
    }

    if (leagueFilter && ev.league !== leagueFilter) continue;

    const startMs = new Date(ev.startTime).getTime();
    const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));

    results.push({
      eventId:          ev.id,
      homeTeam:         ev.homeTeam,
      awayTeam:         ev.awayTeam,
      league:           ev.league,
      homeScore:        ev.homeScore ?? 0,
      awayScore:        ev.awayScore ?? 0,
      eventStatus:      isLive ? 'in_progress' : (ev.eventStatus ?? 'in_progress'),
      matchTimeSeconds: ev.matchTimeSeconds > 0 ? ev.matchTimeSeconds : elapsedSec,
      eventTime:        ev.eventTime ?? '',
      updatedAt:        new Date().toISOString(),
    });
  }

  return results;
}

/**
 * Befejezett meccsek (a helyi H2H DB-ből + API-ból).
 */
export async function getCloudbetWebResults(leagueFilter?: string): Promise<H2HResult[]> {
  // Frissítés: hívjuk az API-t hogy az újonnan befejezetteket is mentsük
  await getCachedEvents();

  const db = loadH2HDb();
  const results = db.results.slice().reverse(); // legújabb elől
  if (leagueFilter) {
    return results.filter(r => r.league === leagueFilter);
  }
  return results;
}

/**
 * H2H adatok két csapat között a helyi DB-ből.
 * @param teamA — normalizált csapatnév (player neve nélkül)
 * @param teamB — normalizált csapatnév (player neve nélkül)
 * @param maxDays — hány napra visszamenőleg (default: 30)
 */
export async function getCloudbetWebH2H(
  teamA: string,
  teamB: string,
  leagueFilter?: string,
  maxDays = 30
): Promise<H2HResult[]> {
  const cutoff = new Date(Date.now() - maxDays * 24 * 3600 * 1000).toISOString();
  const db = loadH2HDb();

  const normA = teamA.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
  const normB = teamB.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();

  return db.results.filter(r => {
    if (r.date < cutoff) return false;
    if (leagueFilter && r.league !== leagueFilter) return false;

    const homeNorm = r.homeTeam.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    const awayNorm = r.awayTeam.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();

    return (homeNorm.includes(normA) && awayNorm.includes(normB)) ||
           (homeNorm.includes(normB) && awayNorm.includes(normA));
  }).slice().reverse();
}

/**
 * Összes esemény (debug/feltáráshoz)
 */
export async function getCloudbetWebAllEvents(): Promise<CbWebEvent[]> {
  return getCachedEvents();
}

/**
 * H2H DB stats
 */
export function getCloudbetWebH2HStats(): { count: number; leagues: Record<string, number>; lastUpdated: string } {
  const db = loadH2HDb();
  const leagues: Record<string, number> = {};
  for (const r of db.results) {
    leagues[r.league] = (leagues[r.league] ?? 0) + 1;
  }
  return { count: db.results.length, leagues, lastUpdated: db.lastUpdated };
}

/**
 * Cache invalidálás (és blokk feloldása)
 */
export function clearCloudbetWebCache(): void {
  eventsCache = { data: [], ts: 0 };
  _blockedUntil = 0;
  console.log('[cloudbet-web] cache + blokk törölve');
}

/**
 * Debug: nyers cached events (status, eventStatus, matchTimeSeconds)
 */
export async function getCloudbetWebDebugEvents(): Promise<{
  count: number;
  live: CbWebEvent[];
  sample: Pick<CbWebEvent, 'id' | 'name' | 'status' | 'eventStatus' | 'matchTimeSeconds' | 'homeScore' | 'awayScore' | 'league'>[];
}> {
  const events = await getCachedEvents();
  const live = events.filter(ev =>
    ev.status === 'TRADING_LIVE' || ev.eventStatus === 'in_progress' || ev.matchTimeSeconds > 0
  );
  return {
    count: events.length,
    live,
    sample: events.map(ev => ({
      id: ev.id, name: ev.name, status: ev.status,
      eventStatus: ev.eventStatus, matchTimeSeconds: ev.matchTimeSeconds,
      homeScore: ev.homeScore, awayScore: ev.awayScore, league: ev.league,
    })),
  };
}

// ── Cloudbet Web O/U odds (GT Nations League + eAdriatic) ────────────────────

// Egyéni event odds cache (eventId → {ouLine, oddsOver, ts})
const _webOddsCache = new Map<number, { ouLine: number; oddsOver: number; ts: number }>();
const WEB_ODDS_TTL = 3 * 60_000; // 3 perc

/** A csapatnévből kinyeri a játékosnevet (pl. "Arsenal FC (Jack)" → "jack") */
function extractPlayerFromTeamName(teamName: string): string {
  const m = teamName.match(/\(([^)]+)\)$/);
  return (m ? m[1] : teamName).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normName(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * GT Nations League + eAdriatic O/U odds a Cloudbet belső web API-ból.
 * Nem igényel API kulcsot. Az event ID-t a schedule cache-ből veszi,
 * majd az egyedi event endpointról lekéri az esport_fifa.total_goals piacot.
 */
export async function getCloudbetWebOddsForMatch(
  playerA: string,
  playerB: string,
): Promise<{ ouLine: number; oddsOver: number } | null> {
  const nA = normName(playerA);
  const nB = normName(playerB);

  // 1. Keressük meg az event ID-t a schedule cache-ből
  const events = await getCachedEvents();
  const ev = events.find(e => {
    const eA = extractPlayerFromTeamName(e.homeTeam);
    const eB = extractPlayerFromTeamName(e.awayTeam);
    return (namesMatch(eA, nA) && namesMatch(eB, nB)) ||
           (namesMatch(eA, nB) && namesMatch(eB, nA));
  });

  // Ha nincs az aktuális listában, ellenőrizzük az upcomingEventMap-et
  // (élő meccsek eltűnnek a schedule-ból, de az ID-juk megmarad itt)
  let evId: number | null = ev?.id ?? null;
  if (!ev) {
    for (const [id, cached] of upcomingEventMap) {
      const eA = extractPlayerFromTeamName(cached.homeTeam);
      const eB = extractPlayerFromTeamName(cached.awayTeam);
      if (
        (namesMatch(eA, nA) && namesMatch(eB, nB)) ||
        (namesMatch(eA, nB) && namesMatch(eB, nA))
      ) {
        evId = id;
        console.log(`[cloudbet-web-odds] 🔄 élő meccset találtunk upcomingEventMap-ben: ${cached.homeTeam} vs ${cached.awayTeam} (id=${id})`);
        break;
      }
    }
  }

  if (!evId) {
    console.log(`[cloudbet-web-odds] ❌ nem talált: ${playerA} vs ${playerB}`);
    return null;
  }

  // 2. Odds cache hit?
  const cached = _webOddsCache.get(evId);
  if (cached && Date.now() - cached.ts < WEB_ODDS_TTL) {
    return { ouLine: cached.ouLine, oddsOver: cached.oddsOver };
  }

  // 3. Egyedi event lekérése az odds-szal együtt
  if (isWebBlocked()) return null;
  try {
    const url = `${INTERNAL_API}/sports/events/${evId}?locale=en`;
    const resp = await axios.get(url, { headers: AXIOS_HEADERS, timeout: 8000 });
    const data = resp.data;

    const totalGoalsMkt = data.markets?.['esport_fifa.total_goals'];
    const selections: any[] = totalGoalsMkt?.submarkets?.['period=ft']?.selections ?? [];

    // Gyűjtsük össze az elérhető vonalakat
    const lines = new Map<number, { over: number; under: number }>();
    for (const sel of selections) {
      if (sel.status !== 'SELECTION_ENABLED') continue;
      const m = String(sel.params ?? '').match(/total=([\d.]+)/);
      if (!m) continue;
      const line = parseFloat(m[1]);
      if (!lines.has(line)) lines.set(line, { over: 0, under: 0 });
      if (sel.outcome === 'over')  lines.get(line)!.over  = sel.price ?? 0;
      if (sel.outcome === 'under') lines.get(line)!.under = sel.price ?? 0;
    }

    if (lines.size === 0) return null;

    // Válasszuk azt a vonalat, ahol mindkét oldal él,
    // és az over ár a legközelebb van 2.00-hoz (legkiegyensúlyozottabb)
    let bestLine = 0, bestOver = 0;
    for (const [line, odds] of lines) {
      if (odds.over > 0 && odds.under > 0) {
        if (!bestLine || Math.abs(odds.over - 2.0) < Math.abs(bestOver - 2.0)) {
          bestLine = line;
          bestOver = odds.over;
        }
      }
    }

    if (!bestLine) return null;

    console.log(`[cloudbet-web-odds] ✅ ${playerA} vs ${playerB} → O/U ${bestLine} (over: ${bestOver})`);
    _webOddsCache.set(evId, { ouLine: bestLine, oddsOver: bestOver, ts: Date.now() });
    return { ouLine: bestLine, oddsOver: bestOver };
  } catch (e: any) {
    const status = e?.response?.status ?? 0;
    if (status === 403) markWebBlocked();
    else console.warn(`[cloudbet-web-odds] hiba event ${evId}:`, e.message);
    return null;
  }
}

// ── Pusher WebSocket (jövőbeli real-time integráció) ──────────────────────────
// App key: c065c29ae4b4b2f23f53
// Szerver: wss://ws-eu.pusher.com
// Csatornák: feltérképezés folyamatban
// TODO: pusher-js csomag telepítése és csatorna feliratkozás
