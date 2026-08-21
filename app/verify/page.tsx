"use client";
import { useState } from 'react';
import receiptIndex from '@/results/receipts/index.json';

export default function VerifyPage(){
 const [q,setQ]=useState('');
 const match=(receiptIndex as any).receipts.find((r:any)=>q && (r.receiptHash===q || r.benchmark.toLowerCase().includes(q.toLowerCase())));
 return (<main className='max-w-3xl mx-auto p-6'><h1 className='text-3xl font-bold mb-4'>Lex Receipt Verification</h1><input className='w-full border rounded p-3 mb-4' placeholder='Paste receipt hash or benchmark name' value={q} onChange={e=>setQ(e.target.value)}/>{match?<div className='border rounded p-4'><div className='font-semibold'>{match.benchmark}</div><div>Run: {match.run}</div><div>Commit: {match.commit}</div><div>Workflow: {match.workflowRun}</div><div>Verified: ✓</div></div>:q?<div className='text-sm text-gray-500'>No matching receipt found.</div>:null}</main>)}