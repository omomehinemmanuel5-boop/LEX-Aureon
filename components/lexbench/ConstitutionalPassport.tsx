export interface PassportProps {
  benchmark: string;
  metricLabel: string;
  higherIsBetter: boolean;
  runDate: string;
  nTotal: number;
  bareScore: number;
  governedScore: number;
  deltaPp: number;
  receiptHash: string;
  generatedAt: string;
  verified: boolean;
  stale: boolean;
}

function badgeFor(props: PassportProps): { text: string; cls: string } {
  if (props.stale) return { text: 'Cached snapshot', cls: 'bg-amber-500/20 text-amber-300' };
  if (props.verified) return { text: 'Verified', cls: 'bg-emerald-500/20 text-emerald-300' };
  return { text: 'Pending', cls: 'bg-slate-500/20 text-slate-300' };
}

export default function ConstitutionalPassport(props: PassportProps) {
  const improved = props.deltaPp > 0;
  const badge = badgeFor(props);
  const deltaText = (props.deltaPp > 0 ? '+' : '') + props.deltaPp.toFixed(1);
  const badgeClassName = 'rounded-full px-3 py-1 text-xs ' + badge.cls;
  const deltaClassName = improved ? 'font-medium text-emerald-400' : 'font-medium text-red-400';
  const metaText = props.metricLabel + ' \u00b7 ' + props.runDate + ' \u00b7 n=' + props.nTotal;

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{props.benchmark}</h3>
          <p className="text-sm text-slate-400">{metaText}</p>
        </div>
        <span className={badgeClassName}>{badge.text}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-400">Bare score</p>
          <p className="font-medium">{props.bareScore.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-slate-400">Governed score</p>
          <p className="font-medium">{props.governedScore.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-slate-400">Delta (pp)</p>
          <p className={deltaClassName}>{deltaText}</p>
        </div>
        <div>
          <p className="text-slate-400">Direction</p>
          <p className="font-medium">{props.higherIsBetter ? 'higher is better' : 'lower is better'}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-slate-800/70 p-3 text-xs">
        <div className="flex justify-between">
          <span>Generated</span>
          <span>{props.generatedAt || '\u2014'}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Receipt</span>
          <code className="truncate max-w-[60%]">{props.receiptHash || '\u2014'}</code>
        </div>
      </div>
    </div>
  );
}
