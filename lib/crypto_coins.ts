/**
 * lib/crypto_coins.ts
 *
 * Single source of truth for the crypto payment addresses and current USD
 * rates used by the upgrade flow. The verification logic (lib/crypto_verify.ts,
 * app/api/leads/route.ts) needs the exact same addresses/rates server-side to
 * check a submitted payment against. Extracted here so both the UI and the
 * backend import the same data — never two copies that could silently drift
 * apart.
 *
 * fix (2026-09-20): previously this stored a fixed `amount` per coin — a
 * one-time target computed for the $19/mo Sovereign price at whatever crypto
 * rates existed the day this was written. Found live, two ways:
 *   1. The upgrade modal still displayed "$19/month equivalent" even though
 *      Sovereign has been $29/mo since the v2 pricing change — the fixed
 *      amounts were never recomputed for the new price.
 *   2. Independent of that, crypto rates move constantly. Back-computing the
 *      implied USD value of each stored `amount` at today's rates showed
 *      wildly inconsistent effective pricing across coins — some coins
 *      (BTC, SOL, LTC) still landed close to the old $19 target, while
 *      others (XRP, TRX, ADA, XLM) had appreciated enough since the table
 *      was written that the same fixed amount is now worth 2-3x the
 *      intended price. A customer paying in BTC would have been verified
 *      (and issued a key) for roughly $18-19 worth against a $29 product;
 *      a customer paying in XRP would have been asked to send ~$60+ worth
 *      for the same $29 product — neither price is one anyone chose on
 *      purpose, and verifyPayment's 95%-of-expected tolerance (see
 *      crypto_verify.ts) would have auto-approved the underpayment.
 * Fixed by storing `rateUsd` (current market price of 1 unit) instead of a
 * frozen target amount, and computing the amount to charge from whichever
 * plan's price at read time — see amountForPrice() below. This still isn't
 * live-fetched, so rateUsd will drift stale again over weeks/months the same
 * way the old table did; it should be refreshed periodically (or replaced
 * with a live price-API call) rather than trusted indefinitely. Rates below
 * are approximate market prices as of 2026-09-20.
 */

import type { CoinId } from './crypto_verify';

export interface CoinConfig {
  id: CoinId;
  name: string;
  symbol: string;
  address: string;
  rateUsd: number;  // approximate current USD price of 1 unit of the coin
  color: string;
  icon: string;
}

export const COINS: CoinConfig[] = [
  { id: 'btc', name: 'Bitcoin',  symbol: 'BTC', address: 'bc1qdkm5g4fz6tw4459k8tufgnc77kc9uczd86gk2c', rateUsd: 94000,  color: '#f7931a', icon: '₿' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', address: '0x4CE01F213526CE52dC4C9A5d21b5641BB85a04ec', rateUsd: 1800,   color: '#627eea', icon: 'Ξ' },
  { id: 'sol', name: 'Solana',   symbol: 'SOL', address: '63mXsqa8YRmwgHKhctSiPS3Z7MBQX734WFKFdiBTTqKf', rateUsd: 148, color: '#9945ff', icon: '◎' },
  { id: 'bnb', name: 'BNB',      symbol: 'BNB', address: '0x4CE01F213526CE52dC4C9A5d21b5641BB85a04ec', rateUsd: 602,   color: '#f3ba2f', icon: 'B' },
  { id: 'xrp', name: 'XRP',      symbol: 'XRP', address: 'rwsQ48AQFJbJ5EtVvA2hDtPKERXEpAg3Q5', rateUsd: 2.19, color: '#00aae4', icon: '✕' },
  { id: 'trx', name: 'TRON',     symbol: 'TRX', address: 'THCGX6jvTE3TAfjQvHtTBCyzkc8MfrFbHg', rateUsd: 0.25, color: '#ef0027', icon: 'T' },
  { id: 'ltc', name: 'Litecoin', symbol: 'LTC', address: 'ltc1qz7vpzu5f9cvhu8hv60jydsl5w3sdd9q28ckvj3', rateUsd: 85, color: '#bfbbbb', icon: 'Ł' },
  { id: 'ada', name: 'Cardano',  symbol: 'ADA', address: 'addr1q9k44as5ugtgk8ug8ydyrs0yu8mw7lfff39lc5pkrrd6yueg9702j3cjrlxeqp3ccdquclhkeklkack7l6rzn5fzvfns0zs4e3', rateUsd: 0.70, color: '#0033ad', icon: '₳' },
  { id: 'ton', name: 'TON',      symbol: 'TON', address: 'UQCJmbOXgq1YBiu4hauFB9C2f4Rv2go80Feq_J2dfIAPibLO', rateUsd: 3.25, color: '#0088cc', icon: '💎' },
  { id: 'xlm', name: 'Stellar',  symbol: 'XLM', address: 'GCYM63PDVO6RDKO3DOEMD25ERRRLCZRRR4D5AJ2UL3H7UMO7LR3MX22C', rateUsd: 0.28, color: '#14b6e7', icon: '*' },
];

export function getCoinConfig(id: string): CoinConfig | undefined {
  return COINS.find(c => c.id === id || c.symbol.toLowerCase() === id.toLowerCase());
}

// Precision varies by coin: high-value, low-supply coins (BTC) need several
// decimal places to represent a $10s-of-dollars amount meaningfully; cheap,
// high-supply coins (TRX) are fine rounded to a whole unit.
const DECIMALS: Record<CoinId, number> = {
  btc: 6, eth: 4, sol: 2, bnb: 3, xrp: 1, trx: 0, ltc: 3, ada: 1, ton: 2, xlm: 1,
};

export function amountForPrice(coin: CoinConfig, priceUsd: number): number {
  const raw = priceUsd / coin.rateUsd;
  const factor = 10 ** (DECIMALS[coin.id] ?? 4);
  return Math.round(raw * factor) / factor;
}
