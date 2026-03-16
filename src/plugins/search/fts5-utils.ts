// Sanitize query for FTS5 MATCH — wrap terms in double quotes, escape internal quotes
export function sanitizeFTS5Query(query: string): string {
  // Split into terms, wrap each in quotes, escape internal double-quotes
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return '""';
  return terms.map(t => '"' + t.replace(/"/g, '""') + '"').join(' ');
}
