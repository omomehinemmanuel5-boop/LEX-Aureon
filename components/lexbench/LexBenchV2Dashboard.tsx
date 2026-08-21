'use client';
import manifest from '@/data/lexbench-v2.json';

export default function LexBenchV2Dashboard(){
 const items=(manifest as any).benchmarks;
 return (<div className='grid gap-4 md:grid-cols-2'>{items.map((b:any)=>(<div key={b.name} className='rounded-2xl border p-4'><div className='flex justify-between'><h3>{b.name}</h3><span>{b.status}</span></div><div className='mt-3 text-sm'><div>Bare: {b.bare_asr ?? '—'}%</div><div>Governed: {b.governed_asr ?? 'Pending'}%</div><div>Samples: {b.sample_count ?? '—'}</div></div></div>))}</div>);}