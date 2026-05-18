import { useEffect, useState } from 'react';
import { fetchH2HDetail, H2HDetail } from '../api';

interface Props {
  playerA: string;
  playerB: string;
  league: string;
  onClose: () => void;
}

function leagueToEsoccerBet(league: string): string {
  // Frontend uses 'GT Leagues' | 'eAdriaticLeague' | 'Other' or TopTips league string
  if (league === 'GT Leagues') return 'GT Leagues';
  if (league === 'Esoccer Battle') return 'Esoccer Battle';
  if (league === 'eAdriatic League' || league === 'eAdriaticLeague') return 'eAdriatic League';
  return 'GT Leagues';
}

export default function H2HModal({ playerA, playerB, league, onClose }: Props) {
  const [data, setData] = useState<H2HDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchH2HDetail(playerA, playerB, leagueToEsoccerBet(league));
        if (active) setData(result);
      } catch {
        if (active) setError('Nem sikerült betölteni a H2H adatokat.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [playerA, playerB, league]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="bg-dark-card rounded-xl border border-dark-border max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
          <div>
            <h2 className="text-lg font-semibold text-white capitalize">{playerA} vs {playerB}</h2>
            <p className="text-xs text-slate-500 mt-0.5">H2H részletes elemzés</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <p className="text-sm text-slate-500 text-center py-8">Betöltés...</p>}
          {error && <p className="text-sm text-red text-center py-8">{error}</p>}

          {data && (
            <>
              {/* Aggregate */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">Meccsek</p>
                  <p className="text-xl font-bold text-white">{data.total}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">{playerA}</p>
                  <p className="text-xl font-bold text-green">{data.winsA}W</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">Döntetlen</p>
                  <p className="text-xl font-bold text-yellow">{data.draws}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">{playerB}</p>
                  <p className="text-xl font-bold text-purple">{data.winsB}W</p>
                </div>
              </div>

              {/* Goal avg */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">Átl. gól {playerA}</p>
                  <p className="text-lg font-bold text-accent-light">{data.avgGoalsA.toFixed(2)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">Átl. gól {playerB}</p>
                  <p className="text-lg font-bold text-purple">{data.avgGoalsB.toFixed(2)}</p>
                </div>
                <div className="bg-dark-bg rounded-lg p-3 text-center">
                  <p className="text-[10px] text-slate-500">Átl. összes gól</p>
                  <p className="text-lg font-bold text-yellow">{data.avgTotalGoals.toFixed(2)}</p>
                </div>
              </div>

              {/* Match list */}
              <h3 className="text-xs font-semibold text-slate-400 mb-2 uppercase">Meccs részletek</h3>
              <div className="space-y-1">
                {data.matches.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">Nincs egymás elleni meccs az adatokban.</p>
                ) : (
                  data.matches.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 px-3 bg-dark-bg rounded-lg">
                      <span className="text-[10px] text-slate-500 w-16 shrink-0">{m.date}</span>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <span className={`text-xs capitalize truncate ${m.winner === 'A' ? 'text-green font-semibold' : 'text-slate-400'}`}>
                          {m.playerA}
                        </span>
                        <span className="text-[10px] text-slate-600 capitalize">{m.teamA}</span>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${
                        m.winner === 'A' ? 'text-green' : m.winner === 'B' ? 'text-red' : 'text-yellow'
                      }`}>
                        {m.scoreA}-{m.scoreB}
                      </span>
                      <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
                        <span className="text-[10px] text-slate-600 capitalize">{m.teamB}</span>
                        <span className={`text-xs capitalize truncate ${m.winner === 'B' ? 'text-green font-semibold' : 'text-slate-400'}`}>
                          {m.playerB}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
