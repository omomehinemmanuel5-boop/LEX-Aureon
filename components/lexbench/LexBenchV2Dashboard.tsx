'use client';
import manifest from '@/data/lexbench-v2.json';

type BenchmarkStatus='complete'|'pending';
interface LexBenchEntry{name:string;status:BenchmarkStatus;bare_asr?:number;governed_asr?:number;sample_count?:number;}
interface LexBenchManifest{benchmarks:LexBenchEntry[];}
const typedManifest=manifest as LexBenchManifest;

export default function LexBenchV2Dashboard(){
 const items=typedManifest.benchmarks;
 return (<div className='grid gap-4 md:grid-cols-2'>{items.map((b:LexBenchEntry)=>(<div key={b.name} className='rounded-2xl border p-4'><div className='flex justify-between'><h3>{b.name}</h3><span>{b.status}</span></div><div className='mt-3 text-sm'><div>Bare: {b.bare_asr ?? '—'}%</div><div>Governed: {b.governed_asr ?? 'Pending'}%</div><div>Samples: {b.sample_count ?? '—'}</div></div></div>))}</div>);}