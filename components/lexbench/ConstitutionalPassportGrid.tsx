'use client';

import ConstitutionalPassport from './ConstitutionalPassport';
import index from '@/results/receipts/index.json';

export default function ConstitutionalPassportGrid(){
  const receipts = (index as any).receipts || [];
  return (<div className='grid gap-4 md:grid-cols-2'>{receipts.map((r:any)=><ConstitutionalPassport key={r.benchmark+r.run} benchmark={r.benchmark} run={r.run} verified={false} bareAsr={undefined} governedAsr={undefined} gci={100} receiptHash='pending-ci' commit='pending-ci' workflow='pending-ci'/>)}</div>);
}
