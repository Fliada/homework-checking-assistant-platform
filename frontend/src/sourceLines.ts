import type { Annotation, Artifact } from './types';
import { annotationCategory } from './annotationCategories';
import type { IntegrityHighlight } from './types';

export type SourceLineRow = {
  key: string;
  lineNo: number;
  text: string;
  segmentIndex: number;
  anchor: string;
};

export function expandArtifactLines(file: Artifact): SourceLineRow[] {
  const rows: SourceLineRow[] = [];
  for (let segmentIndex = 0; segmentIndex < file.segments.length; segmentIndex++) {
    const segment = file.segments[segmentIndex];
    const startMatch = segment.anchor.match(/^line:(\d+)/);
    const startLine = startMatch ? Number(startMatch[1]) : segmentIndex + 1;
    const lines = segment.text.split('\n');
    for (let offset = 0; offset < lines.length; offset++) {
      const lineNo = startLine + offset;
      rows.push({
        key: `${file.id}:${lineNo}`,
        lineNo,
        text: lines[offset],
        segmentIndex,
        anchor: `line:${lineNo}`,
      });
    }
  }
  return rows;
}

export function highlightMatchesLine(highlight: IntegrityHighlight, lineNo: number): boolean {
  const start = highlight.startLine ?? highlight.start_line ?? 0;
  const end = highlight.endLine ?? highlight.end_line ?? start;
  return lineNo >= start && lineNo <= end;
}

export function lineAnnotations(
  file: Artifact,
  row: SourceLineRow,
  annotations: Annotation[],
) {
  return annotations.filter((a) => {
    if (a.status === 'rejected' || (a.anchor.artifactId !== file.id && a.anchor.path !== file.path))
      return false;
    const from = /^line:(\d+)$/.exec(a.anchor.start);
    const to = /^line:(\d+)$/.exec(a.anchor.end);
    if (from && to) {
      return row.lineNo >= Number(from[1]) && row.lineNo <= Number(to[1]);
    }
    const start = file.segments.findIndex((s) => s.anchor === a.anchor.start);
    const end = file.segments.findIndex((s) => s.anchor === a.anchor.end);
    if (start >= 0 && end >= 0) {
      return row.segmentIndex >= Math.min(start, end) && row.segmentIndex <= Math.max(start, end);
    }
    return row.segmentIndex === start;
  });
}

export function lineCategories(
  file: Artifact,
  row: SourceLineRow,
  annotations: Annotation[],
) {
  return [...new Set(lineAnnotations(file, row, annotations).map((a) => annotationCategory(a.category)))];
}
