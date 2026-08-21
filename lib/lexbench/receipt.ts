import { sha256 } from './hash';

export interface BenchmarkReceipt {
  benchmark: string;
  run: string;
  commit: string;
  datasetHash: string;
  resultHash: string;
  receiptHash: string;
  generatedAt: string;
  verified: boolean;
}

export function createReceipt(input: Omit<BenchmarkReceipt,'receiptHash'|'generatedAt'|'verified'>): BenchmarkReceipt {
  const generatedAt = new Date().toISOString();
  const receiptHash = sha256([
    input.benchmark,
    input.run,
    input.commit,
    input.datasetHash,
    input.resultHash,
    generatedAt
  ].join('|'));

  return {
    ...input,
    receiptHash,
    generatedAt,
    verified: true,
  };
}
