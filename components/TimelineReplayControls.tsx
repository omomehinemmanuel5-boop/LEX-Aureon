"use client";

    export interface TimelineReplayControlsProps {
    mode: "idle" | "auto";
    onModeChange: (mode: "idle" | "auto") => void;
    canStep?: boolean;
    canReplay?: boolean;
    onStep?: () => void;
    onReplay?: () => void;
    disabledReason?: string;
    }

    // fix (2026-08-22): renamed from "live"/"pause". This never controlled
    // whether anything was "live" -- it toggles whether the persisted-turn
    // timeline below auto-advances every 800ms. The old labels meant clicking
    // "Pause" started auto-play and "Live" stopped it -- backwards from what
    // a user would expect those words to do, and "Pause" and "Replay" did the
    // exact same thing. "Idle"/"Auto-play" describe what the buttons actually
    // do; "Replay" now restarts from turn 0 (see ObservabilityTimeline's
    // onReplay), a real, distinct action instead of a duplicate of the toggle.
    export default function TimelineReplayControls({ mode, onModeChange, canStep = false, canReplay = false, onStep, onReplay, disabledReason = "Timeline data is not loaded" }: TimelineReplayControlsProps) {
    return (
      <div className="flex gap-2 items-center rounded-xl border p-3 flex-wrap">
        <button onClick={() => onModeChange("idle")} title="Stop auto-advancing" className={mode === "idle" ? "px-3 py-1 rounded bg-slate-600 text-white" : "px-3 py-1 rounded border"}>Idle</button>
        <button onClick={() => onModeChange("auto")} title="Auto-advance one turn every 800ms" className={mode === "auto" ? "px-3 py-1 rounded bg-emerald-600 text-white" : "px-3 py-1 rounded border"}>Auto-play</button>
        <button disabled={!canStep} onClick={onStep} title={!canStep ? disabledReason : "Advance one persisted turn"} className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed">Step</button>
        <button disabled={!canReplay} onClick={onReplay} title={!canReplay ? disabledReason : "Restart from the first persisted turn and auto-play"} className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed">Replay</button>
        <span className="ml-auto text-sm opacity-70">{mode === "auto" ? "Auto-playing" : "Idle"}</span>
      </div>
    );
    }
    