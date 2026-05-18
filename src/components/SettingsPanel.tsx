import { useState, useEffect } from 'react';
import { Settings } from '../model/types';
import { DEFAULT_SETTINGS } from '../model/calculator';
import {
  configureTelegramBot, getTelegramStatus,
  getScannerStatus, triggerScan, ScannerStatus,
} from '../api';
import { startVisiblePolling } from '../hooks/visiblePolling';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const set = (key: keyof Settings, value: number) => {
    onChange({ ...settings, [key]: value });
  };

  const ic = "w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition";
  const lc = "block text-xs text-slate-400 mb-1 font-medium";

  // Telegram + scanner state
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgMsg, setTgMsg] = useState('');
  const [tgLoading, setTgLoading] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);

  useEffect(() => {
    getTelegramStatus().then(s => setTgConfigured(s.configured)).catch(() => {});
    return startVisiblePolling(
      () => getScannerStatus().then(setScannerStatus).catch(() => {}),
      30000,
    );
  }, []);

  const handleTgConfigure = async () => {
    if (!tgToken.trim() || !tgChatId.trim()) {
      setTgMsg('Add meg mindkét értéket!');
      return;
    }
    setTgLoading(true);
    setTgMsg('');
    try {
      const r = await configureTelegramBot(tgToken.trim(), tgChatId.trim());
      setTgConfigured(r.configured);
      setTgMsg(r.testMessageSent ? '✓ Konfigurálva. Teszt üzenet elküldve!' : '⚠ Konfigurálva, de a teszt üzenet nem ment.');
      setTgToken('');
    } catch {
      setTgMsg('✗ Sikertelen konfigurálás. Ellenőrizd a bot tokent.');
    } finally {
      setTgLoading(false);
    }
  };

  const handleManualScan = async () => {
    setTgMsg('Scan elindítva...');
    try {
      const r = await triggerScan();
      setTgMsg(`✓ Scan kész: ${r.tipsFound} tipp`);
      const s = await getScannerStatus();
      setScannerStatus(s);
    } catch {
      setTgMsg('✗ Scan sikertelen');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Súlyok (Általános liga)</h2>
          <button onClick={() => onChange(DEFAULT_SETTINGS)} className="text-xs text-accent hover:text-accent-light cursor-pointer">Alapérték</button>
        </div>
        <p className="text-xs text-slate-500 mb-4">GT Leagues és eAdriaticLeague saját profilokat használ, ezek csak egyéb ligákhoz.</p>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lc}>Win Rate súly</label><input type="number" step="0.05" value={settings.winRateSuly} onChange={e => set('winRateSuly', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Forma súly</label><input type="number" step="0.05" value={settings.formaSuly} onChange={e => set('formaSuly', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>H2H súly</label><input type="number" step="0.05" value={settings.h2hSuly} onChange={e => set('h2hSuly', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Támadás súly</label><input type="number" step="0.05" value={settings.tamadasSuly} onChange={e => set('tamadasSuly', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Védekezés súly</label><input type="number" step="0.05" value={settings.vedekezesSuly} onChange={e => set('vedekezesSuly', +e.target.value)} className={ic} /></div>
        </div>
      </div>

      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Küszöbértékek</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lc}>Min edge (Win tipp)</label><input type="number" step="0.01" value={settings.minEdgeWin} onChange={e => set('minEdgeWin', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Min edge (O/U tipp)</label><input type="number" step="0.01" value={settings.minEdgeOU} onChange={e => set('minEdgeOU', +e.target.value)} className={ic} /></div>
        </div>
      </div>

      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Tempo faktorok</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={lc}>GT Leagues (12p)</label><input type="number" step="0.01" value={settings.gtTempoFaktor} onChange={e => set('gtTempoFaktor', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>eAdriatic (10p)</label><input type="number" step="0.01" value={settings.eAdriaticTempoFaktor} onChange={e => set('eAdriaticTempoFaktor', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Alap</label><input type="number" step="0.01" value={settings.alapTempoFaktor} onChange={e => set('alapTempoFaktor', +e.target.value)} className={ic} /></div>
        </div>
      </div>

      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Bankroll & Kelly</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={lc}>Bankroll (Ft)</label><input type="number" step="100" value={settings.bankroll} onChange={e => set('bankroll', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Kelly szorzó</label><input type="number" step="0.05" value={settings.kellySzorzo} onChange={e => set('kellySzorzo', +e.target.value)} className={ic} /></div>
          <div><label className={lc}>Max stake %</label><input type="number" step="0.01" value={settings.maxStakePct} onChange={e => set('maxStakePct', +e.target.value)} className={ic} /></div>
        </div>
      </div>

      {/* Telegram + Scanner */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-white">Telegram értesítések</h2>
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${tgConfigured ? 'bg-green/20 text-green' : 'bg-slate-600/30 text-slate-400'}`}>
            {tgConfigured ? '● Aktív' : '○ Nincs konfigurálva'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Push értesítés új STRONG BET tippekre. 15 percenként automatikusan scannel.
        </p>

        {!tgConfigured && (
          <div className="bg-dark-bg/50 border border-dark-border rounded-lg p-3 mb-4 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Beállítás:</p>
            <p>1. Telegramban írj a <span className="text-accent-light">@BotFather</span>-nek: <code className="text-accent">/newbot</code></p>
            <p>2. Add meg a bot nevét, kapsz egy <span className="text-accent-light">bot tokent</span></p>
            <p>3. Indítsd el a botod (küldj neki <code className="text-accent">/start</code>)</p>
            <p>4. Nyisd meg ezt: <span className="text-accent-light">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span> — keresd meg a <code className="text-accent">"chat":&#123;"id":12345&#125;</code> részt</p>
            <p>5. Másold be a tokent és a chat ID-t alább</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lc}>Bot Token</label>
            <input
              type="password" value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder={tgConfigured ? '••••••••' : '1234567890:AAFm...'}
              className={ic}
            />
          </div>
          <div>
            <label className={lc}>Chat ID</label>
            <input
              type="text" value={tgChatId}
              onChange={e => setTgChatId(e.target.value)}
              placeholder="123456789"
              className={ic}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleTgConfigure}
            disabled={tgLoading}
            className="bg-accent/20 text-accent-light hover:bg-accent/30 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {tgLoading ? 'Konfigurálás...' : tgConfigured ? 'Új token mentése' : 'Konfigurálás + teszt'}
          </button>
          <button
            onClick={handleManualScan}
            className="bg-purple/20 text-purple hover:bg-purple/30 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer"
          >
            Scan futtatása
          </button>
          {tgMsg && <span className="text-xs text-slate-400">{tgMsg}</span>}
        </div>

        {scannerStatus && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-dark-bg/50 rounded p-2">
              <p className="text-slate-500">Scanner</p>
              <p className={`font-semibold ${scannerStatus.isRunning ? 'text-green' : 'text-slate-400'}`}>
                {scannerStatus.isRunning ? '● Fut' : '○ Áll'}
              </p>
            </div>
            <div className="bg-dark-bg/50 rounded p-2">
              <p className="text-slate-500">Cache</p>
              <p className="text-white font-semibold">{scannerStatus.cachedTipCount} tipp</p>
            </div>
            <div className="bg-dark-bg/50 rounded p-2">
              <p className="text-slate-500">Push-olt</p>
              <p className="text-white font-semibold">{scannerStatus.pushedCount}</p>
            </div>
            <div className="bg-dark-bg/50 rounded p-2">
              <p className="text-slate-500">Utolsó scan</p>
              <p className="text-white font-semibold">
                {scannerStatus.lastRunISO
                  ? new Date(scannerStatus.lastRunISO).toLocaleTimeString('hu-HU')
                  : '—'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Liga profilok (fix)</h2>
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-green/5 border border-green/20 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-green mb-2">GT Leagues</h3>
            <p className="text-xs text-slate-400 leading-relaxed">Gól / Over-Under fókusz<br/>WR: 25%, Forma: 15%, H2H: 10%, Atk: 30%, Def: 20%<br/>O/U érzékenység: 0.22 | Min win edge: 6%</p>
          </div>
          <div className="bg-purple/5 border border-purple/20 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-purple mb-2">eAdriaticLeague</h3>
            <p className="text-xs text-slate-400 leading-relaxed">Win + forma fókusz<br/>WR: 40%, Forma: 30%, H2H: 20%, Atk: 5%, Def: 5%<br/>O/U érzékenység: 0.15 | Min win edge: 5%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
