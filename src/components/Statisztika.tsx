import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ── Types ────────────────────────────────────────────────────────────────────

interface BetEntry {
  matchId: string;
  tip: {
    playerA?: string;
    playerB?: string;
    playerHome?: string;
    playerAway?: string;
    league: string;
    time: string;
    ouLine: number;
    vartGol: number;
    oddsOver?: number;
    oddsUnder?: number;
  };
  timestamp: number;
  date: string;
  betType?: 'Over' | 'Under';
  betLine?: number;
  result?: 'Win' | 'Loss';
  stake?: number;
  odds?: number;
  fromTrend?: boolean;
  trendType?: 'VALUE' | 'TREND';
}

interface Resolved extends BetEntry {
  profit: number;
  stakeUsed: number;
}

// ── Palette ──────────────────────────────────────────────────────────────────

const C_GREEN  = '#10b981';
const C_RED    = '#ef4444';
const C_ACCENT = '#6366f1';
const C_YELLOW = '#f59e0b';
const C_SLATE  = '#64748b';
const C_ORANGE = '#f97316';

const LEAGUE_COLORS: Record<string, string> = {
  'GT Leagues':             C_GREEN,
  'Esoccer Battle':         C_YELLOW,
  'eAdriatic League':       '#38bdf8',
  'Esoccer H2H GG League':  C_ORANGE,
  'Esports Volta':          '#06b6d4',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number) { return `${n.toFixed(1)}%`; }
function ft(n: number)  { return `${n >= 0 ? '+' : ''}${n.toLocaleString('hu-HU')} Ft`; }

function calcProfit(m: BetEntry): number {
  const stake = m.stake ?? 1000;
  const odds  = m.odds  ?? 1.9;
  return m.result === 'Win' ? Math.round(stake * (odds - 1)) : -stake;
}

const TOOLTIP_STYLE = {
  backgroundColor: '#1a1d2e',
  border: '1px solid #2a2e45',
  borderRadius: 8,
  fontSize: 11,
  color: '#e2e8f0',
};
const TOOLTIP_LABEL_STYLE = { color: '#94a3b8', marginBottom: 4 };
const TOOLTIP_ITEM_STYLE  = { color: '#e2e8f0' };

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs shadow-lg">
      <p style={TOOLTIP_LABEL_STYLE}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? p.fill ?? '#e2e8f0' }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Statisztika() {
  const [all, setAll] = useState<BetEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('betting_journal');
      if (raw) setAll(JSON.parse(raw) as BetEntry[]);
    } catch { /* ignore */ }
  }, []);

  // Only resolved bets
  const resolved = useMemo<Resolved[]>(() =>
    all
      .filter(m => m.result === 'Win' || m.result === 'Loss')
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(m => ({ ...m, stakeUsed: m.stake ?? 1000, profit: calcProfit(m) })),
    [all],
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  const wins        = resolved.filter(m => m.result === 'Win').length;
  const losses      = resolved.filter(m => m.result === 'Loss').length;
  const totalBets   = resolved.length;
  const totalStake  = resolved.reduce((s, m) => s + m.stakeUsed, 0);
  const totalProfit = resolved.reduce((s, m) => s + m.profit, 0);
  const winRate     = totalBets ? (wins / totalBets) * 100 : 0;
  const roi         = totalStake ? (totalProfit / totalStake) * 100 : 0;

  // ── Cumulative profit ──────────────────────────────────────────────────────
  const cumulativeData = useMemo(() => {
    let cum = 0;
    return resolved.map((m, i) => {
      cum += m.profit;
      return { idx: i + 1, label: m.date.slice(5), profit: cum };
    });
  }, [resolved]);

  // ── Daily P&L ──────────────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = new Map<string, { profit: number; bets: number; wins: number }>();
    for (const m of resolved) {
      const d = m.date;
      const cur = map.get(d) ?? { profit: 0, bets: 0, wins: 0 };
      map.set(d, {
        profit: cur.profit + m.profit,
        bets:   cur.bets + 1,
        wins:   cur.wins + (m.result === 'Win' ? 1 : 0),
      });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  }, [resolved]);

  // ── Hourly win rate ────────────────────────────────────────────────────────
  const hourlyData = useMemo(() => {
    const map = new Map<number, { wins: number; total: number; profit: number }>();
    for (const m of resolved) {
      const h = parseInt(m.tip.time?.split(':')[0] ?? '0');
      const cur = map.get(h) ?? { wins: 0, total: 0, profit: 0 };
      map.set(h, { wins: cur.wins + (m.result === 'Win' ? 1 : 0), total: cur.total + 1, profit: cur.profit + m.profit });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([h, v]) => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        winPct: Math.round((v.wins / v.total) * 100),
        bets: v.total,
        profit: v.profit,
      }));
  }, [resolved]);

  // ── Player breakdown ───────────────────────────────────────────────────────
  const playerData = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; profit: number }>();
    for (const m of resolved) {
      for (const name of [m.tip.playerA ?? m.tip.playerHome, m.tip.playerB ?? m.tip.playerAway]) {
        if (!name) continue;
        const cur = map.get(name) ?? { wins: 0, losses: 0, profit: 0 };
        // Only attribute P&L to the relevant side? Here we split evenly per match.
        map.set(name, {
          wins:   cur.wins   + (m.result === 'Win'  ? 1 : 0),
          losses: cur.losses + (m.result === 'Loss' ? 1 : 0),
          profit: cur.profit + m.profit / 2,
        });
      }
    }
    return Array.from(map.entries())
      .map(([player, v]) => ({ player, ...v, total: v.wins + v.losses, winPct: Math.round((v.wins / (v.wins + v.losses)) * 100) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [resolved]);

  // ── League breakdown ───────────────────────────────────────────────────────
  const leagueData = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; profit: number }>();
    for (const m of resolved) {
      const lg = m.tip.league ?? 'Ismeretlen';
      const cur = map.get(lg) ?? { wins: 0, losses: 0, profit: 0 };
      map.set(lg, { wins: cur.wins + (m.result === 'Win' ? 1 : 0), losses: cur.losses + (m.result === 'Loss' ? 1 : 0), profit: cur.profit + m.profit });
    }
    return Array.from(map.entries())
      .map(([league, v]) => ({ league, ...v, total: v.wins + v.losses }));
  }, [resolved]);

  // ── Over / Under breakdown ─────────────────────────────────────────────────
  const betTypeData = useMemo(() => {
    const ov = resolved.filter(m => m.betType === 'Over');
    const un = resolved.filter(m => m.betType === 'Under');
    return [
      { name: 'Over',  bets: ov.length, wins: ov.filter(m => m.result === 'Win').length, profit: ov.reduce((s, m) => s + m.profit, 0) },
      { name: 'Under', bets: un.length, wins: un.filter(m => m.result === 'Win').length, profit: un.reduce((s, m) => s + m.profit, 0) },
    ].filter(d => d.bets > 0);
  }, [resolved]);

  // ── Streak ─────────────────────────────────────────────────────────────────
  const { currentStreak, bestStreak } = useMemo(() => {
    let cur = 0; let best = 0; let curType = '';
    for (const m of resolved) {
      if (m.result === curType) { cur++; } else { curType = m.result!; cur = 1; }
      if (curType === 'Win' && cur > best) best = cur;
    }
    return { currentStreak: cur, bestStreak: best };
  }, [resolved]);

  // ── Intraday Trend breakdown ───────────────────────────────────────────────
  const trendStats = useMemo(() => {
    const calc = (entries: Resolved[]) => {
      const w = entries.filter(m => m.result === 'Win').length;
      const l = entries.filter(m => m.result === 'Loss').length;
      const stake = entries.reduce((s, m) => s + m.stakeUsed, 0);
      const profit = entries.reduce((s, m) => s + m.profit, 0);
      return { bets: entries.length, wins: w, losses: l, winRate: entries.length ? (w / entries.length) * 100 : 0, roi: stake ? (profit / stake) * 100 : 0, profit, stake };
    };
    const trendAll  = resolved.filter(m => m.fromTrend);
    const trendVALUE = resolved.filter(m => m.fromTrend && m.trendType === 'VALUE');
    const trendTREND = resolved.filter(m => m.fromTrend && m.trendType === 'TREND');
    return { all: calc(trendAll), value: calc(trendVALUE), trend: calc(trendTREND) };
  }, [resolved]);

  const trendCompareData = useMemo(() => [
    { name: 'VALUE 💰', bets: trendStats.value.bets, wins: trendStats.value.wins, losses: trendStats.value.losses, winPct: Math.round(trendStats.value.winRate), profit: trendStats.value.profit },
    { name: 'TREND 🚀', bets: trendStats.trend.bets, wins: trendStats.trend.wins, losses: trendStats.trend.losses, winPct: Math.round(trendStats.trend.winRate), profit: trendStats.trend.profit },
  ].filter(d => d.bets > 0), [trendStats]);

  // ── Pending bets ───────────────────────────────────────────────────────────
  const pending = all.filter(m => !m.result);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (totalBets === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500">
        <span className="text-5xl mb-4">📊</span>
        <p className="text-lg font-semibold text-slate-400">Nincs elég adat</p>
        <p className="text-sm mt-1">Adj meg eredményeket a Fogadási Napló oldalon</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-10">

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Összes fogadás', value: totalBets, sub: `${pending.length} függőben`, color: C_ACCENT },
          { label: 'Win ráta',       value: pct(winRate), sub: `${wins}W / ${losses}L`, color: winRate >= 55 ? C_GREEN : winRate >= 45 ? C_YELLOW : C_RED },
          { label: 'ROI',            value: pct(roi), sub: 'megtérülés', color: roi >= 0 ? C_GREEN : C_RED },
          { label: 'Profit',         value: `${totalProfit >= 0 ? '+' : ''}${(totalProfit).toLocaleString('hu-HU')} Ft`, sub: `${(totalStake).toLocaleString('hu-HU')} Ft tét`, color: totalProfit >= 0 ? C_GREEN : C_RED },
          { label: 'Legjobb sorozat', value: `${bestStreak}× W`, sub: 'győzelmek egymás után', color: C_YELLOW },
          { label: 'Jelenlegi',      value: `${currentStreak}× ${resolved.at(-1)?.result ?? '–'}`, sub: 'aktív sorozat', color: resolved.at(-1)?.result === 'Win' ? C_GREEN : C_RED },
        ].map(c => (
          <div key={c.label} className="bg-dark-card border border-dark-border rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{c.label}</p>
            <p className="text-xl font-bold font-mono" style={{ color: c.color }}>{c.value}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Cumulative profit + Win/Loss pie ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-dark-card border border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-4">Kumulált nyereség</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cumulativeData}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_ACCENT} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={C_ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v} Ft`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="profit" name="Profit (Ft)" stroke={C_ACCENT} fill="url(#profitGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-white mb-4">Win / Loss arány</h3>
          <div className="flex-1 flex items-center justify-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={[{ name: 'Win', value: wins }, { name: 'Loss', value: losses }]}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                  paddingAngle={3} dataKey="value"
                >
                  <Cell fill={C_GREEN} />
                  <Cell fill={C_RED} />
                </Pie>
                <Tooltip formatter={(v: any, name: any) => [`${v} fogadás`, name]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Daily P&L ──────────────────────────────────────────────────────── */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-4">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={dailyData} barSize={Math.max(12, Math.min(40, 400 / (dailyData.length || 1)))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v} Ft`} width={70} />
            <Tooltip
              formatter={(v: any) => [`${(v as number) >= 0 ? '+' : ''}${(v as number).toLocaleString('hu-HU')} Ft`, 'Profit']}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            <Bar dataKey="profit" name="Profit">
              {dailyData.map((d, i) => (
                <Cell key={i} fill={d.profit >= 0 ? C_GREEN : C_RED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Hourly win rate + Over/Under ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-1">Óránkénti win ráta</h3>
          <p className="text-[10px] text-slate-500 mb-3">Melyik időszakban a legeredményesebb a fogadás</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyData} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
              <Tooltip
                formatter={(v: any, name: any) => [name === 'winPct' ? `${v}%` : `${v} fogadás`, name === 'winPct' ? 'Win %' : 'Fogadások']}
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="winPct" name="winPct" radius={[3, 3, 0, 0]}>
                {hourlyData.map((d, i) => (
                  <Cell key={i} fill={d.winPct >= 60 ? C_GREEN : d.winPct >= 45 ? C_YELLOW : C_RED} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-1">Over / Under teljesítmény</h3>
          <p className="text-[10px] text-slate-500 mb-3">Melyik tipp típus hozza a több nyereményt</p>
          {betTypeData.length === 0 ? (
            <p className="text-slate-600 text-xs pt-8 text-center">Nincs betType adat</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={betTypeData} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#cbd5e1' }} />
                <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v} Ft`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left"  dataKey="wins"   name="Nyert"    fill={C_GREEN}  radius={[3,3,0,0]} />
                <Bar yAxisId="left"  dataKey="bets"   name="Összes"   fill={C_SLATE}  radius={[3,3,0,0]} />
                <Bar yAxisId="right" dataKey="profit" name="Profit Ft" fill={C_ACCENT} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── League breakdown ───────────────────────────────────────────────── */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-4">Liga szerinti bontás</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={leagueData} layout="vertical" barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis dataKey="league" type="category" tick={{ fontSize: 9, fill: '#94a3b8' }} width={130} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="wins"   name="Nyert"     fill={C_GREEN} radius={[0,3,3,0]}>
                {leagueData.map((d, i) => <Cell key={i} fill={LEAGUE_COLORS[d.league] ?? C_ACCENT} />)}
              </Bar>
              <Bar dataKey="losses" name="Elveszített" fill={C_RED} radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="space-y-2">
            {leagueData.map(d => {
              const wr = d.total ? Math.round(d.wins / d.total * 100) : 0;
              return (
                <div key={d.league} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: LEAGUE_COLORS[d.league] ?? C_ACCENT }} />
                  <span className="text-xs text-slate-300 flex-1 truncate">{d.league}</span>
                  <span className="text-xs font-mono text-slate-400">{d.wins}W/{d.losses}L</span>
                  <span className="text-xs font-bold w-10 text-right" style={{ color: wr >= 55 ? C_GREEN : wr >= 45 ? C_YELLOW : C_RED }}>
                    {wr}%
                  </span>
                  <span className="text-xs font-mono w-20 text-right" style={{ color: d.profit >= 0 ? C_GREEN : C_RED }}>
                    {ft(d.profit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Player breakdown ───────────────────────────────────────────────── */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1">Játékos teljesítmény (top 15)</h3>
        <p className="text-[10px] text-slate-500 mb-4">Meccsek, win ráta és becsült profit játékosra bontva</p>
        <ResponsiveContainer width="100%" height={Math.max(200, playerData.length * 28)}>
          <BarChart data={playerData} layout="vertical" barSize={12}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis dataKey="player" type="category" tick={{ fontSize: 9, fill: '#94a3b8' }} width={80} />
            <Tooltip
              formatter={(v: any, name: any) => [name === 'winPct' ? `${v}%` : v, name === 'winPct' ? 'Win %' : name]}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="wins"   name="Nyert"     fill={C_GREEN}  radius={[0,3,3,0]} />
            <Bar dataKey="losses" name="Veszített" fill={C_RED}    radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-dark-border">
                <th className="text-left py-1 pr-4">Játékos</th>
                <th className="text-center py-1 px-2">W</th>
                <th className="text-center py-1 px-2">L</th>
                <th className="text-center py-1 px-2">Win%</th>
                <th className="text-right py-1">Becsült profit</th>
              </tr>
            </thead>
            <tbody>
              {playerData.map(d => (
                <tr key={d.player} className="border-b border-dark-border/50 hover:bg-dark-card-hover">
                  <td className="py-1 pr-4 text-slate-300 font-medium">{d.player}</td>
                  <td className="py-1 px-2 text-center text-green">{d.wins}</td>
                  <td className="py-1 px-2 text-center text-red">{d.losses}</td>
                  <td className="py-1 px-2 text-center font-bold" style={{ color: d.winPct >= 55 ? C_GREEN : d.winPct >= 45 ? C_YELLOW : C_RED }}>
                    {d.winPct}%
                  </td>
                  <td className="py-1 text-right font-mono" style={{ color: d.profit >= 0 ? C_GREEN : C_RED }}>
                    {ft(Math.round(d.profit))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Intraday Trend Bot elemzés ─────────────────────────────────────── */}
      {trendStats.all.bets > 0 && (
        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-1">🔥 Intraday Trend Bot elemzés</h3>
          <p className="text-[10px] text-slate-500 mb-4">A Trend Botból érkező fogadások hatékonysága — VALUE vs TREND típusonként</p>

          {/* Összesített sor */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Összes trend fogadás', value: trendStats.all.bets,                        color: C_ACCENT },
              { label: 'Win ráta',             value: pct(trendStats.all.winRate),                color: trendStats.all.winRate >= 55 ? C_GREEN : trendStats.all.winRate >= 45 ? C_YELLOW : C_RED },
              { label: 'ROI',                  value: pct(trendStats.all.roi),                    color: trendStats.all.roi >= 0 ? C_GREEN : C_RED },
              { label: 'Profit',               value: ft(Math.round(trendStats.all.profit)),      color: trendStats.all.profit >= 0 ? C_GREEN : C_RED },
            ].map(c => (
              <div key={c.label} className="bg-dark-bg/50 border border-dark-border rounded-lg p-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{c.label}</p>
                <p className="text-lg font-bold font-mono" style={{ color: c.color }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* VALUE vs TREND kártyák */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <div className="rounded-lg border-l-4 p-4" style={{ borderColor: '#facc15', background: 'rgba(250,204,21,0.05)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span style={{backgroundColor:'#facc15',color:'#111827'}} className="px-2 py-0.5 rounded text-xs font-black">💰 VALUE</span>
                <span className="text-[10px] text-slate-500">≥70% vonal felett, ≥4 mai meccs</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Fogadás',  value: String(trendStats.value.bets),                                      color: '#e2e8f0' },
                  { label: 'Win/Loss', value: `${trendStats.value.wins}W / ${trendStats.value.losses}L`,           color: '#e2e8f0' },
                  { label: 'Win ráta', value: pct(trendStats.value.winRate),  color: trendStats.value.winRate >= 55 ? C_GREEN : trendStats.value.winRate >= 45 ? C_YELLOW : C_RED },
                  { label: 'ROI',      value: pct(trendStats.value.roi),      color: trendStats.value.roi >= 0 ? C_GREEN : C_RED },
                  { label: 'Profit',   value: ft(Math.round(trendStats.value.profit)), color: trendStats.value.profit >= 0 ? C_GREEN : C_RED },
                  { label: 'Tét',      value: `${trendStats.value.stake.toLocaleString('hu-HU')} Ft`, color: '#94a3b8' },
                ].map(c => (
                  <div key={c.label}>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider">{c.label}</p>
                    <p className="text-sm font-bold font-mono" style={{ color: c.color }}>{c.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border-l-4 border-orange-500 p-4" style={{ background: 'rgba(249,115,22,0.05)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 rounded text-xs font-black bg-orange-500 text-white">🚀 TREND</span>
                <span className="text-[10px] text-slate-500">Emelkedő trend, utolsó 2 a vonalon</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Fogadás',  value: String(trendStats.trend.bets),                                      color: '#e2e8f0' },
                  { label: 'Win/Loss', value: `${trendStats.trend.wins}W / ${trendStats.trend.losses}L`,           color: '#e2e8f0' },
                  { label: 'Win ráta', value: pct(trendStats.trend.winRate),  color: trendStats.trend.winRate >= 55 ? C_GREEN : trendStats.trend.winRate >= 45 ? C_YELLOW : C_RED },
                  { label: 'ROI',      value: pct(trendStats.trend.roi),      color: trendStats.trend.roi >= 0 ? C_GREEN : C_RED },
                  { label: 'Profit',   value: ft(Math.round(trendStats.trend.profit)), color: trendStats.trend.profit >= 0 ? C_GREEN : C_RED },
                  { label: 'Tét',      value: `${trendStats.trend.stake.toLocaleString('hu-HU')} Ft`, color: '#94a3b8' },
                ].map(c => (
                  <div key={c.label}>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider">{c.label}</p>
                    <p className="text-sm font-bold font-mono" style={{ color: c.color }}>{c.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Összehasonlító diagram */}
          {trendCompareData.length > 0 && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trendCompareData} barSize={36}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#cbd5e1' }} />
                <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left"  dataKey="wins"   name="Nyert"     fill={C_GREEN}  radius={[3,3,0,0]} />
                <Bar yAxisId="left"  dataKey="losses" name="Veszített" fill={C_RED}    radius={[3,3,0,0]} />
                <Bar yAxisId="right" dataKey="winPct" name="Win %"     fill={C_YELLOW} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

    </div>
  );
}
