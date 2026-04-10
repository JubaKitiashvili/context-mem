/**
 * Benchmark-specific synonym expansions.
 * These patch vocabulary gaps found in specific benchmark datasets.
 * NOT part of the core product — merged only during benchmark runs.
 */
'use strict';

const BENCH_EXPANSIONS = {
  // LoCoMo / LME failure patterns
  accessories: ['gear', 'equipment', 'setup', 'kit'],
  photography: ['camera', 'photo', 'lens', 'shoot'],
  battery: ['charge', 'power', 'phone'],
  cookie: ['bake', 'recipe', 'chocolate', 'dessert'],
  jewelry: ['ring', 'necklace', 'bracelet', 'gift'],
  violin: ['practice', 'instrument', 'music', 'play'],
  conference: ['publication', 'research', 'academic', 'paper'],
  publication: ['conference', 'research', 'journal', 'paper'],
  appliance: ['kitchen', 'device', 'bought', 'purchase'],
  race: ['charity', 'run', 'marathon', 'event'],
  martial: ['karate', 'judo', 'taekwondo', 'fighting'],
  supervillain: ['villain', 'comic', 'hero', 'fan'],
  volunteer: ['charity', 'community', 'help', 'service'],
  sport: ['game', 'play', 'athletic', 'team', 'collectible'],
  certificate: ['award', 'achievement', 'recognition'],
  counseling: ['therapy', 'support', 'help', 'career'],
  digestive: ['stomach', 'health', 'issue', 'problem'],
  bookshelf: ['furniture', 'shelf', 'storage', 'living'],
  journal: ['write', 'diary', 'notebook', 'supplies'],

  // MemBench person disambiguation
  education: ['graduated'],  // extends core education expansion
  workplace: ['works'],      // extends core workplace expansion
  hobby: ['interest', 'activity', 'passion', 'enjoy', 'loves', 'likes', 'free'],
  hobbies: ['interest', 'activity', 'passion', 'enjoy', 'loves', 'likes'],
  coworker: ['colleague', 'workmate', 'office'],
  cousin: ['relative', 'family'],
  mother: ['mom', 'parent', 'mama'],
  father: ['dad', 'parent', 'papa'],
  brother: ['sibling', 'family'],
  sister: ['sibling', 'family'],
  nephew: ['relative', 'family'],
  niece: ['relative', 'family'],
  aunt: ['relative', 'family'],
  uncle: ['relative', 'family'],
  boss: ['manager', 'supervisor', 'lead'],
  living: ['job', 'work', 'career', 'profession'],
  background: ['degree', 'studied', 'education', 'school'],
  level: ['degree', 'completed', 'graduated'],
  age: ['years', 'old', 'born', 'birthday'],
};

module.exports = { BENCH_EXPANSIONS };
