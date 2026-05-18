import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchTopTips, TopTip, TopTipsResponse, fetchLiveScores, LiveScore, clearServerCache, resolveResults } from '../api';
import H2HModal from './H2HModal';
import TrendWidget from './TrendWidget';
import LivePitch from './LivePitch';
import { useNewTipDetector, useNotificationSettings } from '../hooks/useNotifications';
import { debouncedSaveJournal } from '../hooks/useRealtimeSync';
import { startVisiblePolling } from '../hooks/visiblePolling';


function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function confColor(c: number) {
  if (c >= 0.75) return 'text-green';
  if (c >= 0.6) return 'text-yellow';
  return 'text-red';
}

function leagueBadge(l: string) {
  if (l === 'GT Leagues') return 'bg-green/20 text-green';
  if (l === 'Esoccer Battle') return 'bg-yellow/20 text-yellow';
  if (l === 'eAdriatic League') return 'bg-sky-500/20 text-sky-400';
  if (l === 'Esoccer H2H GG League') return 'bg-orange-500/20 text-orange-400';
  if (l === 'Esports Volta') return 'bg-cyan-500/20 text-cyan-400';
  return 'bg-slate-600/30 text-slate-400';
}

function leagueAbbr(l: string) {
  if (l === 'GT Leagues') return 'GT';
  if (l === 'Esoccer Battle') return 'EB';
  if (l === 'eAdriatic League') return 'ADR';
  if (l === 'Esoccer H2H GG League') return 'H2H';
  if (l === 'Esports Volta') return 'VOLTA';
  return 'EV';
}

type SortMode = 'time' | 'probability';

const CHECKED_GREEN_KEY = 'checked_green_matches';
const CHECKED_RED_KEY = 'checked_red_matches';
const BETTING_JOURNAL_KEY = 'betting_journal';
const LIVE_SCORES_CACHE_KEY = 'live_scores_cache';
const LAST_KNOWN_LIVE_KEY = 'last_known_live_map';

interface CheckedMatch {
  matchId: string;
  tip: TopTip;
  timestamp: number;
  date: string;
  betType?: 'Over' | 'Under';
  betLine?: number;
  oddsSource?: string;
  result?: 'Win' | 'Loss';
  stake?: number;
  odds?: number;
  finalScore?: string;
  fromTrend?: boolean;
  trendType?: 'VALUE' | 'TREND' | 'SUPER_VALUE' | 'SUPER_TREND';
}

interface MatchListCardProps {
  match: CheckedMatch;
  idx: number;
  live: LiveScore | null;
  globalStake: number;
  maxMatchMin: (league?: string | null) => number;
  onUpdate: (matchId: string, field: 'betType' | 'betLine' | 'oddsSource' | 'result' | 'stake' | 'odds', value: any) => void;
  onRemove: (matchId: string) => void;
}

function MatchListCard({ match, idx, live, globalStake, maxMatchMin, onUpdate, onRemove }: MatchListCardProps) {
  const [showPitch, setShowPitch] = useState(false);
  const [betType, setBetType] = useState<'Over' | 'Under' | ''>(match.betType || '');
  const [oddsSource, setOddsSource] = useState<string>(match.oddsSource ?? match.tip?.oddsSource ?? '');
  const [betLine, setBetLine] = useState<number | ''>(match.betLine !== undefined ? match.betLine : '');
  const [odds, setOdds] = useState<number | ''>(match.odds !== undefined ? match.odds : '');
  const [stake, setStake] = useState<number>(match.stake ?? globalStake);
  const [result, setResult] = useState<'Win' | 'Loss' | ''>(match.result || '');

  // Sync auto-detected result from parent (live polling / batch validation) — user can also override manually
  useEffect(() => {
    if (match.result && !result) setResult(match.result);
  }, [match.result]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBetType = (v: string) => {
    setBetType(v as 'Over' | 'Under' | '');
    onUpdate(match.matchId, 'betType', v as 'Over' | 'Under');
  };
  const handleOddsSource = (v: string) => {
    setOddsSource(v);
    onUpdate(match.matchId, 'oddsSource', v);
  };
  const handleBetLine = (v: string) => {
    const parsed = v ? parseFloat(v) : undefined;
    setBetLine(v ? parseFloat(v) : '');
    onUpdate(match.matchId, 'betLine', parsed);
  };
  const handleOdds = (v: string) => {
    const parsed = v ? parseFloat(v) : undefined;
    setOdds(v ? parseFloat(v) : '');
    onUpdate(match.matchId, 'odds', parsed);
  };
  const handleStake = (v: string) => {
    const parsed = v ? parseFloat(v) : globalStake;
    setStake(parsed);
    onUpdate(match.matchId, 'stake', parsed);
  };
  const handleResult = (v: string) => {
    setResult(v as 'Win' | 'Loss' | '');
    onUpdate(match.matchId, 'result', v as 'Win' | 'Loss');
  };

  const displayLine = (betLine !== '' ? (betLine as number) : undefined) ?? match.betLine ?? match.tip?.ouLine;
  const effectiveBetType = betType || match.betType;
  const projected = (() => {
    if (result || !live || !effectiveBetType || !displayLine) return null;
    const total = live.scoreA + live.scoreB;
    if (effectiveBetType === 'Over') return total > displayLine ? 'Win' : 'Loss';
    if (effectiveBetType === 'Under') return total < displayLine ? 'Win' : 'Loss';
    return null;
  })();
  const showBetLine = effectiveBetType || displayLine || result || live;
  const showLive = live && !result;

  return (
    <div>
      <div
        className={`rounded-lg p-2.5 transition-all ${
          live?.isLive && !result && (live.minute ?? 0) < maxMatchMin(live.league)
            ? 'bg-green/5 border border-green/30'
            : match.trendType === 'SUPER_TREND'
            ? 'border-2 animate-pulse'
            : match.trendType === 'SUPER_VALUE'
            ? 'border-2 animate-pulse'
            : match.trendType === 'TREND'
            ? 'bg-orange-500/10 border-2 border-orange-400'
            : match.trendType === 'VALUE'
            ? 'border-2'
            : 'bg-dark-bg/40 border border-dark-border'
        }`}
        style={
          match.trendType === 'SUPER_VALUE'
            ? { backgroundColor: 'rgba(253,224,71,0.18)', borderColor: '#fde047', boxShadow: '0 0 12px rgba(253,224,71,0.35)' }
          : match.trendType === 'SUPER_TREND'
            ? { backgroundColor: 'rgba(249,115,22,0.18)', borderColor: '#f97316', boxShadow: '0 0 12px rgba(249,115,22,0.35)' }
          : match.trendType === 'VALUE'
            ? { backgroundColor: 'rgba(253,224,71,0.12)', borderColor: '#fde047' }
            : {}
        }
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
            <span className="text-slate-500 font-bold shrink-0">#{idx + 1}</span>
            {match.trendType === 'SUPER_VALUE' && (
              <span style={{backgroundColor:'#fde047',color:'#111827',boxShadow:'0 0 8px rgba(253,224,71,0.7)'}} className="px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 animate-pulse">
                💥 SUPER VALUE
              </span>
            )}
            {match.trendType === 'SUPER_TREND' && (
              <span style={{backgroundColor:'#f97316',color:'#fff',boxShadow:'0 0 8px rgba(249,115,22,0.7)'}} className="px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 animate-pulse">
                🔥 SUPER TREND
              </span>
            )}
            {match.trendType === 'VALUE' && (
              <span style={{backgroundColor:'#facc15',color:'#111827'}} className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0">
                💰 VALUE
              </span>
            )}
            {match.trendType === 'TREND' && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-orange-500 text-white">
                🚀 TREND
              </span>
            )}
            {match.tip.league && (
              <span className={`px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${leagueBadge(match.tip.league)}`}>
                {leagueAbbr(match.tip.league)}
              </span>
            )}
            <span className="text-slate-400 font-mono shrink-0">{match.tip.time || '—'}</span>
            <span className="text-white font-semibold truncate">
              {match.tip.playerA || '?'} vs {match.tip.playerB || '?'}
            </span>
            <span className="text-slate-400 shrink-0">
              GÓL <span className={`font-semibold ${match.tip.ouLine > 0 && Math.abs((match.tip.vartGol || 0) - match.tip.ouLine) >= 1.5 ? 'text-blue-400 border border-blue-500 rounded px-1' : match.tip.ouLine > 0 && Math.abs((match.tip.vartGol || 0) - match.tip.ouLine) >= 0.6 ? 'text-green border border-green rounded px-1' : 'text-accent-light'}`}>{match.tip.vartGol?.toFixed(1) || '—'}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-2 shrink-0">
            {live?.isLive && !match.result && (live.minute ?? 0) < maxMatchMin(live.league) && (
              <button
                onClick={() => setShowPitch(p => !p)}
                title="Élő pályakép"
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${
                  showPitch
                    ? 'bg-red-500/20 border-red-500 text-red-400'
                    : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20 animate-pulse'
                }`}
              >
                📺
              </button>
            )}
            <button
              onClick={() => onRemove(match.matchId)}
              className="text-red hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 mb-2">
          <select
            value={betType}
            onChange={e => handleBetType(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
          >
            <option value="">O/U</option>
            <option value="Over">Over</option>
            <option value="Under">Under</option>
          </select>

          <select
            value={oddsSource}
            onChange={e => handleOddsSource(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
          >
            <option value="">Forrás</option>
            <option value="msport.com">msport</option>
            <option value="cloudbet">Cloudbet</option>
            <option value="vegas.hu">Vegas</option>
          </select>

          <select
            value={betLine !== '' ? betLine : ''}
            onChange={e => handleBetLine(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
          >
            <option value="">Vonal</option>
            {[1.25,1.5,1.75,2.25,2.5,2.75,3.25,3.5,3.75,4.25,4.5,4.75,5.25,5.5,5.75,6.25,6.5,6.75,7.25,7.5,7.75,8.25,8.5,8.75,9.25,9.5,9.75,10.25,10.5,10.75,11.25,11.5,11.75].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            step="0.01"
            min="1.01"
            max="50"
            placeholder="Odds"
            value={odds !== '' ? odds : ''}
            onChange={e => handleOdds(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
          />

          <input
            type="number"
            step="100"
            min="100"
            placeholder={String(globalStake)}
            value={stake}
            onChange={e => handleStake(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
          />

          <select
            value={result}
            onChange={e => handleResult(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
          >
            <option value="">Eredmény</option>
            <option value="Win">Win</option>
            <option value="Loss">Loss</option>
          </select>
        </div>

        {showBetLine && (
          <div className="mt-2 pt-2 border-t border-dark-border flex items-center gap-2 flex-wrap">
            {effectiveBetType && displayLine && (
              <span className="text-accent-light font-semibold text-xs">
                {effectiveBetType} {displayLine}
              </span>
            )}
            {showLive ? (
              <span className="font-mono font-bold text-base text-green tracking-wider">
                {live!.scoreA}:{live!.scoreB}
              </span>
            ) : match.finalScore ? (
              <span className="font-mono font-bold text-base text-slate-300 tracking-wider">
                {match.finalScore}
              </span>
            ) : null}
            {live?.isLive && !result && (live.minute ?? 0) < maxMatchMin(live.league) && (
              <span className="flex items-center gap-1 text-[10px] text-white">
                {live.periodName && <span className="font-semibold">{live.periodName}</span>}
                {live.minute !== null && <span className="font-bold">{live.minute}'</span>}
                <span className="text-[10px] font-bold text-green animate-pulse border border-green rounded px-1 py-px">Live</span>
              </span>
            )}
            {result ? (
              <span className={`font-semibold text-xs ${result === 'Win' ? 'text-green' : 'text-red'}`}>
                {result === 'Win' ? '✅' : '❌'} {result}
              </span>
            ) : projected ? (
              <span className={`text-xs font-semibold opacity-60 ${projected === 'Win' ? 'text-green' : 'text-red'}`}>
                {projected}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Élő pályakép panel */}
      {showPitch && live?.isLive && (
        <div className="mt-2">
          <LivePitch
            playerA={match.tip.playerA}
            playerB={match.tip.playerB}
            league={match.tip.league || ''}
            onClose={() => setShowPitch(false)}
          />
        </div>
      )}
    </div>
  );
}

export default function TopTips() {
  const [data, setData] = useState<TopTipsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(['GT Leagues', 'eAdriatic League']));
  const [limit, setLimit] = useState(20);
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const [h2hModal, setH2hModal] = useState<{ a: string; b: string; lg: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [strategy, setStrategy] = useState<'A' | 'B' | 'C'>('A');
  const [globalStake, setGlobalStake] = useState(() => parseInt(localStorage.getItem('global_stake') || '2000'));
  const [sourceFilter, setSourceFilter] = useState<string | null>(null); // fogadóiroda szűrő (Napló) — null = Mind
  const [mainSourceFilter, setMainSourceFilter] = useState<string | null>('msport.com'); // fogadóiroda szűrő (fő lista)

  useEffect(() => { localStorage.setItem('global_stake', String(globalStake)); }, [globalStake]);

  const [checkedMatches, setCheckedMatches] = useState<CheckedMatch[]>(() => {
    try {
      const stored = localStorage.getItem(CHECKED_GREEN_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const valid = parsed.filter((item: any) =>
        item && typeof item === 'object' && item.matchId && item.tip && typeof item.tip === 'object'
      );
      // Tegnap + mai meccseket megtartjuk (2 napos ablak)
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split('T')[0];
      const cutoff    = new Date(yesterday).getTime();
      const filtered = valid.filter((item: any) => {
        if (item.date) return item.date >= yesterday;
        if (item.timestamp && typeof item.timestamp === 'number' && !isNaN(item.timestamp)) {
          return item.timestamp >= cutoff;
        }
        return false;
      });
      if (filtered.length < valid.length) {
        localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(filtered));
      }
      return filtered;
    } catch (e) {
      console.error('Hiba a zöld pipák betöltésekor:', e);
      return [];
    }
  });

  const [checkedRed, setCheckedRed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(CHECKED_RED_KEY);
      if (!stored) return new Set();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch (e) {
      console.error('Hiba a piros pipák betöltésekor:', e);
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(checkedMatches));
    } catch (e) {
      console.error('Hiba a zöld pipák mentésekor:', e);
    }
  }, [checkedMatches]);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKED_RED_KEY, JSON.stringify([...checkedRed]));
    } catch (e) {
      console.error('Hiba a piros pipák mentésekor:', e);
    }
  }, [checkedRed]);

  useEffect(() => {
    const DAILY_CLEAR_KEY = 'daily_clear_date';
    const checkDailyClear = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const todayStr = now.toISOString().split('T')[0];
      const lastClear = localStorage.getItem(DAILY_CLEAR_KEY) || '';

      // 23:59-kor csak a 2+ napnál régebbi meccseket töröljük — tegnap + mai megmarad
      if (hours === 23 && minutes >= 59 && lastClear !== todayStr) {
        localStorage.setItem(DAILY_CLEAR_KEY, todayStr);
        const keepFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split('T')[0]; // tegnap
        console.log('🕐 23:59 - Régi meccsek törlése (tegnap + ma megmarad, Napló megmarad)');
        setCheckedMatches(prev => prev.filter(m => !m.date || m.date >= keepFrom));
        setCheckedRed(new Set());
        try {
          const stored = localStorage.getItem(CHECKED_GREEN_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            const cleaned = parsed.filter((m: any) => m.date && m.date >= keepFrom);
            localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(cleaned));
          }
          localStorage.removeItem(CHECKED_RED_KEY);
          console.log('✅ Régi meccsek törölve! Tegnap + mai + Napló megmaradt.');
        } catch (e) {
          console.error('Hiba a localStorage törlésekor:', e);
        }
      }
    };

    const interval = setInterval(checkDailyClear, 60_000);
    checkDailyClear();

    return () => clearInterval(interval);
  }, []);

  const { soundEnabled, toggleSound, browserNotifEnabled, enableBrowserNotif, disableBrowserNotif } = useNotificationSettings();

  useNewTipDetector(data?.tips, true);

  // Sync from Napló/validation: merge only result/finalScore, preserve user-edited fields
  useEffect(() => {
    const handleExternalUpdate = () => {
      try {
        const stored = localStorage.getItem(CHECKED_GREEN_KEY);
        if (!stored) return;
        const parsed: any[] = JSON.parse(stored);
        if (!Array.isArray(parsed)) return;
        const removed = removedMatchIdsRef.current;

        setCheckedMatches(prev => {
          const prevMap = new Map(prev.map(m => [m.matchId, m]));
          const next = [...prev];
          let changed = false;

          // HOZZÁADÁS: localStorage-ban lévő új itemek
          for (const item of parsed) {
            if (!item?.matchId || !item?.tip) continue;
            if (removed.has(item.matchId)) continue;
            const existing = prevMap.get(item.matchId);
            if (!existing) {
              next.push(item);
              changed = true;
            } else {
              const updated = {
                ...existing,
                result: item.result || existing.result,
                finalScore: item.finalScore || existing.finalScore,
              };
              if (updated.result !== existing.result || updated.finalScore !== existing.finalScore) {
                const idx = next.findIndex(m => m.matchId === item.matchId);
                if (idx !== -1) { next[idx] = updated; changed = true; }
              }
            }
          }

          return changed ? next : prev;
        });
      } catch {}
    };
    const handleTrendRemoved = (e: Event) => {
      const matchId = (e as CustomEvent<{ matchId: string }>).detail?.matchId;
      if (!matchId) return;
      setCheckedMatches(prev => prev.filter(m => m.matchId !== matchId));
    };

    window.addEventListener('checked-matches-updated', handleExternalUpdate);
    window.addEventListener('trend-match-removed', handleTrendRemoved);
    return () => {
      window.removeEventListener('checked-matches-updated', handleExternalUpdate);
      window.removeEventListener('trend-match-removed', handleTrendRemoved);
    };
  }, []);

  // loadRef: mindig az aktuális load-ot tartalmazza — retry setTimeout-hoz kell (stale closure elkerülése)
  const loadRef        = useRef<() => void>(() => {});
  const retryCountRef  = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    let keepLoading = false; // retry esetén ne állítsa le a spinnert
    try {
      let result: TopTipsResponse;

      if (selectedLeagues.size === 0) {
        result = await fetchTopTips(undefined, limit, strategy);
      } else if (selectedLeagues.size === 1) {
        result = await fetchTopTips(Array.from(selectedLeagues)[0], limit, strategy);
      } else {
        const leagueArr = Array.from(selectedLeagues);
        const settled = await Promise.allSettled(
          leagueArr.map(l => fetchTopTips(l, limit, strategy))
        );
        const allTips = settled
          .filter((r): r is PromiseFulfilledResult<TopTipsResponse> => r.status === 'fulfilled')
          .flatMap(r => r.value.tips);
        const base = settled.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<TopTipsResponse> | undefined;
        result = base
          ? { ...base.value, tips: allTips }
          : { tips: [], generated: new Date().toISOString(), totalScanned: 0, totalAnalyzed: 0, totalValueBets: 0 };
      }

      setData(result);
      retryCountRef.current = 0;
    } catch (err) {
      // Hálózati hiba (szerver még nem indult el) → automatikus újrapróbálkozás
      const isNetwork = err instanceof TypeError;
      if (isNetwork && retryCountRef.current < 6) {
        retryCountRef.current++;
        keepLoading = true; // spinner marad
        setTimeout(() => loadRef.current(), 3_000);
      } else {
        retryCountRef.current = 0;
        setError('Nem sikerült betölteni. Ellenőrizd a szervert (port 3005).');
      }
    } finally {
      if (!keepLoading) setLoading(false);
    }
  }, [selectedLeagues, limit, strategy]);

  useEffect(() => { loadRef.current = load; }, [load]);

  // Ref a checkedMatches aktuális értékéhez (stale closure elkerülése)
  const checkedMatchesRef = useRef(checkedMatches);
  useEffect(() => { checkedMatchesRef.current = checkedMatches; }, [checkedMatches]);

  // Szándékosan törölt meccs ID-k — handleExternalUpdate nem adja vissza ezeket
  const removedMatchIdsRef = useRef<Set<string>>(new Set());

  // ── Live score polling (10 másodpercenként) ────────────────────────────────
  const [liveScores, setLiveScores] = useState<LiveScore[]>(() => {
    try {
      const stored = localStorage.getItem(LIVE_SCORES_CACHE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  // Utolsó ismert live score minden meccshez (auto Win/Loss detektáláshoz)
  const lastKnownLive = useRef<Map<string, LiveScore>>((() => {
    try {
      const stored = localStorage.getItem(LAST_KNOWN_LIVE_KEY);
      if (!stored) return new Map<string, LiveScore>();
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Map<string, LiveScore>(parsed as [string, LiveScore][]);
      return new Map<string, LiveScore>();
    } catch { return new Map<string, LiveScore>(); }
  })());
  // Azok a meccs-kulcsok amiknél már ütemezve van a 30mp-es auto-resolution
  const scheduledResolution = useRef<Set<string>>(new Set());

  // Segéd: liga alapján max perc (FIFA eSports: GT=12p, ADR=10p)
  const maxMatchMin = (league?: string | null) => league === 'eAdriatic League' ? 10 : 12;

  useEffect(() => {
    let cancelled = false;

    // Segéd: localStorage + state frissítése + validáció ütemezése
    const applyMatchResult = (
          matchId: string,
          outcome: 'Win' | 'Loss',
          finalScore: string,
          validateAfterMs: number,
          validateFn: () => Promise<void>
        ) => {
          // Pure state update
          setCheckedMatches(prev =>
            prev.map(m =>
              m.matchId === matchId && !m.result
                ? { ...m, result: outcome, finalScore }
                : m
            )
          );
          // Side effects
          try {
            const journal: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
            const green: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
            const ji = journal.findIndex((j: any) => j.matchId === matchId);
            const gi = green.findIndex((g: any) => g.matchId === matchId);
            if (ji !== -1 && !journal[ji].result) journal[ji] = { ...journal[ji], result: outcome, finalScore };
            if (gi !== -1 && !green[gi].result) green[gi] = { ...green[gi], result: outcome, finalScore };
            localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
            localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(green));
            debouncedSaveJournal(journal);
            window.dispatchEvent(new Event('journal-updated'));
          } catch { /* silent */ }
          // Validáció késleltetetten
          setTimeout(validateFn, validateAfterMs);
        };

        // Segéd: esoccerbet.org validáció — felülírja az Altenar féleredményt ha eltér
        const scheduleValidation = (validateM: CheckedMatch, capturedLine: number, capturedScore: string, capturedOutcome: 'Win' | 'Loss') => async () => {
          try {
            const [res] = await resolveResults([{
              matchId: validateM.matchId,
              playerA: validateM.tip.playerA,
              playerB: validateM.tip.playerB,
              league: validateM.tip.league || 'GT Leagues',
              timestamp: validateM.timestamp,
              betType: validateM.betType!,
              betLine: capturedLine,
            }]);
            if (!res || res.pending || !res.outcome || !res.score) return;
            if (res.score === capturedScore && res.outcome === capturedOutcome) return;
            console.warn(`⚠️ Altenar vs esoccerbet mismatch: ${capturedScore} → ${res.score}`);
            setCheckedMatches(prev =>
              prev.map(m =>
                m.matchId === validateM.matchId
                  ? { ...m, result: res.outcome!, finalScore: res.score! }
                  : m
              )
            );
            const j2: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
            const g2: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
            const ji2 = j2.findIndex((x: any) => x.matchId === validateM.matchId);
            const gi2 = g2.findIndex((x: any) => x.matchId === validateM.matchId);
            if (ji2 !== -1) j2[ji2] = { ...j2[ji2], result: res.outcome, finalScore: res.score };
            if (gi2 !== -1) g2[gi2] = { ...g2[gi2], result: res.outcome, finalScore: res.score };
            localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(j2));
            localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(g2));
            debouncedSaveJournal(j2);
            window.dispatchEvent(new Event('journal-updated'));
            window.dispatchEvent(new Event('checked-matches-updated'));
          } catch { /* silent */ }
        };

    const poll = async () => {
      try {
        const scores = await fetchLiveScores();
        if (cancelled) return;

        // Auto Win/Loss: ha egy korábban élő meccs eltűnt a listából → vége
        // Altenar félidőben is küldhet isLive=false-t, ezért csak eltűnést detektálunk
        const currentKeys = new Set(scores.map(s => `${s.playerA}|${s.playerB}`));

        // Eltűnt meccsek → meccs véget ért
        for (const [key, prevScore] of lastKnownLive.current) {
          if (!currentKeys.has(key)) {
            const matchInList = checkedMatchesRef.current.find(m => {
              const nA = m.tip.playerA.toLowerCase();
              const nB = m.tip.playerB.toLowerCase();
              const sA = prevScore.playerA.toLowerCase();
              const sB = prevScore.playerB.toLowerCase();
              return (sA.includes(nA) || nA.includes(sA)) && (sB.includes(nB) || nB.includes(sB))
                  || (sA.includes(nB) || nB.includes(sA)) && (sB.includes(nA) || nA.includes(sB));
            });
            if (matchInList && !matchInList.result && matchInList.betType) {
              const line = matchInList.betLine || matchInList.tip?.ouLine;
              if (line) {
                const diffMin = (Date.now() - matchInList.timestamp) / 60000;
                if (diffMin >= -15 && diffMin <= 90) {
                  const total = prevScore.scoreA + prevScore.scoreB;
                  const outcome: 'Win' | 'Loss' = matchInList.betType === 'Over'
                    ? (total > line ? 'Win' : 'Loss')
                    : (total < line ? 'Win' : 'Loss');
                  const finalScore = `${prevScore.scoreA}:${prevScore.scoreB}`;
                  applyMatchResult(
                    matchInList.matchId, outcome, finalScore, 10_000,
                    scheduleValidation(matchInList, line, finalScore, outcome)
                  );
                }
              }
            }
            lastKnownLive.current.delete(key);
          }
        }
        // Frissítjük a lastKnownLive map-et az élő meccsekkel
        for (const s of scores) {
          if (s.isLive) lastKnownLive.current.set(`${s.playerA}|${s.playerB}`, s);
        }

        // 30 mp-es auto-resolution: ha a meccs elérte a max percet (meccs véget ért)
        // de még mindig szerepel a live listában (Cloudbet Web nem tűnik el azonnal)
        for (const s of scores) {
          if (!s.isLive) continue;
          const max = maxMatchMin(s.league);
          if ((s.minute ?? 0) < max) continue;
          const key = `${s.playerA}|${s.playerB}`;
          if (scheduledResolution.current.has(key)) continue;
          scheduledResolution.current.add(key);
          const snapScore = { ...s };
          setTimeout(() => {
            const finalLive = lastKnownLive.current.get(key) ?? snapScore;
            const matchInList = checkedMatchesRef.current.find(m => {
              const nA = m.tip.playerA.toLowerCase();
              const nB = m.tip.playerB.toLowerCase();
              const sA = finalLive.playerA.toLowerCase();
              const sB = finalLive.playerB.toLowerCase();
              return (sA.includes(nA) || nA.includes(sA)) && (sB.includes(nB) || nB.includes(sB))
                  || (sA.includes(nB) || nB.includes(sA)) && (sB.includes(nA) || nA.includes(sB));
            });
            if (!matchInList || matchInList.result || !matchInList.betType) return;
            const line = matchInList.betLine || matchInList.tip?.ouLine;
            if (!line) return;
            const diffMin = (Date.now() - matchInList.timestamp) / 60000;
            if (diffMin < -5 || diffMin > 90) return;
            const total = finalLive.scoreA + finalLive.scoreB;
            const outcome: 'Win' | 'Loss' = matchInList.betType === 'Over'
              ? (total > line ? 'Win' : 'Loss')
              : (total < line ? 'Win' : 'Loss');
            const finalScore = `${finalLive.scoreA}:${finalLive.scoreB}`;
            applyMatchResult(
              matchInList.matchId, outcome, finalScore, 30_000,
              scheduleValidation(matchInList, line, finalScore, outcome)
            );
          }, 30_000);
        }

        setLiveScores(scores);

        // Perzisztencia: liveScores + lastKnownLive mentése localStorage-ba
        try {
          localStorage.setItem(LIVE_SCORES_CACHE_KEY, JSON.stringify(scores));
          localStorage.setItem(LAST_KNOWN_LIVE_KEY, JSON.stringify(Array.from(lastKnownLive.current.entries())));
        } catch { /* silent */ }
      } catch { /* silent */ }
    };
    const stopPoll = startVisiblePolling(poll, 10_000);
    return () => { cancelled = true; stopPoll(); };
  }, []);

  // ── Batch validáció: 3 percenként ellenőrzi a hiányzó végeredményeket ──────
  useEffect(() => {
    const batchValidate = async () => {
      const now = Date.now();
      // Csak azok a meccsek, ahol nincs eredmény, és a meccs már >20 perccel ezelőtt volt (de <8 óra)
      // checkedMatchesRef.current használata a stale closure elkerüléséhez
      const pending = checkedMatchesRef.current.filter(m =>
        !m.result &&
        m.betType &&
        (m.betLine || m.tip?.ouLine) &&
        m.timestamp < now - 20 * 60_000 &&
        m.timestamp > now - 8 * 3600_000
      );
      if (pending.length === 0) return;
      try {
        const results = await resolveResults(pending.map(m => ({
          matchId: m.matchId,
          playerA: m.tip.playerA,
          playerB: m.tip.playerB,
          league: m.tip.league || 'GT Leagues',
          timestamp: m.timestamp,
          betType: m.betType!,
          betLine: (m.betLine || m.tip?.ouLine)!,
        })));
        const resolved = results.filter(r => !r.pending && r.outcome && r.score);
        if (resolved.length === 0) return;
        // State update (pure)
        setCheckedMatches(prev => {
          const updated = [...prev];
          let changed = false;
          resolved.forEach(r => {
            const idx = updated.findIndex(m => m.matchId === r.matchId);
            if (idx === -1 || updated[idx].result) return;
            updated[idx] = { ...updated[idx], result: r.outcome!, finalScore: r.score! };
            changed = true;
            console.log(`✅ Batch validáció: ${updated[idx].tip.playerA} vs ${updated[idx].tip.playerB} → ${r.outcome} ${r.score}`);
          });
          return changed ? updated : prev;
        });
        // Side effects outside updater
        try {
          const journal: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
          const green: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
          resolved.forEach(r => {
            const ji = journal.findIndex((j: any) => j.matchId === r.matchId);
            if (ji !== -1 && !journal[ji].result) {
              journal[ji] = { ...journal[ji], result: r.outcome, finalScore: r.score };
            }
            const gi = green.findIndex((g: any) => g.matchId === r.matchId);
            if (gi !== -1 && !green[gi].result) {
              green[gi] = { ...green[gi], result: r.outcome, finalScore: r.score };
            }
          });
          localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
          localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(green));
          debouncedSaveJournal(journal);
          window.dispatchEvent(new Event('journal-updated'));
          window.dispatchEvent(new Event('checked-matches-updated'));
        } catch { /* silent */ }
      } catch { /* silent */ }
    };
    // Első futtatás 2 perccel késleltetett, majd 3 percenként (tab-látható csak)
    let stopPoll: (() => void) | null = null;
    const t1 = setTimeout(() => {
      stopPoll = startVisiblePolling(batchValidate, 3 * 60_000);
    }, 2 * 60_000);
    return () => { clearTimeout(t1); stopPoll?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Megkeresi a live score-t — csak ha a meccs ütemezett időpontjától max ±90 perc telt el */
  const findLiveScore = (pA: string, pB: string, matchTimestamp?: number): LiveScore | null => {
    if (matchTimestamp) {
      const diffMin = (Date.now() - matchTimestamp) / 60000;
      // eFIFA meccs ~12 perc → 25 perc után már nem lehet élő az adott bejegyzés
      // (ha ugyanaz a páros újra játszik, az már egy másik meccs)
      if (diffMin < -5 || diffMin > 30) return null;
    }
    const nA = pA.toLowerCase().trim();
    const nB = pB.toLowerCase().trim();
    return liveScores.find(s => {
      const sA = s.playerA.toLowerCase();
      const sB = s.playerB.toLowerCase();
      return (sA.includes(nA) || nA.includes(sA)) && (sB.includes(nB) || nB.includes(sB))
        || (sA.includes(nB) || nB.includes(sA)) && (sB.includes(nA) || nA.includes(sB));
    }) ?? null;
  };

  const toggleLeague = (league: string) => {
    setSelectedLeagues(prev => {
      const next = new Set(prev);
      if (next.has(league)) {
        next.delete(league);
      } else {
        next.add(league);
      }
      return next;
    });
  };

  // Stratégia váltáskor: cache törlés, majd újratöltés
  const prevStrategyRef = useRef<string>(strategy);
  useEffect(() => {
    if (prevStrategyRef.current === strategy) { load(); return; }
    prevStrategyRef.current = strategy;
    clearServerCache().finally(() => load());
  }, [load]); // load változik ha strategy változik → ez fut le

  useEffect(() => {
    if (!autoRefresh) return;
    // Háttér tab → ne pollozzunk; a load() amúgy is nagy fetch
    return startVisiblePolling(load, 60_000, { runImmediately: false });
  }, [autoRefresh, load]);

  const toggleGreenCheck = (matchId: string, tip: TopTip) => {
    setCheckedMatches(prev => {
      const exists = prev.find(m => m.matchId === matchId);
      if (exists) {
        return prev.filter(m => m.matchId !== matchId);
      } else {
        setCheckedRed(prevRed => {
          const nextRed = new Set(prevRed);
          nextRed.delete(matchId);
          return nextRed;
        });
        
        const today = new Date().toISOString().split('T')[0];
        let matchDate = tip.date || today;
        
        if (matchDate && matchDate.includes('/')) {
          const [month, day] = matchDate.split('/');
          const year = new Date().getFullYear();
          matchDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        const matchTime = tip.time || '00:00';
        const matchDateTime = new Date(`${matchDate}T${matchTime}`);
        const timestamp = matchDateTime.getTime();
        
        // Auto-populate bet fields from tip data
        const autoBetType: 'Over' | 'Under' | undefined =
          tip.valueBet?.toUpperCase().startsWith('OVER') ? 'Over'
          : tip.valueBet?.toUpperCase().startsWith('UNDER') ? 'Under'
          : tip.vartGol > (tip.ouLine || 0) ? 'Over' : 'Under';
        const autoOdds = autoBetType === 'Over'
          ? (tip.oddsOver && tip.oddsOver > 1 ? tip.oddsOver : undefined)
          : (tip.oddsUnder && tip.oddsUnder > 1 ? tip.oddsUnder : undefined);

        const newMatch = {
          matchId,
          tip,
          timestamp,
          date: matchDate,
          betType: autoBetType,
          betLine: tip.ouLine > 0 ? tip.ouLine : undefined,
          oddsSource: tip.oddsSource || '',
          odds: autoOdds,
          stake: globalStake,
          strategy,
        };
        
        try {
          const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
          const alreadyInJournal = journal.some((m: any) => m.matchId === matchId);
          if (!alreadyInJournal) {
            journal.push(newMatch);
            localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
            debouncedSaveJournal(journal);
          }
        } catch (e) {
          console.error('Napló mentési hiba:', e);
        }
        
        return [...prev, newMatch];
      }
    });
  };

  const toggleRedCheck = (matchId: string) => {
    setCheckedRed(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
        setCheckedMatches(prevGreen => prevGreen.filter(m => m.matchId !== matchId));
      }
      return next;
    });
  };

  const removeFromGreenList = (matchId: string) => {
    removedMatchIdsRef.current.add(matchId);
    setCheckedMatches(prev => prev.filter(m => m.matchId !== matchId));
    // Sync localStorage immediately so handleExternalUpdate can't race
    try {
      const green: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
      localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(green.filter((m: any) => m.matchId !== matchId)));
    } catch { /* silent */ }
  };

  const updateJournalEntry = (matchId: string, field: 'betType' | 'betLine' | 'oddsSource' | 'result' | 'stake' | 'odds', value: any) => {
    // 1. State update (pure — no side effects inside)
    setCheckedMatches(prev =>
      prev.map(match => {
        if (match.matchId !== matchId) return match;
        if (field === 'oddsSource') {
          return { ...match, oddsSource: value, tip: { ...match.tip, oddsSource: value } };
        }
        return { ...match, [field]: value };
      })
    );

    // 2. Side effects outside the updater (localStorage + journal + event)
    try {
      const currentGreen: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
      const gi = currentGreen.findIndex((m: any) => m.matchId === matchId);
      if (gi !== -1) {
        if (field === 'oddsSource') {
          currentGreen[gi] = { ...currentGreen[gi], oddsSource: value, tip: { ...currentGreen[gi].tip, oddsSource: value } };
        } else {
          currentGreen[gi] = { ...currentGreen[gi], [field]: value };
        }
        localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(currentGreen));
      }

      const journal: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
      const journalIndex = journal.findIndex((m: any) => m.matchId === matchId);
      if (journalIndex !== -1) {
        journal[journalIndex] = { ...journal[journalIndex], [field]: value };
      } else {
        const matchData = currentGreen.find((m: any) => m.matchId === matchId);
        if (matchData) journal.push(matchData);
      }
      localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
      debouncedSaveJournal(journal);
      window.dispatchEvent(new Event('journal-updated'));
    } catch (e) {
      console.error('Journal update hiba:', e);
    }
  };

  const getMatchId = (tip: TopTip) => `${tip.playerA}-${tip.playerB}-${tip.time}`;
  const hasHighWinChance = (tip: TopTip) => tip.winEselyA >= 0.7 || tip.winEselyB >= 0.7;
  const isGreenChecked = (matchId: string) => checkedMatches.some(m => m.matchId === matchId);

  return (
    <div className="flex gap-10">
      <div className="flex-1 space-y-6">
        {/* Intraday Trend Widget */}
        <TrendWidget strategy={strategy} stake={globalStake} />

        {/* Controls — two-column: filters left, tall Frissítés right */}
        <div className="flex gap-3 items-stretch">
          <div className="flex-1 flex flex-col gap-2">

          {/* Felső sor: Liga gombok */}
          <div className="flex items-center gap-2">
            <button onClick={() => toggleLeague('GT Leagues')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('GT Leagues') ? 'bg-green/20 text-green border-2 border-green' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              GT Leagues (12p)
            </button>
            <button onClick={() => toggleLeague('eAdriatic League')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('eAdriatic League') ? 'bg-sky-500/20 text-sky-400 border-2 border-sky-500' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              eAdriatic League (10p)
            </button>
            <button onClick={() => toggleLeague('Esoccer H2H GG League')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esoccer H2H GG League') ? 'bg-orange-500/20 text-orange-400 border-2 border-orange-400' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              H2H GG League (8p)
            </button>
            <button onClick={() => toggleLeague('Esoccer Battle')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esoccer Battle') ? 'bg-yellow/20 text-yellow border-2 border-yellow' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              Esoccer Battle (8p)
            </button>
            <button onClick={() => toggleLeague('Esports Volta')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esports Volta') ? 'bg-cyan-500/20 text-cyan-400 border-2 border-cyan-400' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              Esports Volta (6p)
            </button>
          </div>

          {/* Középső sor: Strategy + Fogadóiroda szűrő + Tét */}
          <div className="flex items-center gap-2">
            {(['A', 'B', 'C'] as const).map(s => (
              <button key={s} onClick={() => setStrategy(s)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  strategy === s
                    ? s === 'C'
                      ? 'bg-cyan-500/20 text-cyan-300 border-2 border-cyan-400'
                      : 'bg-accent/20 text-accent-light border-2 border-accent'
                    : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
                }`}>
                {s === 'A' ? 'Strategy A' : s === 'B' ? 'Strategy B' : '✦ Strategy C'}
              </button>
            ))}
            <span className="w-px h-4 bg-dark-border mx-1" />
            {/* Fogadóiroda O/U szűrő: msport | cloudbet | vegas | Mind */}
            {([
              { key: 'msport.com', label: 'msport',   active: 'bg-sky-500/20 text-sky-400 border-sky-500',     idle: 'bg-dark-card text-slate-400 border-dark-border hover:border-sky-700' },
              { key: 'cloudbet',   label: 'Cloudbet', active: 'bg-orange-500/20 text-orange-400 border-orange-500', idle: 'bg-dark-card text-slate-400 border-dark-border hover:border-orange-700' },
              { key: 'vegas.hu',   label: 'Vegas',    active: 'bg-green-500/20 text-green-400 border-green-500',  idle: 'bg-dark-card text-slate-400 border-dark-border hover:border-green-700' },
            ] as const).map(({ key, label, active, idle }) => (
              <button key={key}
                onClick={() => setMainSourceFilter(prev => prev === key ? null : key)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-semibold cursor-pointer transition ${mainSourceFilter === key ? active : idle}`}>
                {label}
              </button>
            ))}
            <button
              onClick={() => setMainSourceFilter(null)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-semibold cursor-pointer transition ${!mainSourceFilter ? 'bg-accent/20 text-accent-light border-accent' : 'bg-dark-card text-slate-400 border-dark-border hover:border-slate-500'}`}>
              Mind
            </button>
            <span className="flex-1" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 font-semibold">Tét:</span>
              <input
                type="number"
                step="500"
                min="100"
                value={globalStake}
                onChange={e => setGlobalStake(Math.max(100, parseInt(e.target.value) || 2000))}
                className="w-24 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white font-mono text-right focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-slate-500">Ft</span>
            </div>
          </div>

          {/* Alsó sor: Top N + Rendezés + checkboxok */}
          <div className="flex items-center gap-2">
            {[5, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setLimit(n)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${limit === n ? 'bg-accent/20 text-accent-light border-2 border-accent' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
                Top {n}
              </button>
            ))}
            <span className="w-px h-4 bg-dark-border mx-1" />
            <button onClick={() => setSortMode('time')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'time' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}>
              🕐 Idő szerint
            </button>
            <button onClick={() => setSortMode('probability')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'probability' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}>
              📊 Esély szerint
            </button>
            <span className="w-px h-4 bg-dark-border mx-1" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent w-3.5 h-3.5" />
              Auto (60s)
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={soundEnabled} onChange={toggleSound} className="accent-accent w-3.5 h-3.5" />
              Hang
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={browserNotifEnabled} onChange={e => e.target.checked ? enableBrowserNotif() : disableBrowserNotif()} className="accent-accent w-3.5 h-3.5" />
              Értesítés
            </label>
          </div>

          </div>{/* end left flex-col */}

          {/* Tall Frissítés button */}
          <button onClick={load} disabled={loading}
            className="self-stretch px-6 rounded-xl bg-accent/20 text-accent-light hover:bg-accent/30 font-semibold text-sm tracking-wide cursor-pointer disabled:opacity-50 transition border border-accent/30 min-w-[110px]">
            {loading ? '⏳ Keresés...' : '🔄 Frissítés'}
          </button>
        </div>{/* end two-column wrapper */}

        {error && <p className="text-red text-sm">{error}</p>}

        {/* Tips list */}
        {(() => {
          if (!data) return null;
          
          // Percek a most-tól (éjféli átfordulást kezelve)
          const minutesFromNow = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            const matchMins = h * 60 + m;
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            let diff = matchMins - nowMins;
            if (diff < -120) diff += 1440; // éjféli átfordulás: ha >2 órával a múltban, akkor holnap
            return diff;
          };

          let tips = [...data.tips];

          if (selectedLeagues.size > 0) {
            tips = tips.filter(tip => selectedLeagues.has(tip.league));
          }

          tips = tips.filter(tip => !checkedRed.has(getMatchId(tip)));

          // Fogadóiroda szűrő: NEM szűr ki meccseket — csak a megjelenített O/U vonalat változtatja
          // (A forrástól független H2H adatok mindig látszanak)

          // Több liga esetén: ha tartalmaz nem-msport ligát, 45-perces ablak
          // GT + eAdriatic esetén nincs időablak (mindkét liga folyamatosan megy)
          const msportOnlySelected =
            selectedLeagues.size >= 2 &&
            Array.from(selectedLeagues).every(l => l === 'GT Leagues' || l === 'eAdriatic League');
          if (selectedLeagues.size >= 2 && !msportOnlySelected) {
            tips = tips.filter(tip => {
              const diff = minutesFromNow(tip.time);
              return diff >= -5 && diff <= 45;
            });
          }

          if (sortMode === 'time') {
            tips = [...tips].sort((a, b) => minutesFromNow(a.time) - minutesFromNow(b.time));
          } else {
            tips = [...tips].sort((a, b) => {
              const maxA = Math.max(a.winEselyA, a.winEselyB);
              const maxB = Math.max(b.winEselyA, b.winEselyB);
              return maxB - maxA;
            });
          }

          if (tips.length === 0) return <p className="text-slate-400 text-sm">Nincs találat.</p>;

          return (
            <div className="grid gap-4">
              {tips.map((tip, idx) => {
                const matchId = getMatchId(tip);
                const isGreen = isGreenChecked(matchId);
                const isRed = checkedRed.has(matchId);
                const isChecked = isGreen || isRed;
                const isHighWin = hasHighWinChance(tip);

                const isTrendGreen = checkedMatches.some(m =>
                  m.fromTrend &&
                  m.tip.playerA?.toLowerCase() === tip.playerA?.toLowerCase() &&
                  m.tip.playerB?.toLowerCase() === tip.playerB?.toLowerCase()
                );
                const cardOpacity = isChecked ? 'opacity-50' : isTrendGreen ? 'opacity-60' : 'opacity-100';

                // Aktív forrás: mainSourceFilter-rel kiválasztott forrás oddsait mutatjuk
                // Ha az adott forrásnak nincs adata, az alapértelmezett ouLine jelenik meg
                const activeSourceKey = mainSourceFilter && tip.allOdds?.[mainSourceFilter]
                  ? mainSourceFilter
                  : (tip.oddsSource !== 'n/a' ? tip.oddsSource : null);
                const activeOuLine = (mainSourceFilter && tip.allOdds?.[mainSourceFilter]?.ouLine)
                  || tip.ouLine;
                const activeOddsOver = (mainSourceFilter && tip.allOdds?.[mainSourceFilter]?.oddsOver)
                  || tip.oddsOver;
                const activeOddsUnder = (mainSourceFilter && tip.allOdds?.[mainSourceFilter]?.oddsUnder)
                  || tip.oddsUnder;
                const activeOddsAvailable = !mainSourceFilter || !!tip.allOdds?.[mainSourceFilter];

                const golDiff = activeOuLine > 0 && activeOddsAvailable
                  ? Math.abs(tip.vartGol - activeOuLine)
                  : 0;
                const hasStrongGolValue = golDiff >= 1.5;  // kék keret
                const hasGolValue = golDiff >= 0.6;        // zöld keret
                // bordó mindig prioritás — felülírja a zöld/kék/sárga keretet
                const cardBorder = isTrendGreen ? 'border-red-600'
                  : isChecked ? 'border-dark-border'
                  : hasStrongGolValue ? 'border-blue-500'
                  : hasGolValue ? 'border-green'
                  : isHighWin ? 'border-yellow-500'
                  : 'border-dark-border';
                const cardGlow = isTrendGreen ? 'shadow-[0_0_18px_rgba(220,38,38,0.55)]'
                  : hasStrongGolValue && !isChecked ? 'shadow-[0_0_14px_rgba(59,130,246,0.55)]'
                  : hasGolValue && !isChecked ? 'shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                  : isHighWin && !isChecked ? 'shadow-yellow-glow'
                  : '';
                // O/U tip is primary; win tip only when no O/U line; n/a while waiting for real odds
                const ouDir = tip.vartGol > activeOuLine ? 'OVER' : 'UNDER';
                const displayTip = !activeOddsAvailable
                  ? `N/A (${mainSourceFilter === 'msport.com' ? 'msport' : mainSourceFilter === 'cloudbet' ? 'Cloudbet' : 'Vegas'})`
                  : tip.oddsSource === 'n/a' && !activeOuLine
                  ? 'Várakozás...'
                  : activeOuLine > 0
                    ? `${ouDir} ${activeOuLine}`
                    : tip.valueBet;

                return (
                  <div key={idx}>
                  <div
                    className={`bg-dark-card border-2 ${cardBorder} rounded-xl overflow-hidden transition-all ${cardOpacity} ${cardGlow} min-w-[900px] w-full flex flex-col`}
                  >
                    <div className="flex items-center gap-4 px-5 py-3 bg-dark-bg/40 border-b border-dark-border">
                      <span className="text-xs font-bold text-slate-500 w-6 shrink-0">#{idx + 1}</span>
                      <div className={`px-2 py-1 rounded text-[10px] font-bold ${leagueBadge(tip.league)}`}>
                        {tip.league === 'GT Leagues' ? 'GT' : tip.league === 'Esoccer Battle' ? 'EB' : tip.league === 'eAdriatic League' ? 'ADR' : tip.league === 'Esoccer H2H GG League' ? 'H2H' : tip.league === 'Esports Volta' ? 'VOLTA' : 'EV'}
                      </div>

                      <span className="text-sm text-white font-mono font-bold whitespace-nowrap">{tip.time}</span>
                      {/* O/U vonal — az aktív forrás szerint (mainSourceFilter) */}
                      {!activeOddsAvailable ? (
                        <span className="text-sm font-semibold whitespace-nowrap text-slate-600 italic flex items-center gap-1">
                          O/U <span className="text-slate-500">N/A</span>
                          <span className="text-[10px] text-slate-700">
                            {mainSourceFilter === 'msport.com' ? 'msport' : mainSourceFilter === 'cloudbet' ? 'cloudbet' : 'vegas'}
                          </span>
                          {/* Más forrás vonala szürke tájékoztatóként */}
                          {tip.ouLine > 0 && (
                            <span className="text-[10px] text-slate-600 font-mono ml-1">({tip.ouLine})</span>
                          )}
                        </span>
                      ) : activeOuLine > 0 ? (
                        <span className={`text-sm font-semibold whitespace-nowrap flex items-center gap-1 ${
                          activeSourceKey === 'vegas.hu' ? 'text-green-400' :
                          activeSourceKey === 'bet365'   ? 'text-blue-400' :
                          activeSourceKey === 'msport.com' ? 'text-sky-400' :
                          activeSourceKey === 'cloudbet' ? 'text-orange-400' : 'text-accent-light'
                        }`}>
                          O/U {activeOuLine}
                          {activeSourceKey === 'vegas.hu'   && <span className="text-[10px] text-green-500">vegas</span>}
                          {activeSourceKey === 'msport.com' && <span className="text-[10px] text-sky-500">msport</span>}
                          {activeSourceKey === 'cloudbet'   && <span className="text-[10px] text-orange-400">cloudbet</span>}
                          {activeSourceKey === 'bet365'     && <span className="text-[10px] text-blue-500">b365</span>}
                          {activeOddsOver && activeOddsOver > 1 && (
                            <span className={`text-[11px] font-mono ml-1 ${
                              activeSourceKey === 'vegas.hu' ? 'text-green-400' :
                              activeSourceKey === 'msport.com' ? 'text-sky-400' :
                              activeSourceKey === 'cloudbet' ? 'text-orange-400' : 'text-slate-400'
                            }`}>
                              ↑{activeOddsOver.toFixed(2)} ↓{(activeOddsUnder ?? 0).toFixed(2)}
                            </span>
                          )}
                          {/* Többi forrás vonala halvány info-ként */}
                          {tip.allOdds && Object.entries(tip.allOdds)
                            .filter(([k]) => k !== activeSourceKey)
                            .map(([src, o]) => (
                              <span key={src} className="text-[9px] text-slate-600 font-mono">
                                {src === 'msport.com' ? 'ms' : src === 'cloudbet' ? 'cb' : src === 'vegas.hu' ? 'vg' : src}:{o.ouLine}
                              </span>
                            ))
                          }
                        </span>
                      ) : (
                        <span className="text-sm font-semibold whitespace-nowrap text-slate-500 italic">
                          O/U <span className="text-slate-400">n/a</span>
                        </span>
                      )}
                      <span className={`text-sm whitespace-nowrap ${hasStrongGolValue ? 'border border-blue-500 rounded px-2 py-0.5' : hasGolValue ? 'border border-green rounded px-2 py-0.5' : ''}`}>
                        <span className="text-slate-400">GÓL </span>
                        <span className={`font-semibold ${hasStrongGolValue ? 'text-blue-400' : hasGolValue ? 'text-green' : 'text-white'}`}>{tip.vartGol.toFixed(1)}</span>
                      </span>
                      
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <span className={`text-sm font-bold ${isHighWin && tip.winEselyA >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-accent-light'}`}>
                          {pct(tip.winEselyA)}
                        </span>
                        <span className="text-slate-500 text-sm">vs.</span>
                        <span className={`text-sm font-bold ${isHighWin && tip.winEselyB >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-purple'}`}>
                          {pct(tip.winEselyB)}
                        </span>
                        
                        <div className="flex flex-col items-end ml-4">
                          <span className={`text-sm font-semibold uppercase ${isHighWin && tip.winEselyA >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                            {tip.playerA}
                          </span>
                          {tip.teamA && <span className="text-[10px] text-slate-500 leading-tight">{tip.teamA}</span>}
                        </div>
                        <span className="text-slate-500 text-sm">vs.</span>
                        <div className="flex flex-col items-start">
                          <span className={`text-sm font-semibold uppercase ${isHighWin && tip.winEselyB >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                            {tip.playerB}
                          </span>
                          {tip.teamB && <span className="text-[10px] text-slate-500 leading-tight">{tip.teamB}</span>}
                        </div>
                      </div>

                      <span className={`text-lg font-bold whitespace-nowrap ${confColor(tip.confidence)}`}>
                        {Math.round(tip.confidence * 100)}%
                      </span>
                    </div>

                    <div className="px-5 py-3 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="text-[10px] text-slate-400">Ajánlott tipp</p>
                            <p className={`text-sm font-bold ${hasStrongGolValue ? 'text-blue-400' : hasGolValue ? 'text-green' : activeOuLine > 0 ? 'text-accent-light' : 'text-white'}`}>{displayTip}</p>
                          </div>
                          <span className="text-xs text-accent-light font-semibold bg-accent/10 px-2 py-0.5 rounded">
                            💰 {globalStake.toLocaleString('hu-HU')} Ft
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleGreenCheck(matchId, {
                              ...tip,
                              ouLine: activeOuLine || tip.ouLine,
                              oddsOver: activeOddsOver || tip.oddsOver,
                              oddsUnder: activeOddsUnder || tip.oddsUnder,
                              oddsSource: activeSourceKey || tip.oddsSource,
                            })}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                              isGreen
                                ? 'bg-green/30 border-green text-green'
                                : 'border-slate-600 hover:border-green'
                            }`}
                            title="Jó feltételek, megtéve"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => toggleRedCheck(matchId)}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                              isRed
                                ? 'bg-red/30 border-red text-red'
                                : 'border-slate-600 hover:border-red'
                            }`}
                            title="Rossz feltételek / nem találom"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Egyéni forma badge-sorok (a H2H chart helyén) */}
                      {((tip.lastMatchesA?.length ?? 0) > 0 || (tip.lastMatchesB?.length ?? 0) > 0) && (() => {
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        // Raw date formátum: "MM/DD HH:MM" → today prefix: "MM/DD"
                        const todayPrefix = `${mm}/${dd}`;
                        const renderBadges = (matches: typeof tip.lastMatchesA, name: string, gf?: number) => {
                          if (!matches?.length) return null;
                          return (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-white uppercase truncate">{name}</span>
                                <span className="text-[10px] text-slate-500 shrink-0 ml-1">
                                  {gf !== undefined && `Ø${gf.toFixed(1)}`}
                                </span>
                              </div>
                              <div className="flex gap-1 flex-wrap">
                                {matches.map((m, i) => {
                                  const goals = m.scoreHome + m.scoreAway;
                                  const isToday = m.date.startsWith(todayPrefix);
                                  const color = m.result === 'win' ? 'bg-green/20 text-green border-green/40'
                                    : m.result === 'loss' ? 'bg-red/20 text-red border-red/40'
                                    : 'bg-yellow/20 text-yellow border-yellow/40';
                                  return (
                                    <span key={i} className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${color} ${isToday ? 'ring-1 ring-white/40' : 'opacity-75'}`}>
                                      <span>{m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : 'D'}</span>
                                      <span className="text-[13px] font-mono leading-none">{goals}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        };
                        return (
                          <div className="flex gap-3 mb-2">
                            {renderBadges(tip.lastMatchesA, tip.playerA, tip.gfPerMatchA)}
                            <div className="w-px bg-dark-border shrink-0" />
                            {renderBadges(tip.lastMatchesB, tip.playerB, tip.gfPerMatchB)}
                          </div>
                        );
                      })()}

                      {/* H2H meccs-előzmény – egymás elleni meccsek */}
                      {(tip.h2hMatchHistory?.length ?? 0) > 0 && (() => {
                        const hist = tip.h2hMatchHistory!;
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        const todayPrefix = `${mm}/${dd}`;
                        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
                        const yesterdayPrefix = `${String(yest.getMonth()+1).padStart(2,'0')}/${String(yest.getDate()).padStart(2,'0')}`;

                        return (
                          <div className="bg-dark-bg/40 border border-dark-border rounded-lg overflow-hidden mb-2">
                            {/* Fejléc */}
                            <div className="flex items-center justify-between px-2 py-1 border-b border-dark-border bg-dark-bg/60">
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">
                                Egymás elleni
                              </span>
                              <span className="text-[10px] text-slate-500">ma + tegnap</span>
                            </div>
                            {/* Sorok */}
                            <div className="p-1">
                              {(() => {
                                // Napok szerinti csoportosítás (legfrissebb elöl)
                                const groupByDay = new Map<string, typeof hist>();
                                for (const m of hist) {
                                  const dayKey = m.date.slice(0, 5); // "MM/DD"
                                  if (!groupByDay.has(dayKey)) groupByDay.set(dayKey, []);
                                  groupByDay.get(dayKey)!.push(m);
                                }
                                // Rendezés: legújabb nap elöl, csak ma + tegnap, max 6-6
                                const dayEntries = Array.from(groupByDay.entries())
                                  .sort((a, b) => {
                                    const [am, ad] = a[0].split('/').map(Number);
                                    const [bm, bd] = b[0].split('/').map(Number);
                                    return (bm * 100 + bd) - (am * 100 + ad);
                                  })
                                  .filter(([dayKey]) => dayKey === todayPrefix || dayKey === yesterdayPrefix)
                                  .map(([dayKey, dayMatches]) => [dayKey, dayMatches.slice(0, 6)] as [string, typeof hist]);

                                const renderRow = (m: typeof hist[0], i: number, isToday: boolean) => {
                                  const totalGoals = m.goalsA + m.goalsB;
                                  // Csak az időpontot mutatjuk (HH:MM) — a dátum a fejlécben van
                                  const timeFmt = m.date.length > 5 ? m.date.slice(6, 11) : '';
                                  const aWon = m.winner === 'A';
                                  const bWon = m.winner === 'B';
                                  return (
                                    <div key={i} className={`flex items-center gap-1 mb-px rounded-sm ${isToday ? 'bg-accent/5' : ''}`}>
                                      <div className={`flex-1 min-w-0 flex items-center justify-end px-1.5 py-1 rounded-l ${aWon ? 'bg-green/25' : bWon ? 'bg-red/15' : 'bg-yellow/15'}`}>
                                        <span className={`text-[10px] font-bold truncate ${aWon ? 'text-green' : bWon ? 'text-slate-400' : 'text-yellow'}`}>
                                          {tip.playerA}
                                        </span>
                                      </div>
                                      <div className="shrink-0 text-center w-20 flex items-center justify-center gap-1">
                                        <span className="text-[11px] font-mono font-bold text-slate-300">{m.goalsA}–{m.goalsB}</span>
                                        <span className={`text-[15px] font-mono font-bold ${totalGoals >= 7 ? 'text-red' : totalGoals >= 5 ? 'text-yellow' : 'text-green'}`}>({totalGoals})</span>
                                      </div>
                                      <div className={`flex-1 min-w-0 flex items-center px-1.5 py-1 rounded-r ${bWon ? 'bg-green/25' : aWon ? 'bg-red/15' : 'bg-yellow/15'}`}>
                                        <span className={`text-[10px] font-bold truncate ${bWon ? 'text-green' : aWon ? 'text-slate-400' : 'text-yellow'}`}>
                                          {tip.playerB}
                                        </span>
                                      </div>
                                      <div className="shrink-0 w-16 flex items-center justify-end">
                                        <span className="text-[9px] text-slate-500 font-mono">{timeFmt}</span>
                                      </div>
                                    </div>
                                  );
                                };

                                return (
                                  <>
                                    {dayEntries.map(([dayKey, dayMatches], gi) => {
                                      const isToday = dayKey === todayPrefix;
                                      // Fejléc: MM/DD → MM.DD formátum + "Ma" jelölés
                                      const dayLabel = `${dayKey.slice(0,2)}.${dayKey.slice(3,5)}`;
                                      return (
                                        <div key={dayKey}>
                                          {/* Napi fejléc — középre */}
                                          <div className={`text-center ${gi === 0 ? 'mb-1' : 'mt-1.5 mb-1'}`}>
                                            <span className={`text-[9px] font-bold px-1 ${isToday ? 'text-accent-light' : 'text-slate-500'}`}>
                                              {dayLabel}
                                            </span>
                                          </div>
                                          {/* Az adott nap meccssorai */}
                                          {dayMatches.map((m, i) => renderRow(m, i, isToday))}
                                        </div>
                                      );
                                    })}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })()}

                      {tip.warning && (
                        <div className="flex items-center gap-2 bg-yellow/10 border border-yellow/30 rounded-lg p-2">
                          <svg className="w-4 h-4 text-yellow shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <p className="text-[11px] text-yellow">{tip.warning}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {data && (
          <p className="text-[10px] text-slate-600 text-center">
            Generálva: {new Date(data.generated).toLocaleString('hu-HU')} |
            {data.strategy && ` Stratégia: ${data.strategy.name} |`} Modell: H2H-first + Poisson + ELO
          </p>
        )}

      </div>

      {/* NAPLÓ */}
      <div className="w-[420px] shrink-0">
        <div className="bg-dark-card border border-dark-border rounded-xl p-4 sticky top-4">
          {(() => {
            const _todayIso = new Date().toISOString().split('T')[0];
            const visibleCount = checkedMatches
              .filter(m => m?.tip)
              .filter(m => !sourceFilter || m.oddsSource === sourceFilter || m.tip?.oddsSource === sourceFilter)
              .filter(m => (m.date || new Date(m.timestamp).toISOString().split('T')[0]) === _todayIso)
              .length;
            return (
              <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                ✅ Mérkőzés Lista ({visibleCount})
              </h3>
            );
          })()}

          {/* Fogadóiroda szűrő gombok — mindig látható mind a 4 */}
          {(() => {
            const ALL_SOURCES = [
              { val: null,          label: 'Mind',     active: 'bg-accent/20 text-accent-light border-accent' },
              { val: 'msport.com',  label: 'msport',   active: 'bg-sky-500/20 text-sky-400 border-sky-500' },
              { val: 'cloudbet',    label: 'Cloudbet', active: 'bg-orange-500/20 text-orange-400 border-orange-500' },
              { val: 'vegas.hu',    label: 'Vegas',    active: 'bg-green-500/20 text-green-400 border-green-500' },
            ];
            return (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="text-[9px] text-slate-500 font-semibold">Forrás:</span>
                {ALL_SOURCES.map(s => (
                  <button key={String(s.val)}
                    onClick={() => setSourceFilter(s.val)}
                    className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition ${
                      sourceFilter === s.val
                        ? s.active
                        : 'bg-dark-bg text-slate-400 border-dark-border hover:border-slate-500'
                    }`}>
                    {s.label}
                  </button>
                ))}
              </div>
            );
          })()}

          {checkedMatches.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Még nincs megtett meccs</p>
          ) : (
            <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2">
              {(() => {
                const todayIso = new Date().toISOString().split('T')[0];

                const sorted = checkedMatches
                  .filter(match => match && match.tip)
                  .filter(match => {
                    if (!sourceFilter) return true;
                    // Ellenőrizzük mind a két mezőt: felső szintű oddsSource VAGY tip.oddsSource
                    return (match.oddsSource === sourceFilter) || (match.tip?.oddsSource === sourceFilter);
                  })
                  .filter(match => {
                    // Csak a mai nap meccseit mutatjuk
                    const effectiveDate = match.date || new Date(match.timestamp).toISOString().split('T')[0];
                    return effectiveDate === todayIso;
                  })
                  .sort((a, b) => b.timestamp - a.timestamp);

                return sorted.map((match, idx) => (
                  <MatchListCard
                    key={match.matchId}
                    match={match}
                    idx={idx}
                    live={findLiveScore(match.tip.playerA, match.tip.playerB, (() => {
                      // tip.time = "HH:MM" → mai nap tényleges kezdési ideje ms-ban
                      const [h, m] = (match.tip.time || '00:00').split(':').map(Number);
                      const d = new Date(); d.setHours(h, m, 0, 0);
                      return d.getTime();
                    })())}
                    globalStake={globalStake}
                    maxMatchMin={maxMatchMin}
                    onUpdate={updateJournalEntry}
                    onRemove={removeFromGreenList}
                  />
                ));
              })()}
            </div>
          )}
        </div>
      </div>

      {h2hModal && (
        <H2HModal
          playerA={h2hModal.a}
          playerB={h2hModal.b}
          league={h2hModal.lg}
          onClose={() => setH2hModal(null)}
        />
      )}
    </div>
  );
}