# Total Recall — Phase 5: Marketing & Launch

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Depends on:** Phase 4 COMPLETE
**Status:** NOT STARTED

> Phase 5 is marketing, documentation, and launch.
> ALL features must be complete and tested before starting.

---

## Pre-Flight Checklist

- [ ] 5.0.1 — Verify Phase 4 is COMPLETE in master plan
- [ ] 5.0.2 — Run `npm test` → all pass (ALL phases)
- [ ] 5.0.3 — Count total new tests added across phases (target: ≥140)

---

## README Rewrite

- [ ] 5.1.1 — Rewrite README.md opening: emotional hook, not technical
  - Lead with pain: "Your AI forgets everything. Every decision, every debug session, every architecture choice — gone when the session ends."
  - Follow with promise: "context-mem remembers. Exact quotes from 6 months ago. Who decided what and why. The full story of your project."
  - Comparison table vs MemPalace, claude-mem, Context7
- [ ] 5.1.2 — Add "Real-World Examples" section:
  - "Why did we choose Postgres?" → verbatim recall with date
  - "What did Sarah work on last sprint?" → entity-aware search
  - "This worked last week" → regression fingerprint
  - "Generate PR description" → story command
- [ ] 5.1.3 — Add architecture diagram showing dual-mode memory
- [ ] 5.1.4 — Update tool count, test count, feature list
- [ ] 5.1.5 — Commit: `docs: README rewrite for v3.0 Total Recall`

---

## Benchmarks

- [ ] 5.2.1 — Run LongMemEval benchmark against verbatim recall mode
- [ ] 5.2.2 — Document benchmark results in BENCHMARK.md
- [ ] 5.2.3 — Update comparison table with academic benchmark scores
- [ ] 5.2.4 — Commit: `bench: LongMemEval benchmark results for v3.0`

---

## Version Bump & Release

- [ ] 5.3.1 — Update version to 3.0.0 in package.json
- [ ] 5.3.2 — Update CHANGELOG.md with all new features
- [ ] 5.3.3 — Run full test suite one final time
- [ ] 5.3.4 — Commit: `release: v3.0.0 — Total Recall`
- [ ] 5.3.5 — `npm publish`
- [ ] 5.3.6 — Create GitHub release with changelog

---

## Plugin Marketplace

- [ ] 5.4.1 — Update plugin.json with new tools and capabilities
- [ ] 5.4.2 — Submit to Claude Code plugin marketplace (if applicable)
- [ ] 5.4.3 — Update VS Code extension with new commands

---

## Phase 5 Completion

- [ ] 5.5.1 — Verify README is live and accurate
- [ ] 5.5.2 — Verify npm package is published
- [ ] 5.5.3 — Update master plan: Phase 5 status → COMPLETE, progress → 12/12
- [ ] 5.5.4 — Update master plan: Overall status → COMPLETE

**Phase 5 Complete: [ ] YES / [ ] NO**

---

## Total Recall — LAUNCH COMPLETE

**When this file is done, context-mem v3.0 "Total Recall" is live.**
