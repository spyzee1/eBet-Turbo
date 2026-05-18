import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

// Initialized lazily via initDb() so .env is loaded first by index.ts
export let supabase: SupabaseClient | null = null;

export function initDb(): void {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? '';
  if (!url || !key) {
    console.warn('[db] ⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY hiányzik — fájl-alapú fallback aktív');
    return;
  }
  // Node.js 20 alatt natív WebSocket nincs — a 'ws' csomagot KÖTELEZŐ transport-ként
  // megadni, különben a SupabaseClient inicializációkor crash (spyzee1 13:06 UTC
  // commit Railway crash-t okozott emiatt). A szerver SOHA nem subscribe-ol
  // channel-re (grep .channel/.subscribe a server/ alatt → 0 találat), így a
  // WebSocket kapcsolat sosem nyílik meg ténylegesen — nincs egress innen.
  // A disconnect() extra biztonság — megakadályoz minden heartbeat / auto-connect próbát.
  supabase = createClient(url, key, { realtime: { transport: ws as any } });
  try { (supabase as any).realtime?.disconnect(); } catch { /* ignore */ }
  console.log('[db] Supabase REST kapcsolat inicializálva ✅ (Realtime WS kikapcsolva)');
}

// ── Journal ───────────────────────────────────────────────────────────────────

export async function loadJournal(userId?: string): Promise<any[]> {
  if (!supabase || !userId) return [];
  try {
    const { data, error } = await supabase
      .from('journals')
      .select('entries')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.entries as any[]) ?? [];
  } catch (e) {
    console.error('[db] loadJournal hiba:', e);
    return [];
  }
}

export async function loadSettings(userId?: string): Promise<Record<string, any> | null> {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.settings as Record<string, any>) ?? null;
  } catch (e) {
    console.error('[db] loadSettings hiba:', e);
    return null;
  }
}

export async function saveSettings(userId: string | undefined, settings: Record<string, any>): Promise<void> {
  if (!supabase || !userId) return;
  try {
    await supabase
      .from('user_settings')
      .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('[db] saveSettings hiba:', e);
  }
}

// ── Checked matches ───────────────────────────────────────────────────────────

export async function loadCheckedMatches(userId?: string): Promise<any[]> {
  if (!supabase || !userId) return [];
  try {
    const { data, error } = await supabase
      .from('user_checked_matches').select('entries').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.entries as any[]) ?? [];
  } catch (e) { console.error('[db] loadCheckedMatches hiba:', e); return []; }
}

export async function saveCheckedMatchesDb(userId: string | undefined, entries: any[]): Promise<void> {
  if (!supabase || !userId) return;
  try {
    await supabase.from('user_checked_matches')
      .upsert({ user_id: userId, entries, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) { console.error('[db] saveCheckedMatches hiba:', e); }
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export async function getSubscription(userId: string): Promise<{ plan: string; expires_at: string } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('subscriptions').select('plan,expires_at').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ?? null;
  } catch (e) { console.error('[db] getSubscription hiba:', e); return null; }
}

export async function upsertSubscription(userId: string, days: number): Promise<void> {
  if (!supabase) return;
  try {
    const existing = await getSubscription(userId);
    const base = existing && new Date(existing.expires_at) > new Date()
      ? new Date(existing.expires_at)
      : new Date();
    base.setDate(base.getDate() + days);
    await supabase.from('subscriptions')
      .upsert({ user_id: userId, plan: 'pro', expires_at: base.toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) { console.error('[db] upsertSubscription hiba:', e); }
}

export async function revokeSubscription(userId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('subscriptions').delete().eq('user_id', userId);
  } catch (e) { console.error('[db] revokeSubscription hiba:', e); }
}

export async function saveJournalDb(userId: string | undefined, entries: any[]): Promise<void> {
  if (!supabase || !userId) return;
  try {
    await supabase
      .from('journals')
      .upsert({ user_id: userId, entries, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('[db] saveJournalDb hiba:', e);
  }
}

// ── Completed Matches — H2H forrás ───────────────────────────────────────────

/** H2H meccsek lekérése két játékos között (mindkét irányban) */
export async function getH2HFromSupabase(
  playerA: string,
  playerB: string,
  league: string,
  limit = 40,
): Promise<Array<{
  date: string;
  goalsA: number;
  goalsB: number;
  winner: 'A' | 'B' | 'draw';
  startTime: number;
}>> {
  if (!supabase) return [];
  try {
    const pA = playerA.toLowerCase().trim();
    const pB = playerB.toLowerCase().trim();
    const { data, error } = await supabase
      .from('completed_matches')
      .select('player_a,player_b,score_a,score_b,date,start_time')
      .eq('league', league)
      .or(`and(player_a.eq.${pA},player_b.eq.${pB}),and(player_a.eq.${pB},player_b.eq.${pA})`)
      .order('start_time', { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (!data || data.length === 0) return [];
    return data.map(row => {
      // Mindig playerA szemszögéből normalizálva
      const isForward = row.player_a === pA;
      const goalsA = isForward ? row.score_a : row.score_b;
      const goalsB = isForward ? row.score_b : row.score_a;
      const winner: 'A' | 'B' | 'draw' = goalsA > goalsB ? 'A' : goalsA < goalsB ? 'B' : 'draw';
      return { date: row.date, goalsA, goalsB, winner, startTime: row.start_time };
    });
  } catch (e) {
    console.error('[db] getH2HFromSupabase hiba:', e);
    return [];
  }
}

/** Egy játékos utolsó N meccsét adja vissza (egyéni forma elemzéshez) */
export async function getPlayerMatchesFromSupabase(
  playerName: string,
  league: string,
  limit = 20,
): Promise<Array<{
  opponent: string;
  opponentTeam: string;
  team: string;
  scoreHome: number;
  scoreAway: number;
  result: 'win' | 'loss' | 'draw';
  date: string;
}>> {
  if (!supabase) return [];
  try {
    const pName = playerName.toLowerCase().trim();
    const { data, error } = await supabase
      .from('completed_matches')
      .select('player_a,player_b,team_a,team_b,score_a,score_b,date,start_time')
      .eq('league', league)
      .or(`player_a.eq.${pName},player_b.eq.${pName}`)
      .order('start_time', { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (!data || data.length === 0) return [];
    return data.map(row => {
      const isHome = row.player_a === pName;
      const scoreHome = isHome ? row.score_a : row.score_b;
      const scoreAway = isHome ? row.score_b : row.score_a;
      const opponent  = isHome ? row.player_b : row.player_a;
      const opponentTeam = isHome ? (row.team_b ?? '') : (row.team_a ?? '');
      const team         = isHome ? (row.team_a ?? '') : (row.team_b ?? '');
      const result: 'win' | 'loss' | 'draw' =
        scoreHome > scoreAway ? 'win' : scoreHome < scoreAway ? 'loss' : 'draw';
      return { opponent, opponentTeam, team, scoreHome, scoreAway, result, date: row.date };
    });
  } catch (e) {
    console.error('[db] getPlayerMatchesFromSupabase hiba:', e);
    return [];
  }
}
