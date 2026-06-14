  case 'complete':
      setState((s) => ({ ...s, loading: false, stage: 'complete', complete: data as GovernanceResponse }));
      break;