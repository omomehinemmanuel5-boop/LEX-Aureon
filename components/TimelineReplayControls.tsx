"use client";

export interface TimelineReplayControlsProps {
  mode: "live" | "pause";
  onModeChange: (mode: "live" | "pause") => void;
}

export default function TimelineReplayControls({ mode, onModeChange }: TimelineReplayControlsProps) {
  return (
    <div className="flex gap-2 items-center rounded-xl border p-3">
      <button
        onClick={() => onModeChange("live")}
        className={mode === "live" ? "px-3 py-1 rounded bg-emerald-600 text-white" : "px-3 py-1 rounded border"}
      >
        Live
      </button>
      <button
        onClick={() => onModeChange("pause")}
        className={mode === "pause" ? "px-3 py-1 rounded bg-amber-600 text-white" : "px-3 py-1 rounded border"}
      >
        Pause
      </button>
      <button disabled title="Timeline data is not available yet" className="px-3 py-1 rounded border opacity-50 cursor-not-allowed">Step <span className="text-xs">(coming soon)</span></button>
      <button disabled title="Timeline data is not available yet" className="px-3 py-1 rounded border opacity-50 cursor-not-allowed">Replay <span className="text-xs">(coming soon)</span></button>
      <span className="ml-auto text-sm opacity-70">Mode: {mode}</span>
    </div>
  );
}
