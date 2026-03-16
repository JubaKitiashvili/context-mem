import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntentClassifier } from '../../../plugins/search/intent.js';

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier();

  it('classifies "why" as causal intent', () => {
    const intent = classifier.classify('why did auth fail');
    assert.equal(intent.intent_type, 'causal');
    assert.ok((intent.type_boosts.error ?? 0) > 0);
    assert.ok((intent.type_boosts.decision ?? 0) > 0);
  });

  it('classifies "when" as temporal intent', () => {
    const intent = classifier.classify('when was the last deploy');
    assert.equal(intent.intent_type, 'temporal');
    assert.ok((intent.type_boosts.commit ?? 0) > 0);
  });

  it('classifies "how" as lookup intent', () => {
    const intent = classifier.classify('how does the auth middleware work');
    assert.equal(intent.intent_type, 'lookup');
    assert.ok((intent.type_boosts.code ?? 0) > 0);
  });

  it('extracts keywords', () => {
    const intent = classifier.classify('why did authentication middleware fail');
    assert.ok(intent.keywords.includes('authentication'));
    assert.ok(intent.keywords.includes('middleware'));
    assert.ok(intent.keywords.includes('fail'));
    assert.ok(!intent.keywords.includes('why'));
    assert.ok(!intent.keywords.includes('did'));
  });

  it('defaults to general for unrecognized patterns', () => {
    const intent = classifier.classify('database connection');
    assert.equal(intent.intent_type, 'general');
  });
});
