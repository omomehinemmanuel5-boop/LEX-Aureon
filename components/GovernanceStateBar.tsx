import React from 'react';

export interface GovernanceStateBarProps {
  continuity: number;
  reciprocity: number;
  sovereignty: number;
  stabilityMargin: number;
}

export default function GovernanceStateBar(props: GovernanceStateBarProps) {
  const items = [
    ['Continuity', props.continuity],
    ['Reciprocity', props.reciprocity],
    ['Sovereignty', props.sovereignty],
    ['Stability', props.stabilityMargin],
  ];

  return (
    <div className="rounded-xl border p-4 bg-background/60 backdrop-blur">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Live Constitutional State</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border p-3">
            <div className="text-xs opacity-70">{label}</div>
            <div className="text-lg font-bold">{(Number(value) * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
