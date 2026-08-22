"use client";

    export interface TimelineReplayControlsProps {
    mode: "live" | "pause";
    onModeChange: (mode: "live" | "pause") => void;
    canStep?: boolean;
    canReplay?: boolean;
    onStep?: () => void;
    onReplay?: () => void;
    disabledReason?: string;
    }

    export default function TimelineReplayControls({ mode, onModeChange, canStep = false, canReplay = false, onStep, onReplay, disabledReason = "Timeline data is not loaded" }: TimelineReplayControlsProps) {
    return (
      <div className="flex gap-2 items-center rounded-xl border p-3 flex-wrap">
        <button onClick={() => onModeChange("live")} className={mode === "live" ? "px-3 py-1 rounded bg-emerald-600 text-white" : "px-3 py-1 rounded border"}>Live</button>
        <button onClick={() => onModeChange("pause")} className={mode === "pause" ? "px-3 py-1 rounded bg-amber-600 text-white" : "px-3 py-1 rounded border"}>Pause</button>
        <button disabled={!canStep} onClick={onStep} title={!canStep ? disabledReason : "Advance one persisted turn"} className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed">Step</button>
        <button disabled={!canReplay} onClick={onReplay} title={!canReplay ? disabledReason : "Replay persisted turns"} className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed">Replay</button>
        <span className="ml-auto text-sm opacity-70">Mode: {mode}</span>
      </div>
    );
    }
    