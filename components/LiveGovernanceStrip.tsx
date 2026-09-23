"use client";

import { useEffect, useState } from "react";

type GovernanceState = { status: string; m: number };

export default function LiveGovernanceStrip(){
  const [state,setState]=useState<GovernanceState|null>(null);
  const [status,setStatus]=useState("CONNECTING");

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const res=await fetch("/api/lex/health",{cache:"no-store"});
        if(!res.ok) throw new Error("health request failed");
        const data=await res.json();
        if(active && typeof data?.status === "string" && typeof data?.m === "number"){setState(data);setStatus(data.status);}
        else if(active) setStatus("NO LIVE STATE");
      }catch{if(active)setStatus("UNAVAILABLE");}
    };
    load();
    const timer=window.setInterval(load,15000);
    return()=>{active=false;window.clearInterval(timer)};
  },[]);

  return (<section className="border-y border-[#c9a84c]/15 bg-[#07070d] px-4 py-6"><div className="mx-auto max-w-6xl rounded-2xl border border-[#c9a84c]/20 bg-[#0d0d1a] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#e8c96d]">Live Governance</div><h3 className="mt-1 text-xl font-black text-white">Current Constitutional State</h3><p className="mt-1 text-xs text-white/45">Runtime state polled from the Lex health surface.</p></div><span className="w-fit rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-mono text-emerald-300">{status}</span></div><div className="mt-5 grid grid-cols-3 gap-3">{(["C","R","S"] as const).map(k=><div key={k} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-mono text-white/40">{k}</div><div className="mt-1 text-lg font-bold text-white">{state?state[k].toFixed(3):"—"}</div></div>)}</div>{state?.receipt_id&&<div className="mt-4 truncate text-[10px] font-mono text-white/35">Receipt {state.receipt_id}</div>}</div></section>);
}