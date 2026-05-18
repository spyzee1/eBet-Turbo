import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { fetchPlayerProfile, PlayerProfile as ProfileData, TeamStat } from '../api';

interface Props {
  onBack: () => void;
  initialPlayer?: string;
  initialLeague?: string;
}

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-dark-bg rounded-lg p-3 text-center">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TeamRow({ name, stat }: { name: string; stat: TeamStat }) {
  const wr = stat.matches > 0 ? stat.wins / stat.matches : 0;
  const avgGf = stat.matches > 0 ? (stat.gf / stat.matches).toFixed(1) : '0';
  const avgGa = stat.matches > 0 ? (stat.ga / stat.matches).toFixed(1) : '0';
  return (
    <div className="flex items-center gap-3 py-2 border-b border-dark-border/50 last:border-0">
      <span className="text-sm text-white font-medium flex-1 capitalize">{name}</span>
      <span className="text-xs text-slate-400 w-8 text-center">{stat.matches}</span>
      <span className="text-xs text-green w-12 text-center">{stat.wins}W</span>
      <span className="text-xs text-red w-12 text-center">{stat.losses}L</span>
      <span className="text-xs text-slate-400 w-14 text-center">{avgGf}/{avgGa}</span>
      <span className={`text-xs font-bold w-12 text-right ${wr >= 0.6 ? 'text-green' : wr >= 0.4 ? 'text-yellow' : 'text-red'}`}>
        {Math.round(wr * 100)}%
      </span>
    </div>
  );
}

export default function PlayerProfile({ onBack, initialPlayer = '', initialLeague = 'GT Leagues' }: Props) {
  const [playerName, setPlayerName] = useState(initialPlayer);
  const [league, setLeague] = useState(initialLeague);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadProfile = async () => {
    if (!playerName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchPlayerProfile(playerName.trim(), league);
      setProfile(data);
    } catch {
      setError('Nem sikerült betölteni. Ellenőrizd a nevet és a szervert.');
    } finally {
      setLoading(false);
    }
  };

  const ic = "bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent";

  // Team chart data
  const teamChartData = profile ? Object.entries(profile.teamStats)
    .filter(([, v]) => v.matches >= 1)
    .map(([name, v]) => ({
      name: name.length > 12 ? name.slice(0, 12) + '…' : name,
      winRate: Math.round((v.wins / v.matches) * 100),
      matches: v.matches,
    }))
    .sort((a, b) => b.winRate - a.winRate) : [];

  // O/U chart data
  const ouChartData = profile?.ouStats.map(ou => ({
    line: ou.line,
    over: Math.round(ou.over * 100),
    under: Math.round(ou.under * 100),
  })) || [];

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} className="text-slate-400 hover:text-white cursor-pointer shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadProfile()}
            placeholder="Játékos neve..."
            className={`flex-1 ${ic}`}
          />
          <select value={league} onChange={e => setLeague(e.target.value)} className={ic}>
            <option value="GT Leagues">GT Leagues (12p)</option>
            <option value="Esoccer Battle">Esoccer Battle (8p)</option>
            <option value="eAdriatic League">eAdriatic League (10p)</option>
            <option value="Esports Volta">Esports Volta (6p)</option>
          </select>
          <button
            onClick={loadProfile}
            disabled={loading}
            className="bg-accent/20 text-accent-light hover:bg-accent/30 text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Betöltés...' : 'Keresés'}
          </button>
        </div>
        {error && <p className="text-xs text-red mt-2">{error}</p>}
      </div>

      {!profile ? (
        <div className="bg-dark-card rounded-xl border border-dark-border p-12 text-center">
          <h3 className="text-lg font-medium text-slate-400 mb-2">Keress egy játékost</h3>
          <p className="text-sm text-slate-600">Írd be a nevét és nyomj Entert vagy kattints a Keresésre.</p>
        </div>
      ) : (
        <>
          {/* Header stats */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-5">
            <div className="flex items-center gap-4 mb-4">
              <h2 className="text-xl font-bold text-white capitalize">{profile.name}</h2>
              <span className="text-xs bg-accent/20 text-accent-light px-2 py-0.5 rounded">{profile.league}</span>
              <span className="text-xs text-slate-500">{profile.matches} meccs</span>
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              <StatBadge label="Win Rate" value={pct(profile.winRate)} color="text-green" />
              <StatBadge label="Loss Rate" value={pct(profile.lossRate)} color="text-red" />
              <StatBadge label="GF/meccs" value={profile.gfPerMatch.toFixed(2)} color="text-accent-light" />
              <StatBadge label="GA/meccs" value={profile.gaPerMatch.toFixed(2)} color="text-yellow" />
              <StatBadge label="Forma (10)" value={`${profile.form10 > 0 ? '+' : ''}${Math.round(profile.form10 * 100)}%`} color={profile.form10 >= 0 ? 'text-green' : 'text-red'} />
              <StatBadge label="BTTS" value={pct(profile.bttsYes)} color="text-purple" />
            </div>
          </div>

          {/* Insights */}
          {profile.insights && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {profile.insights.bestTeam && (
                <div className="bg-dark-card rounded-xl border border-dark-border p-4">
                  <p className="text-[10px] text-slate-500 mb-1">Legjobb csapat</p>
                  <p className="text-sm font-bold text-green capitalize">{profile.insights.bestTeam.name}</p>
                  <p className="text-xs text-slate-400">{profile.insights.bestTeam.wins}W/{profile.insights.bestTeam.losses}L ({profile.insights.bestTeam.matches}m)</p>
                </div>
              )}
              {profile.insights.worstTeam && (
                <div className="bg-dark-card rounded-xl border border-dark-border p-4">
                  <p className="text-[10px] text-slate-500 mb-1">Leggyengébb csapat</p>
                  <p className="text-sm font-bold text-red capitalize">{profile.insights.worstTeam.name}</p>
                  <p className="text-xs text-slate-400">{profile.insights.worstTeam.wins}W/{profile.insights.worstTeam.losses}L ({profile.insights.worstTeam.matches}m)</p>
                </div>
              )}
              {profile.insights.easiestOpponent && (
                <div className="bg-dark-card rounded-xl border border-dark-border p-4">
                  <p className="text-[10px] text-slate-500 mb-1">Legkönnyebb ellenfél</p>
                  <p className="text-sm font-bold text-green capitalize">{profile.insights.easiestOpponent.name}</p>
                  <p className="text-xs text-slate-400">{profile.insights.easiestOpponent.wins}W/{profile.insights.easiestOpponent.losses}L</p>
                </div>
              )}
              {profile.insights.toughestOpponent && (
                <div className="bg-dark-card rounded-xl border border-dark-border p-4">
                  <p className="text-[10px] text-slate-500 mb-1">Legnehezebb ellenfél</p>
                  <p className="text-sm font-bold text-red capitalize">{profile.insights.toughestOpponent.name}</p>
                  <p className="text-xs text-slate-400">{profile.insights.toughestOpponent.wins}W/{profile.insights.toughestOpponent.losses}L</p>
                </div>
              )}
            </div>
          )}

          {/* Time insights */}
          {(profile.timeInsights?.length > 0 || profile.timePeriods) && (
            <div className="bg-dark-card rounded-xl border border-dark-border p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Napszak teljesítmény</h3>
              <div className="grid grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Reggel', value: profile.timePeriods?.morning },
                  { label: 'Délután', value: profile.timePeriods?.afternoon },
                  { label: 'Este', value: profile.timePeriods?.evening },
                  { label: 'Éjszaka', value: profile.timePeriods?.night },
                ].map(p => (
                  <div key={p.label} className="text-center bg-dark-bg rounded-lg p-2">
                    <p className="text-[10px] text-slate-500">{p.label}</p>
                    <p className={`text-sm font-bold ${p.value && p.value >= 0.6 ? 'text-green' : p.value && p.value >= 0.4 ? 'text-yellow' : 'text-red'}`}>
                      {p.value ? `${Math.round(p.value * 100)}%` : '-'}
                    </p>
                  </div>
                ))}
              </div>
              {profile.timeInsights?.map((insight, i) => (
                <p key={i} className="text-xs text-slate-400">{insight}</p>
              ))}
            </div>
          )}

          {/* Form curve */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Forma görbe (utolsó {profile.formCurve.length} meccs)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={profile.formCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
                <XAxis dataKey="idx" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#2a2e45' }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#2a2e45' }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2e45', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [`${v}%`, 'Win Rate']}
                  labelFormatter={(i) => {
                    const p = profile!.formCurve[Number(i) - 1];
                    return p ? `vs ${p.opponent} (${p.date}) — ${p.result}` : '';
                  }}
                />
                <Line type="monotone" dataKey="winRate" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Team performance chart */}
            {teamChartData.length > 0 && (
              <div className="bg-dark-card rounded-xl border border-dark-border p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Csapat teljesítmény</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={teamChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={100} />
                    <Tooltip
                      contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2e45', borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => [`${v}%`, 'Win Rate']}
                    />
                    <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
                      {teamChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.winRate >= 60 ? '#10b981' : entry.winRate >= 40 ? '#f59e0b' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* O/U distribution */}
            {ouChartData.length > 0 && (
              <div className="bg-dark-card rounded-xl border border-dark-border p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Over/Under eloszlás</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ouChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
                    <XAxis dataKey="line" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2e45', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="over" fill="#10b981" name="Over" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="under" fill="#ef4444" name="Under" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Team breakdown table */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Csapat részletek</h3>
            <div className="flex items-center gap-3 text-[10px] text-slate-600 mb-2 px-0">
              <span className="flex-1">Csapat</span>
              <span className="w-8 text-center">M</span>
              <span className="w-12 text-center">W</span>
              <span className="w-12 text-center">L</span>
              <span className="w-14 text-center">GF/GA</span>
              <span className="w-12 text-right">WR</span>
            </div>
            {Object.entries(profile.teamStats)
              .sort(([, a], [, b]) => b.matches - a.matches)
              .map(([name, stat]) => (
                <TeamRow key={name} name={name} stat={stat} />
              ))}
          </div>

          {/* Opponent breakdown table */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Ellenfél részletek</h3>
            <div className="flex items-center gap-3 text-[10px] text-slate-600 mb-2">
              <span className="flex-1">Ellenfél</span>
              <span className="w-8 text-center">M</span>
              <span className="w-12 text-center">W</span>
              <span className="w-12 text-center">L</span>
              <span className="w-14 text-center">GF/GA</span>
              <span className="w-12 text-right">WR</span>
            </div>
            {Object.entries(profile.opponentStats)
              .sort(([, a], [, b]) => b.matches - a.matches)
              .map(([name, stat]) => (
                <TeamRow key={name} name={name} stat={stat} />
              ))}
          </div>

          {/* Last matches */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Utolsó meccsek</h3>
            <div className="space-y-1">
              {profile.lastMatches.map((m, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-dark-border/30 last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.result === 'win' ? 'bg-green' : m.result === 'loss' ? 'bg-red' : 'bg-yellow'}`} />
                  <span className="text-xs text-slate-400 w-20 shrink-0">{m.date}</span>
                  <span className="text-xs text-white capitalize">{m.team}</span>
                  <span className="text-xs text-slate-600 mx-1">vs</span>
                  <span className="text-xs text-white capitalize">{m.opponent}</span>
                  <span className="text-xs text-slate-400 capitalize">{m.opponentTeam}</span>
                  <span className={`text-xs font-bold ml-auto ${m.result === 'win' ? 'text-green' : m.result === 'loss' ? 'text-red' : 'text-yellow'}`}>
                    {m.scoreHome}-{m.scoreAway}
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
