import { useState, useRef, useEffect } from 'react';
import logo from '../assets/ebet.png';
import DigitalClock from './DigitalClock';

type View = 'dashboard' | 'topTips' | 'napiMerkezesek' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings' | 'statistics' | 'segedlet' | 'admin';

interface Props {
  current: View;
  onChange: (v: View) => void;
  userEmail?: string;
  onLogout?: () => void;
  onDeleteAccount?: () => void;
  onEditProfile?: () => void;
  isAdmin?: boolean;
  subscription?: { plan: string; expires_at: string } | null;
}

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'topTips',         label: 'Kezdőlap' },
  { id: 'napiMerkezesek',  label: 'Napi Mérkőzések' },
  { id: 'segedlet',        label: 'Segédlet' },
  { id: 'naplo',           label: 'Fogadási Napló' },
  { id: 'statistics',      label: 'Statisztika' },
];

function avatarLetter(email?: string) {
  return email ? email[0].toUpperCase() : '?';
}

export default function TopNav({ current, onChange, userEmail, onLogout, onDeleteAccount, onEditProfile, isAdmin, subscription }: Props) {
  const subActive = !!subscription && new Date(subscription.expires_at) > new Date();
  const subPlanLabel = subscription?.plan === 'pro' ? 'eBet Pro' : subscription?.plan ?? '';
  const subExpiresLabel = subscription
    ? new Date(subscription.expires_at).toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 bg-dark-card border-b border-dark-border shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-20 gap-4">

          {/* Logo */}
          <div className="flex items-center shrink-0 self-stretch">
            <img src={logo} alt="eBet-Turbo" className="h-full w-auto object-contain" />
          </div>

          {/* Clock — center, hidden on mobile */}
          <div className="flex-1 hidden sm:flex justify-center">
            <DigitalClock />
          </div>
          <div className="flex-1 sm:hidden" />

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 shrink-0">
            {isAdmin && (
              <button
                onClick={() => onChange('admin')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                  current === 'admin'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                    : 'text-slate-500 hover:text-white hover:bg-white/5'
                }`}
              >
                Admin
              </button>
            )}
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                  current === item.id
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Profile avatar + dropdown */}
          {userEmail && (
            <div className="relative shrink-0" ref={dropdownRef}>
              <button
                onClick={() => { setProfileOpen(o => !o); setConfirmDelete(false); }}
                className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-400 text-white font-bold text-sm flex items-center justify-center transition cursor-pointer select-none"
                title={userEmail}
              >
                {avatarLetter(userEmail)}
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-12 w-72 bg-dark-card border border-dark-border rounded-xl shadow-2xl py-2 z-50">
                  {/* Email header */}
                  <div className="px-4 py-3 border-b border-dark-border">
                    <p className="text-xs text-slate-500 mb-0.5">Bejelentkezve</p>
                    <p className="text-sm text-white font-medium truncate">{userEmail}</p>
                  </div>

                  {/* Subscription info */}
                  <div className="px-4 py-3 border-b border-dark-border">
                    {subscription ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium">{subPlanLabel}</p>
                          <p className="text-xs text-slate-400 truncate">Lejár: {subExpiresLabel}</p>
                        </div>
                        {subActive ? (
                          <span className="shrink-0 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-full px-2 py-0.5">Aktív</span>
                        ) : (
                          <span className="shrink-0 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">Lejárt</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Nincs aktív előfizetés</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="py-1">
                    <button
                      onClick={() => { setProfileOpen(false); onEditProfile?.(); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition cursor-pointer flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                      Profil szerkesztése
                    </button>

                    <button
                      onClick={onLogout}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition cursor-pointer flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
                      </svg>
                      Kijelentkezés
                    </button>
                  </div>

                  {/* Danger zone */}
                  <div className="border-t border-dark-border pt-1">
                    {!confirmDelete ? (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 transition cursor-pointer flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                        Fiók törlése
                      </button>
                    ) : (
                      <div className="px-4 py-3">
                        <p className="text-xs text-red-400 mb-2">Biztosan törlöd a fiókodat? Ez nem visszavonható.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { onDeleteAccount?.(); setProfileOpen(false); setConfirmDelete(false); }}
                            className="flex-1 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white text-xs font-semibold transition cursor-pointer"
                          >
                            Igen, törlés
                          </button>
                          <button
                            onClick={() => setConfirmDelete(false)}
                            className="flex-1 py-1.5 rounded-lg bg-dark-bg hover:bg-white/5 text-slate-300 text-xs font-semibold transition cursor-pointer"
                          >
                            Mégse
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-dark-border bg-dark-card px-4 pb-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => { onChange(item.id); setMobileOpen(false); }}
                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                  current === item.id
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
            {userEmail && (
              <button
                onClick={() => { onLogout?.(); setMobileOpen(false); }}
                className="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
              >
                Kijelentkezés
              </button>
            )}
          </div>
        )}
      </header>
    </>
  );
}
