/**
 * Tests for NaturalLanguageQuery — natural language question engine.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NaturalLanguageQuery } from '../../core/nl-query.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { KnowledgeGraph } from '../../core/knowledge-graph.js';
import { EventTracker } from '../../core/events.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('NaturalLanguageQuery', () => {
  let storage: BetterSqlite3Storage;
  let knowledgeBase: KnowledgeBase;
  let knowledgeGraph: KnowledgeGraph;
  let eventTracker: EventTracker;
  let nlQuery: NaturalLanguageQuery;

  before(async () => {
    storage = await createTestDb();
    knowledgeBase = new KnowledgeBase(storage);
    knowledgeGraph = new KnowledgeGraph(storage);
    eventTracker = new EventTracker(storage);
    nlQuery = new NaturalLanguageQuery(storage, knowledgeBase, knowledgeGraph, eventTracker);
  });

  after(async () => {
    await storage.close();
  });

  // -------------------------------------------------------------------------
  // classifyIntent
  // -------------------------------------------------------------------------

  it('classifyIntent detects "what" questions', () => {
    assert.equal(nlQuery.classifyIntent('What is the authentication strategy?'), 'what');
    assert.equal(nlQuery.classifyIntent('Tell me what we decided'), 'what');
  });

  it('classifyIntent detects "when" questions', () => {
    assert.equal(nlQuery.classifyIntent('When did we deploy?'), 'when');
    assert.equal(nlQuery.classifyIntent('Tell me when the fix happened'), 'when');
  });

  it('classifyIntent detects "why" questions', () => {
    assert.equal(nlQuery.classifyIntent('Why did we choose React?'), 'why');
    assert.equal(nlQuery.classifyIntent('Explain why the migration failed'), 'why');
  });

  it('classifyIntent detects "how" questions', () => {
    assert.equal(nlQuery.classifyIntent('How does the cache work?'), 'how');
    assert.equal(nlQuery.classifyIntent('Show me how to deploy'), 'how');
  });

  it('classifyIntent returns "general" for ambiguous questions', () => {
    assert.equal(nlQuery.classifyIntent('Tell me about the project'), 'general');
    assert.equal(nlQuery.classifyIntent('authentication strategy'), 'general');
  });

  // -------------------------------------------------------------------------
  // extractTerms
  // -------------------------------------------------------------------------

  it('extractTerms removes stopwords', () => {
    const terms = nlQuery.extractTerms('What is the authentication strategy for our project?');
    assert.ok(!terms.includes('the'));
    assert.ok(!terms.includes('for'));
    assert.ok(!terms.includes('our'));
    assert.ok(terms.includes('authentication'));
    assert.ok(terms.includes('strategy'));
    assert.ok(terms.includes('project'));
  });

  it('extractTerms handles punctuation', () => {
    const terms = nlQuery.extractTerms('Why did we choose React? Is it good!');
    assert.ok(!terms.includes('react?'));
    assert.ok(!terms.includes('good!'));
    assert.ok(terms.includes('react'));
    assert.ok(terms.includes('choose'));
    assert.ok(terms.includes('good'));
  });

  // -------------------------------------------------------------------------
  // ask (integration)
  // -------------------------------------------------------------------------

  it('ask returns results for knowledge questions', async () => {
    // Seed knowledge
    knowledgeBase.save({
      category: 'decision',
      title: 'Use JWT for authentication',
      content: 'We decided to use JWT tokens for API authentication because of statelessness.',
      tags: ['auth', 'jwt'],
    });

    const answer = await nlQuery.ask('What did we decide about authentication?');
    assert.equal(answer.intent, 'what');
    assert.ok(answer.terms.includes('decide'));
    assert.ok(answer.terms.includes('authentication'));
    assert.ok(answer.sources.length > 0, 'should find knowledge results');
    assert.ok(answer.summary.length > 0);
  });

  it('ask returns results for event questions', async () => {
    // Seed an event
    eventTracker.emit('test-session', 'deployment', { target: 'production', version: '1.0.0' });

    const answer = await nlQuery.ask('When was the deployment?');
    assert.equal(answer.intent, 'when');
    assert.ok(answer.sources.length > 0, 'should find event results');
    assert.ok(answer.sources.some(s => s.type === 'event'));
  });

  it('ask returns empty for no matches', async () => {
    const answer = await nlQuery.ask('What about xyznonexistent987?');
    assert.equal(answer.intent, 'what');
    assert.equal(answer.sources.length, 0);
    assert.ok(answer.summary.includes('No relevant information'));
  });
});
