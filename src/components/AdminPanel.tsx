import { useState, useEffect, useRef } from 'react';
import {
  fetchAdminUsers, adminExtend, adminRevoke, AdminUser,
  fetchSupabaseStats, fetchSupabasePeek,
  SupabaseStatsResponse, SupabasePeekResponse,
  fetchAdminLogs, clearAdminLogs, AdminLogEntry,
} from '../api';

export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Supabase block state
  const [stats, setStats] = useState<SupabaseStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [peek, setPeek] = useState<SupabasePeekResponse | null>(null);
  const [peekLoading, setPeekLoading] = useState<string | null>(null);
  const [peekLimit, setPeekLimit] = useState(20);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  // Log block state
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsTotal, setLogsTotal] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setUsers(await fetchAdminUsers());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const extend = async (userId: string, days: number) => {
    setBusy(userId);
    await adminExtend(userId, days);
    await load();
    setBusy(null);
  };

  const revoke = async (userId: string) => {
    if (!confirm('Biztosan visszavonod az előfizetést?')) return;
    setBusy(userId);
    await adminRevoke(userId);
    await load();
    setBusy(null);
  };

  const subStatus = (sub: AdminUser['subscription']) => {
    if (!sub) return { label: 'Nincs', color: 'text-slate-500' };
    const active = new Date(sub.expires_at) > new Date();
    return active
      ? { label: `Aktív · ${new Date(sub.expires_at).toLocaleDateString('hu-HU')}`, color: 'text-green-400' }
      : { label: `Lejárt · ${new Date(sub.expires_at).toLocaleDateString('hu-HU')}`, color: 'text-red-400' };
  };

  const loadStats = async () => {
    setStatsLoading(true);
    setSupabaseError(null);
    const r = await fetchSupabaseStats();
    if (!r) setSupabaseError('Nem sikerült betölteni (jogosultság / szerver hiba)');
    else setStats(r);
    setStatsLoading(false);
  };

  const loadPeek = async (table: string, offset = 0, limit = peekLimit) => {
    setPeekLoading(table);
    setSupabaseError(null);
    const r = await fetchSupabasePeek(table, limit, offset);
    if (!r) setSupabaseError(`Nem sikerült beolvasni: ${table}`);
    else setPeek(r);
    setPeekLoading(null);
  };

  const goPage = async (offset: number) => {
    if (!peek) return;
    await loadPeek(peek.table, Math.max(0, offset), peek.limit);
  };

  const changePeekLimit = async (newLimit: number) => {
    setPeekLimit(newLimit);
    if (peek) await loadPeek(peek.table, 0, newLimit);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    setLogsError(null);
    const r = await fetchAdminLogs(200);
    if (!r) setLogsError('Nem sikerült betölteni');
    else { setLogs(r.logs); setLogsTotal(r.total); }
    setLogsLoading(false);
  };

  const handleClearLogs = async () => {
    if (!confirm('Törli az összes log bejegyzést?')) return;
    await clearAdminLogs();
    setLogs([]);
    setLogsTotal(0);
  };

  useEffect(() => {
    if (!autoRefresh) return;
    loadLogs();
    const id = setInterval(loadLogs, 5000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  useEffect(() => {
    if (autoRefresh) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoRefresh]);

  const fmtNum = (n: number | null) => n === null ? '?' : n.toLocaleString('hu-HU');

  // Human-readable title for cells — recognises timestamp columns
  const cellTitle = (key: string, value: any): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);

    // Number columns that look like timestamps (start_time = ms epoch)
    if (typeof value === 'number' && /(_time|_at|timestamp|date)$/i.test(key)) {
      const ms = value > 1e12 ? value : value > 1e10 ? value * 1000 : null;
      if (ms !== null) {
        const d = new Date(ms);
        if (!isNaN(d.getTime())) {
          const local = d.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'medium' });
          const rel = humanizeRelative(ms);
          return `${local}\n${rel}\n(${value})`;
        }
      }
    }

    // ISO date strings (created_at, updated_at, expires_at)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        const local = d.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'medium' });
        const rel = humanizeRelative(d.getTime());
        return `${local}\n${rel}\n(${value})`;
      }
    }

    return String(value);
  };

  // Relative time helper: "2 órája", "3 napja", "tegnap", "ma"
  function humanizeRelative(ms: number): string {
    const diff = ms - Date.now();
    const absSec = Math.abs(diff) / 1000;
    const future = diff > 0;
    const tag = future ? 'múlva' : 'ezelőtt';

    if (absSec < 60) return `${Math.round(absSec)} másodperce${future ? ' (jövő)' : ''}`;
    const absMin = absSec / 60;
    if (absMin < 60) return `${Math.round(absMin)} perce ${tag}`;
    const absHr = absMin / 60;
    if (absHr < 24) return `${Math.round(absHr)} órája ${tag}`;
    const absDay = absHr / 24;
    if (absDay < 30) return `${Math.round(absDay)} napja ${tag}`;
    const absMon = absDay / 30;
    if (absMon < 12) return `${Math.round(absMon)} hónapja ${tag}`;
    return `${Math.round(absMon / 12)} éve ${tag}`;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-2xl font-bold">Admin Panel</h1>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition cursor-pointer">
          Frissítés
        </button>
      </div>

      {/* ── Supabase block ───────────────────────────────────────────────── */}
      <section className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-dark-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-white text-lg font-semibold">Supabase adatbázis</h2>
            {stats && <p className="text-xs text-slate-500 mt-0.5">Frissítve: {new Date(stats.generated).toLocaleString('hu-HU')}</p>}
          </div>
          <button
            onClick={loadStats}
            disabled={statsLoading}
            className="px-4 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-sm font-medium transition cursor-pointer disabled:opacity-40"
          >
            {statsLoading ? 'Lekérés…' : 'Rekordok lekérése'}
          </button>
        </div>

        {supabaseError && (
          <div className="px-5 py-3 bg-red-500/10 text-red-400 text-sm border-b border-dark-border">{supabaseError}</div>
        )}

        {stats && (
          <div className="px-5 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {stats.tables.map(t => (
                <div key={t.table} className="bg-dark-bg/40 border border-dark-border rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 truncate">{t.table}</p>
                    <p className={`text-xl font-bold ${t.error ? 'text-red-400' : 'text-white'} tabular-nums`}>
                      {t.error ? '—' : fmtNum(t.count)}
                    </p>
                    {t.error && <p className="text-[10px] text-red-400 truncate" title={t.error}>{t.error}</p>}
                  </div>
                  <button
                    onClick={() => loadPeek(t.table)}
                    disabled={peekLoading === t.table || !!t.error}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-medium transition cursor-pointer disabled:opacity-40 shrink-0"
                  >
                    {peekLoading === t.table ? '…' : 'Belenéz'}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Sorok lekéréskor:</span>
              <select
                value={peekLimit}
                onChange={e => setPeekLimit(parseInt(e.target.value))}
                className="bg-dark-bg/60 border border-dark-border rounded px-2 py-1 text-white"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        )}

        {peek && (() => {
          const total = peek.total ?? 0;
          const from = peek.offset + 1;
          const to = Math.min(peek.offset + peek.rows.length, peek.total ?? peek.offset + peek.rows.length);
          const totalPages = peek.total ? Math.ceil(peek.total / peek.limit) : 1;
          const currentPage = Math.floor(peek.offset / peek.limit) + 1;
          const hasPrev = peek.offset > 0;
          const hasNext = peek.total !== null ? peek.offset + peek.limit < peek.total : peek.rows.length === peek.limit;
          return (
          <div className="px-5 py-4 border-t border-dark-border">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-white font-semibold">
                Tábla: <span className="text-emerald-400">{peek.table}</span>
                <span className="text-slate-500 text-sm ml-2">
                  {peek.total !== null
                    ? `${from}–${to} / ${total.toLocaleString('hu-HU')} sor`
                    : `${peek.rows.length} sor`}
                </span>
              </h3>
              <button onClick={() => setPeek(null)} className="text-slate-500 hover:text-white text-sm cursor-pointer">
                Bezár ✕
              </button>
            </div>

            {/* Pagination controls */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3 bg-dark-bg/40 border border-dark-border rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Oldalanként:</span>
                <select
                  value={peek.limit}
                  onChange={e => changePeekLimit(parseInt(e.target.value))}
                  disabled={peekLoading === peek.table}
                  className="bg-dark-bg/60 border border-dark-border rounded px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => goPage(0)}
                  disabled={!hasPrev || peekLoading === peek.table}
                  className="px-2 py-1 rounded text-xs bg-dark-bg/60 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Első oldal"
                >
                  «
                </button>
                <button
                  onClick={() => goPage(peek.offset - peek.limit)}
                  disabled={!hasPrev || peekLoading === peek.table}
                  className="px-3 py-1 rounded text-xs bg-dark-bg/60 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  ‹ Előző
                </button>
                <span className="px-3 py-1 text-xs text-slate-300 tabular-nums">
                  {currentPage}{peek.total !== null ? ` / ${totalPages}` : ''}
                </span>
                <button
                  onClick={() => goPage(peek.offset + peek.limit)}
                  disabled={!hasNext || peekLoading === peek.table}
                  className="px-3 py-1 rounded text-xs bg-dark-bg/60 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  Következő ›
                </button>
                <button
                  onClick={() => goPage((totalPages - 1) * peek.limit)}
                  disabled={!hasNext || peekLoading === peek.table}
                  className="px-2 py-1 rounded text-xs bg-dark-bg/60 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Utolsó oldal"
                >
                  »
                </button>
              </div>
            </div>
            {peek.rows.length === 0 ? (
              <p className="text-sm text-slate-500 italic">A tábla üres.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-dark-border">
                <table className="w-full text-xs">
                  <thead className="bg-dark-bg/40 text-slate-400 uppercase">
                    <tr>
                      {Object.keys(peek.rows[0]).map(k => (
                        <th key={k} className="px-3 py-2 text-left font-medium whitespace-nowrap">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {peek.rows.map((row, i) => (
                      <tr key={i} className="border-t border-dark-border hover:bg-white/2">
                        {Object.entries(row).map(([k, v]) => (
                          <td key={k} className="px-3 py-2 text-slate-300 max-w-[260px] truncate" title={cellTitle(k, v)}>
                            {v === null ? <span className="text-slate-600">null</span>
                              : typeof v === 'object' ? <span className="text-slate-500">{`{${Object.keys(v).length} kulcs}`}</span>
                              : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })()}
      </section>

      {/* ── Server log block ─────────────────────────────────────────────── */}
      <section className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-dark-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-white text-lg font-semibold">Szerver log</h2>
            {logsTotal !== null && <p className="text-xs text-slate-500 mt-0.5">{logsTotal} bejegyzés (max 500)</p>}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-orange-500" />
              Auto (5s)
            </label>
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition cursor-pointer disabled:opacity-40"
            >
              {logsLoading ? '…' : 'Frissítés'}
            </button>
            <button
              onClick={handleClearLogs}
              className="px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-sm transition cursor-pointer"
            >
              Törlés
            </button>
          </div>
        </div>

        {logsError && <div className="px-5 py-3 bg-red-500/10 text-red-400 text-sm border-b border-dark-border">{logsError}</div>}

        {logs.length === 0 && !logsLoading && (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">
            {logsTotal === null ? 'Kattints a Frissítésre a logok betöltéséhez' : 'Nincs log bejegyzés'}
          </div>
        )}

        {logs.length > 0 && (
          <div className="overflow-y-auto max-h-[480px] font-mono text-[11px] leading-relaxed">
            {logs.map((entry, i) => (
              <div key={i} className={`flex gap-3 px-4 py-0.5 border-t border-dark-border/40 hover:bg-white/2 ${
                entry.level === 'error' ? 'text-red-400 bg-red-500/5' :
                entry.level === 'warn' ? 'text-yellow-400' : 'text-slate-300'
              }`}>
                <span className="text-slate-600 shrink-0 select-none">
                  {new Date(entry.ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`shrink-0 w-10 select-none ${
                  entry.level === 'error' ? 'text-red-500' :
                  entry.level === 'warn' ? 'text-yellow-500' : 'text-slate-500'
                }`}>{entry.level}</span>
                <span className="break-all whitespace-pre-wrap">{entry.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </section>

      {/* ── Users block (eredeti) ────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border">
            <h2 className="text-white text-lg font-semibold">Felhasználók ({users.length})</h2>
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-px bg-dark-border text-xs text-slate-500 uppercase tracking-wider px-4 py-3">
            <span>Felhasználó</span>
            <span>Előfizetés</span>
            <span>Műveletek</span>
          </div>
          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">Nincsenek felhasználók</div>
          )}
          {users.map(u => {
            const status = subStatus(u.subscription);
            const isBusy = busy === u.id;
            return (
              <div key={u.id} className="grid grid-cols-[1fr_1fr_auto] gap-4 items-center px-4 py-3 border-t border-dark-border hover:bg-white/2 transition">
                <div>
                  <p className="text-sm text-white font-medium truncate">{u.email}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(u.created_at).toLocaleDateString('hu-HU')}
                    {!u.email_confirmed && <span className="ml-2 text-yellow-500">· nem megerősített</span>}
                  </p>
                </div>
                <p className={`text-sm ${status.color}`}>{status.label}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => extend(u.id, 30)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                  >
                    +30 nap
                  </button>
                  <button
                    onClick={() => extend(u.id, 365)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                  >
                    +1 év
                  </button>
                  {u.subscription && (
                    <button
                      onClick={() => revoke(u.id)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                    >
                      Visszavon
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
