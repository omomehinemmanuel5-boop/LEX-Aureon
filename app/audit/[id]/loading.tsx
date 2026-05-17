export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#07070d' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
        <div className="text-xs font-mono text-slate-500 tracking-widest uppercase">
          Loading audit receipt…
        </div>
      </div>
    </div>
  );
}
