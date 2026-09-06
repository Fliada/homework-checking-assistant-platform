import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useData } from './context';
import type { Annotation, Artifact } from './types';

type Fragment = {path: string; start: number; end: number; code: string};
type Comparison = {id: string; status: string; pairs: {id: string; leftId: string; rightId: string; leftUrl?: string; rightUrl?: string; averagePercent: number; decision?: {status: string}; matches?: {left: Fragment; right: Fragment}[]}[]};
export function useReviewSimilarity(assignmentId?: string, submissionId?: string, file?: Artifact) {
  const { user } = useData();
  const enabled = !!assignmentId && ['reviewer','expert','admin','owner'].includes(user.role);
  const list = useQuery({queryKey:['review-similarity',assignmentId,user.id], queryFn:() => api<{runs: Comparison[]}>(`/assignments/${assignmentId}/similarity`), enabled, refetchInterval:8000});
  const latest = list.data?.runs?.find(r => r.status === 'completed' && r.pairs.some(p => p.leftId === submissionId || p.rightId === submissionId));
  const detail = useQuery({queryKey:['review-similarity-detail',latest?.id,user.id],queryFn:() => api<Comparison>(`/similarity/${latest!.id}`),enabled:enabled && !!latest, refetchInterval:8000});
  const matches = (detail.data?.pairs || []).filter(p => p.decision?.status !== 'dismissed' && (p.leftId === submissionId || p.rightId === submissionId)).flatMap(p => (p.matches || []).map((m,i) => ({id:`${p.id}-${i}`,percent:p.averagePercent,url:p.leftId === submissionId ? p.rightUrl : p.leftUrl,own:p.leftId === submissionId ? m.left : m.right,other:p.leftId === submissionId ? m.right : m.left}))).filter(m => m.own.path === file?.path && m.own.end - m.own.start >= 2 && m.other.end - m.other.start >= 2 && m.own.code.split('\n').filter(l=>l.trim()).length >= 3 && m.other.code.split('\n').filter(l=>l.trim()).length >= 3);
  const annotations: Annotation[] = matches.map(m => ({id:m.id,criterionId:null,category:'similarity',source:'ai',status:'pending',message:`Схожесть на работы других студентов: строки ${m.own.start}–${m.own.end}`, relatedUrl:m.url, relatedCode:m.other.code,visibleToStudent:false,anchor:{artifactId:file!.id,path:file!.path,start:`line:${m.own.start}`,end:`line:${m.own.end}`,quote:m.own.code}}));
  for (const annotation of annotations) {
    const start = Number(annotation.anchor.start.slice(5)), end = Number(annotation.anchor.end.slice(5));
    const visible = file?.segments.filter(s => s.diffKind !== 'removed' && /^line:\d+$/.test(s.anchor) && Number(s.anchor.slice(5)) >= start && Number(s.anchor.slice(5)) <= end) || [];
    if (visible.length) {
      annotation.anchor.start = visible[0].anchor;
      annotation.anchor.end = visible[visible.length - 1].anchor;
    }
  }
  return {matches, annotations, error:list.isError || detail.isError};
}
