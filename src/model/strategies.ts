import { Settings } from './types';

export interface Strategy {
  id: string;
  name: string;
  description: string;
  settings: Settings;
  kellyEnabled: boolean;
  h2hExpiryDays: number;
  // Strategy C+ optional flags
  requireH2H?: boolean;       // csak H2H adattal rendelkező meccseket mutasson
  minH2HMatches?: number;     // minimum H2H meccsek száma (default: 5)
  formTrendBonus?: boolean;   // form10 vs form50 trendadjusztáció
  fatiguePenalty?: boolean;   // fáradsági büntetés ha sok meccs volt ma
  maxMatchesToday?: number;   // ennyi napi meccs felett kizárás
  strongBetConf?: number;     // STRONG_BET konfidencia küszöb (default: 0.80)
  strongBetEdge?: number;     // STRONG_BET edge küszöb (default: 0.08)
  betConf?: number;           // BET konfidencia küszöb (default: 0.65)
  betEdge?: number;           // BET edge küszöb (default: 0.04)
  goalLineDeltaMin?: number;  // min |várható gól - vonal| O/U tipphez
}

export const STRATEGY_A: Strategy = {
  id: 'A',
  name: 'Original Strategy',
  description: 'Eredeti algoritmus – azonos DEFAULT_SETTINGS súlyokkal',
  settings: {
    winRateSuly: 0.35,
    formaSuly: 0.25,
    h2hSuly: 0.15,
    tamadasSuly: 0.15,
    vedekezesSuly: 0.10,
    bankroll: 5000,
    minEdgeWin: 0.04,
    minEdgeOU: 0.05,
    gtTempoFaktor: 1.08,
    eAdriaticTempoFaktor: 0.96,
    alapTempoFaktor: 1.0,
    kellySzorzo: 0.25,
    maxStakePct: 0.03,
  },
  kellyEnabled: false,
  h2hExpiryDays: 365,
};

export const STRATEGY_B: Strategy = {
  id: 'B',
  name: 'Enhanced Strategy 🏆',
  description: 'Módosított algoritmus – nagyobb H2H súly, Kelly Criterion, 6 hónapos H2H cutoff',
  settings: {
    winRateSuly: 0.20,
    formaSuly: 0.25,
    h2hSuly: 0.20,
    tamadasSuly: 0.20,
    vedekezesSuly: 0.15,
    bankroll: 5000,
    minEdgeWin: 0.03,
    minEdgeOU: 0.04,
    gtTempoFaktor: 1.08,
    eAdriaticTempoFaktor: 0.96,
    alapTempoFaktor: 1.0,
    kellySzorzo: 0.25,
    maxStakePct: 0.03,
  },
  kellyEnabled: true,
  h2hExpiryDays: 180,
};

export const STRATEGY_C: Strategy = {
  id: 'C',
  name: 'Smart Filter',
  description: 'Forma-trend + fáradsági faktor + H2H minimum (≥8) + konzervatív Kelly',
  settings: {
    winRateSuly: 0.15,      // alacsonyabb – historikus win rate kevésbé megbízható
    formaSuly:   0.30,      // forma az első: form10 trendadjusztációval
    h2hSuly:     0.30,      // H2H a második: közvetlen egymás elleni előzmények
    tamadasSuly: 0.15,
    vedekezesSuly: 0.10,
    bankroll: 5000,
    minEdgeWin: 0.05,       // szigorúbb win edge
    minEdgeOU:  0.06,       // szigorúbb O/U edge
    gtTempoFaktor: 1.08,
    eAdriaticTempoFaktor: 0.96,
    alapTempoFaktor: 1.0,
    kellySzorzo: 0.15,      // konzervatívabb: 0.25 → 0.15
    maxStakePct: 0.025,
  },
  kellyEnabled: true,
  h2hExpiryDays: 90,        // csak friss 3 hónapos H2H adat számít
  requireH2H: true,         // H2H adat nélkül nem mutat tippet
  minH2HMatches: 8,         // minimum 8 egymás elleni meccs
  formTrendBonus: true,     // form10 vs form50 trendadjusztáció
  fatiguePenalty: true,     // fáradt játékos büntetés
  maxMatchesToday: 3,       // ha 3+ meccset játszott ma → kizárás
  strongBetConf: 0.83,      // szigorúbb STRONG_BET küszöb
  strongBetEdge: 0.10,
  betConf: 0.70,            // szigorúbb BET küszöb
  betEdge: 0.06,
  goalLineDeltaMin: 0.5,    // várható gól legalább 0.5-tel térjen el a vonaltól
};

export const STRATEGIES: Record<string, Strategy> = {
  A: STRATEGY_A,
  B: STRATEGY_B,
  C: STRATEGY_C,
};
