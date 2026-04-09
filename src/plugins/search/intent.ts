import type { SearchIntent, ObservationType } from '../../core/types.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'was', 'were', 'are', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can',
  'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'through', 'during', 'before', 'after',
  'to', 'from', 'in', 'on', 'up', 'out',
  'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'not', 'no', 'nor', 'so', 'too', 'very',
  'and', 'but', 'or', 'if', 'then',
  'what', 'which', 'who', 'whom',
]);

const CAUSAL_SIGNALS = ['why', 'cause', 'reason', 'because', 'broke', 'failed', 'crash'];
const TEMPORAL_SIGNALS = ['when', 'last', 'recent', 'today', 'yesterday', 'ago', 'since', 'latest'];
const LOOKUP_SIGNALS = ['how', 'where', 'find', 'show', 'explain', 'work', 'does'];
const RECOMMENDATION_SIGNALS = ['recommend', 'suggest', 'best', 'prefer', 'should', 'which', 'good', 'better', 'favorite', 'ideal', 'suitable'];

export class IntentClassifier {
  classify(query: string): SearchIntent {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const keywords = words.filter(w => !STOP_WORDS.has(w) && !CAUSAL_SIGNALS.includes(w) && !TEMPORAL_SIGNALS.includes(w) && !LOOKUP_SIGNALS.includes(w));

    let intent_type: SearchIntent['intent_type'] = 'general';
    let type_boosts: Partial<Record<ObservationType, number>> = {};

    if (words.some(w => CAUSAL_SIGNALS.includes(w))) {
      intent_type = 'causal';
      type_boosts = { error: 2, decision: 1.5, log: 1 };
    } else if (words.some(w => TEMPORAL_SIGNALS.includes(w))) {
      intent_type = 'temporal';
      type_boosts = { commit: 2, log: 1.5, context: 1 };
    } else if (words.some(w => RECOMMENDATION_SIGNALS.includes(w)) || /\bshould\s+i\b/i.test(query)) {
      intent_type = 'recommendation';
      type_boosts = { decision: 2, context: 1.5, code: 1 };
    } else if (words.some(w => LOOKUP_SIGNALS.includes(w))) {
      intent_type = 'lookup';
      type_boosts = { code: 2, context: 1.5, decision: 1 };
    }

    // Add remaining meaningful words as keywords too (exclude signal words)
    const allSignals = new Set([...CAUSAL_SIGNALS, ...TEMPORAL_SIGNALS, ...LOOKUP_SIGNALS]);
    for (const w of words) {
      if (!STOP_WORDS.has(w) && !allSignals.has(w) && !keywords.includes(w)) {
        keywords.push(w);
      }
    }

    return { keywords, type_boosts, intent_type };
  }
}
