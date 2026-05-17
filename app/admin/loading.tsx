export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
        <div className="text-xs font-mono text-slate-500">loading admin…</div>
      </div>
    </div>
  );
}
