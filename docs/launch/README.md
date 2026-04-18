# docs/launch/ — v4.0.0 Launch Assets

All draft launch communications for the context-mem v4.0.0 "Cognition" release.
These are first drafts — do a final voice pass before posting anything.

---

## Files

| File | Platform | Summary |
|---|---|---|
| [blog-post.md](blog-post.md) | Blog / personal site | ~2,000-word technical post covering both pillars, architecture, honest benchmarks, 10 editor integrations, Context Protocol RFC |
| [hn-show-hn.md](hn-show-hn.md) | Hacker News | Show HN title + ~1,100-char body; includes posting timing notes |
| [twitter-thread.md](twitter-thread.md) | Twitter/X | 10-tweet thread; screenshot placeholders marked; Karpathy tag is optional |
| [reddit-localLLaMA.md](reddit-localLLaMA.md) | /r/LocalLLaMA | Local-first angle: BM25+vector on device, no cloud, honest benchmark disclosure |
| [reddit-ObsidianMD.md](reddit-ObsidianMD.md) | /r/ObsidianMD | Obsidian-first angle: live vault, plugin v1, Answer-as-Page, graph view |
| [reddit-ClaudeAI.md](reddit-ClaudeAI.md) | /r/ClaudeAI | MCP server angle: 60-second setup, tool list, compression for long sessions |

---

## Launch Checklist

- [ ] Review blog post voice — one final read-aloud pass
- [ ] Rehearse 45-60s demo video (Obsidian graph updating live is the key shot)
- [ ] Take screenshots for Twitter thread and Reddit posts:
  - [ ] `vault-entity-page.png` — entity page in Obsidian
  - [ ] `obsidian-graph-live.gif` — graph view updating during a session
  - [ ] `compression-dashboard.png` — `/compression` dashboard page
  - [ ] `obsidian-plugin-sidebar.png` — plugin sidebar pane
  - [ ] `synthesis-graph-update.png` — synthesis in action (for /r/ObsidianMD)
- [ ] Confirm benchmark numbers haven't changed before posting (v4.0 re-run in progress)
- [ ] Schedule HN post for **Thursday 9am ET** (Sunday morning is second-best; avoid Friday)
- [ ] Post Twitter thread after HN goes live (link HN thread in tweet 10 or reply)
- [ ] Post to Reddit subs 2-6 hours after HN post — stagger them, don't cluster
- [ ] Monitor HN comments in the first 2 hours — this is the critical visibility window
- [ ] Respond substantively to GitHub issues and PRs in the first 24 hours
- [ ] Update personal site / portfolio to link release

---

## Claims to verify before posting

The following claims in the drafts are sourced from CHANGELOG and project files. Verify they still hold after the v4.0 benchmark re-run completes:

| Claim | Source | Status |
|---|---|---|
| 97.8% R@5 LongMemEval (pure local) | Pre-v3.4 baseline, CHANGELOG | Honest — note in blog post that v4.0 re-run is in progress |
| 100% R@5 LongMemEval (with Haiku judge) | Pre-v3.4 baseline | Same caveat applies |
| 365 KB → 3.2 KB compression | CHANGELOG v4.0.0 | Sourced — do not fabricate an updated number |
| 99% token savings | Derived from above | Sourced |
| 1253 tests | CHANGELOG v4.0.0: "1182 → 1253 (+71 new)" | Sourced from CHANGELOG — verify `npm test` agrees |
| 10 supported editors | docs/integrations/ directory | Sourced — count files if uncertain |
| 15 summarizers | CHANGELOG list | Sourced — 14 from v3 + Python traceback |
