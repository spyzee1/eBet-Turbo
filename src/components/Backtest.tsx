import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { runBacktest, runOptimize, BacktestResult, OptimizeResponse } from '../api';

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

export default function Backtest() {
  const [playerName, setPlayerName] = useState('');
  const [league, setLeague] = useState('GT Leagues');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [optimization, setOptimization] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [optLoading, setOptLoading] = useState(false);
  const [error, setError] = useState('');

  const ic = "bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition";

  const handleBacktest = async () => {
    if (!playerName.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setOptimization(null);
    try {
      const r = await runBacktest(playerName.trim(), league);
      setResult(r);
    } catch {
      setError('Nem sikerült futtatni a backtest-et. Ellenőrizd a játékos nevét.');
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    if (!playerName.trim()) return;
    setOptLoading(true);
    try {
      const r = await runOptimize(playerName.trim(), league);
      setOptimization(r);
    } catch {
      setError('Nem sikerült optimalizálni.');
    } finally {
      setOptLoading(false);
    }
  };

  // Build cumulative profit chart data
  const profitData = result ? (() => {
    let cumulative = 0;
    return result.details
      .filter(d => d.won !== null)
      .map((d, i) => {
        cumulative += d.profit;
        return {
          idx: i + 1,
          profit: Math.round(cumulative),
          won: d.won,
        };
      });
  })() : [];

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleBacktest()}
            placeholder="Játékos neve (pl. hawk, sarafi, walnut)"
            className={`flex-1 min-w-[200px] ${ic}`}
          />
          <select value={league} onChange={e => setLeague(e.target.value)} className={ic}>
            <option value="GT Leagues">GT Leagues</option>
            <option value="Esoccer Battle">Esoccer Battle</option>
            <option value="eAdriatic League">eAdriatic League</option>
          </select>
          <button
            onClick={handleBacktest}
            disabled={loading || !playerName.trim()}
            className="bg-accent/20 text-accent-light hover:bg-accent/30 text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Futtatás...' : 'Backtest'}
          </button>
          {result && (
            <button
              onClick={handleOptimize}
              disabled={optLoading}
              className="bg-purple/20 text-purple hover:bg-purple/30 text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {optLoading ? 'Optimalizálás...' : 'Súly optimalizálás'}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red mt-2">{error}</p>}
        <p className="text-[10px] text-slate-600 mt-3">
          ⚠️ A backtest a játékos utolsó 20 meccsét használja, JELENLEGI statisztikákkal (lookahead bias). Az eredmény közelítő, nem perfekt validáció.
        </p>
      </div>

      {!result && !loading && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-12 text-center">
          <h3 className="text-lg font-medium text-slate-400 mb-2">Backtest indítása</h3>
          <p className="text-sm text-slate-600">Adj meg egy játékost és nyomj Entert vagy kattints a Backtest gombra.</p>
        </div>
      )}

      {result && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-dark-card rounded-xl border border-dark-border p-4">
              <p className="text-[10px] text-slate-500">Meccsek</p>
              <p className="text-xl font-bold text-white">{result.totalMatches}</p>
              <p className="text-[10px] text-slate-600 mt-1">{result.passes} PASS</p>
            </div>
            <div className="bg-dark-card rounded-xl border border-dark-border p-4">
              <p className="text-[10px] text-slate-500">Tippek</p>
              <p className="text-xl font-bold text-accent-light">{result.totalBets}</p>
              <p className="text-[10px] text-slate-600 mt-1">{result.wins}W / {result.losses}L</p>
            </div>
            <div className="bg-dark-card rounded-xl border border-dark-border p-4">
              <p className="text-[10px] text-slate-500">Találati arány</p>
              <p className={`text-xl font-bold ${result.hitRate >= 0.55 ? 'text-green' : result.hitRate >= 0.45 ? 'text-yellow' : 'text-red'}`}>
                {pct(result.hitRate)}
              </p>
            </div>
            <div className="bg-dark-card rounded-xl border border-dark-border p-4">
              <p className="text-[10px] text-slate-500">ROI</p>
              <p className={`text-xl font-bold ${result.roi >= 0.05 ? 'text-green' : result.roi >= 0 ? 'text-yellow' : 'text-red'}`}>
                {result.roi >= 0 ? '+' : ''}{pct(result.roi)}
              </p>
            </div>
            <div className="bg-dark-card rounded-xl border border-dark-border p-4">
              <p className="text-[10px] text-slate-500">Profit</p>
              <p className={`text-xl font-bold ${result.totalProfit >= 0 ? 'text-green' : 'text-red'}`}>
                {result.totalProfit >= 0 ? '+' : ''}{Math.round(result.totalProfit)} Ft
              </p>
              <p className="text-[10px] text-slate-600 mt-1">{result.totalStaked} Ft tét</p>
            </div>
          </div>

          {/* Profit curve */}
          {profitData.length >= 2 && (
            <div className="bg-dark-card rounded-xl border border-dark-border p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Profit görbe</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={profitData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
                  <XAxis dataKey="idx" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2e45', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="profit" radius={[2, 2, 0, 0]}>
                    {profitData.map((d, i) => (
                      <Cell key={i} fill={d.profit >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Market + Confidence breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-dark-card rounded-xl border border-dark-border p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Piac szerinti bontás</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-dark-border/50">
                  <span className="text-sm text-slate-400">Win (1X2)</span>
                  <span className="text-xs text-slate-500">{result.byMarket.win.wins}/{result.byMarket.win.bets}</span>
                  <span className={`text-sm font-bold ${result.byMarket.win.hitRate >= 0.55 ? 'text-green' : 'text-yellow'}`}>
                    {pct(result.byMarket.win.hitRate)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-400">Over/Under</span>
                  <span className="text-xs text-slate-500">{result.byMarket.overUnder.wins}/{result.byMarket.overUnder.bets}</span>
                  <span className={`text-sm font-bold ${result.byMarket.overUnder.hitRate >= 0.55 ? 'text-green' : 'text-yellow'}`}>
                    {pct(result.byMarket.overUnder.hitRate)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-dark-card rounded-xl border border-dark-border p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Confidence szerinti bontás</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-dark-border/50">
                  <span className="text-sm text-slate-400">Magas (≥75%)</span>
                  <span className="text-xs text-slate-500">{result.byConfidence.high.wins}/{result.byConfidence.high.bets}</span>
                  <span className={`text-sm font-bold ${result.byConfidence.high.hitRate >= 0.65 ? 'text-green' : 'text-yellow'}`}>
                    {pct(result.byConfidence.high.hitRate)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-dark-border/50">
                  <span className="text-sm text-slate-400">Közepes (60-75%)</span>
                  <span className="text-xs text-slate-500">{result.byConfidence.medium.wins}/{result.byConfidence.medium.bets}</span>
                  <span className={`text-sm font-bold ${result.byConfidence.medium.hitRate >= 0.55 ? 'text-green' : 'text-yellow'}`}>
                    {pct(result.byConfidence.medium.hitRate)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-400">Alacsony (&lt;60%)</span>
                  <span className="text-xs text-slate-500">{result.byConfidence.low.wins}/{result.byConfidence.low.bets}</span>
                  <span className={`text-sm font-bold ${result.byConfidence.low.hitRate >= 0.5 ? 'text-yellow' : 'text-red'}`}>
                    {pct(result.byConfidence.low.hitRate)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Optimization results */}
          {optimization && (
            <div className="bg-dark-card rounded-xl border border-dark-border p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Súly optimalizálás (Grid Search)</h3>
              <p className="text-xs text-slate-500 mb-3">
                {optimization.totalCombinations} kombináció tesztelve. Top 20 ROI szerint:
              </p>

              {optimization.best && (
                <div className="bg-green/10 border border-green/30 rounded-lg p-3 mb-3">
                  <p className="text-xs text-green font-semibold mb-1">Legjobb kombináció</p>
                  <div className="grid grid-cols-3 lg:grid-cols-7 gap-2 text-xs">
                    <div><span className="text-slate-500">WR:</span> <span className="text-white font-semibold">{optimization.best.settings.wr}</span></div>
                    <div><span className="text-slate-500">Forma:</span> <span className="text-white font-semibold">{optimization.best.settings.forma}</span></div>
                    <div><span className="text-slate-500">H2H:</span> <span className="text-white font-semibold">{optimization.best.settings.h2h}</span></div>
                    <div><span className="text-slate-500">Atk:</span> <span className="text-white font-semibold">{optimization.best.settings.atk}</span></div>
                    <div><span className="text-slate-500">Def:</span> <span className="text-white font-semibold">{optimization.best.settings.def}</span></div>
                    <div><span className="text-slate-500">ROI:</span> <span className="text-green font-bold">+{pct(optimization.best.roi)}</span></div>
                    <div><span className="text-slate-500">Hit:</span> <span className="text-white font-semibold">{pct(optimization.best.hitRate)}</span></div>
                  </div>
                </div>
              )}

              <div className="space-y-1 max-h-80 overflow-y-auto">
                {optimization.top20.slice(0, 20).map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 bg-dark-bg/50 rounded text-xs">
                    <span className="text-slate-500 w-6">#{i + 1}</span>
                    <span className="flex-1 text-slate-400 font-mono">
                      WR{entry.settings.wr} F{entry.settings.forma} H{entry.settings.h2h} A{entry.settings.atk} D{entry.settings.def}
                    </span>
                    <span className={`font-bold w-16 text-right ${entry.roi >= 0 ? 'text-green' : 'text-red'}`}>
                      {entry.roi >= 0 ? '+' : ''}{pct(entry.roi)}
                    </span>
                    <span className="text-slate-500 w-12 text-right">{pct(entry.hitRate)}</span>
                    <span className="text-slate-600 w-10 text-right">{entry.bets}b</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match details */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-3 sm:p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Meccs részletek (utolsó 20)</h3>
            <div className="space-y-1">
              {result.details.slice(0, 20).map((d, i) => (
                <div key={i} className="flex items-center gap-1 sm:gap-2 py-1.5 px-2 bg-dark-bg/50 rounded text-[10px] sm:text-xs">
                  <span className="text-slate-500 w-12 sm:w-16 shrink-0 truncate">{d.date}</span>
                  <span className="text-slate-400 capitalize flex-1 truncate">{d.playerA} vs {d.playerB}</span>
                  <span className={`font-bold shrink-0 ${d.scoreA > d.scoreB ? 'text-green' : d.scoreA < d.scoreB ? 'text-red' : 'text-yellow'}`}>
                    {d.scoreA}-{d.scoreB}
                  </span>
                  <span className="hidden sm:inline text-slate-500 w-20 text-center shrink-0 truncate">{d.valueBet}</span>
                  <span className={`shrink-0 w-8 sm:w-12 text-right font-semibold ${
                    d.won === true ? 'text-green' : d.won === false ? 'text-red' : 'text-slate-600'
                  }`}>
                    {d.won === true ? 'W' : d.won === false ? 'L' : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
