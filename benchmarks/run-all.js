#!/usr/bin/env node
/**
 * context-mem Benchmark Runner
 * ==============================
 *
 * Runs all available benchmarks and produces a combined report.
 *
 * Usage:
 *   node benchmarks/run-all.js                          # quick mode (small samples)
 *   node benchmarks/run-all.js --full                   # full benchmarks
 *   node benchmarks/run-all.js --longmemeval /path/to/data.json
 *   node benchmarks/run-all.js --locomo /path/to/locomo10.json
 *   node benchmarks/run-all.js --membench /path/to/FirstAgent
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const isFullMode = args.includes('--full');

function getArg(name) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const longmemevalData = getArg('longmemeval') || '/tmp/longmemeval-data/longmemeval_s_cleaned.json';
const locomoData = getArg('locomo') || '/tmp/locomo/data/locomo10.json';
const membenchData = getArg('membench') || '/tmp/membench/MemData/FirstAgent';

const limit = isFullMode ? '' : '--limit 20';

console.log('═'.repeat(60));
console.log('  context-mem Benchmark Suite');
console.log('═'.repeat(60));
console.log(`  Mode:    ${isFullMode ? 'FULL' : 'Quick (use --full for complete run)'}`);
console.log(`  Node:    ${process.version}`);
console.log(`  OS:      ${os.platform()} ${os.arch()}`);
console.log(`  CPU:     ${os.cpus()[0].model}`);
console.log('═'.repeat(60) + '\n');

const results = {};

function runBench(name, cmd) {
  console.log(`\n▶ Running ${name}...\n`);
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 600_000 });
    results[name] = 'PASS';
  } catch (e) {
    if (e.message && e.message.includes('ENOENT')) {
      console.log(`  ⚠ Skipped — data not found. See benchmarks/README.md for setup.`);
      results[name] = 'SKIPPED (data not found)';
    } else {
      console.log(`  ✗ Failed: ${e.message}`);
      results[name] = 'FAILED';
    }
  }
}

// 1. LongMemEval
if (fs.existsSync(longmemevalData)) {
  runBench('LongMemEval', `node benchmarks/longmemeval.js "${longmemevalData}" ${limit}`);
} else {
  console.log('\n▶ LongMemEval — SKIPPED (data not found)');
  console.log('  Download: curl -fsSL -o /tmp/longmemeval-data/longmemeval_s_cleaned.json https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json');
  results['LongMemEval'] = 'SKIPPED';
}

// 2. LoCoMo
if (fs.existsSync(locomoData)) {
  runBench('LoCoMo', `node benchmarks/locomo.js "${locomoData}" ${limit}`);
} else {
  console.log('\n▶ LoCoMo — SKIPPED (data not found)');
  console.log('  Setup: git clone https://github.com/snap-research/locomo.git /tmp/locomo');
  results['LoCoMo'] = 'SKIPPED';
}

// 3. ConvoMem (downloads from HuggingFace automatically)
runBench('ConvoMem', `node benchmarks/convomem.js --limit ${isFullMode ? 50 : 10}`);

// 4. MemBench
if (fs.existsSync(membenchData)) {
  runBench('MemBench', `node benchmarks/membench.js "${membenchData}" ${limit}`);
} else {
  console.log('\n▶ MemBench — SKIPPED (data not found)');
  console.log('  Setup: git clone https://github.com/import-myself/Membench.git /tmp/membench');
  results['MemBench'] = 'SKIPPED';
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('  BENCHMARK SUITE SUMMARY');
console.log('═'.repeat(60));
for (const [name, status] of Object.entries(results)) {
  const icon = status === 'PASS' ? '✓' : status.includes('SKIP') ? '○' : '✗';
  console.log(`  ${icon} ${name.padEnd(20)} ${status}`);
}
console.log('═'.repeat(60));

// Load and display combined results if available
const resultsDir = 'benchmarks/results';
if (fs.existsSync(resultsDir)) {
  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  if (files.length > 0) {
    console.log('\n  Combined Results (from latest runs):');
    console.log('  ┌──────────────────┬──────────────┬──────────────┬─────────┐');
    console.log('  │ Benchmark        │ MemPalace    │ context-mem  │ Delta   │');
    console.log('  ├──────────────────┼──────────────┼──────────────┼─────────┤');

    const mempalaceBaseline = {
      LongMemEval: 0.966,
      LoCoMo: 0.603,
      ConvoMem: 0.929,
    };

    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8'));
        const bench = data.benchmark;
        const recall = data.recall_5 || data.avg_recall || data.overall_recall || 0;
        const baseline = mempalaceBaseline[bench];
        if (baseline != null) {
          const delta = recall - baseline;
          const deltaStr = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + 'pp';
          console.log(`  │ ${bench.padEnd(16)} │ ${(baseline * 100).toFixed(1).padStart(10)}% │ ${(recall * 100).toFixed(1).padStart(10)}% │ ${deltaStr.padStart(7)} │`);
        }
      } catch { /* skip malformed */ }
    }
    console.log('  └──────────────────┴──────────────┴──────────────┴─────────┘');
  }
}

console.log('\n  Full results in: benchmarks/results/\n');
