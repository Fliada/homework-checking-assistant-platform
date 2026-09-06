import type { IntegrityHighlight, IntegritySignal, Review } from './types';

export type AgentNote = { text: string; detail: string; tone: 'yellow' | 'red' | 'blue' | 'green' | 'purple' };

const CRITERION_TONES: AgentNote['tone'][] = ['yellow', 'blue', 'purple', 'green'];

export function criterionNoteTone(index: number): AgentNote['tone'] {
  return CRITERION_TONES[index % CRITERION_TONES.length];
}

export function collectAgentNotes(review?: Review): AgentNote[] {
  if (!review) return [];
  const notes: AgentNote[] = [];
  let criterionIndex = 0;
  for (const result of review.results) {
    if (
      !result.confirmed &&
      !['confirmed', 'feedback_sent'].includes(review.status) &&
      (result.abstained || (result.confidence > 0 && result.confidence < 0.6))
    ) {
      const title = review.rubric.criteria.find((c) => c.id === result.criterionId)?.title || 'критерий';
      notes.push({
        text: `${result.abstained ? 'нужно решение человека' : 'низкая уверенность'} по «${title}»`,
        detail: result.reason,
        tone: criterionNoteTone(criterionIndex++),
      });
    }
  }
  for (const annotation of review.annotations.filter((a) => a.source === 'ai' && a.status !== 'rejected')) {
    notes.push({ text: annotation.message, detail: annotation.message, tone: 'blue' });
  }
  const pendingSignals = (review.integrity.signals || []).filter((s) => s.status === 'pending');
  const overall = review.integrity.aiScore ?? review.integrity.ai_score;
  if (overall != null && overall >= 0.3) {
    notes.push({
      text: `сигнал ИИ ${overall.toFixed(2).replace('.', ',')}`,
      detail: pendingSignals.map((s) => s.message).join('\n') || review.integrity.message,
      tone: overall >= 0.6 ? 'red' : 'yellow',
    });
  } else if (pendingSignals.length) {
    const top = pendingSignals.reduce((best, item) => Math.max(best, item.aiScore ?? item.ai_score ?? 0), 0);
    if (top >= 0.3) {
      notes.push({
        text: `сигнал ИИ ${top.toFixed(2).replace('.', ',')}`,
        detail: pendingSignals.map((s) => s.message).join('\n'),
        tone: top >= 0.6 ? 'red' : 'yellow',
      });
    }
  }
  return notes;
}

export type SourceFilter = 'all' | 'signals' | 'completion' | 'open';

export function segmentLineNumber(anchor: string): number | null {
  const match = anchor.match(/^line:(\d+)/);
  return match ? Number(match[1]) : null;
}

export function segmentParagraphNumber(anchor: string): number | null {
  const match = anchor.match(/^paragraph:(\d+)/);
  return match ? Number(match[1]) : null;
}

export function highlightMatchesSegment(highlight: IntegrityHighlight, anchor: string): boolean {
  const line = segmentLineNumber(anchor);
  const start = highlight.startLine ?? highlight.start_line ?? 0;
  const end = highlight.endLine ?? highlight.end_line ?? start;
  if (line !== null) return line >= start && line <= end;
  const paragraph = segmentParagraphNumber(anchor);
  if (paragraph !== null) return paragraph >= start && paragraph <= end;
  return false;
}

const COMPLETION_RE = /graceful|shutdown|context|заверш|close\(\)|stop server/i;

export function segmentMatchesCompletion(text: string, anchor: string): boolean {
  return COMPLETION_RE.test(text) || COMPLETION_RE.test(anchor);
}

export function visibleHighlights(
  highlights: IntegrityHighlight[] | undefined,
  artifactId: string,
  filter: SourceFilter,
): IntegrityHighlight[] {
  const scoped = (highlights || []).filter((h) => (h.artifactId || h.artifact_id) === artifactId);
  if (filter === 'open') return scoped.filter((h) => h.status === 'pending');
  if (filter === 'signals') return scoped.filter((h) => h.status !== 'rejected');
  return scoped;
}

export function shouldShowSegment(
  text: string,
  anchor: string,
  highlights: IntegrityHighlight[],
  filter: SourceFilter,
  linkedCompletion: boolean,
): boolean {
  const matching = highlights.filter((h) => highlightMatchesSegment(h, anchor));
  if (filter === 'all') return true;
  if (filter === 'open') {
    if (!matching.length) return true;
    return matching.some((h) => h.status === 'pending');
  }
  if (filter === 'signals') return matching.length > 0;
  if (filter === 'completion') return linkedCompletion || segmentMatchesCompletion(text, anchor);
  return true;
}

export function topIntegritySignal(signals?: IntegritySignal[]): IntegritySignal | null {
  if (!signals?.length) return null;
  return [...signals].sort((a, b) => (b.aiScore ?? b.ai_score ?? 0) - (a.aiScore ?? a.ai_score ?? 0))[0];
}
