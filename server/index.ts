import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath as _fileURLToPath } from 'url';
{
  const __d = dirname(_fileURLToPath(import.meta.url));
  // .env helye: app/server/.env (ugyanabban a könyvtárban mint az index.ts)
  const result = dotenvConfig({ path: resolve(__d, '.env') });
  if (!result.error) console.log('[env] .env betöltve ✅');
}
initDb();
// ─────────────────────────────────────────────────────────────────────────────

import { getVegasOdds, getAllVegasOdds, clearVegasCache, getAllLiveScores, getRawLiveDebug } from './vegas-scraper.js';
import {
  scrapeFullPlayerData,
  scrapeSchedule as tcScrapeSchedule,
  getBestPlayers,
  TotalCornerLeague,
  TOTALCORNER_LEAGUES,
} from './totalcorner-scraper.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapePlayerStats, scrapeRankings, scrapeBestPlayers, scrapeSchedule as esbScrapeSchedule, scrapePlayerResults, PlayerStats } from './scraper.js';
import { calculateMatch, DEFAULT_SETTINGS } from '../src/model/calculator.js';
import { estimateMatchOdds } from '../src/model/fairOdds.js';
import { STRATEGIES } from '../src/model/strategies.js';
import { buildBacktestDataset, runBacktest } from './backtest.js';
import { analyzeTimePerformance, getTimeSummary } from '../src/model/timeFactors.js';
import {
  scrapeTCLeague, scrapeTCMatchOdds, scrapeTCH2H, aggregateH2H,
  aggregateH2HWeighted, normalizeTCH2H, mergeH2HSources,
  TC_LEAGUES, NormalizedH2H, TCFixture,
} from './totalcorner.js';
import {
  configureTelegram, isTelegramConfigured, loadConfigFromEnv,
  startBotPolling, sendMessage, sendTopTipsList,
} from './telegram.js';
import {
  configureScanner, startScanner, runScan, getScannerState, getCachedResult,
} from './scanner.js';
import {
  configureTrendScanner, startTrendScanner, getTrendScannerState, runTrendScanOnce,
} from './trend-scanner.js';
import {
  getMsportOdds, getMsportOddsForMatch, getMsportSchedule, getMsportRawDebug,
  setMsportCookie, getMsportCookieStatus, getMsportLiveScores,
  getMsportMatchResults, getMsportPlayerLastMatches, getMsportH2H,
  injectCompletedMatches, clearOldInjectedMatches, initCompletedMatchesFromDb, MsportMatchResult,
  scrapeMsportFixtures, clearFixtureCache, getMsportUpcomingSchedule, isMsportRateLimited,
} from './msport-scraper.js';
import { initDb, loadJournal, saveJournalDb, loadSettings as loadSettingsDb, saveSettings as saveSettingsDb, loadCheckedMatches, saveCheckedMatchesDb, getSubscription, upsertSubscription, revokeSubscription, supabase, getH2HFromSupabase, getPlayerMatchesFromSupabase } from './db.js';
import {
  getCloudbetOdds, getCloudbetOddsForMatch, getCloudbetSchedule,
  clearCloudbetCache, getCloudbetKeyStatus, testCloudbetApi,
  listCloudbetCompetitions, discoverCloudbetCompetitions,
  getCloudbetApiLiveScores,
} from './cloudbet-scraper.js';
import {
  getCloudbetWebSchedule, getCloudbetWebLiveScores, getCloudbetWebResults,
  getCloudbetWebH2H, getCloudbetWebAllEvents, getCloudbetWebH2HStats,
  clearCloudbetWebCache, getCloudbetWebDebugEvents, fetchSingleEvent,
  getCloudbetWebOddsForMatch,
} from './cloudbet-web-scraper.js';
import {
  ensureTracked, refreshMatch, getMatch, getAllMatches, startMatchPoller,
} from './live-match-tracker.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── In-memory log buffer ──────────────────────────────────────────────────────
const MAX_LOG_ENTRIES = 500;
interface LogEntry { ts: string; level: 'log' | 'warn' | 'error'; msg: string; }
const _logBuffer: LogEntry[] = [];

function pushLog(level: LogEntry['level'], args: any[]) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _logBuffer.push({ ts: new Date().toISOString(), level, msg });
  if (_logBuffer.length > MAX_LOG_ENTRIES) _logBuffer.shift();
}

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log = (...a) => { _origLog(...a); pushLog('log', a); };
console.warn = (...a) => { _origWarn(...a); pushLog('warn', a); };
console.error = (...a) => { _origError(...a); pushLog('error', a); };

// ── VPS Scraper (Hetzner mini szerver) ───────────────────────────────────────
// A Hetzner VPS-en futó scraper kiszolgálja a GT Leagues + eAdriatic menetrendet
// amelyek Render datacenter IP-ről nem scrape-elhetők közvetlenül.
const VPS_SCRAPER_URL = process.env.VPS_SCRAPER_URL || 'http://65.109.137.14:4000';

let _vpsCache: { schedule: any[]; updatedAt: string } = { schedule: [], updatedAt: '' };
let _vpsCbOdds: Array<{ playerA: string; playerB: string; league: string; ouLine: number; oddsOver: number; oddsUnder: number }> = [];
let _vpsCacheTs = 0;
const VPS_CACHE_TTL = 3 * 60 * 1000; // 3 perc

async function getVpsSchedule(): Promise<any[]> {
  if (Date.now() - _vpsCacheTs < VPS_CACHE_TTL && _vpsCache.schedule.length > 0) {
    return _vpsCache.schedule;
  }
  try {
    const ax = await import('axios').then(m => m.default);
    // Párhuzamosan kérjük a menetrendet, msport odds-okat ÉS cloudbet odds-okat
    const [schedResp, oddsResp, cbOddsResp] = await Promise.allSettled([
      ax.get(`${VPS_SCRAPER_URL}/schedule`, { timeout: 8000 }),
      ax.get(`${VPS_SCRAPER_URL}/msport-odds`, { timeout: 8000 }),
      ax.get(`${VPS_SCRAPER_URL}/cloudbet-odds`, { timeout: 8000 }),
    ]);

    if (schedResp.status !== 'fulfilled') throw new Error(schedResp.reason?.message ?? 'schedule hiba');
    _vpsCache = schedResp.value.data;

    // Ha a VPS odds elérhető, mergeljük a menetrend bejegyzésekbe
    if (oddsResp.status === 'fulfilled') {
      const oddsMap = new Map<string, any>();
      for (const o of (oddsResp.value.data?.odds ?? [])) {
        const k = `${(o.playerA || '').toLowerCase()}|${(o.playerB || '').toLowerCase()}`;
        oddsMap.set(k, o);
      }
      for (const m of _vpsCache.schedule) {
        const k = `${(m.playerHome || '').toLowerCase()}|${(m.playerAway || '').toLowerCase()}`;
        const odd = oddsMap.get(k);
        if (odd?.ouLine > 0) {
          m.ouLine    = odd.ouLine;
          m.oddsOver  = odd.oddsOver;
          m.oddsUnder = odd.oddsUnder;
          m.oddsSource = 'msport.com';
        }
      }
      const withOdds = _vpsCache.schedule.filter((m: any) => m.oddsSource === 'msport.com').length;
      console.log(`[vps] msport odds: ${withOdds}/${_vpsCache.schedule.length} meccsnél`);
    } else {
      console.warn(`[vps] msport-odds nem elérhető: ${oddsResp.reason?.message ?? 'ismeretlen hiba'}`);
    }

    // Cloudbet odds a VPS-ről (GT Leagues + eAdriatic, VPS IP nem blokkolt)
    if (cbOddsResp.status === 'fulfilled') {
      _vpsCbOdds = cbOddsResp.value.data?.odds ?? [];
      console.log(`[vps] cloudbet odds: ${_vpsCbOdds.length} meccsnél`);
    } else {
      console.warn(`[vps] cloudbet-odds nem elérhető: ${(cbOddsResp as any).reason?.message ?? 'ismeretlen hiba'}`);
    }

    _vpsCacheTs = Date.now();
    console.log(`[vps] ✅ ${_vpsCache.schedule.length} meccs (${_vpsCache.updatedAt})`);
    return _vpsCache.schedule;
  } catch (e: any) {
    console.warn(`[vps] ⚠️ Nem elérhető: ${e.message}`);
    return _vpsCache.schedule; // visszaadjuk a cache-t ha van
  }
}

// ── VPS live-tracked completed results → H2H injektálás ──────────────────────
// A VPS scraper figyeli az in-play meccseket és menti a befejezetteket.
// Ez pótolja az msport my-matches/fixtures API-t (ami Render IP-ről blokkolt).
let _vpsResultsLastFetch = 0;
const VPS_RESULTS_TTL = 10 * 60 * 1000; // 10 perc

async function fetchVpsResults(): Promise<void> {
  if (Date.now() - _vpsResultsLastFetch < VPS_RESULTS_TTL) return;
  _vpsResultsLastFetch = Date.now();
  try {
    const ax = await import('axios').then(m => m.default);
    const resp = await ax.get(`${VPS_SCRAPER_URL}/msport-results`, { timeout: 8000 });
    const results: MsportMatchResult[] = (resp.data?.results ?? []).filter((r: any) =>
      r.playerA && r.playerB && r.league &&
      typeof r.scoreA === 'number' && typeof r.scoreB === 'number'
    );
    if (results.length > 0) {
      const added = await injectCompletedMatches(results);
      if (added > 0) {
        console.log(`[vps-results] +${added} befejezett meccs injektálva H2H-hoz (VPS live tracker)`);
      }
    }
  } catch (e: any) {
    // silent — VPS nem mindig elérhető
  }
}


// ── TC-only leagues not on esoccerbet.org ─────────────────────────────────────
// Volta is on esoccerbet.org — use that for rich per-match history. H2H GG is TC-only.
const TC_ONLY_LEAGUES = new Set(['Esoccer H2H GG League']);

/** TotalCorner serves times in UTC. Budapest is CEST (UTC+2). Add 2 hours. */
function shiftTCTime<T extends { time?: string }>(entry: T): T {
  const [h, m] = (entry.time || '00:00').split(':').map(Number);
  const newH = (h + 2) % 24;
  return { ...entry, time: `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

/** Filter a TC schedule array to upcoming/in-progress matches.
 *  Times have already been shifted to Budapest local (CEST = UTC+2).
 *  Compare directly against server local time — no further offset needed.
 */
function filterTCSchedule<T extends { time?: string; scoreHome?: number; scoreAway?: number }>(
  raw: T[]
): T[] {
  return raw.filter(m => {
    const [mH, mM] = (m.time || '00:00').split(':').map(Number);
    const matchLocalMinutes = mH * 60 + mM;
    const now = new Date();
    const nowLocalMinutes = now.getHours() * 60 + now.getMinutes();
    let diff = matchLocalMinutes - nowLocalMinutes;
    if (diff < -720) diff += 1440;
    if (diff > 720) diff -= 1440;
    // GT max 12 perc + 2 perc buffer = 14 perc; eAdriatic 10 perc is belefér
    return diff >= -14;
  });
}

// ── Napi Mérkőzések accumulator ───────────────────────────────────────────────
// Gyűjti az egész nap összes GT Leagues + eAdriatic meccsét (eventId alapján deduplikálva).
// Minden getCombinedSchedule() hívásnál frissül → scanner lefedés biztosított.
interface DailyMatchEntry {
  playerA: string; playerB: string; teamA: string; teamB: string;
  league: string; time: string; date: string;
  ouLine: number; oddsOver: number; oddsUnder: number;
  startTime: number; eventId: string;
  // Végeredmény — pollCompletedMatchScores tölti ki, ha a meccs véget ért
  scoreA?: number; scoreB?: number;
}
const dailyMatchMap = new Map<string, DailyMatchEntry>();
let dailyMapDate = '';

function todayMmDd(): string {
  // Budapest CEST = UTC+2 — explicit offset, szerver timezone-tól független
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** startTime (Unix ms) → "MM/DD" Budapest CEST (UTC+2) */
function startTimeToMmDd(startTimeMs: number): string {
  // Budapest = UTC+2; new Date() uses server local time which may be UTC
  // → Explicit UTC+2 offset biztosítja a helyes dátumot minden szerver-timezone esetén
  const d = new Date(startTimeMs + 2 * 3600 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

function updateDailyAccum(odds: import('./msport-scraper.js').MsportOdds[]): void {
  const today = todayMmDd();
  if (dailyMapDate !== today) { dailyMatchMap.clear(); dailyMapDate = today; }
  for (const o of odds) {
    if (dailyMatchMap.has(o.eventId)) continue;
    const date = startTimeToMmDd(o.startTime);
    // time-t szándékosan NEM tároljuk UTC-ben — a frontend startTime-ból számítja helyi időben
    dailyMatchMap.set(o.eventId, {
      playerA: o.playerA, playerB: o.playerB, teamA: o.teamA, teamB: o.teamB,
      league: o.league, time: date, date,  // time unused, frontend uses startTime
      ouLine: o.ouLine, oddsOver: o.oddsOver, oddsUnder: o.oddsUnder,
      startTime: o.startTime, eventId: o.eventId,
    });
  }
}

/**
 * TC-ből érkező GT Leagues fixture konvertálása ScheduleEntry formátumba.
 * startTime: "05/05 17:59" (UTC) → date="05/05", time="19:59" (CEST +2h)
 */
function tcFixtureToEntry(f: TCFixture, league: string) {
  if (!f.playerHome || !f.playerAway || !f.startTime) return null;
  // Már lezárt meccsek kiszűrése (van score)
  if (f.score && /\d\s*-\s*\d/.test(f.score)) return null;

  const parts = f.startTime.trim().split(' ');
  if (parts.length < 2) return null;
  const date = parts[0]; // "05/05"
  const timeUTC = parts[1]; // "17:59"

  const [h, m] = timeUTC.split(':').map(Number);
  const newH = (h + 2) % 24; // UTC → Budapest CEST (+2h)
  const time = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Közelítő startTime ms (idei év alapján)
  const now = new Date();
  const [mo, day] = date.split('/').map(Number);
  const startTime = Date.UTC(now.getFullYear(), mo - 1, day, h, m, 0);

  return {
    playerHome: f.playerHome,
    playerAway: f.playerAway,
    teamHome: f.teamHome,
    teamAway: f.teamAway,
    league,
    time,
    date,
    startTime,
    eventId: f.matchId,
  };
}

/**
 * Cloudbet belső API event → schedule entry konverzió.
 * A csapatnév formátuma: "Real Betis (Tifosi)" → teamHome="Real Betis", playerHome="Tifosi"
 */
function cbWebEventToEntry(ev: import('./cloudbet-web-scraper.js').CbWebEvent) {
  const parseTeam = (name: string): { team: string; player: string } => {
    const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) return { team: m[1].trim(), player: m[2].trim() };
    return { team: name.trim(), player: '' };
  };

  const home = parseTeam(ev.homeTeam);
  const away = parseTeam(ev.awayTeam);
  if (!home.player || !away.player) return null;  // player név kell

  // startTime UTC ISO → Budapest CEST (UTC+2) → "HH:MM" és "MM/DD"
  const utcMs  = new Date(ev.startTime).getTime();
  const cestMs = utcMs + 2 * 3600 * 1000;
  const d      = new Date(cestMs);
  const time   = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const date   = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;

  return {
    playerHome: home.player,
    playerAway: away.player,
    teamHome:   home.team,
    teamAway:   away.team,
    league:     ev.league,
    time,
    date,
    startTime:  utcMs,
    eventId:    String(ev.id),
  };
}

/** Combined schedule: esoccerbet.org + TotalCorner-only leagues (upcoming only) */
async function getCombinedSchedule() {
  const [esbResult, h2hResult, voltaResult, cloudbetResult, gtTcResult, cbWebResult, vpsResult] = await Promise.allSettled([
    esbScrapeSchedule(),
    tcScrapeSchedule('Esoccer H2H GG League'),
    tcScrapeSchedule('Esports Volta'),
    getCloudbetKeyStatus().configured ? getCloudbetSchedule() : Promise.resolve([]),
    scrapeTCLeague('GT Leagues'),
    getCloudbetWebSchedule(),
    getVpsSchedule(),  // ← Hetzner VPS scraper (GT + ADR, IP-block mentes)
  ]);

  const esbAll      = esbResult.status      === 'fulfilled' ? esbResult.value      : [];
  const esb         = esbAll.filter(e => e.league !== 'eAdriatic League');
  const h2hRaw      = h2hResult.status      === 'fulfilled' ? h2hResult.value      : [];
  const voltaRaw    = voltaResult.status    === 'fulfilled' ? voltaResult.value    : [];
  const cloudbetRaw = cloudbetResult.status === 'fulfilled' ? cloudbetResult.value : [];
  const gtTcData    = gtTcResult.status     === 'fulfilled' ? gtTcResult.value     : null;
  const cbWebRaw    = cbWebResult.status    === 'fulfilled' ? cbWebResult.value    : [];
  const vpsRaw      = vpsResult.status      === 'fulfilled' ? vpsResult.value      : [];

  const gtTcEntries = (gtTcData?.fixtures ?? [])
    .map(f => tcFixtureToEntry(f, 'GT Leagues'))
    .filter((e): e is NonNullable<ReturnType<typeof tcFixtureToEntry>> => e !== null);

  const cbWebEntries = cbWebRaw
    .map(ev => cbWebEventToEntry(ev))
    .filter((e): e is NonNullable<ReturnType<typeof cbWebEventToEntry>> => e !== null);

  // VPS entries: közvetlenül használható formátum
  // _fromVps=true jelölő: Render-en az IP-block ellenére is megjelennek (estimated odds-szal is)
  const vpsEntries = vpsRaw
    .filter((e: any) => e.playerHome && e.playerAway && e.league)
    .map((e: any) => ({ ...e, _fromVps: true }));

  const cbWebGT       = cbWebEntries.filter(e => e.league === 'GT Leagues');
  const cbWebAdriatic = cbWebEntries.filter(e => e.league === 'eAdriatic League');

  // Deduplikálás — prioritás: VPS > Cloudbet Web > Cloudbet API > TC > esb
  const allKeys = new Set<string>();

  // 1. VPS (Hetzner) — elsődleges Render-en (nincs IP-block)
  vpsEntries.forEach((m: any) => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));

  // 2. Cloudbet Web (lokálisan működik, Render-en lehet blokkolva)
  cbWebEntries
    .filter(m => !allKeys.has(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`))
    .forEach(m => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));

  // 3. Cloudbet API (authenticated) — csak eAdriatic
  const cloudbetOnly = cloudbetRaw.filter(
    m => !allKeys.has(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`),
  );
  cloudbetOnly.forEach(m => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));

  // GT: TC deduplikálva
  const gtTcOnly = gtTcEntries.filter(
    m => !allKeys.has(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`),
  );
  gtTcOnly.forEach(m => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));

  // GT: esb utolsó fallback
  const esbGT = esb.filter(e => e.league === 'GT Leagues'
    && !allKeys.has(`${e.playerHome.toLowerCase()}|${e.playerAway.toLowerCase()}`),
  );
  const esbOther = esb.filter(e => e.league !== 'GT Leagues');

  // cbWeb GT + ADR deduplikálva az allKeys-szel (VPS már benne van → csak a különbség kerül be)
  const cbWebGTDeduped  = cbWebGT.filter(m => !allKeys.has(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));
  const cbWebADRDeduped = cbWebAdriatic.filter(m => !allKeys.has(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));
  cbWebGTDeduped.forEach(m => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));
  cbWebADRDeduped.forEach(m => allKeys.add(`${m.playerHome.toLowerCase()}|${m.playerAway.toLowerCase()}`));

  const cbApiGT  = cloudbetOnly.filter(m => m.league === 'GT Leagues').length;
  const cbApiAdr = cloudbetOnly.filter(m => m.league === 'eAdriatic League').length;
  const vpsGT  = vpsEntries.filter((m: any) => m.league === 'GT Leagues').length;
  const vpsAdr = vpsEntries.filter((m: any) => m.league === 'eAdriatic League').length;
  console.log(`[schedule] VPS: GT=${vpsGT} eAdr=${vpsAdr} | CbWeb fallback: GT=${cbWebGTDeduped.length} eAdr=${cbWebADRDeduped.length} | CbAPI: eAdr=${cbApiAdr} | TC GT: ${gtTcOnly.length} | esb GT: ${esbGT.length}`);

  return [
    ...esbOther,
    ...vpsEntries,                          // VPS elsődleges (GT + ADR)
    ...cbWebGTDeduped,                      // Cloudbet Web fallback GT (csak VPS-ben nem szereplők)
    ...cbWebADRDeduped,                     // Cloudbet Web fallback ADR (csak VPS-ben nem szereplők)
    ...cloudbetOnly,                        // Cloudbet API ADR
    ...filterTCSchedule(gtTcOnly),          // TC GT fallback
    ...esbGT,                               // ESB GT utolsó fallback
    ...filterTCSchedule(h2hRaw.map(shiftTCTime)),
    ...filterTCSchedule(voltaRaw.map(shiftTCTime)),
  ];
}

// ── Sticky buffer: keep GT Leagues match cards for 3 min after scheduled start ──
type ScheduleEntry = Awaited<ReturnType<typeof getCombinedSchedule>>[number];
const stickyBuffer = new Map<string, { entry: ScheduleEntry; startMs: number }>();

function updateStickyBuffer(schedule: ScheduleEntry[]) {
  const now = Date.now();
  const today = new Date();
  const dayBase = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const STICKY_LEAGUES = new Set(['GT Leagues', 'Esoccer H2H GG League', 'Esports Volta']);
  for (const entry of schedule) {
    if (!STICKY_LEAGUES.has(entry.league)) continue;
    const key = `${entry.playerHome}|${entry.playerAway}|${entry.time}`;
    if (!stickyBuffer.has(key)) {
      const [h, m] = (entry.time || '00:00').split(':').map(Number);
      stickyBuffer.set(key, { entry, startMs: dayBase + h * 3600000 + m * 60000 });
    }
  }
  // Clean entries older than 5 min past start
  for (const [key, { startMs }] of stickyBuffer) {
    if (now - startMs > 5 * 60 * 1000) stickyBuffer.delete(key);
  }
}

function applySticky(schedule: ScheduleEntry[]): ScheduleEntry[] {
  const now = Date.now();
  const currentKeys = new Set(schedule.map(e => `${e.playerHome}|${e.playerAway}|${e.time}`));
  const extra: ScheduleEntry[] = [];
  for (const [, { entry, startMs }] of stickyBuffer) {
    if (currentKeys.has(`${entry.playerHome}|${entry.playerAway}|${entry.time}`)) continue;
    const msPastStart = now - startMs;
    if (msPastStart >= 0 && msPastStart <= 3 * 60 * 1000) extra.push(entry);
  }
  return extra.length > 0 ? [...schedule, ...extra] : schedule;
}

/** Promise-based cache for TC bulk player data (prevents parallel fetches) */
const tcPlayerBulkPromise = new Map<string, Promise<import('./totalcorner-scraper.js').TotalCornerPlayer[]>>();
const tcPlayerBulkTs = new Map<string, number>();
const TC_BULK_TTL = 10 * 60 * 1000;

async function getTCPlayerBulk(league: TotalCornerLeague) {
  const ts = tcPlayerBulkTs.get(league) ?? 0;
  if (Date.now() - ts < TC_BULK_TTL && tcPlayerBulkPromise.has(league)) {
    return tcPlayerBulkPromise.get(league)!;
  }
  const p = scrapeFullPlayerData(league);
  tcPlayerBulkPromise.set(league, p);
  tcPlayerBulkTs.set(league, Date.now());
  return p;
}

/** Convert TotalCornerPlayer → PlayerStats for TC-only leagues.
 *  Builds per-match history from the TC schedule (which contains full results history).
 */
async function getPlayerStatsTC(playerName: string, league: TotalCornerLeague): Promise<PlayerStats> {
  const pNameLow = playerName.toLowerCase();

  const [bulk, fullSchedule] = await Promise.all([
    getTCPlayerBulk(league),
    cached(`tc:full-schedule:${league}`, () => tcScrapeSchedule(league)),
  ]);

  const p = bulk.find(pl => pl.name.toLowerCase() === pNameLow);
  if (!p) throw new Error(`Player ${playerName} not found in TC ${league}`);

  // Build per-match history from the TC schedule (completed matches = both scores defined)
  const lastMatches = fullSchedule
    .filter(m =>
      m.scoreHome !== undefined && m.scoreAway !== undefined &&
      (m.playerHome.toLowerCase() === pNameLow || m.playerAway.toLowerCase() === pNameLow)
    )
    .map(m => {
      const isHome = m.playerHome.toLowerCase() === pNameLow;
      const gf = isHome ? (m.scoreHome ?? 0) : (m.scoreAway ?? 0);
      const ga = isHome ? (m.scoreAway ?? 0) : (m.scoreHome ?? 0);
      return {
        date: m.time ? `${m.date} ${m.time}` : m.date,
        opponent: isHome ? m.playerAway : m.playerHome,
        team: isHome ? m.teamHome : m.teamAway,
        opponentTeam: isHome ? m.teamAway : m.teamHome,
        result: (gf > ga ? 'win' : gf < ga ? 'loss' : 'draw') as 'win' | 'loss' | 'draw',
        scoreHome: gf,
        scoreAway: ga,
      };
    })
    .slice(0, 20); // TC table is already newest-first

  // Recent form delta vs season average
  const last10 = lastMatches.slice(0, 10);
  const recentWR = last10.length > 0 ? last10.filter(m => m.result === 'win').length / last10.length : p.winRate;
  const form10 = recentWR - p.winRate;

  return {
    name: p.name,
    league,
    matches: p.matches,
    wins: p.wins,
    draws: p.draws,
    losses: p.losses,
    winRate: p.winRate,
    lossRate: p.matches > 0 ? p.losses / p.matches : 0,
    drawRate: p.matches > 0 ? p.draws / p.matches : 0,
    goalDiff: p.gf - p.ga,
    gfPerMatch: p.avgGF,
    gaPerMatch: p.avgGA,
    form10,
    form50: 0,
    form200: 0,
    bttsYes: 0.5,
    ouStats: p.ouStats,
    lastMatches,
  };
}

/** Unified player stats: msport (GT/eAdriatic), TC (H2H GG) vagy esoccerbet fallback */
async function getPlayerStats(playerName: string, league: string): Promise<PlayerStats> {
  if (TC_ONLY_LEAGUES.has(league)) {
    return getPlayerStatsTC(playerName, league as TotalCornerLeague);
  }
  // GT Leagues + eAdriatic League → KIZÁRÓLAG msport.com
  // esoccerbet.org teljesen kizárva ennél a két ligánál.
  if (league === 'GT Leagues' || league === 'eAdriatic League') {
    try {
      const lastMatches = await getMsportPlayerLastMatches(playerName, league);
      const total = lastMatches.length;
      if (total > 0) {
        const wins   = lastMatches.filter(m => m.result === 'win').length;
        const draws  = lastMatches.filter(m => m.result === 'draw').length;
        const losses = lastMatches.filter(m => m.result === 'loss').length;
        const winRate  = wins / total;
        const gfTotal  = lastMatches.reduce((s, m) => s + m.scoreHome, 0);
        const gaTotal  = lastMatches.reduce((s, m) => s + m.scoreAway, 0);
        const last10 = lastMatches.slice(0, 10);
        const wr10   = last10.length > 0 ? last10.filter(m => m.result === 'win').length / last10.length : winRate;
        const ouLines = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        const ouStats = ouLines.map(line => {
          const over = lastMatches.filter(m => m.scoreHome + m.scoreAway > line).length / total;
          return { line: String(line), over, under: 1 - over };
        });
        return {
          name: playerName, league,
          matches: total, wins, draws, losses,
          winRate, lossRate: losses / total, drawRate: draws / total,
          goalDiff: gfTotal - gaTotal,
          gfPerMatch: gfTotal / total, gaPerMatch: gaTotal / total,
          form10: wr10 - winRate, form50: 0, form200: 0,
          bttsYes: lastMatches.filter(m => m.scoreHome > 0 && m.scoreAway > 0).length / total,
          ouStats, lastMatches,
        };
      }
    } catch { /* silent */ }
    // msport results üres (endpoint még nem elérhető) → alapértelmezett üres stats
    return {
      name: playerName, league,
      matches: 0, wins: 0, draws: 0, losses: 0,
      winRate: 0.5, lossRate: 0.25, drawRate: 0.25,
      goalDiff: 0, gfPerMatch: 3.5, gaPerMatch: 3.5,
      form10: 0, form50: 0, form200: 0,
      bttsYes: 0.5,
      ouStats: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map(line => ({ line: String(line), over: 0.5, under: 0.5 })),
      lastMatches: [],
    };
  }
  return scrapePlayerStats(playerName, league);
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), node: process.version });
});

// Frontend config — exposes non-secret env vars to the React app at runtime
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  });
});

// Delete the calling user's account (requires valid JWT in Authorization header)
app.delete('/api/auth/delete-account', async (req, res) => {
  const sb = supabase;
  if (!sb) { res.status(503).json({ error: 'Supabase not configured' }); return; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Missing token' }); return; }
  try {
    const { data: { user }, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !user) { res.status(401).json({ error: 'Invalid token' }); return; }
    const { error } = await sb.auth.admin.deleteUser(user.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' });
  }
});

app.post('/api/cache/clear', (_req, res) => {
  const before = cache.size;
  cache.clear();
  res.json({ cleared: before });
});

// Classify a bet into STRONG_BET / BET / NO_BET based on confidence + edge
function classifyBet(confidence: number, edge: number, valueBet: string): 'STRONG_BET' | 'BET' | 'NO_BET' {
  if (valueBet === 'PASS') return 'NO_BET';
  if (confidence >= 0.80 && edge >= 0.08) return 'STRONG_BET';
  if (confidence >= 0.65 && edge >= 0.04) return 'BET';
  return 'NO_BET';
}

// Strategy-specific classification (uses custom thresholds from Strategy definition)
function classifyBetWithStrategy(
  confidence: number, edge: number, valueBet: string,
  strategy: import('../src/model/strategies.js').Strategy
): 'STRONG_BET' | 'BET' | 'NO_BET' {
  if (valueBet === 'PASS') return 'NO_BET';
  const sc = strategy.strongBetConf ?? 0.80;
  const se = strategy.strongBetEdge ?? 0.08;
  const bc = strategy.betConf ?? 0.65;
  const be = strategy.betEdge ?? 0.04;
  if (confidence >= sc && edge >= se) return 'STRONG_BET';
  if (confidence >= bc && edge >= be) return 'BET';
  return 'NO_BET';
}

// "MM/DD" today prefix for fatigue detection (matches lastMatches date format)
function todayMMDD(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

// Sanity check: edge > 50% is suspicious (likely data error or mispriced market)
function sanityWarning(edge: number, h2hTotal: number, oddsSource: string): string | null {
  if (edge >= 0.50) {
    return `Gyanúsan magas edge (${(edge * 100).toFixed(0)}%) — ellenőrizd a valós oddsot`;
  }
  if (edge >= 0.35 && oddsSource === 'estimated') {
    return 'Magas edge becsült oddsszal — a valós piaci odds eltérhet';
  }
  if (edge >= 0.30 && h2hTotal < 8) {
    return 'Magas edge kis H2H mintán — óvatosan';
  }
  return null;
}

// Test Vegas.hu scraper:
//   /api/test-vegas?playerA=donatello&playerB=peconi  → specific match
//   /api/test-vegas                                   → all e-soccer events
app.get('/api/test-vegas', async (req, res) => {
  const playerA = req.query.playerA as string | undefined;
  const playerB = req.query.playerB as string | undefined;
  try {
    clearVegasCache();
    if (playerA && playerB) {
      const odds = await getVegasOdds(playerA, playerB);
      res.json({ playerA, playerB, result: odds, found: odds !== null });
    } else {
      const all = await getAllVegasOdds();
      res.json({ count: all.length, all, sample: all.slice(0, 5) });
    }
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// Debug: raw TC schedule for H2H GG League (megmutatja van-e score a múltbeli meccseken)
app.get('/api/debug-tc-schedule', async (req, res) => {
  const league = (req.query.league as string) || 'Esoccer H2H GG League';
  try {
    const raw = await tcScrapeSchedule(league as TotalCornerLeague);
    const withScore = raw.filter(m => m.scoreHome !== undefined || m.scoreAway !== undefined);
    const withoutScore = raw.filter(m => m.scoreHome === undefined && m.scoreAway === undefined);
    res.json({
      total: raw.length,
      withScore: withScore.length,
      withoutScore: withoutScore.length,
      sampleWithScore: withScore.slice(0, 5),
      sampleWithoutScore: withoutScore.slice(0, 5),
      serverLocalTime: new Date().toLocaleString('hu-HU'),
      serverUTCTime: new Date().toUTCString(),
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/msport-odds — msport.com O/U odds (GT Leagues + eAdriatic League)
app.get('/api/msport-odds', async (_req, res) => {
  try {
    const odds = await getMsportOdds();
    res.json(odds);
  } catch {
    res.json([]);
  }
});

// GET /api/msport-debug — nyers msport.com API válasz (fejlesztéshez)
app.get('/api/msport-debug', async (_req, res) => {
  try {
    const raw = await getMsportRawDebug();
    res.json(raw);
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-debug — Cloudbet API teszt
app.get('/api/cloudbet-debug', async (_req, res) => {
  try {
    const result = await testCloudbetApi();
    res.json(result);
  } catch (e: unknown) {
    res.json({ ok: false, error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-status — API kulcs állapota
app.get('/api/cloudbet-status', (_req, res) => {
  res.json(getCloudbetKeyStatus());
});

// GET /api/cloudbet-raw — nyers API válasz debug (sport lista + competition próbák)
app.get('/api/cloudbet-raw', async (_req, res) => {
  const rawKey = process.env.CLOUDBET_API_KEY || '';
  // Idézőjelek eltávolítása, ha valaki mégis beletette
  const key = rawKey.replace(/^["']|["']$/g, '').trim();

  const keyInfo = {
    length: key.length,
    first8: key.slice(0, 8),
    last8: key.slice(-8),
    hasQuotes: rawKey !== key,
    startsWithEyJ: key.startsWith('eyJ'),
  };
  console.log(`[cloudbet-raw] kulcs info:`, keyInfo);

  const ax = (await import('axios')).default;
  const results: Record<string, any> = { keyInfo };

  // Header variációk kipróbálása
  const headerVariants = [
    { label: 'X-API-Key', headers: { 'X-API-Key': key, 'Accept': 'application/json' } },
    { label: 'Authorization Bearer', headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' } },
    { label: 'X-API-Key + Content-Type', headers: { 'X-API-Key': key, 'Accept': 'application/json', 'Content-Type': 'application/json' } },
  ];

  results.sports_attempts = {};
  for (const v of headerVariants) {
    try {
      const r = await ax.get('https://sports-api.cloudbet.com/pub/v2/odds/sports', {
        headers: v.headers, timeout: 8_000,
      });
      results.sports_attempts[v.label] = {
        status: 'ok',
        sportCount: Array.isArray(r.data?.sports) ? r.data.sports.length : '?',
        data: r.data,
      };
      // Ha valamelyik működik, ne próbáljuk tovább
      break;
    } catch (e: any) {
      results.sports_attempts[v.label] = { status: e.response?.status ?? 'error', msg: e.message };
    }
  }

  // Ha valamelyik sports kérés OK volt, próbáljuk az esport-fifa kompetíciókat
  const workingVariant = headerVariants.find(v => results.sports_attempts[v.label]?.status === 'ok');
  if (workingVariant) {
    try {
      const r = await ax.get('https://sports-api.cloudbet.com/pub/v2/odds/sports/esport-fifa', {
        headers: workingVariant.headers, timeout: 8_000,
      });
      results.esport_fifa = r.data;
    } catch (e: any) {
      results.esport_fifa_error = e.message;
    }
  }

  res.json(results);
});

// GET /api/cloudbet-competitions — listázza az összes esport-fifa versenyt (key-kereséshez)
app.get('/api/cloudbet-competitions', async (_req, res) => {
  try {
    const competitions = await listCloudbetCompetitions();
    res.json({ count: competitions.length, competitions });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-discover — részletes verseny-lista event számokkal
app.get('/api/cloudbet-discover', async (_req, res) => {
  try {
    const competitions = await discoverCloudbetCompetitions();
    res.json({ count: competitions.length, competitions });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// ── Cloudbet belső Web API (kulcs nélkül!) ────────────────────────────────────

// GET /api/cloudbet-web-schedule?league=eAdriatic+League — menetrend (belső API)
app.get('/api/cloudbet-web-schedule', async (req, res) => {
  try {
    const league = req.query.league as string | undefined;
    const events = await getCloudbetWebSchedule(league);
    res.json({ count: events.length, events });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-web-live?league=eAdriatic+League — élő eredmények
app.get('/api/cloudbet-web-live', async (req, res) => {
  try {
    const league = req.query.league as string | undefined;
    const scores = await getCloudbetWebLiveScores(league);
    res.json({ count: scores.length, scores });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-web-results?league=eAdriatic+League — befejezett meccsek (H2H DB)
app.get('/api/cloudbet-web-results', async (req, res) => {
  try {
    const league = req.query.league as string | undefined;
    const results = await getCloudbetWebResults(league);
    res.json({ count: results.length, results: results.slice(0, 50) });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-web-h2h?teamA=...&teamB=...&league=...&days=30 — H2H adatok
app.get('/api/cloudbet-web-h2h', async (req, res) => {
  try {
    const teamA  = (req.query.teamA  as string) || '';
    const teamB  = (req.query.teamB  as string) || '';
    const league = req.query.league  as string | undefined;
    const days   = parseInt(req.query.days as string || '30');
    const matches = await getCloudbetWebH2H(teamA, teamB, league, days);
    res.json({ count: matches.length, matches });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-web-all — összes event (debug)
app.get('/api/cloudbet-web-all', async (_req, res) => {
  try {
    const events = await getCloudbetWebAllEvents();
    res.json({ count: events.length, events });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/cloudbet-web-h2h-stats — H2H DB státusza
app.get('/api/cloudbet-web-h2h-stats', async (_req, res) => {
  try {
    const stats = getCloudbetWebH2HStats();
    res.json(stats);
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// POST /api/cloudbet-web-clear — cache törlés
app.post('/api/cloudbet-web-clear', (_req, res) => {
  clearCloudbetWebCache();
  res.json({ ok: true });
});

// GET /api/msport-results-debug — lezárt meccsek eredménye (fejlesztéshez)
// Megmutatja melyik endpoint működik és hány meccs jött vissza.
app.get('/api/msport-results-debug', async (_req, res) => {
  try {
    const results = await getMsportMatchResults();
    res.json({
      total: results.length,
      gt: results.filter(r => r.league === 'GT Leagues').length,
      eAdriatic: results.filter(r => r.league === 'eAdriatic League').length,
      sample: results.slice(0, 5),
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/accum-debug — score accumulator állapota (fejlesztéshez)
// Megmutatja hány meccs van a dailyMatchMap-ben, hány lett már lezárva,
// hány fog kelleni a pollhoz, és az utolsó injektált eredmények.
app.get('/api/accum-debug', async (_req, res) => {
  try {
    const now = Date.now();
    const BUFFER_AFTER  =  2 * 60 * 1000;
    const GIVE_UP_AFTER = 35 * 60 * 1000;
    const all = Array.from(dailyMatchMap.values());
    const toCheck = all.filter(m => {
      if (_completedEventIds.has(m.eventId)) return false;
      const duration = MATCH_DURATION_MS[m.league] ?? 12 * 60 * 1000;
      const elapsed = now - m.startTime;
      return elapsed >= (duration + BUFFER_AFTER) && elapsed <= (duration + GIVE_UP_AFTER);
    });
    const results = await getMsportMatchResults();
    res.json({
      dailyMapSize: all.length,
      completedInjected: _completedEventIds.size,
      pendingCheck: toCheck.length,
      toCheckSample: toCheck.slice(0, 5).map(m => ({
        playerA: m.playerA, playerB: m.playerB, league: m.league,
        startedMinsAgo: Math.round((now - m.startTime) / 60000),
      })),
      totalResultsAvailable: results.length,
      gtResults: results.filter(r => r.league === 'GT Leagues').length,
      eAdriaticResults: results.filter(r => r.league === 'eAdriatic League').length,
      lastInjected: results
        .sort((a, b) => b.startTime - a.startTime)
        .slice(0, 10)
        .map(r => ({ playerA: r.playerA, scoreA: r.scoreA, scoreB: r.scoreB, playerB: r.playerB, league: r.league, date: r.date })),
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// POST /api/msport-cookie — msport.com session cookie beállítása (DevTools-ból másolva)
// Body: { "cookie": "cookie1=val1; cookie2=val2; ..." }
app.post('/api/msport-cookie', (req, res) => {
  const { cookie } = req.body as { cookie?: string };
  if (!cookie || typeof cookie !== 'string' || cookie.trim().length < 5) {
    res.status(400).json({ error: 'Hiányzó vagy érvénytelen cookie string' });
    return;
  }
  setMsportCookie(cookie);
  clearFixtureCache(); // fixture cache törlése az új cookie-val való frissítéshez
  res.json({ ok: true, length: cookie.trim().length, msg: 'Cookie beállítva. Cache törölve, következő lekérésnél az új cookie lesz használva.' });
});

// GET /api/msport-fixture-debug — fixture oldal scraper teszt (fejlesztéshez)
// Megmutatja hány meccset sikerült parsoni az msport fixture oldaláról.
app.get('/api/msport-fixture-debug', async (_req, res) => {
  try {
    clearFixtureCache(); // mindig friss lekérés debug-nál
    const data = await scrapeMsportFixtures();
    res.json({
      count: data.length,
      gt: data.filter(r => r.league === 'GT Leagues').length,
      eAdriatic: data.filter(r => r.league === 'eAdriatic League').length,
      sample: data.slice(0, 15),
      msg: data.length === 0
        ? '⚠️ Az API nem adott vissza adatot. Ellenőrizd a cookie-t vagy próbáld újra!'
        : `✅ ${data.length} meccs sikeresen beolvasva (utolsó 14 nap)`,
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown', count: 0 });
  }
});

// GET /api/msport-fixture-raw — fixture oldal nyers HTML-je (fejlesztéshez)
// Megmutatja az oldal HTML struktúráját, hogy a parsert finomíthassuk.
app.get('/api/msport-fixture-raw', async (_req, res) => {
  try {
    const axios_ = await import('axios');
    const { default: axios } = axios_;
    const resp = await axios.get('https://www.msport.com/gh/web/my_matches/fixture?tab=sr:sport:137', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.msport.com/',
      },
      timeout: 15_000,
      responseType: 'text',
    });
    const html = resp.data as string;
    res.json({
      status: resp.status,
      contentType: resp.headers['content-type'],
      htmlLength: html.length,
      // Az első 8000 karakter — elegendő a struktúra megértéséhez
      preview: html.slice(0, 8000),
      // Keresünk "vs" szövegre a HTML-ben — megmutatja van-e meccs adat
      vsOccurrences: (html.match(/ vs /gi) || []).length,
      // Zárójelek száma — játékosneveket jelöl
      parenOccurrences: (html.match(/\([A-Z][a-z]+\)/g) || []).length,
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/msport-cookie — aktuális cookie státusz
app.get('/api/msport-cookie', (_req, res) => {
  res.json(getMsportCookieStatus());
});

// GET /api/debug-schedule — megmutatja mit lát a szerver a schedule-ból
app.get('/api/debug-schedule', async (_req, res) => {
  try {
    const schedule = await getCombinedSchedule();
    const byLeague: Record<string, number> = {};
    for (const m of schedule) { byLeague[m.league] = (byLeague[m.league] || 0) + 1; }
    res.json({
      total: schedule.length,
      byLeague,
      eAdriaticSample: schedule.filter(m => m.league === 'eAdriatic League').slice(0, 5),
      gtSample: schedule.filter(m => m.league === 'GT Leagues').slice(0, 5),
      msportOdds: await getMsportOdds(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/live-scores — élő meccsek gólállása + menetideje
// Forrás 1: Altenar/vegas.hu    → GT Leagues
// Forrás 2: msport detail API   → eAdriatic League (+ GT fallback)
// Forrás prioritás: Altenar (GT) > msport > Cloudbet Feed API (GT+ADR) > Cloudbet Web
// Live-scores 8s TTL cache — kliens 10s pollol, multi-user dedupot ad.
// In-flight Promise tárolása: cache miss esetén több párhuzamos kérés
// csak EGY fan-out-ot indít, a többi ugyanarra a Promise-ra vár.
let _liveScoresCache: { ts: number; data: any[] } | null = null;
let _liveScoresInflight: Promise<any[]> | null = null;
const LIVE_SCORES_TTL_MS = 8_000;

app.get('/api/live-scores', async (_req, res) => {
  const now = Date.now();
  if (_liveScoresCache && (now - _liveScoresCache.ts) < LIVE_SCORES_TTL_MS) {
    return res.json(_liveScoresCache.data);
  }
  if (_liveScoresInflight) {
    try { return res.json(await _liveScoresInflight); }
    catch { return res.json([]); }
  }
  _liveScoresInflight = (async () => {
    // 1. Altenar live scores (GT Leagues) — startDate alapú perc (sc mező megbízhatatlan)
    const altenarScores = await getAllLiveScores().catch(() => []);

    // 2. msport live scores — csak az éppen futó meccsekre
    const now = Date.now();
    const MAX_MATCH_MS = 15 * 60 * 1000;
    const liveEventIds = Array.from(dailyMatchMap.values())
      .filter(m => { const e = now - m.startTime; return e >= 0 && e <= MAX_MATCH_MS; })
      .map(m => m.eventId);
    const msportScores = liveEventIds.length > 0
      ? await getMsportLiveScores(liveEventIds).catch(() => [])
      : [];

    // 3. Cloudbet Feed API live scores (GT + eAdriatic, API kulccsal)
    //    TRADING_LIVE státuszú meccseket adja vissza.
    //    Ha a Feed API nem adja a score-t (scoreKnown=false), egyedi web API lekérésből pótoljuk.
    const cbApiLive = await getCloudbetApiLiveScores().catch(() => []);

    // Gazdagítás: minden scoreKnown=false eseménynél próbálunk valódi gólokat lekérni
    const cbApiEnriched = await Promise.all(cbApiLive.map(async s => {
      if (s.scoreKnown && (s.scoreA > 0 || s.scoreB > 0)) return s;
      // Egyedi event lekérése a Cloudbet web belső API-ból (metadata.score tartalmazza a gólokat)
      const webEv = await fetchSingleEvent(s.eventId).catch(() => null);
      if (webEv && webEv.homeScore !== undefined) {
        return { ...s, scoreA: webEv.homeScore, scoreB: webEv.awayScore ?? 0, scoreKnown: true };
      }
      return s;
    }));

    const cbApiConverted = cbApiEnriched.map(s => ({
      playerA: s.playerA, playerB: s.playerB,
      teamA: s.teamA, teamB: s.teamB,
      scoreA: s.scoreA, scoreB: s.scoreB,
      matchTime: `${s.minute}'`,
      minute: s.minute,
      periodName: s.periodName,
      isLive: true,
      league: s.league,
      source: 'cloudbet-api',
    }));

    // 4. Cloudbet Web belső API — egyedi event lekérések (metadata.score = valódi gólok)
    //    Elsősorban ADR meccsekhez, ahol a többi forrás 0:0-t ad
    const cbWebRaw = await getCloudbetWebLiveScores().catch(() => []);
    const cbWebConverted = cbWebRaw.map(s => {
      const elapsedSec = s.matchTimeSeconds > 0 ? s.matchTimeSeconds
        : Math.max(0, Math.floor((Date.now() - new Date(s.updatedAt).getTime()) / 1000));
      const minute = Math.min(Math.floor(elapsedSec / 60), 12);
      return {
        playerA: s.homeTeam,
        playerB: s.awayTeam,
        teamA: s.homeTeam,
        teamB: s.awayTeam,
        scoreA: s.homeScore,
        scoreB: s.awayScore,
        matchTime: `${minute}'`,
        minute,
        periodName: elapsedSec <= 360 ? '1. félidő' : '2. félidő',
        isLive: true,
        league: s.league,
        source: 'cloudbet-web',
      };
    });

    // Összefűzés — Altenar > msport > Cloudbet Feed API > Cloudbet Web (deduplikálás)
    const lkey = (s: { playerA: string; playerB: string }) =>
      `${s.playerA.toLowerCase()}|${s.playerB.toLowerCase()}`;

    const altenarKeys = new Set(altenarScores.map(lkey));
    const msportOnly = msportScores.filter(s => !altenarKeys.has(lkey(s)));
    const existingKeys = new Set([...altenarScores.map(lkey), ...msportOnly.map(lkey)]);
    const cbApiOnly = cbApiConverted.filter(s => !existingKeys.has(lkey(s)));
    const cbApiKeys = new Set([...existingKeys, ...cbApiOnly.map(lkey)]);

    // cbWebConverted: ha van score (homeScore > 0 VAGY kiderítettük hogy 0:0 valóban az),
    // felülírjuk a cbApi 0:0-s bejegyzéseit, mert a Web API pontosabb gólokat ad
    const cbWebOnly: typeof cbWebConverted = [];
    for (const ws of cbWebConverted) {
      const k = lkey(ws);
      if (!altenarKeys.has(k) && !new Set(msportOnly.map(lkey)).has(k)) {
        // Ha a cbApi már tartalmazza DE 0:0 a score és a cbWeb nem 0:0, cseréljük
        const cbApiEntry = cbApiOnly.find(a => lkey(a) === k);
        if (cbApiEntry) {
          if (cbApiEntry.scoreA === 0 && cbApiEntry.scoreB === 0 &&
              (ws.scoreA > 0 || ws.scoreB > 0)) {
            // Felülírjuk a cbApi bejegyzést a valódi gólokkal
            cbApiEntry.scoreA = ws.scoreA;
            cbApiEntry.scoreB = ws.scoreB;
          }
        } else if (!cbApiKeys.has(k)) {
          cbWebOnly.push(ws);
        }
      }
    }

    console.log(`[live-scores] altenar:${altenarScores.length} msport:${msportOnly.length} cbApi:${cbApiOnly.length} cbWeb:${cbWebOnly.length}`);

    return [...altenarScores, ...msportOnly, ...cbApiOnly, ...cbWebOnly];
  })();

  try {
    const data = await _liveScoresInflight;
    _liveScoresCache = { ts: Date.now(), data };
    res.json(data);
  } catch {
    res.json([]);
  } finally {
    _liveScoresInflight = null;
  }
});

// GET /api/debug-live — nyers Altenar live mezők (fejlesztéshez)
app.get('/api/debug-live', async (_req, res) => {
  try {
    const raw = await getRawLiveDebug();
    res.json(raw);
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/debug-cloudbet-web — nyers Cloudbet Web events (fejlesztéshez)
app.get('/api/debug-cloudbet-web', async (_req, res) => {
  try {
    const data = await getCloudbetWebDebugEvents();
    res.json(data);
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// Test scraper connectivity
app.get('/api/test-scrape', async (_req, res) => {
  try {
    const r = await fetch('https://esoccerbet.org/schedule/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const html = await r.text();
    res.json({ status: r.status, htmlLength: html.length, first100: html.substring(0, 100) });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown', stack: e instanceof Error ? e.stack : '' });
  }
});

const cache = new Map<string, { data: unknown; ts: number }>();
const cacheInFlight = new Map<string, Promise<unknown>>();
const CACHE_TTL        = 3 * 60 * 1000;  // 3 perc — játékos stats, H2H, stb.
const SCHEDULE_CACHE_TTL = 30_000;        // 30 mp — meccsrend (msport comingSoons gyorsan változik)

function cached<T>(key: string, fn: () => Promise<T>, ttl: number = CACHE_TTL): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) {
    return Promise.resolve(entry.data as T);
  }
  // In-flight deduplication: párhuzamos hívások ne fussák le kétszer
  const inflight = cacheInFlight.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = fn()
    .then(data => {
      cache.set(key, { data, ts: Date.now() });
      cacheInFlight.delete(key);
      return data;
    })
    .catch(e => {
      cacheInFlight.delete(key);
      throw e;
    });
  cacheInFlight.set(key, promise);
  return promise;
}

app.get('/api/player/:name', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`player:${req.params.name}:${league}`, () =>
      scrapePlayerStats(req.params.name, league)
    );
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`rankings:${league}`, () => scrapeRankings(league));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/best-players', async (_req, res) => {
  try {
    const data = await cached('best-players', scrapeBestPlayers);
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/schedule', async (req, res) => {
  try {
    const league = req.query.league as string | undefined;
    let data = await cached('schedule', getCombinedSchedule, SCHEDULE_CACHE_TTL);
    if (league) data = data.filter(m => m.league === league);
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/lookup/:playerA/:playerB', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const tcMatchId = req.query.tcMatchId as string | undefined;

    const [a, b] = await Promise.all([
      cached(`player:${req.params.playerA}:${league}`, () =>
        scrapePlayerStats(req.params.playerA, league)
      ),
      cached(`player:${req.params.playerB}:${league}`, () =>
        scrapePlayerStats(req.params.playerB, league)
      ),
    ]);

    // H2H from esoccerbet last matches (with goal stats)
    const h2hFromA = a.lastMatches.filter(m => m.opponent.toLowerCase() === req.params.playerB.toLowerCase());
    const h2hFromB = b.lastMatches.filter(m => m.opponent.toLowerCase() === req.params.playerA.toLowerCase());
    let h2hWinsA = h2hFromA.filter(m => m.result === 'win').length + h2hFromB.filter(m => m.result === 'loss').length;
    let h2hWinsB = h2hFromA.filter(m => m.result === 'loss').length + h2hFromB.filter(m => m.result === 'win').length;
    let h2hDraws = h2hFromA.filter(m => m.result === 'draw').length + h2hFromB.filter(m => m.result === 'draw').length;
    let h2hTotal = h2hFromA.length + h2hFromB.length;

    // Calculate H2H goal averages from last matches
    let h2hAvgGoalsA: number | undefined;
    let h2hAvgGoalsB: number | undefined;
    let h2hAvgTotalGoals: number | undefined;
    let h2hOverRates: Record<string, number> | undefined;
    let h2hSource = 'esoccerbet';

    if (h2hTotal > 0) {
      let totalGoalsA = 0, totalGoalsB = 0;
      const totalGoalsList: number[] = [];
      // From A's perspective: scoreHome = A goals, scoreAway = B goals
      for (const m of h2hFromA) {
        totalGoalsA += m.scoreHome;
        totalGoalsB += m.scoreAway;
        totalGoalsList.push(m.scoreHome + m.scoreAway);
      }
      // From B's perspective: scoreHome = B goals, scoreAway = A goals (flip)
      for (const m of h2hFromB) {
        totalGoalsA += m.scoreAway;
        totalGoalsB += m.scoreHome;
        totalGoalsList.push(m.scoreHome + m.scoreAway);
      }
      h2hAvgGoalsA = totalGoalsA / h2hTotal;
      h2hAvgGoalsB = totalGoalsB / h2hTotal;
      h2hAvgTotalGoals = totalGoalsList.reduce((a, b) => a + b, 0) / h2hTotal;
      const rates: Record<string, number> = {};
      for (const line of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]) {
        rates[String(line)] = totalGoalsList.filter(g => g > line).length / h2hTotal;
      }
      h2hOverRates = rates;
    }

    // Try to get richer H2H data from totalcorner if matchId provided
    if (tcMatchId) {
      try {
        const tcH2H = await cached(`tc:h2h:${tcMatchId}`, () =>
          scrapeTCH2H(tcMatchId, req.params.playerA, req.params.playerB)
        );
        if (tcH2H.length > 0) {
          const agg = aggregateH2H(tcH2H, req.params.playerA, req.params.playerB);
          h2hWinsA = agg.winsA;
          h2hWinsB = agg.winsB;
          h2hDraws = agg.draws;
          h2hTotal = agg.total;
          h2hAvgGoalsA = agg.avgGoalsA;
          h2hAvgGoalsB = agg.avgGoalsB;
          h2hAvgTotalGoals = agg.avgTotalGoals;
          h2hOverRates = agg.overRates;
          h2hSource = 'totalcorner';
        }
      } catch {
        // ignore, use esoccerbet fallback
      }
    }

    const h2hRatioA = h2hTotal > 0 ? (h2hWinsA + h2hDraws * 0.5) / h2hTotal : 0.5;
    const h2hRatioB = h2hTotal > 0 ? 1 - h2hRatioA : 0.5;

    const formToWinRate = (p: PlayerStats) => {
      if (p.winRate > 0) return p.winRate;
      if (p.matches > 0) return p.wins / p.matches;
      return 0.5;
    };

    const forma = (p: PlayerStats) => {
      const base = formToWinRate(p);
      return Math.max(0, Math.min(1, base + p.form10));
    };

    res.json({
      playerA: {
        name: a.name, winRate: formToWinRate(a), gf: a.gfPerMatch, ga: a.gaPerMatch,
        forma: forma(a), matches: a.matches, form10: a.form10, form50: a.form50,
        bttsYes: a.bttsYes, ouStats: a.ouStats,
      },
      playerB: {
        name: b.name, winRate: formToWinRate(b), gf: b.gfPerMatch, ga: b.gaPerMatch,
        forma: forma(b), matches: b.matches, form10: b.form10, form50: b.form50,
        bttsYes: b.bttsYes, ouStats: b.ouStats,
      },
      h2h: {
        h2hWinsA, h2hWinsB, h2hDraws, h2hTotal, h2hRatioA, h2hRatioB,
        h2hAvgGoalsA, h2hAvgGoalsB, h2hAvgTotalGoals, h2hOverRates,
        h2hSource,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/h2h/:playerA/:playerB - detailed H2H match history
app.get('/api/h2h/:playerA/:playerB', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const [a, b] = await Promise.all([
      cached(`player:${req.params.playerA}:${league}`, () =>
        scrapePlayerStats(req.params.playerA, league)
      ),
      cached(`player:${req.params.playerB}:${league}`, () =>
        scrapePlayerStats(req.params.playerB, league)
      ),
    ]);

    // Collect H2H matches from both sides (dedupe by date)
    const seen = new Set<string>();
    const h2hMatches: Array<{
      date: string;
      playerA: string; teamA: string;
      playerB: string; teamB: string;
      scoreA: number; scoreB: number;
      winner: 'A' | 'B' | 'draw';
    }> = [];

    // From A's lastMatches: opponent is B
    for (const m of a.lastMatches) {
      if (m.opponent.toLowerCase() !== req.params.playerB.toLowerCase()) continue;
      const key = `${m.date}|${m.scoreHome}-${m.scoreAway}`;
      if (seen.has(key)) continue;
      seen.add(key);
      h2hMatches.push({
        date: m.date,
        playerA: req.params.playerA,
        teamA: m.team,
        playerB: req.params.playerB,
        teamB: m.opponentTeam,
        scoreA: m.scoreHome,
        scoreB: m.scoreAway,
        winner: m.scoreHome > m.scoreAway ? 'A' : m.scoreHome < m.scoreAway ? 'B' : 'draw',
      });
    }

    // From B's lastMatches: opponent is A, flip scores
    for (const m of b.lastMatches) {
      if (m.opponent.toLowerCase() !== req.params.playerA.toLowerCase()) continue;
      const key = `${m.date}|${m.scoreAway}-${m.scoreHome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      h2hMatches.push({
        date: m.date,
        playerA: req.params.playerA,
        teamA: m.opponentTeam,
        playerB: req.params.playerB,
        teamB: m.team,
        scoreA: m.scoreAway,
        scoreB: m.scoreHome,
        winner: m.scoreAway > m.scoreHome ? 'A' : m.scoreAway < m.scoreHome ? 'B' : 'draw',
      });
    }

    // Sort by date (most recent first - they come in that order already)
    const total = h2hMatches.length;
    const winsA = h2hMatches.filter(m => m.winner === 'A').length;
    const winsB = h2hMatches.filter(m => m.winner === 'B').length;
    const draws = h2hMatches.filter(m => m.winner === 'draw').length;
    const avgGoalsA = total > 0 ? h2hMatches.reduce((s, m) => s + m.scoreA, 0) / total : 0;
    const avgGoalsB = total > 0 ? h2hMatches.reduce((s, m) => s + m.scoreB, 0) / total : 0;
    const avgTotalGoals = avgGoalsA + avgGoalsB;

    res.json({
      total, winsA, winsB, draws,
      avgGoalsA, avgGoalsB, avgTotalGoals,
      matches: h2hMatches,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/check-result/:player - check last match result for auto-tracking
app.get('/api/check-result/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const results = await cached(`results:${req.params.player}:${league}`, () =>
      scrapePlayerResults(req.params.player, league)
    );
    res.json(results.slice(0, 5));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/profile/:name - full player profile with breakdowns
app.get('/api/profile/:name', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const stats = await cached(`player:${req.params.name}:${league}`, () =>
      scrapePlayerStats(req.params.name, league)
    );

    // Team breakdown
    const teamStats: Record<string, { wins: number; losses: number; draws: number; gf: number; ga: number; matches: number }> = {};
    for (const m of stats.lastMatches) {
      if (!teamStats[m.team]) teamStats[m.team] = { wins: 0, losses: 0, draws: 0, gf: 0, ga: 0, matches: 0 };
      const t = teamStats[m.team];
      t.matches++;
      t.gf += m.scoreHome;
      t.ga += m.scoreAway;
      if (m.result === 'win') t.wins++;
      else if (m.result === 'loss') t.losses++;
      else t.draws++;
    }

    // Opponent breakdown
    const opponentStats: Record<string, { wins: number; losses: number; draws: number; gf: number; ga: number; matches: number }> = {};
    for (const m of stats.lastMatches) {
      const opp = m.opponent;
      if (!opponentStats[opp]) opponentStats[opp] = { wins: 0, losses: 0, draws: 0, gf: 0, ga: 0, matches: 0 };
      const o = opponentStats[opp];
      o.matches++;
      o.gf += m.scoreHome;
      o.ga += m.scoreAway;
      if (m.result === 'win') o.wins++;
      else if (m.result === 'loss') o.losses++;
      else o.draws++;
    }

    // Form curve: rolling win rate over last matches
    const formCurve = stats.lastMatches.map((m, i) => {
      const slice = stats.lastMatches.slice(0, i + 1);
      const wr = slice.filter(s => s.result === 'win').length / slice.length;
      return { idx: i + 1, winRate: Math.round(wr * 100), date: m.date, opponent: m.opponent, result: m.result };
    });

    // Best/worst team
    const teamEntries = Object.entries(teamStats).filter(([, v]) => v.matches >= 2);
    const bestTeam = teamEntries.sort((a, b) => (b[1].wins / b[1].matches) - (a[1].wins / a[1].matches))[0];
    const worstTeam = teamEntries.sort((a, b) => (a[1].wins / a[1].matches) - (b[1].wins / b[1].matches))[0];

    // Toughest/easiest opponent
    const oppEntries = Object.entries(opponentStats).filter(([, v]) => v.matches >= 2);
    const easiestOpp = oppEntries.sort((a, b) => (b[1].wins / b[1].matches) - (a[1].wins / a[1].matches))[0];
    const toughestOpp = oppEntries.sort((a, b) => (a[1].wins / a[1].matches) - (b[1].wins / b[1].matches))[0];

    // Time performance analysis
    const timePerf = analyzeTimePerformance(stats.lastMatches);
    const timeInsights = getTimeSummary(timePerf);

    res.json({
      ...stats,
      teamStats,
      opponentStats,
      formCurve,
      timeInsights,
      timePeriods: timePerf.byPeriod,
      insights: {
        bestTeam: bestTeam ? { name: bestTeam[0], ...bestTeam[1] } : null,
        worstTeam: worstTeam ? { name: worstTeam[0], ...worstTeam[1] } : null,
        easiestOpponent: easiestOpp ? { name: easiestOpp[0], ...easiestOpp[1] } : null,
        toughestOpponent: toughestOpp ? { name: toughestOpp[0], ...toughestOpp[1] } : null,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// POST /api/auto-check - check multiple matches for results
app.post('/api/auto-check', async (req, res) => {
  try {
    const { matches } = req.body as { matches: { playerA: string; playerB: string; league: string; timestamp: number }[] };
    const results = await Promise.all(
      matches.map(async (m) => {
        try {
          const playerResults = await cached(`results:${m.playerA}:${m.league}`, () =>
            scrapePlayerResults(m.playerA, m.league)
          );
          // Find a match vs playerB after the bet timestamp
          const found = playerResults.find(r =>
            r.opponent.toLowerCase() === m.playerB.toLowerCase()
          );
          if (found) {
            return { ...m, outcome: found.result, score: `${found.scoreHome}-${found.scoreAway}` };
          }
          return { ...m, outcome: 'pending' as const };
        } catch {
          return { ...m, outcome: 'pending' as const };
        }
      })
    );
    res.json(results);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/top-tips?league=...&limit=5 - auto-scan schedule and return best value bets
// ── Response cache: 60 másodpercig újrahasználja az előző scan eredményét ──────
const _topTipsCache = new Map<string, { data: any; ts: number }>();
const TOP_TIPS_CACHE_TTL = 60_000; // 60 másodperc
const _topTipsInFlight = new Map<string, Promise<any>>();

app.get('/api/top-tips', async (req, res) => {
  // Scope-on kívül deklarálva, hogy a catch block is elérhesse
  const leagueFilter = req.query.league as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
  const strategyId = (req.query.strategy as string)?.toUpperCase() || 'A';
  const selectedStrategy = STRATEGIES[strategyId] || STRATEGIES.A;
  const minConf = parseFloat(req.query.minConf as string) || (selectedStrategy.betConf ?? 0.55);
  const preferOdds2 = (['msport', 'cloudbet', 'vegas'].includes(req.query.preferOdds as string)
    ? req.query.preferOdds as string : 'msport') as string;
  const cacheKey = `${strategyId}|${leagueFilter ?? ''}|${limit}|${preferOdds2}`;
  let _resolveInFlight: ((v: any) => void) | null = null;

  try {
    // Cache hit → azonnali válasz, nincs scan
    const cached60 = _topTipsCache.get(cacheKey);
    if (cached60 && Date.now() - cached60.ts < TOP_TIPS_CACHE_TTL) {
      res.json(cached60.data);
      return;
    }
    // In-flight → várjuk meg a már futó scant (ne indítsunk párhuzamos scant)
    if (_topTipsInFlight.has(cacheKey)) {
      const result = await _topTipsInFlight.get(cacheKey)!;
      res.json(result);
      return;
    }

    // Regisztráljuk hogy fut a scan (a végén töröljük + cache-eljük)
    const inFlightPromise = new Promise<any>(resolve => { _resolveInFlight = resolve; });
    _topTipsInFlight.set(cacheKey, inFlightPromise);
    const minEdge = parseFloat(req.query.minEdge as string) || (selectedStrategy.betEdge ?? 0.02);
    // Preferált odds forrás — felhasználó választja a UI-ban
    const preferOdds = (['msport', 'cloudbet', 'vegas'].includes(req.query.preferOdds as string)
      ? req.query.preferOdds as string
      : 'msport') as 'msport' | 'cloudbet' | 'vegas';

    console.log(`\n🎯 Strategy: ${selectedStrategy.name} (${selectedStrategy.id})`);
    console.log(`   Settings: WR=${selectedStrategy.settings.winRateSuly}, Forma=${selectedStrategy.settings.formaSuly}, H2H=${selectedStrategy.settings.h2hSuly}`);
    // 1. Get schedule (+ keep GT Leagues cards visible 3 min after start)
    let schedule = await cached('schedule', getCombinedSchedule, SCHEDULE_CACHE_TTL);
    updateStickyBuffer(schedule);
    schedule = applySticky(schedule);
    if (leagueFilter) schedule = schedule.filter(m => m.league === leagueFilter);

    // 1b. Load totalcorner fixtures for matchId lookup (per league)
    const esbToTcLeague: Record<string, string> = {
      'Esoccer Battle': 'Esoccer Battle',
      'eAdriatic League': 'Esoccer Adriatic League',
      'GT Leagues': 'GT Leagues',   // TC ugyanilyen névvel ismeri (id=12985)
    };
    const tcFixturesByLeague = new Map<string, Map<string, string>>();
    // Map: ESB league -> "playerA|playerB" (both directions) -> matchId
    const esbLeaguesToLoad = Array.from(new Set(
      schedule.map(s => s.league).filter(l => l in esbToTcLeague)
    ));
    await Promise.allSettled(
      esbLeaguesToLoad.map(async (esbLg) => {
        const tcLg = esbToTcLeague[esbLg];
        try {
          const tcData = await cached(`tc:league:${tcLg}`, () => scrapeTCLeague(tcLg));
          const m = new Map<string, string>();
          for (const f of tcData.fixtures) {
            if (!f.matchId || !f.playerHome || !f.playerAway) continue;
            const k1 = `${f.playerHome.toLowerCase()}|${f.playerAway.toLowerCase()}`;
            const k2 = `${f.playerAway.toLowerCase()}|${f.playerHome.toLowerCase()}`;
            m.set(k1, f.matchId);
            m.set(k2, f.matchId);
          }
          tcFixturesByLeague.set(esbLg, m);
        } catch {
          // ignore - TC is optional enrichment
        }
      })
    );

    // 2. Analyze each match (parallel, batched to avoid overload)
    const batchSize = 6;
    const allResults: {
      time: string; date: string; league: string;
      playerA: string; teamA: string; playerB: string; teamB: string;
      valueBet: string; confidence: number; edge: number; stake: number;
      winEselyA: number; winEselyB: number;
      overEsely: number; underEsely: number;
      vartGol: number; ouLine: number;
      ajanlottTipp: string;
      h2hMode: boolean;
      h2hTotal: number;
      h2hWinsA: number;
      h2hWinsB: number;
      h2hSource: string;
      tcMatchId?: string;
      oddsSource: string;
      oddsDiff?: number;
      oddsA: number;
      oddsB: number;
      oddsOver: number;
      oddsUnder: number;
      category: 'STRONG_BET' | 'BET' | 'NO_BET';
      warning?: string | null;
      h2hOverRates?: Record<string, number>;
      h2hEffectiveSize?: number;
      movement1x2?: { home?: string; draw?: string; away?: string; homeChange?: number; awayChange?: number };
      movementGoals?: { over?: string; under?: string; overChange?: number; underChange?: number };
    }[] = [];

    for (let i = 0; i < schedule.length; i += batchSize) {
      const batch = schedule.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const [a, b] = await Promise.all([
            cached(`player:${entry.playerHome}:${entry.league}`, () =>
              getPlayerStats(entry.playerHome, entry.league)
            ),
            cached(`player:${entry.playerAway}:${entry.league}`, () =>
              getPlayerStats(entry.playerAway, entry.league)
            ),
          ]);

          const formToWinRate = (p: PlayerStats) => p.winRate > 0 ? p.winRate : (p.matches > 0 ? p.wins / p.matches : 0.5);
          const forma = (p: PlayerStats) => Math.max(0, Math.min(1, formToWinRate(p) + p.form10));

          // === H2H FORRÁS: Supabase completed_matches (elsődleges) ===
          // Ha a Supabase-ben van elég adat → azt használjuk, scraper nem fut
          // Ha nincs (új pár, vagy régi adat) → scraper fallback

          const isMsportLeague = entry.league === 'GT Leagues' || entry.league === 'eAdriatic League';

          // 1. Supabase H2H lekérés — 10 perces cache (Supabase egress csökkentés)
          const supabaseH2H = await cached(
            `sbh2h:${entry.playerHome}:${entry.playerAway}:${entry.league}`,
            () => getH2HFromSupabase(entry.playerHome, entry.playerAway, entry.league, 40),
            10 * 60_000,
          );
          const hasSupabaseH2H = supabaseH2H.length >= 2;

          // H2H meccs-lista a kártyán való megjelenítéshez
          let h2hMatchHistory: Array<{date: string; goalsA: number; goalsB: number; winner: 'A'|'B'|'draw'}>;
          let primaryH2H: NormalizedH2H[];
          let secondaryH2H: NormalizedH2H[] = [];
          // Ezeket az if/else ELŐTT deklaráljuk, hogy az else blokkon kívül is elérhetők legyenek
          let esbH2H: NormalizedH2H[] = [];
          let tcH2H: NormalizedH2H[] = [];
          let msportNormH2H: NormalizedH2H[] = [];

          if (hasSupabaseH2H) {
            // ── Supabase elsődleges ──────────────────────────────────────────
            h2hMatchHistory = supabaseH2H.slice(0, 20).map(m => ({
              date: m.date, goalsA: m.goalsA, goalsB: m.goalsB, winner: m.winner,
            }));
            primaryH2H = supabaseH2H.map(m => ({
              date: m.date, goalsA: m.goalsA, goalsB: m.goalsB, source: 'supabase' as any,
            }));
          } else {
            // ── Scraper fallback (ha Supabase üres/kevés) ────────────────────
            // msport H2H (GT + eAdriatic)
            let msportH2HResult: Awaited<ReturnType<typeof getMsportH2H>> | null = null;
            if (isMsportLeague) {
              try {
                msportH2HResult = await getMsportH2H(entry.playerHome, entry.playerAway, entry.league);
              } catch { /* silent */ }
            }

            esbH2H = [];
            const h2hFromA = a.lastMatches.filter(m => m.opponent.toLowerCase() === entry.playerAway.toLowerCase());
            const h2hFromB = b.lastMatches.filter(m => m.opponent.toLowerCase() === entry.playerHome.toLowerCase());
            if (!isMsportLeague) {
              for (const m of h2hFromA) esbH2H.push({ date: m.date, goalsA: m.scoreHome, goalsB: m.scoreAway, source: 'esoccerbet' });
              for (const m of h2hFromB) esbH2H.push({ date: m.date, goalsA: m.scoreAway, goalsB: m.scoreHome, source: 'esoccerbet' });
            }

            // TotalCorner H2H (a tcMatchId az else blokkon belül is meghatározható)
            const fixtureMapH2H = tcFixturesByLeague.get(entry.league);
            const tcMatchIdH2H = fixtureMapH2H?.get(`${entry.playerHome.toLowerCase()}|${entry.playerAway.toLowerCase()}`);
            tcH2H = [];
            if (tcMatchIdH2H) {
              try {
                const tcRaw = await cached(`tc:h2h:${tcMatchIdH2H}`, () =>
                  scrapeTCH2H(tcMatchIdH2H, entry.playerHome, entry.playerAway)
                );
                tcH2H = normalizeTCH2H(tcRaw, entry.playerHome);
              } catch { /* ignore */ }
            }

            msportNormH2H = (msportH2HResult?.matches ?? []).map(m => ({
              date: m.date, goalsA: m.scoreA, goalsB: m.scoreB, source: 'msport' as any,
            }));

            // Megjelenítési lista — scraper alapján
            if (isMsportLeague && (msportH2HResult?.matches.length ?? 0) > 0) {
              h2hMatchHistory = msportH2HResult!.matches.map(m => ({
                date: m.date, goalsA: m.scoreA, goalsB: m.scoreB,
                winner: (m.resultA === 'win' ? 'A' : m.resultA === 'loss' ? 'B' : 'draw') as 'A'|'B'|'draw',
              }));
            } else if (tcH2H.length > 0) {
              h2hMatchHistory = tcH2H.slice(0, 10).map(m => ({
                date: m.date, goalsA: m.goalsA, goalsB: m.goalsB,
                winner: (m.goalsA > m.goalsB ? 'A' : m.goalsA < m.goalsB ? 'B' : 'draw') as 'A'|'B'|'draw',
              }));
            } else {
              const seen = new Set<string>();
              const raw: typeof h2hMatchHistory = [];
              for (const m of h2hFromA) {
                const k = `${m.date}|${m.scoreHome}-${m.scoreAway}`;
                if (!seen.has(k)) { seen.add(k); raw.push({ date: m.date, goalsA: m.scoreHome, goalsB: m.scoreAway, winner: m.scoreHome > m.scoreAway ? 'A' : m.scoreHome < m.scoreAway ? 'B' : 'draw' }); }
              }
              for (const m of h2hFromB) {
                const k = `${m.date}|${m.scoreAway}-${m.scoreHome}`;
                if (!seen.has(k)) { seen.add(k); raw.push({ date: m.date, goalsA: m.scoreAway, goalsB: m.scoreHome, winner: m.scoreAway > m.scoreHome ? 'A' : m.scoreAway < m.scoreHome ? 'B' : 'draw' }); }
              }
              h2hMatchHistory = raw.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 10);
            }

            if (isMsportLeague) {
              primaryH2H  = msportNormH2H.length > 0 ? msportNormH2H : tcH2H;
            } else {
              primaryH2H  = esbH2H;
              secondaryH2H = tcH2H;
            }
          }

          // TotalCorner fixture matchId (odds lekéréshez kell, H2H-tól függetlenül)
          const fixtureMap = tcFixturesByLeague.get(entry.league);
          const tcMatchId = fixtureMap?.get(`${entry.playerHome.toLowerCase()}|${entry.playerAway.toLowerCase()}`);

          // 3. Merge + dedupe, H2H expiry szűrés stratégia szerint
          const h2hExpiryDays = selectedStrategy.h2hExpiryDays ?? 365;
          const mergedH2HRaw = mergeH2HSources(primaryH2H, secondaryH2H);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - h2hExpiryDays);
          const mergedH2H = mergedH2HRaw.filter(m => {
            // m.date: "MM/DD HH:MM" formátum → parse mint idei/tavalyi dátum
            if (!m.date) return true;
            const parts = m.date.split(' ')[0].split('/'); // ["MM", "DD"]
            if (parts.length < 2) return true;
            const now = new Date();
            let year = now.getFullYear();
            const mDate = new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]));
            if (mDate > now) mDate.setFullYear(year - 1); // ha jövőre mutat → tavaly
            return mDate >= cutoff;
          });

          // 4. Weighted aggregation (30-day half-life)
          const agg = aggregateH2HWeighted(mergedH2H, 30);

          const h2hTotal = agg.total;
          const h2hWinsA = agg.winsA;
          const h2hWinsB = agg.winsB;
          const h2hDraws = agg.draws;
          const h2hAvgGoalsA = agg.total > 0 ? agg.avgGoalsA : undefined;
          const h2hAvgGoalsB = agg.total > 0 ? agg.avgGoalsB : undefined;
          const h2hOverRates = agg.total > 0 ? agg.overRates : undefined;
          const h2hEffectiveSize = agg.effectiveSize;
          const h2hSource =
            hasSupabaseH2H ? 'supabase'
              : isMsportLeague && msportNormH2H.length > 0 ? 'msport.com'
                : tcH2H.length > 0 && esbH2H.length > 0 ? 'merged'
                  : tcH2H.length > 0 ? 'totalcorner'
                    : 'esoccerbet';

          const h2hRatioA = h2hTotal > 0 ? (h2hWinsA + h2hDraws * 0.5) / h2hTotal : 0.5;

          const liga = entry.league === 'GT Leagues' ? 'GT Leagues' as const
            : entry.league === 'eAdriatic League' ? 'eAdriaticLeague' as const
              : 'Other' as const;
          const percek = entry.league === 'GT Leagues' ? 12 : entry.league === 'eAdriatic League' ? 10 : (entry.league === 'Esoccer Battle' || entry.league === 'Esoccer H2H GG League') ? 8 : 6; // Esports Volta = 6

          // Try to get real odds, goal line, and movement from totalcorner
          let realOddsA: number | undefined;
          let realOddsB: number | undefined;
          let realOddsOver: number | undefined;
          let realOddsUnder: number | undefined;
          let realOuLine: number | undefined;
          let oddsSource = 'estimated';
          let movement1x2: { home?: string; draw?: string; away?: string; homeChange?: number; awayChange?: number } | undefined;
          let movementGoals: { over?: string; under?: string; overChange?: number; underChange?: number } | undefined;

          if (tcMatchId) {
            try {
              const tcOdds = await cached(`tc:odds:${tcMatchId}`, () =>
                scrapeTCMatchOdds(tcMatchId, entry.playerHome, entry.playerAway)
              );
              if (tcOdds.latest1x2) {
                realOddsA = tcOdds.latest1x2.home;
                realOddsB = tcOdds.latest1x2.away;
                oddsSource = 'bet365';
              }
              if (tcOdds.latestGoals) {
                realOuLine = tcOdds.latestGoals.lineValue;
                realOddsOver = tcOdds.latestGoals.over;
                realOddsUnder = tcOdds.latestGoals.under;
              }
              if (tcOdds.movement1x2) {
                movement1x2 = {
                  home: tcOdds.movement1x2.home?.direction,
                  draw: tcOdds.movement1x2.draw?.direction,
                  away: tcOdds.movement1x2.away?.direction,
                  homeChange: tcOdds.movement1x2.home?.change,
                  awayChange: tcOdds.movement1x2.away?.change,
                };
              }
              if (tcOdds.movementGoals) {
                movementGoals = {
                  over: tcOdds.movementGoals.over?.direction,
                  under: tcOdds.movementGoals.under?.direction,
                  overChange: tcOdds.movementGoals.over?.change,
                  underChange: tcOdds.movementGoals.under?.change,
                };
              }
            } catch {
              // ignore - fallback to estimated
            }
          }

          // ── O/U odds lekérés preferencia-alapú sorrendben (GT + eAdriatic) ──────
          // Vegas 1x2: mindig próbáljuk (TC-fallback 1x2-höz)
          let vegasResult: Awaited<ReturnType<typeof getVegasOdds>> | null = null;
          try { vegasResult = await getVegasOdds(entry.playerHome, entry.playerAway); } catch { /* silent */ }
          if (vegasResult) {
            realOddsA = realOddsA ?? vegasResult.oddsA;
            realOddsB = realOddsB ?? vegasResult.oddsB;
          }

          // VPS entry: beágyazott msport odds (Hetzner-en lekérve, Render-en is elérhető)
          if ((entry as any).oddsSource === 'msport.com' && (entry as any).ouLine > 0) {
            realOuLine    = realOuLine    ?? (entry as any).ouLine;
            realOddsOver  = realOddsOver  ?? (entry as any).oddsOver;
            realOddsUnder = realOddsUnder ?? (entry as any).oddsUnder;
            if (oddsSource === 'estimated') oddsSource = 'msport.com';
          }

          // Preferált O/U odds sorrend: user választja (msport / cloudbet / vegas)
          if (entry.league === 'GT Leagues' || entry.league === 'eAdriatic League') {
            type OddsResult = { ouLine: number; oddsOver: number; oddsUnder: number; source: string } | null;

            const fetchMsport = async (): Promise<OddsResult> => {
              // Ha VPS már beágyazta az msport odds-ot, azt használjuk (Render-en nincs msport-hozzáférés)
              if ((entry as any).oddsSource === 'msport.com' && (entry as any).ouLine > 0) {
                return { ouLine: (entry as any).ouLine, oddsOver: (entry as any).oddsOver, oddsUnder: (entry as any).oddsUnder, source: 'msport.com' };
              }
              try {
                const r = await getMsportOddsForMatch(entry.playerHome, entry.playerAway);
                return r && r.ouLine > 0 ? { ...r, source: 'msport.com' } : null;
              } catch { return null; }
            };
            const fetchCloudbet = async (): Promise<OddsResult> => {
              try {
                if (!getCloudbetKeyStatus().configured) return null;
                const r = await getCloudbetOddsForMatch(entry.playerHome, entry.playerAway);
                return r && r.ouLine > 0 ? { ...r, source: 'cloudbet' } : null;
              } catch { return null; }
            };
            const fetchVegas = async (): Promise<OddsResult> => {
              if (vegasResult && vegasResult.ouLine > 0)
                return { ouLine: vegasResult.ouLine, oddsOver: vegasResult.oddsOver, oddsUnder: vegasResult.oddsUnder, source: 'vegas.hu' };
              return null;
            };

            // Minden forrás párhuzamosan — allOdds (a frontend dönti el melyiket mutatja)
            const [msportFetch, cloudbetFetch, vegasFetch] = await Promise.allSettled([
              fetchMsport(), fetchCloudbet(), fetchVegas(),
            ]);
            const msportR  = msportFetch.status  === 'fulfilled' ? msportFetch.value  : null;
            const cloudbetR = cloudbetFetch.status === 'fulfilled' ? cloudbetFetch.value : null;
            const vegasR   = vegasFetch.status   === 'fulfilled' ? vegasFetch.value   : null;

            // Összes elérhető forrás O/U adatai
            const tipAllOdds: Record<string, { ouLine: number; oddsOver?: number; oddsUnder?: number }> = {};
            if (msportR  && msportR.ouLine  > 0) tipAllOdds['msport.com'] = { ouLine: msportR.ouLine,  oddsOver: msportR.oddsOver  ?? undefined, oddsUnder: msportR.oddsUnder  ?? undefined };
            if (cloudbetR && cloudbetR.ouLine > 0) tipAllOdds['cloudbet']  = { ouLine: cloudbetR.ouLine, oddsOver: cloudbetR.oddsOver ?? undefined, oddsUnder: cloudbetR.oddsUnder ?? undefined };
            if (vegasR   && vegasR.ouLine   > 0) tipAllOdds['vegas.hu']  = { ouLine: vegasR.ouLine,   oddsOver: vegasR.oddsOver   ?? undefined, oddsUnder: vegasR.oddsUnder   ?? undefined };
            (entry as any)._allOdds = tipAllOdds;

            // Elsődleges forrás: preferált sorrend, majd fallback
            const preferredR = preferOdds === 'cloudbet' ? cloudbetR : preferOdds === 'vegas' ? vegasR : msportR;
            const primaryR = preferredR ?? msportR ?? cloudbetR ?? vegasR;
            if (primaryR) {
              realOuLine    = primaryR.ouLine;
              realOddsOver  = primaryR.oddsOver  ?? undefined;
              realOddsUnder = primaryR.oddsUnder ?? undefined;
              oddsSource    = primaryR.source;
            }
            (entry as any)._oddsDiff = (!preferredR && primaryR) ? 0.01 : undefined;
          } else {
            // Nem GT/ADR liga: Vegas O/U elsődleges (TC már lefutott fent)
            if (vegasResult && vegasResult.ouLine > 0) {
              realOuLine    = vegasResult.ouLine;
              realOddsOver  = vegasResult.oddsOver;
              realOddsUnder = vegasResult.oddsUnder;
              oddsSource    = 'vegas.hu';
            }
          }

          // GT + eAdriatic + H2H GG: csak valódi odds értelmes
          // Kivétel: VPS-ről érkező bejegyzések 'estimated'-del is megjelennek
          // (Render datacenter IP-ről odds nem scrape-elhető, de a menetrend hiteles)
          if ((entry.league === 'GT Leagues' || entry.league === 'eAdriatic League' || entry.league === 'Esoccer H2H GG League')
              && oddsSource !== 'vegas.hu' && oddsSource !== 'msport.com' && oddsSource !== 'cloudbet'
              && oddsSource !== 'bet365'
              && !(entry as any)._fromVps) {
            oddsSource = 'n/a';
          }

          // Fallback: estimated odds
          const wrA = formToWinRate(a);
          const wrB = formToWinRate(b);
          const rawWinA = wrA / (wrA + wrB);
          const estimatedOdds = estimateMatchOdds(rawWinA, 1 - rawWinA, 0.55);

          const finalOddsA = realOddsA ?? estimatedOdds.oddsA;
          const finalOddsB = realOddsB ?? estimatedOdds.oddsB;
          const finalOddsOver = realOddsOver ?? estimatedOdds.oddsOver;
          const finalOddsUnder = realOddsUnder ?? estimatedOdds.oddsUnder;

          // Smart O/U line fallback: find line where over rate ≈ 50% from player ouStats
          const fairLine = (ouStats: { line: string; over: number }[]) => {
            if (!ouStats || ouStats.length === 0) return null;
            let best = ouStats[0];
            for (const s of ouStats) {
              if (Math.abs(s.over - 0.5) < Math.abs(best.over - 0.5)) best = s;
            }
            return parseFloat(best.line);
          };
          const lineA = fairLine(a.ouStats);
          const lineB = fairLine(b.ouStats);
          const smartOuLine = lineA && lineB
            ? Math.round((lineA + lineB) / 2 * 2) / 2   // average, rounded to nearest 0.5
            : lineA ?? lineB ?? 3.5;
          const finalOuLine = realOuLine ?? smartOuLine;

          const result = calculateMatch({
            id: `scan-${i}`,
            liga,
            percek,
            piacTipus: liga === 'GT Leagues' ? 'Over/Under' : 'Win',
            playerA: entry.playerHome,
            playerB: entry.playerAway,
            oddsA: finalOddsA,
            oddsB: finalOddsB,
            gfA: a.gfPerMatch, gaA: a.gaPerMatch,
            gfB: b.gfPerMatch, gaB: b.gaPerMatch,
            winRateA: wrA, winRateB: wrB,
            formaA: forma(a), formaB: forma(b),
            h2hA: h2hRatioA, h2hB: 1 - h2hRatioA,
            ouLine: finalOuLine,
            oddsOver: finalOddsOver,
            oddsUnder: finalOddsUnder,
          }, selectedStrategy.settings, {
            h2hWinsA, h2hWinsB, h2hDraws, h2hTotal,
            h2hAvgGoalsA, h2hAvgGoalsB, h2hOverRates,
          });

          // ========== KELLY STAKE CALCULATION ==========
          let stake = result.stakeFt;
          if (selectedStrategy.kellyEnabled) {
            const b = result.kivalasztottOdds - 1;
            const p = result.confidence;
            const q = 1 - p;
            const kellyPercent = (b * p - q) / b;
            if (kellyPercent > 0) {
              stake = Math.min(50000 * kellyPercent * selectedStrategy.settings.kellySzorzo, 5000);
              stake = Math.round(stake);
            }
          }
          // ========== END KELLY ==========

          // ========== STRATEGY C POST-PROCESSING ==========
          let finalConfidence = result.confidence;
          let finalValueBet = result.valueBet;

          if (selectedStrategy.id === 'C') {
            const today = todayMMDD();

            // 1. Fáradsági szűrő: ha valamelyik játékos maxMatchesToday+ meccset játszott ma → kizárás
            if (selectedStrategy.fatiguePenalty && selectedStrategy.maxMatchesToday !== undefined) {
              const matchesTodayA = a.lastMatches.filter(m => m.date.startsWith(today)).length;
              const matchesTodayB = b.lastMatches.filter(m => m.date.startsWith(today)).length;
              if (matchesTodayA >= selectedStrategy.maxMatchesToday || matchesTodayB >= selectedStrategy.maxMatchesToday) {
                finalValueBet = 'PASS'; // kizárás
              } else if (matchesTodayA >= 2 || matchesTodayB >= 2) {
                // 2+ meccs ma → konfidencia -7%
                finalConfidence = finalConfidence * 0.93;
              }
            }

            // 2. Forma-trend adjusztáció: form10 vs form50 alapján
            if (selectedStrategy.formTrendBonus && finalValueBet !== 'PASS') {
              // Melyik játékos a favorit (nagyobb winEsely)
              const favoritIsA = result.winEselyA >= result.winEselyB;
              const formTrendFav = favoritIsA ? (a.form10 - a.form50) : (b.form10 - b.form50);
              const formTrendUnder = favoritIsA ? (b.form10 - b.form50) : (a.form10 - a.form50);
              if (formTrendFav < -0.05) {
                // Favorit hanyatlik → konfidencia -8%
                finalConfidence = finalConfidence * 0.92;
              } else if (formTrendFav > 0.05 && formTrendUnder <= 0) {
                // Favorit javul, ellenfél stagnál/romlik → kis bónusz +3%
                finalConfidence = Math.min(0.95, finalConfidence * 1.03);
              }
            }

            // 3. Gól-vonal delta szűrő: várható gól nem elég messze a vonaltól → O/U PASS
            if (selectedStrategy.goalLineDeltaMin !== undefined && finalValueBet !== 'PASS') {
              const isOUBet = finalValueBet === 'OVER' || finalValueBet === 'UNDER';
              if (isOUBet && Math.abs(result.vartOsszesGol - finalOuLine) < selectedStrategy.goalLineDeltaMin) {
                finalValueBet = 'PASS'; // túl bizonytalan
              }
            }

            // 4. H2H kötelező szűrő
            if (selectedStrategy.requireH2H && h2hTotal < (selectedStrategy.minH2HMatches ?? 8)) {
              finalValueBet = 'PASS';
            }
          }
          // ========== END STRATEGY C ==========

          return {
            time: entry.time, date: entry.date, league: entry.league,
            playerA: entry.playerHome, teamA: entry.teamHome,
            playerB: entry.playerAway, teamB: entry.teamAway,
            valueBet: finalValueBet,
            confidence: finalConfidence,
            edge: result.kivalasztottEdge,
            stake: stake,
            winEselyA: result.winEselyA,
            winEselyB: result.winEselyB,
            overEsely: result.overEsely,
            underEsely: result.underEsely,
            vartGol: result.vartOsszesGol,
            ouLine: finalOuLine,
            ajanlottTipp: result.ajanlottTipp,
            h2hMode: result.h2hMode || false,
            h2hTotal: h2hTotal,
            h2hWinsA, h2hWinsB,
            h2hSource,
            tcMatchId: tcMatchId || undefined,
            oddsSource,
            oddsDiff: (entry as any)._oddsDiff as number | undefined,
            oddsA: finalOddsA,
            oddsB: finalOddsB,
            oddsOver: finalOddsOver,
            oddsUnder: finalOddsUnder,
            category: classifyBetWithStrategy(finalConfidence, result.kivalasztottEdge, finalValueBet, selectedStrategy),
            warning: sanityWarning(result.kivalasztottEdge, h2hTotal, oddsSource),
            h2hOverRates: h2hOverRates || undefined,
            h2hEffectiveSize,
            movement1x2, movementGoals,
            strategy: selectedStrategy.id,
            lastMatchesA: await (async () => {
              // Supabase alapú egyéni form-adatok — 10 perces cache (egress csökkentés)
              const sbA = await cached(
                `sbplayer:${entry.playerHome}:${entry.league}`,
                () => getPlayerMatchesFromSupabase(entry.playerHome, entry.league, 10),
                10 * 60_000,
              );
              const base = sbA.length >= 5 ? sbA : a.lastMatches.slice(0, 10).map(m => ({
                opponent: m.opponent, opponentTeam: m.opponentTeam ?? '', team: m.team ?? '',
                scoreHome: m.scoreHome, scoreAway: m.scoreAway, result: m.result, date: m.date,
              }));
              return base.map(m => ({ opponent: m.opponent, scoreHome: m.scoreHome, scoreAway: m.scoreAway, result: m.result, date: m.date }));
            })(),
            lastMatchesB: await (async () => {
              const sbB = await cached(
                `sbplayer:${entry.playerAway}:${entry.league}`,
                () => getPlayerMatchesFromSupabase(entry.playerAway, entry.league, 10),
                10 * 60_000,
              );
              const base = sbB.length >= 5 ? sbB : b.lastMatches.slice(0, 10).map(m => ({
                opponent: m.opponent, opponentTeam: m.opponentTeam ?? '', team: m.team ?? '',
                scoreHome: m.scoreHome, scoreAway: m.scoreAway, result: m.result, date: m.date,
              }));
              return base.map(m => ({ opponent: m.opponent, scoreHome: m.scoreHome, scoreAway: m.scoreAway, result: m.result, date: m.date }));
            })(),
            gfPerMatchA: a.gfPerMatch,
            gaPerMatchA: a.gaPerMatch,
            gfPerMatchB: b.gfPerMatch,
            gaPerMatchB: b.gaPerMatch,
            h2hMatchHistory: h2hMatchHistory.length > 0 ? h2hMatchHistory : undefined,
            allOdds: Object.keys((entry as any)._allOdds ?? {}).length > 0
              ? (entry as any)._allOdds as Record<string, { ouLine: number; oddsOver?: number; oddsUnder?: number }>
              : undefined,
          };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          allResults.push(r.value);
        } else {
          // Hiba logolása — mindig, minden elutasított entry-nél
          console.error(`[top-tips] ❌ Batch entry hiba: ${r.reason instanceof Error ? r.reason.stack ?? r.reason.message : String(r.reason)}`);
        }
      }
    }

    // 3. Deduplicate: same match pair (A vs B == B vs A for same time)
    const seen = new Set<string>();
    const deduplicated = allResults.filter(r => {
      const pair = [r.playerA.toLowerCase(), r.playerB.toLowerCase()].sort().join('|');
      const key = `${r.time}|${pair}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4. Filter & rank
    // GT Leagues + eAdriatic: MINDEN meccs megjelenik (nincs NO_BET szűrő), csak n/a kizárva.
    //   → 1 órás előzetes nézet: az összes közelgő meccs látható odds-elemzéssel.
    // Többi liga: csak BET / STRONG_BET, konfidencia + edge szűrővel.
    const isMsportOnlyFilter = leagueFilter === 'GT Leagues' || leagueFilter === 'eAdriatic League';
    const msportLimit = 60; // 1 óra ~ 5 GT + 6 eAdriatic = 11 meccs; 60 biztonságos felső korlát

    const valueBets = deduplicated
      .filter(r => isMsportOnlyFilter
        ? r.oddsSource !== 'n/a'   // GT + eAdriatic: minden meccs valódi odds-szal
        : r.category !== 'NO_BET' && r.confidence >= minConf && r.edge >= minEdge && r.oddsSource !== 'n/a'
      )
      .sort((a, b) => {
        // GT + eAdriatic: idő szerint rendezve (következő meccs elöl)
        if (isMsportOnlyFilter) {
          return a.time.localeCompare(b.time);
        }
        // Többi liga: Category score: STRONG_BET = 2, BET = 1
        const catScore = (t: typeof a) => (t.category === 'STRONG_BET' ? 2 : 1);
        if (catScore(b) !== catScore(a)) return catScore(b) - catScore(a);
        // Within same category: H2H + real odds + weighted conf/edge
        const h2hBoost = (t: typeof a) => (t.h2hMode ? 0.10 : 0);
        const oddsBoost = (t: typeof a) => (t.oddsSource === 'bet365' ? 0.05 : 0);
        const scoreA = a.confidence * 0.6 + a.edge * 4 + h2hBoost(a) + oddsBoost(a);
        const scoreB = b.confidence * 0.6 + b.edge * 4 + h2hBoost(b) + oddsBoost(b);
        return scoreB - scoreA;
      })
      .slice(0, isMsportOnlyFilter ? msportLimit : limit);

    // Debug: hány tipp megy át az egyes filtereken
    console.log(`[top-tips] league=${leagueFilter ?? 'ALL'} | schedule=${schedule.length} analyzed=${allResults.length} deduped=${deduplicated.length} passing=${valueBets.length} (isMsportOnly=${isMsportOnlyFilter})`);
    if (valueBets.length === 0 && deduplicated.length > 0) {
      // Miért szűrte ki mindet? — első 3 entry oddsSource + category megjelenítése
      const sample = deduplicated.slice(0, 3).map(r => `${r.playerA}|${r.playerB}: oddsSource=${r.oddsSource} category=${r.category} conf=${r.confidence.toFixed(2)}`);
      console.log(`[top-tips] ⚠️ 0 tipp — minta: ${sample.join(' || ')}`);
    }

    const responsePayload = {
      generated: new Date().toISOString(),
      totalScanned: schedule.length,
      totalAnalyzed: allResults.length,
      totalValueBets: allResults.filter(r => r.valueBet !== 'PASS').length,
      tips: valueBets,
      strategy: {
        id: selectedStrategy.id,
        name: selectedStrategy.name,
        settings: selectedStrategy.settings,
        kellyEnabled: selectedStrategy.kellyEnabled,
      },
    };
    // Cache-elés + in-flight lezárás
    _topTipsCache.set(cacheKey, { data: responsePayload, ts: Date.now() });
    _topTipsInFlight.delete(cacheKey);
    _resolveInFlight?.(responsePayload);
    res.json(responsePayload);
  } catch (e: unknown) {
    _topTipsInFlight.delete(cacheKey);
    // Várakozó in-flight requestek ne lógjanak örökre — adjunk vissza üres eredményt
    _resolveInFlight?.({ generated: new Date().toISOString(), totalScanned: 0, totalAnalyzed: 0, totalValueBets: 0, tips: [], strategy: { id: selectedStrategy.id, name: selectedStrategy.name, settings: selectedStrategy.settings, kellyEnabled: selectedStrategy.kellyEnabled } });
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});
// ============ TOTALCORNER ENDPOINTS ============

// GET /api/tc/league?league=GT+Leagues
app.get('/api/tc/league', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`tc:league:${league}`, () => scrapeTCLeague(league));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/odds/:matchId?home=...&away=...
app.get('/api/tc/odds/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const home = req.query.home as string;
    const away = req.query.away as string;
    if (!home || !away) {
      res.status(400).json({ error: 'home and away query params required' });
      return;
    }
    const data = await cached(`tc:odds:${matchId}`, () => scrapeTCMatchOdds(matchId, home, away));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/h2h/:matchId?home=...&away=...
app.get('/api/tc/h2h/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const home = req.query.home as string;
    const away = req.query.away as string;
    if (!home || !away) {
      res.status(400).json({ error: 'home and away query params required' });
      return;
    }
    const h2hMatches = await cached(`tc:h2h:${matchId}`, () => scrapeTCH2H(matchId, home, away));
    const aggregate = aggregateH2H(h2hMatches, home, away);
    res.json({ matches: h2hMatches, aggregate });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/leagues - list available leagues
app.get('/api/tc/leagues', (_req, res) => {
  res.json(TC_LEAGUES);
});

// ============ BACKTEST + OPTIMIZER ENDPOINTS ============

interface BacktestMatchData {
  date: string;
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  // Snapshot of player stats at backtest time (current stats, lookahead bias)
  wrA: number; wrB: number;
  gfA: number; gaA: number;
  gfB: number; gaB: number;
  formaA: number; formaB: number;
}

// Build backtest match data from a player's lastMatches history
async function buildBacktestData(playerName: string, league: string, opponentFilter?: string): Promise<BacktestMatchData[]> {
  const stats = await cached(`player:${playerName}:${league}`, () =>
    scrapePlayerStats(playerName, league)
  );

  const formToWinRate = (p: PlayerStats) => p.winRate > 0 ? p.winRate : (p.matches > 0 ? p.wins / p.matches : 0.5);

  const wrA = formToWinRate(stats);
  const formaA = Math.max(0, Math.min(1, wrA + stats.form10));

  const matches: BacktestMatchData[] = [];

  for (const m of stats.lastMatches) {
    if (opponentFilter && m.opponent.toLowerCase() !== opponentFilter.toLowerCase()) continue;

    // Get opponent stats (cached)
    let oppStats: PlayerStats | null = null;
    try {
      oppStats = await cached(`player:${m.opponent}:${league}`, () =>
        scrapePlayerStats(m.opponent, league)
      );
    } catch {
      continue;
    }

    const wrB = formToWinRate(oppStats);
    const formaB = Math.max(0, Math.min(1, wrB + oppStats.form10));

    matches.push({
      date: m.date,
      playerA: playerName,
      playerB: m.opponent,
      scoreA: m.scoreHome,
      scoreB: m.scoreAway,
      wrA, wrB,
      gfA: stats.gfPerMatch,
      gaA: stats.gaPerMatch,
      gfB: oppStats.gfPerMatch,
      gaB: oppStats.gaPerMatch,
      formaA, formaB,
    });
  }

  return matches;
}

// Run backtest with given settings on the data
function runBacktestOnData(matches: BacktestMatchData[], settings: typeof DEFAULT_SETTINGS, league: 'GT Leagues' | 'eAdriaticLeague' | 'Other') {
  const percek = league === 'GT Leagues' ? 12 : league === 'eAdriaticLeague' ? 10 : 8;
  let totalBets = 0, wins = 0, losses = 0, passes = 0;
  let totalStaked = 0, totalProfit = 0;
  const byMarket = { win: { bets: 0, wins: 0 }, ou: { bets: 0, wins: 0 } };
  const byConf = { high: { bets: 0, wins: 0 }, mid: { bets: 0, wins: 0 }, low: { bets: 0, wins: 0 } };
  const details: Array<{
    date: string; playerA: string; playerB: string;
    scoreA: number; scoreB: number;
    valueBet: string; confidence: number; edge: number; stake: number;
    won: boolean | null; profit: number;
  }> = [];

  for (const m of matches) {
    // Estimate odds from current stats (Bet365 ~6% margin)
    const rawWinA = m.wrA / (m.wrA + m.wrB);
    const estimatedOdds = estimateMatchOdds(rawWinA, 1 - rawWinA, 0.55);

    const result = calculateMatch({
      id: 'bt',
      liga: league,
      percek,
      piacTipus: league === 'GT Leagues' ? 'Over/Under' : 'Win',
      playerA: m.playerA,
      playerB: m.playerB,
      oddsA: estimatedOdds.oddsA,
      oddsB: estimatedOdds.oddsB,
      gfA: m.gfA, gaA: m.gaA,
      gfB: m.gfB, gaB: m.gaB,
      winRateA: m.wrA, winRateB: m.wrB,
      formaA: m.formaA, formaB: m.formaB,
      h2hA: 0.5, h2hB: 0.5,
      ouLine: 3.5,
      oddsOver: estimatedOdds.oddsOver,
      oddsUnder: estimatedOdds.oddsUnder,
    }, DEFAULT_SETTINGS);  // ← HAGYD DEFAULT_SETTINGS! (Ez backtest endpoint, nem top-tips!)

    const totalGoals = m.scoreA + m.scoreB;
    let won: boolean | null = null;

    if (result.valueBet === 'PASS') {
      passes++;
      details.push({ ...m, valueBet: 'PASS', confidence: result.confidence, edge: 0, stake: 0, won: null, profit: 0 });
      continue;
    }

    if (result.valueBet === 'OVER') won = totalGoals > 3.5;
    else if (result.valueBet === 'UNDER') won = totalGoals < 3.5;
    else if (result.valueBet === 'A gyozelem') won = m.scoreA > m.scoreB;
    else if (result.valueBet === 'B gyozelem') won = m.scoreB > m.scoreA;

    const isOu = result.valueBet === 'OVER' || result.valueBet === 'UNDER';
    const market = isOu ? byMarket.ou : byMarket.win;
    market.bets++;
    if (won) market.wins++;

    const conf = result.confidence;
    const bucket = conf >= 0.75 ? byConf.high : conf >= 0.6 ? byConf.mid : byConf.low;
    bucket.bets++;
    if (won) bucket.wins++;

    totalBets++;
    if (won) wins++;
    else losses++;

    const profit = won
      ? result.stakeFt * (result.kivalasztottOdds - 1)
      : -result.stakeFt;
    totalStaked += result.stakeFt;
    totalProfit += profit;

    details.push({
      date: m.date, playerA: m.playerA, playerB: m.playerB,
      scoreA: m.scoreA, scoreB: m.scoreB,
      valueBet: result.valueBet,
      confidence: result.confidence,
      edge: result.kivalasztottEdge,
      stake: result.stakeFt,
      won, profit,
    });
  }

  return {
    totalMatches: matches.length,
    totalBets, wins, losses, passes,
    hitRate: totalBets > 0 ? wins / totalBets : 0,
    roi: totalStaked > 0 ? totalProfit / totalStaked : 0,
    totalStaked, totalProfit,
    byMarket: {
      win: { ...byMarket.win, hitRate: byMarket.win.bets > 0 ? byMarket.win.wins / byMarket.win.bets : 0 },
      overUnder: { ...byMarket.ou, hitRate: byMarket.ou.bets > 0 ? byMarket.ou.wins / byMarket.ou.bets : 0 },
    },
    byConfidence: {
      high: { ...byConf.high, hitRate: byConf.high.bets > 0 ? byConf.high.wins / byConf.high.bets : 0 },
      medium: { ...byConf.mid, hitRate: byConf.mid.bets > 0 ? byConf.mid.wins / byConf.mid.bets : 0 },
      low: { ...byConf.low, hitRate: byConf.low.bets > 0 ? byConf.low.wins / byConf.low.bets : 0 },
    },
    details: details.slice(0, 100),
  };
}

// GET /api/backtest/:player?league=...&opponent=...
app.get('/api/backtest/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const opponent = req.query.opponent as string | undefined;
    const liga = league === 'GT Leagues' ? 'GT Leagues' as const
      : league === 'eAdriatic League' ? 'eAdriaticLeague' as const
        : 'Other' as const;

    const matches = await buildBacktestData(req.params.player, league, opponent);
    const result = runBacktestOnData(matches, DEFAULT_SETTINGS, liga);
    res.json({ league, ...result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// POST /api/optimize/:player - run grid search optimizer
app.post('/api/optimize/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const liga = league === 'GT Leagues' ? 'GT Leagues' as const
      : league === 'eAdriatic League' ? 'eAdriaticLeague' as const
        : 'Other' as const;

    const matches = await buildBacktestData(req.params.player, league);
    if (matches.length < 5) {
      res.status(400).json({ error: 'Not enough matches for optimization (need at least 5)' });
      return;
    }

    // Grid search: try various weight combinations
    const steps = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
    const results: Array<{
      settings: { wr: number; forma: number; h2h: number; atk: number; def: number };
      roi: number; hitRate: number; bets: number; profit: number;
    }> = [];

    for (const wr of steps) {
      for (const forma of steps) {
        for (const h2h of [0.05, 0.10, 0.15, 0.20]) {
          for (const atk of steps) {
            const def = Math.round((1 - wr - forma - h2h - atk) * 100) / 100;
            if (def < 0.05 || def > 0.40) continue;

            const settings = {
              ...DEFAULT_SETTINGS,
              winRateSuly: wr, formaSuly: forma, h2hSuly: h2h,
              tamadasSuly: atk, vedekezesSuly: def,
            };
            const result = runBacktestOnData(matches, settings, liga);
            if (result.totalBets >= 3) {
              results.push({
                settings: { wr, forma, h2h, atk, def },
                roi: result.roi,
                hitRate: result.hitRate,
                bets: result.totalBets,
                profit: result.totalProfit,
              });
            }
          }
        }
      }
    }

    // Sort by ROI descending
    results.sort((a, b) => b.roi - a.roi);

    res.json({
      totalCombinations: results.length,
      best: results[0] || null,
      top20: results.slice(0, 20),
      defaultSettings: {
        wr: DEFAULT_SETTINGS.winRateSuly,      // ← JAVÍTVA!
        forma: DEFAULT_SETTINGS.formaSuly,      // ← JAVÍTVA!
        h2h: DEFAULT_SETTINGS.h2hSuly,          // ← JAVÍTVA!
        atk: DEFAULT_SETTINGS.tamadasSuly,      // ← JAVÍTVA!
        def: DEFAULT_SETTINGS.vedekezesSuly,    // ← JAVÍTVA!
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// ============ TELEGRAM + SCANNER ENDPOINTS ============

// POST /api/telegram/configure { botToken, chatId }
app.post('/api/telegram/configure', async (req, res) => {
  const { botToken, chatId } = req.body as { botToken?: string; chatId?: string };
  if (!botToken || !chatId) {
    res.status(400).json({ error: 'botToken and chatId required' });
    return;
  }
  configureTelegram(botToken, chatId);
  // Send a test message
  const ok = await sendMessage('🟢 *eSport Bet* — Telegram bot konfigurálva!\n\nMostantól push értesítéseket fogsz kapni új STRONG BET tippekre.');
  res.json({ configured: true, testMessageSent: ok });
});

// GET /api/telegram/status
app.get('/api/telegram/status', (_req, res) => {
  res.json({ configured: isTelegramConfigured() });
});

// POST /api/telegram/test - send a test message
app.post('/api/telegram/test', async (_req, res) => {
  if (!isTelegramConfigured()) {
    res.status(400).json({ error: 'Telegram not configured' });
    return;
  }
  const ok = await sendMessage('🧪 Test üzenet az eSport Bet-ből.');
  res.json({ sent: ok });
});

// GET /api/scanner/status
app.get('/api/scanner/status', (_req, res) => {
  res.json(getScannerState());
});

// POST /api/scanner/run - manually trigger a scan
app.post('/api/scanner/run', async (_req, res) => {
  const result = await runScan();
  res.json({ ran: result !== null, tipsFound: result?.tips.length || 0 });
});

// GET /api/trend/status
app.get('/api/trend/status', (_req, res) => {
  res.json(getTrendScannerState());
});

// POST /api/trend/run - manually trigger a trend scan
app.post('/api/trend/run', async (_req, res) => {
  try {
    const { signals, pushed } = await runTrendScanOnce();
    res.json({ ran: true, signalsFound: signals.length, pushed, signals });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// Configure scanner to call our own /api/top-tips endpoint
const SELF_URL = `http://localhost:${process.env.PORT || '3005'}`;
configureScanner(async () => {
  const r = await fetch(`${SELF_URL}/api/top-tips?limit=20&minConf=0.65&minEdge=0.04`);
  if (!r.ok) throw new Error(`Top-tips fetch failed: ${r.status}`);
  return r.json() as Promise<ReturnType<typeof getCachedResult> & object>;
});

// Configure intraday H2H trend scanner
configureTrendScanner({
  getSchedule: getCombinedSchedule,
  getPlayerStats: async (name, league) => {
    return cached(`player:${name}:${league}`, () => getPlayerStats(name, league));
  },
  getAllOdds: async (playerA, playerB) => {
    const result: Record<string, { ouLine: number; oddsOver?: number }> = {};

    // 1. msport: a VPS már lekérte és beágyazta a schedule entry-kbe (ouLine, oddsOver, oddsSource='msport.com')
    //    Ezt olvassuk ki a cache-elt schedule-ból — nincs közvetlen msport hívás (production-on timeout)
    try {
      const sched = await cached('schedule', getCombinedSchedule, SCHEDULE_CACHE_TTL);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const nA = norm(playerA), nB = norm(playerB);
      const entry = (sched as any[]).find(m => {
        const eA = norm(m.playerHome ?? ''), eB = norm(m.playerAway ?? '');
        return (
          (eA.includes(nA) || nA.includes(eA)) && (eB.includes(nB) || nB.includes(eB))
        ) || (
          (eA.includes(nB) || nB.includes(eA)) && (eB.includes(nA) || nA.includes(eB))
        );
      });
      if (entry && (entry.ouLine ?? 0) > 0) {
        result['msport.com'] = { ouLine: entry.ouLine, oddsOver: entry.oddsOver };
      }
    } catch { /* skip */ }

    // 2. Cloudbet — VPS cache (GT + ADR, nem blokkolt IP), majd Trading API fallback
    try {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const nA = norm(playerA), nB = norm(playerB);
      const vpsEntry = _vpsCbOdds.find(o => {
        const eA = norm(o.playerA), eB = norm(o.playerB);
        return (eA.includes(nA) || nA.includes(eA)) && (eB.includes(nB) || nB.includes(eB))
            || (eA.includes(nB) || nB.includes(eA)) && (eB.includes(nA) || nA.includes(eB));
      });
      if (vpsEntry && vpsEntry.ouLine > 0) {
        result['cloudbet'] = { ouLine: vpsEntry.ouLine, oddsOver: vpsEntry.oddsOver };
      } else {
        // Fallback: Cloudbet Trading API (eAdriatic)
        const cb = getCloudbetKeyStatus().configured
          ? await getCloudbetOddsForMatch(playerA, playerB)
          : null;
        if (cb && cb.ouLine > 0) result['cloudbet'] = { ouLine: cb.ouLine, oddsOver: cb.oddsOver };
      }
    } catch { /* skip */ }

    // 3. Vegas.hu (Altenar)
    try {
      const v = await getVegasOdds(playerA, playerB);
      if (v && v.ouLine > 0) result['vegas.hu'] = { ouLine: v.ouLine, oddsOver: v.oddsOver };
    } catch { /* skip */ }

    return result;
  },
});

// Telegram bot command handler
async function handleBotCommand(cmd: string, args: string): Promise<string> {
  switch (cmd) {
    case 'start':
    case 'help':
      return [
        '*eSport Bet — Bot parancsok*',
        '',
        '/top — Napi top 5 tipp',
        '/strong — Csak STRONG BET tippek',
        '/scan — Friss scan futtatása',
        '/trend — Intraday H2H trend jelzések',
        '/status — Scanner állapot',
        '',
        '_STRONG BET: 15 percenként · Trend jelzés: 5 percenként_',
      ].join('\n');

    case 'top': {
      const cached = getCachedResult();
      if (!cached) return '_Még nincs scan eredmény. Próbáld a /scan parancsot._';
      const top5 = cached.tips.slice(0, 5);
      await sendTopTipsList(top5, '*Top 5 Tipp*');
      return '';
    }

    case 'strong': {
      const cached = getCachedResult();
      if (!cached) return '_Még nincs scan eredmény. Próbáld a /scan parancsot._';
      const strong = cached.tips.filter(t => t.category === 'STRONG_BET').slice(0, 10);
      await sendTopTipsList(strong, '*🔥 STRONG BET Tippek*');
      return '';
    }

    case 'scan': {
      await sendMessage('🔄 Scan elindult, néhány másodperc...');
      const r = await runScan();
      if (!r) return '❌ Scan sikertelen';
      const strongCount = r.tips.filter(t => t.category === 'STRONG_BET').length;
      return `✅ Scan kész\n\n${r.totalScanned} meccs scannelve\n${r.tips.length} tipp\n${strongCount} STRONG BET`;
    }

    case 'trend': {
      await sendMessage('🔄 Trend scan elindult...');
      try {
        const { signals, pushed } = await runTrendScanOnce();
        if (signals.length === 0) return '📊 Nincs aktív trend jelzés most.';
        return `📈 ${signals.length} trend jelzés találva, ${pushed} Telegram értesítés küldve.`;
      } catch {
        return '❌ Trend scan sikertelen';
      }
    }

    case 'status': {
      const s = getScannerState();
      const ts = getTrendScannerState();
      return [
        '*Scanner állapot*',
        '',
        `Fut: ${s.isRunning ? '🟢 Igen' : '🔴 Nem'}`,
        `Utolsó top-tips scan: ${s.lastRunISO || 'soha'}`,
        `Cache-elt tippek: ${s.cachedTipCount}`,
        `Push-olt tippek: ${s.pushedCount}`,
        '',
        '*Trend Scanner*',
        `Fut: ${ts.isRunning ? '🟢 Igen' : '🔴 Nem'}`,
        `Utolsó trend scan: ${ts.lastRunISO || 'soha'}`,
        `Utolsó jelzések: ${ts.lastSignalCount}`,
        `Push-olt jelzések: ${ts.pushedCount}`,
        `Hibák: ${ts.errors}`,
      ].join('\n');
    }

    default:
      return `Ismeretlen parancs: /${cmd}\n\n/help — parancsok listája`;
  }
}

// ============ BACKTEST COMPARISON ENDPOINT ============

// GET /api/backtest-compare?league=GT+Leagues&topN=50
app.get('/api/backtest-compare', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const topN = parseInt(req.query.topN as string) || 50;
    const initialBankroll = parseInt(req.query.bankroll as string) || 50000;

    console.log(`🚀 Starting backtest comparison for ${league} (top ${topN} players)...`);

    // 1. Build historical dataset
    const startTime = Date.now();
    const dataset = await buildBacktestDataset(league, topN);
    const scrapeDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (dataset.length === 0) {
      res.status(400).json({ error: 'No historical data found for this league' });
      return;
    }

    console.log(`⏱️  Dataset ready in ${scrapeDuration}s`);
    console.log(`🔬 Running Strategy A...`);

    // 2. Run Strategy A
    const resultA = runBacktest(dataset, STRATEGIES.A, initialBankroll);
    console.log(`   ✅ Strategy A complete: ${resultA.totalBets} bets, ${(resultA.roi * 100).toFixed(2)}% ROI`);

    console.log(`🔬 Running Strategy B...`);

    // 3. Run Strategy B
    const resultB = runBacktest(dataset, STRATEGIES.B, initialBankroll);
    console.log(`   ✅ Strategy B complete: ${resultB.totalBets} bets, ${(resultB.roi * 100).toFixed(2)}% ROI`);

    // 4. Calculate winner
    const winner = resultB.roi > resultA.roi ? 'B' : 'A';
    const roiDiff = Math.abs(resultB.roi - resultA.roi);
    const profitDiff = resultB.totalProfit - resultA.totalProfit;

    console.log(`🏆 Winner: Strategy ${winner} (${(roiDiff * 100).toFixed(2)}% better)`);

    res.json({
      meta: {
        league,
        datasetSize: dataset.length,
        period: resultA.period,
        scrapeDuration: scrapeDuration + 's',
        initialBankroll,
      },
      strategyA: {
        id: 'A',
        name: resultA.strategy.name,
        description: resultA.strategy.description,
        settings: resultA.strategy.settings,
        totalBets: resultA.totalBets,
        wins: resultA.wins,
        losses: resultA.losses,
        passes: resultA.passes,
        hitRate: (resultA.hitRate * 100).toFixed(1) + '%',
        roi: (resultA.roi * 100).toFixed(2) + '%',
        totalStaked: resultA.totalStaked.toFixed(0) + ' Ft',
        totalProfit: resultA.totalProfit.toFixed(0) + ' Ft',
        avgStake: resultA.avgStake.toFixed(0) + ' Ft',
        finalBankroll: resultA.finalBankroll.toFixed(0) + ' Ft',
        byMarket: {
          win: {
            bets: resultA.byMarket.win.bets,
            wins: resultA.byMarket.win.wins,
            hitRate: (resultA.byMarket.win.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byMarket.win.profit.toFixed(0) + ' Ft',
          },
          overUnder: {
            bets: resultA.byMarket.overUnder.bets,
            wins: resultA.byMarket.overUnder.wins,
            hitRate: (resultA.byMarket.overUnder.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byMarket.overUnder.profit.toFixed(0) + ' Ft',
          },
        },
        byConfidence: {
          high: {
            bets: resultA.byConfidence.high.bets,
            wins: resultA.byConfidence.high.wins,
            hitRate: (resultA.byConfidence.high.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.high.profit.toFixed(0) + ' Ft',
          },
          mid: {
            bets: resultA.byConfidence.mid.bets,
            wins: resultA.byConfidence.mid.wins,
            hitRate: (resultA.byConfidence.mid.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.mid.profit.toFixed(0) + ' Ft',
          },
          low: {
            bets: resultA.byConfidence.low.bets,
            wins: resultA.byConfidence.low.wins,
            hitRate: (resultA.byConfidence.low.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.low.profit.toFixed(0) + ' Ft',
          },
        },
      },
      strategyB: {
        id: 'B',
        name: resultB.strategy.name,
        description: resultB.strategy.description,
        settings: resultB.strategy.settings,
        totalBets: resultB.totalBets,
        wins: resultB.wins,
        losses: resultB.losses,
        passes: resultB.passes,
        hitRate: (resultB.hitRate * 100).toFixed(1) + '%',
        roi: (resultB.roi * 100).toFixed(2) + '%',
        totalStaked: resultB.totalStaked.toFixed(0) + ' Ft',
        totalProfit: resultB.totalProfit.toFixed(0) + ' Ft',
        avgStake: resultB.avgStake.toFixed(0) + ' Ft',
        finalBankroll: resultB.finalBankroll.toFixed(0) + ' Ft',
        byMarket: {
          win: {
            bets: resultB.byMarket.win.bets,
            wins: resultB.byMarket.win.wins,
            hitRate: (resultB.byMarket.win.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byMarket.win.profit.toFixed(0) + ' Ft',
          },
          overUnder: {
            bets: resultB.byMarket.overUnder.bets,
            wins: resultB.byMarket.overUnder.wins,
            hitRate: (resultB.byMarket.overUnder.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byMarket.overUnder.profit.toFixed(0) + ' Ft',
          },
        },
        byConfidence: {
          high: {
            bets: resultB.byConfidence.high.bets,
            wins: resultB.byConfidence.high.wins,
            hitRate: (resultB.byConfidence.high.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.high.profit.toFixed(0) + ' Ft',
          },
          mid: {
            bets: resultB.byConfidence.mid.bets,
            wins: resultB.byConfidence.mid.wins,
            hitRate: (resultB.byConfidence.mid.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.mid.profit.toFixed(0) + ' Ft',
          },
          low: {
            bets: resultB.byConfidence.low.bets,
            wins: resultB.byConfidence.low.wins,
            hitRate: (resultB.byConfidence.low.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.low.profit.toFixed(0) + ' Ft',
          },
        },
      },
      comparison: {
        winner,
        roiDifference: (roiDiff * 100).toFixed(2) + '%',
        profitDifference: profitDiff.toFixed(0) + ' Ft',
        bankrollGrowth: {
          strategyA: ((resultA.finalBankroll / initialBankroll - 1) * 100).toFixed(2) + '%',
          strategyB: ((resultB.finalBankroll / initialBankroll - 1) * 100).toFixed(2) + '%',
        },
        message: winner === 'B'
          ? `✅ Strategy B outperforms by ${(roiDiff * 100).toFixed(2)}%! Enhanced algorithm is superior.`
          : roiDiff < 0.01
            ? `⚖️  Both strategies nearly equal (${(roiDiff * 100).toFixed(2)}% difference)`
            : `⚠️  Strategy A still better by ${(roiDiff * 100).toFixed(2)}%. Consider more testing.`,
      },
    });
  } catch (e: unknown) {
    console.error('❌ Backtest error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error',
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
});

// Serve static frontend in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

app.use(express.static(distPath));

// ============ TOTALCORNER ENDPOINTS ============

app.get('/api/tc/players/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const players = await scrapeFullPlayerData(league);
    
    res.json({
      league,
      players,
      count: players.length,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/tc/best-players/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const players = await getBestPlayers(league, limit);
    
    res.json({
      league,
      players,
      count: players.length,
      limit,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/tc/schedule/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const schedule = await tcScrapeSchedule(league);
    
    res.json({
      league,
      schedule,
      count: schedule.length,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});
// ============ RESULT RESOLVER — esoccerbet.org ============
const MATCH_DURATION_MIN: Record<string, number> = {
  'GT Leagues': 12,
  'eAdriatic League': 10,
  'Esoccer Battle': 8,
  'Esports Volta': 6,
  'Esoccer H2H GG League': 8,
};

function fuzzyNameMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nA = norm(a);
  const nB = norm(b);
  if (nA === nB) return true;
  const short = nA.length < nB.length ? nA : nB;
  const long  = nA.length < nB.length ? nB : nA;
  return long.includes(short.slice(0, Math.min(6, short.length)));
}

function parseDateToMs(dateStr: string, refTimestamp: number): number | null {
  // Formats seen: "04/26 14:30", "14:30", "04/26"
  const parts = dateStr.trim().split(/\s+/);
  const ref = new Date(refTimestamp);
  const year = ref.getFullYear();

  if (parts.length === 2) {
    // "MM/DD HH:MM"
    const [md, hm] = parts;
    const [mo, dy] = md.split('/').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    return new Date(year, mo - 1, dy, hh, mm).getTime();
  }
  if (parts.length === 1) {
    if (parts[0].includes('/')) {
      // "MM/DD"
      const [mo, dy] = parts[0].split('/').map(Number);
      return new Date(year, mo - 1, dy, ref.getHours(), ref.getMinutes()).getTime();
    }
    if (parts[0].includes(':')) {
      // "HH:MM" — assume same day
      const [hh, mm] = parts[0].split(':').map(Number);
      return new Date(year, ref.getMonth(), ref.getDate(), hh, mm).getTime();
    }
  }
  return null;
}

app.post('/api/resolve-results', async (req, res) => {
  try {
    const { matches } = req.body as {
      matches: {
        matchId: string;
        playerA: string;
        playerB: string;
        league: string;
        timestamp: number;
        betType: string;
        betLine: number;
      }[];
    };

    const results = await Promise.all(matches.map(async (m) => {
      try {
        const duration = MATCH_DURATION_MIN[m.league] ?? 10;
        const matchEndMs = m.timestamp + (duration + 3) * 60 * 1000;
        if (Date.now() < matchEndMs + 5000) {
          return { matchId: m.matchId, pending: true };
        }

        // Fresh scrape — no cache so we always get the latest results
        const playerResults = await scrapePlayerResults(m.playerA, m.league);

        // Find the specific match: fuzzy opponent name + date proximity (±30 min)
        const found = playerResults.find(r => {
          if (!fuzzyNameMatch(r.opponent, m.playerB)) return false;
          const rMs = parseDateToMs(r.date, m.timestamp);
          if (rMs === null) return true; // no date info → accept name match
          return Math.abs(rMs - m.timestamp) < 30 * 60 * 1000;
        });

        if (!found) {
          // Fallback: try scraping from playerB's perspective
          const playerBResults = await scrapePlayerResults(m.playerB, m.league);
          const foundB = playerBResults.find(r => {
            if (!fuzzyNameMatch(r.opponent, m.playerA)) return false;
            const rMs = parseDateToMs(r.date, m.timestamp);
            if (rMs === null) return true;
            return Math.abs(rMs - m.timestamp) < 30 * 60 * 1000;
          });
          if (!foundB) return { matchId: m.matchId, pending: true };

          // From playerB's perspective: scoreHome=B, scoreAway=A → swap
          const total = foundB.scoreHome + foundB.scoreAway;
          const scoreA = foundB.scoreAway;
          const scoreB = foundB.scoreHome;
          let outcome: 'Win' | 'Loss' | null = null;
          if (m.betType === 'Over')  outcome = total > m.betLine ? 'Win' : 'Loss';
          if (m.betType === 'Under') outcome = total < m.betLine ? 'Win' : 'Loss';
          return { matchId: m.matchId, score: `${scoreA}:${scoreB}`, total, outcome, pending: false };
        }

        const total = found.scoreHome + found.scoreAway;
        let outcome: 'Win' | 'Loss' | null = null;
        if (m.betType === 'Over')  outcome = total > m.betLine ? 'Win' : 'Loss';
        if (m.betType === 'Under') outcome = total < m.betLine ? 'Win' : 'Loss';
        return { matchId: m.matchId, score: `${found.scoreHome}:${found.scoreAway}`, total, outcome, pending: false };
      } catch {
        return { matchId: m.matchId, pending: true };
      }
    }));

    res.json(results);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// ============ JOURNAL PERSISTENCE ============

async function getUserId(req: express.Request): Promise<string | null> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !supabase) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch { return null; }
}

app.get('/api/journal', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json(await loadJournal(userId));
  } catch { res.json([]); }
});

app.post('/api/journal', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await saveJournalDb(userId, req.body);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

app.get('/api/settings', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const data = await loadSettingsDb(userId);
    res.json(data ?? {});
  } catch { res.json({}); }
});

app.post('/api/settings', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await saveSettingsDb(userId, req.body);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ── Checked matches endpoints ────────────────────────────────────────────────

app.get('/api/checked-matches', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json(await loadCheckedMatches(userId));
  } catch { res.json([]); }
});

app.post('/api/checked-matches', async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await saveCheckedMatchesDb(userId, req.body);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ── Subscription endpoints ────────────────────────────────────────────────────

app.get('/api/subscription', async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const sub = await getSubscription(userId);
  // Auto-create 30-day trial on first login
  if (!sub) {
    await upsertSubscription(userId, 30);
    const created = await getSubscription(userId);
    res.json(created ?? { plan: 'pro', expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
    return;
  }
  res.json(sub);
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase());
  return list.includes(email.toLowerCase());
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<string | null> {
  const sb = supabase;
  if (!sb) { res.status(503).json({ error: 'Supabase not configured' }); return null; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user?.email || !isAdminEmail(user.email)) {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return user.id;
}

app.get('/api/admin/status', async (req, res) => {
  const sb = supabase;
  if (!sb) { res.json({ isAdmin: false }); return; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.json({ isAdmin: false }); return; }
  const { data: { user } } = await sb.auth.getUser(token);
  res.json({ isAdmin: !!user?.email && isAdminEmail(user.email) });
});

app.get('/api/admin/users', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const sb = supabase!;
  try {
    const { data: { users }, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const { data: subs } = await sb.from('subscriptions').select('user_id,plan,expires_at');
    const subMap = new Map((subs ?? []).map((s: any) => [s.user_id, s]));
    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      email_confirmed: !!u.email_confirmed_at,
      subscription: subMap.get(u.id) ?? null,
    }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

app.post('/api/admin/users/:userId/extend', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const { days = 30 } = req.body;
  await upsertSubscription(req.params.userId, Number(days));
  res.json({ ok: true });
});

app.post('/api/admin/users/:userId/revoke', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  await revokeSubscription(req.params.userId);
  res.json({ ok: true });
});

// GET /api/admin/supabase/stats — összes tábla sorszáma + összesített méret
app.get('/api/admin/supabase/stats', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const sb = supabase;
  if (!sb) { res.status(503).json({ error: 'Supabase nincs konfigurálva' }); return; }

  const tables = ['app_data', 'completed_matches', 'journals', 'user_settings', 'subscriptions', 'user_checked_matches'];
  const stats: Array<{ table: string; count: number | null; error?: string }> = [];
  for (const t of tables) {
    try {
      const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
      if (error) stats.push({ table: t, count: null, error: error.message });
      else stats.push({ table: t, count: count ?? 0 });
    } catch (e: any) {
      stats.push({ table: t, count: null, error: e?.message ?? 'unknown' });
    }
  }
  res.json({ tables: stats, generated: new Date().toISOString() });
});

app.get('/api/admin/logs', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const limit = Math.min(parseInt(req.query.limit as string) || 200, MAX_LOG_ENTRIES);
  res.json({ logs: _logBuffer.slice(-limit), total: _logBuffer.length });
});

app.delete('/api/admin/logs', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  _logBuffer.length = 0;
  res.json({ ok: true });
});

// GET /api/admin/supabase/peek/:table?limit=20&offset=0 — táblába belenézés lapozással
app.get('/api/admin/supabase/peek/:table', async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const sb = supabase;
  if (!sb) { res.status(503).json({ error: 'Supabase nincs konfigurálva' }); return; }

  const allowed = new Set(['app_data', 'completed_matches', 'journals', 'user_settings', 'subscriptions', 'user_checked_matches']);
  const table = req.params.table;
  if (!allowed.has(table)) { res.status(400).json({ error: 'Ismeretlen tábla' }); return; }
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  try {
    // Supabase Postgrest range = inclusive: [from, to]
    let q = sb.from(table).select('*', { count: 'exact' }).range(offset, offset + limit - 1);
    if (table === 'completed_matches') q = q.order('start_time', { ascending: false });
    if (table === 'subscriptions' || table === 'journals' || table === 'user_settings') q = q.order('updated_at', { ascending: false, nullsFirst: false });
    const { data, error, count } = await q;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ table, rows: data ?? [], limit, offset, total: count ?? null });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown' });
  }
});

// GET /api/match-result?playerA=&playerB=&league=&startTime=
// Lejátszott meccs végeredményét adja vissza.
// Forrás prioritás: 1. _injectedCompleted (in-memory), 2. Supabase, 3. Cloudbet web live/finished
app.get('/api/match-result', async (req, res) => {
  try {
    const pA = ((req.query.playerA as string) || '').toLowerCase().trim();
    const pB = ((req.query.playerB as string) || '').toLowerCase().trim();
    const league = (req.query.league as string) || '';
    const startTime = parseInt(req.query.startTime as string) || 0; // ms
    if (!pA || !pB) return res.json({ found: false });

    const TOLERANCE_MS = 8 * 60 * 1000; // ±8 perc tűrés

    // 1. _injectedCompleted in-memory
    const inMem = (await getMsportMatchResults()).find(m =>
      ((m.playerA === pA && m.playerB === pB) || (m.playerA === pB && m.playerB === pA)) &&
      (!league || m.league === league) &&
      (!startTime || Math.abs(m.startTime - startTime) < TOLERANCE_MS)
    );
    if (inMem) {
      const fwd = inMem.playerA === pA;
      return res.json({ found: true, scoreA: fwd ? inMem.scoreA : inMem.scoreB, scoreB: fwd ? inMem.scoreB : inMem.scoreA });
    }

    // 2. Supabase completed_matches
    if (supabase) {
      try {
        const from = startTime ? startTime - TOLERANCE_MS : Date.now() - 24 * 3600_000;
        const to   = startTime ? startTime + TOLERANCE_MS : Date.now();
        const { data } = await supabase
          .from('completed_matches')
          .select('player_a,player_b,score_a,score_b')
          .in('league', league ? [league] : ['GT Leagues', 'eAdriatic League'])
          .gte('start_time', from).lte('start_time', to)
          .limit(20);
        const row = data?.find(r =>
          (r.player_a === pA && r.player_b === pB) ||
          (r.player_a === pB && r.player_b === pA)
        );
        if (row) {
          const fwd = row.player_a === pA;
          return res.json({ found: true, scoreA: fwd ? row.score_a : row.score_b, scoreB: fwd ? row.score_b : row.score_a });
        }
      } catch { /* silent */ }
    }

    // 3. Cloudbet web — élő + befejezett meccsek közvetlen lekérése
    try {
      const events = await getCloudbetWebAllEvents();
      const ev = events.find(e => {
        const eA = (e.homeTeam || '').toLowerCase();
        const eB = (e.awayTeam || '').toLowerCase();
        const isMatch = (eA.includes(pA) || pA.includes(eA)) && (eB.includes(pB) || pB.includes(eB)) ||
                        (eA.includes(pB) || pB.includes(eA)) && (eB.includes(pA) || pA.includes(eB));
        const isFinished = e.eventStatus === 'finished' || e.status === 'RESULTED' ||
                           e.eventStatus === 'in_progress' || e.status === 'TRADING_LIVE';
        return isMatch && isFinished && e.homeScore != null && e.awayScore != null;
      });
      if (ev && ev.homeScore != null && ev.awayScore != null) {
        const eA = (ev.homeTeam || '').toLowerCase();
        const fwd = eA.includes(pA) || pA.includes(eA);
        return res.json({
          found: true,
          scoreA: fwd ? ev.homeScore : ev.awayScore,
          scoreB: fwd ? ev.awayScore : ev.homeScore,
          live: ev.eventStatus === 'in_progress' || ev.status === 'TRADING_LIVE',
        });
      }
    } catch { /* silent */ }

    return res.json({ found: false });
  } catch (e: any) {
    res.status(500).json({ found: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/h2h-quick/:playerA/:playerB?league=...
// Könnyű H2H endpoint a Napi Mérkőzések kártyákhoz.
// GT Leagues + eAdriatic League: msport.com forrás (esb fallback ha üres).
// Visszaadja az utolsó 10 egymás elleni meccset + gólátlagot.
app.get('/api/h2h-quick/:playerA/:playerB', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const pA = req.params.playerA;
    const pB = req.params.playerB;

    // GT + eAdriatic → in-memory _injectedCompleted + Supabase fallback
    if (league === 'GT Leagues' || league === 'eAdriatic League') {
      try {
        const msport = await getMsportH2H(pA, pB, league);

        // Ha van Supabase és kevés adat jött (pl. ma lejátszott meccs még nem injektálva),
        // kiegészítjük a Supabase completed_matches-ból (azonnali eredmény)
        if (supabase) {
          try {
            const sbH2H = await cached(
              `sbh2h:${pA}:${pB}:${league}`,
              () => getH2HFromSupabase(pA, pB, league, 15),
              10 * 60_000,
            );
            if (sbH2H.length > 0) {
              // Merge: msport + Supabase, dedup startTime alapján
              const seen = new Set(msport.matches.map(m => m.date));
              const now = new Date();
              const todayPrefix = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
              for (const sb of sbH2H) {
                // Supabase date: "MM/DD HH:MM" formátum
                const d = new Date(sb.startTime + 2 * 3600_000); // Budapest CEST
                const sbDate = `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
                if (!seen.has(sbDate)) {
                  seen.add(sbDate);
                  const resultA: 'win'|'loss'|'draw' = sb.goalsA > sb.goalsB ? 'win' : sb.goalsA < sb.goalsB ? 'loss' : 'draw';
                  msport.matches.push({ date: sbDate, scoreA: sb.goalsA, scoreB: sb.goalsB, totalGoals: sb.goalsA + sb.goalsB, resultA });
                }
              }
              // Újra rendezés + limit
              msport.matches.sort((a, b) => b.date.localeCompare(a.date));
              if (msport.matches.length > 10) msport.matches.length = 10;
              // todayCount újraszámolás
              (msport as any).todayCount = msport.matches.filter(m => m.date.startsWith(todayPrefix)).length;
              if (msport.matches.length > 0) {
                (msport as any).avgGoals = msport.matches.reduce((s, m) => s + m.totalGoals, 0) / msport.matches.length;
              }
            }
          } catch { /* silent */ }
        }

        return res.json(msport);
      } catch {
        return res.json({ matches: [], avgGoals: null, todayCount: 0 });
      }
    }

    // Más ligák → esoccerbet.org
    const [a, b] = await Promise.all([
      cached(`player:${pA}:${league}`, () => scrapePlayerStats(pA, league)),
      cached(`player:${pB}:${league}`, () => scrapePlayerStats(pB, league)),
    ]);

    const fromA = a.lastMatches
      .filter(m => m.opponent.toLowerCase() === pB.toLowerCase())
      .map(m => ({ date: m.date, scoreA: m.scoreHome, scoreB: m.scoreAway,
        totalGoals: m.scoreHome + m.scoreAway, resultA: m.result as 'win'|'loss'|'draw' }));

    const fromB = b.lastMatches
      .filter(m => m.opponent.toLowerCase() === pA.toLowerCase())
      .map(m => ({ date: m.date, scoreA: m.scoreAway, scoreB: m.scoreHome,
        totalGoals: m.scoreHome + m.scoreAway,
        resultA: (m.result === 'win' ? 'loss' : m.result === 'loss' ? 'win' : 'draw') as 'win'|'loss'|'draw' }));

    const seen = new Set<string>();
    const all = [...fromA, ...fromB].filter(m => {
      const key = `${m.date}|${m.scoreA}:${m.scoreB}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    all.sort((x, y) => (y.date > x.date ? 1 : -1));
    const matches = all.slice(0, 10);
    const avgGoals = matches.length > 0
      ? matches.reduce((s, m) => s + m.totalGoals, 0) / matches.length : null;
    const now = new Date();
    const todayPrefix = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
    res.json({ matches, avgGoals, todayCount: matches.filter(m => m.date.startsWith(todayPrefix)).length });
  } catch (e: any) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/daily-matches?date=MM/DD  — Napi Mérkőzések oldal adatforrása
// Visszaadja az összes GT Leagues + eAdriatic meccset a nap folyamán.
// Forrás: VPS menetrend (egész nap) + msport comingSoons (odds overlay, 60 perc előre)
app.get('/api/daily-matches', async (req, res) => {
  try {
    const dateParam = (req.query.date as string) || todayMmDd();

    // 1. VPS menetrend betöltése (egész nap, GT + ADR) — cache-elt, nem okoz extra kérést
    const vpsRaw = await getVpsSchedule().catch(() => []);
    for (const e of vpsRaw) {
      if (!e.playerHome || !e.playerAway || !e.startTime) continue;
      const RELEVANT = ['GT Leagues', 'eAdriatic League'];
      if (!RELEVANT.includes(e.league)) continue;
      const eventId = e.eventId || `vps|${e.playerHome}|${e.playerAway}|${e.startTime}`;
      if (dailyMatchMap.has(eventId)) continue; // már van msport-ból
      const date = startTimeToMmDd(e.startTime);
      dailyMatchMap.set(eventId, {
        playerA:   (e.playerHome || '').toLowerCase(),
        playerB:   (e.playerAway || '').toLowerCase(),
        teamA:     e.teamHome || e.playerHome,
        teamB:     e.teamAway || e.playerAway,
        league:    e.league,
        time:      date,
        date,
        ouLine:    e.ouLine    || 0,
        oddsOver:  e.oddsOver  || 0,
        oddsUnder: e.oddsUnder || 0,
        startTime: e.startTime,
        eventId,
      });
    }

    // 2. msport comingSoons (odds overlay, ~60 perc előre) — felülírja az odds-okat ahol van
    const fresh = await getMsportOdds();
    updateDailyAccum(fresh);

    const result = Array.from(dailyMatchMap.values())
      .filter(m => m.date === dateParam)
      .sort((a, b) => a.startTime - b.startTime);

    // 3. Supabase fallback: ha a szerver újraindult és a dailyMatchMap score mezők üresek,
    //    a Supabase completed_matches alapján pótoljuk a végeredményeket.
    //    Csak azon bejegyzéseknél fut, ahol scoreA még undefined.
    //    FONTOS: start_time Supabase-ben milliszekundumban van tárolva (JS konvenció)!
    const needsScore = result.filter(m => m.scoreA === undefined);
    if (needsScore.length > 0 && supabase) {
      try {
        const earliest = result.reduce((min, m) => Math.min(min, m.startTime), Infinity);
        const { data } = await supabase
          .from('completed_matches')
          .select('player_a,player_b,score_a,score_b,start_time')
          .in('league', ['GT Leagues', 'eAdriatic League'])
          .gte('start_time', earliest - 86400 * 1000)   // ms! (24 óra korábbig)
          .order('start_time', { ascending: false })
          .limit(300);
        if (data && data.length > 0) {
          for (const m of needsScore) {
            const pA = m.playerA.toLowerCase();
            const pB = m.playerB.toLowerCase();
            // startTime egyezés ±5 perc toleranciával (mindkét mező ms-ben)
            const found = data.find(row =>
              Math.abs(row.start_time - m.startTime) < 5 * 60 * 1000 &&
              ((row.player_a === pA && row.player_b === pB) ||
               (row.player_a === pB && row.player_b === pA))
            );
            if (found) {
              const isForward = found.player_a === pA;
              const scoreA = isForward ? found.score_a : found.score_b;
              const scoreB = isForward ? found.score_b : found.score_a;
              const entry = dailyMatchMap.get(m.eventId);
              if (entry) dailyMatchMap.set(m.eventId, { ...entry, scoreA, scoreB });
              m.scoreA = scoreA;
              m.scoreB = scoreB;
            }
          }
        }
      } catch { /* silent — score nélkül is működik */ }
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ============ SCORE ACCUMULATOR POLLER ============
// Háttérben futó poller: 60 mp-enként ellenőrzi az aznap induló meccseket.
// Ha egy meccs várható vége eltelt (+2 perc buffer), lekéri az msport match/detail
// végpontot. Ha isLive=false → a meccs véget ért → injektálja az eredményt a
// getMsportMatchResults() tárolóba → H2H adatok azonnal elérhetők lesznek.
//
// Miért kell ez? Az msport-on nincs dedikált "results" végpont, ezért az
// eredményeket menet közben gyűjtjük a detail API-ból.

const MATCH_DURATION_MS: Record<string, number> = {
  'GT Leagues':      12 * 60 * 1000,
  'eAdriatic League': 10 * 60 * 1000,
};
const _completedEventIds = new Set<string>(); // már injektált eventId-k

async function pollCompletedMatchScores(): Promise<void> {
  const now = Date.now();
  const BUFFER_AFTER  =  2 * 60 * 1000; // 2 perc buffer a meccs után
  const GIVE_UP_AFTER = 35 * 60 * 1000; // 35 percnél régebbi → már nem pollolunk

  const toCheck = Array.from(dailyMatchMap.values()).filter(m => {
    if (_completedEventIds.has(m.eventId)) return false; // már injektáltuk
    const duration = MATCH_DURATION_MS[m.league] ?? 12 * 60 * 1000;
    const elapsed = now - m.startTime;
    return elapsed >= (duration + BUFFER_AFTER) && elapsed <= (duration + GIVE_UP_AFTER);
  });

  if (toCheck.length === 0) return;
  console.log(`[accum] ${toCheck.length} meccs ellenőrzése (befejezési státusz)...`);

  const newResults: MsportMatchResult[] = [];
  for (const m of toCheck) {
    try {
      const scores = await getMsportLiveScores([m.eventId]);
      const score = scores[0];
      if (score && !score.isLive) {
        // Meccs befejezve — végeredmény rögzítése
        const d = new Date(m.startTime + 2 * 3600 * 1000); // Budapest CEST = UTC+2
        const date =
          `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ` +
          `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        newResults.push({
          eventId:   m.eventId,
          playerA:   score.playerA,   // kisbetűs (fetchMatchDetail normalizálja)
          playerB:   score.playerB,
          teamA:     m.teamA,
          teamB:     m.teamB,
          scoreA:    score.scoreA,
          scoreB:    score.scoreB,
          startTime: m.startTime,
          league:    m.league,
          date,
        });
        _completedEventIds.add(m.eventId);
        // Végeredmény visszaírása a dailyMatchMap-be → /api/daily-matches azonnal visszaadja
        const existing = dailyMatchMap.get(m.eventId);
        if (existing) {
          dailyMatchMap.set(m.eventId, { ...existing, scoreA: score.scoreA, scoreB: score.scoreB });
        }
        console.log(
          `[accum] ✅ ${score.playerA} ${score.scoreA}–${score.scoreB} ${score.playerB}` +
          ` (${m.league}, ${date})`
        );
      } else if (score && score.isLive) {
        // Még megy — legközelebb újra próbáljuk
        console.log(`[accum] ⏳ Még él: ${score.playerA} vs ${score.playerB} (${score.minute}')`);
      }
    } catch {
      // silent — legközelebb próbáljuk újra
    }
  }

  if (newResults.length > 0) {
    await injectCompletedMatches(newResults);
  }
}

// ── Live Pitch API ────────────────────────────────────────────────────────────

function normPlayer(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function playerNamesMatch(a: string, b: string) {
  return a.includes(b) || b.includes(a);
}

// Player-pár → eventId cache (60s TTL): minden 8s-os poll így nem hív Cloudbet-et
// duplán a név→ID feloldásra. A state frissességét külön 8s stale-check kezeli.
const pairToEventId = new Map<string, { eventId: number; ts: number }>();
const PAIR_CACHE_TTL_MS = 60_000;
function pairKey(a: string, b: string): string {
  return [normPlayer(a), normPlayer(b)].sort().join('|');
}

// GET /api/live-pitch?playerA=X&playerB=Y — meccs keresés + góltrack visszaad
app.get('/api/live-pitch', async (req, res) => {
  const { playerA, playerB } = req.query as { playerA?: string; playerB?: string };

  if (!playerA || !playerB) {
    return res.json(getAllMatches());
  }

  const key   = pairKey(playerA, playerB);
  const now   = Date.now();
  const cached = pairToEventId.get(key);

  let eventId: number | undefined;
  if (cached && (now - cached.ts) < PAIR_CACHE_TTL_MS) {
    eventId = cached.eventId;
  } else {
    const nA = normPlayer(playerA);
    const nB = normPlayer(playerB);

    // 1. Keresés az élő meccsek között
    const liveScores = await getCloudbetWebLiveScores().catch(() => []);
    let found = liveScores.find(s => {
      const ha = normPlayer(s.homeTeam);
      const ba = normPlayer(s.awayTeam);
      return (playerNamesMatch(ha, nA) && playerNamesMatch(ba, nB)) ||
             (playerNamesMatch(ha, nB) && playerNamesMatch(ba, nA));
    });

    // 2. Ha nincs élőben, megnézzük a közelgő menetrendet
    if (!found) {
      const schedule = await getCloudbetWebSchedule().catch(() => []);
      const match = schedule.find(s => {
        const ha = normPlayer(s.homeTeam);
        const ba = normPlayer(s.awayTeam);
        return (playerNamesMatch(ha, nA) && playerNamesMatch(ba, nB)) ||
               (playerNamesMatch(ha, nB) && playerNamesMatch(ba, nA));
      });
      if (match) {
        found = {
          eventId:          match.id,
          homeTeam:         match.homeTeam,
          awayTeam:         match.awayTeam,
          league:           match.league,
          homeScore:        0,
          awayScore:        0,
          matchTimeSeconds: 0,
          eventStatus:      'not_started',
          eventTime:        match.startTime ?? '',
          updatedAt:        new Date().toISOString(),
        };
      }
    }

    if (!found) return res.status(404).json({ error: 'Meccs nem található' });

    ensureTracked(found.eventId, {
      homeTeam: found.homeTeam,
      awayTeam: found.awayTeam,
      league:   found.league,
    });
    eventId = found.eventId;
    pairToEventId.set(key, { eventId, ts: now });
  }

  // 8s freshness check — ugyanaz mint a /:eventId endpoint-nál
  const existing = getMatch(eventId);
  const staleMs  = existing
    ? Date.now() - new Date(existing.lastUpdated).getTime()
    : Infinity;
  const state = staleMs > 8_000
    ? (await refreshMatch(eventId)) ?? existing
    : existing;

  if (!state) return res.status(404).json({ error: 'state not found' });
  res.json(state);
});

// GET /api/live-pitch/:eventId — közvetlen eventId alapú lekérés
app.get('/api/live-pitch/:eventId', async (req, res) => {
  const eventId = Number(req.params.eventId);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid eventId' });

  ensureTracked(eventId);
  const existing = getMatch(eventId);

  // Csak akkor kérdezzük le ha régebbi mint 8s
  const staleMs = existing
    ? Date.now() - new Date(existing.lastUpdated).getTime()
    : Infinity;

  const state = staleMs > 8_000 ? await refreshMatch(eventId) : existing;
  if (!state) return res.status(404).json({ error: 'not found' });
  res.json(state);
});

// ============ VÉGÜK ============

const PORT = parseInt(process.env.PORT || '3005', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`--- Szerver fut: ${PORT} ---`);

  // Load Telegram config from env (if set)
  loadConfigFromEnv();

  // Start background scanners — kellően késleltetve és ritkán, hogy ne okozzanak tiltást msport-on
  // FONTOS: scannerek csak cache-elt getMsportOdds()-t hívnak (10 perces cache) → max 6 kérés/óra
  setTimeout(() => startScanner(20 * 60 * 1000), 60_000);        // top-tips scan: 20 percenként, 1 perc után indul
  setTimeout(() => startTrendScanner(10 * 60 * 1000), 3 * 60_000); // trend scan: 10 percenként, 3 perc után indul
  startMatchPoller(); // live pitch gól-tracker (10s, Cloudbet alapú)

  // Start Telegram bot polling for commands
  startBotPolling(handleBotCommand);

  // Cloudbet Web Live Score Poller — 30 másodpercenként fut (meccs idők: 17-02h)
  // Figyeli az élő meccseket és menti a befejezett meccsek eredményét a H2H DB-be.
  // Nem igényel API kulcsot — a cloudbet.com belső API-ját használja.
  const _cbCompletedEventIds = new Set<string>();
  (function startCloudbetWebPoller() {
    const poll = async () => {
      try {
        // Időablak: alapesetben 17:00–02:00 Budapest. Ha az msport rate-limited,
        // akkor 24/7 fut → fallback a completed_matches feltöltéshez.
        const nowHour = new Date(Date.now() + 2 * 3600_000).getUTCHours();
        const inEveningWindow = !(nowHour < 17 && nowHour > 2);
        if (!inEveningWindow && !isMsportRateLimited()) return; // pihenő idő (msport viszi)

        // Cache törlés → friss adat kérése (30mp-enként egyszer hívjuk)
        clearCloudbetWebCache();
        const events = await getCloudbetWebAllEvents();

        const live     = events.filter(e => e.eventStatus === 'in_progress' || e.status === 'TRADING_LIVE');
        const finished = events.filter(e => e.eventStatus === 'finished' || e.status === 'RESULTED');

        if (live.length > 0) {
          console.log(`[cloudbet-web-poller] ⚽ Élő: ${live.map(e => `${e.homeTeam} ${e.homeScore ?? '?'}-${e.awayScore ?? '?'} ${e.awayTeam}`).join(' | ')}`);
        }
        if (finished.length > 0) {
          // Befejezett meccsek konvertálása MsportMatchResult formára és injektálása
          // (a Supabase completed_matches táblába is — msport rate-limit fallback)
          const newResults: MsportMatchResult[] = [];
          for (const e of finished) {
            const eventId = String(e.id);
            if (_cbCompletedEventIds.has(eventId)) continue;
            if (e.homeScore == null || e.awayScore == null) continue;
            const startMs = Date.parse(e.startTime);
            if (!Number.isFinite(startMs)) continue;
            const d = new Date(startMs + 2 * 3600 * 1000); // Budapest CEST = UTC+2
            const date =
              `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ` +
              `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            newResults.push({
              eventId,
              playerA: (e.homeTeam || '').toLowerCase(),
              playerB: (e.awayTeam || '').toLowerCase(),
              teamA: '',
              teamB: '',
              scoreA: e.homeScore,
              scoreB: e.awayScore,
              startTime: startMs,
              league: e.league || '',
              date,
            });
            _cbCompletedEventIds.add(eventId);
          }
          if (newResults.length > 0) {
            const added = await injectCompletedMatches(newResults);
            console.log(`[cloudbet-web-poller] ✅ Befejezett: ${finished.length} meccs, +${added} új Supabase-be mentve`);
          } else {
            console.log(`[cloudbet-web-poller] ✅ Befejezett: ${finished.length} meccs (mind már mentve)`);
          }
        }
      } catch (e) {
        console.error('[cloudbet-web-poller] hiba:', e);
      }
    };

    // 5 perccel indítás után kezdjük (szerver inicializálás után)
    setTimeout(() => {
      poll();
      setInterval(poll, 5 * 60_000); // 5 percenként (Supabase egress csökkentés)
    }, 5 * 60_000);

    console.log('[cloudbet-web] Live score poller inicializálva (5 perc múlva indul)');
  })();

  // Lezárt meccsek score pollozása 60 másodpercenként (dailyMatchMap alapján)
  setInterval(pollCompletedMatchScores, 2 * 60 * 1000); // 2 percenként (Supabase egress csökkentés)

  // Fixture-alapú szinkron: msport fixtures API → Supabase (30 percenként)
  // Ez a megbízható forrás — nem függ a dailyMatchMap-től
  const syncFixtures = async () => {
    if (isMsportRateLimited()) return; // ne próbálkozzunk ha rate-limitedek vagyunk
    try {
      clearFixtureCache(); // friss adatot akarunk
      const fixtures = await scrapeMsportFixtures();
      if (fixtures.length > 0) {
        const added = await injectCompletedMatches(fixtures);
        if (added > 0) console.log(`[accum-sync] +${added} meccs szinkronizálva fixtures API-ból`);
      }
    } catch (e) {
      console.error('[accum-sync] hiba:', e);
    }
  };
  setTimeout(syncFixtures, 2 * 60 * 1000);          // 2 perc után első futás
  setInterval(syncFixtures, 30 * 60 * 1000);         // majd 30 percenként (kevesebb msport hívás)

  // Napi takarítás: régi injektált rekordok eltávolítása óránként
  setInterval(clearOldInjectedMatches, 60 * 60 * 1000);

  // Supabase: lezárt meccsek betöltése restart után (60 nap előzmény)
  initCompletedMatchesFromDb().catch(e => console.error('[startup] initFromDb hiba:', e));

  // VPS live-tracked results szinkronizálása 10 percenként
  // A VPS figyeli az in-play meccseket és menti a befejezetteket — pótolja az msport API-t
  setTimeout(() => {
    fetchVpsResults().catch(() => {});
    setInterval(() => fetchVpsResults().catch(() => {}), VPS_RESULTS_TTL);
  }, 30 * 1000); // 30mp késés (szerver inicializálás után)
});

// SPA fallback — az összes API endpoint UTÁN, minden nem-API route az index.html-t kapja
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
