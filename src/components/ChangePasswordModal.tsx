import { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';

interface Props {
  email: string;
  onClose: () => void;
}

export default function ChangePasswordModal({ email, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('A két jelszó nem egyezik.'); return; }
    if (next.length < 6) { setError('A jelszónak legalább 6 karakter kell.'); return; }

    setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) { setError('Supabase nincs konfigurálva.'); return; }

      // Re-authenticate to verify current password
      const { error: signInErr } = await sb.auth.signInWithPassword({ email, password: current });
      if (signInErr) { setError('A jelenlegi jelszó helytelen.'); return; }

      // Update to new password
      const { error: updateErr } = await sb.auth.updateUser({ password: next });
      if (updateErr) { setError(updateErr.message); return; }

      setSuccess(true);
    } catch {
      setError('Ismeretlen hiba történt.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-dark-card border border-dark-border rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Jelszó módosítása</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-white font-medium mb-1">Jelszó sikeresen módosítva!</p>
            <p className="text-slate-400 text-sm mb-5">Az új jelszóddal tudsz belépni.</p>
            <button onClick={onClose} className="px-6 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold transition cursor-pointer text-sm">
              Bezárás
            </button>
          </div>
        ) : (
          <form onSubmit={handle} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Jelenlegi jelszó</label>
              <input
                type="password"
                value={current}
                onChange={e => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Új jelszó</label>
              <input
                type="password"
                value={next}
                onChange={e => setNext(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Új jelszó megerősítése</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-slate-300 hover:text-white text-sm font-semibold transition cursor-pointer">
                Mégse
              </button>
              <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-semibold transition cursor-pointer">
                {loading ? 'Mentés...' : 'Mentés'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
