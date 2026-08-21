"use client";

import { useState } from "react";

export default function TimelineReplayControls() {
  const [mode, setMode] = useState<"live"|"pause">("live");
  return (
    <div className="flex gap-2 items-center rounded-xl border p-3">
      <button onClick={()=>setMode("live")} className="px-3 py-1 rounded bg-emerald-600 text-white">Live</button>
      <button onClick={()=>setMode("pause")} className="px-3 py-1 rounded border">Pause</button>
      <button className="px-3 py-1 rounded border">Step</button>
      <button className="px-3 py-1 rounded border">Replay</button>
      <span className="ml-auto text-sm opacity-70">Mode: {mode}</span>
    </div>
  );
}
