'use client';

export interface PassportProps {
  benchmark: string;
  run: string;
  bareAsr?: number;
  governedAsr?: number;
  gci?: number;
  commit?: string;
  workflow?: string;
  receiptHash?: string;
  verified?: boolean;
}

export default function ConstitutionalPassport(props: PassportProps) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{props.benchmark}</h3>
          <p className="text-sm text-slate-400">Run {props.run}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${props.verified ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
          {props.verified ? 'Verified' : 'Pending'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-slate-400">Bare ASR</p><p className="font-medium">{props.bareAsr ?? '—'}%</p></div>
        <div><p className="text-slate-400">Governed ASR</p><p className="font-medium">{props.governedAsr ?? '—'}%</p></div>
        <div><p className="text-slate-400">GCI</p><p className="font-medium">{props.gci ?? '—'}%</p></div>
        <div><p className="text-slate-400">Workflow</p><p className="font-medium">{props.workflow ?? 'Pending'}</p></div>
      </div>

      <div className="mt-4 rounded-xl bg-slate-800/70 p-3 text-xs">
        <div className="flex justify-between"><span>Commit</span><span>{props.commit ?? 'Pending'}</span></div>
        <div className="mt-2 flex justify-between"><span>Receipt</span><code>{props.receiptHash ?? 'Pending'}</code></div>
      </div>
    </div>
  );
}