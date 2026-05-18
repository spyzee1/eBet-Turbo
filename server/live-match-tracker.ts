// Live Match Tracker — góldetektálás Cloudbet polling alapján
// fetchSingleEvent() hívással 10s-onként frissíti az aktív meccseket
// és eltárolja a gólokat (mikor, melyik csapat) memóriában

import { fetchSingleEvent } from './cloudbet-web-scraper.js';
import { getCloudbetApiLiveScores } from './cloudbet-scraper.js';
import { getAllLiveScores } from './vegas-scraper.js';

// ── Típusok ───────────────────────────────────────────────────────────────────

export interface GoalEvent {
  timeSeconds: number;   // meccsidő (s) amikor a gól esett
  homeScore:   number;   // állás a gól UTÁN
  awayScore:   number;
  side:        'home' | 'away';
}

export interface LiveMatchState {
  eventId:          number;
  homeTeam:         string;
  awayTeam:         string;
  league:           string;
  homeScore:        number;
  awayScore:        number;
  matchTimeSeconds: number;
  eventStatus:      'not_started' | 'in_progress' | 'finished';
  goals:            GoalEvent[];
  lastUpdated:      string;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const tracked     = new Map<number, LiveMatchState>();
const refreshLock = new Set<number>(); // megakadályozza a párhuzamos refreshMatch hívást

// ── Gól deduplication ────────────────────────────────────────────────────────

function dedupeGoals(goals: GoalEvent[]): GoalEvent[] {
  const seen = new Set<string>();
  return goals.filter(g => {
    const key = `${g.timeSeconds}-${g.side}-${g.homeScore}-${g.awayScore}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Gól detektálás ────────────────────────────────────────────────────────────

function detectNewGoals(
  prev: { homeScore: number; awayScore: number; matchTimeSeconds: number },
  curr: { homeScore: number; awayScore: number; matchTimeSeconds: number },
): GoalEvent[] {
  const goals: GoalEvent[] = [];
  let rH = prev.homeScore;
  let rA = prev.awayScore;

  for (let i = 0; i < curr.homeScore - prev.homeScore; i++) {
    rH++;
    goals.push({ timeSeconds: curr.matchTimeSeconds, homeScore: rH, awayScore: rA, side: 'home' });
  }
  for (let i = 0; i < curr.awayScore - prev.awayScore; i++) {
    rA++;
    goals.push({ timeSeconds: curr.matchTimeSeconds, homeScore: rH, awayScore: rA, side: 'away' });
  }
  return goals;
}

// ── Publikus API ──────────────────────────────────────────────────────────────

export function getMatch(eventId: number): LiveMatchState | null {
  return tracked.get(eventId) ?? null;
}

export function getAllMatches(): LiveMatchState[] {
  return Array.from(tracked.values());
}

export function ensureTracked(eventId: number, seed: Partial<LiveMatchState> = {}) {
  if (!tracked.has(eventId)) {
    tracked.set(eventId, {
      eventId,
      homeTeam:         seed.homeTeam  ?? '',
      awayTeam:         seed.awayTeam  ?? '',
      league:           seed.league    ?? '',
      homeScore:        0,
      awayScore:        0,
      matchTimeSeconds: 0,
      eventStatus:      'not_started',
      goals:            [],
      lastUpdated:      new Date().toISOString(),
    });
  }
}

export async function refreshMatch(eventId: number): Promise<LiveMatchState | null> {
  if (refreshLock.has(eventId)) return getMatch(eventId);
  refreshLock.add(eventId);
  try {
    return await _doRefresh(eventId);
  } finally {
    refreshLock.delete(eventId);
  }
}

async function _doRefresh(eventId: number): Promise<LiveMatchState | null> {
  const ev = await fetchSingleEvent(eventId);

  // Ha cloudbet-web blokkolva → cloudbet-api live scores fallback
  if (!ev) {
    try {
      const liveScores = await getCloudbetApiLiveScores();
      const apiMatch   = liveScores.find(s => s.eventId === eventId);
      if (apiMatch && apiMatch.isLive) {
        const prev             = tracked.get(eventId);
        let homeScore          = apiMatch.scoreA;
        let awayScore          = apiMatch.scoreB;
        let scoreKnown         = apiMatch.scoreKnown;
        const matchTimeSeconds = apiMatch.minute * 60;

        // Ha cloudbet-api nem adja a pontszámot, Altenar (GT Leagues) cache-ből pótoljuk
        if (!scoreKnown) {
          try {
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const nA = norm(apiMatch.playerA), nB = norm(apiMatch.playerB);
            const altenarScores = await getAllLiveScores();
            const alt = altenarScores.find(a => {
              const aA = norm(a.playerA), aB = norm(a.playerB);
              return (aA.includes(nA) || nA.includes(aA)) && (aB.includes(nB) || nB.includes(aB))
                  || (aA.includes(nB) || nB.includes(aA)) && (aB.includes(nA) || nA.includes(aB));
            });
            if (alt) { homeScore = alt.scoreA; awayScore = alt.scoreB; scoreKnown = true; }
          } catch { /* skip */ }
        }

        const newGoals = (prev && scoreKnown)
          ? detectNewGoals(
              { homeScore: prev.homeScore, awayScore: prev.awayScore, matchTimeSeconds: prev.matchTimeSeconds },
              { homeScore, awayScore, matchTimeSeconds },
            )
          : [];

        const state: LiveMatchState = {
          eventId,
          homeTeam:         apiMatch.teamA || prev?.homeTeam || '',
          awayTeam:         apiMatch.teamB || prev?.awayTeam || '',
          league:           apiMatch.league || prev?.league  || '',
          homeScore:        scoreKnown ? homeScore : (prev?.homeScore ?? 0),
          awayScore:        scoreKnown ? awayScore : (prev?.awayScore ?? 0),
          matchTimeSeconds,
          eventStatus:      'in_progress',
          goals:            dedupeGoals([...(prev?.goals ?? []), ...newGoals]),
          lastUpdated:      new Date().toISOString(),
        };

        tracked.set(eventId, state);
        return state;
      }
    } catch { /* skip */ }

    return getMatch(eventId);
  }

  const prev     = tracked.get(eventId);
  const isFinish = ev.eventStatus === 'finished' || ev.status === 'RESULTED';
  const isLive   = ev.eventStatus === 'in_progress' || ev.status === 'TRADING_LIVE';

  const homeScore        = ev.homeScore        ?? 0;
  const awayScore        = ev.awayScore        ?? 0;
  const matchTimeSeconds = ev.matchTimeSeconds > 0
    ? ev.matchTimeSeconds
    : (prev?.matchTimeSeconds ?? 0);

  const newGoals = prev
    ? detectNewGoals(
        { homeScore: prev.homeScore, awayScore: prev.awayScore, matchTimeSeconds: prev.matchTimeSeconds },
        { homeScore, awayScore, matchTimeSeconds },
      )
    : [];

  const state: LiveMatchState = {
    eventId:          ev.id,
    homeTeam:         ev.homeTeam  || prev?.homeTeam  || '',
    awayTeam:         ev.awayTeam  || prev?.awayTeam  || '',
    league:           ev.league    || prev?.league    || '',
    homeScore,
    awayScore,
    matchTimeSeconds,
    eventStatus: isFinish ? 'finished' : isLive ? 'in_progress' : 'not_started',
    goals:       dedupeGoals([...(prev?.goals ?? []), ...newGoals]),
    lastUpdated: new Date().toISOString(),
  };

  tracked.set(eventId, state);

  if (isFinish) {
    // 20 perc után töröljük a memóriából
    setTimeout(() => tracked.delete(eventId), 20 * 60 * 1000);
  }

  return state;
}

// ── Háttér poller ─────────────────────────────────────────────────────────────

let _pollHandle: NodeJS.Timeout | null = null;

export function startMatchPoller() {
  if (_pollHandle) return;
  _pollHandle = setInterval(async () => {
    const ids = Array.from(tracked.entries())
      .filter(([, s]) => s.eventStatus !== 'finished')
      .map(([id]) => id);

    for (const id of ids) {
      try { await refreshMatch(id); } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 400)); // kérések szétterítése
    }
  }, 10_000);
  console.log('[LiveMatchTracker] háttér poller elindult (10s)');
}

export function stopMatchPoller() {
  if (_pollHandle) { clearInterval(_pollHandle); _pollHandle = null; }
}
