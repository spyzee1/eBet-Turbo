import { useState } from 'react';
import logo from '../assets/ebet.png';
import { getSupabaseClient } from '../lib/supabase';

interface Props {
  onLogin: () => void;
}

type Mode = 'login' | 'register' | 'payment' | 'forgot';

function formatCardNumber(v: string) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
}

export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // payment mock state
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardName, setCardName] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (mode === 'register') {
      // go to payment step instead of creating account immediately
      setMode('payment');
      return;
    }

    setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) { setError('Supabase nincs konfigurálva.'); return; }
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) setError(err.message); else onLogin();
    } catch {
      setError('Ismeretlen hiba történt.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Simulate payment processing delay
    await new Promise(r => setTimeout(r, 1500));

    try {
      const sb = await getSupabaseClient();
      if (!sb) { setError('Supabase nincs konfigurálva.'); setLoading(false); return; }
      const { error: err } = await sb.auth.signUp({ email, password });
      if (err) {
        setError(err.message);
        setMode('register');
      } else {
        setInfo('Regisztráció sikeres! Ellenőrizd az e-mail postaládádat a megerősítő linkért.');
        setMode('login');
        setCardNumber(''); setExpiry(''); setCvv(''); setCardName('');
      }
    } catch {
      setError('Ismeretlen hiba történt.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) { setError('Supabase nincs konfigurálva.'); return; }
      const siteUrl = window.location.origin;
      await sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/` });
      setInfo('Jelszó-visszaállító e-mail elküldve! Ellenőrizd a postaládádat.');
    } catch { setError('Ismeretlen hiba történt.'); }
    finally { setLoading(false); }
  };

  const switchMode = (m: 'login' | 'register') => {
    setMode(m); setError(''); setInfo('');
  };

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={logo} alt="eBet-Turbo" className="h-16 w-auto" />
        </div>

        <div className="bg-dark-card border border-dark-border rounded-2xl p-8 shadow-xl">

          {/* ── Forgot password ── */}
          {mode === 'forgot' && (
            <>
              <button onClick={() => { setMode('login'); setError(''); setInfo(''); }}
                className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-5 transition cursor-pointer">
                ← Vissza
              </button>
              <h1 className="text-white text-xl font-semibold mb-2 text-center">Elfelejtett jelszó</h1>
              <p className="text-slate-400 text-sm text-center mb-6">Add meg az e-mail címedet és küldünk egy visszaállító linket.</p>
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">E-mail</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                    placeholder="nev@email.com" />
                </div>
                {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
                {info && <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">{info}</p>}
                <button type="submit" disabled={loading || !!info}
                  className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white font-semibold transition cursor-pointer">
                  {loading ? 'Küldés...' : 'Link küldése'}
                </button>
              </form>
            </>
          )}

          {/* ── Login / Register form ── */}
          {mode !== 'payment' && mode !== 'forgot' && (
            <>
              <h1 className="text-white text-xl font-semibold mb-6 text-center">
                {mode === 'login' ? 'Bejelentkezés' : 'Regisztráció'}
              </h1>

              <form onSubmit={handleAuth} className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                    placeholder="nev@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">Jelszó</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}
                {info && (
                  <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">{info}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white font-semibold transition cursor-pointer"
                >
                  {loading ? 'Betöltés...' : mode === 'login' ? 'Bejelentkezés' : 'Tovább a fizetéshez →'}
                </button>
              </form>

              <p className="text-center text-slate-500 text-sm mt-6">
                {mode === 'login' ? 'Nincs még fiókod?' : 'Már van fiókod?'}{' '}
                <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                  className="text-orange-400 hover:text-orange-300 transition cursor-pointer">
                  {mode === 'login' ? 'Regisztrálj' : 'Jelentkezz be'}
                </button>
              </p>
              {mode === 'login' && (
                <p className="text-center mt-2">
                  <button onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}
                    className="text-slate-500 hover:text-slate-400 text-sm transition cursor-pointer">
                    Elfelejtett jelszó?
                  </button>
                </p>
              )}
            </>
          )}

          {/* ── Payment mock ── */}
          {mode === 'payment' && (
            <>
              <button
                onClick={() => { setMode('register'); setError(''); }}
                className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-5 transition cursor-pointer"
              >
                ← Vissza
              </button>

              <h1 className="text-white text-xl font-semibold mb-1 text-center">Előfizetés</h1>
              <p className="text-slate-400 text-sm text-center mb-6">Havi <span className="text-orange-400 font-semibold">9,99 €</span> — bármikor lemondható</p>

              {/* Card preview */}
              <div className="rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 p-4 mb-5 relative overflow-hidden">
                <div className="flex justify-between items-start mb-6">
                  <span className="text-slate-300 text-xs font-medium tracking-widest uppercase">eBet Pro</span>
                  <div className="flex gap-1">
                    <div className="w-6 h-6 rounded-full bg-red-500/80" />
                    <div className="w-6 h-6 rounded-full bg-yellow-400/80 -ml-3" />
                  </div>
                </div>
                <p className="text-white font-mono text-sm tracking-widest mb-3">
                  {cardNumber || '•••• •••• •••• ••••'}
                </p>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{cardName || 'NÉV NEVE'}</span>
                  <span>{expiry || 'HH/ÉÉ'}</span>
                </div>
              </div>

              <form onSubmit={handlePayment} className="space-y-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Kártyaszám</label>
                  <input
                    value={cardNumber}
                    onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                    required
                    inputMode="numeric"
                    placeholder="1234 5678 9012 3456"
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition font-mono tracking-wider"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">Kártyabirtokos neve</label>
                  <input
                    value={cardName}
                    onChange={e => setCardName(e.target.value.toUpperCase())}
                    required
                    placeholder="NÉV NEVE"
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition uppercase"
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-slate-400 mb-1">Lejárat</label>
                    <input
                      value={expiry}
                      onChange={e => setExpiry(formatExpiry(e.target.value))}
                      required
                      inputMode="numeric"
                      placeholder="HH/ÉÉ"
                      className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition font-mono"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-sm text-slate-400 mb-1">CVV</label>
                    <input
                      value={cvv}
                      onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      required
                      inputMode="numeric"
                      placeholder="•••"
                      className="w-full px-4 py-2.5 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition font-mono"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white font-semibold transition cursor-pointer mt-1"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Feldolgozás...
                    </span>
                  ) : 'Előfizetés aktiválása'}
                </button>

                <p className="text-center text-slate-600 text-xs mt-1">
                  Biztonságos fizetés · SSL titkosítás
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
