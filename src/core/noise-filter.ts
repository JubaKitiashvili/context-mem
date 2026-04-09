/**
 * Signal/noise scoring for content quality assessment.
 * Used to downweight noisy observations in search rankings
 * and importance classification.
 */

export function computeSignalScore(content: string): number {
  // Repetition: high ratio of repeated lines = noise
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const uniqueLines = new Set(lines);
  const repetitionRatio = lines.length > 0 ? uniqueLines.size / lines.length : 1;

  // Entropy: low character diversity = noise (e.g., "======" divider lines)
  const chars = new Set(content.replace(/\s/g, ''));
  const charDiversity = Math.min(1, chars.size / 40);

  // Vocabulary richness: unique words / sqrt(total words)
  const words = content.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const uniqueWords = new Set(words);
  const vocabRichness = words.length > 0 ? Math.min(1, uniqueWords.size / Math.sqrt(words.length)) : 0;

  return repetitionRatio * 0.3 + charDiversity * 0.3 + vocabRichness * 0.4;
}
