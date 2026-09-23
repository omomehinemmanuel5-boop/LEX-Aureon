"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type GovernanceState = {
  status: string;
  runtime_state: { C: number; R: number; S: number; M: number; updated_at: string } | null;
};

export default function LiveGovernanceStrip(){
  const [state,setState]=useState<GovernanceState|null>(null);
  const [status,setStatus]=useState("CONNECTING");

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const res=await fetch("/api/health",{cache:"no-store"});
        const data=await res.json().catch(()=>null);
        let liveData=data;
        if (!liveData?.runtime_state) {
          const trajectoryRes=await fetch("/api/atlas/state",{cache:"no-store"});
          const trajectoryData=await trajectoryRes.json().catch(()=>null);
          if (trajectoryData?.state) {
            liveData={...liveData,runtime_state:trajectoryData.state};
          }
        }
        if(active && liveData && typeof liveData?.status === "string"){
          setState(liveData);
          setStatus(liveData.status.toUpperCase());
        } else if(active) setStatus(res.ok ? "NO LIVE STATE" : "UNAVAILABLE");
      }catch{if(active)setStatus("UNAVAILABLE");}
    };
    load();
    const timer=window.setInterval(load,15000);
    return()=>{active=false;window.clearInterval(timer)};
  },[]);

  return (<section className="border-y border-[#c9a84c]/15 bg-[#07070d] px-4 py-6"><div className="mx-auto max-w-6xl rounded-2xl border border-[#c9a84c]/20 bg-[#0d0d1a] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#e8c96d]">Live Governance</div><h3 className="mt-1 text-xl font-black text-white">Latest Runtime Trajectory</h3><p className="mt-1 text-xs text-white/45">Live C · R · S · M values from the latest governed runtime trajectory.</p></div><span className="w-fit rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-mono text-emerald-300">{status}</span></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
  {([["C", state?.runtime_state?.C], ["R", state?.runtime_state?.R], ["S", state?.runtime_state?.S], ["M", state?.runtime_state?.M]] as const).map(([key, value]) => (
    <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-[10px] font-mono text-white/40">{key}</div>
      <div className="mt-1 text-lg font-bold text-white">{typeof value === "number" ? value.toFixed(3) : "—"}</div>
    </div>
  ))}
</div>{state?.runtime_state?.updated_at && <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-[10px] font-mono text-white/35">Live state updated {new Date(state.runtime_state.updated_at).toLocaleTimeString()}</div><Link href="/audit" className="w-fit rounded-lg border border-[#c9a84c]/20 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] text-[#e8c96d] transition hover:border-[#c9a84c]/40 hover:bg-[#c9a84c]/5">View audit evidence →</Link></div>}</div></section>);
}