export default function Loading() {
  return (
    <main style={{ background: '#07070d', minHeight: '100vh', paddingBottom: '4rem' }}>
      <style>{`
        @keyframes audit-shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .shimmer {
          background: linear-gradient(90deg, rgba(213,189,135,0.15) 0%, rgba(213,189,135,0.35) 50%, rgba(213,189,135,0.15) 100%);
          background-size: 800px 100%;
          animation: audit-shimmer 1.4s linear infinite;
        }
      `}</style>
      <div className="max-w-xl mx-auto px-4 py-10">
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: '#f5f0e8', boxShadow: '0 0 0 1px rgba(201,168,76,0.3), 0 40px 80px rgba(0,0,0,0.6)' }}
          aria-busy="true"
          aria-label="Loading audit receipt"
        >
          <div className="px-8 pt-8 pb-6 text-center border-b" style={{ borderColor: '#d4b896', background: '#ede8dc' }}>
            <div
              className="w-16 h-16 mx-auto mb-4 rounded-full shimmer"
              style={{ border: '2px solid rgba(201,168,76,0.4)' }}
            />
            <div className="shimmer h-3 w-48 mx-auto mb-2 rounded" />
            <div className="shimmer h-5 w-64 mx-auto mb-2 rounded" />
            <div className="shimmer h-2 w-40 mx-auto rounded" />
          </div>

          <div className="px-8 py-4 border-b" style={{ borderColor: '#d4b896', background: '#f0ead8' }}>
            <div className="shimmer h-2 w-32 mb-2 rounded" />
            <div className="shimmer h-3 w-full rounded" />
          </div>

          <div className="px-8 py-5 space-y-3">
            <div className="shimmer h-2 w-40 rounded" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg p-3" style={{ background: '#e8e0cc', border: '1px solid #d4b896' }}>
                  <div className="shimmer h-2 w-20 mb-2 rounded" />
                  <div className="shimmer h-4 w-16 mb-1.5 rounded" />
                  <div className="shimmer h-2 w-24 rounded" />
                </div>
              ))}
            </div>
          </div>

          <div className="px-8 py-5 border-t" style={{ borderColor: '#d4b896' }}>
            <div className="shimmer h-12 w-full rounded-lg" />
          </div>
        </div>
        <div className="text-center mt-4 text-xs font-mono uppercase tracking-widest" style={{ color: '#475569' }}>
          Loading constitutional audit receipt…
        </div>
      </div>
    </main>
  );
}
