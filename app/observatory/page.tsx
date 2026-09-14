"use client";

import { useEffect, useState } from "react";

type ObservatoryData = {
  total?: number;
  today?: number;
  sessions?: number;
  real?: number;
  latest?: Array<{
    receipt_id: string;
    health_band?: string;
    created_at: string;
  }>;
};

const fetcher = async (u: string): Promise<ObservatoryData> => {
  const response = await fetch(u);
  if (!response.ok) throw new Error(`Observatory request failed: ${response.status}`);
  return response.json();
};

export default function Observatory(){
  const [data, setData] = useState<ObservatoryData>();
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetcher('/api/observatory');
        if (active) setData(next);
      } catch {
        if (active) setData(undefined);
      }
    };
    load();
    const timer = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const m=data||{};return (<main className="mx-auto max-w-6xl p-8 space-y-8"><div><h1 className="text-4xl font-bold">Founder Observatory</h1><p className="text-gray-500">Live constitutional telemetry</p></div><section className="grid md:grid-cols-4 gap-4">{[['Receipts',m.total],['Sessions',m.sessions],['Real Runs',m.real],['Today',m.today]].map(([k,v])=><div key={String(k)} className="rounded-2xl border p-4"><p className="text-xs uppercase">{k}</p><h2 className="text-3xl font-bold">{v??'—'}</h2></div>)}</section><section className="rounded-2xl border p-5"><p className="text-xs uppercase">Latest Receipt</p><h2 className="text-2xl font-bold">{m.latest?.[0]?.receipt_id||'Loading...'}</h2><p className="text-sm opacity-70">{m.latest?.[0]?.health_band}</p></section><section className="rounded-2xl border p-5"><h2 className="text-xl font-semibold mb-3">Recent Receipts</h2><div className="space-y-3">{(m.latest||[]).map((r)=><div key={r.receipt_id} className="flex justify-between items-center border-b pb-2"><div><p className="font-mono text-sm">{r.receipt_id}</p><p className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</p></div><span>{r.health_band}</span></div>)}</div></section></main>);}