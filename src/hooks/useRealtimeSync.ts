import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { saveJournal, saveCheckedMatches } from '../api';

const JOURNAL_KEY = 'betting_journal';
const CHECKED_KEY = 'checked_green_matches';

// ─── Méret limitek (Realtime + DB egress kímélés) ────────────────────────────
// A blob méretét korlátozzuk: csak az utolsó N rekord + utolsó N nap kerül szerverre.
const MAX_ENTRIES = 500;
const MAX_AGE_DAYS = 60;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function pruneEntries<T extends { timestamp?: number; matchId?: string }>(entries: T[]): T[] {
  const now = Date.now();
  // 1) Csak elmúlt MAX_AGE_DAYS nap (ha van timestamp)
  let filtered = entries.filter(e => {
    if (!e?.timestamp) return true; // ha nincs timestamp, megtartjuk
    return now - e.timestamp < MAX_AGE_MS;
  });
  // 2) Limit az utolsó MAX_ENTRIES rekordra (timestamp DESC)
  filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (filtered.length > MAX_ENTRIES) filtered = filtered.slice(0, MAX_ENTRIES);
  return filtered;
}

// Stabil hash a JSON tartalomhoz (idempotencia ellenőrzéshez)
function fastHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

export function useRealtimeSync(authed: boolean) {
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!authed) return;

    getSupabaseClient().then(async sb => {
      if (!sb) return;

      // Saját userId — ezzel filterezzük a Realtime channel-t
      const { data: { session } } = await sb.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      channelRef.current = sb.channel(`user-data-sync-${userId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'journals', filter: `user_id=eq.${userId}` },
          payload => {
            const newEntries = (payload.new as any)?.entries;
            if (!Array.isArray(newEntries)) return;
            const local: any[] = (() => { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch { return []; } })();
            const merged = new Map<string, any>();
            for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
            for (const e of newEntries) if (e?.matchId) merged.set(e.matchId, e);
            const result = Array.from(merged.values());
            localStorage.setItem(JOURNAL_KEY, JSON.stringify(result));
            window.dispatchEvent(new Event('journal-updated'));
          })
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'user_checked_matches', filter: `user_id=eq.${userId}` },
          payload => {
            const newEntries = (payload.new as any)?.entries;
            if (!Array.isArray(newEntries)) return;
            const local: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]'); } catch { return []; } })();
            const merged = new Map<string, any>();
            for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
            for (const e of newEntries) if (e?.matchId) merged.set(e.matchId, e);
            localStorage.setItem(CHECKED_KEY, JSON.stringify(Array.from(merged.values())));
            window.dispatchEvent(new Event('checked-matches-updated'));
          })
        .subscribe();
    });

    return () => { channelRef.current?.unsubscribe(); };
  }, [authed]);
}

// ─── Idempotent + debounced server save ──────────────────────────────────────
// Utolsó push-olt hash-eket eltároljuk: ha nem változott a tartalom, nem küldünk semmit.

let journalSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastJournalHash = '';

export function debouncedSaveJournal(entries: any[], delay = 1500) {
  if (journalSaveTimer) clearTimeout(journalSaveTimer);
  journalSaveTimer = setTimeout(() => {
    const pruned = pruneEntries(entries);
    const json = JSON.stringify(pruned);
    const h = fastHash(json);
    if (h === lastJournalHash) return; // idempotent: skip ha nem változott
    lastJournalHash = h;
    saveJournal(pruned);
  }, delay);
}

let checkedSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckedHash = '';

export function debouncedSaveChecked(entries: any[], delay = 1500) {
  if (checkedSaveTimer) clearTimeout(checkedSaveTimer);
  checkedSaveTimer = setTimeout(() => {
    const pruned = pruneEntries(entries);
    const json = JSON.stringify(pruned);
    const h = fastHash(json);
    if (h === lastCheckedHash) return; // idempotent: skip ha nem változott
    lastCheckedHash = h;
    saveCheckedMatches(pruned);
  }, delay);
}
