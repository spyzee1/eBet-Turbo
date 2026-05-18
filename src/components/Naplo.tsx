import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

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

interface CheckedMatch {
  matchId: string;
  tip: {
    time: string;
    date: string;
    league?: string;
    playerA: string;
    playerB: string;
    vartGol: number;
    ouLine: number;
    oddsOver?: number;
    oddsUnder?: number;
    lastMatchesA?: Array<{ opponent: string; scoreHome: number; scoreAway: number; result: string; date: string }>;
    lastMatchesB?: Array<{ opponent: string; scoreHome: number; scoreAway: number; result: string; date: string }>;
  };
  timestamp: number;
  date: string; // YYYY-MM-DD formátum
  betType?: 'Over' | 'Under';
  betLine?: number;
  result?: 'Win' | 'Loss';
  stake?: number;
  odds?: number;
  strategy?: 'A' | 'B' | 'C';
  fromTrend?: boolean;
  trendType?: 'VALUE' | 'TREND' | 'SUPER_VALUE' | 'SUPER_TREND';
  trendAboveLinePct?: number;
  trendAboveLineCount?: number;
  trendAvgGoals?: number;
  trendSlope?: number;
  trendTodayH2H?: Array<{ time: string; goalsA: number; goalsB: number; total: number }>;
  trendTotalMatches?: number;
}

interface DayGroup {
  date: string;
  matches: CheckedMatch[];
}

const BETTING_JOURNAL_KEY = 'betting_journal'; // ← PERMANENT napló kulcs
const DEFAULT_STAKE = 1000; // Alapértelmezett tét: 1000 Ft

export default function Naplo() {
  const [matches, setMatches] = useState<CheckedMatch[]>([]);
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [defaultStake, setDefaultStake] = useState(DEFAULT_STAKE);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // localStorage betöltés - PERMANENT napló + EGYSZERI MIGRÁCIÓ
  useEffect(() => {
    try {
      let stored = localStorage.getItem(BETTING_JOURNAL_KEY);
      
      // ✅ EGYSZERI MIGRÁCIÓ: Régi meccsek átmásolása
      if (!stored) {
        console.log('🔄 MIGRÁCIÓ: Régi meccsek átmásolása...');
        const oldMatches = localStorage.getItem('checked_green_matches');
        if (oldMatches) {
          localStorage.setItem(BETTING_JOURNAL_KEY, oldMatches);
          stored = oldMatches;
          console.log('✅ MIGRÁCIÓ sikeres!');
        }
      }
      
      if (!stored) {
        setMatches([]);
        return;
      }
      
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        setMatches([]);
        return;
      }

      const validMatches = parsed.filter((item: any) => 
        item && 
        typeof item === 'object' && 
        item.matchId && 
        item.tip && 
        typeof item.tip === 'object'
      );

      // ✅ TIMESTAMP REPAIR: NULL értékek javítása
      const repairedMatches = validMatches.map((m: any) => {
        if (!m.timestamp || m.timestamp === null) {
          console.warn(`⚠️ Timestamp hiányzik: ${m.tip.playerA} vs ${m.tip.playerB}`);
          
          // Dátum rekonstrukció
          const today = new Date();
          const year = today.getFullYear();
          const dateStr = m.date || m.tip.date || '01/01';
          const timeStr = m.tip.time || '00:00';
          
          // MM/DD → YYYY-MM-DD
          let fullDate: string;
          if (dateStr.includes('-')) {
            fullDate = dateStr; // Már YYYY-MM-DD
          } else if (dateStr.includes('/')) {
            const [month, day] = dateStr.split('/');
            fullDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          } else {
            fullDate = `${year}-01-01`;
          }
          
          const repaired = new Date(`${fullDate}T${timeStr}`).getTime();
          console.log(`  ✅ Javítva: ${new Date(repaired).toLocaleString('hu-HU')}`);
          
          return { ...m, timestamp: repaired, date: fullDate };
        }
        return m;
      });

      // localStorage-ba visszamentés javított értékekkel
      try {
        localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(repairedMatches));
      } catch (e) {
        console.error('Javított adatok mentési hiba:', e);
      }

      // DEBUG: Nézd meg a timestamp-eket
      console.log('📊 NAPLÓ DEBUG - Összes meccs timestamp:');
      repairedMatches.forEach(m => {
        const date = new Date(m.timestamp);
        console.log(`  ${m.tip.playerA} vs ${m.tip.playerB} | ${date.toISOString()} | ${date.toLocaleDateString('hu-HU')}`);
      });

      // Utolsó 30 nap szűrés
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const recentMatches = repairedMatches.filter(m => m.timestamp >= thirtyDaysAgo);

      console.log(`✅ Összes: ${repairedMatches.length}, Utolsó 30 nap: ${recentMatches.length}`);

      setMatches(recentMatches);
    } catch (e) {
      console.error('Hiba a napló betöltésekor:', e);
      setMatches([]);
    }
  }, []);

  // ✅ EVENT LISTENER - TopTips változások figyelése
  useEffect(() => {
    const handleJournalUpdate = () => {
      console.log('🔄 Napló frissítés...');
      try {
        const stored = localStorage.getItem(BETTING_JOURNAL_KEY);
        if (!stored) {
          setMatches([]);
          return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
          setMatches([]);
          return;
        }

        const validMatches = parsed.filter((item: any) =>
          item &&
          typeof item === 'object' &&
          item.matchId &&
          item.tip &&
          typeof item.tip === 'object'
        );

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentMatches = validMatches.filter((m: any) => m.timestamp >= thirtyDaysAgo);

        // Merge: a lokálisan már szerkesztett entry mezőit (betType, betLine, odds, stake, result)
        // megőrizzük — ne írja felül az event a pending user-editet
        setMatches(prev => {
          const prevMap = new Map(prev.map(m => [m.matchId, m]));
          return recentMatches.map((incoming: any) => {
            const existing = prevMap.get(incoming.matchId);
            if (!existing) return incoming;
            // Lokális szerkesztett mezők prioritása
            return {
              ...incoming,
              betType:  existing.betType  !== undefined ? existing.betType  : incoming.betType,
              betLine:  existing.betLine  !== undefined ? existing.betLine  : incoming.betLine,
              odds:     existing.odds     !== undefined ? existing.odds     : incoming.odds,
              stake:    existing.stake    !== undefined ? existing.stake    : incoming.stake,
              result:   existing.result   !== undefined ? existing.result   : incoming.result,
            };
          });
        });

        console.log('✅ Napló frissítve!', recentMatches.length, 'meccs');
      } catch (e) {
        console.error('Napló frissítési hiba:', e);
      }
    };

    window.addEventListener('journal-updated', handleJournalUpdate);
    return () => window.removeEventListener('journal-updated', handleJournalUpdate);
  }, []);

  // Dátum szerinti csoportosítás
  useEffect(() => {
    const grouped: Record<string, CheckedMatch[]> = {};

    matches.forEach(match => {
      // date mező használata (ha nincs, fallback timestamp-ből)
      const date = match.date || new Date(match.timestamp).toISOString().split('T')[0];
      
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(match);
    });

    const groups: DayGroup[] = Object.keys(grouped)
      .sort((a, b) => b.localeCompare(a)) // Legfrissebb elől (2026-04-17 > 2026-04-16)
      .map(date => ({
        date,
        matches: grouped[date].sort((a, b) => a.timestamp - b.timestamp) // Időrendi sorrend TIMESTAMP szerint!
      }));

    setDayGroups(groups);
  }, [matches]);

  // Napló entry törlése
  const deleteEntry = (matchId: string) => {
    setMatches(prev => {
      const updated = prev.filter(m => m.matchId !== matchId);
      try {
        const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
        const filtered = journal.filter((m: any) => m.matchId !== matchId);
        localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(filtered));
      } catch (e) {
        console.error('Napló törlési hiba:', e);
      }
      return updated;
    });
  };

  // Napló entry frissítése — syncs both journal and Megtett meccsek
  const updateEntry = (matchId: string, field: string, value: any) => {
    setMatches(prev => {
      const updated = prev.map(m => m.matchId === matchId ? { ...m, [field]: value } : m);
      try {
        const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
        const idx = journal.findIndex((m: any) => m.matchId === matchId);
        if (idx !== -1) {
          journal[idx] = { ...journal[idx], [field]: value };
          localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
        }
        // Also sync back to the Megtett meccsek (CHECKED_GREEN_KEY) so TopTips updates
        const GREEN_KEY = 'checked_green_matches';
        const greenRaw = localStorage.getItem(GREEN_KEY);
        if (greenRaw) {
          const green = JSON.parse(greenRaw);
          const gi = green.findIndex((m: any) => m.matchId === matchId);
          if (gi !== -1) {
            green[gi] = { ...green[gi], [field]: value };
            localStorage.setItem(GREEN_KEY, JSON.stringify(green));
            window.dispatchEvent(new Event('checked-matches-updated'));
          }
        }
      } catch (e) {
        console.error('Napló frissítési hiba:', e);
      }
      return updated;
    });
  };

  // ROI számítás
  const calculateROI = () => {
    let totalStake = 0;
    let totalProfit = 0;

    matches.forEach(match => {
      if (!match.result || !match.betType || !match.betLine) return;

      const stake = match.stake || defaultStake;
      totalStake += stake;

      if (match.result === 'Win') {
        // ✅ ÚJ: Előnyben a match.odds mező
        const odds = match.odds || (match.betType === 'Over' 
          ? (match.tip.oddsOver || 2.0) 
          : (match.tip.oddsUnder || 2.0));
        const profit = (odds - 1) * stake;
        totalProfit += profit;
      } else {
        totalProfit -= stake;
      }
    });

    const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0;
    return { totalStake, totalProfit, roi };
  };

  // Statisztikák
  const getStats = () => {
    const completed = matches.filter(m => m.result);
    const wins = completed.filter(m => m.result === 'Win').length;
    const losses = completed.filter(m => m.result === 'Loss').length;
    const winRate = completed.length > 0 ? (wins / completed.length) * 100 : 0;

    const overs = completed.filter(m => m.betType === 'Over').length;
    const unders = completed.filter(m => m.betType === 'Under').length;

    return { total: matches.length, completed: completed.length, wins, losses, winRate, overs, unders };
  };

  // Nap toggle
  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // Napi statisztikák számítása
  const getDayStats = (dayMatches: CheckedMatch[]) => {
    const completed = dayMatches.filter(m => m.result);
    const wins = completed.filter(m => m.result === 'Win').length;
    const losses = completed.filter(m => m.result === 'Loss').length;

    let totalStake = 0;
    let totalProfit = 0;

    completed.forEach(match => {
      const stake = match.stake || defaultStake;
      totalStake += stake;

      if (match.result === 'Win') {
        const odds = match.odds || (match.betType === 'Over'
          ? (match.tip.oddsOver || 2.0)
          : (match.tip.oddsUnder || 2.0));
        totalProfit += (odds - 1) * stake;
      } else {
        totalProfit -= stake;
      }
    });

    return { wins, losses, profit: totalProfit };
  };

  // Excel export
  const exportToExcel = () => {
    const data = matches.map(match => ({
      'Dátum': match.tip.date || new Date(match.timestamp).toLocaleDateString('hu-HU'),
      'Időpont': match.tip.time,
      'Meccs': `${match.tip.playerA} vs ${match.tip.playerB}`,
      'Várható gól': match.tip.vartGol.toFixed(1),
      'O/U vonal': match.tip.ouLine,
      'Fogadás típusa': match.betType || '-',
      'Fogadott vonal': match.betLine || '-',
      'Tét (Ft)': match.stake || defaultStake,
      'Eredmény': match.result || '-',
      'Odds': match.betType === 'Over' 
        ? (match.tip.oddsOver || '-') 
        : match.betType === 'Under' 
          ? (match.tip.oddsUnder || '-') 
          : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Napló');

    const { totalStake, totalProfit, roi } = calculateROI();
    const stats = getStats();

    // Statisztika hozzáadása
    const statsData = [
      { 'Statisztika': 'Összes meccs', 'Érték': stats.total },
      { 'Statisztika': 'Befejezett', 'Érték': stats.completed },
      { 'Statisztika': 'Nyerések', 'Érték': stats.wins },
      { 'Statisztika': 'Vesztések', 'Érték': stats.losses },
      { 'Statisztika': 'Win Rate (%)', 'Érték': stats.winRate.toFixed(1) },
      { 'Statisztika': 'Összes tét (Ft)', 'Érték': totalStake },
      { 'Statisztika': 'Nyereség (Ft)', 'Érték': totalProfit.toFixed(0) },
      { 'Statisztika': 'ROI (%)', 'Érték': roi.toFixed(2) },
    ];

    const statsWs = XLSX.utils.json_to_sheet(statsData);
    XLSX.utils.book_append_sheet(wb, statsWs, 'Statisztika');

    XLSX.writeFile(wb, `Naplo_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const { totalStake, totalProfit, roi } = calculateROI();
  const stats = getStats();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📖 Napló</h1>
          <p className="text-sm text-slate-400 mt-1">Utolsó 30 nap megtett meccsek</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Alapértelmezett tét:</label>
            <input
              type="number"
              value={defaultStake}
              onChange={e => setDefaultStake(parseInt(e.target.value) || DEFAULT_STAKE)}
              className="bg-dark-bg border border-dark-border rounded px-3 py-1.5 text-sm text-white w-32 focus:outline-none focus:border-accent"
            />
            <span className="text-xs text-slate-400">Ft</span>
          </div>
          <button
            onClick={exportToExcel}
            className="bg-green/20 text-green hover:bg-green/30 text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer flex items-center gap-2"
          >
            📊 Excel export
          </button>
        </div>
      </div>

      {/* Statisztika kártyák */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Összes meccs</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
          <p className="text-xs text-slate-500 mt-1">{stats.completed} befejezett</p>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Win Rate</p>
          <p className="text-2xl font-bold text-green">{stats.winRate.toFixed(1)}%</p>
          <p className="text-xs text-slate-500 mt-1">{stats.wins}W / {stats.losses}L</p>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Nyereség</p>
          <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green' : 'text-red'}`}>
            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(0)} Ft
          </p>
          <p className="text-xs text-slate-500 mt-1">Tét: {totalStake.toFixed(0)} Ft</p>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">ROI</p>
          <p className={`text-2xl font-bold ${roi >= 0 ? 'text-green' : 'text-red'}`}>
            {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
          </p>
          <p className="text-xs text-slate-500 mt-1">{stats.overs}O / {stats.unders}U</p>
        </div>
      </div>

      {/* Napló lista */}
      {dayGroups.length === 0 ? (
        <div className="bg-dark-card border border-dark-border rounded-xl p-8 text-center">
          <p className="text-slate-400">Nincs még megtett meccs az utolsó 30 napban</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map(group => {
            const isExpanded = expandedDays.has(group.date);
            const dayStats = getDayStats(group.matches);

            return (
              <div key={group.date} className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
                {/* Nap fejléc - kattintható */}
                <button
                  onClick={() => toggleDay(group.date)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-dark-bg/40 transition cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    {/* Chevron ikon */}
                    <svg 
                      className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor" 
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>

                    {/* Dátum */}
                    <h3 className="text-lg font-bold text-white">
                      📅 {new Date(group.date).toLocaleDateString('hu-HU', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </h3>
                  </div>

                  {/* Napi statisztikák */}
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Meccsek</p>
                      <p className="text-sm font-bold text-white">{group.matches.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Win/Loss</p>
                      <p className="text-sm font-bold text-white">
                        <span className="text-green">{dayStats.wins}W</span> / <span className="text-red">{dayStats.losses}L</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Profit</p>
                      <p className={`text-sm font-bold ${dayStats.profit >= 0 ? 'text-green' : 'text-red'}`}>
                        {dayStats.profit >= 0 ? '+' : ''}{dayStats.profit.toFixed(0)} Ft
                      </p>
                    </div>
                  </div>
                </button>

                {/* Nap tartalma - csak ha ki van bontva */}
                {isExpanded && (
                  <div className="border-t border-dark-border p-5 space-y-3">
                    {group.matches.map((match, idx) => {
                      const stake = match.stake || defaultStake;
                      const odds = match.betType === 'Over' 
                        ? (match.tip.oddsOver || 2.0) 
                        : match.betType === 'Under' 
                          ? (match.tip.oddsUnder || 2.0) 
                          : 2.0;
                      
                      const profit = match.result === 'Win' 
                        ? (odds - 1) * stake 
                        : match.result === 'Loss' 
                          ? -stake 
                          : 0;

                      return (
                        <div
                          key={idx}
                          className="rounded-lg p-3 border"
                          style={
                            match.trendType === 'SUPER_VALUE'
                              ? { backgroundColor: 'rgba(253,224,71,0.10)', borderColor: '#fde047', boxShadow: '0 0 8px rgba(253,224,71,0.25)' }
                            : match.trendType === 'SUPER_TREND'
                              ? { backgroundColor: 'rgba(249,115,22,0.10)', borderColor: '#f97316', boxShadow: '0 0 8px rgba(249,115,22,0.25)' }
                            : match.trendType === 'VALUE'
                              ? { backgroundColor: 'rgba(253,224,71,0.06)', borderColor: '#fde04750' }
                            : match.trendType === 'TREND'
                              ? { backgroundColor: 'rgba(249,115,22,0.06)', borderColor: '#f9731650' }
                            : { backgroundColor: 'rgba(15,23,42,0.4)', borderColor: 'rgba(30,41,59,1)' }
                          }
                        >
                          {/* Sor 1: Meccs info + eredmény + törlés */}
                          <div className="flex items-center gap-2 mb-2">
                            {match.tip.league && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${leagueBadge(match.tip.league)}`}>
                                {leagueAbbr(match.tip.league)}
                              </span>
                            )}
                            {match.strategy === 'A' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-emerald-600 text-white">A</span>
                            )}
                            {match.strategy === 'B' && (
                              <span style={{backgroundColor:'#facc15',color:'#111827'}} className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0">B</span>
                            )}
                            {match.strategy === 'C' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-orange-500 text-white">C</span>
                            )}
                            {match.fromTrend && match.trendType === 'SUPER_VALUE' && (
                              <span style={{backgroundColor:'#fde047',color:'#111827',boxShadow:'0 0 6px rgba(253,224,71,0.6)'}} className="px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 animate-pulse">
                                💥 SUPER VALUE
                              </span>
                            )}
                            {match.fromTrend && match.trendType === 'SUPER_TREND' && (
                              <span style={{backgroundColor:'#f97316',color:'#fff',boxShadow:'0 0 6px rgba(249,115,22,0.6)'}} className="px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 animate-pulse">
                                🔥 SUPER TREND
                              </span>
                            )}
                            {match.fromTrend && match.trendType === 'VALUE' && (
                              <span style={{backgroundColor:'#facc15',color:'#111827'}} className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0">
                                💰 VALUE
                              </span>
                            )}
                            {match.fromTrend && match.trendType === 'TREND' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-orange-500 text-white">
                                🚀 TREND
                              </span>
                            )}
                            <span className="text-sm font-mono text-white w-14 shrink-0">{match.tip.time}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-semibold">
                                {match.tip.playerA} vs {match.tip.playerB}
                              </p>
                              {match.fromTrend ? (
                                <div className="flex items-center gap-2 mt-1 overflow-x-auto scrollbar-none">
                                  <span className="text-xs text-slate-400 shrink-0">O/U <span className="text-white font-bold">{match.betLine ?? match.tip.ouLine}</span></span>
                                  {match.trendAboveLineCount !== undefined && match.trendTotalMatches !== undefined && (
                                    <span className="text-xs text-slate-400 shrink-0">Felett: <span className="text-yellow-300 font-bold">{match.trendAboveLineCount}/{match.trendTotalMatches} ({Math.round((match.trendAboveLinePct ?? 0) * 100)}%)</span></span>
                                  )}
                                  {match.trendAvgGoals !== undefined && (
                                    <span className="text-xs text-slate-400 shrink-0">Átlag: <span className="text-white font-bold">{match.trendAvgGoals.toFixed(1)}</span></span>
                                  )}
                                  {match.trendType === 'TREND' && match.trendSlope !== undefined && (
                                    <span className="text-xs text-slate-400 shrink-0">Trend: <span className="text-orange-400 font-bold">{match.trendSlope >= 0 ? '+' : ''}{match.trendSlope.toFixed(1)}/m</span></span>
                                  )}
                                  {match.trendTodayH2H && match.trendTodayH2H.length > 0 && match.trendTodayH2H.map((h, hi) => (
                                    <span key={hi} className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${h.total > (match.betLine ?? match.tip.ouLine) ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                                      {h.goalsA}–{h.goalsB}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 mt-1 overflow-x-auto scrollbar-none">
                                  <span className="text-xs text-slate-400 shrink-0">GÓL <span className="text-white font-bold">{match.tip.vartGol.toFixed(1)}</span></span>
                                  <span className="text-xs text-slate-400 shrink-0">O/U <span className="text-white font-bold">{match.tip.ouLine}</span></span>
                                  {match.tip.lastMatchesA && match.tip.lastMatchesA.length > 0 && (
                                    <>
                                      <span className="text-xs text-slate-500 shrink-0 ml-1">{match.tip.playerA.split(' ')[0]}:</span>
                                      {match.tip.lastMatchesA.slice(0, 5).map((lm, li) => (
                                        <span key={li} className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${lm.result === 'win' ? 'bg-green-600 text-white' : lm.result === 'loss' ? 'bg-red-600 text-white' : 'bg-slate-600 text-white'}`}>
                                          {lm.scoreHome}–{lm.scoreAway}
                                        </span>
                                      ))}
                                    </>
                                  )}
                                  {match.tip.lastMatchesB && match.tip.lastMatchesB.length > 0 && (
                                    <>
                                      <span className="text-xs text-slate-500 shrink-0 ml-1">{match.tip.playerB.split(' ')[0]}:</span>
                                      {match.tip.lastMatchesB.slice(0, 5).map((lm, li) => (
                                        <span key={li} className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${lm.result === 'win' ? 'bg-green-600 text-white' : lm.result === 'loss' ? 'bg-red-600 text-white' : 'bg-slate-600 text-white'}`}>
                                          {lm.scoreHome}–{lm.scoreAway}
                                        </span>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              {match.result ? (
                                <div>
                                  <p className={`text-sm font-bold ${match.result === 'Win' ? 'text-green' : 'text-red'}`}>
                                    {match.result === 'Win' ? '✅ Win' : '❌ Loss'}
                                  </p>
                                  <p className={`text-xs ${profit >= 0 ? 'text-green' : 'text-red'}`}>
                                    {profit >= 0 ? '+' : ''}{profit.toFixed(0)} Ft
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500 italic">Folyamatban</p>
                              )}
                            </div>
                            <button
                              onClick={() => deleteEntry(match.matchId)}
                              className="text-slate-600 hover:text-red text-sm ml-2 shrink-0 cursor-pointer transition-colors"
                              title="Törlés a naplóból"
                            >
                              ✕
                            </button>
                          </div>

                          {/* Sor 2: Szerkeszthető mezők */}
                          <div className="grid grid-cols-5 gap-2">
                            <select
                              value={match.betType || ''}
                              onChange={e => updateEntry(match.matchId, 'betType', e.target.value || undefined)}
                              className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                            >
                              <option value="">O/U</option>
                              <option value="Over">Over</option>
                              <option value="Under">Under</option>
                            </select>

                            <select
                              value={match.betLine || ''}
                              onChange={e => updateEntry(match.matchId, 'betLine', e.target.value ? parseFloat(e.target.value) : undefined)}
                              className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                            >
                              <option value="">Vonal</option>
                              {[1.25,1.5,1.75,2.25,2.5,2.75,3.25,3.5,3.75,4.25,4.5,4.75,5.25,5.5,5.75,6.25,6.5,6.75,7.25,7.5,7.75,8.25,8.5,8.75,9.25,9.5,9.75,10.25,10.5,10.75,11.25,11.5,11.75].map(v => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>

                            <input
                              type="number"
                              step="0.01"
                              min="1.01"
                              max="50"
                              placeholder="Odds"
                              value={match.odds || ''}
                              onChange={e => updateEntry(match.matchId, 'odds', e.target.value ? parseFloat(e.target.value) : undefined)}
                              className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
                            />

                            <input
                              type="number"
                              step="100"
                              min="100"
                              placeholder="Tét (Ft)"
                              value={match.stake || ''}
                              onChange={e => updateEntry(match.matchId, 'stake', e.target.value ? parseInt(e.target.value) : undefined)}
                              className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
                            />

                            <select
                              value={match.result || ''}
                              onChange={e => updateEntry(match.matchId, 'result', e.target.value || undefined)}
                              className={`bg-dark-bg border rounded px-2 py-1 text-xs font-semibold focus:outline-none focus:border-accent ${
                                match.result === 'Win' ? 'border-green text-green' :
                                match.result === 'Loss' ? 'border-red text-red' :
                                'border-dark-border text-white'
                              }`}
                            >
                              <option value="">Eredmény</option>
                              <option value="Win">Win</option>
                              <option value="Loss">Loss</option>
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}