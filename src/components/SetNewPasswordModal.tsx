import { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';

interface Props { onClose: () => void; }

export default function SetNewPasswordModal({ onClose }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('A két jelszó nem egyezik.'); return; }
    if (password.length < 6) { setError('Legalább 6 karakter szükséges.'); return; }
    setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) { setError('Supabase nincs konfigurálva.'); return; }
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) { setError(err.message); return; }
      setSuccess(true);
    } catch { setError('Ismeretlen hiba történt.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-dark-card border border-dark-border rounded-2xl shadow-2xl p-6">
        <h2 className="text-white font-semibold text-lg mb-5">Új jelszó beállítása</h2>
        {success ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-white font-medium mb-4">Jelszó sikeresen beállítva!</p>
            <button onClick={onClose} className="px-6 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition cursor-pointer">Tovább</button>
          </div>
        ) : (
          <form onSubmit={handle} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Új jelszó</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition" placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Megerősítés</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition" placeholder="••••••••" />
            </div>
            {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white font-semibold text-sm transition cursor-pointer">
              {loading ? 'Mentés...' : 'Jelszó mentése'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
