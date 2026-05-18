import { useState, useEffect, useCallback, useRef } from 'react';
import TopNav from './components/TopNav';
import LandingPage from './components/LandingPage';
import ChangePasswordModal from './components/ChangePasswordModal';
import SetNewPasswordModal from './components/SetNewPasswordModal';
import SubscriptionExpired from './components/SubscriptionExpired';
import AdminPanel from './components/AdminPanel';
import Dashboard from './components/Dashboard';
import Upcoming from './components/Upcoming';
import MatchForm from './components/MatchForm';
import SettingsPanel from './components/SettingsPanel';
import History from './components/History';
import PlayerProfile from './components/PlayerProfile';
import TopTips from './components/TopTips';
import Backtest from './components/Backtest';
import Naplo from './components/Naplo';
import Segedlet from './components/Segedlet';
import Statisztika from './components/Statisztika';
import NapiMerkezesek from './components/NapiMerkezesek';
import ToastContainer from './components/ToastContainer';
import { MatchInput, MatchResult, Settings } from './model/types';
import { calculateMatch } from './model/calculator';
import {
  loadSettings, saveSettings,
  loadMatches, saveMatches,
  loadHistory, saveHistory, addToHistory,
  HistoryEntry,
} from './model/store';
import { autoCheckResults, resolveResults, fetchJournal, fetchRemoteSettings, saveRemoteSettings, fetchSubscription, fetchAdminStatus, fetchCheckedMatches, Subscription } from './api';
import { useRealtimeSync, debouncedSaveJournal, debouncedSaveChecked } from './hooks/useRealtimeSync';
import { startVisiblePolling } from './hooks/visiblePolling';
import { getSupabaseClient } from './lib/supabase';

type View = 'dashboard' | 'topTips' | 'napiMerkezesek' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings' | 'statistics' | 'segedlet' | 'admin';

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [emailConfirmed, setEmailConfirmed] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null | 'loading'>('loading');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getSupabaseClient().then(async sb => {
      if (!sb) { setAuthed(true); setSubscription(null); return; }
      const { data: { session } } = await sb.auth.getSession();
      setAuthed(!!session);
      setUserEmail(session?.user?.email);
      setEmailConfirmed(!!session?.user?.email_confirmed_at);
      sb.auth.onAuthStateChange((ev, s) => {
        if (ev === 'PASSWORD_RECOVERY') { setShowRecovery(true); return; }
        setAuthed(!!s);
        setUserEmail(s?.user?.email);
        setEmailConfirmed(!!s?.user?.email_confirmed_at);
      });
    });
  }, []);

  useEffect(() => {
    if (authed !== true) { setSubscription(null); setIsAdmin(false); return; }
    fetchSubscription().then(setSubscription);
    fetchAdminStatus().then(setIsAdmin);
  }, [authed]);

  const handleResendConfirmation = async () => {
    if (resendCooldown || !userEmail) return;
    const sb = await getSupabaseClient();
    if (!sb) return;
    await sb.auth.resend({ type: 'signup', email: userEmail });
    setResendCooldown(true);
    setTimeout(() => setResendCooldown(false), 60_000);
  };

  const handleLogout = async () => {
    const sb = await getSupabaseClient();
    if (sb) await sb.auth.signOut();
    setAuthed(false);
    setUserEmail(undefined);
    setSubscription(null);
    setIsAdmin(false);
  };

  const handleDeleteAccount = async () => {
    try {
      const sb = await getSupabaseClient();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      await fetch('/api/auth/delete-account', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (sb) await sb.auth.signOut();
    } catch { /* silent */ }
    // Wipe per-user local state so a next user on the same device starts clean
    try {
      localStorage.removeItem('betting_journal');
      localStorage.removeItem('checked_green_matches');
    } catch { /* silent */ }
    setAuthed(false);
    setUserEmail(undefined);
    setSubscription(null);
    setIsAdmin(false);
  };

  const [view, setView] = useState<View>('topTips');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [matches, setMatches] = useState<MatchInput[]>(loadMatches);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const settingsSynced = useRef(false);

  // Realtime sync (journals + checked_matches)
  useRealtimeSync(authed === true);

  // Startup: load checked matches from server, merge with localStorage
  useEffect(() => {
    if (authed !== true) return;
    fetchCheckedMatches().then(remote => {
      if (!remote.length) return;
      const CHECKED_KEY = 'checked_green_matches';
      const local: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]'); } catch { return []; } })();
      const merged = new Map<string, any>();
      for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
      for (const e of remote) if (e?.matchId) merged.set(e.matchId, e);
      localStorage.setItem(CHECKED_KEY, JSON.stringify(Array.from(merged.values())));
      window.dispatchEvent(new Event('checked-matches-updated'));
    });
  }, [authed]);

  // Save checked matches to server whenever they change
  useEffect(() => {
    if (authed !== true) return;
    const CHECKED_KEY = 'checked_green_matches';
    const handler = () => {
      const entries: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]'); } catch { return []; } })();
      debouncedSaveChecked(entries);
    };
    window.addEventListener('checked-matches-updated', handler);
    return () => window.removeEventListener('checked-matches-updated', handler);
  }, [authed]);

  // Save journal to server whenever it changes
  useEffect(() => {
    if (authed !== true) return;
    const JOURNAL_KEY = 'betting_journal';
    const handler = () => {
      const entries: any[] = (() => { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch { return []; } })();
      debouncedSaveJournal(entries);
    };
    window.addEventListener('journal-updated', handler);
    return () => window.removeEventListener('journal-updated', handler);
  }, [authed]);

  const results: MatchResult[] = matches.map(m => calculateMatch(m, settings));

  // Startup: pull settings from server, server takes priority over localStorage.
  // The next [settings] effect picks up the merged value and persists it locally.
  useEffect(() => {
    if (authed !== true) return;
    fetchRemoteSettings().then(remote => {
      if (remote && Object.keys(remote).length > 0) {
        setSettings(s => ({ ...s, ...remote }));
      }
      settingsSynced.current = true;
    });
  }, [authed]);

  useEffect(() => {
    saveSettings(settings);
    if (settingsSynced.current) saveRemoteSettings(settings);
  }, [settings]);
  useEffect(() => { saveMatches(matches); }, [matches]);
  useEffect(() => { saveHistory(history); }, [history]);

  // Auto-check pending results every 5 minutes
  useEffect(() => {
    const check = async () => {
      const pending = history.filter(h => h.outcome === 'pending');
      if (pending.length === 0) return;

      try {
        const toCheck = pending.map(h => ({
          playerA: h.result.input.playerA,
          playerB: h.result.input.playerB,
          league: h.result.input.liga,
          timestamp: h.timestamp,
        }));
        const results = await autoCheckResults(toCheck);

        setHistory(prev => {
          const next = [...prev];
          for (const r of results) {
            if (r.outcome === 'pending') continue;
            const idx = next.findIndex(h =>
              h.outcome === 'pending' &&
              h.result.input.playerA === r.playerA &&
              h.result.input.playerB === r.playerB
            );
            if (idx !== -1) {
              // Map the match result to bet outcome
              const bet = next[idx].result.valueBet;
              let outcome: 'win' | 'loss' | 'pending' = 'pending';
              if (bet.includes('A gyozelem')) {
                outcome = r.outcome === 'win' ? 'win' : 'loss';
              } else if (bet.includes('B gyozelem')) {
                outcome = r.outcome === 'loss' ? 'win' : r.outcome === 'win' ? 'loss' : 'loss';
              } else if (bet === 'OVER' && r.score) {
                const goals = r.score.split('-').map(Number);
                const total = goals[0] + goals[1];
                outcome = total > next[idx].result.input.ouLine ? 'win' : 'loss';
              } else if (bet === 'UNDER' && r.score) {
                const goals = r.score.split('-').map(Number);
                const total = goals[0] + goals[1];
                outcome = total < next[idx].result.input.ouLine ? 'win' : 'loss';
              }
              if (outcome !== 'pending') {
                next[idx] = { ...next[idx], outcome };
              }
            }
          }
          return next;
        });
      } catch {
        // Silently fail - will retry next interval
      }
    };

    return startVisiblePolling(check, 5 * 60 * 1000);
  }, [history]);

  // ── Startup-only journal merge a szerverről ─────────────────────────────────
  // Eddig minden 60s-os validator újra fetchJournal()-t hívott (teljes blob letöltés),
  // ami a Realtime sync mellett redundáns. Most csak login-kor egyszer fut.
  useEffect(() => {
    if (authed !== true) return;
    const BETTING_JOURNAL_KEY = 'betting_journal';
    type JEntry = { matchId?: string } & Record<string, unknown>;
    fetchJournal().then(serverJournal => {
      if (serverJournal.length === 0) return;
      const localRaw = localStorage.getItem(BETTING_JOURNAL_KEY);
      const local: JEntry[] = localRaw ? (() => { try { return JSON.parse(localRaw); } catch { return []; } })() : [];
      if (serverJournal.length <= local.length) return;
      const merged = new Map<string, JEntry>();
      for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
      for (const e of serverJournal as JEntry[]) if (e?.matchId) merged.set(e.matchId, e);
      localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(Array.from(merged.values())));
      window.dispatchEvent(new Event('journal-updated'));
    }).catch(() => { /* silent */ });
  }, [authed]);

  // ── Journal result validator — 60s-onként a localStorage pending-eket resolválja
  // Nincs többé fetchJournal — a Realtime sync push-olja a journal frissítéseket.
  useEffect(() => {
    const BETTING_JOURNAL_KEY = 'betting_journal';
    const CHECKED_GREEN_KEY   = 'checked_green_matches';

    const validate = async () => {
      try {
        // Find pending journal entries that should have a result by now
        const journal: any[] = (() => {
          try { return JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]'); } catch { return []; }
        })();

        const toResolve = journal.filter(m =>
          !m.result && m.betType && m.betLine != null && m.timestamp &&
          m.tip?.playerA && m.tip?.playerB
        );
        if (toResolve.length === 0) return;

        const resolved = await resolveResults(toResolve.map(m => ({
          matchId: m.matchId,
          playerA: m.tip.playerA,
          playerB: m.tip.playerB,
          league: m.tip.league || m.tip.liga || 'GT Leagues',
          timestamp: m.timestamp,
          betType: m.betType,
          betLine: m.betLine,
        })));

        let changed = false;
        for (const r of resolved) {
          if (r.pending || !r.outcome) continue;
          const idx = journal.findIndex((m: any) => m.matchId === r.matchId);
          if (idx !== -1 && !journal[idx].result) {
            journal[idx] = { ...journal[idx], result: r.outcome, finalScore: r.score };
            changed = true;
            console.log(`✅ Auto-result (esoccerbet): ${journal[idx].tip?.playerA} vs ${journal[idx].tip?.playerB} → ${r.outcome} (${r.score})`);
          }
        }

        if (changed) {
          localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
          debouncedSaveJournal(journal);
          // Sync checked_green_matches
          const green: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]'); } catch { return []; } })();
          for (const r of resolved) {
            if (r.pending || !r.outcome) continue;
            const gi = green.findIndex((m: any) => m.matchId === r.matchId);
            if (gi !== -1 && !green[gi].result) {
              green[gi] = { ...green[gi], result: r.outcome, finalScore: r.score };
            }
          }
          localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(green));
          window.dispatchEvent(new Event('journal-updated'));
          window.dispatchEvent(new Event('checked-matches-updated'));
        }
      } catch { /* silent */ }
    };

    return startVisiblePolling(validate, 60_000);
  }, []);

  const addMatch = useCallback((m: MatchInput) => {
    setMatches(prev => [...prev, m]);
    setView('dashboard');
  }, []);

  const removeMatch = useCallback((id: string) => {
    setMatches(prev => prev.filter(m => m.id !== id));
  }, []);

  const saveToHistory = useCallback((result: MatchResult) => {
    const updated = addToHistory(result);
    setHistory(updated);
    setMatches(prev => prev.filter(m => m.id !== result.input.id));
  }, []);

  const updateOutcome = useCallback((idx: number, outcome: 'win' | 'loss' | 'pending') => {
    setHistory(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], outcome };
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => { setHistory([]); }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return <LandingPage onLogin={() => setAuthed(true)} />;
  }

  // Still loading subscription
  if (subscription === 'loading') {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Subscription expired
  if (subscription && new Date(subscription.expires_at) < new Date()) {
    return <SubscriptionExpired expiresAt={subscription.expires_at} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      <TopNav
        current={view}
        onChange={setView}
        userEmail={userEmail}
        onLogout={handleLogout}
        onDeleteAccount={handleDeleteAccount}
        onEditProfile={() => setShowPasswordModal(true)}
        isAdmin={isAdmin}
        subscription={subscription}
      />

      {!emailConfirmed && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-yellow-300">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <span>Erősítsd meg az e-mail címedet a teljes hozzáféréshez. Ellenőrizd a postaládádat ({userEmail}).</span>
          </div>
          <button
            onClick={handleResendConfirmation}
            disabled={resendCooldown}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-300 disabled:opacity-50 transition cursor-pointer"
          >
            {resendCooldown ? 'Elküldve ✓' : 'Újraküldés'}
          </button>
        </div>
      )}

      {showPasswordModal && userEmail && (
        <ChangePasswordModal email={userEmail} onClose={() => setShowPasswordModal(false)} />
      )}
      {showRecovery && (
        <SetNewPasswordModal onClose={() => setShowRecovery(false)} />
      )}

      <main className="flex-1">
        <div className="max-w-screen-2xl mx-auto p-4 lg:p-6">
          {view === 'topTips' && <TopTips />}
          {view === 'napiMerkezesek' && <NapiMerkezesek />}
          {view === 'naplo' && <Naplo />}
          {view === 'newMatch' && <MatchForm onSubmit={addMatch} />}
          {view === 'segedlet' && <Segedlet />}
          {view === 'statistics' && <Statisztika />}
          {view === 'dashboard' && <Dashboard results={results} history={history} bankroll={settings.bankroll} onRemoveMatch={removeMatch} onSaveToHistory={saveToHistory} />}
          {view === 'upcoming' && <Upcoming onAnalyze={addMatch} />}
          {view === 'playerProfile' && <PlayerProfile onBack={() => setView('dashboard')} />}
          {view === 'backtest' && <Backtest />}
          {view === 'history' && <History history={history} onUpdateOutcome={updateOutcome} onClear={clearHistory} />}
          {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}
          {view === 'admin' && isAdmin && <AdminPanel />}
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}

export default App;