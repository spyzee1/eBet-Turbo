// LivePitch — élő mérkőzés pálya vizualizáció
// Adatforrás: Cloudbet belső API (polling, 8s)
// Tartalom: góldetektálás, labda-szimuláció, gólflash, idővonal

import { useState, useEffect, useRef } from 'react';
import { fetchLivePitch, LiveMatchState, LiveGoalEvent } from '../api';

// ── Konstansok ────────────────────────────────────────────────────────────────

const PW = 520;
const PH = 300;

function matchDuration(league: string): number {
  if (league.includes('GT')) return 12 * 60;
  if (league.includes('Adriatic')) return 10 * 60;
  return 8 * 60;
}

function shortName(full: string): string {
  const m = full.match(/\(([^)]+)\)$/);
  return m ? m[1] : full.split(' ').pop() ?? full;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Labda adogatási pontok (játékos pozíciók vizuálisan eltávolítva, de mozgáshoz megtartva) ──

const HOME_POSITIONS: [number, number][] = [
  [4,  50],
  [19, 22], [19, 42], [19, 58], [19, 78],
  [36, 30], [36, 50], [36, 70],
  [50, 22], [50, 50], [50, 78],
];

const AWAY_POSITIONS: [number, number][] = [
  [96, 50],
  [81, 22], [81, 42], [81, 58], [81, 78],
  [64, 30], [64, 50], [64, 70],
  [50, 22], [50, 50], [50, 78],
];

// Előre kiszámított px pozíciók
const ALL_PLAYER_PX = [
  ...HOME_POSITIONS.map(([xp, yp]) => ({ x: (xp / 100) * PW, y: (yp / 100) * PH })),
  ...AWAY_POSITIONS.map(([xp, yp]) => ({ x: (xp / 100) * PW, y: (yp / 100) * PH })),
];
const HOME_FWD_PX = HOME_POSITIONS.slice(8).map(([xp, yp]) => ({ x: (xp / 100) * PW, y: (yp / 100) * PH }));
const AWAY_FWD_PX = AWAY_POSITIONS.slice(8).map(([xp, yp]) => ({ x: (xp / 100) * PW, y: (yp / 100) * PH }));

// ── SVG Pálya ─────────────────────────────────────────────────────────────────

interface PitchSVGProps {
  flashSide:    'home' | 'away' | null;
  ballX:        number;
  ballY:        number;
  ballTransDur: number;
  isFinished:   boolean;
  homeScore:    number;
  awayScore:    number;
}

function PitchSVG({ flashSide, ballX, ballY, ballTransDur, isFinished, homeScore, awayScore }: PitchSVGProps) {

  return (
    <svg
      viewBox={`0 0 ${PW} ${PH}`}
      style={{ width: '100%', borderRadius: '12px', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="pitchGoalGlow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="pitchBallGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Háttér csíkok */}
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={i * (PW / 9)} y={0} width={PW / 9} height={PH}
          fill={i % 2 === 0 ? '#1a5c30' : '#1e6635'} />
      ))}

      {/* Gól flash overlay */}
      {flashSide && (
        <rect x={0} y={0} width={PW} height={PH}
          fill={flashSide === 'home' ? 'rgba(250,204,21,0.22)' : 'rgba(96,165,250,0.28)'} />
      )}

      {/* Pályarajz */}
      <rect x={18} y={14} width={PW - 36} height={PH - 28}
        fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} rx={4} />
      <line x1={PW / 2} y1={14} x2={PW / 2} y2={PH - 14}
        stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
      <circle cx={PW / 2} cy={PH / 2} r={48}
        fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
      <circle cx={PW / 2} cy={PH / 2} r={3} fill="rgba(255,255,255,0.55)" />

      {/* Büntető területek */}
      <rect x={18} y={PH / 2 - 56} width={88} height={112}
        fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
      <rect x={18} y={PH / 2 - 28} width={42} height={56}
        fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
      <rect x={PW - 106} y={PH / 2 - 56} width={88} height={112}
        fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
      <rect x={PW - 60} y={PH / 2 - 28} width={42} height={56}
        fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />

      {/* Kapuk */}
      <rect x={4} y={PH / 2 - 20} width={14} height={40}
        fill="rgba(255,255,255,0.1)" stroke="white" strokeWidth={2} rx={2} />
      <rect x={PW - 18} y={PH / 2 - 20} width={14} height={40}
        fill="rgba(255,255,255,0.1)" stroke="white" strokeWidth={2} rx={2} />

      {/* Labda — CSS transform, JS mozgatja */}
      {!isFinished && (
        <g style={{
          transform: `translate(${ballX}px, ${ballY}px)`,
          transition: `transform ${ballTransDur}s linear`,
        }}>
          <text textAnchor="middle" dominantBaseline="central" fontSize={22}
            style={{ filter: flashSide ? 'drop-shadow(0 0 5px rgba(255,255,255,0.9))' : undefined }}
          >⚽</text>
        </g>
      )}

      {/* VÉGE overlay a pálya közepén */}
      {isFinished && (
        <g>
          <rect x={PW/2 - 95} y={PH/2 - 48} width={190} height={96} rx={12}
            fill="rgba(0,0,0,0.82)" />
          <text x={PW/2} y={PH/2 - 6} textAnchor="middle"
            fill="white" fontSize={34} fontWeight="bold" letterSpacing="8"
            fontFamily="system-ui, sans-serif">
            VÉGE
          </text>
          <text x={PW/2} y={PH/2 + 34} textAnchor="middle"
            fill="rgba(255,255,255,0.85)" fontSize={28} fontWeight="bold"
            fontFamily="monospace">
            {homeScore}–{awayScore}
          </text>
        </g>
      )}
    </svg>
  );
}

// ── Idővonal a pálya alatt ────────────────────────────────────────────────────

const HOME_COLOR = '#facc15'; // sárga — jól elválik a zöld pályától
const AWAY_COLOR = '#60a5fa'; // kék

const EXTRA_MAX_SEC = 150; // max megjelenített hosszabbítás (2.5 perc)

function PitchTimeline({ goals, matchTimeSeconds, totalSeconds, eventStatus, isExtraTime }: {
  goals:            LiveGoalEvent[];
  matchTimeSeconds: number;
  totalSeconds:     number;
  eventStatus:      string;
  isExtraTime:      boolean;
}) {
  const mainPct    = totalSeconds > 0 ? Math.min(matchTimeSeconds / totalSeconds, 1) * 100 : 0;
  const extraSec   = Math.max(0, matchTimeSeconds - totalSeconds);
  const extraPct   = Math.min(extraSec / EXTRA_MAX_SEC, 1) * 100;
  const mainColor  = eventStatus === 'finished' ? 'rgba(255,255,255,0.35)' : '#22c55e';
  const timeToPct  = (t: number) => totalSeconds > 0 ? Math.min(t / totalSeconds, 1) * 100 : 0;

  return (
    <div className="mt-3 mx-1 mb-5">
      <div className="flex items-stretch gap-1">
        {/* Fő sáv */}
        <div className="relative flex-1 h-5 rounded-l-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'visible' }}>
          {/* Progress */}
          <div className="absolute inset-y-0 left-0 rounded-l-full transition-all duration-1000"
            style={{ width: `${mainPct}%`, backgroundColor: mainColor }} />
          {/* Félidő jelző vonal */}
          <div className="absolute top-0 bottom-0 w-px bg-white/30" style={{ left: '50%' }} />
          {/* Félidő felirat A SÁV ALATT */}
          <span className="absolute text-[9px] text-white/45 font-bold whitespace-nowrap select-none"
            style={{ left: '50%', top: '100%', transform: 'translateX(-50%)', marginTop: '3px' }}>
            Félidő
          </span>
          {/* Gól jelölők */}
          {goals.map((g, i) => {
            const leftPct = timeToPct(g.timeSeconds);
            return (
              <div key={i}
                className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border-2 border-dark-card z-10"
                style={{ left: `calc(${leftPct}% - 10px)`, backgroundColor: g.side === 'home' ? HOME_COLOR : AWAY_COLOR }}
              >⚽</div>
            );
          })}
        </div>

        {/* Elválasztó */}
        <div className="flex items-center px-1">
          <span className="text-[9px] text-white/25 font-bold select-none">|</span>
        </div>

        {/* Hosszabbítás sáv */}
        <div className="relative h-5 rounded-r-full overflow-hidden"
          style={{ width: 48, backgroundColor: isExtraTime ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
                   border: '1px solid ' + (isExtraTime ? 'rgba(249,115,22,0.4)' : 'rgba(255,255,255,0.1)') }}>
          {isExtraTime && (
            <div className="absolute inset-y-0 left-0 rounded-r-full"
              style={{ width: `${extraPct}%`, backgroundColor: '#f97316' }} />
          )}
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold select-none"
            style={{ color: isExtraTime ? '#f97316' : 'rgba(255,255,255,0.2)' }}>+2'</span>
        </div>
      </div>
    </div>
  );
}

// ── Gól lista ─────────────────────────────────────────────────────────────────

function GoalTimeline({ goals, homeTeam, awayTeam, totalSeconds }: {
  goals: LiveGoalEvent[];
  homeTeam: string;
  awayTeam: string;
  totalSeconds: number;
}) {
  if (goals.length === 0) return null;
  return (
    <div className="mt-3 border-t border-dark-border/60 pt-3 space-y-1.5">
      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Gólok</p>
      {goals.map((g, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-dark-bg/40">
          <span className="text-base leading-none">⚽</span>
          <span className={`font-bold text-sm ${g.side === 'home' ? 'text-yellow-400' : 'text-blue-400'}`}>
            {g.side === 'home' ? shortName(homeTeam) : shortName(awayTeam)}
          </span>
          <span className="text-slate-400 text-sm font-mono">
            {fmtTime(g.timeSeconds)}
            {totalSeconds > 0 ? <span className="text-slate-600"> / {fmtTime(totalSeconds)}</span> : null}
          </span>
          <span className={`ml-auto font-black text-base tabular-nums ${g.side === 'home' ? 'text-yellow-400' : 'text-blue-400'}`}>
            {g.homeScore}–{g.awayScore}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Fő komponens ──────────────────────────────────────────────────────────────

interface LivePitchProps {
  playerA: string;
  playerB: string;
  league:  string;
  onClose?: () => void;
}

export default function LivePitch({ playerA, playerB, league, onClose }: LivePitchProps) {
  const [state, setState]             = useState<LiveMatchState | null>(null);
  const [loading, setLoading]         = useState(true);
  const [flashSide, setFlashSide]     = useState<'home' | 'away' | null>(null);
  const [displayTime, setDisplayTime] = useState(0);

  // Labda animáció állapot
  const [ballPos, setBallPos]           = useState({ x: PW / 2, y: PH / 2 });
  const [ballTransDur, setBallTransDur] = useState(0.3);
  const goalAnimating                   = useRef(false);
  const passTimerRef                    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStatusRef                  = useRef<string>('not_started');
  const ballPosRef                      = useRef({ x: PW / 2, y: PH / 2 });

  // Megjelenített eredmény — gól animáció UTÁN frissül, nem azonnal
  const [displayScore, setDisplayScore] = useState({ home: 0, away: 0 });
  const displayScoreRef                 = useRef({ home: 0, away: 0 });
  const pendingScoreRef                 = useRef<{ home: number; away: number } | null>(null);
  const scoreInitRef                    = useRef(false);

  const prevGoalCount = useRef(0);
  const prevGoals     = useRef<LiveGoalEvent[]>([]);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef   = useRef(false);

  const totalSec = matchDuration(league);
  useEffect(() => {
    let cancelled = false;

    const loadOnce = async () => {
      if (cancelled) return;
      const data = await fetchLivePitch(playerA, playerB);
      if (cancelled) return;
      setLoading(false);  // mindig állítsuk, akkor is ha null jött
      if (!data) return;

      // Gól flash: ha új gól jött
      if (data.goals.length > prevGoalCount.current) {
        const newest   = data.goals[data.goals.length - 1];
        const prevLast = prevGoals.current[prevGoals.current.length - 1];
        const isNew    = !prevLast || prevLast.timeSeconds !== newest.timeSeconds || prevLast.side !== newest.side;
        if (isNew) {
          setFlashSide(newest.side);
          setTimeout(() => { if (!cancelled) setFlashSide(null); }, 4_000);
        }
      }
      prevGoalCount.current = data.goals.length;
      prevGoals.current     = data.goals;
      setState(data);

      // Meccs vége → ne pollolj tovább
      if (data.eventStatus === 'finished') {
        finishedRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    const start = () => {
      if (intervalRef.current || finishedRef.current) return;
      loadOnce();
      intervalRef.current = setInterval(loadOnce, 8_000);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      finishedRef.current = false;
    };
  }, [playerA, playerB]);

  // Score frissítés — elsőre azonnal, utána animáció után
  useEffect(() => {
    if (!state) return;
    const h = state.homeScore; const a = state.awayScore;
    if (!scoreInitRef.current) {
      displayScoreRef.current = { home: h, away: a };
      setDisplayScore({ home: h, away: a });
      scoreInitRef.current = true;
      return;
    }
    if (h !== displayScoreRef.current.home || a !== displayScoreRef.current.away) {
      if (goalAnimating.current) {
        pendingScoreRef.current = { home: h, away: a }; // animáció után
      } else {
        displayScoreRef.current = { home: h, away: a };
        setDisplayScore({ home: h, away: a });
      }
    }
  }, [state?.homeScore, state?.awayScore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Belső óra (másodpercenként), szerver poll-tól független
  useEffect(() => {
    eventStatusRef.current = state?.eventStatus ?? 'not_started';
    if (!state || state.eventStatus !== 'in_progress') {
      setDisplayTime(state?.matchTimeSeconds ?? 0);
      return;
    }
    setDisplayTime(state.matchTimeSeconds);
    const iv = setInterval(() => setDisplayTime(t => t + 1), 1_000);
    return () => clearInterval(iv);
  }, [state?.matchTimeSeconds, state?.eventStatus]);

  // Labda passz-szimuláció — rövid passzok szomszédos pozíciók között
  const PASS_RADIUS = 160; // px — csak ennyi távolságra lévő pozíciókra passzol
  useEffect(() => {
    let cancelled = false;

    const scheduleNext = () => {
      const delay = 500 + Math.random() * 900; // gyorsabb, valódibb ritmus
      passTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        if (!goalAnimating.current && eventStatusRef.current === 'in_progress') {
          const cur = ballPosRef.current;
          // Csak közeli pozíciók (szomszéd játékosok)
          const nearby = ALL_PLAYER_PX.filter(p => {
            const dx = p.x - cur.x; const dy = p.y - cur.y;
            return Math.sqrt(dx * dx + dy * dy) < PASS_RADIUS && (dx !== 0 || dy !== 0);
          });
          const candidates = nearby.length >= 2 ? nearby : ALL_PLAYER_PX;
          const p = candidates[Math.floor(Math.random() * candidates.length)];
          const dur = 0.18 + Math.random() * 0.18; // gyors, rövid passz
          ballPosRef.current = p;
          setBallTransDur(dur);
          setBallPos({ x: p.x, y: p.y });
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (passTimerRef.current) clearTimeout(passTimerRef.current);
    };
  }, []);

  // Gól animáció — lassabb, látványosabb, 4 fázis
  useEffect(() => {
    if (!flashSide) return;
    goalAnimating.current = true;

    // Fázis 1 (0ms): labda egy csatárhoz ugrik gyorsan
    const fwdList = flashSide === 'home' ? HOME_FWD_PX : AWAY_FWD_PX;
    const fwd = fwdList[Math.floor(Math.random() * fwdList.length)];
    setBallTransDur(0.3);
    setBallPos({ x: fwd.x, y: fwd.y });

    // Fázis 2 (500ms): kapura futás — lassú, lendületes
    const goalX   = flashSide === 'home' ? PW - 7 : 7;
    const goalOffY = (Math.random() - 0.5) * 24; // véletlenszerű irány a kapun belül
    const t1 = setTimeout(() => {
      setBallTransDur(0.9);
      setBallPos({ x: goalX, y: PH / 2 + goalOffY });
    }, 500);

    // Fázis 3 (1600ms): kapuban kis "pattan" — rövid hátramozgás
    const t2 = setTimeout(() => {
      setBallTransDur(0.2);
      setBallPos({ x: goalX + (flashSide === 'home' ? -12 : 12), y: PH / 2 + goalOffY * 0.4 });
    }, 1600);

    // Fázis 4 (2000ms): labda visszagördül a kapuból egy kicsit
    const t3 = setTimeout(() => {
      setBallTransDur(0.5);
      setBallPos({ x: goalX + (flashSide === 'home' ? -30 : 30), y: PH / 2 });
    }, 2000);

    // Fázis 5 (3000ms): visszaáll középre → ekkor frissül a számláló
    const t4 = setTimeout(() => {
      setBallTransDur(0.6);
      const center = { x: PW / 2, y: PH / 2 };
      setBallPos(center);
      ballPosRef.current = center;
      goalAnimating.current = false;
      // Most frissítjük a megjelenített eredményt
      const pending = pendingScoreRef.current;
      if (pending) {
        displayScoreRef.current = pending;
        setDisplayScore(pending);
        pendingScoreRef.current = null;
      }
    }, 3000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [flashSide]);

  if (loading) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-xl p-6 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin mr-3" />
        <span className="text-slate-400 text-sm">Pályakép betöltése…</span>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-xl p-4 text-center text-slate-500 text-sm">
        Meccs nem található (még nem kezdődött el, vagy véget ért).
      </div>
    );
  }

  const homeShort    = shortName(state.homeTeam);
  const awayShort    = shortName(state.awayTeam);
  const isExtraTime  = state.eventStatus === 'in_progress' && displayTime > totalSec;
  const statusLabel  = state.eventStatus === 'finished'
    ? '✅ Vége'
    : isExtraTime
      ? '⏱ Hosszabbítás'
      : state.eventStatus === 'in_progress'
        ? '🔴 LIVE'
        : '⏳ Nemsokára';
  const badgeClass   = state.eventStatus === 'finished'
    ? 'bg-slate-700 text-slate-400'
    : isExtraTime
      ? 'bg-orange-500/20 text-orange-400'
      : state.eventStatus === 'in_progress'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-yellow-500/20 text-yellow-400';

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">

      {/* Fejléc */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${badgeClass}`}>
            {statusLabel}
          </span>
          <span className="text-xs text-slate-500">{state.league}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono">
            {fmtTime(displayTime)} / {fmtTime(totalSec)}
          </span>
          {onClose && (
            <button onClick={onClose}
              className="text-slate-500 hover:text-white text-lg leading-none">×</button>
          )}
        </div>
      </div>

      {/* Eredmény */}
      <div className={`flex items-center justify-center gap-6 py-4 ${state.eventStatus === 'finished' ? 'bg-slate-800/60' : 'bg-dark-bg/40'}`}>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-1">HAZAI</p>
          <p className="font-bold text-sm" style={{ color: HOME_COLOR }}>{homeShort}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-4xl font-black" style={{ color: HOME_COLOR }}>{displayScore.home}</span>
          <span className="text-2xl text-slate-500">–</span>
          <span className="text-4xl font-black text-blue-400">{displayScore.away}</span>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-1">VENDÉG</p>
          <p className="text-blue-400 font-bold text-sm">{awayShort}</p>
        </div>
      </div>

      {/* Vége banner */}
      {state.eventStatus === 'finished' && (
        <div className="mx-3 mb-2 mt-1 py-2 px-3 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center gap-3">
          <span className="text-slate-300 font-black text-sm tracking-widest uppercase">✅ Meccs vége</span>
          <span className="text-white font-black text-lg tabular-nums">{state.homeScore}–{state.awayScore}</span>
        </div>
      )}

      {/* SVG Pálya */}
      <div className="px-3 pb-3">
        {flashSide && (
          <div className={`text-center py-2 mb-2 rounded-lg text-base font-black animate-pulse ${
            flashSide === 'home' ? 'bg-yellow-500/10' : 'text-blue-400 bg-blue-500/10'
          }`} style={flashSide === 'home' ? { color: HOME_COLOR } : {}}>
            ⚽ GÓL! — {flashSide === 'home' ? homeShort : awayShort}
          </div>
        )}
        <PitchSVG
          flashSide={flashSide}
          ballX={ballPos.x}
          ballY={ballPos.y}
          ballTransDur={ballTransDur}
          isFinished={state.eventStatus === 'finished'}
          homeScore={state.homeScore}
          awayScore={state.awayScore}
        />
        <PitchTimeline
          goals={state.goals}
          matchTimeSeconds={displayTime}
          totalSeconds={totalSec}
          eventStatus={state.eventStatus}
          isExtraTime={isExtraTime}
        />
        <GoalTimeline
          goals={state.goals}
          homeTeam={state.homeTeam}
          awayTeam={state.awayTeam}
          totalSeconds={totalSec}
        />
      </div>

      {/* Frissítés info */}
      <div className="px-4 py-2 border-t border-dark-border/50 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">
          Cloudbet · frissül 8s-onként
        </span>
        <span className="text-[10px] text-slate-600">
          {new Date(state.lastUpdated).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
