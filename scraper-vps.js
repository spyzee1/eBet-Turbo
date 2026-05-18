// eBet VPS Scraper — Hetzner CX23
// Cloudbet: menetrend (csak upcoming) + O/U odds per event
// msport:   EGYETLEN hívás/3perc → comingSoons (O/U odds) + tournaments (live score tracking)
// Futtatás: pm2 start scraper.js --name ebet-scraper

'use strict';
const express = require('express');
const axios   = require('axios');

const app  = express();
const PORT = 4000;

// ── Config ────────────────────────────────────────────────────────────────────

const CLOUDBET_URL      = 'https://www.cloudbet.com/sports-api/c/v6/sports/events?sport=esport-fifa&locale=en';
const CB_EVENT_BASE     = 'https://www.cloudbet.com/sports-api/c/v6/sports/events';
const MSPORT_LIVE       = 'https://www.msport.com/api/gh/facts-center/query/frontend/live-matches/list?sportId=sr:sport:137&sortBy=DEFAULT&marketIds';

const CB_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':         'https://www.cloudbet.com/en/esports/esport-fifa',
  'Accept':          'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

const MS_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.msport.com/',
  'Origin':          'https://www.msport.com',
  'operId':          '3',
};

const MSPORT_TOURNAMENT_MAP = {
  'sr:tournament:33496': 'GT Leagues',
  'sr:tournament:39749': 'eAdriatic League',
};

const LEAGUE_TIMEOUT_MS = {
  'GT Leagues':       16 * 60 * 1000,
  'eAdriatic League': 14 * 60 * 1000,
};
const DEFAULT_TIMEOUT_MS = 18 * 60 * 1000;

const COMPETITION_MAP = {
  'GT Nations League': 'GT Leagues',
  'eAdriatic League':  'eAdriatic League',
};

const POLL_MS = 3 * 60 * 1000; // 3 perc

// ── Cache ─────────────────────────────────────────────────────────────────────

let scheduleCache      = { schedule: [], updatedAt: '' };
let msportOddsCache    = { odds: [], updatedAt: '' };
let cloudbetOddsCache  = { odds: [], updatedAt: '' };

const liveTracker      = new Map();
const completedResults = [];
const seenCompleted    = new Set();
const MAX_COMPLETED    = 1000;

// ── Helper ────────────────────────────────────────────────────────────────────

function extractPlayer(teamName) {
  if (!teamName) return '';
  const m = teamName.match(/\(([^)]+)\)(?:\s*)$/);
  return m ? m[1].trim() : teamName.trim();
}

function teamWithoutPlayer(teamName) {
  if (!teamName) return '';
  return teamName.replace(/\s*\([^)]+\)\s*$/, '').trim() || teamName.trim();
}

function toHunTime(isoUtc) {
  const d   = new Date(isoUtc);
  const hun = new Date(d.getTime() + 2 * 3600000);
  return String(hun.getUTCHours()).padStart(2, '0') + ':' + String(hun.getUTCMinutes()).padStart(2, '0');
}

function toDateStr(isoUtc) {
  const d   = new Date(isoUtc);
  const hun = new Date(d.getTime() + 2 * 3600000);
  return String(hun.getUTCMonth() + 1).padStart(2, '0') + '/' + String(hun.getUTCDate()).padStart(2, '0');
}

function toDateLabel(ts) {
  const d  = new Date(ts + 2 * 3600000);
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h  = String(d.getUTCHours()).padStart(2, '0');
  const m  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mo}/${da} ${h}:${m}`;
}

// ── Cloudbet: menetrend ───────────────────────────────────────────────────────

async function fetchCloudbetSchedule() {
  const resp   = await axios.get(CLOUDBET_URL, { headers: CB_HEADERS, timeout: 15000 });
  const sports = resp.data?.sports ?? [];
  const schedule = [];

  for (const sport of sports) {
    for (const comp of sport.competitions ?? []) {
      const leagueName = COMPETITION_MAP[comp.name];
      if (!leagueName) continue;

      for (const ev of comp.events ?? []) {
        const homeRaw    = ev.home?.name || '';
        const awayRaw    = ev.away?.name || '';
        const playerHome = extractPlayer(homeRaw);
        const playerAway = extractPlayer(awayRaw);
        if (!playerHome || !playerAway) continue;

        const startIso = ev.cutoffTime || ev.metadata?.cutoffTime || '';
        const meta     = ev.metadata ?? {};

        schedule.push({
          eventId:     String(ev.id),
          playerHome,
          playerAway,
          teamHome:    teamWithoutPlayer(homeRaw) || homeRaw,
          teamAway:    teamWithoutPlayer(awayRaw) || awayRaw,
          league:      leagueName,
          time:        toHunTime(startIso),
          date:        toDateStr(startIso),
          startTime:   new Date(startIso).getTime(),
          status:      ev.status ?? 'TRADING',
          eventStatus: meta.eventStatus ?? 'not_started',
          homeScore:   null,
          awayScore:   null,
        });
      }
    }
  }
  return schedule;
}

// ── Cloudbet: O/U odds per event ──────────────────────────────────────────────

async function fetchCloudbetOdds(schedule) {
  const odds = [];

  for (const ev of schedule) {
    if (!ev.eventId) continue;
    try {
      const url  = `${CB_EVENT_BASE}/${ev.eventId}?locale=en`;
      const resp = await axios.get(url, { headers: CB_HEADERS, timeout: 8000 });
      const data = resp.data;

      const sels = data.markets?.['esport_fifa.total_goals']
        ?.submarkets?.['period=ft']?.selections ?? [];

      const lines = new Map();
      for (const sel of sels) {
        if (sel.status !== 'SELECTION_ENABLED') continue;
        const m = String(sel.params ?? '').match(/total=([\d.]+)/);
        if (!m) continue;
        const line = parseFloat(m[1]);
        if (!lines.has(line)) lines.set(line, { over: 0, under: 0 });
        if (sel.outcome === 'over')  lines.get(line).over  = sel.price ?? 0;
        if (sel.outcome === 'under') lines.get(line).under = sel.price ?? 0;
      }

      let bestLine = 0, bestOver = 0, bestUnder = 0;
      for (const [line, o] of lines) {
        if (o.over > 0 && o.under > 0) {
          if (!bestLine || Math.abs(o.over - 2.0) < Math.abs(bestOver - 2.0)) {
            bestLine = line; bestOver = o.over; bestUnder = o.under;
          }
        }
      }

      if (bestLine > 0) {
        odds.push({
          playerA:   ev.playerHome,
          playerB:   ev.playerAway,
          league:    ev.league,
          ouLine:    bestLine,
          oddsOver:  bestOver,
          oddsUnder: bestUnder,
        });
        console.log(`[cb-odds] ${ev.playerHome} vs ${ev.playerAway} O/U ${bestLine} (${bestOver}/${bestUnder})`);
      }

      await new Promise(r => setTimeout(r, 400)); // kérések szétterítése
    } catch (_e) { /* skip */ }
  }

  return odds;
}

// ── msport: EGYETLEN hívás → odds + live tracking ────────────────────────────

async function fetchMsportAll() {
  const resp = await axios.get(MSPORT_LIVE, { headers: MS_HEADERS, timeout: 12000 });
  const data = resp.data?.data ?? {};

  // ── 1. O/U odds (comingSoons) ──────────────────────────────────────────────
  const comingSoons = data.comingSoons ?? [];
  const odds = [];

  for (const e of comingSoons) {
    const league = MSPORT_TOURNAMENT_MAP[e.tournamentId];
    if (!league) continue;

    const playerA = extractPlayer(e.homeTeam);
    const playerB = extractPlayer(e.awayTeam);
    if (!playerA || !playerB) continue;

    const ouMkt = (e.markets ?? []).find(m => m.name === 'Over/Under');
    if (!ouMkt) continue;

    let ouLine = 0, oddsOver = 0, oddsUnder = 0;
    for (const o of ouMkt.outcomes ?? []) {
      const desc  = (o.description || '').trim();
      const overM = desc.match(/^Over\s+([\d.]+)$/i);
      const undM  = desc.match(/^Under\s+([\d.]+)$/i);
      if (overM) { ouLine = parseFloat(overM[1]); oddsOver  = parseFloat(o.odds) || 0; }
      if (undM)  {                                 oddsUnder = parseFloat(o.odds) || 0; }
    }

    if (ouLine > 0 && oddsOver > 0 && oddsUnder > 0) {
      odds.push({ playerA, playerB, league, ouLine, oddsOver, oddsUnder });
    }
  }

  // ── 2. Live score tracking (tournaments) ───────────────────────────────────
  const tournaments = data.tournaments ?? [];
  const nowSeen = new Set();

  for (const t of tournaments) {
    const league = MSPORT_TOURNAMENT_MAP[t.tournamentId];
    if (!league) continue;

    for (const ev of t.events ?? []) {
      const playerA = extractPlayer(ev.homeTeam);
      const playerB = extractPlayer(ev.awayTeam);
      if (!playerA || !playerB) continue;

      const scoreParts = (ev.scoreOfWholeMatch || '0:0').split(':');
      const scoreA  = parseInt(scoreParts[0]) || 0;
      const scoreB  = parseInt(scoreParts[1]) || 0;
      const eventId = String(ev.eventId || `${playerA}|${playerB}|${ev.startTime}`);
      const startTime = typeof ev.startTime === 'number' ? ev.startTime : Date.now();

      nowSeen.add(eventId);

      if (!liveTracker.has(eventId)) {
        liveTracker.set(eventId, {
          eventId,
          playerA: playerA.toLowerCase(),
          playerB: playerB.toLowerCase(),
          teamA:   teamWithoutPlayer(ev.homeTeam),
          teamB:   teamWithoutPlayer(ev.awayTeam),
          scoreA, scoreB, league, startTime,
          firstSeenTs: Date.now(),
          lastSeenTs:  Date.now(),
        });
        console.log(`[live] Figyelt meccs: ${playerA} vs ${playerB} [${league}]`);
      } else {
        const entry = liveTracker.get(eventId);
        if (entry.scoreA !== scoreA || entry.scoreB !== scoreB) {
          console.log(`[live] Score: ${playerA} ${scoreA}-${scoreB} ${playerB}`);
        }
        entry.scoreA     = scoreA;
        entry.scoreB     = scoreB;
        entry.lastSeenTs = Date.now();
      }
    }
  }

  // ── Időalapú befejezés ─────────────────────────────────────────────────────
  const toTimeoutComplete = [];
  const nowTs = Date.now();
  for (const [eventId, entry] of liveTracker.entries()) {
    if (!nowSeen.has(eventId)) continue;
    if (seenCompleted.has(eventId)) continue;
    const timeout = LEAGUE_TIMEOUT_MS[entry.league] || DEFAULT_TIMEOUT_MS;
    if (nowTs - entry.firstSeenTs > timeout) {
      toTimeoutComplete.push(eventId);
    }
  }
  for (const eventId of toTimeoutComplete) {
    const entry = liveTracker.get(eventId);
    seenCompleted.add(eventId);
    completedResults.push({
      eventId:   entry.eventId,
      playerA:   entry.playerA,
      playerB:   entry.playerB,
      teamA:     entry.teamA,
      teamB:     entry.teamB,
      scoreA:    entry.scoreA,
      scoreB:    entry.scoreB,
      league:    entry.league,
      startTime: entry.startTime,
      date:      toDateLabel(entry.startTime),
    });
    console.log(`[live] TIMEOUT-BEFEJEZETT: ${entry.playerA} ${entry.scoreA}-${entry.scoreB} ${entry.playerB} [${entry.league}] (${Math.round((nowTs - entry.firstSeenTs) / 60000)} perc)`);
    liveTracker.delete(eventId);
    if (completedResults.length > MAX_COMPLETED) {
      const removed = completedResults.shift();
      if (removed) seenCompleted.delete(removed.eventId);
    }
  }

  // ── Eltűnt meccsek → befejezett ───────────────────────────────────────────
  for (const [eventId, entry] of liveTracker.entries()) {
    if (nowSeen.has(eventId)) continue;
    if (!seenCompleted.has(eventId)) {
      seenCompleted.add(eventId);
      completedResults.push({
        eventId:   entry.eventId,
        playerA:   entry.playerA,
        playerB:   entry.playerB,
        teamA:     entry.teamA,
        teamB:     entry.teamB,
        scoreA:    entry.scoreA,
        scoreB:    entry.scoreB,
        league:    entry.league,
        startTime: entry.startTime,
        date:      toDateLabel(entry.startTime),
      });
      console.log(`[live] ELTUNT-BEFEJEZETT: ${entry.playerA} ${entry.scoreA}-${entry.scoreB} ${entry.playerB} [${entry.league}]`);
      if (completedResults.length > MAX_COMPLETED) {
        const removed = completedResults.shift();
        if (removed) seenCompleted.delete(removed.eventId);
      }
    }
    liveTracker.delete(eventId);
  }

  return { odds };
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function refresh() {
  const [cbResult, msResult] = await Promise.allSettled([
    fetchCloudbetSchedule(),
    fetchMsportAll(),
  ]);

  if (cbResult.status === 'fulfilled') {
    scheduleCache = { schedule: cbResult.value, updatedAt: new Date().toISOString() };
    console.log(`[cloudbet] ${cbResult.value.length} meccs (GT: ${cbResult.value.filter(m => m.league === 'GT Leagues').length}, ADR: ${cbResult.value.filter(m => m.league === 'eAdriatic League').length})`);

    // Cloudbet O/U odds lekérése az ütemezett meccsekhez (VPS IP-ről, nem blokkolt)
    try {
      const cbOdds = await fetchCloudbetOdds(cbResult.value);
      cloudbetOddsCache = { odds: cbOdds, updatedAt: new Date().toISOString() };
      console.log(`[cb-odds] ${cbOdds.length} odds cacheben`);
    } catch (e) {
      console.warn('[cb-odds] hiba:', e.message);
    }
  } else {
    console.warn('[cloudbet] hiba:', cbResult.reason?.message);
  }

  if (msResult.status === 'fulfilled') {
    msportOddsCache = { odds: msResult.value.odds, updatedAt: new Date().toISOString() };
    console.log(`[msport] ${msResult.value.odds.length} odds | live: ${liveTracker.size} | befejezett: ${completedResults.length}`);
  } else {
    console.warn('[msport] hiba:', msResult.reason?.message);
  }
}

// Indulás
refresh();
setInterval(refresh, POLL_MS);

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    ok:             true,
    updatedAt:      scheduleCache.updatedAt,
    count:          scheduleCache.schedule.length,
    oddsCount:      msportOddsCache.odds.length,
    cbOddsCount:    cloudbetOddsCache.odds.length,
    liveCount:      liveTracker.size,
    resultsCount:   completedResults.length,
    pollMs:         POLL_MS,
  });
});

app.get('/schedule',         (_req, res) => res.json(scheduleCache));
app.get('/msport-odds',      (_req, res) => res.json(msportOddsCache));
app.get('/cloudbet-odds',    (_req, res) => res.json(cloudbetOddsCache));
app.get('/msport-results',   (_req, res) => {
  const sorted = completedResults.slice().sort((a, b) => b.startTime - a.startTime);
  res.json({ results: sorted, updatedAt: new Date().toISOString(), count: sorted.length });
});

app.listen(PORT, () => {
  console.log(`[vps] Fut: http://localhost:${PORT} | poll: ${POLL_MS / 1000}s`);
  console.log('[vps] msport: 1 keres/3perc (odds + live tracking egyszerre)');
  console.log('[vps] cloudbet: schedule + O/U odds per event');
});
