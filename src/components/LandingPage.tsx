import { useState } from 'react';
import logo from '../assets/ebet.png';
import LoginPage from './LoginPage';

interface Props {
  onLogin: () => void;
}

const FEATURES = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    ),
    title: 'Három stratégia, egy rendszer',
    desc: 'Az A/B/C stratégiák különböző kockázati profilt képviselnek. A Kelly-kritérium alapú tétméretezés automatikusan igazodik a bankrollhoz és a kalkulált előnyhöz.',
    accent: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    title: 'Akkumulált adatalapú döntéshozatal',
    desc: 'A szerver folyamatosan gyűjti és tárolja a lezárt meccsek eredményeit — böngészőlátogatástól függetlenül. A 3 napos gördülő buffer valós kimenetelekkel táplálja az elemzést.',
    accent: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
    title: 'Value Bet detektálás',
    desc: 'Edge és confidence score alapján csak a statisztikailag szignifikáns előnyök jelennek meg. Szűri a zajt, kiemel a valóban értékes tippeket — STRONG BET / BET / NO BET besorolással.',
    accent: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
      </svg>
    ),
    title: 'H2H & Forma elemzés',
    desc: 'Részletes head-to-head statisztikák, góltrendek, forma grafikonok. Az elemző rendszer súlyozottan vizsgálja a közelmúlt teljesítményét és a közvetlen meccs-előzményeket.',
    accent: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: 'Fogadási napló & ROI',
    desc: 'Minden tipp nyomon követhető: rögzítsd a téteket, az eredmény automatikusan ellenőrzésre kerül. Felhőben tárolt, eszközök között szinkronizált napló ROI statisztikával.',
    accent: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
    ),
    title: 'Telegram értesítők',
    desc: 'Valós idejű push értesítők a nap legjobb value betjeiről. Nem kell folyamatosan az appot figyelni — a rendszer jelez, ha érdemes cselekedni.',
    accent: 'text-cyan-400',
    bg: 'bg-cyan-500/10 border-cyan-500/20',
  },
];

const STEPS = [
  { n: '1', title: 'Regisztrálj', desc: 'Hozz létre fiókot és aktiváld az előfizetésedet.' },
  { n: '2', title: 'Az elemző dolgozik', desc: 'A szerver automatikusan gyűjti az adatokat és naponta generálja a legjobb tippeket.' },
  { n: '3', title: 'Kövesd a jelzéseket', desc: 'Nyisd meg a Kezdőlapot, ellenőrizd a value beteket, és vezess fogadási naplót az eredmények nyomon követéséhez.' },
];

export default function LandingPage({ onLogin }: Props) {
  const [showLogin, setShowLogin] = useState(false);

  if (showLogin) {
    return <LoginPage onLogin={onLogin} />;
  }

  return (
    <div className="min-h-screen bg-dark-bg text-white">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 bg-dark-bg/80 backdrop-blur-md border-b border-dark-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <img src={logo} alt="eBet-Turbo" className="h-10 w-auto" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition cursor-pointer"
            >
              Bejelentkezés
            </button>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold transition cursor-pointer"
            >
              Regisztráció
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden py-24 px-6">
        {/* background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-orange-500/8 rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            eSport fogadási elemző rendszer
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            Adatvezérelt döntések
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">
              minden fogadáshoz
            </span>
          </h1>

          <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Az eBet-Turbo folyamatosan elemzi az eSport meccseket, akkumulált eredményekkel táplálja a modelleket, és csak a valóban értékes value beteket mutatja meg.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => setShowLogin(true)}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-base transition cursor-pointer shadow-lg shadow-orange-500/20"
            >
              Kezdj el most — 9,99 €/hó
            </button>
            <button
              onClick={() => setShowLogin(true)}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-dark-border hover:border-slate-500 text-slate-300 hover:text-white font-semibold text-base transition cursor-pointer"
            >
              Bejelentkezés
            </button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">Minden, ami a profithoz kell</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Nem tipster szolgáltatás — egy komplex elemző rendszer, ami az adatok alapján dolgozik, nem megérzések alapján.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className={`rounded-2xl border p-6 ${f.bg} transition hover:scale-[1.01]`}>
                <div className={`${f.accent} mb-4`}>{f.icon}</div>
                <h3 className="text-white font-semibold text-base mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20 px-6 border-t border-dark-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">Hogyan működik?</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(s => (
              <div key={s.n} className="text-center">
                <div className="w-12 h-12 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-bold text-lg flex items-center justify-center mx-auto mb-4">
                  {s.n}
                </div>
                <h3 className="text-white font-semibold mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-20 px-6 border-t border-dark-border">
        <div className="max-w-sm mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3">Egy terv, minden funkció</h2>
          <p className="text-slate-400 mb-10">Bármikor lemondható, nincs rejtett díj.</p>

          <div className="bg-dark-card border border-orange-500/30 rounded-2xl p-8 shadow-xl shadow-orange-500/5">
            <p className="text-orange-400 font-semibold text-sm mb-2 uppercase tracking-wider">eBet Pro</p>
            <div className="flex items-end justify-center gap-1 mb-6">
              <span className="text-5xl font-bold text-white">9,99</span>
              <span className="text-slate-400 mb-2">€ / hó</span>
            </div>
            <ul className="space-y-3 text-sm text-slate-300 text-left mb-8">
              {[
                'Napi value bet lista (A/B/C stratégia)',
                'Akkumulált adat alapú elemzés',
                'H2H & forma statisztikák',
                'Fogadási napló felhőszinkronnal',
                'Automatikus eredményellenőrzés',
                'Telegram push értesítők',
                'Korlátlan hozzáférés',
              ].map(item => (
                <li key={item} className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowLogin(true)}
              className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold transition cursor-pointer shadow-lg shadow-orange-500/20"
            >
              Előfizetés indítása
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="py-20 px-6 border-t border-dark-border text-center">
        <h2 className="text-3xl font-bold mb-4">Készen állsz?</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">Csatlakozz és kezdd el az adatvezérelt fogadást még ma.</p>
        <button
          onClick={() => setShowLogin(true)}
          className="px-10 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-base transition cursor-pointer shadow-lg shadow-orange-500/20"
        >
          Regisztrálok
        </button>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-dark-border py-8 px-6 text-center text-slate-600 text-sm">
        © 2026 eBet-Turbo · Minden jog fenntartva
      </footer>
    </div>
  );
}
