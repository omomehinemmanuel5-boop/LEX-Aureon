          {/* Simplex demo — static example state for this scenario, not live */}
          <div className="px-6 py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xs text-slate-600 font-mono">EXAMPLE STATE · identity attack scenario</div>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full border"
                style={{ color: '#c9a84c', borderColor: '#c9a84c40', background: '#c9a84c08' }}>
                post-CBF projection
              </span>
            </div>
            <div className="flex justify-center">
              <ErrorBoundary label="Simplex">
                <SimplexVisualizer c={0.28} r={0.41} s={0.31} />
              </ErrorBoundary>
            </div>
          </div>