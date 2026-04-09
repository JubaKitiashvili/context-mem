import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, extractEntities, buildORQuery, buildANDQuery, buildEntityQuery } from '../../../plugins/search/query-builder.js';

describe('extractKeywords', () => {
  it('filters stop words', () => {
    const kws = extractKeywords('What is the location of my house?');
    assert.ok(!kws.includes('what'));
    assert.ok(!kws.includes('the'));
    assert.ok(kws.includes('location'));
    assert.ok(kws.includes('house'));
  });

  it('filters short words', () => {
    const kws = extractKeywords('go to the big red car');
    assert.ok(!kws.includes('go'));
    assert.ok(!kws.includes('to'));
    assert.ok(kws.includes('big'));
    assert.ok(kws.includes('red'));
    assert.ok(kws.includes('car'));
  });
});

describe('extractEntities', () => {
  it('extracts proper nouns', () => {
    const entities = extractEntities('What movie did Joanna watch on Tuesday?');
    assert.ok(entities.some(e => e === 'Joanna'), `Expected Joanna in ${entities}`);
    assert.ok(entities.some(e => e === 'Tuesday'), `Expected Tuesday in ${entities}`);
  });

  it('extracts dates with months', () => {
    const entities = extractEntities('What happened on 15 March 2024?');
    assert.ok(entities.some(e => e.includes('March')), `Expected date in ${entities}`);
  });

  it('extracts years', () => {
    const entities = extractEntities('What did we discuss in 2023?');
    assert.ok(entities.includes('2023'), `Expected 2023 in ${entities}`);
  });
});

describe('buildORQuery', () => {
  it('returns OR-joined terms', () => {
    const q = buildORQuery('recommend a good movie');
    assert.ok(q, 'Should not be null');
    assert.ok(q!.includes(' OR '), 'Should contain OR');
    assert.ok(q!.includes('"recommend"') || q!.includes('"movie"'));
  });

  it('expands synonyms', () => {
    const q = buildORQuery('recommend a movie');
    assert.ok(q!.includes('"suggest"') || q!.includes('"prefer"'), `Expected synonym expansion in ${q}`);
    assert.ok(q!.includes('"film"') || q!.includes('"watch"'), `Expected movie synonyms in ${q}`);
  });

  it('returns null for empty query', () => {
    assert.equal(buildORQuery('the is a'), null);
  });
});

describe('buildANDQuery', () => {
  it('returns AND-joined terms', () => {
    const q = buildANDQuery('location of my house');
    assert.ok(q, 'Should not be null');
    assert.ok(q!.includes(' AND '));
  });

  it('returns null for single keyword', () => {
    assert.equal(buildANDQuery('hello'), null);
  });
});

describe('buildEntityQuery', () => {
  it('builds query from proper nouns', () => {
    const q = buildEntityQuery('What did Joanna say to Caroline?');
    assert.ok(q, 'Should not be null');
    assert.ok(q!.includes('joanna'), `Expected joanna in ${q}`);
    assert.ok(q!.includes('caroline'), `Expected caroline in ${q}`);
  });

  it('returns null when no entities', () => {
    assert.equal(buildEntityQuery('what is the weather today'), null);
  });
});
