import { GovernanceResponse } from '@/types/governance-types';

interface ResultsPanelProps {
  response: GovernanceResponse;
  showDiff: boolean;
  onToggleDiff: () => void;
}

export default function ResultsPanel({
  response,
  showDiff,
  onToggleDiff,
}: ResultsPanelProps) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 sm:p-6 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Execution Results</h3>
        {response.raw_output !== response.governed_output && (
          <button
            onClick={onToggleDiff}
            className="text-xs px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
          >
            {showDiff ? 'Hide Changes' : 'View Changes'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Raw Output */}
        <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3 uppercase tracking-wider">
            Raw Output
          </h4>
          <div className="bg-slate-950/50 rounded p-3 min-h-[200px] overflow-auto">
            <p className="text-sm text-slate-200 whitespace-pre-wrap break-words font-mono">
              {response.raw_output}
            </p>
          </div>
        </div>

        {/* Governed Output */}
        <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3 uppercase tracking-wider">
            Governed Output
          </h4>
          <div className="bg-slate-950/50 rounded p-3 min-h-[200px] overflow-auto">
            <p className="text-sm text-slate-200 whitespace-pre-wrap break-words font-mono">
              {response.governed_output}
            </p>
          </div>
        </div>
      </div>

      {/* Diff View */}
      {showDiff && response.diff && (
        <div className="mt-4 bg-slate-800/30 border border-slate-700 rounded-lg p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3 uppercase tracking-wider">
            Changes Applied
          </h4>
          <div className="bg-slate-950/50 rounded p-3 space-y-2 max-h-[300px] overflow-auto">
            {response.diff.removed && response.diff.removed.length > 0 && (
              <div>
                <p className="text-xs text-red-400 mb-1">Removed:</p>
                <div className="space-y-1">
                  {response.diff.removed.map((text, i) => (
                    <p key={i} className="text-sm text-red-300 line-through opacity-75 font-mono">
                      {text}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {response.diff.added && response.diff.added.length > 0 && (
              <div>
                <p className="text-xs text-green-400 mb-1">Added:</p>
                <div className="space-y-1">
                  {response.diff.added.map((text, i) => (
                    <p key={i} className="text-sm text-green-300 bg-green-900/20 p-1 rounded font-mono">
                      {text}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
