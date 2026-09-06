import type { Annotation, Artifact } from './types';

export const annotationCategories = {
  logic: 'Логика',
  requirement: 'Требование задания',
  quality: 'Качество кода',
  question: 'Вопрос',
  positive: 'Сильная сторона',
  comment: 'Комментарий',
} as const;
export type AnnotationCategory = keyof typeof annotationCategories;
export function annotationCategory(value: string): AnnotationCategory {
  return value in annotationCategories ? (value as AnnotationCategory) : 'comment';
}
export function segmentAnnotations(file: Artifact, index: number, annotations: Annotation[]) {
  return annotations.filter((a) => {
    if (a.status === 'rejected' || (a.anchor.artifactId !== file.id && a.anchor.path !== file.path))
      return false;
    const start = file.segments.findIndex((s) => s.anchor === a.anchor.start);
    const end = file.segments.findIndex((s) => s.anchor === a.anchor.end);
    if (start >= 0 && end >= 0)
      return index >= Math.min(start, end) && index <= Math.max(start, end);
    // Parsed chunks may end at an anchor between visible segment starts.
    const line = /^line:(\d+)$/.exec(file.segments[index].anchor);
    const from = /^line:(\d+)$/.exec(a.anchor.start);
    const to = /^line:(\d+)$/.exec(a.anchor.end);
    if (line && from && to) {
      const next = /^line:(\d+)$/.exec(file.segments[index + 1]?.anchor || '');
      const lastLine = next
        ? Number(next[1]) - 1
        : Number(line[1]) + file.segments[index].text.split('\n').length - 1;
      return Number(line[1]) <= Number(to[1]) && lastLine >= Number(from[1]);
    }
    return index === start;
  });
}
