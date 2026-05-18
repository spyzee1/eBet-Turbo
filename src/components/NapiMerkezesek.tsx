import { useState, useEffect, useCallback } from 'react';
import { startVisiblePolling } from '../hooks/visiblePolling';

// ── Típusok ────────────────────────────────────────────────────────────────────

interface DailyMatch {
  playerA: string;
  playerB: string;
  teamA: string;
  teamB: string;
  league: string;
  time: string;     // "HH:MM"
  date: string;     // "MM/DD"
  ouLine: number;
  oddsOver: number;
  oddsUnder: number;
  startTime: number;
  eventId: string;
  // Végeredmény — poll után érkezik
  scoreA?: number;
  scoreB?: number;
}

interface H2HMatch {
  date: string;       // "MM/DD HH:MM"
  scoreA: number;
  scoreB: number;
  totalGoals: number;
  resultA: 'win' | 'loss' | 'draw';
}

interface H2HData {
  matches: H2HMatch[];
  avgGoals: number | null;
  todayCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayInputValue(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function inputToMmDd(yyyyMmDd: string): string {
  const parts = yyyyMmDd.split('-');
  if (parts.length < 3) return '';
  return `${parts[1]}/${parts[2]}`;
}

/** startTime (Unix ms) → "HH:MM" a böngésző helyi ideje szerint (CEST Budapestnek) */
function formatMatchTime(startTimeMs: number): string {
  const d = new Date(startTimeMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Mennyi perc van a meccs kezdéséig? Negatív = már elkezdődött.
 *  startTime-alapú → timezone-agnosztikus */
function minutesFromStart(startTimeMs: number): number {
  return (startTimeMs - Date.now()) / 60_000;
}

// ── Match Card ─────────────────────────────────────────────────────────────────

function MatchCard({ match, cachedScore, onScore }: {
  match: DailyMatch;
  cachedScore?: { a: number; b: number };
  onScore: (playerA: string, playerB: string, startTime: number, scoreA: number, scoreB: number) => void;
}) {
  const hasOdds = match.ouLine > 0 && match.oddsOver > 1 && match.oddsUnder > 1;
  const maxDuration = match.league === 'eAdriatic League' ? 10 : 12;

  // ── Re-render ticker (30 mp-enként) — Live/Past állapot naprakész marad ──────
  const [, setTick] = useState(0);
  useEffect(() => {
    return startVisiblePolling(() => setTick(t => t + 1), 30_000, { runImmediately: false });
  }, []);

  // Időállapot — minden render-nél frissen számolódik
  const diff = minutesFromStart(match.startTime);
  const displayTime = formatMatchTime(match.startTime);

  // Mai dátum prefix pl. "05/02"
  const now = new Date();
  const todayPrefix = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

  // ── H2H lazy betöltés (előzmény) ────────────────────────────────────────────
  const [h2h, setH2h] = useState<H2HData | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const delay = Math.random() * 800 + 200;
    const timer = setTimeout(async () => {
      setH2hLoading(true);
      try {
        const resp = await fetch(
          `/api/h2h-quick/${encodeURIComponent(match.playerA)}/${encodeURIComponent(match.playerB)}?league=${encodeURIComponent(match.league)}`
        );
        if (!resp.ok || cancelled) return;
        const data: H2HData = await resp.json();
        if (!cancelled) setH2h(data);
      } catch { /* silent */ }
      finally { if (!cancelled) setH2hLoading(false); }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [match.playerA, match.playerB, match.league]);

  // ── Végeredmény lekérése — /api/match-result (Cloudbet + Supabase + in-memory) ──
  const [resultScore, setResultScore] = useState<{ a: number; b: number } | null>(
    cachedScore ?? (match.scoreA !== undefined && match.scoreB !== undefined ? { a: match.scoreA, b: match.scoreB } : null)
  );

  useEffect(() => {
    // Ha már van score (prop-ból) — nem kell poll
    if (match.scoreA !== undefined && match.scoreB !== undefined) {
      setResultScore({ a: match.scoreA, b: match.scoreB });
      return;
    }
    // Csak ha a meccs már elkezdődött
    if (diff > 0) return;

    let cancelled = false;

    const fetchResult = async () => {
      try {
        const url = `/api/match-result?playerA=${encodeURIComponent(match.playerA)}&playerB=${encodeURIComponent(match.playerB)}&league=${encodeURIComponent(match.league)}&startTime=${match.startTime}`;
        const resp = await fetch(url);
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (data.found && !cancelled) {
          setResultScore({ a: data.scoreA, b: data.scoreB });
          onScore(match.playerA, match.playerB, match.startTime, data.scoreA, data.scoreB);
        }
      } catch { /* silent */ }
    };

    // Azonnal próbálja, majd 30 mp-enként (tab-látható csak)
    const stopPoll = startVisiblePolling(fetchResult, 30_000);
    return () => { cancelled = true; stopPoll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.playerA, match.playerB, match.startTime, diff > 0]);

  const displayScoreA = resultScore?.a;
  const displayScoreB = resultScore?.b;
  const hasScore = displayScoreA !== undefined && displayScoreB !== undefined;

  // Ha van score → meccs véget ért
  const isLive = !hasScore && diff >= -maxDuration && diff <= 0;
  const isPast = hasScore || diff < -maxDuration;
  const isSoon = !hasScore && diff > 0 && diff <= 15;

  return (
    <div className={`bg-dark-card border rounded-lg overflow-hidden transition-all ${
      isLive  ? 'border-green/60 shadow-[0_0_8px_rgba(34,197,94,0.3)]' :
      isSoon  ? 'border-yellow-500/50' :
      hasScore ? 'border-dark-border/70' :
      isPast  ? 'border-dark-border opacity-50' :
                'border-dark-border'
    }`}>

      {/* Fejléc sor: idő · játékosok · odds */}
      <div className="px-3 py-2 flex items-center gap-2">
        {/* Idő */}
        <div className="w-12 shrink-0 text-center">
          <span className={`text-sm font-mono font-bold ${
            isLive ? 'text-green' : isSoon ? 'text-yellow-400' : isPast ? 'text-slate-500' : 'text-slate-300'
          }`}>{displayTime}</span>
          {isLive && <div className="text-[9px] text-green font-bold leading-tight">● LIVE</div>}
          {isPast && hasScore && (
            <div className="text-[9px] text-slate-500 font-bold leading-tight">VÉGE</div>
          )}
        </div>

        {/* Játékosok */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0">
          <div className="flex flex-col items-end min-w-0 flex-1">
            <span className="text-xs font-semibold text-white uppercase truncate w-full text-right">
              {match.playerA}
            </span>
            {match.teamA && (
              <span className="text-[10px] text-slate-500 leading-tight truncate w-full text-right">
                {match.teamA}
              </span>
            )}
          </div>
          <span className="text-slate-600 text-xs shrink-0 font-bold">–</span>
          <div className="flex flex-col items-start min-w-0 flex-1">
            <span className="text-xs font-semibold text-white uppercase truncate w-full">
              {match.playerB}
            </span>
            {match.teamB && (
              <span className="text-[10px] text-slate-500 leading-tight truncate w-full">
                {match.teamB}
              </span>
            )}
          </div>
        </div>

        {/* Végeredmény (ha már lejátszott) VAGY Odds (ha még jövő) */}
        {hasScore ? (
          <div className="shrink-0 text-right min-w-[72px]">
            <div className="text-[14px] font-mono font-bold text-white leading-tight">
              {displayScoreA}–{displayScoreB}
            </div>
            <div className="flex items-center justify-end gap-1 leading-tight">
              {/* Gólszám + O/U viszony */}
              {match.ouLine > 0 && (() => {
                const total = (displayScoreA as number) + (displayScoreB as number);
                const isOver = total > match.ouLine;
                const isUnder = total < match.ouLine;
                return (
                  <span className={`text-[9px] font-bold ${isOver ? 'text-green' : isUnder ? 'text-red-400' : 'text-yellow-400'}`}>
                    ({total}) {isOver ? '▲OVER' : isUnder ? '▼UNDER' : '═PUSH'}
                  </span>
                );
              })()}
            </div>
          </div>
        ) : isPast ? (
          <div className="shrink-0 min-w-[64px] text-right">
            <span className="text-[10px] text-slate-600 italic">–</span>
          </div>
        ) : hasOdds ? (
          <div className="shrink-0 text-right min-w-[64px]">
            <div className="text-[11px] font-semibold text-sky-400">O/U {match.ouLine}</div>
            <div className="text-[10px] font-mono text-sky-300 leading-tight">
              ↑{match.oddsOver.toFixed(2)} ↓{match.oddsUnder.toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="shrink-0 min-w-[64px] text-right">
            <span className="text-[10px] text-slate-600 italic">nincs odds</span>
          </div>
        )}
      </div>

      {/* H2H szekció */}
      {h2hLoading && !h2h && (
        <div className="px-3 pb-1.5 text-[10px] text-slate-600 italic">H2H töltés...</div>
      )}

      {h2h && h2h.matches.length > 0 && (
        <div className="border-t border-dark-border/60 px-3 py-1.5">
          {/* Cím + átlag */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500 font-semibold">
              EGYMÁS ELLENI ({h2h.matches.length} meccs)
              {h2h.todayCount > 0 && (
                <span className="ml-1 text-orange-400">· Ma: {h2h.todayCount}</span>
              )}
            </span>
            {h2h.avgGoals !== null && (
              <span className="text-[10px] font-mono font-bold text-white">
                Ø {h2h.avgGoals.toFixed(1)} gól
              </span>
            )}
          </div>

          {/* Meccs sorok */}
          <div className="space-y-0.5">
            {(() => {
              const todayMatches = h2h.matches.filter(m => m.date.startsWith(todayPrefix));
              const olderMatches = h2h.matches.filter(m => !m.date.startsWith(todayPrefix));

              const renderRow = (m: typeof h2h.matches[0], i: number, isToday: boolean) => {
                const resultColor = m.resultA === 'win'
                  ? 'text-green' : m.resultA === 'loss' ? 'text-red-400' : 'text-yellow-400';
                return (
                  <div key={i} className={`flex items-center gap-1.5 text-[10px] rounded px-1 ${
                    isToday ? 'bg-white/5' : ''
                  }`}>
                    <span className={`font-mono w-14 shrink-0 ${isToday ? 'text-orange-400 font-bold' : 'text-slate-600'}`}>
                      {m.date.slice(0, 5)}
                    </span>
                    <span className={`shrink-0 font-bold w-4 text-center ${
                      m.resultA === 'win' ? 'text-green' : m.resultA === 'loss' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {m.resultA === 'win' ? 'Gy' : m.resultA === 'loss' ? 'V' : 'D'}
                    </span>
                    <span className={`font-mono font-bold shrink-0 ${resultColor}`}>
                      {m.scoreA}–{m.scoreB}
                    </span>
                    <span className="font-mono text-slate-400 shrink-0">
                      ({m.totalGoals})
                    </span>
                    {isToday && (
                      <span className="text-[8px] bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded font-bold">MA</span>
                    )}
                    <span className="text-slate-600 ml-auto">
                      {m.date.slice(6)}
                    </span>
                  </div>
                );
              };

              // Csoportosítás dátum szerint (nap-elválasztók)
              const dateGroups: Array<{ dateKey: string; matches: typeof olderMatches }> = [];
              for (const m of olderMatches) {
                const dk = m.date.slice(0, 5); // "MM/DD"
                const last = dateGroups[dateGroups.length - 1];
                if (last && last.dateKey === dk) last.matches.push(m);
                else dateGroups.push({ dateKey: dk, matches: [m] });
              }
              const fmtDate = (mmdd: string) => {
                const [mo, dy] = mmdd.split('/');
                return `${mo}.${dy}.`;
              };

              return (
                <>
                  {todayMatches.map((m, i) => renderRow(m, i, true))}
                  {dateGroups.map((group) => (
                    <div key={group.dateKey}>
                      <div className="flex items-center gap-2 my-1">
                        <div className="flex-1 border-t border-slate-500" />
                        <span className="text-[8px] text-slate-400">{fmtDate(group.dateKey)}</span>
                        <div className="flex-1 border-t border-slate-500" />
                      </div>
                      {group.matches.map((m, i) => renderRow(m, i, false))}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {h2h && h2h.matches.length === 0 && (
        <div className="px-3 pb-1.5 text-[10px] text-slate-600 italic">Nincs H2H adat</div>
      )}
    </div>
  );
}

// ── Főkomponens ────────────────────────────────────────────────────────────────

export default function NapiMerkezesek() {
  const [selectedDate, setSelectedDate] = useState(todayInputValue);
  const [matches, setMatches] = useState<DailyMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortDesc, setSortDesc] = useState(true); // csökkenő = alapértelmezett
  const [scoreCache, setScoreCache] = useState<Record<string, { a: number; b: number }>>({});

  const handleScore = useCallback((playerA: string, playerB: string, startTime: number, scoreA: number, scoreB: number) => {
    const key = `${playerA}|${playerB}|${startTime}`;
    setScoreCache(prev => ({ ...prev, [key]: { a: scoreA, b: scoreB } }));
  }, []);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const mmDd = inputToMmDd(date);
      const resp = await fetch(`/api/daily-matches?date=${encodeURIComponent(mmDd)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: DailyMatch[] = await resp.json();
      // Merge: meglévő scoreA/scoreB megőrzése ha az új adat még nem hozta vissza
      setMatches(prev => {
        const prevMap = new Map(prev.map(m => [m.eventId, m]));
        return data.map(m => {
          const existing = prevMap.get(m.eventId);
          if (existing && m.scoreA === undefined && existing.scoreA !== undefined) {
            // Szerver még nem adta vissza a score-t — maradjunk a korábbi értéknél
            return { ...m, scoreA: existing.scoreA, scoreB: existing.scoreB };
          }
          return m;
        });
      });
      setLastRefresh(new Date());
    } catch {
      // Hiba esetén NEM töröljük a meglévő kártyákat — csak logoljuk
      console.warn('[NapiMerkezesek] fetch hiba — meglévő lista marad');
    } finally {
      setLoading(false);
    }
  }, []);

  // Betöltés dátumváltáskor
  useEffect(() => {
    load(selectedDate);
  }, [selectedDate, load]);

  // Auto-refresh 5 percenként (csak mai dátumnál érdemes, tab-látható csak)
  useEffect(() => {
    const today = todayInputValue();
    if (selectedDate !== today) return;
    return startVisiblePolling(() => load(selectedDate), 5 * 60_000, { runImmediately: false });
  }, [selectedDate, load]);

  const sortFn = (a: DailyMatch, b: DailyMatch) =>
    sortDesc ? b.startTime - a.startTime : a.startTime - b.startTime;

  const gtMatches = matches.filter(m => m.league === 'GT Leagues').sort(sortFn);
  const adriaticMatches = matches.filter(m => m.league === 'eAdriatic League').sort(sortFn);

  return (
    <div className="space-y-5">

      {/* Fejléc */}
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-white">Napi Mérkőzések</h1>

        {/* Dátumválasztó */}
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white
                     focus:outline-none focus:border-orange-400 cursor-pointer"
        />

        {/* Frissítés gomb */}
        <button
          onClick={() => load(selectedDate)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer
                     bg-dark-card border-dark-border text-slate-400 hover:text-white hover:border-slate-500
                     disabled:opacity-40 disabled:cursor-not-allowed"
          title="Kézi frissítés"
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
          Frissítés
        </button>

        {/* Idősorrend toggle */}
        <button
          onClick={() => setSortDesc(d => !d)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer
                     bg-dark-card border-dark-border text-slate-400 hover:text-white hover:border-slate-500"
          title="Idősorrend váltása"
        >
          {sortDesc ? (
            <>↓ Csökkenő</>
          ) : (
            <>↑ Növekvő</>
          )}
        </button>

        {/* Statisztika */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green inline-block" />
            GT: <strong className="text-slate-300">{gtMatches.length}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
            eAdriatic: <strong className="text-slate-300">{adriaticMatches.length}</strong>
          </span>
          {lastRefresh && (
            <span className="text-slate-600">
              Frissítve: {lastRefresh.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {loading && <span className="text-orange-400 animate-pulse">↻ töltés...</span>}
        </div>
      </div>

      {/* Két hasáb */}
      <div className="grid grid-cols-2 gap-6">

        {/* GT Leagues */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 pb-2 border-b border-dark-border">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green/20 text-green border border-green/30">
              GT
            </span>
            <span className="text-sm font-semibold text-white">GT Leagues</span>
            <span className="text-[10px] text-slate-500 ml-1">(12 perc)</span>
            <span className="ml-auto text-xs text-slate-500 font-mono">{gtMatches.length} meccs</span>
          </div>

          {loading && gtMatches.length === 0 ? (
            <div className="text-slate-500 text-sm py-4 text-center">Töltés...</div>
          ) : gtMatches.length === 0 ? (
            <div className="text-slate-600 text-sm py-4 text-center italic">
              {selectedDate !== todayInputValue()
                ? 'Nincs adat ehhez a naphoz.'
                : 'Nincs elérhető meccs (az msport ~60 perccel előre mutat).'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {gtMatches.map((m) => (
                <MatchCard
                  key={`${m.playerA}|${m.playerB}|${m.startTime}`}
                  match={m}
                  cachedScore={scoreCache[`${m.playerA}|${m.playerB}|${m.startTime}`]}
                  onScore={handleScore}
                />
              ))}
            </div>
          )}
        </div>

        {/* eAdriatic League */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 pb-2 border-b border-dark-border">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
              ADR
            </span>
            <span className="text-sm font-semibold text-white">eAdriatic League</span>
            <span className="text-[10px] text-slate-500 ml-1">(10 perc)</span>
            <span className="ml-auto text-xs text-slate-500 font-mono">{adriaticMatches.length} meccs</span>
          </div>

          {loading && adriaticMatches.length === 0 ? (
            <div className="text-slate-500 text-sm py-4 text-center">Töltés...</div>
          ) : adriaticMatches.length === 0 ? (
            <div className="text-slate-600 text-sm py-4 text-center italic">
              {selectedDate !== todayInputValue()
                ? 'Nincs adat ehhez a naphoz.'
                : 'Nincs elérhető meccs (az msport ~60 perccel előre mutat).'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {adriaticMatches.map((m) => (
                <MatchCard
                  key={`${m.playerA}|${m.playerB}|${m.startTime}`}
                  match={m}
                  cachedScore={scoreCache[`${m.playerA}|${m.playerB}|${m.startTime}`]}
                  onScore={handleScore}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Jelmagyarázat */}
      <div className="flex items-center gap-4 text-[10px] text-slate-600 border-t border-dark-border pt-3">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green/30 border border-green/50 inline-block" /> Live / épp folyamatban</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-yellow-500/20 border border-yellow-500/40 inline-block" /> &lt;15 percen belül kezd</span>
        <span className="flex items-center gap-1 opacity-50"><span className="w-2 h-2 rounded bg-dark-border inline-block" /> Lejátszott meccs</span>
        <span className="ml-auto text-slate-700">Az oldal 5 percenként automatikusan frissül</span>
      </div>
    </div>
  );
}
