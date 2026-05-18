import { useState, useEffect, useCallback } from 'react';
import { fetchSchedule, lookupPlayers, ScheduleEntry } from '../api';
import { Liga, MatchInput } from '../model/types';

interface Props {
  onAnalyze: (m: MatchInput) => void;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function leagueToLiga(league: string): Liga {
  if (league === 'GT Leagues') return 'GT Leagues';
  if (league === 'eAdriatic League') return 'eAdriaticLeague';
  return 'Other';
}

function leagueMinutes(league: string): number {
  if (league === 'GT Leagues') return 12;
  if (league === 'eAdriatic League') return 10;
  if (league === 'Esoccer Battle') return 8;
  if (league === 'Esports Volta') return 6;
  return 10;
}

export default function Upcoming({ onAnalyze }: Props) {
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSchedule(filter === 'all' ? undefined : filter);
      setSchedule(data);
    } catch {
      setError('Nem sikerült betölteni. Ellenőrizd, hogy fut-e a szerver (port 3001).');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleAnalyze = async (entry: ScheduleEntry) => {
    const key = `${entry.playerHome}-${entry.playerAway}-${entry.time}`;
    setAnalyzing(key);
    try {
      const data = await lookupPlayers(entry.playerHome, entry.playerAway, entry.league);
      const liga = leagueToLiga(entry.league);
      const match: MatchInput = {
        id: genId(),
        liga,
        percek: leagueMinutes(entry.league),
        matchTime: entry.time,
        matchDate: entry.date,
        piacTipus: liga === 'GT Leagues' ? 'Over/Under' : 'Win',
        playerA: entry.playerHome,
        playerB: entry.playerAway,
        oddsA: 1.85,
        oddsB: 1.95,
        gfA: Math.round(data.playerA.gf * 100) / 100,
        gaA: Math.round(data.playerA.ga * 100) / 100,
        gfB: Math.round(data.playerB.gf * 100) / 100,
        gaB: Math.round(data.playerB.ga * 100) / 100,
        winRateA: Math.round(data.playerA.winRate * 100) / 100,
        winRateB: Math.round(data.playerB.winRate * 100) / 100,
        formaA: Math.round(data.playerA.forma * 100) / 100,
        formaB: Math.round(data.playerB.forma * 100) / 100,
        h2hA: data.h2h ? Math.round(data.h2h.h2hRatioA * 100) / 100 : 0.5,
        h2hB: data.h2h ? Math.round(data.h2h.h2hRatioB * 100) / 100 : 0.5,
        ouLine: 3.5,
        oddsOver: 1.85,
        oddsUnder: 1.95,
      };
      onAnalyze(match);
    } catch {
      setError(`Nem sikerült lekérni: ${entry.playerHome} vs ${entry.playerAway}`);
    } finally {
      setAnalyzing(null);
    }
  };

  const leagues = ['all', 'GT Leagues', 'Esoccer Battle', 'eAdriatic League', 'Esports Volta'];
  const leagueLabels: Record<string, string> = {
    all: 'Összes',
    'GT Leagues': 'GT Leagues (12p)',
    'Esoccer Battle': 'Esoccer Battle (8p)',
    'eAdriatic League': 'eAdriatic League (10p)',
    'Esports Volta': 'Esports Volta (6p)',
  };

  const leagueBadge = (l: string) => {
    if (l === 'GT Leagues') return 'bg-green/20 text-green';
    if (l === 'Esoccer Battle') return 'bg-yellow/20 text-yellow';
    if (l === 'eAdriatic League') return 'bg-sky-500/20 text-sky-400';
    return 'bg-slate-600/30 text-slate-400';
  };

  return (
    <div className="space-y-6">
      {/* Filter + Refresh */}
      <div className="flex items-center gap-3 flex-wrap">
        {leagues.map(l => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer transition ${
              filter === l ? 'bg-accent/20 text-accent-light' : 'bg-dark-card text-slate-400 hover:text-white'
            }`}
          >
            {leagueLabels[l]}
          </button>
        ))}
        <button onClick={load} disabled={loading} className="ml-auto text-xs text-accent hover:text-accent-light cursor-pointer disabled:opacity-50">
          {loading ? 'Frissítés...' : 'Frissítés'}
        </button>
      </div>

      {error && <p className="text-xs text-yellow bg-yellow/10 rounded-lg px-4 py-2">{error}</p>}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-500">Összes meccs</p>
          <p className="text-xl font-bold text-white">{schedule.length}</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-500">GT Leagues</p>
          <p className="text-xl font-bold text-green">{schedule.filter(s => s.league === 'GT Leagues').length}</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-500">Esoccer Battle</p>
          <p className="text-xl font-bold text-yellow">{schedule.filter(s => s.league === 'Esoccer Battle').length}</p>
        </div>
      </div>

      {/* Match list */}
      {schedule.length === 0 && !loading ? (
        <div className="bg-dark-card rounded-xl border border-dark-border p-12 text-center">
          <h3 className="text-lg font-medium text-slate-400 mb-2">Nincs közelgő meccs</h3>
          <p className="text-sm text-slate-600">Próbáld újra később, vagy ellenőrizd a szerver kapcsolatot.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedule.map((entry, idx) => {
            const key = `${entry.playerHome}-${entry.playerAway}-${entry.time}`;
            const isAnalyzing = analyzing === key;
            return (
              <div key={idx} className="bg-dark-card rounded-lg border border-dark-border px-5 py-3 flex items-center gap-4 hover:border-slate-600 transition">
                {/* Time */}
                <div className="text-center shrink-0 w-14">
                  <p className="text-sm font-bold text-white">{entry.time}</p>
                  <p className="text-[10px] text-slate-600">{entry.date}</p>
                </div>

                {/* League badge */}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${leagueBadge(entry.league)}`}>
                  {entry.league === 'GT Leagues' ? 'GT' : entry.league === 'Esoccer Battle' ? 'EB' : entry.league === 'eAdriatic League' ? 'ADR' : 'EV'}
                </span>

                {/* Players */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">{entry.playerHome}</span>
                    <span className="text-[10px] text-slate-600">{entry.teamHome}</span>
                    <span className="text-xs text-slate-600 font-bold mx-1">vs</span>
                    <span className="text-sm text-white font-medium">{entry.playerAway}</span>
                    <span className="text-[10px] text-slate-600">{entry.teamAway}</span>
                  </div>
                </div>

                {/* Analyze button */}
                <button
                  onClick={() => handleAnalyze(entry)}
                  disabled={isAnalyzing}
                  className="bg-accent/20 text-accent-light hover:bg-accent/30 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {isAnalyzing ? 'Elemzés...' : 'Elemzés'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
