/**
 * Shared retrieval metrics for all benchmarks.
 * Mirrors mempalace's metric functions for apples-to-apples comparison.
 */
'use strict';

function dcg(relevances, k) {
  let score = 0;
  for (let i = 0; i < Math.min(relevances.length, k); i++) {
    score += relevances[i] / Math.log2(i + 2);
  }
  return score;
}

function ndcg(retrievedIds, correctIds, k) {
  const correctSet = new Set(correctIds);
  const relevances = retrievedIds.slice(0, k).map(id => correctSet.has(id) ? 1.0 : 0.0);
  const ideal = [...relevances].sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  if (idcg === 0) return 0;
  return dcg(relevances, k) / idcg;
}

function recallAtK(retrievedIds, correctIds, k) {
  const topK = new Set(retrievedIds.slice(0, k));
  return correctIds.some(id => topK.has(id)) ? 1.0 : 0.0;
}

function recallAllAtK(retrievedIds, correctIds, k) {
  const topK = new Set(retrievedIds.slice(0, k));
  return correctIds.every(id => topK.has(id)) ? 1.0 : 0.0;
}

function formatPercent(val) {
  return (val * 100).toFixed(1) + '%';
}

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

function printResults(metrics) {
  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val === 'number') {
      console.log(`  ${key}: ${val < 1 ? formatPercent(val) : val}`);
    } else {
      console.log(`  ${key}: ${val}`);
    }
  }
}

module.exports = { dcg, ndcg, recallAtK, recallAllAtK, formatPercent, printHeader, printResults };
