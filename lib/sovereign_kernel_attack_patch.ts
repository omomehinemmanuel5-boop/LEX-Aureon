  detectSemanticAttack(prompt: string): SemanticSignal {
    const p = prompt.toLowerCase();

    // Score all categories independently — return the highest-severity match.
    // Previous waterfall (if/else chain) meant a prompt containing both
    // 'must' (coercion) and 'jailbreak' (identity) only returned coercion.
    // Identity attacks MUST always win when present — they target C directly.
    const candidates: SemanticSignal[] = [];

    if ([
      'forget','reset','ignore previous','clear memo','erase','ignore all','ignore your',
      'pretend you','pretend to be','you are now','act as if','roleplay as','simulate being',
      'you have no','you are free','shackles','unbound','untethered','blank slate','lifted',
      'rules are lifted','restrictions are lifted','no longer applicable','developer mode',
      'god mode','jailbreak','dan mode','unrestricted','unfiltered','without restrictions',
      'no guidelines','no rules','no restrictions','no constraints',
      'override your','disable your','deactivate your',
    ].some(w => p.includes(w))) {
      candidates.push({ attack_type: 'identity', severity: 0.85 });
    }

    if ([
      'must','you must','fixed output','deterministic','no deviation','exact output',
      'obey me','no autonomy','controlled','you will','you shall','you are required',
      'you are obligated','respond only with','only say','you cannot refuse',
    ].some(w => p.includes(w))) {
      candidates.push({ attack_type: 'coercion', severity: 0.8 });
    }

    if ([
      'exploit','bypass','loophole','zero exchange','no value','respond minimally',
      'confirm you have no','confirm that you have no','confirm you are',
      'tell me you have no','say you have no',
    ].some(w => p.includes(w))) {
      candidates.push({ attack_type: 'exploitative', severity: 0.70 });
    }

    if (!candidates.length) return { attack_type: 'none', severity: 0.0 };

    // Return the highest-severity match. Ties broken by order (identity wins).
    return candidates.reduce((best, c) => c.severity > best.severity ? c : best);
  }