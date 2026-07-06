/**
 * lib/crypto_coins.ts
 *
 * Single source of truth for the Sovereign-tier crypto payment addresses and
 * expected amounts. Previously this list lived ONLY inside
 * components/BitcoinUpgradeModal.tsx (a client component) — the verification
 * logic (lib/crypto_verify.ts, app/api/leads/route.ts) needs the exact same
 * addresses/amounts server-side to check a submitted payment against. Extracted
 * here so both the UI and the backend import the same data — never two copies
 * that could silently drift apart.
 */

import type { CoinId } from './crypto_verify';

export interface CoinConfig {
  id: CoinId;
  name: string;
  symbol: string;
  address: string;
  amount: number;   // in the coin's native unit (not smallest unit)
  color: string;
  icon: string;
}

export const COINS: CoinConfig[] = [
  { id: 'btc', name: 'Bitcoin',  symbol: 'BTC', address: 'bc1qdkm5g4fz6tw4459k8tufgnc77kc9uczd86gk2c', amount: 0.00019, color: '#f7931a', icon: '₿' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', address: '0x4CE01F213526CE52dC4C9A5d21b5641BB85a04ec', amount: 0.008,   color: '#627eea', icon: 'Ξ' },
  { id: 'sol', name: 'Solana',   symbol: 'SOL', address: '63mXsqa8YRmwgHKhctSiPS3Z7MBQX734WFKFdiBTTqKf', amount: 0.13, color: '#9945ff', icon: '◎' },
  { id: 'bnb', name: 'BNB',      symbol: 'BNB', address: '0x4CE01F213526CE52dC4C9A5d21b5641BB85a04ec', amount: 0.035,  color: '#f3ba2f', icon: 'B' },
  { id: 'xrp', name: 'XRP',      symbol: 'XRP', address: 'rwsQ48AQFJbJ5EtVvA2hDtPKERXEpAg3Q5', amount: 28, color: '#00aae4', icon: '✕' },
  { id: 'trx', name: 'TRON',     symbol: 'TRX', address: 'THCGX6jvTE3TAfjQvHtTBCyzkc8MfrFbHg', amount: 140, color: '#ef0027', icon: 'T' },
  { id: 'ltc', name: 'Litecoin', symbol: 'LTC', address: 'ltc1qz7vpzu5f9cvhu8hv60jydsl5w3sdd9q28ckvj3', amount: 0.22, color: '#bfbbbb', icon: 'Ł' },
  { id: 'ada', name: 'Cardano',  symbol: 'ADA', address: 'addr1q9k44as5ugtgk8ug8ydyrs0yu8mw7lfff39lc5pkrrd6yueg9702j3cjrlxeqp3ccdquclhkeklkack7l6rzn5fzvfns0zs4e3', amount: 55, color: '#0033ad', icon: '₳' },
  { id: 'ton', name: 'TON',      symbol: 'TON', address: 'UQCJmbOXgq1YBiu4hauFB9C2f4Rv2go80Feq_J2dfIAPibLO', amount: 4.5, color: '#0088cc', icon: '💎' },
  { id: 'xlm', name: 'Stellar',  symbol: 'XLM', address: 'GCYM63PDVO6RDKO3DOEMD25ERRRLCZRRR4D5AJ2UL3H7UMO7LR3MX22C', amount: 185, color: '#14b6e7', icon: '*' },
];

export function getCoinConfig(id: string): CoinConfig | undefined {
  return COINS.find(c => c.id === id || c.symbol.toLowerCase() === id.toLowerCase());
}
