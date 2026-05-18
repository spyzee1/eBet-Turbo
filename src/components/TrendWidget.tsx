import { useState, useEffect, useCallback, useRef } from 'react';
import { triggerTrendScan, getTrendStatus, TrendSignal } from '../api';
import { startVisiblePolling } from '../hooks/visiblePolling';

const POLL_INTERVAL = 5 * 60 * 1000;
const CHECKED_GREEN_KEY  = 'checked_green_matches';
const BETTING_JOURNAL_KEY = 'betting_journal';
const TREND_RED_KEY      = 'trend_red';

/** Mini vonaldiagram a mai gólszámokból — a rajzon látható séma szerint */
function GoalSparkline({ matches, ouLine }: {
  matches: Array<{ total: number }>;
  ouLine: number;
}) {
  const W = 220, H = 64, PAD_X = 18, PAD_Y = 14;
  const vals = matches.map(m => m.total);
  const minV = Math.max(0, Math.min(...vals) - 1);
  const maxV = Math.max(...vals) + 1;
  const range = maxV - minV || 1;

  const x = (i: number) => PAD_X + (i / Math.max(vals.length - 1, 1)) * (W - PAD_X * 2);
  const y = (v: number) => PAD_Y + (1 - (v - minV) / range) * (H - PAD_Y * 2);

  const points = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // O/U vonal Y koordinátája
  const lineY = y(ouLine);

  return (
    <div className="flex justify-center mb-2">
      <svg width={W} height={H} className="overflow-visible">
        {/* O/U referencia vonal */}
        <line
          x1={PAD_X} y1={lineY} x2={W - PAD_X} y2={lineY}
          stroke="#475569" strokeWidth="1" strokeDasharray="3,3"
        />
        {/* Összekötő vonalak */}
        <polyline
          points={points}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Pontok + értékek */}
        {vals.map((v, i) => {
          const cx = x(i), cy = y(v);
          const above = v > ouLine;
          return (
            <g key={i}>
              <circle
                cx={cx} cy={cy} r={4}
                fill={above ? '#22c55e' : '#ef4444'}
                stroke="#1e293b" strokeWidth="1.5"
              />
              <text
                x={cx} y={cy - 7}
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fill={above ? '#86efac' : '#fca5a5'}
              >
                {v}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function leagueBadge(l: string) {
  if (l === 'GT Leagues')              return 'bg-green/20 text-green';
  if (l === 'Esoccer Battle')          return 'bg-yellow/20 text-yellow';
  if (l === 'eAdriatic League')        return 'bg-sky-500/20 text-sky-400';
  if (l === 'Esoccer H2H GG League')  return 'bg-orange-500/20 text-orange-400';
  if (l === 'Esports Volta')           return 'bg-cyan-500/20 text-cyan-400';
  return 'bg-slate-600/30 text-slate-400';
}

function signalKey(s: TrendSignal) {
  return `trend|${[s.playerA, s.playerB].sort().join('-')}|${s.nextMatchTime}`;
}

function buildCheckedMatch(sig: TrendSignal, strategy?: 'A' | 'B' | 'C', oddsSource = 'msport.com', stake = 2000) {
  const today = new Date().toISOString().split('T')[0];
  const fakeTip = {
    playerA: sig.playerA, teamA: sig.playerA,
    playerB: sig.playerB, teamB: sig.playerB,
    time: sig.nextMatchTime,
    date: today,
    league: sig.league,
    ouLine: sig.ouLine,
    vartGol: sig.avgTotalGoals,
    valueBet: `OVER ${sig.ouLine}`,
    ajanlottTipp: `OVER ${sig.ouLine}`,
    confidence: sig.signalStrength === 'TREND' ? 0.82 : 0.75,
    edge: sig.signalStrength === 'TREND' ? 0.10 : 0.07,
    winEselyA: 0.5, winEselyB: 0.5,
    overEsely: 0.70, underEsely: 0.30,
    stake,
    category: 'BET',
    oddsSource,
  };
  const [h, m] = sig.nextMatchTime.split(':').map(Number);
  const ts = new Date();
  ts.setHours(h, m, 0, 0);
  return {
    matchId: signalKey(sig),
    tip: fakeTip,
    timestamp: ts.getTime(),
    date: today,
    betType: 'Over' as const,
    betLine: sig.ouLine,
    stake,
    oddsSource,
    fromTrend: true,
    trendType: sig.isSuper
      ? (`SUPER_${sig.signalStrength}` as 'SUPER_VALUE' | 'SUPER_TREND')
      : sig.signalStrength,
    strategy,
    odds: sig.oddsOver,
    trendAboveLinePct: sig.aboveLinePct,
    trendAboveLineCount: sig.aboveLineCount,
    trendAvgGoals: sig.avgTotalGoals,
    trendSlope: sig.trendSlope,
    trendTodayH2H: sig.todayH2H,
    trendTotalMatches: sig.todayH2H.length,
  };
}

function addToGreenList(sig: TrendSignal, strategy?: 'A' | 'B' | 'C', oddsSource = 'msport.com', stake = 2000) {
  try {
    const key = signalKey(sig);
    const entry = buildCheckedMatch(sig, strategy, oddsSource, stake);
    const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
    if (!stored.some(m => m.matchId === key)) {
      stored.push(entry);
      localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(stored));
    }
    const journal: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
    if (!journal.some(m => m.matchId === key)) {
      journal.push(entry);
      localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
    }
    window.dispatchEvent(new Event('checked-matches-updated'));
  } catch {}
}

function removeFromGreenList(sig: TrendSignal) {
  try {
    const key = signalKey(sig);
    const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
    const filtered = stored.filter(m => m.matchId !== key);
    localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('trend-match-removed', { detail: { matchId: key } }));
    window.dispatchEvent(new Event('checked-matches-updated'));
  } catch { /* skip */ }
}

const ALL_LEAGUES = [
  { name: 'GT Leagues',             label: 'GT Leagues (12p)',    active: 'bg-green/20 text-green border-2 border-green',             inactive: 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border' },
  { name: 'eAdriatic League',       label: 'eAdriatic (10p)',     active: 'bg-sky-500/20 text-sky-400 border-2 border-sky-500',       inactive: 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border' },
  { name: 'Esoccer H2H GG League',  label: 'H2H GG (8p)',         active: 'bg-orange-500/20 text-orange-400 border-2 border-orange-400', inactive: 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border' },
  { name: 'Esoccer Battle',         label: 'Battle (8p)',         active: 'bg-yellow/20 text-yellow border-2 border-yellow',          inactive: 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border' },
  { name: 'Esports Volta',          label: 'Volta (6p)',          active: 'bg-cyan-500/20 text-cyan-400 border-2 border-cyan-400',    inactive: 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border' },
];

export default function TrendWidget({ strategy, stake = 2000 }: { strategy?: 'A' | 'B' | 'C'; stake?: number }) {
  const [signals, setSignals]   = useState<TrendSignal[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(
    new Set(['GT Leagues', 'eAdriatic League'])
  );
  const [selectedSource, setSelectedSource] = useState<string>('msport.com'); // '' = Mind (auto)

  const toggleLeague = (name: string) => {
    setSelectedLeagues(prev => {
      const next = new Set(prev);
      if (next.has(name)) { if (next.size > 1) next.delete(name); } // min 1 liga
      else next.add(name);
      return next;
    });
  };

  const [greenSet, setGreenSet] = useState<Set<string>>(() => {
    try {
      const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
      return new Set(stored.filter(m => m.fromTrend).map((m: any) => m.matchId));
    } catch { return new Set(); }
  });
  const [redSet, setRedSet] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(TREND_RED_KEY) || '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem(TREND_RED_KEY, JSON.stringify([...redSet]));
  }, [redSet]);

  // Sync greenSet if another tab updates localStorage
  useEffect(() => {
    const sync = () => {
      try {
        const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
        setGreenSet(new Set(stored.filter(m => m.fromTrend).map((m: any) => m.matchId)));
      } catch {}
    };
    window.addEventListener('checked-matches-updated', sync);
    return () => window.removeEventListener('checked-matches-updated', sync);
  }, []);

  // Aktív forrás és odds kiszámítása signal + selectedSource alapján
  const resolveActiveOdds = (sig: TrendSignal) => {
    if (!sig.allOdds || Object.keys(sig.allOdds).length === 0) {
      return { sourceKey: sig.oddsSource || 'msport.com', ouLine: sig.ouLine, oddsOver: sig.oddsOver };
    }
    if (selectedSource && sig.allOdds[selectedSource]) {
      return { sourceKey: selectedSource, ouLine: sig.allOdds[selectedSource].ouLine, oddsOver: sig.allOdds[selectedSource].oddsOver };
    }
    if (!selectedSource) {
      // Mind: legjobb (avg - line legnagyobb)
      const best = Object.entries(sig.allOdds)
        .filter(([, v]) => v.ouLine > 0)
        .reduce((b, [src, v]) => {
          return (sig.avgTotalGoals - v.ouLine) > (sig.avgTotalGoals - (sig.allOdds![b[0]]?.ouLine ?? 0))
            ? [src, v] as [string, { ouLine: number; oddsOver?: number }]
            : b;
        }, Object.entries(sig.allOdds)[0]);
      return { sourceKey: best[0], ouLine: best[1].ouLine, oddsOver: best[1].oddsOver };
    }
    const fallback = sig.allOdds['msport.com'] || Object.values(sig.allOdds)[0];
    const fallbackKey = sig.allOdds['msport.com'] ? 'msport.com' : Object.keys(sig.allOdds)[0];
    return { sourceKey: fallbackKey, ouLine: fallback.ouLine, oddsOver: fallback.oddsOver };
  };

  const toggleGreen = (key: string, sig: TrendSignal) => {
    if (greenSet.has(key)) {
      removeFromGreenList(sig);
      setGreenSet(prev => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      const { sourceKey, ouLine, oddsOver } = resolveActiveOdds(sig);
      addToGreenList({ ...sig, ouLine, oddsOver }, strategy, sourceKey, stake);
      setGreenSet(prev => new Set([...prev, key]));
      setRedSet(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };
  const toggleRed = (key: string) => {
    setRedSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Ha zöldben volt, vegyük ki a Mérkőzés Listából
        if (greenSet.has(key)) {
          try {
            const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
            localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(stored.filter(m => m.matchId !== key)));
            window.dispatchEvent(new Event('checked-matches-updated'));
          } catch {}
          setGreenSet(g => { const n = new Set(g); n.delete(key); return n; });
        }
      }
      return next;
    });
  };

  const prevKeySet = useRef<Set<string>>(new Set());

  function playTrendSound() {
    try {
      const ctx = new AudioContext();
      [660, 880, 1100].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.18);
        osc.start(ctx.currentTime + i * 0.13);
        osc.stop(ctx.currentTime + i * 0.13 + 0.18);
      });
    } catch {}
  }

  const runScan = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await triggerTrendScan();
      // Hangjelzés ha új jelzés jelent meg
      const newKeys = new Set(res.signals.map(s => signalKey(s)));
      const hasNew = [...newKeys].some(k => !prevKeySet.current.has(k));
      if (hasNew && res.signals.length > 0 && prevKeySet.current.size > 0) {
        playTrendSound();
      }
      prevKeySet.current = newKeys;
      setSignals(res.signals);
      setLastScan(new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError('Trend scan sikertelen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getTrendStatus()
      .then(s => { if (s.lastRunISO) setLastScan(new Date(s.lastRunISO).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })); })
      .catch(() => {});
    return startVisiblePolling(() => runScan(true), POLL_INTERVAL);
  }, [runScan]);

  const filteredSignals = signals.filter(s => selectedLeagues.has(s.league));
  const strongCount = filteredSignals.filter(s => s.signalStrength === 'TREND').length;

  return (
    <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-green-400">▲</span>
          <span className="text-sm font-semibold text-white">Intraday TREND/VALUE</span>
          {filteredSignals.length > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              strongCount > 0
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            }`}>
              {filteredSignals.length} aktív
            </span>
          )}
          {strongCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
              {strongCount} ERŐS
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastScan && <span className="text-xs text-slate-500">Utolsó scan: {lastScan}</span>}
          <button
            onClick={e => { e.stopPropagation(); runScan(); }}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition disabled:opacity-40 cursor-pointer"
          >
            {loading ? '⟳ Scanning...' : '↺ Scan'}
          </button>
          <svg className={`w-4 h-4 text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-dark-border">

          {/* Liga szűrő gombok + Forrás gombok */}
          <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-dark-border">
            {ALL_LEAGUES.map(lg => (
              <button
                key={lg.name}
                onClick={() => toggleLeague(lg.name)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has(lg.name) ? lg.active : lg.inactive}`}
              >
                {lg.label}
              </button>
            ))}
            <div className="w-px h-5 bg-dark-border mx-1 shrink-0" />
            {/* Mind gomb */}
            <button
              onClick={() => setSelectedSource('')}
              className={`text-xs px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition border ${
                selectedSource === '' ? 'bg-accent/20 text-accent-light border-accent' : 'bg-dark-card text-slate-400 border-dark-border hover:border-slate-500'
              }`}
            >
              Mind
            </button>
            {([
              { val: 'msport.com', label: 'msport',   cls: 'bg-sky-500/20 text-sky-400 border-sky-500' },
              { val: 'cloudbet',   label: 'Cloudbet', cls: 'bg-orange-500/20 text-orange-400 border-orange-500' },
              { val: 'vegas.hu',   label: 'Vegas',    cls: 'bg-green-500/20 text-green-400 border-green-500' },
            ] as const).map(s => {
              const hasData = filteredSignals.some(sig => sig.allOdds?.[s.val]);
              return (
                <button
                  key={s.val}
                  onClick={() => hasData && setSelectedSource(s.val)}
                  title={hasData ? undefined : `Nincs ${s.label} odds az aktuális jelzésekhez`}
                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition border ${
                    !hasData
                      ? 'opacity-30 cursor-not-allowed bg-dark-card text-slate-500 border-dark-border'
                      : selectedSource === s.val
                        ? `cursor-pointer ${s.cls}`
                        : 'cursor-pointer bg-dark-card text-slate-400 border-dark-border hover:border-slate-500'
                  }`}
                >
                  {s.label}{!hasData && <span className="ml-0.5 text-[9px]">—</span>}
                </button>
              );
            })}
          </div>

          {error && <div className="px-4 py-3 text-xs text-red-400 bg-red-500/10">{error}</div>}
          {loading && signals.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">Trend scan fut...</div>
          )}
          {(() => {
            const filtered = signals.filter(s => selectedLeagues.has(s.league));
            if (!loading && filtered.length === 0 && !error) {
              return (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-slate-500">Nincs aktív trend jelzés</p>
                  <p className="text-xs text-slate-600 mt-1">A scanner 5 percenként automatikusan fut</p>
                </div>
              );
            }
            if (filtered.length > 0) {
              return (
                <div className="divide-y divide-dark-border">
                  {filtered.map((sig, i) => {
                    const key = signalKey(sig);
                    return (
                      <TrendCard
                        key={i}
                        signal={sig}
                        isGreen={greenSet.has(key)}
                        isRed={redSet.has(key)}
                        onGreen={() => toggleGreen(key, sig)}
                        onRed={() => toggleRed(key)}
                        selectedSource={selectedSource}
                      />
                    );
                  })}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
}

interface TrendCardProps {
  signal: TrendSignal;
  isGreen: boolean;
  isRed: boolean;
  onGreen: () => void;
  onRed: () => void;
  selectedSource?: string;
}

function TrendCard({ signal, isGreen, isRed, onGreen, onRed, selectedSource = 'msport.com' }: TrendCardProps) {
  const isValue = signal.signalStrength === 'VALUE';
  const isSuper = signal.isSuper === true;

  // Speciális keret feltételek (activeOuLine a megjelenített vonal)
  const is100pct = isValue && signal.aboveLinePct >= 1.0;

  // ── Aktív forrás meghatározása ──────────────────────────────────────────────
  // selectedSource === '' → Mind mód: a modell gólátlagtól legjobban eltérő forrás
  const activeSourceKey: string = (() => {
    if (selectedSource && signal.allOdds?.[selectedSource]) return selectedSource;
    if (!signal.allOdds || Object.keys(signal.allOdds).length === 0) return signal.oddsSource || '';
    if (!selectedSource) {
      // Mind mód: max(avgTotalGoals - ouLine) → legjobb OVER érték
      return Object.entries(signal.allOdds)
        .filter(([, v]) => v.ouLine > 0)
        .reduce((best, [src, v]) => {
          const dev = signal.avgTotalGoals - v.ouLine;
          const bestDev = signal.avgTotalGoals - (signal.allOdds![best]?.ouLine ?? 0);
          return dev > bestDev ? src : best;
        }, Object.keys(signal.allOdds)[0]);
    }
    // selectedSource nincs meg ebben a signalban → default
    return signal.oddsSource || Object.keys(signal.allOdds)[0] || '';
  })();

  const activeOdds = signal.allOdds?.[activeSourceKey] ?? { ouLine: signal.ouLine, oddsOver: signal.oddsOver };
  const activeOuLine = activeOdds.ouLine;

  // Utolsó 3 meccs a megjelenített vonal felett?
  const last3AboveLine = !isValue
    && signal.todayH2H.length >= 3
    && signal.todayH2H.slice(-3).every(m => m.total > activeOuLine);

  const borderClass = is100pct
    // Inset shadow = 4 oldalas keret (nem ütközik a divide-y-val)
    ? 'border-l-4 border-yellow-300 bg-yellow-400/5 shadow-[inset_0_0_0_3px_rgb(253,224,71),0_0_18px_rgba(253,224,71,0.45)]'
    : last3AboveLine
      ? 'border-l-4 border-orange-300 bg-orange-500/5 shadow-[inset_0_0_0_3px_rgb(251,146,60),0_0_18px_rgba(249,115,22,0.45)]'
      : isSuper
        ? isValue
          ? 'border-l-4 border-yellow-300 bg-yellow-400/5 shadow-[inset_0_0_20px_rgba(253,224,71,0.08)]'
          : 'border-l-4 border-orange-400 bg-orange-500/5 shadow-[inset_0_0_20px_rgba(249,115,22,0.10)]'
        : isValue
          ? 'border-l-4 border-yellow-400'
          : 'border-l-4 border-orange-500';

  return (
    <div className={`px-4 pt-3 pb-4 transition hover:bg-white/3 ${borderClass}`}>

      {/* Sor 1: típus badge + liga + időpont */}
      <div className="flex items-center gap-2 mb-3">
        {isSuper ? (
          <span
            style={isValue
              ? { backgroundColor: '#fde047', color: '#111827', boxShadow: '0 0 10px rgba(253,224,71,0.6)' }
              : { backgroundColor: '#f97316', color: '#fff',    boxShadow: '0 0 10px rgba(249,115,22,0.6)' }}
            className="text-[10px] font-black px-2.5 py-1 rounded animate-pulse"
          >
            {isValue ? '💥 SUPER VALUE' : '🔥 SUPER TREND'}
          </span>
        ) : (
          <span
            style={isValue ? { backgroundColor: '#facc15', color: '#111827' } : {}}
            className={`text-[10px] font-bold px-2 py-0.5 rounded ${!isValue ? 'bg-orange-500 text-white' : ''}`}
          >
            {isValue ? '💰 VALUE' : '🚀 TREND'}
          </span>
        )}
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${leagueBadge(signal.league)}`}>
          {signal.league}
        </span>
        <span className="text-xs text-white font-mono font-bold">{signal.nextMatchTime}</span>
        <span className="text-xs text-slate-500">({signal.minutesUntil} perc múlva)</span>
      </div>

      {/* Sor 2: Játékos nevek — NAGY — KÖZÉPRE */}
      <div className="flex items-center justify-center gap-3 mb-2">
        <span className="text-xl font-black text-white uppercase tracking-wide select-text cursor-text">{signal.playerA}</span>
        <span className="text-slate-500 text-base font-normal select-none">vs</span>
        <span className="text-xl font-black text-white uppercase tracking-wide select-text cursor-text">{signal.playerB}</span>
      </div>

      {/* Sor 2b: Sparkline — mai gólok vizuálisan */}
      {signal.todayH2H.length >= 2 && (
        <GoalSparkline matches={signal.todayH2H} ouLine={signal.ouLine} />
      )}

      {/* Sor 3: H2H gólsorozat — KÖZÉPRE, nevek alá szimmetrikusan */}
      <div className="flex justify-center items-center gap-1 flex-wrap mb-3">
        {signal.todayH2H.map((m, i) => {
          const aboveLine = m.total > activeOuLine;
          const rising    = i > 0 && m.total > signal.todayH2H[i - 1].total;
          const falling   = i > 0 && m.total < signal.todayH2H[i - 1].total;
          return (
            <div key={i} className="flex items-center gap-0.5">
              {i > 0 && (
                <span className={`text-sm font-bold ${rising ? 'text-green-400' : falling ? 'text-red-400' : 'text-slate-600'}`}>
                  {rising ? '↑' : falling ? '↓' : '→'}
                </span>
              )}
              <span className={`text-sm font-mono font-black px-2 py-1 rounded ${
                aboveLine ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
              }`}>
                {m.goalsA}–{m.goalsB} <span className="text-xs opacity-80">({m.total})</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Sor 4: Statisztikák — szellős, vízszintesen — KÖZÉPRE */}
      <div className="flex justify-center items-center gap-6 mb-2">
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Vonal</div>
          <div className="text-lg font-bold text-white">{activeOuLine}</div>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
            {isValue ? 'Vonal felett' : 'Trend'}
          </div>
          <div className={`text-lg font-bold ${isValue ? 'text-yellow-300' : 'text-orange-400'}`}>
            {isValue
              ? `${signal.aboveLineCount}/${signal.todayH2H.length} (${Math.round(signal.aboveLinePct * 100)}%)`
              : `+${signal.trendSlope.toFixed(1)}/meccs`}
          </div>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Átlag</div>
          <div className="text-lg font-bold text-white">{signal.avgTotalGoals.toFixed(1)} gól</div>
        </div>
      </div>


      {/* Gólátlagok: tegnapelőtt / tegnap / ma — mindig látható */}
      <div className={`flex justify-center items-center gap-3 mb-3 text-[11px] ${isSuper ? '' : 'opacity-80'}`}>
        <span className="text-slate-500">
          T.előtt{' '}
          {signal.prevDayAvg !== undefined ? (
            <>
              <span
                style={{ color: isSuper ? (isValue ? '#fde047' : '#fb923c') : '#94a3b8' }}
                className="font-black"
              >
                {signal.prevDayAvg.toFixed(1)}
              </span>
              {signal.prevDayAvg > activeOuLine
                ? <span className="ml-0.5 text-green-400">▲</span>
                : <span className="ml-0.5 text-red-400">▼</span>}
            </>
          ) : <span className="text-slate-600 font-bold">—</span>}
        </span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-500">
          Tegnap{' '}
          {signal.yesterdayAvg !== undefined ? (
            <>
              <span
                style={{ color: isSuper ? (isValue ? '#fde047' : '#fb923c') : '#94a3b8' }}
                className="font-black"
              >
                {signal.yesterdayAvg.toFixed(1)}
              </span>
              {signal.yesterdayAvg > activeOuLine
                ? <span className="ml-0.5 text-green-400">▲</span>
                : <span className="ml-0.5 text-red-400">▼</span>}
            </>
          ) : <span className="text-slate-600 font-bold">—</span>}
        </span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-400">
          Ma{' '}
          <span
            style={{ color: isSuper ? (isValue ? '#fde047' : '#fb923c') : '#e2e8f0' }}
            className="font-black"
          >
            {signal.avgTotalGoals.toFixed(1)}
          </span>
          {signal.avgTotalGoals > activeOuLine
            ? <span className="ml-0.5 text-green-400">▲</span>
            : <span className="ml-0.5 text-red-400">▼</span>}
        </span>
      </div>

      {/* Sor 5: OVER badge (bal) + forrás label + pipák (jobb) — egy sorban */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div
            style={isValue ? {backgroundColor:'#facc15',color:'#111827'} : {}}
            className={`px-4 py-2 rounded-lg font-black text-sm flex items-center gap-2 ${!isValue ? 'bg-orange-500 text-white' : ''}`}
          >
            <span>OVER {activeOuLine}</span>
            <span className="opacity-85">
              {isValue ? `${Math.round(signal.aboveLinePct * 100)}%` : `+${signal.trendSlope.toFixed(1)}/m`}
            </span>
          </div>
          {/* Forrás label — aktív forrás + többi elérhető forrás */}
          {(() => {
            const srcLabel = activeSourceKey === 'msport.com' ? '🔵 msport'
              : activeSourceKey === 'cloudbet' ? '🟠 Cloudbet'
              : activeSourceKey === 'vegas.hu' ? '🟢 Vegas'
              : activeSourceKey || '—';
            // Ha a felhasználó mást választott, de nincs adat → visszaesés jelzése
            const fallbackHappened = selectedSource && selectedSource !== activeSourceKey && !!activeSourceKey;
            const otherSources = signal.allOdds
              ? Object.entries(signal.allOdds).filter(([k]) => k !== activeSourceKey)
              : [];
            return (
              <div className="flex items-center gap-2 pl-1 flex-wrap">
                <span className="text-[10px] text-slate-400 font-semibold">{srcLabel}</span>
                {fallbackHappened && (
                  <span className="text-[9px] text-slate-600 italic">
                    ({selectedSource === 'msport.com' ? 'msport' : selectedSource === 'cloudbet' ? 'Cloudbet' : 'Vegas'}: nincs adat)
                  </span>
                )}
                {otherSources.map(([src, odds]) => {
                  const lbl = src === 'msport.com' ? 'ms' : src === 'cloudbet' ? 'cb' : src === 'vegas.hu' ? 'vg' : src;
                  return (
                    <span key={src} className="text-[10px] text-slate-400 font-mono bg-dark-bg/60 px-1 rounded">
                      {lbl}:{odds.ouLine}
                    </span>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onGreen} title="Megtéve"
            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all text-xs font-bold ${isGreen ? 'bg-green/30 border-green text-green' : 'border-slate-600 hover:border-green'}`}>
            {isGreen && '✓'}
          </button>
          <button onClick={onRed} title="Kihagyom"
            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all text-xs font-bold ${isRed ? 'bg-red/30 border-red text-red' : 'border-slate-600 hover:border-red'}`}>
            {isRed && '✕'}
          </button>
        </div>
      </div>


    </div>
  );
}
