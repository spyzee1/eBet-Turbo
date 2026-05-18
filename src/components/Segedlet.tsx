export default function Segedlet() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">

      {/* Fejléc */}
      <div>
        <h1 className="text-2xl font-bold text-white">📖 Segédlet</h1>
        <p className="text-sm text-slate-400 mt-1">Útmutató az eBet-Turbo használatához</p>
      </div>

      {/* Telepítés */}
      <Section title="⚙️ Telepítés és indítás">
        <Step n={1} title="Node.js telepítése">
          Töltsd le és telepítsd a Node.js LTS verzióját:{' '}
          <a href="https://nodejs.org" target="_blank" rel="noreferrer"
            className="text-cyan-400 underline hover:text-cyan-300">nodejs.org</a>
          {' '}— a telepítő automatikusan hozzáadja a PATH-hoz.
        </Step>
        <Step n={2} title="Indítás — start.bat">
          A projekt gyökérkönyvtárában lévő <Code>start.bat</Code> fájlra duplán kattintva az alkalmazás automatikusan elindul:
          <ul className="mt-2 space-y-1 text-slate-300 text-sm list-disc list-inside">
            <li>Leállítja az esetleg már futó folyamatokat (3005, 5180 portok)</li>
            <li>Elindítja a Node.js szervert (<Code>npm run server</Code>) egy külön ablakban</li>
            <li>5 másodperc után megnyitja a böngészőt: <Code>http://localhost:5180</Code></li>
            <li>Elindítja a Vite frontend-et az aktuális ablakban</li>
          </ul>
        </Step>
        <Step n={3} title="Leállítás">
          Az indító ablakban nyomj <Code>CTRL+C</Code>-t, majd zárd be az <Code>eBet-Szerver</Code> ablakot is.
        </Step>
      </Section>

      {/* Stratégiák */}
      <Section title="🎯 Fogadási stratégiák (A / B / C)">
        <p className="text-sm text-slate-400 mb-4">
          A stratégiát a Kezdőlapon a szűrőknél lehet váltani. Mindhárom ugyanazt a Poisson + ELO + H2H modellt használja,
          de eltérő küszöbértékekkel szűri a tippeket.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StratCard
            letter="A"
            color="text-green"
            border="border-green/40"
            bg="bg-green/5"
            title="Original"
            weights={{ wr: 35, forma: 25, h2h: 15, atk: 15, def: 10 }}
            params={[
              'Kelly: kikapcsolt',
              'Min edge (Win): 4% | O/U: 5%',
              'H2H adatok: 365 nap',
              'Több tipp, klassszikus súlyok',
            ]}
          />
          <StratCard
            letter="B"
            color="text-yellow"
            border="border-yellow/40"
            bg="bg-yellow/5"
            title="Enhanced 🏆"
            weights={{ wr: 20, forma: 25, h2h: 20, atk: 20, def: 15 }}
            params={[
              'Kelly: bekapcsolt (0.25×)',
              'Min edge (Win): 3% | O/U: 4%',
              'H2H adatok: 180 nap',
              'Alapértelmezett — ajánlott',
            ]}
          />
          <StratCard
            letter="C"
            color="text-orange-400"
            border="border-orange-500/40"
            bg="bg-orange-500/5"
            title="Smart Filter"
            weights={{ wr: 15, forma: 30, h2h: 30, atk: 15, def: 10 }}
            params={[
              'Kelly: bekapcsolt (0.15× — konzervatív)',
              'Min edge (Win): 5% | O/U: 6%',
              'H2H adatok: 90 nap, min. 8 meccs',
              'Forma-trend + fáradsági faktor',
            ]}
          />
        </div>
      </Section>

      {/* Intraday Trend */}
      <Section title="🔥 Intraday Trend Bot">
        <p className="text-sm text-slate-400 mb-4">
          Az Intraday Trend Bot ugyanazon két játékos aznapi egymás elleni meccseinek gólsorozatát vizsgálja,
          és akkor jelez, ha a könyvmáros vonala elavult a tényleges teljesítményhez képest.
          A jelzések a meccs ideje alatt is aktívak maradnak.
        </p>

        {/* Liga és forrás választó */}
        <div className="mb-4 bg-dark-bg/40 border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">Liga és O/U forrás választó</p>
          <div className="space-y-2 text-sm text-slate-300">
            <p>🏆 <strong>Ligák</strong> — szabadon választható: <span className="text-green font-semibold">GT Leagues</span>, <span className="text-sky-400 font-semibold">eAdriatic League</span>, <span className="text-orange-400 font-semibold">H2H GG</span>, <span className="text-yellow font-semibold">Battle</span>, <span className="text-cyan-400 font-semibold">Volta</span></p>
            <p>📊 <strong>O/U forrás</strong> — három forrás közül választható: <span className="text-sky-400 font-semibold">msport</span>, <span className="text-orange-400 font-semibold">Cloudbet</span>, <span className="text-green font-semibold">Vegas</span>, vagy Mind (automatikus legjobb)</p>
            <p className="text-xs text-slate-500">A kártya bal alsó sarkában a kiválasztott forrás neve és vonala látható, mellette szürke számként a többi elérhető forrás adata is megjelenik.</p>
          </div>
        </div>

        {/* VALUE és TREND alaptípusok */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border-l-4 p-4" style={{ borderColor: '#facc15', background: 'rgba(250,204,21,0.05)' }}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ backgroundColor: '#facc15', color: '#111827' }} className="px-2 py-0.5 rounded text-xs font-black">💰 VALUE</span>
              <span className="text-xs text-slate-400">Erős Value jelzés</span>
            </div>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li>✅ Minimum <strong>4 aznapi H2H meccs</strong> ugyanazon pár között</li>
              <li>✅ A meccsek legalább <strong>70%-a a vonal felett</strong> zárult</li>
              <li>✅ Érvényes O/U vonal (msport / Cloudbet / Vegas)</li>
              <li>✅ Meccs max <strong>30 perccel</strong> később kezdődik, vagy épp zajlik</li>
            </ul>
            <p className="text-xs text-slate-500 mt-3">
              A könyvmáros nem emelte a vonalat annak ellenére, hogy a pár rendszeresen veri azt.
            </p>
          </div>

          <div className="rounded-xl border-l-4 border-orange-500 p-4" style={{ background: 'rgba(249,115,22,0.05)' }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded text-xs font-black bg-orange-500 text-white">🚀 TREND</span>
              <span className="text-xs text-slate-400">Emelkedő trend jelzés</span>
            </div>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li>✅ Minimum <strong>4 aznapi H2H meccs</strong></li>
              <li>✅ <strong>Határozott emelkedő trend</strong> (pozitív lineáris regresszió)</li>
              <li>✅ Az <strong>utolsó 2 meccs</strong> mindkettő a vonal felett zárult</li>
              <li>✅ Érvényes O/U vonal (msport / Cloudbet / Vegas)</li>
              <li>✅ Meccs max <strong>30 perccel</strong> később kezdődik, vagy épp zajlik</li>
            </ul>
            <p className="text-xs text-slate-500 mt-3">
              A pár egyre több gólt produkál — a legfrissebb eredmények mind a vonal felett vannak.
            </p>
          </div>
        </div>

        {/* Speciális keretek */}
        <div className="mb-4 bg-dark-bg/40 border border-dark-border rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">Speciális kártyakeret jelzések</p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-6 rounded shrink-0 mt-0.5" style={{ boxShadow: 'inset 0 0 0 2px rgb(253,224,71), 0 0 10px rgba(253,224,71,0.4)', background: 'rgba(253,224,71,0.06)' }} />
              <div>
                <p className="text-sm font-semibold text-yellow-300">💰 VALUE — 100% (citromsárga teljes keret)</p>
                <p className="text-xs text-slate-400">Minden mai meccs a vonal felett zárt — a legbiztosabb VALUE jelzés.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-6 rounded shrink-0 mt-0.5" style={{ boxShadow: 'inset 0 0 0 2px rgb(251,146,60), 0 0 10px rgba(249,115,22,0.4)', background: 'rgba(249,115,22,0.06)' }} />
              <div>
                <p className="text-sm font-semibold text-orange-300">🚀 TREND — Utolsó 3 felett (narancssárga teljes keret)</p>
                <p className="text-xs text-slate-400">Az utolsó 3 meccs mindegyike a megjelenített vonal felett zárt — erős momentum.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex gap-1 shrink-0 mt-0.5">
                <span className="text-yellow-300 font-black text-sm animate-pulse">💰</span>
                <span className="text-orange-400 font-black text-sm animate-pulse">🚀</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">SUPER VALUE / SUPER TREND (pulzáló badge)</p>
                <p className="text-xs text-slate-400">A mai, tegnapi <strong>és</strong> tegnapelőtti gólátlag is a vonal felett van — háromnapos megerősített jelzés. A badge pulzál és a kártya erőteljesebb hátteret kap.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Hogyan használd */}
        <div className="bg-dark-bg/50 border border-dark-border rounded-xl p-4 text-sm text-slate-300 space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Hogyan használd</p>
          <p>🟩 <strong>Zöld pipa</strong> — Bejegyzi a meccset a Mérkőzés Listába és a Fogadási Naplóba <em>(ajánlott fogadás)</em>. Kivétel: a pipa újra kattintásával eltűnik a listából is.</p>
          <p>🟥 <strong>Piros X</strong> — Kihagyod, elrejted a jelzést</p>
          <p>🔔 Ha <strong>új jelzés</strong> jelenik meg a legutóbbi scan óta, <strong>hangjelzés</strong> szól</p>
          <p>⏱ A scanner <strong>10 percenként</strong> automatikusan fut, vagy manuálisan is elindítható a Scan gombbal</p>
          <p>📍 A jelzések a meccs <strong>teljes időtartama alatt</strong> láthatók maradnak (GT: 12 perc, eAdriatic: 10 perc)</p>
        </div>
      </Section>

      {/* Mérkőzés kártyák */}
      <Section title="📊 Mérkőzés kártyák — jelzések">
        <div className="space-y-3 text-sm text-slate-300">
          <Row color="border-blue-500" label="Kék keret" text="Erős Gól value — a várható gól és az O/U vonal különbsége ≥ 1,5" />
          <Row color="border-green" label="Zöld keret" text="Gól value — a várható gól és az O/U vonal különbsége ≥ 0,6" />
          <Row color="border-yellow-500" label="Sárga keret" text="Magas győzelmi esély (H2H + forma alapján)" />
          <Row color="border-red-600" label="Bordó keret" text="Intraday Trend Botból jelölt meccs — halvány háttér jelzi, hogy már bejegyezted" />
          <Row color="border-slate-600" label="Nincs keret" text="Standard meccs, nincs kiemelt jelzés" />
        </div>
        <div className="mt-4 bg-dark-bg/50 border border-dark-border rounded-xl p-4 text-sm text-slate-300 space-y-1.5">
          <p><span className="text-green font-bold">STRONG_BET</span> — Mindkét modell (H2H + Poisson) egyértelműen egyezik, magas edge</p>
          <p><span className="text-yellow font-bold">BET</span> — Közepes konfidencia, de pozitív várható érték</p>
          <p><span className="text-slate-400 font-bold">NO_BET</span> — Modell nem javasol fogadást ennél a meccsnél</p>
        </div>
      </Section>

      {/* Fogadási Napló */}
      <Section title="📖 Fogadási Napló és Statisztika">
        <div className="space-y-2 text-sm text-slate-300">
          <p>A <strong>Mérkőzés Listában</strong> pipált meccsek automatikusan bekerülnek a Fogadási Naplóba is.</p>
          <p>Az eredmény (Win/Loss) manuálisan vagy — ha a meccs Live-ban megjelenik — <strong>automatikusan</strong> rögzítésre kerül.</p>
          <p>Az <strong>Odds</strong> mezőt mindig töltsd ki manuálisan a Vegas.hu-ról, mert a kalkulált profit ezen alapul.</p>
          <p>A <strong>Statisztika</strong> oldalon külön szekció mutatja az Intraday Trend Bot hatékonyságát VALUE / TREND bontásban.</p>
          <p>Az <strong>Excel export</strong> gomb az összes naplóbejegyzést és összesített statisztikát exportálja.</p>
        </div>
      </Section>

    </div>
  );
}

// ── Helper komponensek ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-6">
      <h2 className="text-base font-bold text-white mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-4 last:mb-0">
      <div className="w-7 h-7 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{n}</div>
      <div>
        <p className="text-sm font-semibold text-white mb-1">{title}</p>
        <div className="text-sm text-slate-400">{children}</div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-dark-bg border border-dark-border rounded px-1.5 py-0.5 text-xs font-mono text-cyan-300">{children}</code>;
}

interface WeightRow { wr: number; forma: number; h2h: number; atk: number; def: number; }

function StratCard({ letter, color, border, bg, title, weights, params }: {
  letter: string; color: string; border: string; bg: string; title: string;
  weights: WeightRow; params: string[];
}) {
  const rows: { label: string; key: keyof WeightRow; barColor: string }[] = [
    { label: 'Win Rate',  key: 'wr',    barColor: '#3b82f6' },
    { label: 'Forma',     key: 'forma', barColor: '#10b981' },
    { label: 'H2H',       key: 'h2h',   barColor: '#a855f7' },
    { label: 'Támadás',   key: 'atk',   barColor: '#f97316' },
    { label: 'Védekezés', key: 'def',   barColor: '#ef4444' },
  ];
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-2xl font-black ${color}`}>{letter}</span>
        <span className="text-sm font-semibold text-white">{title}</span>
      </div>

      {/* Súlyok progress bar-ral */}
      <div className="space-y-1.5 mb-4">
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-20 shrink-0">{r.label}</span>
            <div className="flex-1 bg-dark-border rounded-full h-2 overflow-hidden">
              <div className="h-2 rounded-full" style={{ width: `${weights[r.key]}%`, backgroundColor: r.barColor }} />
            </div>
            <span className={`text-xs font-bold w-8 text-right ${color}`}>{weights[r.key]}%</span>
          </div>
        ))}
      </div>

      {/* Paraméterek */}
      <div className="border-t border-dark-border/60 pt-3 space-y-1">
        {params.map((p, i) => (
          <p key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
            <span className={`${color} shrink-0`}>›</span>{p}
          </p>
        ))}
      </div>
    </div>
  );
}

function Row({ color, label, text }: { color: string; label: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-3 h-3 rounded-sm border-2 ${color} shrink-0 mt-1`} />
      <div>
        <span className="font-semibold text-white">{label}</span>
        <span className="text-slate-400"> — {text}</span>
      </div>
    </div>
  );
}
