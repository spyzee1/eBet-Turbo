import logo from '../assets/ebet.png';

interface Props {
  expiresAt: string | null;
  onLogout: () => void;
}

export default function SubscriptionExpired({ expiresAt, onLogout }: Props) {
  const expiredDate = expiresAt ? new Date(expiresAt).toLocaleDateString('hu-HU') : null;
  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <img src={logo} alt="eBet-Turbo" className="h-16 w-auto opacity-60" />
        </div>
        <div className="bg-dark-card border border-red-500/30 rounded-2xl p-8 shadow-xl">
          <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="text-white text-xl font-semibold mb-2">Lejárt előfizetés</h1>
          {expiredDate && (
            <p className="text-slate-400 text-sm mb-1">Lejárt: <span className="text-slate-300">{expiredDate}</span></p>
          )}
          <p className="text-slate-500 text-sm mb-6">Az előfizetésed lejárt. Az adminisztrátorral vedd fel a kapcsolatot a megújításhoz.</p>
          <button
            onClick={onLogout}
            className="w-full py-2.5 rounded-lg border border-dark-border text-slate-300 hover:text-white hover:bg-white/5 text-sm font-medium transition cursor-pointer"
          >
            Kijelentkezés
          </button>
        </div>
      </div>
    </div>
  );
}
