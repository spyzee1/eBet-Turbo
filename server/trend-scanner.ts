// Intraday H2H Trend Bot
// Detects same-day rising goal patterns between two players and sends Telegram alerts.
// Logic: if the same pair played 2+ times today with increasing goal totals (or avg > O/U line),
// the bookmaker's line is stale → value bet opportunity on OVER.

import { sendMessage, isTelegramConfigured } from './telegram.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrendH2HMatch {
  time: string;
  goalsA: number;
  goalsB: number;
  total: number;
}

export interface OddsEntry {
  ouLine: number;
  oddsOver?: number;
}

export interface TrendSignal {
  playerA: string;
  playerB: string;
  league: string;
  nextMatchTime: string;
  minutesUntil: number;
  todayH2H: TrendH2HMatch[];
  trendSlope: number;
  avgTotalGoals: number;
  // Alapértelmezett vonal (msport-elsőként fallback logika szerint)
  ouLine: number;
  oddsOver?: number;
  oddsSource?: string;
  // Összes forrás odds-ai — frontend a user-selected source szerint választ
  allOdds?: Record<string, OddsEntry>;
  aboveLinePct: number;
  aboveLineCount: number;
  lastTwoAboveLine: boolean;
  signalStrength: 'VALUE' | 'TREND';
  yesterdayAvg?: number;
  prevDayAvg?: number;
  isSuper?: boolean;
}

interface TrendScannerState {
  lastRun: number;
  lastRunISO: string | null;
  lastSignalCount: number;
  pushedCount: number;
  errors: number;
  isRunning: boolean;
}

export type ScheduleItem = {
  playerHome: string;
  playerAway: string;
  league: string;
  time: string;
  date?: string;
};

export type PlayerStatsLite = {
  lastMatches: Array<{
    date: string;
    opponent: string;
    scoreHome: number;
    scoreAway: number;
  }>;
};

export type TrendScannerDeps = {
  getSchedule: () => Promise<ScheduleItem[]>;
  getPlayerStats: (name: string, league: string) => Promise<PlayerStatsLite>;
  // Minden elérhető forrás oddsait adja vissza
  getAllOdds: (playerA: string, playerB: string) => Promise<Record<string, OddsEntry>>;
};

// ── State ─────────────────────────────────────────────────────────────────────

const state: TrendScannerState = {
  lastRun: 0,
  lastRunISO: null,
  lastSignalCount: 0,
  pushedCount: 0,
  errors: 0,
  isRunning: false,
};

let intervalHandle: NodeJS.Timeout | null = null;
const pushedKeys = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayMMDD(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function offsetMMDD(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function h2hAvgForDate(
  lastMatches: Array<{ date: string; opponent: string; scoreHome: number; scoreAway: number }>,
  datePrefix: string,
  opponentName: string,
): number | undefined {
  const matches = lastMatches.filter(m =>
    m.date.startsWith(datePrefix) &&
    m.opponent.toLowerCase() === opponentName.toLowerCase()
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((s, m) => s + m.scoreHome + m.scoreAway, 0) / matches.length;
}

function trendKey(signal: TrendSignal): string {
  const players = [signal.playerA.toLowerCase(), signal.playerB.toLowerCase()].sort().join('-');
  return `${players}|${signal.nextMatchTime}`;
}

// Linear regression slope over values array
function calcSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Core scan logic ────────────────────────────────────────────────────────────

// Csak e két liga érvényes — msport.com odds-ok elérhetők
const ALLOWED_LEAGUES = new Set(['GT Leagues', 'eAdriatic League']);

export async function runTrendScan(deps: TrendScannerDeps): Promise<TrendSignal[]> {
  const schedule = await deps.getSchedule();
  const today = todayMMDD();
  const signals: TrendSignal[] = [];

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Engedélyezett ligák, következő 30 percen belül VAGY már élő (meccs idején belül)
  const upcoming = schedule.filter(m => {
    if (!ALLOWED_LEAGUES.has(m.league)) return false;
    const [mH, mM] = (m.time || '00:00').split(':').map(Number);
    let diff = mH * 60 + mM - nowMin;
    if (diff < -720) diff += 1440;
    if (diff > 720) diff -= 1440;
    // Liga-specifikus meccs hossz (perc) — élő meccsek is bennmaradnak
    const matchDuration = m.league === 'GT Leagues' ? 12 : m.league === 'eAdriatic League' ? 10 : 8;
    return diff >= -matchDuration && diff <= 30;
  });

  // Deduplikálás (ugyanaz a pár ne kerüljön kétszer)
  const seen = new Set<string>();
  const unique = upcoming.filter(m => {
    const k = [m.playerHome.toLowerCase(), m.playerAway.toLowerCase()].sort().join('-') + '|' + m.league;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const match of unique) {
    try {
      // Összes elérhető forrás oddsainak lekérése
      const allOdds = await deps.getAllOdds(match.playerHome, match.playerAway);
      // Default vonal: msport elsőként, majd cloudbet, vegas
      const defaultEntry =
        allOdds['msport.com'] ||
        allOdds['cloudbet'] ||
        allOdds['vegas.hu'] ||
        Object.values(allOdds)[0];
      if (!defaultEntry || !(defaultEntry.ouLine > 0)) continue;
      const ouLine = defaultEntry.ouLine;
      const oddsOver = defaultEntry.oddsOver;
      const oddsSource = Object.keys(allOdds).find(k => allOdds[k] === defaultEntry);

      const statsA = await deps.getPlayerStats(match.playerHome, match.league);

      // Mai H2H meccsek legrégebbitől a legújabbig
      const todayH2H: TrendH2HMatch[] = statsA.lastMatches
        .filter(m => {
          const isToday = m.date.startsWith(today) || m.date.includes(today);
          const vsB = m.opponent.toLowerCase() === match.playerAway.toLowerCase();
          return isToday && vsB;
        })
        .map(m => ({
          time: m.date,
          goalsA: m.scoreHome,
          goalsB: m.scoreAway,
          total: m.scoreHome + m.scoreAway,
        }))
        .reverse(); // legrégebbi → legújabb

      if (todayH2H.length < 4) continue;

      const totals = todayH2H.map(m => m.total);
      const slope = calcSlope(totals);
      const avgTotalGoals = totals.reduce((s, v) => s + v, 0) / totals.length;

      // Tegnapi és tegnap előtti gólátlag (ugyanez a pár)
      const yesterdayAvg = h2hAvgForDate(statsA.lastMatches, offsetMMDD(-1), match.playerAway);
      const prevDayAvg   = h2hAvgForDate(statsA.lastMatches, offsetMMDD(-2), match.playerAway);

      // Hány mai meccs volt a vonal felett
      const aboveLineCount = totals.filter(t => t > ouLine).length;
      const aboveLinePct = aboveLineCount / totals.length;

      // Utolsó 2 meccs mindkettő a vonal felett?
      const lastTwo = todayH2H.slice(-2);
      const lastTwoAboveLine = lastTwo.length === 2 && lastTwo.every(m => m.total > ouLine);

      // ── Erős Value: ≥70% a vonal felett ──────────────────────────────
      const isValue = aboveLinePct >= 0.70;

      // ── Erős Trend: ≥4 meccs + emelkedő trend + utolsó 2 a vonal felett ──
      const isTrend = todayH2H.length >= 4 && slope > 0 && lastTwoAboveLine;

      if (!isValue && !isTrend) continue;

      const [mH, mM] = (match.time || '00:00').split(':').map(Number);
      let minutesUntil = mH * 60 + mM - nowMin;
      if (minutesUntil < 0) minutesUntil += 1440;

      signals.push({
        playerA: match.playerHome,
        playerB: match.playerAway,
        league: match.league,
        nextMatchTime: match.time,
        minutesUntil,
        todayH2H,
        trendSlope: slope,
        avgTotalGoals,
        ouLine,
        oddsOver,
        aboveLinePct,
        aboveLineCount,
        lastTwoAboveLine,
        signalStrength: isTrend ? 'TREND' : 'VALUE',
        oddsSource,
        allOdds,
        yesterdayAvg,
        prevDayAvg,
        isSuper: (
          avgTotalGoals > ouLine &&
          yesterdayAvg !== undefined && yesterdayAvg > ouLine &&
          prevDayAvg   !== undefined && prevDayAvg   > ouLine
        ),
      });
    } catch { /* skip */ }
  }

  return signals;
}

// ── Telegram formatting ───────────────────────────────────────────────────────

function formatTrendAlert(signal: TrendSignal): string {
  const isValue = signal.signalStrength === 'VALUE';
  const icon = isValue ? '💰' : '🚀';
  const title = isValue ? 'ERŐS VALUE' : 'ERŐS TREND';
  const lines: string[] = [];

  lines.push(`${icon} *${title} — OVER ${signal.ouLine}*`);
  lines.push('');
  lines.push(`*${signal.playerA}* vs *${signal.playerB}*`);
  lines.push(`_${signal.league}_  ·  *${signal.nextMatchTime}* (${signal.minutesUntil} perc múlva)`);
  lines.push('');
  lines.push(`*O/U vonal (Vegas):* ${signal.ouLine}`);
  lines.push('');
  lines.push('*Mai H2H:*');

  signal.todayH2H.forEach((m, i) => {
    const aboveLine = m.total > signal.ouLine;
    const arrow = i > 0 && m.total > signal.todayH2H[i - 1].total ? ' ↑' : i > 0 && m.total < signal.todayH2H[i - 1].total ? ' ↓' : '';
    const marker = aboveLine ? '✅' : '❌';
    lines.push(`  ${marker} ${m.goalsA}–${m.goalsB} (${m.total} gól)${arrow}`);
  });

  lines.push('');
  if (isValue) {
    lines.push(`*Vonal felett:* ${signal.aboveLineCount}/${signal.todayH2H.length} meccs (${Math.round(signal.aboveLinePct * 100)}%)`);
  } else {
    lines.push(`*Trend:* ${signal.trendSlope >= 0 ? '+' : ''}${signal.trendSlope.toFixed(1)} gól/meccs`);
    lines.push(`*Utolsó 2 meccs:* mindkettő a vonal felett ✅`);
  }
  lines.push(`*Átlag:* ${signal.avgTotalGoals.toFixed(1)} gól`);

  lines.push('');
  lines.push(`_eBet Trend Bot · ${new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}_`);

  return lines.join('\n');
}

export async function pushTrendSignals(signals: TrendSignal[]): Promise<number> {
  if (!isTelegramConfigured()) return 0;
  let pushed = 0;

  // STRONG signals first, then MEDIUM
  const sorted = [...signals].sort((a, b) =>
    a.signalStrength === b.signalStrength ? 0 : a.signalStrength === 'STRONG' ? -1 : 1
  );

  for (const signal of sorted) {
    const key = trendKey(signal);
    if (pushedKeys.has(key)) continue;

    const ok = await sendMessage(formatTrendAlert(signal));
    if (ok) {
      pushedKeys.add(key);
      state.pushedCount++;
      pushed++;
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Keep pushed key set bounded
  if (pushedKeys.size > 300) {
    const arr = Array.from(pushedKeys);
    const trimmed = new Set(arr.slice(arr.length - 300));
    pushedKeys.clear();
    for (const k of trimmed) pushedKeys.add(k);
  }

  return pushed;
}

// ── Interval runner ───────────────────────────────────────────────────────────

let deps: TrendScannerDeps | null = null;

export function configureTrendScanner(d: TrendScannerDeps) {
  deps = d;
}

async function tick() {
  if (!deps) return;
  try {
    const signals = await runTrendScan(deps);
    state.lastRun = Date.now();
    state.lastRunISO = new Date().toISOString();
    state.lastSignalCount = signals.length;

    if (signals.length > 0) {
      await pushTrendSignals(signals);
    }
  } catch (e) {
    state.errors++;
    console.error('[TrendScanner] error:', e);
  }
}

export function startTrendScanner(intervalMs: number = 5 * 60 * 1000) {
  if (intervalHandle) return;
  state.isRunning = true;
  console.log(`[TrendScanner] started (interval: ${intervalMs / 1000}s)`);
  tick(); // run immediately
  intervalHandle = setInterval(tick, intervalMs);
}

export function stopTrendScanner() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    state.isRunning = false;
  }
}

export function getTrendScannerState(): TrendScannerState {
  return { ...state };
}

export async function runTrendScanOnce(): Promise<{ signals: TrendSignal[]; pushed: number }> {
  if (!deps) return { signals: [], pushed: 0 };
  const signals = await runTrendScan(deps);
  state.lastRun = Date.now();
  state.lastRunISO = new Date().toISOString();
  state.lastSignalCount = signals.length;
  const pushed = await pushTrendSignals(signals);
  return { signals, pushed };
}
