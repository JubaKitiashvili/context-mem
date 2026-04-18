'use strict';

// --- Dashboard HTML ---
function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem dashboard</title>
<style>
  :root {
    --bg: #08080d;
    --bg-card: #0f0f17;
    --bg-card-hover: #161622;
    --bg-elevated: #1a1a28;
    --border: #1e1e30;
    --border-subtle: #14141f;
    --text: #e8e8ef;
    --text-dim: #7a7a90;
    --text-muted: #4a4a60;
    --accent: #818cf8;
    --accent-dim: #6366f1;
    --accent-glow: rgba(129, 140, 248, 0.15);
    --green: #34d399;
    --green-dim: rgba(52, 211, 153, 0.12);
    --orange: #fbbf24;
    --orange-dim: rgba(251, 191, 36, 0.12);
    --red: #f87171;
    --red-dim: rgba(248, 113, 113, 0.12);
    --blue: #60a5fa;
    --blue-dim: rgba(96, 165, 250, 0.12);
    --purple: #c084fc;
    --purple-dim: rgba(192, 132, 252, 0.12);
    --cyan: #22d3ee;
    --cyan-dim: rgba(34, 211, 238, 0.12);
    --pink: #f472b6;
    --pink-dim: rgba(244, 114, 182, 0.12);
    --radius: 16px;
    --radius-sm: 10px;
    --radius-xs: 6px;
    --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.2);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.25);
    --font: var(--font-mono);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-ui);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* --- Animations --- */
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes slideDown { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 500px; } }
  @keyframes toastIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(10px); } }

  /* --- Scrollbars --- */
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  /* ========== HEADER ========== */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    border-bottom: 1px solid var(--border);
    background: rgba(8,8,13,0.85);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    gap: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .logo {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.5px;
    flex-shrink: 0;
  }

  .header-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-ui);
    letter-spacing: -0.3px;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
  }

  .nav-link {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    text-decoration: none;
    padding: 4px 12px;
    border-radius: 7px;
    transition: all 0.15s ease;
    font-family: var(--font-ui);
    white-space: nowrap;
  }

  .nav-link:hover { color: var(--text); background: var(--bg-card-hover); }
  .nav-link.active { color: var(--text); background: var(--bg-card); box-shadow: var(--shadow-sm); }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .llm-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--border);
    color: var(--text-dim);
    background: var(--bg-card);
    font-family: var(--font-ui);
    transition: all 0.2s;
    cursor: default;
  }

  .llm-chip.enabled {
    color: var(--green);
    background: var(--green-dim);
    border-color: rgba(52, 211, 153, 0.25);
  }

  .llm-chip .chip-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .llm-chip.enabled .chip-dot { animation: pulse 2s infinite; }

  .refresh-indicator {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .theme-toggle {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font-size: 12px;
    width: 30px;
    height: 30px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  .export-btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: all 0.15s ease;
  }

  .export-btn:hover { border-color: var(--accent); color: var(--accent); }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--green);
    background: var(--green-dim);
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid rgba(52,211,153,0.2);
    font-family: var(--font-ui);
    white-space: nowrap;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    background: var(--green);
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  /* ========== PROJECT BAR ========== */
  .project-bar {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 8px 24px;
  }

  .project-bar-inner {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .project-bar-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .project-pills {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    flex: 1;
    overflow-x: auto;
  }

  .project-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    transition: all 0.15s ease;
    white-space: nowrap;
    user-select: none;
    font-family: var(--font-ui);
  }

  .project-pill:hover { border-color: var(--cyan); color: var(--text); background: var(--bg-card); }
  .project-pill.active { background: var(--cyan-dim); border-color: var(--cyan); color: var(--cyan); font-weight: 600; }
  .project-pill .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .project-pill.skeleton { opacity: 0.4; cursor: default; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; }

  /* ========== MAIN LAYOUT ========== */
  .main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ========== CARD BASE ========== */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    transition: border-color 0.2s ease;
  }

  .card:hover { border-color: rgba(129,140,248,0.15); }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
    color: var(--text);
  }

  .section-title .icon {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    flex-shrink: 0;
  }

  /* ========== INTELLIGENCE STRIP ========== */
  .intel-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .intel-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    transition: all 0.2s ease;
    cursor: default;
    position: relative;
    overflow: hidden;
    animation: fadeInUp 0.4s ease both;
  }

  .intel-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--card-accent, var(--accent));
    opacity: 0.6;
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .intel-card:hover { background: var(--bg-card-hover); transform: translateY(-2px); box-shadow: var(--shadow-md); }

  .intel-card-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    margin-bottom: 10px;
    font-family: var(--font-ui);
  }

  .intel-card-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    font-family: var(--font-mono);
    margin-bottom: 6px;
    transition: color 0.3s ease;
  }

  .intel-card-sub {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-ui);
    line-height: 1.4;
  }

  .intel-card-badges {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .intel-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
    font-family: var(--font-ui);
  }

  .intel-badge.bm25 { background: var(--blue-dim); color: var(--blue); }
  .intel-badge.trigram { background: var(--purple-dim); color: var(--purple); }
  .intel-badge.vector { background: var(--cyan-dim); color: var(--cyan); }
  .intel-badge.llm { background: var(--green-dim); color: var(--green); }

  /* ========== SMART SEARCH ========== */
  .smart-search-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    transition: border-color 0.2s;
  }

  .smart-search-card:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }

  .smart-search-inner {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .smart-search-icon {
    font-size: 14px;
    color: var(--text-muted);
    flex-shrink: 0;
    user-select: none;
  }

  .smart-search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 14px;
    outline: none;
    padding: 4px 0;
  }

  .smart-search-input::placeholder { color: var(--text-muted); }

  .smart-search-hint {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .smart-search-clear {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: all 0.15s;
    display: none;
  }

  .smart-search-clear:hover { border-color: var(--red); color: var(--red); }
  .smart-search-clear.visible { display: block; }

  .smart-search-info {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 0 2px;
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-ui);
    flex-wrap: wrap;
  }

  .smart-search-info.visible { display: flex; }
  .smart-search-info .hl { color: var(--accent); font-weight: 600; }
  .smart-search-info .pipe { color: var(--border); }

  .smart-search-results {
    margin-top: 12px;
    display: none;
  }

  .smart-search-results.visible { display: block; animation: fadeInUp 0.2s ease; }

  .sfusion-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border-bottom: 1px solid var(--border-subtle);
    transition: background 0.15s;
    cursor: pointer;
    animation: slideIn 0.15s ease both;
  }

  .sfusion-result:hover { background: var(--bg-elevated); }
  .sfusion-result:last-child { border-bottom: none; }

  .sfusion-intent-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .intent-causal { background: var(--red-dim); color: var(--red); }
  .intent-recent { background: var(--blue-dim); color: var(--blue); }
  .intent-similar { background: var(--purple-dim); color: var(--purple); }
  .intent-decision { background: var(--orange-dim); color: var(--orange); }
  .intent-error { background: var(--red-dim); color: var(--red); }
  .intent-file { background: var(--cyan-dim); color: var(--cyan); }
  .intent-default { background: var(--bg-elevated); color: var(--text-dim); }

  .sfusion-type-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .sfusion-summary {
    flex: 1;
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-ui);
  }

  .sfusion-relevance {
    width: 48px;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .sfusion-relevance-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .sfusion-time {
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
    font-family: var(--font-mono);
    min-width: 44px;
    text-align: right;
  }

  .sfusion-pipeline {
    margin-top: 10px;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border-radius: var(--radius-xs);
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    display: none;
  }

  .sfusion-pipeline.visible { display: block; }
  .sfusion-pipeline .arrow { color: var(--accent); margin: 0 4px; }

  /* ========== STATS GRID ========== */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
    transition: all 0.2s ease;
    cursor: default;
  }

  .stat-card:hover { background: var(--bg-card-hover); border-color: rgba(129,140,248,0.2); transform: translateY(-1px); }

  .stat-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 8px;
    font-family: var(--font-ui);
  }

  .stat-value {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -1px;
    line-height: 1;
    font-family: var(--font-mono);
    transition: color 0.3s ease;
  }

  .stat-sub {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 5px;
    font-family: var(--font-ui);
  }

  .stat-value.green { color: var(--green); }
  .stat-value.blue { color: var(--blue); }
  .stat-value.purple { color: var(--purple); }
  .stat-value.orange { color: var(--orange); }

  /* ========== TOKEN ECONOMICS ========== */
  .token-bar-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }

  .token-comparison { display: flex; flex-direction: column; gap: 12px; }

  .token-row { display: flex; align-items: center; gap: 12px; }

  .token-label {
    font-size: 11px;
    color: var(--text-dim);
    width: 80px;
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .token-bar-bg {
    flex: 1;
    height: 22px;
    background: var(--bg-elevated);
    border-radius: var(--radius-xs);
    overflow: hidden;
    position: relative;
  }

  .token-bar-fill {
    height: 100%;
    border-radius: var(--radius-xs);
    transition: width 0.6s ease;
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 10px;
    font-weight: 600;
    color: white;
    font-family: var(--font-mono);
  }

  .token-bar-fill.original { background: var(--red); opacity: 0.7; }
  .token-bar-fill.saved { background: var(--green); }
  .token-bar-fill.summary { background: var(--accent); }

  .token-number {
    font-size: 11px;
    color: var(--text-dim);
    width: 72px;
    text-align: right;
    flex-shrink: 0;
    font-family: var(--font-mono);
  }

  /* ========== TYPE BREAKDOWN ========== */
  .type-grid { display: flex; gap: 6px; flex-wrap: wrap; }

  .type-tag {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--border);
    transition: all 0.15s ease;
    cursor: pointer;
    font-family: var(--font-ui);
  }

  .type-tag:hover { border-color: var(--accent); }
  .type-tag.active { border-color: var(--accent); background: var(--accent-glow); }

  .type-tag .count {
    background: var(--bg-elevated);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
    font-family: var(--font-mono);
  }

  .type-dot { width: 7px; height: 7px; border-radius: 50%; }
  .type-code { background: var(--blue); }
  .type-error { background: var(--red); }
  .type-log { background: var(--orange); }
  .type-test { background: var(--green); }
  .type-commit { background: var(--purple); }
  .type-decision { background: var(--pink); }
  .type-context { background: var(--cyan); }

  /* ========== SESSIONS ========== */
  .sessions-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    max-height: 300px;
    overflow-y: auto;
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 11px;
    border-radius: var(--radius-xs);
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
  }

  .session-row:last-child { border-bottom: none; }
  .session-row:hover { background: var(--bg-card-hover); }
  .session-row.active { background: var(--accent-glow); border-left: 2px solid var(--accent); padding-left: 9px; }

  .session-id {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .session-meta {
    display: flex;
    gap: 14px;
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-ui);
  }

  /* ========== KNOWLEDGE & CONTRADICTIONS ========== */
  .knowledge-category {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    padding: 3px 9px;
    border-radius: var(--radius-xs);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.15s;
    font-family: var(--font-ui);
    font-weight: 500;
  }

  .knowledge-category:hover { border-color: var(--accent); }
  .knowledge-category.active { border-color: var(--accent); background: var(--accent-glow); }

  .knowledge-category .cat-count {
    font-size: 9px;
    color: var(--text-muted);
    background: var(--bg-card);
    padding: 0 4px;
    border-radius: 4px;
    font-family: var(--font-mono);
  }

  .cat-pattern { color: var(--blue); }
  .cat-decision { color: var(--purple); }
  .cat-error { color: var(--red); }
  .cat-api { color: var(--cyan); }
  .cat-component { color: var(--green); }

  .knowledge-item {
    padding: 9px 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 11px;
  }

  .knowledge-item:last-child { border-bottom: none; }

  .knowledge-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .knowledge-item-title { font-weight: 600; color: var(--text); font-family: var(--font-ui); font-size: 12px; }

  .knowledge-item-cat {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-family: var(--font-ui);
    font-weight: 600;
  }

  .knowledge-item-content {
    color: var(--text-dim);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-ui);
    margin-bottom: 5px;
  }

  .knowledge-item-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .authority-bar-wrap {
    flex: 1;
    min-width: 60px;
    max-width: 120px;
    height: 3px;
    background: var(--bg-elevated);
    border-radius: 2px;
    overflow: hidden;
  }

  .authority-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  .auth-high { background: var(--green); }
  .auth-mid { background: var(--orange); }
  .auth-low { background: var(--red); }

  .knowledge-meta-text {
    font-size: 9px;
    color: var(--text-muted);
    font-family: var(--font-ui);
  }

  .source-chip {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    font-family: var(--font-ui);
    font-weight: 500;
  }

  .source-chip.knowledge { background: var(--purple-dim); color: var(--purple); }
  .source-chip.observation { background: var(--blue-dim); color: var(--blue); }
  .source-chip.content { background: var(--cyan-dim); color: var(--cyan); }

  /* --- Contradictions --- */
  .contradiction-item {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    margin-bottom: 8px;
    background: var(--bg-elevated);
    font-size: 11px;
    animation: fadeInUp 0.2s ease both;
  }

  .contradiction-item:last-child { margin-bottom: 0; }

  .contradiction-titles {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 8px;
    font-family: var(--font-ui);
  }

  .contradiction-title {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contradiction-vs {
    font-size: 9px;
    color: var(--text-muted);
    padding: 2px 6px;
    background: var(--border);
    border-radius: 4px;
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .contradiction-auth-bars {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: center;
  }

  .contradiction-auth-side {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .contradiction-auth-label {
    font-size: 9px;
    color: var(--text-muted);
    font-family: var(--font-ui);
  }

  .contradiction-auth-bar {
    height: 4px;
    background: var(--bg);
    border-radius: 2px;
    overflow: hidden;
  }

  .contradiction-auth-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s;
  }

  .action-badge {
    font-size: 9px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
    font-family: var(--font-ui);
    flex-shrink: 0;
  }

  .action-keep_existing { background: var(--green-dim); color: var(--green); }
  .action-replace { background: var(--orange-dim); color: var(--orange); }
  .action-merge { background: var(--purple-dim); color: var(--purple); }

  /* ========== EVENTS & SNAPSHOTS ========== */
  .event-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 11px;
  }

  .event-item:last-child { border-bottom: none; }

  .event-priority {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
    font-family: var(--font-ui);
  }

  .event-p1 { background: var(--red-dim); color: var(--red); }
  .event-p2 { background: var(--orange-dim); color: var(--orange); }
  .event-p3 { background: var(--blue-dim); color: var(--blue); }
  .event-p4 { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border); }

  .event-body { flex: 1; min-width: 0; }
  .event-type { font-weight: 600; color: var(--text); font-family: var(--font-ui); }
  .event-data { color: var(--text-dim); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-ui); }
  .event-time { font-size: 9px; color: var(--text-muted); flex-shrink: 0; font-family: var(--font-mono); }

  .event-type-dist { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }

  .event-type-tag {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: var(--radius-xs);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    font-family: var(--font-ui);
  }

  .error-fix-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 10px;
    border-radius: var(--radius-xs);
    background: var(--green-dim);
    margin-bottom: 4px;
    font-family: var(--font-ui);
  }

  .error-fix-icon { color: var(--green); font-weight: 700; }

  /* ========== SNAPSHOTS ========== */
  .snapshot-item { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); font-size: 11px; }
  .snapshot-item:last-child { border-bottom: none; }
  .snapshot-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .snapshot-session { font-weight: 600; color: var(--text); font-size: 11px; font-family: var(--font-mono); }
  .snapshot-time { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }
  .snapshot-stats { display: flex; gap: 10px; font-size: 10px; color: var(--text-dim); }
  .snapshot-stat-val { font-weight: 600; color: var(--green); font-family: var(--font-mono); }

  /* ========== ACTIVITY CHART ========== */
  .activity-chart {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 80px;
    padding: 4px 0;
  }

  .activity-bar {
    flex: 1;
    min-width: 3px;
    max-width: 20px;
    background: var(--accent);
    border-radius: 3px 3px 0 0;
    transition: height 0.3s ease;
    opacity: 0.6;
    cursor: pointer;
  }

  .activity-bar:hover { opacity: 1; }

  .activity-labels {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 4px;
    font-family: var(--font-ui);
  }

  /* ========== COMPRESSION & SYSTEM ========== */
  .compression-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }

  .compression-type {
    font-size: 11px;
    width: 65px;
    flex-shrink: 0;
    color: var(--text-dim);
    font-family: var(--font-ui);
  }

  .compression-bar-bg {
    flex: 1;
    height: 16px;
    background: var(--bg-elevated);
    border-radius: 4px;
    overflow: hidden;
  }

  .compression-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
    display: flex;
    align-items: center;
    padding-left: 6px;
    font-size: 9px;
    font-weight: 600;
    color: white;
  }

  .compression-stats {
    font-size: 10px;
    color: var(--text-muted);
    width: 42px;
    text-align: right;
    flex-shrink: 0;
    font-family: var(--font-mono);
  }

  /* ========== TOP FILES ========== */
  .file-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--border-subtle); }
  .file-row:last-child { border-bottom: none; }
  .file-rank { font-size: 10px; color: var(--text-muted); width: 16px; text-align: center; font-family: var(--font-mono); }
  .file-path { flex: 1; font-size: 11px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
  .file-count { font-size: 10px; color: var(--accent); font-weight: 600; flex-shrink: 0; font-family: var(--font-mono); }

  /* ========== PRIVACY ========== */
  .privacy-bar { display: flex; height: 24px; border-radius: var(--radius-xs); overflow: hidden; margin-bottom: 10px; }
  .privacy-segment { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: white; transition: width 0.4s ease; min-width: 28px; }
  .privacy-public { background: var(--green); }
  .privacy-private { background: var(--orange); }
  .privacy-redacted { background: var(--red); }
  .privacy-legend { display: flex; gap: 14px; justify-content: center; }
  .privacy-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-dim); font-family: var(--font-ui); }
  .privacy-legend-dot { width: 7px; height: 7px; border-radius: 50%; }

  /* ========== BUDGET ========== */
  .budget-section { position: relative; }
  .budget-bar-bg { height: 18px; background: var(--bg-elevated); border-radius: var(--radius-xs); overflow: hidden; margin-top: 8px; }
  .budget-bar-fill {
    height: 100%;
    border-radius: var(--radius-xs);
    transition: width 0.5s ease;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 6px;
    font-size: 10px;
    font-weight: 600;
    color: white;
    font-family: var(--font-mono);
  }
  .budget-bar-fill.ok { background: var(--green); }
  .budget-bar-fill.warn { background: var(--orange); }
  .budget-bar-fill.danger { background: var(--red); }
  .budget-meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--text-muted); font-family: var(--font-ui); }
  .budget-strategy { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 6px; font-family: var(--font-ui); }
  .strategy-warn { background: var(--orange-dim); color: var(--orange); }
  .strategy-aggressive_truncation { background: var(--red-dim); color: var(--red); }
  .strategy-hard_stop { background: var(--red-dim); color: var(--red); }

  /* ========== SYSTEM STATUS (COLLAPSIBLE) ========== */
  .system-status-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .system-status-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .system-status-header:hover { background: var(--bg-card-hover); }

  .system-status-toggle {
    font-size: 12px;
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }

  .system-status-toggle.open { transform: rotate(180deg); }

  .system-status-body {
    display: none;
    padding: 0 20px 20px;
    flex-direction: column;
    gap: 16px;
  }

  .system-status-body.open { display: flex; }

  /* ========== CONTENT SOURCES ========== */
  .source-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); font-size: 11px; }
  .source-item:last-child { border-bottom: none; }
  .source-name { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-ui); }
  .source-meta { display: flex; gap: 8px; font-size: 10px; color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); }
  .source-chunks { font-size: 9px; padding: 1px 6px; border-radius: 8px; background: var(--blue-dim); color: var(--blue); }
  .source-code { font-size: 9px; padding: 1px 6px; border-radius: 8px; background: var(--green-dim); color: var(--green); }

  /* ========== OBSERVATION TIMELINE ========== */
  .timeline-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    max-height: 620px;
    overflow-y: auto;
  }

  .timeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    max-width: 400px;
    min-width: 200px;
  }

  .search-input {
    flex: 1;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 7px 12px;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  .search-input::placeholder { color: var(--text-muted); }

  .search-clear {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font-size: 11px;
    padding: 5px 10px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: all 0.15s ease;
    display: none;
  }

  .search-clear:hover { border-color: var(--red); color: var(--red); }
  .search-clear.visible { display: block; }

  .search-info {
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px 0;
    display: none;
    font-family: var(--font-ui);
  }

  .search-info.visible { display: flex; align-items: center; gap: 8px; }
  .search-info .count { color: var(--accent); font-weight: 600; font-family: var(--font-mono); }
  .search-info .query { color: var(--text); }

  .highlight { background: rgba(129, 140, 248, 0.25); color: var(--text); border-radius: 2px; padding: 0 2px; }

  /* ========== OBSERVATION ITEMS ========== */
  .obs-item {
    display: flex;
    gap: 12px;
    padding: 11px 10px;
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
  }

  .obs-item:last-child { border-bottom: none; }
  .obs-item:hover { background: var(--bg-card-hover); }

  .obs-type-indicator { width: 2px; border-radius: 2px; flex-shrink: 0; }
  .obs-body { flex: 1; min-width: 0; }

  .obs-header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 4px;
  }

  .obs-type-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-family: var(--font-ui);
  }

  .badge-code { background: var(--blue-dim); color: var(--blue); }
  .badge-error { background: var(--red-dim); color: var(--red); }
  .badge-log { background: var(--orange-dim); color: var(--orange); }
  .badge-test { background: var(--green-dim); color: var(--green); }
  .badge-commit { background: var(--purple-dim); color: var(--purple); }
  .badge-decision { background: var(--pink-dim); color: var(--pink); }
  .badge-context { background: var(--cyan-dim); color: var(--cyan); }

  .obs-time { font-size: 10px; color: var(--text-muted); margin-left: auto; font-family: var(--font-mono); }

  .obs-summary {
    font-size: 12px;
    color: var(--text);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-family: var(--font-ui);
  }

  .obs-id { font-size: 10px; color: var(--text-muted); margin-top: 3px; font-family: var(--font-mono); }

  /* ========== DETAIL PANEL ========== */
  .obs-detail {
    margin-top: 8px;
    padding: 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    animation: slideDown 0.15s ease;
    display: none;
  }

  .obs-detail.open { display: block; }

  .detail-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }

  .detail-chip {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: var(--radius-xs);
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-ui);
  }

  .detail-chip .label { color: var(--text-muted); }
  .detail-chip .value { color: var(--text); font-family: var(--font-mono); }
  .detail-chip.savings .value { color: var(--green); }

  .detail-content {
    font-size: 11px;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    padding: 10px 12px;
    max-height: 250px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
  }

  .detail-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 4px;
    margin-top: 10px;
    font-family: var(--font-ui);
  }

  .detail-label:first-child { margin-top: 0; }

  .detail-summary-text {
    font-size: 12px;
    color: var(--accent);
    line-height: 1.5;
    margin-bottom: 4px;
    font-family: var(--font-ui);
  }

  /* ========== GRAPH ========== */
  .graph-section { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }

  .graph-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }

  .graph-controls input, .graph-controls select {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font-ui);
    outline: none;
  }

  .graph-controls input:focus, .graph-controls select:focus { border-color: var(--accent); }

  .graph-controls button {
    background: var(--accent);
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 14px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: background 0.15s;
  }

  .graph-controls button:hover { background: var(--accent-dim); }

  .graph-canvas {
    width: 100%;
    height: 400px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    position: relative;
    background: var(--bg);
  }

  .graph-canvas svg { width: 100%; height: 100%; }
  .graph-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 13px; font-family: var(--font-ui); }

  .graph-tooltip {
    position: absolute;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 12px;
    color: var(--text);
    pointer-events: none;
    z-index: 50;
    max-width: 280px;
    box-shadow: var(--shadow-lg);
    display: none;
    font-family: var(--font-ui);
  }

  .graph-tooltip .tt-name { font-weight: 600; margin-bottom: 4px; }
  .graph-tooltip .tt-type { color: var(--text-dim); font-size: 11px; }

  .graph-node-label { font-size: 10px; fill: var(--text); pointer-events: none; text-anchor: middle; dominant-baseline: central; }

  .graph-stats { display: flex; gap: 16px; margin-top: 10px; font-size: 11px; color: var(--text-dim); font-family: var(--font-ui); }

  /* ========== AGENTS ========== */
  .agents-section { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .agents-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }

  .agent-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    transition: border-color 0.15s;
  }

  .agent-card:hover { border-color: var(--accent); }

  .agent-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
  }

  .agent-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .agent-status-dot.active { background: var(--green); animation: pulse 2s infinite; }
  .agent-status-dot.idle { background: var(--orange); }
  .agent-status-dot.offline { background: var(--text-muted); }

  .agent-detail { font-size: 11px; color: var(--text-dim); margin-top: 4px; line-height: 1.5; font-family: var(--font-ui); }
  .agent-detail strong { color: var(--text); font-weight: 500; }
  .agent-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

  .agent-file-tag { font-size: 10px; padding: 2px 8px; background: var(--blue-dim); color: var(--blue); border-radius: 10px; font-family: var(--font-mono); }
  .agents-empty { color: var(--text-muted); font-size: 12px; padding: 20px 0; text-align: center; font-family: var(--font-ui); }

  /* ========== DB HEALTH ========== */
  .health-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .health-item { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid var(--border-subtle); font-size: 11px; }
  .health-item:last-child { border-bottom: none; }
  .health-label { color: var(--text-muted); font-family: var(--font-ui); }
  .health-value { color: var(--text); font-weight: 500; font-family: var(--font-mono); }
  .health-ok { color: var(--green); }
  .health-warn { color: var(--orange); }
  .health-err { color: var(--red); }

  /* ========== MODALS ========== */
  .shortcuts-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.65);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 200;
    backdrop-filter: blur(8px);
  }

  .shortcuts-overlay.open { display: flex; }

  .shortcuts-panel {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    min-width: 340px;
    max-width: 420px;
    box-shadow: var(--shadow-lg);
    animation: fadeInUp 0.2s ease;
  }

  .shortcuts-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; font-family: var(--font-ui); }

  .shortcut-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
  .shortcut-desc { font-size: 12px; color: var(--text-dim); font-family: var(--font-ui); }

  .shortcut-key {
    font-size: 11px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    padding: 2px 8px;
    color: var(--text);
    font-family: var(--font-mono);
  }

  .fullscreen-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.75);
    display: none;
    z-index: 250;
    backdrop-filter: blur(8px);
    padding: 40px;
  }

  .fullscreen-overlay.open { display: flex; flex-direction: column; }

  .fullscreen-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-shrink: 0; }
  .fullscreen-header-left { display: flex; align-items: center; gap: 10px; }

  .fullscreen-close {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: all 0.15s;
  }

  .fullscreen-close:hover { border-color: var(--red); color: var(--red); }

  .fullscreen-content {
    flex: 1;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 20px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: all 0.15s;
  }

  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .copy-btn.copied { border-color: var(--green); color: var(--green); }

  /* ========== TOAST ========== */
  .toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 300; display: flex; flex-direction: column; gap: 8px; }

  .toast {
    background: var(--bg-card);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font-size: 12px;
    color: var(--text);
    box-shadow: var(--shadow-lg);
    animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 360px;
    font-family: var(--font-ui);
  }

  .toast .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); flex-shrink: 0; }

  /* ========== SAVINGS CALLOUT ========== */
  .savings-callout {
    background: var(--green-dim);
    border: 1px solid rgba(52, 211, 153, 0.2);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .savings-callout-icon {
    width: 34px;
    height: 34px;
    background: var(--green);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 800;
    font-size: 13px;
    flex-shrink: 0;
  }

  .savings-callout-text { font-size: 12px; color: var(--text); line-height: 1.5; font-family: var(--font-ui); }
  .savings-callout-text strong { color: var(--green); }

  /* ========== INIT & VECTOR BANNERS ========== */
  .init-banner {
    background: var(--orange-dim);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--radius-sm);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    animation: fadeInUp 0.3s ease;
  }

  .init-banner-icon {
    width: 36px;
    height: 36px;
    background: var(--orange);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
  }

  .init-banner-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; font-family: var(--font-ui); }
  .init-banner-text strong { color: var(--orange); }
  .init-banner-text .init-editors { color: var(--text-muted); font-size: 12px; margin-top: 2px; }

  .init-banner-btn {
    background: var(--orange);
    color: #000;
    border: none;
    padding: 8px 18px;
    border-radius: var(--radius-xs);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    font-family: var(--font-ui);
  }

  .init-banner-btn:hover { opacity: 0.85; }
  .init-banner-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .init-banner-progress {
    display: none;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    font-size: 12px;
    color: var(--orange);
    font-family: var(--font-ui);
  }

  .init-banner-progress .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--orange-dim);
    border-top-color: var(--orange);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .init-banner.success { background: var(--green-dim); border-color: rgba(52, 211, 153, 0.2); }
  .init-banner.success .init-banner-icon { background: var(--green); }
  .init-banner.success .init-banner-text strong { color: var(--green); }

  /* Vector banner */
  .vector-banner {
    border-radius: var(--radius-sm);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    animation: fadeInUp 0.3s ease;
  }

  .vector-banner.available { background: var(--purple-dim); border: 1px solid rgba(192, 132, 252, 0.2); }
  .vector-banner.missing-pkg { background: var(--orange-dim); border: 1px solid rgba(251, 191, 36, 0.2); }
  .vector-banner.active { background: var(--green-dim); border: 1px solid rgba(52, 211, 153, 0.2); }
  .vector-banner.ready { background: var(--cyan-dim); border: 1px solid rgba(34, 211, 238, 0.2); }

  .vector-banner-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .vector-banner.available .vector-banner-icon { background: var(--purple); }
  .vector-banner.missing-pkg .vector-banner-icon { background: var(--orange); }
  .vector-banner.active .vector-banner-icon { background: var(--green); }
  .vector-banner.ready .vector-banner-icon { background: var(--cyan); }

  .vector-banner-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; font-family: var(--font-ui); }
  .vector-banner-text strong { color: inherit; }
  .vector-banner.available .vector-banner-text strong { color: var(--purple); }
  .vector-banner.missing-pkg .vector-banner-text strong { color: var(--orange); }
  .vector-banner.active .vector-banner-text strong { color: var(--green); }
  .vector-banner.ready .vector-banner-text strong { color: var(--cyan); }
  .vector-banner-sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }

  .vector-banner-btn {
    border: none;
    padding: 8px 18px;
    border-radius: var(--radius-xs);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    color: #000;
    font-family: var(--font-ui);
  }

  .vector-banner.available .vector-banner-btn { background: var(--purple); }
  .vector-banner.missing-pkg .vector-banner-btn { background: var(--orange); }
  .vector-banner-btn:hover { opacity: 0.85; }
  .vector-banner-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .vector-banner-progress {
    display: none;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    font-size: 12px;
    color: var(--purple);
    font-family: var(--font-ui);
  }

  .vector-banner-progress .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--purple-dim);
    border-top-color: var(--purple);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ========== LAYOUTS ========== */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .three-col {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  /* ========== MISC ========== */
  .empty-state { text-align: center; padding: 32px 20px; color: var(--text-dim); }
  .empty-state .icon { font-size: 28px; margin-bottom: 10px; }
  .empty-state p { font-size: 12px; font-family: var(--font-ui); }

  /* ========== FOOTER ========== */
  .footer {
    text-align: center;
    padding: 20px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    font-family: var(--font-ui);
  }

  .footer a { color: var(--accent); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  /* ========== LIGHT THEME ========== */
  body.light {
    --bg: #f8f8fb;
    --bg-card: #ffffff;
    --bg-card-hover: #f3f3f8;
    --bg-elevated: #eeeef4;
    --border: #e2e2ea;
    --border-subtle: #ececf2;
    --text: #1a1a2e;
    --text-dim: #5a5a72;
    --text-muted: #9090a8;
  }

  body.light .header { background: rgba(248,248,251,0.9); }
  body.light .fullscreen-content { background: #fafafa; }
  body.light .toast { box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  body.light .graph-tooltip { background: #fff; border: 1px solid #ddd; color: #333; }
  body.light .agent-card { background: var(--bg-elevated); }
  body.light .init-banner { background: rgba(251, 191, 36, 0.08); }
  body.light .init-banner.success { background: rgba(52, 211, 153, 0.08); }
  body.light .vector-banner.available { background: rgba(192, 132, 252, 0.08); }
  body.light .vector-banner.missing-pkg { background: rgba(251, 191, 36, 0.08); }
  body.light .vector-banner.active { background: rgba(52, 211, 153, 0.08); }
  body.light .vector-banner.ready { background: rgba(34, 211, 238, 0.08); }

  /* ========== RESPONSIVE ========== */
  @media (max-width: 1024px) {
    .intel-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 768px) {
    .two-col { grid-template-columns: 1fr; }
    .three-col { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .main { padding: 16px; }
    .intel-grid { grid-template-columns: repeat(2, 1fr); }
    .header { padding: 0 16px; }
    .nav-links { display: none; }
  }

  @media (max-width: 480px) {
    .stats-grid { grid-template-columns: 1fr; }
    .intel-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>

<!-- ===== HEADER ===== -->
<header class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <span class="header-title">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
    <nav class="nav-links">
      <a href="/" class="nav-link active">Home</a>
      <a href="/topics" class="nav-link">Topics</a>
      <a href="/graph" class="nav-link">Graph</a>
      <a href="/timeline" class="nav-link">Timeline</a>
      <a href="/trail" class="nav-link">Trail</a>
      <a href="/narrative" class="nav-link">Narrative</a>
      <a href="/diagnostics" class="nav-link">Diagnostics</a>
      <a href="/compression" class="nav-link">Compression</a>
    </nav>
  </div>
  <div class="header-right">
    <div class="llm-chip" id="llmChip">
      <span class="chip-dot"></span>
      <span id="llmChipLabel">No LLM</span>
    </div>
    <div class="refresh-indicator" id="refreshInfo">auto-refresh: 3s</div>
    <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
    <button class="export-btn" onclick="document.getElementById('shortcutsOverlay').classList.add('open')" title="Keyboard shortcuts">?</button>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="statusText">connected</span>
    </div>
  </div>
</header>

<!-- ===== PROJECT BAR ===== -->
<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="main">

  <!-- ===== INTELLIGENCE STRIP ===== -->
  <div class="intel-grid">
    <!-- Health Score -->
    <div class="intel-card" style="--card-accent: var(--green);" id="intel-health">
      <div class="intel-card-label">Memory Health</div>
      <div class="intel-card-value" id="intelHealthScore" style="color:var(--green);">--</div>
      <div class="intel-card-sub" id="intelHealthSub">Calculating...</div>
    </div>
    <!-- Search Intelligence -->
    <div class="intel-card" style="--card-accent: var(--blue);" id="intel-search">
      <div class="intel-card-label">Search Intelligence</div>
      <div class="intel-card-value" style="font-size:18px;color:var(--blue);">SearchFusion</div>
      <div class="intel-card-badges" id="intelSearchBadges">
        <span class="intel-badge bm25">BM25</span>
        <span class="intel-badge trigram">Trigram</span>
      </div>
    </div>
    <!-- Knowledge Authority -->
    <div class="intel-card" style="--card-accent: var(--purple);" id="intel-knowledge">
      <div class="intel-card-label">Knowledge Authority</div>
      <div class="intel-card-value" id="intelAuthScore" style="color:var(--purple);">--</div>
      <div class="intel-card-sub" id="intelAuthSub">Loading...</div>
    </div>
    <!-- LLM Integration -->
    <div class="intel-card" style="--card-accent: var(--cyan);" id="intel-llm">
      <div class="intel-card-label">LLM Integration</div>
      <div class="intel-card-value" id="intelLlmValue" style="font-size:18px;color:var(--text-dim);">Disabled</div>
      <div class="intel-card-sub" id="intelLlmSub">No provider configured</div>
    </div>
    <!-- Memory Tiers -->
    <div class="intel-card" style="--card-accent: var(--orange);" id="intel-tiers">
      <div class="intel-card-label">Memory Tiers</div>
      <div class="intel-card-value" id="intelTiersValue" style="font-size:16px;color:var(--orange);">--</div>
      <div class="intel-card-sub" id="intelTiersSub">Loading...</div>
    </div>
    <!-- Entities -->
    <div class="intel-card" style="--card-accent: var(--pink);" id="intel-entities" onclick="window.location='/#entities-section'">
      <div class="intel-card-label">Entities</div>
      <div class="intel-card-value" id="intelEntitiesValue" style="color:var(--pink);">--</div>
      <div class="intel-card-sub" id="intelEntitiesSub">Loading...</div>
    </div>
    <!-- Pressure Alert -->
    <div class="intel-card" style="--card-accent: var(--red);" id="intel-pressure" onclick="document.getElementById('pressureSection')?.scrollIntoView({behavior:'smooth'})">
      <div class="intel-card-label">At Risk</div>
      <div class="intel-card-value" id="intelPressureValue" style="color:var(--green);">0</div>
      <div class="intel-card-sub" id="intelPressureSub">No entries at risk</div>
    </div>
  </div>

  <!-- ===== SMART SEARCH ===== -->
  <div class="smart-search-card">
    <div class="smart-search-inner">
      <span class="smart-search-icon">&#x2315;</span>
      <input type="text" class="smart-search-input" id="smartSearchInput" placeholder="Smart search — find 'auth problem' when stored as 'login token expired'..." autocomplete="off" spellcheck="false">
      <span class="smart-search-hint">&#x23CE; Enter</span>
      <button class="smart-search-clear" id="smartSearchClear">Clear</button>
    </div>
    <div class="search-filters" style="display:flex;gap:8px;padding:4px 12px;flex-wrap:wrap;align-items:center;">
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim);cursor:pointer;">
        <input type="checkbox" id="verbatimToggle" style="accent-color:var(--accent);"> Verbatim
      </label>
      <select id="importanceFilter" style="font-size:11px;background:var(--bg-elevated);color:var(--text-dim);border:1px solid var(--border);border-radius:var(--radius-xs);padding:2px 6px;">
        <option value="">Any importance</option>
        <option value="0.9">&#x2265; 0.9 Critical</option>
        <option value="0.7">&#x2265; 0.7 High</option>
        <option value="0.5">&#x2265; 0.5 Medium</option>
        <option value="0.3">&#x2265; 0.3 Low</option>
      </select>
      <select id="topicFilter" style="font-size:11px;background:var(--bg-elevated);color:var(--text-dim);border:1px solid var(--border);border-radius:var(--radius-xs);padding:2px 6px;">
        <option value="">All topics</option>
      </select>
      <div id="flagFilters" style="display:flex;gap:3px;">
        <span class="flag-pill" data-flag="DECISION" onclick="toggleFlag(this)" style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--purple-dim);color:var(--purple);cursor:pointer;border:1px solid transparent;">DECISION</span>
        <span class="flag-pill" data-flag="MILESTONE" onclick="toggleFlag(this)" style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--green-dim);color:var(--green);cursor:pointer;border:1px solid transparent;">MILESTONE</span>
        <span class="flag-pill" data-flag="PROBLEM" onclick="toggleFlag(this)" style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--red-dim);color:var(--red);cursor:pointer;border:1px solid transparent;">PROBLEM</span>
      </div>
    </div>
    <div class="smart-search-info" id="smartSearchInfo">
      <span>Found <span class="hl" id="sfResultCount">0</span> results</span>
      <span class="pipe">|</span>
      <span>Intent: <span class="hl" id="sfIntent">-</span></span>
      <span class="pipe">|</span>
      <span id="sfWeightsInfo" style="color:var(--text-muted);"></span>
    </div>
    <div class="smart-search-results" id="smartSearchResults">
      <div id="sfResultsList"></div>
      <div class="sfusion-pipeline" id="sfPipeline"></div>
    </div>
  </div>

  <!-- ===== STATS GRID ===== -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Observations</div>
      <div class="stat-value blue" id="statObs">-</div>
      <div class="stat-sub" id="statObsSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Tokens saved</div>
      <div class="stat-value green" id="statSaved">-</div>
      <div class="stat-sub" id="statSavedSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Savings %</div>
      <div class="stat-value green" id="statPct">-</div>
      <div class="stat-sub">compression ratio</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Searches</div>
      <div class="stat-value purple" id="statSearches">-</div>
      <div class="stat-sub" id="statSearchSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">DB size</div>
      <div class="stat-value orange" id="statDb">-</div>
      <div class="stat-sub" id="statDbSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sessions</div>
      <div class="stat-value" id="statSessions" style="color:var(--accent);">-</div>
      <div class="stat-sub" id="statSessionsSub"></div>
    </div>
  </div>

  <!-- ===== INIT BANNER ===== -->
  <div class="init-banner" id="initBanner" style="display:none;">
    <div class="init-banner-icon">!</div>
    <div class="init-banner-text">
      <div><strong>Setup recommended</strong> — Run <code>context-mem init</code> to auto-configure editor rules and project settings.</div>
      <div class="init-editors" id="initEditors"></div>
    </div>
    <div class="init-banner-progress" id="initProgress">
      <div class="spinner"></div>
      Running init...
    </div>
    <button class="init-banner-btn" id="initBtn" onclick="runInit()">Run Init</button>
  </div>

  <!-- ===== VECTOR BANNER ===== -->
  <div class="vector-banner available" id="vectorBanner" style="display:none;">
    <div class="vector-banner-icon" id="vectorIcon">V</div>
    <div class="vector-banner-text" id="vectorText"></div>
    <div class="vector-banner-progress" id="vectorProgress">
      <div class="spinner"></div>
      Updating config...
    </div>
    <button class="vector-banner-btn" id="vectorBtn" style="display:none;"></button>
  </div>

  <!-- ===== SAVINGS CALLOUT ===== -->
  <div class="savings-callout" id="savingsCallout" style="display:none;">
    <div class="savings-callout-icon">S</div>
    <div class="savings-callout-text" id="savingsText"></div>
  </div>

  <!-- ===== TOTAL RECALL: MEMORY TIERS ===== -->
  <div class="token-bar-section" id="tiersSection">
    <div class="section-title">
      <div class="icon" style="background:var(--orange-dim);color:var(--orange);">&#x2630;</div>
      Compression Tiers
    </div>
    <div id="tiersBars" style="display:flex;flex-direction:column;gap:6px;">
      <div class="token-row"><div class="token-label" style="color:var(--blue);">Verbatim</div><div class="token-bar-bg"><div class="token-bar-fill" id="tierVerbatim" style="width:0%;background:var(--blue);"></div></div><div class="token-number" id="tierVerbatimN">0</div></div>
      <div class="token-row"><div class="token-label" style="color:var(--green);">Light</div><div class="token-bar-bg"><div class="token-bar-fill" id="tierLight" style="width:0%;background:var(--green);"></div></div><div class="token-number" id="tierLightN">0</div></div>
      <div class="token-row"><div class="token-label" style="color:var(--orange);">Medium</div><div class="token-bar-bg"><div class="token-bar-fill" id="tierMedium" style="width:0%;background:var(--orange);"></div></div><div class="token-number" id="tierMediumN">0</div></div>
      <div class="token-row"><div class="token-label" style="color:var(--red);">Distilled</div><div class="token-bar-bg"><div class="token-bar-fill" id="tierDistilled" style="width:0%;background:var(--red);"></div></div><div class="token-number" id="tierDistilledN">0</div></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;" id="flagsDisplay">
      <span style="font-size:11px;color:var(--text-dim);" id="flagsDECISION">DECISION: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="flagsMILESTONE">MILESTONE: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="flagsPROBLEM">PROBLEM: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="flagsORIGIN">ORIGIN: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="flagsPIVOT">PIVOT: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="flagsCORE">CORE: --</span>
      <span style="font-size:11px;color:var(--text-dim);" id="pinnedCount">Pinned: --</span>
    </div>
  </div>

  <!-- ===== TOTAL RECALL: PRESSURE + WAKE-UP ===== -->
  <div class="two-col">
    <!-- Memory Pressure -->
    <div class="token-bar-section" id="pressureSection">
      <div class="section-title">
        <div class="icon" style="background:var(--red-dim);color:var(--red);">&#x26A0;</div>
        Memory Pressure <span style="font-size:11px;color:var(--text-muted);margin-left:8px;" id="pressureCount"></span>
      </div>
      <div id="pressureList" style="max-height:300px;overflow-y:auto;"></div>
    </div>
    <!-- Wake-Up Primer Preview -->
    <div class="token-bar-section" id="wakeupSection">
      <div class="section-title">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">&#x2600;</div>
        Wake-Up Primer Preview
      </div>
      <div id="wakeupPreview" style="font-size:12px;color:var(--text-dim);max-height:300px;overflow-y:auto;">
        <div style="margin-bottom:8px;"><strong style="color:var(--text);font-size:11px;">L0 — Project Profile</strong><div id="wakeL0" style="margin-top:4px;"></div></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text);font-size:11px;">L1 — Critical Knowledge</strong><div id="wakeL1" style="margin-top:4px;"></div></div>
        <div><strong style="color:var(--text);font-size:11px;">L3 — Top Entities</strong><div id="wakeL3" style="margin-top:4px;"></div></div>
      </div>
    </div>
  </div>

  <!-- ===== TOKEN ECONOMICS ===== -->
  <div class="token-bar-section">
    <div class="section-title">
      <div class="icon" style="background:var(--green-dim);color:var(--green);">T</div>
      Token Economics
    </div>
    <div class="token-comparison">
      <div class="token-row">
        <div class="token-label">Original</div>
        <div class="token-bar-bg"><div class="token-bar-fill original" id="barOriginal" style="width:100%"></div></div>
        <div class="token-number" id="numOriginal">-</div>
      </div>
      <div class="token-row">
        <div class="token-label">Summarized</div>
        <div class="token-bar-bg"><div class="token-bar-fill summary" id="barSummary" style="width:0%"></div></div>
        <div class="token-number" id="numSummary">-</div>
      </div>
      <div class="token-row">
        <div class="token-label">Saved</div>
        <div class="token-bar-bg"><div class="token-bar-fill saved" id="barSaved" style="width:0%"></div></div>
        <div class="token-number" id="numSaved">-</div>
      </div>
    </div>
  </div>

  <!-- ===== KNOWLEDGE & CONTRADICTIONS ===== -->
  <div class="two-col">
    <!-- Knowledge Base -->
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--purple-dim);color:var(--purple);">K</div>
        Knowledge Base
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="knowledgeCount">0 entries</span>
      </div>
      <div style="position:relative;margin-bottom:8px;">
        <input id="knowledgeSearchInput" type="text" placeholder="Search knowledge..." style="width:100%;padding:7px 28px 7px 10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text);font-family:var(--font-ui);font-size:11px;outline:none;" />
        <span id="knowledgeSearchClear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--text-muted);font-size:12px;display:none;">&times;</span>
      </div>
      <div id="knowledgeCategories" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;"></div>
      <div id="knowledgeList" style="max-height:350px;overflow-y:auto;"></div>
    </div>

    <!-- Contradictions -->
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--orange-dim);color:var(--orange);">!</div>
        Contradictions
        <span style="font-size:10px;padding:1px 7px;border-radius:10px;background:var(--orange-dim);color:var(--orange);margin-left:6px;font-family:var(--font-ui);font-weight:600;" id="contradictionCount">0</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted);font-family:var(--font-ui);">Knowledge Merges</span>
      </div>
      <div id="contradictionsList" style="max-height:350px;overflow-y:auto;">
        <div class="empty-state"><p>No contradictions detected</p></div>
      </div>
    </div>
  </div>

  <!-- ===== EVENTS & SESSIONS ===== -->
  <div class="two-col">
    <!-- Events -->
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--red-dim);color:var(--red);">E</div>
        Event Stream
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="eventCount">0 events</span>
      </div>
      <div id="eventTypeDist" class="event-type-dist"></div>
      <div id="errorFixes" style="margin-bottom:8px;"></div>
      <div id="eventsList" style="max-height:300px;overflow-y:auto;"></div>
    </div>

    <!-- Sessions -->
    <div class="sessions-section">
      <div class="section-title">
        <div class="icon" style="background:var(--purple-dim);color:var(--purple);" id="sessionCountIcon">0</div>
        Sessions
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="sessionFilterHint"></span>
      </div>
      <div id="sessionsList"></div>
    </div>
  </div>

  <!-- ===== OBSERVATION TYPES ===== -->
  <div class="token-bar-section">
    <div class="section-title">
      <div class="icon" style="background:var(--blue-dim);color:var(--blue);" id="typeCountIcon">0</div>
      Observation Types
    </div>
    <div class="type-grid" id="typeGrid"></div>
  </div>

  <!-- ===== ACTIVITY + BUDGET ===== -->
  <div class="two-col">
    <!-- Activity chart -->
    <div class="token-bar-section">
      <div class="section-title" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="icon" style="background:var(--purple-dim);color:var(--purple);">A</div>
          Session Activity <span style="font-weight:400;color:var(--text-muted);font-size:11px;font-family:var(--font-ui);">(7 days)</span>
        </div>
        <button class="export-btn" onclick="window.location.href='/api/export'">Export JSON</button>
      </div>
      <div class="activity-chart" id="activityChart"></div>
      <div class="activity-labels" id="activityLabels"></div>
    </div>

    <!-- Budget -->
    <div class="token-bar-section budget-section">
      <div class="section-title">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">B</div>
        Token Budget
        <span id="budgetStrategyBadge" class="budget-strategy"></span>
      </div>
      <div id="budgetContent">
        <div class="empty-state"><p>Loading...</p></div>
      </div>
    </div>
  </div>

  <!-- ===== SYSTEM STATUS (COLLAPSIBLE) ===== -->
  <div class="system-status-section">
    <div class="system-status-header" onclick="toggleSystemStatus()">
      <div class="section-title" style="margin-bottom:0;">
        <div class="icon" style="background:var(--bg-elevated);color:var(--text-dim);">&#x2699;</div>
        System Status
      </div>
      <span class="system-status-toggle" id="systemStatusToggle">&#x25BE;</span>
    </div>
    <div class="system-status-body" id="systemStatusBody">
      <!-- Compression + Files + Privacy -->
      <div class="three-col">
        <div>
          <div class="section-title">
            <div class="icon" style="background:var(--green-dim);color:var(--green);">%</div>
            Compression by Type
          </div>
          <div id="compressionBars"></div>
        </div>
        <div>
          <div class="section-title">
            <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">F</div>
            Top Files
          </div>
          <div id="topFiles"></div>
        </div>
        <div>
          <div class="section-title">
            <div class="icon" style="background:var(--orange-dim);color:var(--orange);">P</div>
            Privacy
          </div>
          <div id="privacyBreakdown"></div>
        </div>
      </div>

      <!-- DB Health -->
      <div>
        <div class="section-title">
          <div class="icon" style="background:var(--green-dim);color:var(--green);">H</div>
          Database Health
        </div>
        <div class="health-grid" id="dbHealth"></div>
      </div>

      <!-- Search Analytics + Content Index -->
      <div class="two-col">
        <div>
          <div class="section-title">
            <div class="icon" style="background:var(--blue-dim);color:var(--blue);">A</div>
            Search Analytics
          </div>
          <div id="analytics-content" style="font-size:12px;font-family:var(--font-ui);">Loading...</div>
        </div>
        <div>
          <div class="section-title">
            <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">I</div>
            Content Index
            <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="contentSourceCount">0 sources</span>
          </div>
          <div id="contentSourcesList" style="max-height:200px;overflow-y:auto;"></div>
        </div>
      </div>

      <!-- Snapshots -->
      <div>
        <div class="section-title">
          <div class="icon" style="background:var(--pink-dim);color:var(--pink);">S</div>
          Session Snapshots
          <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="snapshotCount">0 snapshots</span>
        </div>
        <div id="snapshotsList" style="max-height:200px;overflow-y:auto;"></div>
      </div>
    </div>
  </div>

  <!-- ===== KNOWLEDGE GRAPH ===== -->
  <div class="graph-section" id="graphSection">
    <div class="section-title">
      <div class="icon" style="background:var(--purple-dim);color:var(--purple);">G</div>
      Knowledge Graph
    </div>
    <div class="graph-controls">
      <input type="text" id="graphEntityFilter" placeholder="Filter entity..." />
      <select id="graphDepth">
        <option value="1">Depth 1</option>
        <option value="2" selected>Depth 2</option>
        <option value="3">Depth 3</option>
        <option value="4">Depth 4</option>
        <option value="5">Depth 5</option>
      </select>
      <button onclick="loadGraph()">Load Graph</button>
    </div>
    <div class="graph-canvas" id="graphCanvas">
      <div class="graph-empty" id="graphEmpty">Load graph data to visualize entity relationships</div>
    </div>
    <div class="graph-tooltip" id="graphTooltip">
      <div class="tt-name" id="ttName"></div>
      <div class="tt-type" id="ttType"></div>
    </div>
    <div class="graph-stats" id="graphStats"></div>
  </div>

  <!-- ===== CROSS-PROJECT COMPARISON ===== -->
  <div class="token-bar-section" id="comparison-card" style="display:none">
    <div class="section-title">
      <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">P</div>
      Project Comparison
    </div>
    <div id="comparison-content"></div>
  </div>

  <!-- ===== AGENTS ===== -->
  <div class="agents-section" id="agentsSection">
    <div class="section-title">
      <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">A</div>
      Active Agents
      <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:var(--font-ui);" id="agentsRefreshHint">auto-refreshes</span>
    </div>
    <div id="agentsContainer">
      <div class="agents-empty">No agents registered</div>
    </div>
  </div>

  <!-- ===== OBSERVATIONS TIMELINE ===== -->
  <div class="timeline-section">
    <div class="timeline-header">
      <div class="section-title" style="margin-bottom:0;flex-shrink:0;">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">L</div>
        Observations
      </div>
      <div class="search-box">
        <input type="text" class="search-input" id="searchInput" placeholder="Search observations... (Enter to search)" autocomplete="off" spellcheck="false">
        <button class="search-clear" id="searchClear">Clear</button>
      </div>
    </div>
    <div class="search-info" id="searchInfo">
      <span>Found <span class="count" id="searchCount">0</span> results for &ldquo;<span class="query" id="searchQuery"></span>&rdquo;</span>
    </div>
    <div id="timeline"></div>
  </div>

  <!-- ===== TOAST CONTAINER ===== -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- ===== FULLSCREEN OVERLAY ===== -->
  <div class="fullscreen-overlay" id="fullscreenOverlay">
    <div class="fullscreen-header">
      <div class="fullscreen-header-left">
        <span class="obs-type-badge" id="fullscreenBadge"></span>
        <span style="font-size:12px;color:var(--text-dim);font-family:var(--font-mono);" id="fullscreenId"></span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="copy-btn" id="fullscreenCopy">Copy content</button>
        <button class="fullscreen-close" onclick="document.getElementById('fullscreenOverlay').classList.remove('open')">Close (Esc)</button>
      </div>
    </div>
    <div class="fullscreen-content" id="fullscreenBody"></div>
  </div>

  <!-- ===== SHORTCUTS MODAL ===== -->
  <div class="shortcuts-overlay" id="shortcutsOverlay">
    <div class="shortcuts-panel">
      <div class="shortcuts-title">Keyboard Shortcuts</div>
      <div class="shortcut-row"><span class="shortcut-desc">Search observations</span><span class="shortcut-key">/</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Close search / panel</span><span class="shortcut-key">Esc</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Show shortcuts</span><span class="shortcut-key">?</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Refresh data</span><span class="shortcut-key">r</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Clear all filters</span><span class="shortcut-key">c</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Toggle theme</span><span class="shortcut-key">t</span></div>
      <div style="border-top:1px solid var(--border);margin:10px 0;"></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Click card to expand details</span></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Double-click content for fullscreen</span></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Click session to filter by it</span></div>
    </div>
  </div>

</div>

<footer class="footer">
  context-mem v2.6.0 &mdash; AI memory for coding assistants
</footer>

<script>
const API = '';
let currentFilter = null;
let currentSearch = '';
let searchDebounceTimer = null;
let openDetailId = null;
let currentSession = null;
let lastObsCount = null;
let currentTheme = localStorage.getItem('cm-theme') || 'dark';
let fullscreenData = null;

// --- System Status toggle ---
function toggleSystemStatus() {
  const body = document.getElementById('systemStatusBody');
  const toggle = document.getElementById('systemStatusToggle');
  if (!body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (toggle) toggle.classList.toggle('open', !isOpen);
}

// --- Intelligence strip loader ---
async function loadIntelligence() {
  try {
    const [healthData, vectorData, authData, contraData, llmData] = await Promise.all([
      fetch('/api/health-score').then(r => r.json()).catch(() => ({})),
      fetch('/api/vector-status').then(r => r.json()).catch(() => ({})),
      fetch('/api/knowledge-authority').then(r => r.json()).catch(() => []),
      fetch('/api/contradictions').then(r => r.json()).catch(() => []),
      fetch('/api/llm-status').then(r => r.json()).catch(() => ({})),
    ]);

    // Health card
    const healthScore = healthData.score || 0;
    const healthEl = document.getElementById('intelHealthScore');
    const healthSubEl = document.getElementById('intelHealthSub');
    if (healthEl) {
      healthEl.textContent = healthScore;
      healthEl.style.color = healthScore > 70 ? 'var(--green)' : healthScore > 40 ? 'var(--orange)' : 'var(--red)';
    }
    if (healthSubEl) healthSubEl.textContent = healthData.label || (healthScore > 70 ? 'Healthy' : healthScore > 40 ? 'Needs attention' : 'Poor health');

    // Search intelligence badges
    const searchBadgesEl = document.getElementById('intelSearchBadges');
    if (searchBadgesEl) {
      let badges = '<span class="intel-badge bm25">BM25</span><span class="intel-badge trigram">Trigram</span>';
      if (vectorData.status === 'active') badges += '<span class="intel-badge vector">Vector</span>';
      searchBadgesEl.innerHTML = badges;
    }

    // Knowledge authority
    const authEntries = Array.isArray(authData) ? authData : [];
    const avgAuth = authEntries.length > 0
      ? (authEntries.reduce((s, e) => s + (e.authority || 0), 0) / authEntries.length).toFixed(2)
      : '--';
    const authScoreEl = document.getElementById('intelAuthScore');
    const authSubEl = document.getElementById('intelAuthSub');
    if (authScoreEl) {
      authScoreEl.textContent = avgAuth;
      const authNum = parseFloat(avgAuth);
      authScoreEl.style.color = authNum > 0.7 ? 'var(--green)' : authNum > 0.4 ? 'var(--orange)' : 'var(--purple)';
    }
    const contraArr = Array.isArray(contraData) ? contraData : [];
    if (authSubEl) authSubEl.textContent = authEntries.length + ' entries · ' + contraArr.length + ' contradiction' + (contraArr.length !== 1 ? 's' : '') + ' pending';

    // Render contradictions panel
    renderContradictions(contraArr);

    // Render knowledge with authority
    if (authEntries.length > 0 && !knowledgeSearchQuery) {
      renderKnowledgeAuthority(authEntries);
    }

    // LLM card
    const llmValueEl = document.getElementById('intelLlmValue');
    const llmSubEl = document.getElementById('intelLlmSub');
    const llmChipEl = document.getElementById('llmChip');
    const llmChipLabel = document.getElementById('llmChipLabel');
    if (llmData.enabled) {
      if (llmValueEl) { llmValueEl.textContent = llmData.provider || 'Enabled'; llmValueEl.style.color = 'var(--green)'; }
      if (llmSubEl) llmSubEl.textContent = llmData.model || 'Model active';
      if (llmChipEl) llmChipEl.classList.add('enabled');
      if (llmChipLabel) llmChipLabel.textContent = llmData.provider || 'LLM';
    } else {
      if (llmValueEl) { llmValueEl.textContent = 'Disabled'; llmValueEl.style.color = 'var(--text-dim)'; }
      if (llmSubEl) llmSubEl.textContent = 'No provider configured';
      if (llmChipEl) llmChipEl.classList.remove('enabled');
      if (llmChipLabel) llmChipLabel.textContent = 'No LLM';
    }

    // Update contradiction count badge
    const ccEl = document.getElementById('contradictionCount');
    if (ccEl) ccEl.textContent = contraArr.length;
  } catch (e) { /* silent */ }
}

// --- Total Recall data loader ---
async function loadTotalRecall() {
  try {
    const [tiersData, flagsData, entitiesData, pressureData, wakeupData, topicsData] = await Promise.all([
      fetch('/api/compression-tiers').then(r => r.json()).catch(() => ({ tiers: [], total: 0 })),
      fetch('/api/significance-flags').then(r => r.json()).catch(() => ({ flags: {}, pinned_count: 0 })),
      fetch('/api/entities-summary').then(r => r.json()).catch(() => ({ total: 0, by_type: [] })),
      fetch('/api/pressure').then(r => r.json()).catch(() => []),
      fetch('/api/wake-up-preview').then(r => r.json()).catch(() => ({ l0_profile: '', l1_critical: [], l3_entities: [] })),
      fetch('/api/topics').then(r => r.json()).catch(() => []),
    ]);

    // --- Intel cards ---
    const tiersVal = document.getElementById('intelTiersValue');
    const tiersSub = document.getElementById('intelTiersSub');
    if (tiersVal && tiersData.tiers) {
      const tMap = {}; tiersData.tiers.forEach(t => tMap[t.tier] = t.count);
      tiersVal.textContent = (tMap.verbatim || 0) + ' V / ' + (tMap.light || 0) + ' L / ' + (tMap.medium || 0) + ' M / ' + (tMap.distilled || 0) + ' D';
    }
    if (tiersSub) tiersSub.textContent = tiersData.total + ' total observations';

    const entVal = document.getElementById('intelEntitiesValue');
    const entSub = document.getElementById('intelEntitiesSub');
    if (entVal) entVal.textContent = entitiesData.total || 0;
    if (entSub) entSub.textContent = (entitiesData.by_type || []).map(t => t.count + ' ' + t.entity_type).slice(0, 3).join(', ') || 'No entities';

    const pressVal = document.getElementById('intelPressureValue');
    const pressSub = document.getElementById('intelPressureSub');
    const highRisk = Array.isArray(pressureData) ? pressureData.filter(e => e.risk_score > 0.6).length : 0;
    if (pressVal) {
      pressVal.textContent = highRisk;
      pressVal.style.color = highRisk > 5 ? 'var(--red)' : highRisk > 0 ? 'var(--orange)' : 'var(--green)';
    }
    if (pressSub) pressSub.textContent = highRisk > 0 ? highRisk + ' entries at high risk' : 'All memories safe';

    // --- Compression tiers bars ---
    if (tiersData.tiers && tiersData.total > 0) {
      const tMap = {}; tiersData.tiers.forEach(t => tMap[t.tier] = t.count);
      const max = Math.max(...tiersData.tiers.map(t => t.count), 1);
      ['verbatim', 'light', 'medium', 'distilled'].forEach(tier => {
        const Tier = tier.charAt(0).toUpperCase() + tier.slice(1);
        const bar = document.getElementById('tier' + Tier);
        const num = document.getElementById('tier' + Tier + 'N');
        const count = tMap[tier] || 0;
        if (bar) bar.style.width = (count / max * 100) + '%';
        if (num) num.textContent = count + ' (' + Math.round(count / tiersData.total * 100) + '%)';
      });
    }

    // --- Significance flags ---
    if (flagsData.flags) {
      ['DECISION', 'MILESTONE', 'PROBLEM', 'ORIGIN', 'PIVOT', 'CORE'].forEach(f => {
        const el = document.getElementById('flags' + f);
        if (el) {
          const count = flagsData.flags[f] || 0;
          el.textContent = f + ': ' + count;
          el.style.color = count > 0 ? 'var(--text)' : 'var(--text-muted)';
        }
      });
      const pinnedEl = document.getElementById('pinnedCount');
      if (pinnedEl) pinnedEl.textContent = 'Pinned: ' + (flagsData.pinned_count || 0);
    }

    // --- Pressure list ---
    const pressureList = document.getElementById('pressureList');
    if (pressureList) {
      const entries = Array.isArray(pressureData) ? pressureData.slice(0, 8) : [];
      if (entries.length === 0) {
        pressureList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px;">No entries at risk of loss.</div>';
      } else {
        pressureList.innerHTML = entries.map(e => {
          const riskColor = e.risk_score > 0.7 ? 'var(--red)' : e.risk_score > 0.4 ? 'var(--orange)' : 'var(--green)';
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);">' +
            '<div style="min-width:40px;text-align:center;font-size:13px;font-weight:600;color:' + riskColor + ';">' + (e.risk_score * 100).toFixed(0) + '%</div>' +
            '<div style="flex:1;min-width:0;"><div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(e.title) + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);">' + e.reasons.join(' · ') + '</div></div>' +
            '<div style="font-size:10px;padding:2px 6px;border-radius:6px;background:var(--bg-elevated);color:var(--text-dim);">' + e.type + '</div></div>';
        }).join('');
      }
      const pressureCountEl = document.getElementById('pressureCount');
      if (pressureCountEl) pressureCountEl.textContent = entries.length + ' entries';
    }

    // --- Wake-up preview ---
    const wakeL0 = document.getElementById('wakeL0');
    const wakeL1 = document.getElementById('wakeL1');
    const wakeL3 = document.getElementById('wakeL3');
    if (wakeL0) wakeL0.textContent = wakeupData.l0_profile || '(no profile set)';
    if (wakeL1) {
      wakeL1.innerHTML = (wakeupData.l1_critical || []).map(k =>
        '<div style="padding:3px 0;border-bottom:1px solid var(--border-subtle);"><span style="color:var(--text);">' + escHtml(k.title) + '</span> <span style="color:var(--text-muted);font-size:10px;">score: ' + (k.score || 0).toFixed(1) + '</span></div>'
      ).join('') || '(no knowledge entries)';
    }
    if (wakeL3) {
      wakeL3.innerHTML = (wakeupData.l3_entities || []).map(e =>
        '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:8px;background:var(--bg-elevated);font-size:11px;color:var(--text);">' + escHtml(e.name) + ' <span style="color:var(--text-muted);">(' + e.connections + ')</span></span>'
      ).join('') || '(no entities)';
    }

    // --- Populate topic filter dropdown ---
    const topicFilter = document.getElementById('topicFilter');
    if (topicFilter && Array.isArray(topicsData)) {
      const current = topicFilter.value;
      topicFilter.innerHTML = '<option value="">All topics</option>' +
        topicsData.slice(0, 20).map(t => '<option value="' + t.name + '">' + t.name + ' (' + t.observation_count + ')</option>').join('');
      topicFilter.value = current;
    }
  } catch (e) { /* silent */ }
}

// --- Flag filter toggle ---
let activeFlags = new Set();
function toggleFlag(el) {
  const flag = el.dataset.flag;
  if (activeFlags.has(flag)) { activeFlags.delete(flag); el.style.borderColor = 'transparent'; el.style.opacity = '0.6'; }
  else { activeFlags.add(flag); el.style.borderColor = 'currentColor'; el.style.opacity = '1'; }
}

// --- Render contradictions panel ---
function renderContradictions(data) {
  const listEl = document.getElementById('contradictionsList');
  if (!listEl) return;
  if (!data || data.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>No contradictions detected — knowledge base is consistent</p></div>';
    return;
  }
  listEl.innerHTML = data.map(item => {
    const a = item.entry_a || {};
    const b = item.entry_b || {};
    const authA = typeof a.authority === 'number' ? a.authority : 0.5;
    const authB = typeof b.authority === 'number' ? b.authority : 0.5;
    const action = item.suggested_action || 'merge';
    return '<div class="contradiction-item">' +
      '<div class="contradiction-titles">' +
        '<span class="contradiction-title" title="' + escHtml(a.title || '') + '">' + escHtml((a.title || 'Entry A').slice(0, 35)) + '</span>' +
        '<span class="contradiction-vs">vs</span>' +
        '<span class="contradiction-title" title="' + escHtml(b.title || '') + '">' + escHtml((b.title || 'Entry B').slice(0, 35)) + '</span>' +
      '</div>' +
      '<div class="contradiction-auth-bars">' +
        '<div class="contradiction-auth-side">' +
          '<div class="contradiction-auth-label">Authority: ' + (authA * 100).toFixed(0) + '%</div>' +
          '<div class="contradiction-auth-bar"><div class="contradiction-auth-fill auth-high" style="width:' + (authA * 100).toFixed(0) + '%;"></div></div>' +
        '</div>' +
        '<div class="contradiction-auth-side">' +
          '<div class="contradiction-auth-label">Authority: ' + (authB * 100).toFixed(0) + '%</div>' +
          '<div class="contradiction-auth-bar"><div class="contradiction-auth-fill auth-mid" style="width:' + (authB * 100).toFixed(0) + '%;"></div></div>' +
        '</div>' +
        '<span class="action-badge action-' + escHtml(action) + '">' + escHtml(action.replace('_', ' ')) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// --- Render knowledge with authority bars ---
function renderKnowledgeAuthority(entries) {
  const catColors = { pattern: 'cat-pattern', decision: 'cat-decision', error: 'cat-error', api: 'cat-api', component: 'cat-component' };
  const kListEl = document.getElementById('knowledgeList');
  if (!kListEl || entries.length === 0) return;

  kListEl.innerHTML = entries.map(k => {
    const catClass = catColors[k.category] || '';
    const catBg = k.category === 'pattern' ? 'var(--blue-dim)' : k.category === 'decision' ? 'var(--purple-dim)' : k.category === 'error' ? 'var(--red-dim)' : k.category === 'api' ? 'var(--cyan-dim)' : 'var(--green-dim)';
    const auth = typeof k.authority === 'number' ? k.authority : (k.relevance_score || 0);
    const authClass = auth > 0.7 ? 'auth-high' : auth > 0.4 ? 'auth-mid' : 'auth-low';
    const authPct = (auth * 100).toFixed(0);
    const sourceType = k.source_type || 'knowledge';
    let contentText = escHtml((k.content || '').slice(0, 120));
    if (knowledgeSearchQuery) {
      const terms = knowledgeSearchQuery.split(/\\s+/).filter(t => t.length > 0);
      for (const term of terms) {
        const re = new RegExp('(' + term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
        contentText = contentText.replace(re, '<span class="highlight">$1</span>');
      }
    }
    return '<div class="knowledge-item">' +
      '<div class="knowledge-item-header">' +
        '<span class="knowledge-item-cat ' + catClass + '" style="background:' + catBg + ';">' + escHtml(k.category || 'general') + '</span>' +
        '<span class="knowledge-item-title">' + escHtml(k.title || '') + '</span>' +
      '</div>' +
      '<div class="knowledge-item-content">' + contentText + '</div>' +
      '<div class="knowledge-item-meta">' +
        '<div class="authority-bar-wrap"><div class="authority-bar-fill ' + authClass + '" style="width:' + authPct + '%;"></div></div>' +
        '<span class="knowledge-meta-text">auth ' + authPct + '%</span>' +
        '<span class="source-chip ' + escHtml(sourceType) + '">' + escHtml(sourceType) + '</span>' +
        '<span class="knowledge-meta-text">' + (k.access_count || 0) + 'x</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// --- Smart Search (SearchFusion) ---
const smartSearchInput = document.getElementById('smartSearchInput');
const smartSearchClear = document.getElementById('smartSearchClear');
let smartSearchActive = false;

async function doSmartSearch(query) {
  if (!query) {
    document.getElementById('smartSearchResults').classList.remove('visible');
    document.getElementById('smartSearchInfo').classList.remove('visible');
    smartSearchClear.classList.remove('visible');
    smartSearchActive = false;
    return;
  }
  smartSearchActive = true;
  smartSearchClear.classList.add('visible');

  try {
    const data = await fetchJson('/api/search-fusion?q=' + encodeURIComponent(query));
    const results = data.results || [];
    const intent = data.intent || 'default';
    const weights = data.weights || {};
    const pipeline = data.pipeline || '';

    // Update info bar
    const infoEl = document.getElementById('smartSearchInfo');
    infoEl.classList.add('visible');
    document.getElementById('sfResultCount').textContent = results.length;
    document.getElementById('sfIntent').textContent = intent;
    const wParts = [];
    if (weights.relevance !== undefined) wParts.push('relevance ' + Math.round(weights.relevance * 100) + '%');
    if (weights.recency !== undefined) wParts.push('recency ' + Math.round(weights.recency * 100) + '%');
    if (weights.access !== undefined) wParts.push('access ' + Math.round(weights.access * 100) + '%');
    document.getElementById('sfWeightsInfo').textContent = wParts.join(' · ');

    // Results list
    const listEl = document.getElementById('sfResultsList');
    if (results.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No results found for "' + escHtml(query) + '"</p></div>';
    } else {
      listEl.innerHTML = results.map((r, idx) => {
        const intentClass = 'intent-' + (intent || 'default').toLowerCase().replace(/[^a-z]/g, '');
        const typeClass = 'badge-' + (r.type || 'context');
        const relevance = r.rank !== undefined ? Math.min(Math.abs(r.rank) * 100, 100) : (r.score || 0) * 100;
        const summary = r.summary || r.content_preview || '(no content)';
        return '<div class="sfusion-result" style="animation-delay:' + (idx * 0.03) + 's" data-obs-id="' + escHtml(r.id || '') + '">' +
          '<span class="sfusion-intent-badge ' + intentClass + '">' + escHtml(intent) + '</span>' +
          '<span class="sfusion-type-badge ' + typeClass + ' obs-type-badge">' + escHtml(r.type || 'obs') + '</span>' +
          '<span class="sfusion-summary">' + escHtml(summary.slice(0, 100)) + '</span>' +
          '<div class="sfusion-relevance"><div class="sfusion-relevance-fill" style="width:' + relevance.toFixed(0) + '%;"></div></div>' +
          '<span class="sfusion-time">' + timeAgo(r.indexed_at || Date.now()) + '</span>' +
        '</div>';
      }).join('');

      // Click to expand in timeline
      listEl.querySelectorAll('.sfusion-result').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.obsId;
          if (id) openFullscreen(id);
        });
      });
    }

    // Pipeline
    const pipeEl = document.getElementById('sfPipeline');
    if (pipeline) {
      pipeEl.classList.add('visible');
      pipeEl.innerHTML = 'Intent: <span style="color:var(--accent);">' + escHtml(intent) + '</span>' +
        pipeline.split('->').map(s => '<span class="arrow">→</span>' + escHtml(s.trim())).join('');
    } else {
      pipeEl.classList.remove('visible');
    }

    document.getElementById('smartSearchResults').classList.add('visible');
  } catch (e) {
    document.getElementById('smartSearchInfo').classList.remove('visible');
  }
}

if (smartSearchInput) {
  smartSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSmartSearch(smartSearchInput.value.trim());
    }
    if (e.key === 'Escape') {
      smartSearchInput.value = '';
      doSmartSearch('');
      smartSearchInput.blur();
    }
  });
}

if (smartSearchClear) {
  smartSearchClear.addEventListener('click', () => {
    if (smartSearchInput) smartSearchInput.value = '';
    doSmartSearch('');
    if (smartSearchInput) smartSearchInput.focus();
  });
}

// Load LLM status for header chip (also loaded in loadIntelligence)
async function loadLlmStatus() {
  try {
    const data = await fetch('/api/llm-status').then(r => r.json());
    const chip = document.getElementById('llmChip');
    const label = document.getElementById('llmChipLabel');
    if (data.enabled) {
      if (chip) chip.classList.add('enabled');
      if (label) label.textContent = data.provider || 'LLM';
    } else {
      if (chip) chip.classList.remove('enabled');
      if (label) label.textContent = 'No LLM';
    }
  } catch {}
}

loadLlmStatus();
setInterval(loadLlmStatus, 30000);

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function fetchJson(url) {
  const res = await fetch(API + url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// --- Project switcher (multi-project) ---
let activeProjectDb = localStorage.getItem('cm-active-project') || null;

function updateProjectBar(instances) {
  var label = document.getElementById('projectLabel');
  if (!label) return;
  if (!instances || instances.length <= 1) {
    var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
    label.textContent = 'Project  ' + name;
  } else {
    label.textContent = 'Projects';
  }
}

async function loadProjects() {
  try {
    const instances = await fetchJson('/api/instances');
    const container = document.getElementById('projectPills');
    const bar = document.getElementById('projectBar');

    if (!instances.length) {
      activeProjectDb = null;
      container.innerHTML = '';
      updateProjectBar(instances);
      return;
    }

    // Validate persisted selection
    if (activeProjectDb) {
      var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
      if (!validSelection) activeProjectDb = instances[0].dbPath;
    } else {
      activeProjectDb = instances[0].dbPath;
    }

    if (instances.length === 1) {
      container.innerHTML = '';
    } else {
      container.innerHTML = instances.map(i => {
        const isActive = i.dbPath === activeProjectDb;
        return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + escHtml(i.dbPath) + '" title="' + escHtml(i.projectDir) + '">' +
          '<span class="pill-dot"></span>' +
          escHtml(i.projectName) +
        '</div>';
      }).join('');
    }

    updateProjectBar(instances);

    container.querySelectorAll('.project-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const db = pill.getAttribute('data-db');
        if (db === activeProjectDb) return;
        try {
          await fetchJson('/api/switch-project?db=' + encodeURIComponent(db));
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          updateProjectBar(instances);
          refresh();
        } catch {}
      });
    });
  } catch {}
}

function switchToProject(projectDir) {
  fetchJson('/api/instances').then(instances => {
    const inst = instances.find(i => i.projectDir === projectDir);
    if (inst) {
      fetchJson('/api/switch-project?db=' + encodeURIComponent(inst.dbPath)).then(() => {
        activeProjectDb = inst.dbPath;
        localStorage.setItem('cm-active-project', activeProjectDb);
        loadProjects();
        refresh();
        checkVectorStatus();
      });
    }
  });
}

loadProjects();
setInterval(loadProjects, 10000);

// --- Cross-project comparison ---
function loadComparison() {
  fetch('/api/instances').then(r => r.json()).then(function(instances) {
    const card = document.getElementById('comparison-card');
    const content = document.getElementById('comparison-content');
    if (!card || !content) return;
    if (!instances || instances.length < 2) return; // Only show for multi-project
    card.style.display = '';
    content.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
      '<tr style="border-bottom:1px solid var(--border)">' +
      '<th style="text-align:left;padding:6px;font-size:11px;color:var(--text-muted);font-weight:600;">Project</th>' +
      '<th style="text-align:right;padding:6px;font-size:11px;color:var(--text-muted);font-weight:600;">Path</th>' +
      '<th style="text-align:right;padding:6px;font-size:11px;color:var(--text-muted);font-weight:600;">Status</th>' +
      '</tr>' +
      instances.map(function(inst) {
        const name = escHtml(inst.projectName || (inst.projectDir || '').split('/').pop() || 'Unknown');
        const dir = escHtml(inst.projectDir || '');
        const active = inst.dbPath === activeProjectDb;
        return '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:6px;color:var(--text);font-size:12px;">' + name + '</td>' +
          '<td style="padding:6px;text-align:right;color:var(--text-muted);font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + dir + '">' + dir + '</td>' +
          '<td style="padding:6px;text-align:right;font-size:11px;color:' + (active ? 'var(--green)' : 'var(--text-dim)') + ';">' + (active ? 'Active' : 'Registered') + '</td>' +
          '</tr>';
      }).join('') + '</table>';
  }).catch(function() {});
}

loadComparison();
setInterval(loadComparison, 15000);

async function refresh() {
  try {
    // --- Project view ---
    // Determine if searching or browsing
    const isSearching = currentSearch.length > 0;

    const fetches = [
      fetchJson('/api/stats'),
      fetchJson('/api/sessions'),
      fetchJson('/api/compression'),
      fetchJson('/api/top-files'),
      fetchJson('/api/privacy'),
      fetchJson('/api/activity'),
      fetchJson('/api/db-health'),
      fetchJson('/api/budget'),
      fetchJson('/api/knowledge-stats'),
      fetchJson('/api/knowledge'),
      fetchJson('/api/event-stats'),
      fetchJson('/api/events?limit=30'),
      fetchJson('/api/snapshots'),
      fetchJson('/api/content-sources'),
    ];

    if (isSearching) {
      let searchUrl = '/api/search?q=' + encodeURIComponent(currentSearch);
      if (currentFilter) searchUrl += '&type=' + currentFilter;
      if (currentSession) searchUrl += '&session=' + currentSession;
      fetches.push(fetchJson(searchUrl));
    } else {
      let tlUrl = '/api/timeline?limit=50';
      if (currentFilter) tlUrl += '&type=' + currentFilter;
      if (currentSession) tlUrl += '&session=' + currentSession;
      fetches.push(fetchJson(tlUrl));
    }

    const [stats, sessions, compression, topFiles, privacy, activity, dbHealth, budget, knowledgeStats, knowledge, eventStats, events, snapshots, contentSources, timeline] = await Promise.all(fetches);

    // Stats cards
    document.getElementById('statObs').textContent = fmt(stats.observations);
    document.getElementById('statObsSub').textContent = stats.sessions + ' session' + (stats.sessions !== 1 ? 's' : '');
    document.getElementById('statSaved').textContent = fmt(stats.tokens_saved);
    document.getElementById('statSavedSub').textContent = fmt(stats.tokens_in) + ' original tokens';
    document.getElementById('statPct').textContent = stats.savings_pct + '%';
    document.getElementById('statSearches').textContent = fmt(stats.searches);
    document.getElementById('statSearchSub').textContent = stats.embedded_count > 0
      ? stats.reads + ' reads · ' + stats.embedded_count + ' embedded'
      : stats.reads + ' full reads';
    document.getElementById('statDb').textContent = stats.db_size_kb < 1024
      ? stats.db_size_kb + ' KB'
      : (stats.db_size_kb / 1024).toFixed(1) + ' MB';
    document.getElementById('statDbSub').textContent = stats.store_events + ' store events';
    // Sessions stat card
    const ssEl = document.getElementById('statSessions');
    const ssSubEl = document.getElementById('statSessionsSub');
    if (ssEl) ssEl.textContent = fmt(stats.sessions);
    if (ssSubEl) ssSubEl.textContent = fmt(stats.observations) + ' observations';

    // Search analytics
    fetch('/api/search-analytics').then(r => r.json()).then(data => {
      const el = document.getElementById('analytics-content');
      if (el && data.top_entries) {
        el.innerHTML = data.top_entries.slice(0, 5).map(e =>
          '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">' +
            '<span style="color:var(--text)">' + escHtml(e.title.slice(0, 40)) + '</span>' +
            '<span style="color:var(--text-dim)">' + e.access_count + 'x</span>' +
          '</div>'
        ).join('') || '<span style="color:var(--text-dim)">No data yet</span>';
      }
    }).catch(() => {});

    // --- Savings Calculator ---
    const savingsCallout = document.getElementById('savingsCallout');
    if (stats.tokens_saved > 0) {
      // Claude context window: ~200K tokens. Average read: ~4K tokens per tool call.
      // tokens_saved = tokens we didn't need to send. At ~750 tokens/minute reading speed:
      const minutesSaved = (stats.tokens_saved / 750).toFixed(1);
      const pctOfContext = ((stats.tokens_saved / 200000) * 100).toFixed(1);
      document.getElementById('savingsText').innerHTML =
        'Saved <strong>' + fmt(stats.tokens_saved) + ' tokens</strong> (' + stats.savings_pct + '% compression) — ' +
        'equivalent to <strong>~' + minutesSaved + ' min</strong> of context window, ' +
        'or <strong>' + pctOfContext + '%</strong> of Claude\\'s 200K context.';
      savingsCallout.style.display = 'flex';
    } else {
      savingsCallout.style.display = 'none';
    }

    // --- Toast: new observations ---
    if (lastObsCount !== null && stats.observations > lastObsCount) {
      const diff = stats.observations - lastObsCount;
      showToast('+' + diff + ' new observation' + (diff > 1 ? 's' : ''));
    }
    lastObsCount = stats.observations;

    // Token bars
    const maxTokens = Math.max(stats.tokens_in, 1);
    document.getElementById('barOriginal').style.width = '100%';
    document.getElementById('barSummary').style.width = Math.round((stats.tokens_out / maxTokens) * 100) + '%';
    document.getElementById('barSaved').style.width = Math.round((stats.tokens_saved / maxTokens) * 100) + '%';
    document.getElementById('numOriginal').textContent = fmt(stats.tokens_in);
    document.getElementById('numSummary').textContent = fmt(stats.tokens_out);
    document.getElementById('numSaved').textContent = fmt(stats.tokens_saved);

    // Type breakdown
    const typeGrid = document.getElementById('typeGrid');
    document.getElementById('typeCountIcon').textContent = stats.by_type.length;
    typeGrid.innerHTML = stats.by_type.map(t =>
      '<div class="type-tag' + (currentFilter === t.type ? ' active' : '') + '" data-type="' + t.type + '">' +
        '<div class="type-dot type-' + t.type + '"></div>' +
        t.type +
        '<span class="count">' + t.count + '</span>' +
      '</div>'
    ).join('');

    typeGrid.querySelectorAll('.type-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const type = tag.dataset.type;
        currentFilter = currentFilter === type ? null : type;
        refresh();
      });
    });

    // Sessions (clickable for filtering)
    document.getElementById('sessionCountIcon').textContent = sessions.length;
    document.getElementById('sessionFilterHint').textContent = currentSession ? 'click to clear filter' : 'click to filter';
    const sessionsList = document.getElementById('sessionsList');
    if (sessions.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state"><p>No sessions yet</p></div>';
    } else {
      sessionsList.innerHTML = sessions.map(s =>
        '<div class="session-row' + (currentSession === s.session_id ? ' active' : '') + '" data-sid="' + s.session_id + '">' +
          '<div class="session-id">' + s.session_id.slice(0, 12) + '...</div>' +
          '<div class="session-meta">' +
            '<span>' + s.obs_count + ' obs</span>' +
            '<span>' + timeAgo(s.last_at) + '</span>' +
          '</div>' +
        '</div>'
      ).join('');

      sessionsList.querySelectorAll('.session-row').forEach(row => {
        row.addEventListener('click', () => {
          const sid = row.dataset.sid;
          currentSession = currentSession === sid ? null : sid;
          refresh();
        });
      });
    }

    // --- Compression by Type ---
    const compressionEl = document.getElementById('compressionBars');
    if (compression.length === 0) {
      compressionEl.innerHTML = '<div class="empty-state"><p>No data yet</p></div>';
    } else {
      const typeColors = { code: 'var(--blue)', error: 'var(--red)', log: 'var(--orange)', test: 'var(--green)', commit: 'var(--purple)', decision: 'var(--pink)', context: 'var(--cyan)' };
      compressionEl.innerHTML = compression.map(c =>
        '<div class="compression-row">' +
          '<div class="compression-type">' + c.type + '</div>' +
          '<div class="compression-bar-bg">' +
            '<div class="compression-bar-fill" style="width:' + Math.max(c.compression_pct, 2) + '%;background:' + (typeColors[c.type] || 'var(--accent)') + ';">' +
              (c.compression_pct > 15 ? c.compression_pct + '%' : '') +
            '</div>' +
          '</div>' +
          '<div class="compression-stats">' + c.compression_pct + '%</div>' +
        '</div>'
      ).join('');
    }

    // --- Top Files ---
    const topFilesEl = document.getElementById('topFiles');
    if (topFiles.length === 0) {
      topFilesEl.innerHTML = '<div class="empty-state"><p>No file data</p></div>';
    } else {
      topFilesEl.innerHTML = topFiles.map((f, i) =>
        '<div class="file-row">' +
          '<div class="file-rank">' + (i + 1) + '</div>' +
          '<div class="file-path" title="' + escHtml(f.file_path) + '">' + escHtml(f.file_path.split('/').slice(-2).join('/')) + '</div>' +
          '<div class="file-count">' + f.count + 'x</div>' +
        '</div>'
      ).join('');
    }

    // --- Privacy Breakdown ---
    const privacyEl = document.getElementById('privacyBreakdown');
    const privTotal = privacy.reduce((s, p) => s + p.count, 0);
    if (privTotal === 0) {
      privacyEl.innerHTML = '<div class="empty-state"><p>No data</p></div>';
    } else {
      const privColors = { public: 'privacy-public', private: 'privacy-private', redacted: 'privacy-redacted' };
      privacyEl.innerHTML =
        '<div class="privacy-bar">' +
          privacy.map(p =>
            '<div class="privacy-segment ' + (privColors[p.level] || 'privacy-public') + '" style="width:' + Math.max(Math.round((p.count / privTotal) * 100), 5) + '%;">' +
              Math.round((p.count / privTotal) * 100) + '%' +
            '</div>'
          ).join('') +
        '</div>' +
        '<div class="privacy-legend">' +
          privacy.map(p =>
            '<div class="privacy-legend-item">' +
              '<div class="privacy-legend-dot ' + (privColors[p.level] || 'privacy-public') + '"></div>' +
              p.level + ' (' + p.count + ')' +
            '</div>'
          ).join('') +
        '</div>';
    }

    // --- Activity Chart ---
    const activityEl = document.getElementById('activityChart');
    const activityLabelsEl = document.getElementById('activityLabels');
    if (activity.length === 0) {
      activityEl.innerHTML = '<div class="empty-state" style="height:60px;display:flex;align-items:center;justify-content:center;width:100%;"><p>No recent activity</p></div>';
      activityLabelsEl.innerHTML = '';
    } else {
      const maxCount = Math.max(...activity.map(a => a.count), 1);
      activityEl.innerHTML = activity.map(a => {
        const h = Math.max(Math.round((a.count / maxCount) * 56), 3);
        return '<div class="activity-bar" style="height:' + h + 'px;" title="' + a.count + ' observations"></div>';
      }).join('');

      if (activity.length > 1) {
        const first = new Date(activity[0].hour_bucket);
        const last = new Date(activity[activity.length - 1].hour_bucket);
        activityLabelsEl.innerHTML =
          '<span>' + first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>' +
          '<span>' + last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>';
      }
    }

    // --- DB Health ---
    const dbHealthEl = document.getElementById('dbHealth');
    const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';
    dbHealthEl.innerHTML =
      '<div class="health-item"><span class="health-label">Schema</span><span class="health-value">v' + dbHealth.schema_version + '</span></div>' +
      '<div class="health-item"><span class="health-label">DB Size</span><span class="health-value">' + fmtBytes(dbHealth.db_size_bytes) + '</span></div>' +
      '<div class="health-item"><span class="health-label">WAL</span><span class="health-value">' + (dbHealth.wal_size_bytes > 0 ? fmtBytes(dbHealth.wal_size_bytes) : 'clean') + '</span></div>' +
      '<div class="health-item"><span class="health-label">Observations</span><span class="health-value">' + dbHealth.observations + '</span></div>' +
      '<div class="health-item"><span class="health-label">FTS5 Index</span><span class="health-value ' + (dbHealth.fts5_ok ? 'health-ok' : 'health-err') + '">' + (dbHealth.fts5_ok ? 'OK' : 'ERROR') + '</span></div>' +
      '<div class="health-item"><span class="health-label">Trigram</span><span class="health-value ' + (dbHealth.trigram_ok ? 'health-ok' : 'health-err') + '">' + (dbHealth.trigram_ok ? 'OK' : 'ERROR') + '</span></div>' +
      (dbHealth.oldest_at ? '<div class="health-item"><span class="health-label">Oldest</span><span class="health-value">' + formatDate(dbHealth.oldest_at) + '</span></div>' : '') +
      (dbHealth.newest_at ? '<div class="health-item"><span class="health-label">Newest</span><span class="health-value">' + formatDate(dbHealth.newest_at) + '</span></div>' : '');

    // --- Budget Status ---
    const budgetEl = document.getElementById('budgetContent');
    const budgetBadge = document.getElementById('budgetStrategyBadge');
    if (budget && budget.limit > 0) {
      const barClass = budget.blocked ? 'danger' : budget.throttled ? 'warn' : 'ok';
      const statusLabel = budget.blocked ? 'BLOCKED' : budget.throttled ? 'THROTTLED' : 'OK';
      budgetBadge.textContent = budget.strategy;
      budgetBadge.className = 'budget-strategy strategy-' + budget.strategy;
      budgetEl.innerHTML =
        '<div class="budget-bar-bg">' +
          '<div class="budget-bar-fill ' + barClass + '" style="width:' + Math.min(budget.pct, 100) + '%;">' +
            (budget.pct > 10 ? budget.pct + '%' : '') +
          '</div>' +
        '</div>' +
        '<div class="budget-meta">' +
          '<span>' + fmt(budget.used) + ' / ' + fmt(budget.limit) + ' tokens</span>' +
          '<span style="font-weight:600;color:var(--' + (budget.blocked ? 'red' : budget.throttled ? 'orange' : 'green') + ');">' + statusLabel + '</span>' +
        '</div>';
    } else {
      budgetBadge.textContent = '';
      budgetEl.innerHTML = '<div class="empty-state"><p>No budget configured</p></div>';
    }

    // --- Knowledge Base ---
    document.getElementById('knowledgeCount').textContent = knowledgeStats.total + ' entries' + (knowledgeStats.archived > 0 ? ' (' + knowledgeStats.archived + ' archived)' : '');
    const kCatsEl = document.getElementById('knowledgeCategories');
    const catColors = { pattern: 'cat-pattern', decision: 'cat-decision', error: 'cat-error', api: 'cat-api', component: 'cat-component' };
    kCatsEl.innerHTML = knowledgeStats.categories.map(c =>
      '<div class="knowledge-category ' + (catColors[c.category] || '') + '">' +
        c.category +
        '<span class="cat-count">' + c.count + '</span>' +
      '</div>'
    ).join('');

    // Only update the knowledge list if no active search query
    if (!knowledgeSearchQuery) {
      renderKnowledgeList(knowledge);
    }

    // --- Content Sources ---
    document.getElementById('contentSourceCount').textContent = contentSources.length + ' sources';
    const csListEl = document.getElementById('contentSourcesList');
    if (contentSources.length === 0) {
      csListEl.innerHTML = '<div class="empty-state"><p>No indexed content yet</p></div>';
    } else {
      csListEl.innerHTML = contentSources.map(cs =>
        '<div class="source-item">' +
          '<div class="source-name" title="' + escHtml(cs.source) + '">' + escHtml(cs.source) + '</div>' +
          '<div class="source-meta">' +
            '<span class="source-chunks">' + cs.chunk_count + ' chunks</span>' +
            (cs.code_chunks > 0 ? '<span class="source-code">' + cs.code_chunks + ' code</span>' : '') +
            '<span>' + fmtBytes(cs.total_bytes || 0) + '</span>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    // --- Events ---
    document.getElementById('eventCount').textContent = eventStats.total + ' events';
    const evtDistEl = document.getElementById('eventTypeDist');
    evtDistEl.innerHTML = eventStats.by_type.map(t =>
      '<div class="event-type-tag">' + t.event_type + ' <span style="color:var(--text-muted);">' + t.count + '</span></div>'
    ).join('');

    const errFixEl = document.getElementById('errorFixes');
    if (eventStats.error_fixes.length > 0) {
      errFixEl.innerHTML = '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">Error-Fix Patterns:</div>' +
        eventStats.error_fixes.slice(0, 5).map(ef =>
          '<div class="error-fix-item">' +
            '<span class="error-fix-icon">F</span>' +
            '<span>' + escHtml(ef.file) + '</span>' +
            '<span style="color:var(--text-muted);">' + (ef.time_to_fix_ms / 1000).toFixed(1) + 's</span>' +
          '</div>'
        ).join('');
    } else {
      errFixEl.innerHTML = '';
    }

    const evtListEl = document.getElementById('eventsList');
    if (events.length === 0) {
      evtListEl.innerHTML = '<div class="empty-state"><p>No events yet</p></div>';
    } else {
      evtListEl.innerHTML = events.map(ev => {
        const pClass = 'event-p' + Math.min(ev.priority || 4, 4);
        const dataStr = ev.data && typeof ev.data === 'object' ? Object.entries(ev.data).slice(0, 3).map(([k,v]) => k + ': ' + String(v).slice(0, 30)).join(', ') : '';
        return '<div class="event-item">' +
          '<div class="event-priority ' + pClass + '">P' + (ev.priority || 4) + '</div>' +
          '<div class="event-body">' +
            '<span class="event-type">' + ev.event_type + '</span>' +
            (ev.agent ? ' <span style="color:var(--text-muted);font-size:10px;">@' + escHtml(ev.agent) + '</span>' : '') +
            (dataStr ? '<div class="event-data">' + escHtml(dataStr) + '</div>' : '') +
          '</div>' +
          '<span class="event-time">' + timeAgo(ev.timestamp) + '</span>' +
        '</div>';
      }).join('');
    }

    // --- Snapshots ---
    document.getElementById('snapshotCount').textContent = snapshots.length + ' snapshots';
    const snapListEl = document.getElementById('snapshotsList');
    if (snapshots.length === 0) {
      snapListEl.innerHTML = '<div class="empty-state"><p>No snapshots saved yet</p></div>';
    } else {
      snapListEl.innerHTML = snapshots.map(snap => {
        const d = snap.data || {};
        const statsStr = typeof d.stats === 'string' ? d.stats : '';
        const intentStr = typeof d.intent === 'string' ? d.intent : '';
        return '<div class="snapshot-item">' +
          '<div class="snapshot-header">' +
            '<span class="snapshot-session">' + snap.session_id.slice(0, 14) + '...</span>' +
            '<span class="snapshot-time">' + timeAgo(snap.created_at) + '</span>' +
          '</div>' +
          (statsStr ? '<div class="snapshot-stats"><span style="color:var(--green);font-weight:600;">' + escHtml(statsStr) + '</span></div>' : '') +
          (intentStr ? '<div style="margin-top:2px;font-size:9px;color:var(--text-muted);">' + escHtml(intentStr) + '</div>' : '') +
          (d.files && typeof d.files === 'string' && d.files !== '' ?
            '<div style="margin-top:4px;font-size:9px;color:var(--text-muted);max-height:60px;overflow:hidden;">' +
              d.files.split('\\n').slice(0, 3).map(f => '&bull; ' + escHtml(f.replace(/^- /, '').slice(0, 70))).join('<br>') +
            '</div>' : '') +
        '</div>';
      }).join('');
    }

    // Search info bar
    const searchInfo = document.getElementById('searchInfo');
    const searchClear = document.getElementById('searchClear');
    if (isSearching) {
      document.getElementById('searchCount').textContent = timeline.length;
      document.getElementById('searchQuery').textContent = currentSearch;
      searchInfo.classList.add('visible');
      searchClear.classList.add('visible');
    } else {
      searchInfo.classList.remove('visible');
      searchClear.classList.remove('visible');
    }

    // Timeline / Search results
    const timelineEl = document.getElementById('timeline');
    if (timeline.length === 0) {
      const msg = isSearching
        ? 'No results for "' + escHtml(currentSearch) + '"'
        : 'No observations' + (currentFilter ? ' of type "' + currentFilter + '"' : '');
      timelineEl.innerHTML = '<div class="empty-state"><p>' + msg + '</p></div>';
    } else {
      timelineEl.innerHTML = timeline.map(obs => {
        let display = obs.summary || obs.content_preview || '(no content)';
        // Highlight search terms
        if (isSearching) {
          const terms = currentSearch.split(/\\s+/).filter(t => t.length > 0);
          let escaped = escHtml(display);
          for (const term of terms) {
            const re = new RegExp('(' + term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
            escaped = escaped.replace(re, '<span class="highlight">$1</span>');
          }
          display = null; // signal to use pre-escaped
          var displayHtml = escaped;
        }
        return '<div class="obs-item" data-obs-id="' + obs.id + '">' +
          '<div class="obs-type-indicator type-' + obs.type + '"></div>' +
          '<div class="obs-body">' +
            '<div class="obs-header">' +
              '<span class="obs-type-badge badge-' + obs.type + '">' + obs.type + '</span>' +
              (obs.rank !== undefined && obs.rank !== 0 ? '<span style="font-size:10px;color:var(--text-muted);">score: ' + Math.abs(obs.rank).toFixed(2) + '</span>' : '') +
              '<span class="obs-time">' + timeAgo(obs.indexed_at) + '</span>' +
            '</div>' +
            '<div class="obs-summary">' + (display !== null ? escHtml(display) : displayHtml) + '</div>' +
            '<div class="obs-id">' + obs.id + '</div>' +
            '<div class="obs-detail" id="detail-' + obs.id + '"></div>' +
          '</div>' +
        '</div>';
      }).join('');

      // Attach click handlers (event delegation)
      timelineEl.onclick = handleObsClick;

      // Restore open detail panel after re-render
      if (openDetailId) {
        const detailEl = document.getElementById('detail-' + openDetailId);
        if (detailEl && detailCache[openDetailId]) {
          detailEl.innerHTML = detailCache[openDetailId];
          detailEl.classList.add('open');
        }
      }
    }

    document.getElementById('statusText').textContent = 'connected';
    document.getElementById('refreshInfo').textContent = 'updated ' + new Date().toLocaleTimeString();

    // Refresh intelligence strip + Total Recall data on each data refresh
    loadIntelligence();
    loadTotalRecall();
  } catch (err) {
    document.getElementById('statusText').textContent = 'error: ' + err.message;
  }
}

// --- Detail panel: lazy-load on click ---
const detailCache = {};

async function handleObsClick(e) {
  const item = e.target.closest('.obs-item');
  if (!item) return;

  const id = item.dataset.obsId;
  if (!id) return;

  const detailEl = document.getElementById('detail-' + id);
  if (!detailEl) return;

  // Toggle: if already open, close it
  if (detailEl.classList.contains('open')) {
    detailEl.classList.remove('open');
    openDetailId = null;
    return;
  }

  // Close any other open panels
  document.querySelectorAll('.obs-detail.open').forEach(el => el.classList.remove('open'));

  // Track which panel is open (survives re-render)
  openDetailId = id;

  // Check cache first (no re-fetch)
  if (detailCache[id]) {
    detailEl.innerHTML = detailCache[id];
    detailEl.classList.add('open');
    return;
  }

  // Loading state
  detailEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px;">Loading...</div>';
  detailEl.classList.add('open');

  try {
    const obs = await fetchJson('/api/observation?id=' + encodeURIComponent(id));
    if (obs.error) {
      detailEl.innerHTML = '<div style="color:var(--red);font-size:11px;">' + escHtml(obs.error) + '</div>';
      return;
    }

    const meta = obs.metadata || {};
    const savings = meta.tokens_original && meta.tokens_summarized
      ? Math.round((1 - meta.tokens_summarized / meta.tokens_original) * 100)
      : null;

    let html = '<div class="detail-meta">';

    // Metadata chips
    if (meta.source) html += '<div class="detail-chip"><span class="label">source</span><span class="value">' + escHtml(meta.source) + '</span></div>';
    if (meta.file_path) html += '<div class="detail-chip"><span class="label">file</span><span class="value">' + escHtml(meta.file_path) + '</span></div>';
    if (meta.language) html += '<div class="detail-chip"><span class="label">lang</span><span class="value">' + escHtml(meta.language) + '</span></div>';
    html += '<div class="detail-chip"><span class="label">privacy</span><span class="value">' + (obs.privacy_level || 'public') + '</span></div>';
    if (meta.tokens_original) html += '<div class="detail-chip"><span class="label">tokens</span><span class="value">' + meta.tokens_original + '</span></div>';
    if (savings !== null) html += '<div class="detail-chip savings"><span class="label">saved</span><span class="value">' + savings + '%</span></div>';
    html += '<div class="detail-chip"><span class="label">chars</span><span class="value">' + fmt(obs.content_length) + '</span></div>';
    html += '<div class="detail-chip"><span class="label">session</span><span class="value">' + obs.session_id.slice(0, 10) + '...</span></div>';
    html += '</div>';

    // Summary (if different from content)
    if (obs.summary && obs.summary !== obs.content) {
      html += '<div class="detail-label">Summary</div>';
      html += '<div class="detail-summary-text">' + escHtml(obs.summary) + '</div>';
    }

    // Content with action buttons
    html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<div class="detail-label" style="margin-top:0;">Content</div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="copy-btn" data-copy-id="' + obs.id + '" data-copy="content">Copy</button>';
    html += '<button class="copy-btn" data-copy-id="' + obs.id + '" data-copy="id">Copy ID</button>';
    if (obs.content.length > 500) {
      html += '<button class="copy-btn" data-fullscreen="' + obs.id + '">Fullscreen</button>';
    }
    html += '</div></div>';
    const truncated = obs.content.length > 2000;
    html += '<div class="detail-content">' + escHtml(truncated ? obs.content.slice(0, 2000) + '\\n...(' + (obs.content.length - 2000) + ' more chars)' : obs.content) + '</div>';

    // Timestamp
    html += '<div style="margin-top:8px;font-size:10px;color:var(--text-muted);">' + formatDate(obs.indexed_at) + '</div>';

    detailEl.innerHTML = html;
    detailCache[id] = html;

    // Attach copy/fullscreen handlers
    detailEl.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const obsId = btn.dataset.copyId;
        const what = btn.dataset.copy;
        if (what === 'id') {
          navigator.clipboard.writeText(obsId).then(() => {
            btn.textContent = 'Copied!'; btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy ID'; btn.classList.remove('copied'); }, 1500);
          });
        } else {
          fetchJson('/api/observation?id=' + encodeURIComponent(obsId)).then(o => {
            if (o.error) return;
            navigator.clipboard.writeText(o.content).then(() => {
              btn.textContent = 'Copied!'; btn.classList.add('copied');
              setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            });
          });
        }
      });
    });

    detailEl.querySelectorAll('[data-fullscreen]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullscreen(btn.dataset.fullscreen);
      });
    });
  } catch (err) {
    detailEl.innerHTML = '<div style="color:var(--red);font-size:11px;">Failed to load: ' + escHtml(err.message) + '</div>';
  }
}

// Search input handling
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    currentSearch = searchInput.value.trim();
    refresh();
  }
  if (e.key === 'Escape') {
    searchInput.value = '';
    currentSearch = '';
    refresh();
    searchInput.blur();
  }
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentSearch = '';
  refresh();
  searchInput.focus();
});

// --- Knowledge search ---
const knowledgeSearchInput = document.getElementById('knowledgeSearchInput');
const knowledgeSearchClear = document.getElementById('knowledgeSearchClear');
let knowledgeSearchQuery = '';
let knowledgeSearchTimer = null;

function renderKnowledgeList(items) {
  const catColors = { pattern: 'cat-pattern', decision: 'cat-decision', error: 'cat-error', api: 'cat-api', component: 'cat-component' };
  const kListEl = document.getElementById('knowledgeList');
  if (items.length === 0) {
    kListEl.innerHTML = '<div class="empty-state"><p>' + (knowledgeSearchQuery ? 'No results for "' + escHtml(knowledgeSearchQuery) + '"' : 'No knowledge entries yet') + '</p></div>';
  } else {
    kListEl.innerHTML = items.map(k => {
      const catClass = catColors[k.category] || '';
      const catBg = k.category === 'pattern' ? 'var(--blue-dim)' : k.category === 'decision' ? 'var(--purple-dim)' : k.category === 'error' ? 'var(--red-dim)' : k.category === 'api' ? 'var(--cyan-dim)' : 'var(--green-dim)';
      let contentText = escHtml(k.content.slice(0, 120));
      if (knowledgeSearchQuery) {
        const terms = knowledgeSearchQuery.split(/\\s+/).filter(t => t.length > 0);
        for (const term of terms) {
          const re = new RegExp('(' + term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
          contentText = contentText.replace(re, '<span class="highlight">$1</span>');
        }
      }
      return '<div class="knowledge-item">' +
        '<div class="knowledge-item-header">' +
          '<span class="knowledge-item-cat ' + catClass + '" style="background:' + catBg + ';">' + k.category + '</span>' +
          '<span class="knowledge-item-title">' + escHtml(k.title) + '</span>' +
        '</div>' +
        '<div class="knowledge-item-content">' + contentText + '</div>' +
        '<div class="knowledge-item-meta">' +
          '<span>score: ' + (k.relevance_score || 0).toFixed(2) + '</span>' +
          '<span>accessed: ' + (k.access_count || 0) + 'x</span>' +
          (k.tags ? '<span>tags: ' + escHtml(k.tags) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }
}

async function doKnowledgeSearch() {
  const q = knowledgeSearchInput.value.trim();
  knowledgeSearchQuery = q;
  knowledgeSearchClear.style.display = q ? 'block' : 'none';
  if (!q) {
    // Restore default knowledge list from last refresh
    const items = await fetchJson('/api/knowledge?limit=20');
    renderKnowledgeList(items);
    return;
  }
  const results = await fetchJson('/api/knowledge/search?q=' + encodeURIComponent(q) + '&limit=50');
  renderKnowledgeList(results);
}

knowledgeSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(knowledgeSearchTimer);
    doKnowledgeSearch();
  }
  if (e.key === 'Escape') {
    knowledgeSearchInput.value = '';
    knowledgeSearchQuery = '';
    knowledgeSearchClear.style.display = 'none';
    doKnowledgeSearch();
    knowledgeSearchInput.blur();
  }
});

knowledgeSearchInput.addEventListener('input', () => {
  clearTimeout(knowledgeSearchTimer);
  knowledgeSearchTimer = setTimeout(doKnowledgeSearch, 300);
});

knowledgeSearchClear.addEventListener('click', () => {
  knowledgeSearchInput.value = '';
  knowledgeSearchQuery = '';
  knowledgeSearchClear.style.display = 'none';
  doKnowledgeSearch();
  knowledgeSearchInput.focus();
});

// --- Toast notifications ---
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<div class="dot"></div>' + escHtml(msg);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- Theme toggle ---
function setTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle('light', theme === 'light');
  document.getElementById('themeToggle').textContent = theme === 'light' ? 'D' : 'L';
  localStorage.setItem('cm-theme', theme);
}

setTheme(currentTheme);
document.getElementById('themeToggle').addEventListener('click', () => {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// --- Knowledge Graph (pure JS/SVG force-directed layout) ---
const GRAPH_COLORS = {
  person: '#ec4899',
  technology: '#3b82f6',
  concept: '#a855f7',
  file: '#22c55e',
  project: '#f59e0b',
  organization: '#06b6d4',
  default: '#6366f1',
};

let graphNodes = [];
let graphEdges = [];
let graphSim = null;

function getNodeColor(type) {
  return GRAPH_COLORS[type] || GRAPH_COLORS[(type || '').toLowerCase()] || GRAPH_COLORS.default;
}

async function loadGraph() {
  const entity = document.getElementById('graphEntityFilter').value;
  const depth = document.getElementById('graphDepth').value;
  let url = '/api/graph?depth=' + depth;
  if (entity) url += '&entity=' + encodeURIComponent(entity);
  const data = await fetchJson(url);
  graphNodes = data.nodes || [];
  graphEdges = data.edges || [];
  renderGraph();
}

function renderGraph() {
  const canvas = document.getElementById('graphCanvas');
  const empty = document.getElementById('graphEmpty');
  const statsEl = document.getElementById('graphStats');
  const tooltip = document.getElementById('graphTooltip');

  if (graphNodes.length === 0) {
    canvas.innerHTML = '';
    canvas.appendChild(empty);
    empty.style.display = 'flex';
    statsEl.textContent = '';
    return;
  }
  empty.style.display = 'none';

  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 400;

  // Build SVG
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  canvas.innerHTML = '';
  canvas.appendChild(svg);

  // Arrow marker
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '20');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', 'var(--text-muted)');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Create node id map
  const nodeMap = {};
  graphNodes.forEach((n, i) => {
    nodeMap[n.id] = i;
    n.x = w / 2 + (Math.random() - 0.5) * w * 0.6;
    n.y = h / 2 + (Math.random() - 0.5) * h * 0.6;
    n.vx = 0;
    n.vy = 0;
  });

  // Draw edges
  const edgeEls = [];
  for (const e of graphEdges) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('stroke', 'var(--text-muted)');
    line.setAttribute('stroke-width', Math.max(1, Math.min(e.weight || 1, 3)));
    line.setAttribute('stroke-opacity', '0.4');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    svg.appendChild(line);
    edgeEls.push({ el: line, source: nodeMap[e.source], target: nodeMap[e.target], data: e });
  }

  // Draw nodes
  const nodeEls = [];
  for (let i = 0; i < graphNodes.length; i++) {
    const n = graphNodes[i];
    const g = document.createElementNS(ns, 'g');
    g.style.cursor = 'pointer';
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('r', 8);
    circle.setAttribute('fill', getNodeColor(n.type));
    circle.setAttribute('stroke', 'var(--bg)');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'graph-node-label');
    label.setAttribute('dy', '22');
    label.textContent = (n.name || '').slice(0, 20);
    g.appendChild(label);

    // Tooltip on hover
    g.addEventListener('mouseenter', function(ev) {
      tooltip.style.display = 'block';
      document.getElementById('ttName').textContent = n.name;
      document.getElementById('ttType').textContent = n.type + (n.knowledge_id ? ' (linked to knowledge)' : '');
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = (ev.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (ev.clientY - rect.top - 10) + 'px';
    });
    g.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });

    // Click for detail
    g.addEventListener('click', function() {
      if (n.knowledge_id) {
        // Filter graph to this entity
        document.getElementById('graphEntityFilter').value = n.name;
        loadGraph();
      }
    });

    svg.appendChild(g);
    nodeEls.push({ el: g, data: n });
  }

  // Simple force simulation (inline, no D3)
  let running = true;
  let iterations = 0;
  const maxIter = 200;

  function tick() {
    if (!running || iterations >= maxIter) return;
    iterations++;

    // Repulsion between all nodes
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const dx = graphNodes[j].x - graphNodes[i].x;
        const dy = graphNodes[j].y - graphNodes[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 800 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        graphNodes[i].vx -= fx;
        graphNodes[i].vy -= fy;
        graphNodes[j].vx += fx;
        graphNodes[j].vy += fy;
      }
    }

    // Attraction along edges
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 100) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Center gravity
    for (const n of graphNodes) {
      n.vx += (w / 2 - n.x) * 0.002;
      n.vy += (h / 2 - n.y) * 0.002;
    }

    // Apply velocities with damping
    const damping = 0.85;
    for (const n of graphNodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(20, Math.min(w - 20, n.x));
      n.y = Math.max(20, Math.min(h - 20, n.y));
    }

    // Update DOM
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      e.el.setAttribute('x1', s.x);
      e.el.setAttribute('y1', s.y);
      e.el.setAttribute('x2', t.x);
      e.el.setAttribute('y2', t.y);
    }
    for (let i = 0; i < nodeEls.length; i++) {
      nodeEls[i].el.setAttribute('transform', 'translate(' + graphNodes[i].x + ',' + graphNodes[i].y + ')');
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // Enable drag
  let dragNode = null;
  svg.addEventListener('mousedown', function(ev) {
    const target = ev.target.closest('g');
    if (!target) return;
    const idx = nodeEls.findIndex(n => n.el === target);
    if (idx >= 0) { dragNode = idx; running = false; }
  });
  svg.addEventListener('mousemove', function(ev) {
    if (dragNode == null) return;
    const rect = svg.getBoundingClientRect();
    graphNodes[dragNode].x = ev.clientX - rect.left;
    graphNodes[dragNode].y = ev.clientY - rect.top;
    // Update positions
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      e.el.setAttribute('x1', s.x);
      e.el.setAttribute('y1', s.y);
      e.el.setAttribute('x2', t.x);
      e.el.setAttribute('y2', t.y);
    }
    for (let i = 0; i < nodeEls.length; i++) {
      nodeEls[i].el.setAttribute('transform', 'translate(' + graphNodes[i].x + ',' + graphNodes[i].y + ')');
    }
  });
  svg.addEventListener('mouseup', function() {
    if (dragNode != null) {
      dragNode = null;
      running = true;
      iterations = Math.max(iterations, maxIter - 50);
      requestAnimationFrame(tick);
    }
  });

  statsEl.innerHTML = '<span>Nodes: ' + graphNodes.length + '</span><span>Edges: ' + graphEdges.length + '</span>';
}

// Load graph on startup
loadGraph();

// --- Agents Panel ---
async function refreshAgents() {
  try {
    const agents = await fetchJson('/api/agents');
    const container = document.getElementById('agentsContainer');
    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="agents-empty">No agents registered</div>';
      return;
    }
    container.innerHTML = '<div class="agents-grid">' + agents.map(function(a) {
      const now = Date.now();
      const hb = a.last_heartbeat || a.lastHeartbeat || 0;
      const stale = hb > 0 && (now - hb) > 30000;
      const statusClass = stale ? 'idle' : (hb > 0 ? 'active' : 'offline');
      const statusLabel = stale ? 'stale' : (hb > 0 ? 'active' : 'unknown');
      const files = a.claimed_files || a.claimedFiles || [];
      const filesHtml = files.length > 0
        ? '<div class="agent-files">' + files.map(function(f) { return '<span class="agent-file-tag">' + escHtml(f) + '</span>'; }).join('') + '</div>'
        : '';
      return '<div class="agent-card">' +
        '<div class="agent-name"><span class="agent-status-dot ' + statusClass + '"></span>' + escHtml(a.name || a.id || 'Agent') + '</div>' +
        '<div class="agent-detail"><strong>Task:</strong> ' + escHtml(a.task || a.current_task || 'idle') + '</div>' +
        (hb > 0 ? '<div class="agent-detail"><strong>Heartbeat:</strong> ' + timeAgo(hb) + ' (' + statusLabel + ')</div>' : '') +
        filesHtml +
        '</div>';
    }).join('') + '</div>';
  } catch { /* agents api optional */ }
}

// Poll agents every 5 seconds
refreshAgents();
setInterval(refreshAgents, 5000);

// --- Fullscreen content viewer ---
const fullscreenOverlay = document.getElementById('fullscreenOverlay');

function openFullscreen(id) {
  const obs = detailCache[id] ? null : null; // We need raw data
  fetchJson('/api/observation?id=' + encodeURIComponent(id)).then(obs => {
    if (obs.error) return;
    fullscreenData = obs;
    document.getElementById('fullscreenBadge').className = 'obs-type-badge badge-' + obs.type;
    document.getElementById('fullscreenBadge').textContent = obs.type;
    document.getElementById('fullscreenId').textContent = obs.id;
    document.getElementById('fullscreenBody').textContent = obs.content;
    fullscreenOverlay.classList.add('open');
  });
}

document.getElementById('fullscreenCopy').addEventListener('click', function() {
  if (!fullscreenData) return;
  navigator.clipboard.writeText(fullscreenData.content).then(() => {
    this.textContent = 'Copied!';
    this.classList.add('copied');
    setTimeout(() => { this.textContent = 'Copy content'; this.classList.remove('copied'); }, 1500);
  });
});

// --- Copy helper for detail panels ---
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

// Keyboard shortcuts
const shortcutsOverlay = document.getElementById('shortcutsOverlay');

document.addEventListener('keydown', (e) => {
  const inSearch = document.activeElement === searchInput;

  if (e.key === '/' && !inSearch) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === '?' && !inSearch) {
    e.preventDefault();
    shortcutsOverlay.classList.toggle('open');
  }
  if (e.key === 'Escape') {
    if (fullscreenOverlay.classList.contains('open')) {
      fullscreenOverlay.classList.remove('open');
    } else if (shortcutsOverlay.classList.contains('open')) {
      shortcutsOverlay.classList.remove('open');
    }
  }
  if (e.key === 'r' && !inSearch) {
    e.preventDefault();
    refresh();
  }
  if (e.key === 'c' && !inSearch) {
    e.preventDefault();
    currentFilter = null;
    currentSession = null;
    currentSearch = '';
    searchInput.value = '';
    refresh();
  }
  if (e.key === 't' && !inSearch) {
    e.preventDefault();
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }
});

shortcutsOverlay.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) shortcutsOverlay.classList.remove('open');
});

fullscreenOverlay.addEventListener('click', (e) => {
  if (e.target === fullscreenOverlay) fullscreenOverlay.classList.remove('open');
});

// --- Vector search banner ---
async function checkVectorStatus() {
  try {
    const data = await fetchJson('/api/vector-status');
    const banner = document.getElementById('vectorBanner');
    const icon = document.getElementById('vectorIcon');
    const text = document.getElementById('vectorText');
    const btn = document.getElementById('vectorBtn');
    const progress = document.getElementById('vectorProgress');

    // Reset
    banner.className = 'vector-banner ' + data.status;
    btn.style.display = 'none';
    btn.disabled = false;
    progress.style.display = 'none';

    if (data.status === 'active') {
      // Level 3: fully active
      const pct = data.totalCount > 0 ? Math.round((data.embeddedCount / data.totalCount) * 100) : 0;
      icon.textContent = '\\u2713';
      text.innerHTML = '<div><strong>Semantic search active</strong> — ' + data.embeddedCount + ' of ' + data.totalCount + ' observations embedded (' + pct + '%)</div>' +
        '<div class="vector-banner-sub">Search finds meaning, not just keywords — e.g. "auth problem" matches "login token expired"</div>';
      banner.style.display = 'flex';
    } else if (data.status === 'ready') {
      // Vector enabled + HF installed but no embeddings yet (first use)
      icon.textContent = '\\u2026';
      text.innerHTML = '<div><strong>Semantic search ready</strong> — waiting for first observation to download model (~22MB, one-time)</div>' +
        '<div class="vector-banner-sub">New observations will be embedded automatically</div>';
      banner.style.display = 'flex';
    } else if (data.status === 'missing-pkg') {
      // Level 2: config has vector but package missing
      icon.textContent = '!';
      text.innerHTML = '<div><strong>Vector search configured but package missing</strong></div>' +
        '<div class="vector-banner-sub">Run: <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;">npm install @huggingface/transformers</code> — then restart the server</div>';
      btn.textContent = 'Copy Command';
      btn.style.display = 'inline-block';
      btn.onclick = function() {
        navigator.clipboard.writeText('npm install @huggingface/transformers').then(function() {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy Command'; }, 2000);
        });
      };
      banner.style.display = 'flex';
    } else if (data.status === 'available') {
      // Level 1: not configured at all (upsell)
      icon.textContent = 'V';
      text.innerHTML = '<div><strong>Unlock semantic search</strong> — find "auth problem" when stored as "login token expired"</div>' +
        '<div class="vector-banner-sub">Local embeddings via all-MiniLM-L6-v2 — no cloud, no cost, ~22MB one-time download</div>';
      btn.textContent = 'Enable Vector Search';
      btn.style.display = 'inline-block';
      btn.onclick = enableVectorSearch;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  } catch {}
}

async function enableVectorSearch() {
  const btn = document.getElementById('vectorBtn');
  const progress = document.getElementById('vectorProgress');
  const text = document.getElementById('vectorText');

  btn.disabled = true;
  btn.style.display = 'none';
  progress.style.display = 'flex';

  try {
    // Step 1: Add "vector" to config
    const res = await fetch(API + '/api/enable-vector', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showToast('Failed to update config: ' + (data.error || 'Unknown'));
      btn.style.display = 'inline-block';
      btn.disabled = false;
      progress.style.display = 'none';
      return;
    }

    // Step 2: Show next steps
    progress.style.display = 'none';
    const icon = document.getElementById('vectorIcon');
    const banner = document.getElementById('vectorBanner');
    banner.className = 'vector-banner missing-pkg';
    icon.textContent = '\\u2192';
    text.innerHTML = '<div><strong>Config updated!</strong> "vector" added to search plugins.</div>' +
      '<div class="vector-banner-sub">Next: run <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;">npm install @huggingface/transformers</code> in your project, then restart the server.</div>';
    btn.textContent = 'Copy Command';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    btn.className = 'vector-banner-btn';
    btn.onclick = function() {
      navigator.clipboard.writeText('npm install @huggingface/transformers').then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy Command'; }, 2000);
      });
    };

    showToast('Vector search enabled in config');
  } catch (err) {
    progress.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    showToast('Failed: ' + err.message);
  }
}

// Check vector status once on load and on project switch
checkVectorStatus();

// --- Init banner ---
let initChecked = false;
async function checkInitStatus() {
  try {
    const res = await fetch(API + '/api/init-status');
    const data = await res.json();
    const banner = document.getElementById('initBanner');
    if (data.initialized) {
      banner.style.display = 'none';
      return;
    }
    // Show banner
    const editorsEl = document.getElementById('initEditors');
    if (data.detectedEditors && data.detectedEditors.length > 0) {
      editorsEl.textContent = 'Detected: ' + data.detectedEditors.join(', ') + ' — init will configure MCP + rules for ' + (data.detectedEditors.length === 1 ? 'it' : 'all of them');
    }
    banner.style.display = 'flex';
  } catch {}
}

async function runInit() {
  const btn = document.getElementById('initBtn');
  const progress = document.getElementById('initProgress');
  const banner = document.getElementById('initBanner');

  btn.disabled = true;
  btn.style.display = 'none';
  progress.style.display = 'flex';

  try {
    const res = await fetch(API + '/api/run-init', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      banner.classList.add('success');
      banner.querySelector('.init-banner-icon').textContent = '\\u2713';
      banner.querySelector('.init-banner-text').innerHTML = '<div><strong>Setup complete!</strong> Editor configs and rules have been configured.</div>' +
        (data.output ? '<div class="init-editors" style="white-space:pre-line;">' + escHtml(data.output) + '</div>' : '');
      progress.style.display = 'none';
      showToast('Init completed successfully');
      setTimeout(() => { banner.style.display = 'none'; }, 5000);
    } else {
      progress.style.display = 'none';
      btn.style.display = 'inline-block';
      btn.disabled = false;
      showToast('Init failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    progress.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    showToast('Init failed: ' + err.message);
  }
}

// Check init status once on load
checkInitStatus();

// Auto-refresh: 3s default, 10s when WebSocket is connected
let pollInterval = 3000;
let pollTimer = null;

function startPolling(interval) {
  if (pollTimer) clearInterval(pollTimer);
  pollInterval = interval;
  pollTimer = setInterval(() => {
    if (document.activeElement !== searchInput) refresh();
  }, pollInterval);
}

refresh();
startPolling(3000);

// --- WebSocket real-time connection ---
(function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = proto + '//127.0.0.1:' + location.port + '/ws';
  let reconnectDelay = 1000;
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch { return; }

    ws.onopen = function() {
      reconnectDelay = 1000; // reset backoff
      // Reduce HTTP polling when WS is active
      startPolling(10000);
      document.getElementById('statusText').textContent = 'live';
    };

    ws.onmessage = function(evt) {
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'observation:new' && event.data) {
          // Prepend to timeline without full refresh
          const tlEl = document.getElementById('timeline');
          if (tlEl) {
            const obs = event.data;
            const time = new Date(obs.indexed_at || Date.now()).toLocaleTimeString();
            const summary = escHtml(obs.summary || (obs.content || '').substring(0, 120));
            const html = '<div class="obs-row" onclick="toggleDetail(\\'' + escHtml(obs.id || '') + '\\')" style="opacity:0;transition:opacity 0.3s;">' +
              '<div class="obs-header">' +
                '<span class="obs-type-badge badge-' + escHtml(obs.type || 'unknown') + '">' + escHtml(obs.type || '?') + '</span>' +
                '<span class="obs-time">' + time + '</span>' +
              '</div>' +
              '<div class="obs-summary">' + summary + '</div>' +
            '</div>';
            tlEl.insertAdjacentHTML('afterbegin', html);
            // Fade in
            const first = tlEl.firstElementChild;
            if (first) requestAnimationFrame(() => { first.style.opacity = '1'; });
          }
        }
        if (event.type === 'stats:update' && event.data) {
          const stats = event.data;
          const el = (id) => document.getElementById(id);
          if (el('statObs')) el('statObs').textContent = fmt(stats.observations);
          if (el('statSaved')) el('statSaved').textContent = fmt(stats.tokens_saved);
          if (el('statPct')) el('statPct').textContent = stats.savings_pct + '%';
          if (el('statSearches')) el('statSearches').textContent = fmt(stats.searches);
          if (el('refreshInfo')) el('refreshInfo').textContent = 'ws ' + new Date().toLocaleTimeString();
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = function() {
      ws = null;
      // Restore fast HTTP polling
      startPolling(3000);
      document.getElementById('statusText').textContent = 'connected';
      scheduleReconnect();
    };

    ws.onerror = function() {
      // onclose will fire after onerror
      try { ws.close(); } catch {}
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect();
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }, reconnectDelay);
  }

  connect();
})();
</script>
</body>
</html>`;
}

// --- Graph Page HTML ---
function getGraphPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Knowledge Graph</title>
<style>
  :root {
    --bg: #08080d;
    --bg-card: #0f0f17;
    --bg-card-hover: #161622;
    --bg-elevated: #1a1a28;
    --border: #1e1e30;
    --border-subtle: #14141f;
    --text: #e8e8ef;
    --text-dim: #7a7a90;
    --text-muted: #4a4a60;
    --accent: #818cf8;
    --accent-dim: #6366f1;
    --green: #34d399;
    --green-dim: rgba(52, 211, 153, 0.12);
    --orange: #fbbf24;
    --orange-dim: rgba(251, 191, 36, 0.12);
    --red: #f87171;
    --red-dim: rgba(248, 113, 113, 0.12);
    --blue: #60a5fa;
    --blue-dim: rgba(96, 165, 250, 0.12);
    --purple: #c084fc;
    --purple-dim: rgba(192, 132, 252, 0.12);
    --cyan: #22d3ee;
    --cyan-dim: rgba(34, 211, 238, 0.12);
    --pink: #f472b6;
    --pink-dim: rgba(244, 114, 182, 0.12);
    --radius: 16px;
    --radius-sm: 10px;
    --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-ui);
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    border-bottom: 1px solid var(--border);
    background: rgba(8,8,13,0.85);
    flex-shrink: 0;
    z-index: 100;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo {
    width: 28px; height: 28px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: white; letter-spacing: -0.5px;
  }
  .header h1 { font-size: 14px; font-weight: 600; letter-spacing: -0.3px; font-family: var(--font-ui); }
  .header h1 span { color: var(--text-dim); font-weight: 400; }
  .nav-links {
    display: flex; align-items: center; gap: 2px; margin-left: 12px;
    background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 3px;
  }
  .nav-link {
    font-size: 12px; font-weight: 500; color: var(--text-dim); text-decoration: none;
    padding: 4px 12px; border-radius: 7px; transition: all 0.15s ease; font-family: var(--font-ui);
    white-space: nowrap;
  }
  .nav-link:hover { color: var(--text); background: var(--bg-card-hover); }
  .nav-link.active { color: var(--text); background: var(--bg-card); }

  .graph-toolbar {
    display: flex; align-items: center; gap: 10px; padding: 12px 24px;
    background: var(--bg-card); border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .graph-toolbar input, .graph-toolbar select {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 6px 12px; font-size: 12px; color: var(--text); font-family: var(--font-ui);
  }
  .graph-toolbar input { width: 240px; }
  .graph-toolbar button {
    background: var(--accent); border: none; border-radius: var(--radius-sm);
    padding: 6px 16px; color: #fff; font-size: 12px; cursor: pointer;
    font-family: var(--font-ui); transition: background 0.15s;
  }
  .graph-toolbar button:hover { background: var(--accent-dim); }
  .graph-toolbar .stats {
    margin-left: auto; font-size: 11px; color: var(--text-dim);
    display: flex; gap: 16px; font-family: var(--font-mono);
  }

  .theme-toggle {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-dim); font-size: 13px; width: 30px; height: 30px;
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  body.light {
    --bg: #f8f8fb; --bg-card: #ffffff; --bg-card-hover: #f3f3f8;
    --bg-elevated: #eeeef4; --border: #e2e2ea; --text: #1a1a2e;
    --text-dim: #5a5a72; --text-muted: #9090a8;
  }
  body.light .header { background: rgba(248,248,251,0.85); }

  .graph-container {
    flex: 1; position: relative; overflow: hidden; background: var(--bg);
  }

  #graphCanvas {
    width: 100%; height: 100%; display: block; cursor: grab;
  }
  #graphCanvas.dragging { cursor: grabbing; }

  .graph-legend {
    position: absolute; bottom: 16px; left: 16px; background: var(--bg-card);
    border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;
    font-size: 11px; display: flex; flex-direction: column; gap: 6px;
    opacity: 0.9;
  }
  .legend-item { display: flex; align-items: center; gap: 8px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  .node-detail {
    position: absolute; top: 16px; right: 16px; width: 320px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 20px; font-size: 12px; display: none; z-index: 50;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); max-height: calc(100vh - 140px); overflow-y: auto;
  }
  .node-detail.open { display: block; }
  .node-detail-close {
    position: absolute; top: 10px; right: 14px; background: none; border: none;
    color: var(--text-dim); font-size: 16px; cursor: pointer; font-family: var(--font-ui);
  }
  .node-detail-name { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .node-detail-type {
    display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px;
    margin-bottom: 12px;
  }
  .node-detail-section { margin-top: 12px; }
  .node-detail-section-title { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .node-detail-rel {
    font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 6px;
  }
  .node-detail-rel:last-child { border-bottom: none; }
  .rel-type-badge {
    font-size: 9px; padding: 1px 6px; border-radius: 8px;
    background: var(--border); color: var(--text-dim);
  }

  .graph-empty-state {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center; color: var(--text-muted); font-size: 14px;
  }
  .graph-empty-state p { margin-top: 8px; font-size: 12px; }

  /* --- Project Bar --- */
  .project-bar { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 8px 24px; flex-shrink: 0; }
  .project-bar-inner { display: flex; align-items: center; gap: 12px; max-width: 1400px; margin: 0 auto; }
  .project-bar-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); }
  .project-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; overflow-x: auto; }
  .project-pill { display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.15s ease; white-space: nowrap; user-select: none; font-family: var(--font-ui); }
  .project-pill:hover { border-color: var(--cyan); color: var(--text); background: var(--bg-card-hover); }
  .project-pill.active { background: var(--cyan-dim); border-color: var(--cyan); color: var(--cyan); font-weight: 600; }
  .project-pill .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .project-pill.skeleton { opacity: 0.4; cursor: default; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; font-family: var(--font-mono); }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>ContextMem</h1>
    <nav class="nav-links">
      <a href="/" class="nav-link">Home</a>
      <a href="/graph" class="nav-link active">Graph</a>
      <a href="/timeline" class="nav-link">Timeline</a>
      <a href="/diagnostics" class="nav-link">Diagnostics</a>
      <a href="/compression" class="nav-link">Compression</a>
    </nav>
  </div>
  <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
</div>

<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="graph-toolbar">
  <input type="text" id="entityFilter" placeholder="Filter by entity name..." />
  <select id="depthSelect">
    <option value="1">Depth 1</option>
    <option value="2" selected>Depth 2</option>
    <option value="3">Depth 3</option>
    <option value="4">Depth 4</option>
    <option value="5">Depth 5</option>
  </select>
  <select id="typeFilter">
    <option value="">All types</option>
    <option value="file">File</option>
    <option value="module">Module</option>
    <option value="pattern">Pattern</option>
    <option value="decision">Decision</option>
    <option value="bug">Bug</option>
    <option value="api">API</option>
    <option value="person">Person</option>
    <option value="concept">Concept</option>
  </select>
  <button onclick="loadGraph()">Load</button>
  <button onclick="resetZoom()" style="background:var(--border);color:var(--text);">Reset View</button>
  <div class="stats" id="graphStats"></div>
</div>

<div class="graph-container" id="graphContainer">
  <canvas id="graphCanvas"></canvas>
  <div class="graph-empty-state" id="emptyState">
    <div style="font-size:32px;margin-bottom:12px;">*</div>
    <div>Knowledge Graph</div>
    <p>Click "Load" to visualize entity relationships</p>
  </div>

  <div class="graph-legend" id="graphLegend">
    <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div> file</div>
    <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div> module</div>
    <div class="legend-item"><div class="legend-dot" style="background:#a855f7"></div> pattern / concept</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> decision</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> bug</div>
    <div class="legend-item"><div class="legend-dot" style="background:#06b6d4"></div> api</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ec4899"></div> person</div>
  </div>

  <div class="node-detail" id="nodeDetail">
    <button class="node-detail-close" onclick="closeDetail()">&times;</button>
    <div class="node-detail-name" id="detailName"></div>
    <div class="node-detail-type" id="detailType"></div>
    <div class="node-detail-section" id="detailMeta"></div>
    <div class="node-detail-section" id="detailRels"></div>
  </div>
</div>

<script>
(function() {
  'use strict';

  const TYPE_COLORS = {
    file: '#22c55e', module: '#3b82f6', pattern: '#a855f7', concept: '#a855f7',
    decision: '#f59e0b', bug: '#ef4444', api: '#06b6d4', person: '#ec4899',
    project: '#f59e0b', organization: '#06b6d4', technology: '#3b82f6',
  };
  const DEFAULT_COLOR = '#6366f1';

  function getColor(type) { return TYPE_COLORS[type] || TYPE_COLORS[(type||'').toLowerCase()] || DEFAULT_COLOR; }

  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('graphContainer');

  let nodes = [], edges = [], nodeMap = {};
  let simRunning = false, simIterations = 0;
  let panX = 0, panY = 0, zoom = 1;
  let dragNode = null, isPanning = false, lastMouse = {x:0,y:0};
  let hoveredNode = null, selectedNode = null;
  let animFrame = null;

  function resize() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  function screenToWorld(sx, sy) {
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  }

  function worldToScreen(wx, wy) {
    return { x: wx * zoom + panX, y: wy * zoom + panY };
  }

  function findNodeAt(sx, sy) {
    const w = screenToWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - w.x, dy = n.y - w.y;
      const r = (n._radius || 8) + 4;
      if (dx*dx + dy*dy < r*r) return n;
    }
    return null;
  }

  // --- Force simulation ---
  function initSim() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);

    nodes.forEach(n => {
      n.x = w / 2 + (Math.random() - 0.5) * w * 0.5;
      n.y = h / 2 + (Math.random() - 0.5) * h * 0.5;
      n.vx = 0; n.vy = 0;
      // Scale node size by connection count
      const connCount = edges.filter(e => e.source === n.id || e.target === n.id).length;
      n._radius = Math.max(6, Math.min(20, 6 + connCount * 2));
    });

    panX = 0; panY = 0; zoom = 1;
    simIterations = 0;
    simRunning = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    tickSim();
  }

  function tickSim() {
    if (!simRunning || simIterations >= 300) { simRunning = false; draw(); return; }
    simIterations++;

    const cw = canvas.width / (window.devicePixelRatio || 1);
    const ch = canvas.height / (window.devicePixelRatio || 1);

    // Repulsion (Barnes-Hut-like, but simple O(n^2) for small graphs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
        const force = 1200 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }

    // Edge attraction
    for (const e of edges) {
      const s = nodeMap[e.source], t = nodeMap[e.target];
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
      const force = (dist - 120) * 0.008;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cw / 2 - n.x) * 0.001;
      n.vy += (ch / 2 - n.y) * 0.001;
    }

    // Apply velocities + damping
    const damping = 0.88;
    for (const n of nodes) {
      if (n === dragNode) continue;
      n.vx *= damping; n.vy *= damping;
      n.x += n.vx; n.y += n.vy;
    }

    draw();
    animFrame = requestAnimationFrame(tickSim);
  }

  // --- Drawing ---
  function draw() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw edges
    for (const e of edges) {
      const s = nodeMap[e.source], t = nodeMap[e.target];
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = 'rgba(100,100,130,0.3)';
      ctx.lineWidth = Math.max(0.5, Math.min((e.weight || 1) * 0.8, 3));
      ctx.stroke();

      // Edge label (relationship type)
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(100,100,130,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText(e.type || '', mx, my - 4);

      // Arrowhead
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const tr = (t._radius || 8) + 4;
      const ax = t.x - Math.cos(angle) * tr;
      const ay = t.y - Math.sin(angle) * tr;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
      ctx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(100,100,130,0.4)';
      ctx.fill();
    }

    // Draw nodes
    for (const n of nodes) {
      const r = n._radius || 8;
      const color = getColor(n.type);

      // Glow for hovered/selected
      if (n === hoveredNode || n === selectedNode) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', ',0.2)').replace('rgb', 'rgba');
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = n === selectedNode ? '#fff' : 'rgba(10,10,15,0.8)';
      ctx.lineWidth = n === selectedNode ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      ctx.font = '10px monospace';
      ctx.fillStyle = '#e2e2e8';
      ctx.textAlign = 'center';
      const label = (n.name || '').length > 24 ? (n.name || '').slice(0, 22) + '..' : (n.name || '');
      ctx.fillText(label, n.x, n.y + r + 14);
    }

    ctx.restore();

    // Tooltip for hovered node
    if (hoveredNode && hoveredNode !== selectedNode) {
      const sp = worldToScreen(hoveredNode.x, hoveredNode.y);
      ctx.fillStyle = 'rgba(18,18,26,0.95)';
      const tipW = 200, tipH = 44;
      const tx = Math.min(sp.x + 16, w - tipW - 8);
      const ty = Math.max(sp.y - 10, 8);
      ctx.beginPath();
      ctx.roundRect(tx, ty, tipW, tipH, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,46,1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#e2e2e8';
      ctx.textAlign = 'left';
      ctx.fillText(hoveredNode.name || '', tx + 10, ty + 16);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#6b6b80';
      ctx.fillText(hoveredNode.type + (hoveredNode.knowledge_id ? ' (linked)' : ''), tx + 10, ty + 32);
    }
  }

  // --- Interaction ---
  canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    if (node) {
      dragNode = node;
      simRunning = false;
      canvas.classList.add('dragging');
    } else {
      isPanning = true;
      canvas.classList.add('dragging');
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (dragNode) {
      const w = screenToWorld(sx, sy);
      dragNode.x = w.x; dragNode.y = w.y;
      draw();
    } else if (isPanning) {
      panX += e.clientX - lastMouse.x;
      panY += e.clientY - lastMouse.y;
      draw();
    } else {
      const prev = hoveredNode;
      hoveredNode = findNodeAt(sx, sy);
      if (hoveredNode !== prev) {
        canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
        draw();
      }
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mouseup', function() {
    if (dragNode) {
      // Clicking a node (not dragging far) selects it
      const node = dragNode;
      dragNode = null;
      showDetail(node);
    }
    isPanning = false;
    canvas.classList.remove('dragging');
    // Resume simulation briefly
    if (nodes.length > 0 && simIterations < 300) {
      simIterations = Math.max(simIterations, 250);
      simRunning = true;
      tickSim();
    }
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const oldZoom = zoom;
    zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.1, Math.min(5, zoom));
    // Zoom toward cursor
    panX = sx - (sx - panX) * (zoom / oldZoom);
    panY = sy - (sy - panY) * (zoom / oldZoom);
    draw();
  }, { passive: false });

  // --- Detail panel ---
  function showDetail(node) {
    selectedNode = node;
    const panel = document.getElementById('nodeDetail');
    const nameEl = document.getElementById('detailName');
    const typeEl = document.getElementById('detailType');
    const metaEl = document.getElementById('detailMeta');
    const relsEl = document.getElementById('detailRels');

    nameEl.textContent = node.name;
    typeEl.textContent = node.type;
    typeEl.style.background = getColor(node.type).replace(')', ',0.15)').replace('#', 'rgba(').replace('rgba(', function() {
      // Convert hex to rgba
      const c = getColor(node.type);
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      return 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
    }());
    // Fix: just use a simpler approach
    const c = getColor(node.type);
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    typeEl.style.background = 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
    typeEl.style.color = c;

    // Metadata
    let metaHtml = '<div class="node-detail-section-title">Metadata</div>';
    if (node.knowledge_id) metaHtml += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Knowledge ID: ' + node.knowledge_id + '</div>';
    if (node.created_at) metaHtml += '<div style="font-size:11px;color:var(--text-dim);">Created: ' + new Date(node.created_at).toLocaleString() + '</div>';
    if (node.metadata && Object.keys(node.metadata).length > 0) {
      metaHtml += '<pre style="font-size:10px;color:var(--text-dim);margin-top:6px;white-space:pre-wrap;word-break:break-all;">' + JSON.stringify(node.metadata, null, 2) + '</pre>';
    }
    metaEl.innerHTML = metaHtml;

    // Relationships
    const rels = edges.filter(e => e.source === node.id || e.target === node.id);
    let relsHtml = '<div class="node-detail-section-title">Relationships (' + rels.length + ')</div>';
    if (rels.length === 0) {
      relsHtml += '<div style="font-size:11px;color:var(--text-muted);">No relationships</div>';
    } else {
      for (const rel of rels) {
        const isSource = rel.source === node.id;
        const otherId = isSource ? rel.target : rel.source;
        const other = nodeMap[otherId];
        const otherName = other ? other.name : otherId.slice(0, 12) + '...';
        const arrow = isSource ? ' -> ' : ' <- ';
        relsHtml += '<div class="node-detail-rel">' +
          '<span class="rel-type-badge">' + (rel.type || 'related') + '</span>' +
          '<span style="color:var(--text-dim);">' + arrow + '</span>' +
          '<span style="cursor:pointer;color:var(--accent);" onclick="selectNodeById(\\'' + otherId + '\\')">' + otherName + '</span>' +
        '</div>';
      }
    }
    relsEl.innerHTML = relsHtml;
    panel.classList.add('open');
    draw();
  }

  window.closeDetail = function() {
    selectedNode = null;
    document.getElementById('nodeDetail').classList.remove('open');
    draw();
  };

  window.selectNodeById = function(id) {
    const n = nodeMap[id];
    if (n) showDetail(n);
  };

  window.resetZoom = function() {
    panX = 0; panY = 0; zoom = 1;
    draw();
  };

  // --- Load data ---
  let activeProjectDb = localStorage.getItem('cm-active-project') || null;

  window.loadGraph = async function() {
    const entity = document.getElementById('entityFilter').value;
    const depth = document.getElementById('depthSelect').value;
    const typeF = document.getElementById('typeFilter').value;

    let url = '/api/graph?depth=' + depth;
    if (entity) url += '&entity=' + encodeURIComponent(entity);
    if (activeProjectDb && activeProjectDb !== '__all__') url += '&db=' + encodeURIComponent(activeProjectDb);

    try {
      const data = await fetch(url).then(r => r.json());
      nodes = data.nodes || [];
      edges = data.edges || [];

      // Type filter (client-side)
      if (typeF) {
        const keep = new Set(nodes.filter(n => n.type === typeF).map(n => n.id));
        // Also keep connected nodes
        edges.forEach(e => { if (keep.has(e.source)) keep.add(e.target); if (keep.has(e.target)) keep.add(e.source); });
        nodes = nodes.filter(n => keep.has(n.id));
        edges = edges.filter(e => keep.has(e.source) && keep.has(e.target));
      }

      nodeMap = {};
      nodes.forEach(n => { nodeMap[n.id] = n; });

      document.getElementById('emptyState').style.display = nodes.length === 0 ? '' : 'none';
      document.getElementById('graphLegend').style.display = nodes.length === 0 ? 'none' : '';
      document.getElementById('graphStats').innerHTML = nodes.length > 0
        ? '<span>Nodes: ' + nodes.length + '</span><span>Edges: ' + edges.length + '</span><span>Types: ' + [...new Set(nodes.map(n=>n.type))].join(', ') + '</span>'
        : '';

      if (nodes.length > 0) {
        selectedNode = null;
        document.getElementById('nodeDetail').classList.remove('open');
        initSim();
      }
    } catch (err) {
      console.error('Graph load failed:', err);
    }
  };

  // --- Project switcher ---
  function escHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function updateProjectBar(instances) {
    var label = document.getElementById('projectLabel');
    if (!label) return;
    if (!instances || instances.length <= 1) {
      var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
      label.textContent = 'Project  ' + name;
    } else {
      label.textContent = 'Projects';
    }
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/instances');
      const instances = await res.json();
      const container = document.getElementById('projectPills');

      if (!instances.length) {
        activeProjectDb = null;
        container.innerHTML = '';
        updateProjectBar(instances);
        return;
      }

      if (activeProjectDb) {
        var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
        if (!validSelection) activeProjectDb = instances[0].dbPath;
      } else {
        activeProjectDb = instances[0].dbPath;
      }

      if (instances.length === 1) {
        container.innerHTML = '';
      } else {
        container.innerHTML = instances.map(function(i) {
          const isActive = i.dbPath === activeProjectDb;
          return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + escHtml(i.dbPath) + '" title="' + escHtml(i.projectDir) + '">' +
            '<span class="pill-dot"></span>' + escHtml(i.projectName) + '</div>';
        }).join('');
      }

      updateProjectBar(instances);

      container.querySelectorAll('.project-pill').forEach(function(pill) {
        pill.addEventListener('click', async function() {
          const db = pill.getAttribute('data-db');
          if (db === activeProjectDb) return;
          try { await fetch('/api/switch-project?db=' + encodeURIComponent(db)); } catch {}
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(function(p) { p.classList.remove('active'); });
          pill.classList.add('active');
          updateProjectBar(instances);
          loadGraph();
        });
      });
    } catch {}
  }

  // --- Theme ---
  const savedTheme = localStorage.getItem('cm-theme') || 'dark';
  document.body.classList.toggle('light', savedTheme === 'light');
  document.getElementById('themeToggle').textContent = savedTheme === 'light' ? 'D' : 'L';
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    document.body.classList.toggle('light', next === 'light');
    document.getElementById('themeToggle').textContent = next === 'light' ? 'D' : 'L';
    localStorage.setItem('cm-theme', next);
  });

  // --- Init ---
  resize();
  loadProjects();
  loadGraph();
})();
</script>
</body>
</html>`;
}

// --- Timeline Page HTML ---
function getTimelinePageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Timeline</title>
<style>
  :root {
    --bg: #08080d;
    --bg-card: #0f0f17;
    --bg-card-hover: #161622;
    --bg-elevated: #1a1a28;
    --border: #1e1e30;
    --border-subtle: #14141f;
    --text: #e8e8ef;
    --text-dim: #7a7a90;
    --text-muted: #4a4a60;
    --accent: #818cf8;
    --accent-dim: #6366f1;
    --green: #34d399;
    --green-dim: rgba(52, 211, 153, 0.12);
    --orange: #fbbf24;
    --orange-dim: rgba(251, 191, 36, 0.12);
    --red: #f87171;
    --red-dim: rgba(248, 113, 113, 0.12);
    --blue: #60a5fa;
    --blue-dim: rgba(96, 165, 250, 0.12);
    --purple: #c084fc;
    --purple-dim: rgba(192, 132, 252, 0.12);
    --cyan: #22d3ee;
    --cyan-dim: rgba(34, 211, 238, 0.12);
    --pink: #f472b6;
    --pink-dim: rgba(244, 114, 182, 0.12);
    --radius: 16px;
    --radius-sm: 10px;
    --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-ui);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    border-bottom: 1px solid var(--border);
    background: rgba(8,8,13,0.85);
    position: sticky; top: 0; z-index: 100;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo {
    width: 28px; height: 28px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: white; letter-spacing: -0.5px;
  }
  .header h1 { font-size: 14px; font-weight: 600; letter-spacing: -0.3px; font-family: var(--font-ui); }
  .header h1 span { color: var(--text-dim); font-weight: 400; }
  .nav-links {
    display: flex; align-items: center; gap: 2px; margin-left: 12px;
    background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 3px;
  }
  .nav-link {
    font-size: 12px; font-weight: 500; color: var(--text-dim); text-decoration: none;
    padding: 4px 12px; border-radius: 7px; transition: all 0.15s ease; font-family: var(--font-ui);
    white-space: nowrap;
  }
  .nav-link:hover { color: var(--text); background: var(--bg-card-hover); }
  .nav-link.active { color: var(--text); background: var(--bg-card); }

  .theme-toggle {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-dim); font-size: 13px; width: 30px; height: 30px;
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  body.light {
    --bg: #f8f8fb; --bg-card: #ffffff; --bg-card-hover: #f3f3f8;
    --bg-elevated: #eeeef4; --border: #e2e2ea; --text: #1a1a2e;
    --text-dim: #5a5a72; --text-muted: #9090a8;
  }
  body.light .header { background: rgba(248,248,251,0.85); }

  .header-right {
    display: flex; align-items: center; gap: 10px;
  }
  .status-badge {
    display: flex; align-items: center; gap: 6px; font-size: 11px;
    color: var(--green); background: var(--green-dim);
    padding: 4px 10px; border-radius: 20px; font-family: var(--font-ui);
  }
  .status-dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .toolbar {
    display: flex; align-items: center; gap: 10px; padding: 12px 24px;
    background: var(--bg-card); border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .toolbar input, .toolbar select {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 6px 12px; font-size: 12px; color: var(--text); font-family: var(--font-ui);
  }
  .toolbar input[type="text"] { width: 240px; }
  .toolbar input[type="date"] { width: 150px; }
  .toolbar button {
    background: var(--accent); border: none; border-radius: var(--radius-sm);
    padding: 6px 16px; color: #fff; font-size: 12px; cursor: pointer;
    font-family: var(--font-ui); transition: background 0.15s;
  }
  .toolbar button:hover { background: var(--accent-dim); }
  .toolbar button.secondary { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text); }
  .toolbar .spacer { flex: 1; }
  .toolbar .result-count { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }
  .toolbar .auto-refresh-indicator {
    font-size: 10px; color: var(--green); display: flex; align-items: center; gap: 4px; font-family: var(--font-mono);
  }

  .type-filter-row {
    display: flex; gap: 6px; padding: 10px 24px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border); background: var(--bg-card);
  }
  .type-pill {
    font-size: 11px; padding: 4px 12px; border-radius: var(--radius-sm);
    border: 1px solid var(--border); cursor: pointer; transition: all 0.15s;
    user-select: none; font-family: var(--font-ui);
  }
  .type-pill:hover { border-color: var(--accent); }
  .type-pill.active { background: rgba(129,140,248,0.12); border-color: var(--accent); color: var(--accent); }

  .main { max-width: 1200px; margin: 0 auto; padding: 24px; }

  .timeline-line {
    position: relative;
    padding-left: 28px;
  }
  .timeline-line::before {
    content: '';
    position: absolute; left: 8px; top: 0; bottom: 0;
    width: 2px; background: var(--border);
  }

  .tl-group-header {
    font-size: 12px; font-weight: 600; color: var(--text-dim);
    padding: 16px 0 8px; position: relative;
  }
  .tl-group-header::before {
    content: '';
    position: absolute; left: -24px; top: 20px; width: 10px; height: 10px;
    background: var(--accent); border-radius: 50%; border: 2px solid var(--bg);
  }

  .tl-entry {
    position: relative; background: var(--bg-card);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px 18px; margin-bottom: 8px;
    transition: all 0.15s ease; cursor: pointer;
  }
  .tl-entry:hover { background: var(--bg-card-hover); border-color: var(--accent); }
  .tl-entry::before {
    content: '';
    position: absolute; left: -24px; top: 18px; width: 8px; height: 8px;
    background: var(--border); border-radius: 50%;
  }

  .tl-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
  }
  .tl-badge {
    font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600;
  }
  .tl-badge.code_change { background: var(--blue-dim); color: var(--blue); }
  .tl-badge.error { background: var(--red-dim); color: var(--red); }
  .tl-badge.decision { background: var(--purple-dim); color: var(--purple); }
  .tl-badge.pattern { background: var(--cyan-dim); color: var(--cyan); }
  .tl-badge.dependency { background: var(--orange-dim); color: var(--orange); }
  .tl-badge.config { background: var(--green-dim); color: var(--green); }
  .tl-badge.debug { background: var(--red-dim); color: var(--orange); }
  .tl-badge.architecture { background: var(--purple-dim); color: var(--pink); }
  .tl-badge.default { background: var(--border); color: var(--text-dim); }

  .tl-time { font-size: 10px; color: var(--text-muted); margin-left: auto; white-space: nowrap; font-family: var(--font-mono); }
  .tl-summary { font-size: 12px; color: var(--text); line-height: 1.5; }
  .tl-meta { font-size: 10px; color: var(--text-muted); margin-top: 6px; display: flex; gap: 12px; flex-wrap: wrap; font-family: var(--font-mono); }

  .tl-detail {
    display: none; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--border); font-size: 11px;
  }
  .tl-detail.open { display: block; }
  .tl-detail-content {
    background: var(--bg); border-radius: var(--radius-sm); padding: 10px 14px;
    font-size: 11px; color: var(--text-dim); white-space: pre-wrap; word-break: break-all;
    max-height: 300px; overflow-y: auto; margin-top: 8px; font-family: var(--font-mono);
  }
  .tl-detail-chips {
    display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
  }
  .tl-detail-chip {
    font-size: 10px; padding: 2px 8px; border-radius: 8px;
    background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-dim);
    font-family: var(--font-ui);
  }

  .empty-state {
    text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 13px;
  }

  .load-more {
    text-align: center; padding: 16px;
  }
  .load-more button {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px 24px; color: var(--text-dim); font-size: 12px; cursor: pointer;
    font-family: var(--font-ui); transition: all 0.15s;
  }
  .load-more button:hover { border-color: var(--accent); color: var(--text); }

  /* --- Project Bar --- */
  .project-bar { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 8px 24px; }
  .project-bar-inner { display: flex; align-items: center; gap: 12px; max-width: 1400px; margin: 0 auto; }
  .project-bar-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); }
  .project-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; overflow-x: auto; }
  .project-pill { display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.15s ease; white-space: nowrap; user-select: none; font-family: var(--font-ui); }
  .project-pill:hover { border-color: var(--cyan); color: var(--text); background: var(--bg-card-hover); }
  .project-pill.active { background: var(--cyan-dim); border-color: var(--cyan); color: var(--cyan); font-weight: 600; }
  .project-pill .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .project-pill.skeleton { opacity: 0.4; cursor: default; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; font-family: var(--font-mono); }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>ContextMem</h1>
    <nav class="nav-links">
      <a href="/" class="nav-link">Home</a>
      <a href="/graph" class="nav-link">Graph</a>
      <a href="/timeline" class="nav-link active">Timeline</a>
      <a href="/diagnostics" class="nav-link">Diagnostics</a>
      <a href="/compression" class="nav-link">Compression</a>
    </nav>
  </div>
  <div class="header-right">
    <div class="status-badge" id="statusBadge">
      <div class="status-dot"></div>
      <span id="statusText">auto-refresh</span>
    </div>
    <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
  </div>
</div>

<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="toolbar">
  <input type="text" id="searchInput" placeholder="Search observations..." />
  <input type="date" id="dateFrom" title="From date" />
  <input type="date" id="dateTo" title="To date" />
  <select id="limitSelect">
    <option value="50">50 entries</option>
    <option value="100" selected>100 entries</option>
    <option value="250">250 entries</option>
    <option value="500">500 entries</option>
  </select>
  <button onclick="applyFilters()">Apply</button>
  <button class="secondary" onclick="clearFilters()">Clear</button>
  <button id="replay-btn" title="Replay timeline chronologically">&#9654; Replay</button>
  <div class="spacer"></div>
  <div class="result-count" id="resultCount"></div>
  <div class="auto-refresh-indicator">
    <div class="status-dot" style="width:4px;height:4px;"></div>
    <span id="refreshTimer">5s</span>
  </div>
</div>

<div class="type-filter-row" id="typeFilters"></div>

<div class="main">
  <div class="timeline-line" id="timeline">
    <div class="empty-state">Loading timeline...</div>
  </div>
  <div class="load-more" id="loadMore" style="display:none;">
    <button onclick="loadMoreEntries()">Load more</button>
  </div>
</div>

<script>
(function() {
  'use strict';

  let entries = [];
  let currentType = '';
  let currentLimit = 100;
  let lastRefresh = 0;
  let refreshInterval = null;
  let activeProjectDb = localStorage.getItem('cm-active-project') || null;

  const BADGE_CLASSES = {
    code_change: 'code_change', error: 'error', decision: 'decision',
    pattern: 'pattern', dependency: 'dependency', config: 'config',
    debug: 'debug', architecture: 'architecture'
  };

  function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDayGroup(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function badgeClass(type) { return BADGE_CLASSES[type] || 'default'; }

  // --- Fetch timeline data ---
  async function fetchTimeline() {
    const search = document.getElementById('searchInput').value.trim();
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const limit = document.getElementById('limitSelect').value;
    currentLimit = parseInt(limit, 10);

    let url;
    if (search) {
      url = '/api/search?q=' + encodeURIComponent(search) + '&limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    } else if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom).getTime() : 0;
      const to = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Date.now();
      url = '/api/timeline-range?from=' + from + '&to=' + to + '&limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    } else {
      url = '/api/timeline?limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    }

    if (activeProjectDb && activeProjectDb !== '__all__') url += '&db=' + encodeURIComponent(activeProjectDb);

    try {
      const res = await fetch(url);
      entries = await res.json();
      renderTimeline();
      lastRefresh = Date.now();
      document.getElementById('statusText').textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (err) {
      document.getElementById('statusText').textContent = 'error';
      console.error(err);
    }
  }

  // --- Render timeline ---
  function renderTimeline() {
    const container = document.getElementById('timeline');
    const countEl = document.getElementById('resultCount');
    countEl.textContent = entries.length + ' observation' + (entries.length !== 1 ? 's' : '');

    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state">No observations found</div>';
      document.getElementById('loadMore').style.display = 'none';
      return;
    }

    // Group by day
    let html = '';
    let lastDay = '';
    for (const entry of entries) {
      const day = formatDayGroup(entry.indexed_at);
      if (day !== lastDay) {
        html += '<div class="tl-group-header">' + esc(day) + '</div>';
        lastDay = day;
      }

      const display = entry.summary || entry.content_preview || '(no content)';
      let meta = {};
      try { meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : (entry.metadata || {}); } catch {}

      html += '<div class="tl-entry" data-id="' + entry.id + '" data-ts="' + (entry.indexed_at || 0) + '">' +
        '<div class="tl-header">' +
          '<span class="tl-badge ' + badgeClass(entry.type) + '">' + esc(entry.type) + '</span>' +
          (entry.privacy_level && entry.privacy_level !== 'public'
            ? '<span class="tl-badge default">' + esc(entry.privacy_level) + '</span>' : '') +
          '<span class="tl-time">' + formatDate(entry.indexed_at) + ' (' + timeAgo(entry.indexed_at) + ')</span>' +
        '</div>' +
        '<div class="tl-summary">' + esc(display) + '</div>' +
        '<div class="tl-meta">' +
          '<span>id: ' + entry.id.slice(0, 12) + '...</span>' +
          '<span>session: ' + (entry.session_id || '').slice(0, 10) + '...</span>' +
          (meta.file_path ? '<span>file: ' + esc(meta.file_path) + '</span>' : '') +
        '</div>' +
        '<div class="tl-detail" id="detail-' + entry.id + '"></div>' +
      '</div>';
    }

    container.innerHTML = html;
    document.getElementById('loadMore').style.display = entries.length >= currentLimit ? '' : 'none';

    // Click handlers
    container.querySelectorAll('.tl-entry').forEach(el => {
      el.addEventListener('click', function() { toggleDetail(this.dataset.id); });
    });
  }

  // --- Detail toggle ---
  async function toggleDetail(id) {
    const detailEl = document.getElementById('detail-' + id);
    if (!detailEl) return;

    if (detailEl.classList.contains('open')) {
      detailEl.classList.remove('open');
      return;
    }

    // Close others
    document.querySelectorAll('.tl-detail.open').forEach(el => el.classList.remove('open'));

    if (detailEl.dataset.loaded) {
      detailEl.classList.add('open');
      return;
    }

    detailEl.innerHTML = '<div style="color:var(--text-muted);padding:4px;">Loading...</div>';
    detailEl.classList.add('open');

    try {
      const res = await fetch('/api/observation?id=' + encodeURIComponent(id));
      const obs = await res.json();
      if (obs.error) { detailEl.innerHTML = '<div style="color:var(--red);">' + esc(obs.error) + '</div>'; return; }

      const meta = obs.metadata || {};
      let html = '<div class="tl-detail-chips">';
      if (meta.source) html += '<div class="tl-detail-chip">source: ' + esc(meta.source) + '</div>';
      if (meta.language) html += '<div class="tl-detail-chip">lang: ' + esc(meta.language) + '</div>';
      if (meta.tokens_original) html += '<div class="tl-detail-chip">tokens: ' + meta.tokens_original + '</div>';
      if (meta.tokens_original && meta.tokens_summarized) {
        const saved = Math.round((1 - meta.tokens_summarized / meta.tokens_original) * 100);
        html += '<div class="tl-detail-chip" style="color:var(--green);">saved: ' + saved + '%</div>';
      }
      html += '<div class="tl-detail-chip">chars: ' + (obs.content_length || 0) + '</div>';
      html += '</div>';

      if (obs.summary && obs.summary !== obs.content) {
        html += '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px;">Summary</div>';
        html += '<div style="font-size:11px;color:var(--text);margin-bottom:10px;">' + esc(obs.summary) + '</div>';
      }

      html += '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px;">Content</div>';
      const content = obs.content || '';
      const truncated = content.length > 2000;
      html += '<div class="tl-detail-content">' + esc(truncated ? content.slice(0, 2000) + '\\n...(' + (content.length - 2000) + ' more chars)' : content) + '</div>';

      detailEl.innerHTML = html;
      detailEl.dataset.loaded = '1';
    } catch (err) {
      detailEl.innerHTML = '<div style="color:var(--red);">Failed: ' + esc(err.message) + '</div>';
    }
  }

  // --- Type filter pills ---
  async function loadTypeFilters() {
    try {
      var statsUrl = '/api/stats';
      if (activeProjectDb && activeProjectDb !== '__all__') statsUrl += '?db=' + encodeURIComponent(activeProjectDb);
      const stats = await fetch(statsUrl).then(r => r.json());
      const types = stats.by_type || [];
      const container = document.getElementById('typeFilters');
      let html = '<div class="type-pill' + (!currentType ? ' active' : '') + '" data-type="">All (' + (stats.observations || 0) + ')</div>';
      for (const t of types) {
        html += '<div class="type-pill' + (currentType === t.type ? ' active' : '') + '" data-type="' + esc(t.type) + '">' + esc(t.type) + ' (' + t.count + ')</div>';
      }
      container.innerHTML = html;

      container.querySelectorAll('.type-pill').forEach(pill => {
        pill.addEventListener('click', function() {
          currentType = this.dataset.type;
          container.querySelectorAll('.type-pill').forEach(p => p.classList.remove('active'));
          this.classList.add('active');
          fetchTimeline();
        });
      });
    } catch {}
  }

  // --- Actions ---
  window.applyFilters = function() { fetchTimeline(); };
  window.clearFilters = function() {
    document.getElementById('searchInput').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    currentType = '';
    loadTypeFilters();
    fetchTimeline();
  };
  window.loadMoreEntries = function() {
    const sel = document.getElementById('limitSelect');
    const curr = parseInt(sel.value, 10);
    const next = Math.min(curr + 100, 500);
    sel.value = String(next);
    fetchTimeline();
  };

  // --- Search on Enter ---
  document.getElementById('searchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); fetchTimeline(); }
    if (e.key === 'Escape') { this.value = ''; fetchTimeline(); this.blur(); }
  });

  // --- Auto-refresh via SSE ---
  function connectSSE() {
    try {
      const es = new EventSource('/sse');
      es.addEventListener('stats:update', function() {
        // Refresh timeline data silently
        fetchTimeline();
      });
      es.onerror = function() {
        es.close();
        // Fallback to polling
        if (!refreshInterval) {
          refreshInterval = setInterval(fetchTimeline, 5000);
        }
      };
    } catch {
      // SSE not available, use polling
      refreshInterval = setInterval(fetchTimeline, 5000);
    }
  }

  // --- Theme ---
  const savedTheme = localStorage.getItem('cm-theme') || 'dark';
  document.body.classList.toggle('light', savedTheme === 'light');
  document.getElementById('themeToggle').textContent = savedTheme === 'light' ? 'D' : 'L';
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    document.body.classList.toggle('light', next === 'light');
    document.getElementById('themeToggle').textContent = next === 'light' ? 'D' : 'L';
    localStorage.setItem('cm-theme', next);
  });

  // --- Project switcher ---
  function updateProjectBar(instances) {
    var label = document.getElementById('projectLabel');
    if (!label) return;
    if (!instances || instances.length <= 1) {
      var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
      label.textContent = 'Project  ' + name;
    } else {
      label.textContent = 'Projects';
    }
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/instances');
      const instances = await res.json();
      const container = document.getElementById('projectPills');

      if (!instances.length) {
        activeProjectDb = null;
        container.innerHTML = '';
        updateProjectBar(instances);
        return;
      }

      if (activeProjectDb) {
        var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
        if (!validSelection) activeProjectDb = instances[0].dbPath;
      } else {
        activeProjectDb = instances[0].dbPath;
      }

      if (instances.length === 1) {
        container.innerHTML = '';
      } else {
        container.innerHTML = instances.map(function(i) {
          const isActive = i.dbPath === activeProjectDb;
          return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + esc(i.dbPath) + '" title="' + esc(i.projectDir) + '">' +
            '<span class="pill-dot"></span>' + esc(i.projectName) + '</div>';
        }).join('');
      }

      updateProjectBar(instances);

      container.querySelectorAll('.project-pill').forEach(function(pill) {
        pill.addEventListener('click', async function() {
          const db = pill.getAttribute('data-db');
          if (db === activeProjectDb) return;
          try { await fetch('/api/switch-project?db=' + encodeURIComponent(db)); } catch {}
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(function(p) { p.classList.remove('active'); });
          pill.classList.add('active');
          updateProjectBar(instances);
          fetchTimeline();
          loadTypeFilters();
        });
      });
    } catch {}
  }

  // --- Init ---
  loadProjects();
  loadTypeFilters();
  fetchTimeline();
  connectSSE();

  // Countdown display
  setInterval(function() {
    const s = Math.max(0, 5 - Math.floor((Date.now() - lastRefresh) / 1000));
    document.getElementById('refreshTimer').textContent = s + 's';
  }, 1000);

  // --- Replay ---
  let replayInterval = null;
  document.getElementById('replay-btn')?.addEventListener('click', function() {
    const btn = this;
    if (replayInterval) {
      clearInterval(replayInterval);
      replayInterval = null;
      btn.textContent = '\\u25B6 Replay';
      // Reset highlights
      document.querySelectorAll('.tl-entry').forEach(r => { r.style.background = ''; });
      return;
    }

    const rows = [...document.querySelectorAll('.tl-entry')].filter(r => r.style.display !== 'none');
    if (!rows.length) return;

    btn.textContent = '\\u23F9 Stop';
    let i = 0;
    replayInterval = setInterval(function() {
      if (i >= rows.length) {
        clearInterval(replayInterval);
        replayInterval = null;
        btn.textContent = '\\u25B6 Replay';
        if (i > 0) rows[i - 1].style.background = '';
        return;
      }
      if (i > 0) rows[i - 1].style.background = '';
      rows[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
      rows[i].style.background = 'var(--accent-dim, rgba(99,102,241,0.15))';
      i++;
    }, 800);
  });
})();
</script>
</body>
</html>`;
}

function getTopicsPageHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Topics</title>
<style>
  :root { --bg:#08080d;--bg-card:#0f0f17;--bg-card-hover:#161622;--bg-elevated:#1a1a28;--border:#1e1e30;--text:#e8e8ef;--text-dim:#7a7a90;--text-muted:#4a4a60;--accent:#818cf8;--green:#34d399;--orange:#fbbf24;--red:#f87171;--blue:#60a5fa;--purple:#c084fc;--cyan:#22d3ee;--pink:#f472b6;--radius:16px;--radius-sm:10px;--font-ui:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--font-mono:'SF Mono','Cascadia Code',monospace; }
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh; }
  .header { display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:56px;border-bottom:1px solid var(--border);background:rgba(8,8,13,0.85);position:sticky;top:0;z-index:100;backdrop-filter:blur(20px); }
  .header-left { display:flex;align-items:center;gap:10px; }
  .logo { width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white; }
  .nav-links { display:flex;gap:2px;margin-left:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px; }
  .nav-link { font-size:12px;font-weight:500;color:var(--text-dim);text-decoration:none;padding:4px 12px;border-radius:7px; }
  .nav-link:hover { color:var(--text);background:var(--bg-card-hover); }
  .nav-link.active { color:var(--text);background:var(--bg-card); }
  .main { max-width:1200px;margin:0 auto;padding:24px; }
  .section-title { display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;margin-bottom:16px; }
  .topic-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px; }
  .topic-card { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;cursor:pointer;transition:all 0.15s; }
  .topic-card:hover { background:var(--bg-card-hover);border-color:var(--accent); }
  .topic-name { font-size:14px;font-weight:600;margin-bottom:4px; }
  .topic-count { font-size:24px;font-weight:700;color:var(--accent); }
  .topic-sub { font-size:11px;color:var(--text-muted); }
  .obs-list { display:flex;flex-direction:column;gap:8px; }
  .obs-item { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px; }
  .obs-title { font-size:12px;color:var(--text);margin-bottom:4px; }
  .obs-meta { font-size:10px;color:var(--text-muted); }
  .importance-dot { display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px; }
</style></head><body>
<div class="header"><div class="header-left">
  <div class="logo">cm</div><span style="font-size:14px;font-weight:600;">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
  <nav class="nav-links">
    <a href="/" class="nav-link">Home</a><a href="/topics" class="nav-link active">Topics</a><a href="/graph" class="nav-link">Graph</a><a href="/timeline" class="nav-link">Timeline</a><a href="/trail" class="nav-link">Trail</a><a href="/narrative" class="nav-link">Narrative</a><a href="/diagnostics" class="nav-link">Diagnostics</a><a href="/compression" class="nav-link">Compression</a>
  </nav>
</div></div>
<div class="main">
  <div class="section-title">Topic Explorer</div>
  <div class="topic-grid" id="topicGrid">Loading topics...</div>
  <div id="topicDetail" style="display:none;">
    <div class="section-title" id="topicDetailTitle" style="margin-top:24px;"></div>
    <div class="obs-list" id="topicObsList"></div>
  </div>
  <div style="margin-top:32px;">
    <div class="section-title">Cross-Project Tunnels</div>
    <div id="tunnelsList" style="color:var(--text-dim);font-size:12px;">Loading...</div>
  </div>
</div>
<script>
async function load() {
  const topics = await fetch('/api/topics').then(r=>r.json()).catch(()=>[]);
  const grid = document.getElementById('topicGrid');
  if (!topics.length) { grid.innerHTML = '<div style="color:var(--text-muted);">No topics detected yet.</div>'; return; }
  grid.innerHTML = topics.map(t => '<div class="topic-card" onclick="showTopic(\\'' + t.name + '\\')">' +
    '<div class="topic-name">' + t.name + '</div>' +
    '<div class="topic-count">' + t.observation_count + '</div>' +
    '<div class="topic-sub">observations</div></div>').join('');
  // Tunnels
  const tunnels = await fetch('/api/tunnels').then(r=>r.json()).catch(()=>[]);
  const tEl = document.getElementById('tunnelsList');
  if (!tunnels.length) { tEl.textContent = 'No cross-project topic bridges found.'; }
  else { tEl.innerHTML = tunnels.map(t => '<div style="padding:6px 0;border-bottom:1px solid var(--border);"><strong>' + t.topic + '</strong> — ' + t.projects.join(', ') + '</div>').join(''); }
}
async function showTopic(name) {
  document.getElementById('topicDetail').style.display = 'block';
  document.getElementById('topicDetailTitle').textContent = 'Topic: ' + name;
  const obs = await fetch('/api/topic-observations?topic=' + encodeURIComponent(name)).then(r=>r.json()).catch(()=>[]);
  const list = document.getElementById('topicObsList');
  list.innerHTML = obs.map(o => {
    const imp = o.importance_score || 0.5;
    const dotColor = imp >= 0.8 ? 'var(--green)' : imp >= 0.5 ? 'var(--orange)' : 'var(--red)';
    return '<div class="obs-item"><div class="obs-title"><span class="importance-dot" style="background:' + dotColor + ';"></span>' +
      (o.summary || o.content_preview || '').slice(0, 200) + '</div>' +
      '<div class="obs-meta">' + o.type + ' · importance: ' + imp.toFixed(2) + ' · ' + (o.compression_tier || 'verbatim') + ' · ' + new Date(o.indexed_at).toLocaleString() + '</div></div>';
  }).join('') || '<div style="color:var(--text-muted);">No observations for this topic.</div>';
  document.getElementById('topicDetail').scrollIntoView({behavior:'smooth'});
}
load();
</script></body></html>`;
}

function getTrailPageHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Decision Trail</title>
<style>
  :root { --bg:#08080d;--bg-card:#0f0f17;--bg-card-hover:#161622;--bg-elevated:#1a1a28;--border:#1e1e30;--text:#e8e8ef;--text-dim:#7a7a90;--text-muted:#4a4a60;--accent:#818cf8;--green:#34d399;--orange:#fbbf24;--red:#f87171;--blue:#60a5fa;--purple:#c084fc;--cyan:#22d3ee;--pink:#f472b6;--radius:16px;--radius-sm:10px;--font-ui:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--font-mono:'SF Mono','Cascadia Code',monospace; }
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh; }
  .header { display:flex;align-items:center;padding:0 24px;height:56px;border-bottom:1px solid var(--border);background:rgba(8,8,13,0.85);position:sticky;top:0;z-index:100;backdrop-filter:blur(20px); }
  .header-left { display:flex;align-items:center;gap:10px; }
  .logo { width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white; }
  .nav-links { display:flex;gap:2px;margin-left:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px; }
  .nav-link { font-size:12px;font-weight:500;color:var(--text-dim);text-decoration:none;padding:4px 12px;border-radius:7px; }
  .nav-link:hover { color:var(--text);background:var(--bg-card-hover); }
  .nav-link.active { color:var(--text);background:var(--bg-card); }
  .main { max-width:900px;margin:0 auto;padding:24px; }
  .search-box { display:flex;gap:8px;margin-bottom:24px; }
  .search-box input { flex:1;padding:10px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:14px;outline:none; }
  .search-box input:focus { border-color:var(--accent); }
  .search-box button { padding:10px 20px;background:var(--accent);color:white;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-size:13px; }
  .trail-timeline { position:relative;padding-left:32px; }
  .trail-line { position:absolute;left:12px;top:0;bottom:0;width:2px;background:var(--border); }
  .trail-item { position:relative;margin-bottom:16px;animation:fadeIn 0.3s ease; }
  .trail-dot { position:absolute;left:-26px;top:6px;width:12px;height:12px;border-radius:50%;border:2px solid var(--border);background:var(--bg-card); }
  .trail-dot.decision { background:var(--purple);border-color:var(--purple); }
  .trail-dot.error { background:var(--red);border-color:var(--red); }
  .trail-dot.file_read { background:var(--blue);border-color:var(--blue); }
  .trail-dot.fix { background:var(--green);border-color:var(--green); }
  .trail-dot.search { background:var(--orange);border-color:var(--orange); }
  .trail-content { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px; }
  .trail-type { font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;margin-bottom:4px; }
  .trail-text { font-size:12px;color:var(--text-dim);line-height:1.5; }
  .trail-time { font-size:10px;color:var(--text-muted);margin-top:4px; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
</style></head><body>
<div class="header"><div class="header-left">
  <div class="logo">cm</div><span style="font-size:14px;font-weight:600;">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
  <nav class="nav-links">
    <a href="/" class="nav-link">Home</a><a href="/topics" class="nav-link">Topics</a><a href="/graph" class="nav-link">Graph</a><a href="/timeline" class="nav-link">Timeline</a><a href="/trail" class="nav-link active">Trail</a><a href="/narrative" class="nav-link">Narrative</a><a href="/diagnostics" class="nav-link">Diagnostics</a><a href="/compression" class="nav-link">Compression</a>
  </nav>
</div></div>
<div class="main">
  <h2 style="font-size:18px;margin-bottom:8px;">Decision Trail</h2>
  <p style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">Reconstruct the evidence chain behind any code change or decision.</p>
  <div class="search-box">
    <input type="text" id="trailQuery" placeholder="Enter file path or topic (e.g. PostgreSQL, src/auth/login.ts)..." autofocus>
    <button onclick="searchTrail()">Explain</button>
  </div>
  <div id="trailResult"></div>
</div>
<script>
document.getElementById('trailQuery').addEventListener('keydown', e => { if (e.key === 'Enter') searchTrail(); });
async function searchTrail() {
  const q = document.getElementById('trailQuery').value.trim();
  if (!q) return;
  const el = document.getElementById('trailResult');
  el.innerHTML = '<div style="color:var(--text-muted);">Searching...</div>';
  const data = await fetch('/api/decision-trail?q=' + encodeURIComponent(q)).then(r => r.json()).catch(() => null);
  if (!data) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">No decision trail found for "' + q + '"</div>'; return; }
  const typeColors = { decision:'var(--purple)', error:'var(--red)', file_read:'var(--blue)', fix:'var(--green)', search:'var(--orange)', file_modify:'var(--green)' };
  let html = '<div style="margin-bottom:16px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);">' +
    '<div style="font-size:16px;font-weight:600;color:var(--purple);margin-bottom:4px;">' + data.decision + '</div>' +
    '<div style="font-size:11px;color:var(--text-muted);">' + new Date(data.date).toLocaleString() + '</div></div>';
  if (data.evidence && data.evidence.length) {
    html += '<div class="trail-timeline"><div class="trail-line"></div>';
    for (const e of data.evidence) {
      const dotClass = e.type || 'search';
      const color = typeColors[e.type] || 'var(--text-dim)';
      html += '<div class="trail-item"><div class="trail-dot ' + dotClass + '"></div><div class="trail-content">' +
        '<div class="trail-type" style="color:' + color + ';">' + (e.type || 'event') + '</div>' +
        '<div class="trail-text">' + (e.content || '').replace(/</g,'&lt;') + '</div>' +
        '<div class="trail-time">' + new Date(e.timestamp).toLocaleTimeString() + '</div></div></div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
}
</script></body></html>`;
}

function getNarrativePageHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Narrative</title>
<style>
  :root { --bg:#08080d;--bg-card:#0f0f17;--bg-card-hover:#161622;--bg-elevated:#1a1a28;--border:#1e1e30;--text:#e8e8ef;--text-dim:#7a7a90;--text-muted:#4a4a60;--accent:#818cf8;--green:#34d399;--orange:#fbbf24;--red:#f87171;--blue:#60a5fa;--purple:#c084fc;--cyan:#22d3ee;--radius:16px;--radius-sm:10px;--font-ui:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--font-mono:'SF Mono','Cascadia Code',monospace; }
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh; }
  .header { display:flex;align-items:center;padding:0 24px;height:56px;border-bottom:1px solid var(--border);background:rgba(8,8,13,0.85);position:sticky;top:0;z-index:100;backdrop-filter:blur(20px); }
  .header-left { display:flex;align-items:center;gap:10px; }
  .logo { width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white; }
  .nav-links { display:flex;gap:2px;margin-left:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px; }
  .nav-link { font-size:12px;font-weight:500;color:var(--text-dim);text-decoration:none;padding:4px 12px;border-radius:7px; }
  .nav-link:hover { color:var(--text);background:var(--bg-card-hover); }
  .nav-link.active { color:var(--text);background:var(--bg-card); }
  .main { max-width:900px;margin:0 auto;padding:24px; }
  .format-tabs { display:flex;gap:4px;margin-bottom:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px;width:fit-content; }
  .format-tab { padding:6px 16px;font-size:12px;font-weight:500;color:var(--text-dim);cursor:pointer;border-radius:7px;border:none;background:none; }
  .format-tab.active { background:var(--bg-card);color:var(--text); }
  .format-tab:hover { color:var(--text); }
  .filters { display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap; }
  .filters input, .filters select { padding:6px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;outline:none; }
  .preview { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;min-height:200px;white-space:pre-wrap;font-family:var(--font-mono);font-size:13px;line-height:1.7;color:var(--text-dim); }
  .preview h1,.preview h2,.preview h3 { color:var(--text);font-family:var(--font-ui); }
  .preview strong { color:var(--text); }
  .actions { display:flex;gap:8px;margin-top:12px; }
  .actions button { padding:8px 16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text);font-size:12px;cursor:pointer; }
  .actions button:hover { background:var(--bg-card-hover); }
  .actions button.primary { background:var(--accent);border-color:var(--accent);color:white; }
</style></head><body>
<div class="header"><div class="header-left">
  <div class="logo">cm</div><span style="font-size:14px;font-weight:600;">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
  <nav class="nav-links">
    <a href="/" class="nav-link">Home</a><a href="/topics" class="nav-link">Topics</a><a href="/graph" class="nav-link">Graph</a><a href="/timeline" class="nav-link">Timeline</a><a href="/trail" class="nav-link">Trail</a><a href="/narrative" class="nav-link active">Narrative</a><a href="/diagnostics" class="nav-link">Diagnostics</a><a href="/compression" class="nav-link">Compression</a>
  </nav>
</div></div>
<div class="main">
  <h2 style="font-size:18px;margin-bottom:8px;">Session Narrative</h2>
  <p style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">Generate PR descriptions, standup updates, ADRs, or onboarding guides from your session data.</p>
  <div class="format-tabs" id="formatTabs">
    <button class="format-tab active" data-format="pr" onclick="setFormat('pr',this)">PR Description</button>
    <button class="format-tab" data-format="standup" onclick="setFormat('standup',this)">Standup</button>
    <button class="format-tab" data-format="adr" onclick="setFormat('adr',this)">ADR</button>
    <button class="format-tab" data-format="onboarding" onclick="setFormat('onboarding',this)">Onboarding</button>
  </div>
  <div class="filters">
    <input type="text" id="narrativeTopic" placeholder="Filter by topic...">
  </div>
  <div class="preview" id="narrativePreview">Generating...</div>
  <div class="actions">
    <button class="primary" onclick="copyNarrative()">Copy to Clipboard</button>
    <button onclick="generateNarrative()">Regenerate</button>
  </div>
</div>
<script>
let currentFormat = 'pr';
function setFormat(fmt, el) {
  currentFormat = fmt;
  document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  generateNarrative();
}
async function generateNarrative() {
  const topic = document.getElementById('narrativeTopic').value.trim();
  const params = new URLSearchParams({ format: currentFormat });
  if (topic) params.set('topic', topic);
  const el = document.getElementById('narrativePreview');
  el.textContent = 'Generating...';
  const data = await fetch('/api/narrative?' + params).then(r => r.json()).catch(() => ({ narrative: 'Error generating narrative' }));
  // Simple markdown rendering
  let html = (data.narrative || '').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/^- \\[ \\] (.+)$/gm, '- [ ] $1').replace(/^- (.+)$/gm, '&bull; $1');
  el.innerHTML = html || '<span style="color:var(--text-muted);">No data available for this format.</span>';
}
function copyNarrative() {
  const text = document.getElementById('narrativePreview').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.actions .primary');
    btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy to Clipboard', 2000);
  });
}
document.getElementById('narrativeTopic').addEventListener('input', () => { clearTimeout(window._nt); window._nt = setTimeout(generateNarrative, 500); });
generateNarrative();
</script></body></html>`;
}

function getDiagnosticsPageHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Diagnostics</title>
<style>
  :root { --bg:#08080d;--bg-card:#0f0f17;--bg-card-hover:#161622;--bg-elevated:#1a1a28;--border:#1e1e30;--text:#e8e8ef;--text-dim:#7a7a90;--text-muted:#4a4a60;--accent:#818cf8;--green:#34d399;--orange:#fbbf24;--red:#f87171;--blue:#60a5fa;--purple:#c084fc;--cyan:#22d3ee;--radius:16px;--radius-sm:10px;--font-ui:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--font-mono:'SF Mono','Cascadia Code',monospace; }
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh; }
  .header { display:flex;align-items:center;padding:0 24px;height:56px;border-bottom:1px solid var(--border);background:rgba(8,8,13,0.85);position:sticky;top:0;z-index:100;backdrop-filter:blur(20px); }
  .header-left { display:flex;align-items:center;gap:10px; }
  .logo { width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white; }
  .nav-links { display:flex;gap:2px;margin-left:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px; }
  .nav-link { font-size:12px;font-weight:500;color:var(--text-dim);text-decoration:none;padding:4px 12px;border-radius:7px; }
  .nav-link:hover { color:var(--text);background:var(--bg-card-hover); }
  .nav-link.active { color:var(--text);background:var(--bg-card); }
  .main { max-width:900px;margin:0 auto;padding:24px; }
  .card { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px; }
  .filters { display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end; }
  .filters label { font-size:12px;color:var(--text-dim);display:flex;flex-direction:column;gap:4px; }
  .filters select { padding:6px 12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;outline:none; }
  .filters button { padding:6px 16px;background:var(--accent);color:white;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-size:12px; }
  .filters button:hover { opacity:0.85; }
  .data-table { width:100%;border-collapse:collapse;font-size:12px; }
  .data-table th { text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:0.5px; }
  .data-table td { padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text-dim);vertical-align:top; }
  .data-table tr:last-child td { border-bottom:none; }
  .data-table tr:hover td { background:var(--bg-card-hover); }
  .sev-error { color:var(--red); }
  .sev-critical { color:var(--red);font-weight:700; }
  .sev-warn { color:var(--orange); }
  .sev-info { color:var(--blue); }
</style></head><body>
<div class="header"><div class="header-left">
  <div class="logo">cm</div><span style="font-size:14px;font-weight:600;">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
  <nav class="nav-links">
    <a href="/" class="nav-link">Home</a><a href="/topics" class="nav-link">Topics</a><a href="/graph" class="nav-link">Graph</a><a href="/timeline" class="nav-link">Timeline</a><a href="/trail" class="nav-link">Trail</a><a href="/narrative" class="nav-link">Narrative</a><a href="/diagnostics" class="nav-link active">Diagnostics</a>
  </nav>
</div></div>
<div class="main">
  <h2 style="font-size:18px;margin-bottom:8px;">Diagnostics</h2>
  <p style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">Internal error log — what context-mem subsystems have been failing at.</p>
  <div class="card">
    <div class="filters">
      <label>Since
        <select id="diag-since">
          <option value="3600000">Last hour</option>
          <option value="86400000" selected>Last 24 hours</option>
          <option value="604800000">Last 7 days</option>
        </select>
      </label>
      <label>Severity
        <select id="diag-severity">
          <option value="">Any</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error" selected>error</option>
          <option value="critical">critical</option>
        </select>
      </label>
      <button id="diag-refresh">Refresh</button>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>Category</th><th>Message</th><th>Severity</th><th>Count</th><th>Last seen</th></tr>
      </thead>
      <tbody id="diag-rows"></tbody>
    </table>
    <p id="diag-empty" style="display:none;opacity:0.6;margin-top:12px;font-size:12px;">No errors in selected window.</p>
  </div>
</div>
<script>
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadDiagnostics() {
  const since = Date.now() - parseInt(document.getElementById('diag-since').value, 10);
  const severity = document.getElementById('diag-severity').value;
  const params = new URLSearchParams({ mode: 'summary', since: String(since) });
  if (severity) params.set('severity', severity);
  const res = await fetch('/api/diagnostics?' + params.toString());
  const data = await res.json();
  const tbody = document.getElementById('diag-rows');
  const empty = document.getElementById('diag-empty');
  tbody.innerHTML = '';
  if (!data.rows || !data.rows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  for (const r of data.rows) {
    const sevClass = 'sev-' + escapeHtml(r.severity);
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(r.category) + '</td>' +
      '<td style="max-width:400px;word-break:break-word;">' + escapeHtml(r.message) + '</td>' +
      '<td class="' + sevClass + '">' + escapeHtml(r.severity) + '</td>' +
      '<td>' + r.count + '</td>' +
      '<td style="white-space:nowrap;">' + new Date(r.last_seen).toLocaleString() + '</td>';
    tbody.appendChild(tr);
  }
}
document.getElementById('diag-refresh').addEventListener('click', loadDiagnostics);
loadDiagnostics();
</script></body></html>`;
}


function getCompressionAnalyticsHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Compression Analytics</title>
<style>
  :root { --bg:#08080d;--bg-card:#0f0f17;--bg-card-hover:#161622;--bg-elevated:#1a1a28;--border:#1e1e30;--text:#e8e8ef;--text-dim:#7a7a90;--text-muted:#4a4a60;--accent:#818cf8;--green:#34d399;--green-dim:rgba(52,211,153,0.12);--orange:#fbbf24;--red:#f87171;--blue:#60a5fa;--purple:#c084fc;--cyan:#22d3ee;--radius:16px;--radius-sm:10px;--font-ui:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--font-mono:'SF Mono','Cascadia Code',monospace; }
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh; }
  .header { display:flex;align-items:center;padding:0 24px;height:56px;border-bottom:1px solid var(--border);background:rgba(8,8,13,0.85);position:sticky;top:0;z-index:100;backdrop-filter:blur(20px); }
  .header-left { display:flex;align-items:center;gap:10px; }
  .logo { width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white; }
  .nav-links { display:flex;gap:2px;margin-left:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:3px; }
  .nav-link { font-size:12px;font-weight:500;color:var(--text-dim);text-decoration:none;padding:4px 12px;border-radius:7px;transition:all 0.15s; }
  .nav-link:hover { color:var(--text);background:var(--bg-card-hover); }
  .nav-link.active { color:var(--text);background:var(--bg-card); }
  .main { max-width:960px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px; }
  .page-title { font-size:18px;font-weight:700;margin-bottom:2px; }
  .page-sub { font-size:12px;color:var(--text-dim);margin-bottom:4px; }
  .cards-row { display:grid;grid-template-columns:repeat(3,1fr);gap:12px; }
  .card { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:20px; }
  .stat-label { font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px; }
  .stat-val { font-size:26px;font-weight:700;color:var(--text); }
  .stat-sub { font-size:11px;color:var(--text-dim);margin-top:4px; }
  .section-title { font-size:13px;font-weight:600;margin-bottom:14px;color:var(--text); }
  /* Bar chart */
  .bar-chart { display:flex;flex-direction:column;gap:8px; }
  .bar-row { display:grid;grid-template-columns:90px 1fr 60px;align-items:center;gap:10px; }
  .bar-label { font-size:11px;color:var(--text-dim);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .bar-track { background:var(--bg-elevated);border-radius:4px;height:12px;overflow:hidden; }
  .bar-fill { height:100%;border-radius:4px;background:linear-gradient(90deg,var(--accent),var(--cyan));transition:width 0.4s ease; }
  .bar-pct { font-size:11px;color:var(--text-dim);text-align:right;font-variant-numeric:tabular-nums; }
  /* Histogram */
  .histo { display:flex;align-items:flex-end;gap:6px;height:100px; }
  .histo-col { display:flex;flex-direction:column;align-items:center;gap:4px;flex:1; }
  .histo-bar { width:100%;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;transition:height 0.4s ease; }
  .histo-label { font-size:9px;color:var(--text-muted);text-align:center;white-space:nowrap; }
  .histo-count { font-size:9px;color:var(--text-dim); }
  .data-table { width:100%;border-collapse:collapse;font-size:12px; }
  .data-table th { text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:0.5px; }
  .data-table td { padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text-dim);vertical-align:middle; }
  .data-table tr:last-child td { border-bottom:none; }
  .data-table tr:hover td { background:var(--bg-card-hover); }
  .badge { display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:var(--green-dim);color:var(--green); }
  .empty { opacity:0.5;font-size:12px;text-align:center;padding:24px 0; }
  @media(max-width:640px){ .cards-row{grid-template-columns:1fr;} .bar-row{grid-template-columns:70px 1fr 48px;} }
</style></head><body>
<div class="header"><div class="header-left">
  <div class="logo">cm</div>
  <span style="font-size:14px;font-weight:600;">context-mem <span style="font-size:10px;color:var(--text-muted);font-weight:400;">v3.0</span></span>
  <nav class="nav-links">
    <a href="/" class="nav-link">Home</a><a href="/topics" class="nav-link">Topics</a><a href="/graph" class="nav-link">Graph</a><a href="/timeline" class="nav-link">Timeline</a><a href="/trail" class="nav-link">Trail</a><a href="/narrative" class="nav-link">Narrative</a><a href="/diagnostics" class="nav-link">Diagnostics</a><a href="/compression" class="nav-link">Compression</a><a href="/compression" class="nav-link active">Compression</a>
  </nav>
</div></div>
<div class="main">
  <div>
    <div class="page-title">Compression Analytics</div>
    <div class="page-sub">Token savings achieved by content-aware summarizers across all observations.</div>
  </div>

  <!-- Summary cards -->
  <div class="cards-row">
    <div class="card">
      <div class="stat-label">Total Observations</div>
      <div class="stat-val" id="overall-obs">—</div>
      <div class="stat-sub">with summarization metadata</div>
    </div>
    <div class="card">
      <div class="stat-label">Tokens Saved</div>
      <div class="stat-val" id="overall-saved">—</div>
      <div class="stat-sub" id="overall-saved-sub">original vs summarized</div>
    </div>
    <div class="card">
      <div class="stat-label">Overall Savings</div>
      <div class="stat-val" id="overall-pct" style="color:var(--green);">—</div>
      <div class="stat-sub">compression ratio</div>
    </div>
  </div>

  <!-- Per content-type bar chart -->
  <div class="card">
    <div class="section-title">Savings by Content Type</div>
    <div class="bar-chart" id="bar-chart">
      <div class="empty">Loading…</div>
    </div>
  </div>

  <!-- Histogram -->
  <div class="card">
    <div class="section-title">Compression Ratio Distribution</div>
    <div id="histo-wrap" style="padding-bottom:4px;">
      <div class="histo" id="histo">
        <div class="empty">Loading…</div>
      </div>
    </div>
  </div>

  <!-- Detail table -->
  <div class="card">
    <div class="section-title">Per Content-Type Detail</div>
    <table class="data-table">
      <thead><tr>
        <th>Type</th><th>Observations</th><th>Original tokens</th><th>Summary tokens</th><th>Savings</th>
      </tr></thead>
      <tbody id="detail-tbody"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
    </table>
  </div>
</div>
<script>
function fmt(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function load() {
  const res = await fetch('/api/compression-analytics');
  const data = await res.json();

  // Overall cards
  const ov = data.overall || {};
  document.getElementById('overall-obs').textContent = fmt(ov.observations || 0);
  const saved = (ov.total_original || 0) - (ov.total_summary || 0);
  document.getElementById('overall-saved').textContent = fmt(Math.max(0, saved));
  document.getElementById('overall-saved-sub').textContent =
    fmt(ov.total_original || 0) + ' → ' + fmt(ov.total_summary || 0) + ' tokens';
  document.getElementById('overall-pct').textContent = (ov.savings_pct || 0).toFixed(1) + '%';

  // Bar chart — per content type
  const types = (data.perContentType || []).filter(r => r.total_original_bytes > 0);
  const barChart = document.getElementById('bar-chart');
  if (types.length === 0) {
    barChart.innerHTML = '<div class="empty">No summarization data recorded yet.</div>';
  } else {
    barChart.innerHTML = types.map(r => {
      const pct = Math.min(100, Math.max(0, r.savings_pct));
      return \`<div class="bar-row">
        <div class="bar-label" title="\${escapeHtml(r.type)}">\${escapeHtml(r.type)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:\${pct}%"></div></div>
        <div class="bar-pct">\${pct.toFixed(1)}%</div>
      </div>\`;
    }).join('');
  }

  // Histogram
  const hist = data.histogram || [];
  const histo = document.getElementById('histo');
  if (hist.length === 0 || hist.every(b => b.count === 0)) {
    histo.innerHTML = '<div class="empty">No distribution data yet.</div>';
  } else {
    const maxCount = Math.max(...hist.map(b => b.count), 1);
    histo.innerHTML = hist.map(b => {
      const h = Math.round((b.count / maxCount) * 100);
      return \`<div class="histo-col">
        <div class="histo-count">\${fmt(b.count)}</div>
        <div class="histo-bar" style="height:\${h}px"></div>
        <div class="histo-label">\${escapeHtml(b.bucket)}</div>
      </div>\`;
    }).join('');
  }

  // Detail table
  const tbody = document.getElementById('detail-tbody');
  const allTypes = data.perContentType || [];
  if (allTypes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No data.</td></tr>';
  } else {
    tbody.innerHTML = allTypes.map(r => {
      const pct = r.savings_pct || 0;
      const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--text-dim)';
      return \`<tr>
        <td style="font-weight:500;color:var(--text)">\${escapeHtml(r.type)}</td>
        <td>\${fmt(r.observations)}</td>
        <td>\${fmt(r.total_original_bytes)}</td>
        <td>\${fmt(r.total_summary_bytes)}</td>
        <td><span class="badge" style="color:\${color};background:none;padding:0;">\${pct.toFixed(1)}%</span></td>
      </tr>\`;
    }).join('');
  }
}
load();
</script></body></html>`;
}

module.exports = {
  getDashboardHtml,
  getGraphPageHtml,
  getTimelinePageHtml,
  getTopicsPageHtml,
  getTrailPageHtml,
  getNarrativePageHtml,
  getDiagnosticsPageHtml,
  getCompressionAnalyticsHtml,
};
