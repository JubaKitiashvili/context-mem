# Dashboard v2.6.0 — Full Redesign Spec

**Date:** 2026-04-06
**Status:** Approved (autonomous execution)

## Problem

Dashboard audit shows NONE of the v2.4.0–2.5.0 intelligence features are visible in the UI:
- Search uses raw FTS5, not SearchFusion pipeline
- No intent detection display (causal/temporal/lookup/general)
- No block search attention weights
- No reranking visualization
- No authority scores on knowledge entries
- No contradiction detection or resolution UI
- No LLM status indicator
- No merge suggestions queue

The dashboard is a data dump with 17+ panels fighting for attention. Needs an intelligence-first redesign.

## Design Principles

1. **Intelligence-first** — Lead with what the AI features are doing, not raw counts
2. **Actionable** — Surface things that need attention (contradictions, merges)
3. **Progressive disclosure** — Summary first, details on demand
4. **Premium feel** — Subtle animations, refined typography, glass effects
5. **Apple HIG inspired** — Clean hierarchy, generous whitespace, fluid motion

## Design System Changes

### Typography
- **UI text:** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif`
- **Code/data:** `'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace`
- Monospace only where data precision matters (IDs, scores, code snippets)

### Colors (refined from current)
- Backgrounds: `#08080d` (base), `#0f0f17` (card), `#161622` (hover)
- Accent: `#818cf8` (lighter indigo, more modern)
- Same functional palette (green/orange/red/blue/purple/cyan/pink) with adjusted dim variants

### Spacing & Shape
- 8px grid system
- Border-radius: 16px cards, 10px buttons, 24px pills
- Subtle shadows: `0 1px 3px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.15)`
- Glass morphism header: `backdrop-filter: blur(20px); background: rgba(8,8,13,0.8)`

### Animations
- Card hover: `translateY(-2px)` + shadow increase (200ms cubic-bezier)
- Section entrance: fade-in + slide-up (staggered 50ms per card)
- Bar fills: smooth width transition (600ms ease-out)
- Number counters: count-up animation on load
- Toast: slide-in from right, fade-out
- Loading: skeleton shimmer gradient

## Layout Restructure (Home Page)

### Header Bar
- Logo + "context-mem" title
- Navigation pills: Home | Graph | Timeline
- Right side: LLM status chip (provider + dot), theme toggle, connection status

### Section 1: Intelligence Overview (Hero Strip)
4 cards in a horizontal strip:
- **Health Score** — 0-100 with color gradient, breakdown tooltip
- **Search Intelligence** — "SearchFusion active" + plugin chain badges
- **Knowledge Authority** — Average authority, pending contradictions count
- **LLM Integration** — Provider name, model, status (enabled/disabled/unavailable)

### Section 2: Smart Search (Full Width)
- Large search input with search icon
- Results show: intent badge, block source chip, relevance score, reranking indicator
- Search pipeline visualization below results: intent → blocks → plugins → rerank
- Calls enhanced search endpoint (intent classification + reranking)

### Section 3: Stats Grid
- 6 refined stat cards (observations, tokens saved, savings %, searches, DB size, sessions)
- Animated number counters on load

### Section 4: Knowledge & Contradictions (2-col)
**Left:** Knowledge Base
- Category filter pills
- Entries with: title, category badge, authority score bar (0-1), source type chip, access count
- Inline search with FTS5

**Right:** Contradiction & Merge Queue
- Active contradictions: two authority bars side-by-side, suggested action badge
- LLM explanation (if available)
- Merge suggestions with action buttons
- Empty state: "No contradictions detected"

### Section 5: Token Economics & Budget (2-col)
**Left:** Token compression visualization (stacked horizontal bars)
**Right:** Token budget gauge with overflow strategy badge

### Section 6: Activity (2-col)
**Left:** Event stream with priority badges + error-fix patterns
**Right:** Session list with observation counts and time stamps

### Section 7: Session Activity Chart
- 7-day hourly bar chart with date labels
- Export JSON button

### Section 8: System Status (collapsible card)
- Collapses by default to save vertical space
- Contains: DB health, vector search status, compression by type, top files, privacy breakdown, content index

### Section 9: Agents + Knowledge Graph + Observations
- Agents panel (auto-refresh)
- Inline knowledge graph (SVG force layout)
- Observations timeline with search

## New API Endpoints

### `/api/search-fusion`
Enhanced search with intent classification and reranking:
- Classifies query intent (causal/temporal/lookup/general)
- Applies intent-specific reranking weights to FTS5 results
- Returns: results + intent_type + weights_used

### `/api/contradictions`
Returns knowledge entries with potential contradictions:
- Uses FTS5 similarity + word overlap detection
- Computes authority scores for both sides
- Returns: entries with authority_existing, authority_new, suggested_action

### `/api/llm-status`
Returns LLM provider configuration:
- Reads `.context-mem.json` for ai_curation settings
- Checks provider availability
- Returns: provider, model, enabled, available

### `/api/knowledge-authority`
Returns knowledge entries with computed authority scores:
- Computes authority using: sourceWeight, sessionBreadth, accessDensity, recency
- Applies softmax attention over the four signals
- Returns: entries with authority score (0-1)

## Technical Approach

1. **Single-file architecture preserved** — No build step, zero external deps
2. **Backend logic preserved exactly** — All existing query helpers and API endpoints unchanged
3. **Intent classification in JS** — Keyword-based (same logic as TypeScript IntentClassifier)
4. **Authority computation in JS** — Same formula as knowledge-base.ts computeAuthority()
5. **Contradiction detection via FTS5** — Same approach as knowledge-base.ts checkContradictions()
6. **LLM status from config file** — Same approach as vector-status endpoint

## Graph & Timeline Pages

- Updated header to match new design system
- Same core functionality preserved
- Visual consistency with new color palette and typography

## Success Criteria

- All v2.4.0-2.5.0 features visible in dashboard
- Search shows intent type and reranking info
- Knowledge entries show authority scores
- Contradictions have clear resolution UI
- LLM status visible at a glance
- Premium feel: smooth animations, clean typography, good hierarchy
- No functionality regression from current dashboard
- Dark and light themes both work
