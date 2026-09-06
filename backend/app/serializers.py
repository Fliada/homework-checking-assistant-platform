import os
from sqlalchemy import select
from .models import *

def iso(value): return value.isoformat() if value else None

def user_json(u, course_ids=None):
    return {'id': u.id, 'name': u.name, 'email': u.email, 'role': u.role, 'status': 'needs_role' if u.role == 'pending' else ('active' if u.active else 'disabled'), 'courseIds': u.course_ids or [], 'capacityMinutes': u.capacity, 'available': u.available}

def course_json(c):
    return {'id': c.id, 'title': c.title, 'run': c.run, 'expertId': c.owner_expert_id or '', 'status': c.status}

def rubric_json(r):
    if not r: return {'id': '', 'version': 0, 'status': 'draft', 'criteria': []}
    return {'id': r.id, 'version': r.version, 'status': r.status, 'criteria': [{'id': c['id'], 'title': c['title'], 'description': c.get('description', ''), 'maxScore': c.get('max_score', 0), 'mode': c.get('verification_mode', 'llm'), 'required': c.get('required', True)} for c in r.criteria]}

def active_rubric(db, aid): return db.scalar(select(Rubric).where(Rubric.assignment_id == aid, Rubric.status == 'published').order_by(Rubric.version.desc()))
def active_config(db, aid): return db.scalar(select(AgentConfig).where(AgentConfig.assignment_id == aid, AgentConfig.status == 'published').order_by(AgentConfig.version.desc()))

def assignment_json(db, a, private=False):
    config = active_config(db, a.id)
    draft = db.scalar(select(Rubric).where(Rubric.assignment_id == a.id, Rubric.status == 'draft').order_by(Rubric.version.desc())) if private else None
    return {'id': a.id, 'courseId': a.course_id, 'code': a.code, 'title': a.title, 'taskText': a.task_text, 'dueAt': a.due_at, 'reviewDueAt': a.review_due_at, 'estimatedMinutes': a.estimated_minutes, 'status': 'active', 'rubric': rubric_json(active_rubric(db, a.id)), 'rubricDraft': rubric_json(draft) if draft else None, 'references': a.references if private else [r for r in a.references if r.get('type') == 'guide'], 'latePolicy': a.late_policy or {'enabled': False, 'type': 'fixed', 'value': 0, 'intervalDays': 1}, 'activeConfigVersion': config.version if config else None}

def artifact_json(a):
    def anchor_string(anchor):
        if isinstance(anchor, str): return anchor
        return str(anchor.get('start', anchor.get('anchor', ''))) if isinstance(anchor, dict) else ''
    return {'id': a.get('id', a.get('artifact_id', '')), 'path': a.get('path', ''), 'mediaType': a.get('media_type', 'text/plain'), 'parseStatus': a.get('parse_status', 'needs_human'), 'segments': [{'id': s.get('id', str(i)), 'anchor': anchor_string(s.get('anchor')), 'text': s.get('text', '')} for i, s in enumerate(a.get('segments', []))]}

def latest_review(db, sid): return db.scalar(select(Review).where(Review.submission_id == sid).order_by(Review.created_at.desc()))

def submission_json(db, s, include_artifacts=True):
    review = latest_review(db, s.id)
    error = s.error
    if error == 'Не удалось выполнить операцию (PipelineError). Проверьте настройки и повторите запуск.':
        error = 'Предыдущая попытка завершилась ошибкой в старой версии сервиса. Повторите загрузку работы; новая попытка покажет конкретную причину, если ошибка сохранится.'
    return {'id': s.id, 'assignmentId': s.assignment_id, 'studentId': s.student_id, 'reviewerId': review.reviewer_id if review else None, 'prUrl': s.external_ref, 'attempt': s.attempt_no, 'submittedAt': iso(s.submitted_at), 'status': s.status, 'headSha': s.git_metadata.get('head_sha', ''), 'artifacts': [artifact_json(a) for a in s.artifacts] if include_artifacts else [], 'error': error, 'reviewId': review.id if review else None, 'isDemo': s.git_metadata.get('demo', False), 'snapshotScope': s.git_metadata.get('snapshot_scope'), 'snapshotComplete': s.git_metadata.get('snapshot_complete')}


def late_penalty(db,r):
    if r.status == 'confirmed' and r.late_penalty_value is not None: return r.late_penalty_value
    import math
    from datetime import datetime, timezone
    s=db.get(Submission,r.submission_id); a=db.get(Assignment,s.assignment_id); policy=a.late_policy or {}
    if not policy.get('enabled') or not a.due_at: return 0
    try:
        due=datetime.fromisoformat(a.due_at.replace('Z','+00:00'))
        if due.tzinfo is None: due=due.replace(tzinfo=timezone.utc)
        submitted=s.submitted_at.replace(tzinfo=timezone.utc) if s.submitted_at.tzinfo is None else s.submitted_at
        overdue=(submitted-due).total_seconds()
        if overdue<=0: return 0
        intervals=math.ceil(overdue/(86400*max(1,policy.get('intervalDays',1))))
        value=policy.get('value',0)*intervals
        score=sum(c.get('final_score') or 0 for c in r.criterion_results)
        amount=score*value/100 if policy.get('type')=='percent' else value
        return round(min(score,amount),2)
    except (ValueError,TypeError): return 0

def integrity_highlight_json(item: dict) -> dict:
    return {
        'id': item.get('id', ''),
        'signalId': item.get('signal_id', ''),
        'artifactId': item.get('artifact_id', ''),
        'path': item.get('path', ''),
        'kind': item.get('kind', 'code'),
        'startLine': item.get('start_line', 0),
        'endLine': item.get('end_line', 0),
        'aiScore': item.get('ai_score'),
        'level': item.get('level'),
        'status': item.get('status', 'pending'),
        'message': item.get('message', ''),
        'reasons': item.get('reasons', []),
    }

def integrity_json(integrity: dict) -> dict:
    ai_score = integrity.get('ai_score')
    return {
        'status': integrity.get('status', 'unavailable'),
        'decision': integrity.get('decision', 'deferred'),
        'level': integrity.get('level'),
        'message': integrity.get('message', ''),
        'aiScore': ai_score,
        'signals': [integrity_signal_json(item) for item in integrity.get('signals', [])],
        'highlights': [integrity_highlight_json(item) for item in integrity.get('highlights', [])],
    }

def integrity_signal_json(signal: dict) -> dict:
    return {
        'id': signal.get('id', ''),
        'artifactId': signal.get('artifact_id', ''),
        'path': signal.get('path', ''),
        'kind': signal.get('kind', 'code'),
        'blockKind': signal.get('block_kind', ''),
        'blockName': signal.get('block_name', ''),
        'startLine': signal.get('start_line', 0),
        'endLine': signal.get('end_line', 0),
        'classification': signal.get('classification', ''),
        'aiScore': signal.get('ai_score'),
        'humanScore': signal.get('human_score'),
        'level': signal.get('level'),
        'status': signal.get('status', 'pending'),
        'message': signal.get('message', ''),
    }

def review_json(db, r, student=False):
    config = db.get(AgentConfig, r.agent_config_version_id) if r.agent_config_version_id else None
    results = [{'criterionId': c['criterion_id'], 'suggestedScore': None if student else c.get('suggested_score'), 'finalScore': c.get('final_score'), 'confidence': 0 if student else c.get('confidence', 0), 'abstained': False if student else c.get('abstained', False), 'reason': c.get('note', '') if student else c.get('reason', c.get('reasoning', '')), 'confirmed': c.get('confirmed', False), 'note': c.get('note', '')} for c in r.criterion_results]
    annotations = []
    for a in r.annotations:
        if student and (a.get('status') not in ('accepted', 'edited') or not a.get('visible_to_student', True)): continue
        anchor = a.get('source_anchor', a.get('anchor', {}))
        if not isinstance(anchor, dict): anchor = {}
        annotations.append({'id': a['id'], 'criterionId': a.get('criterion_id'), 'category': a.get('category', 'comment'), 'source': a.get('source', 'ai'), 'status': a.get('status', 'pending'), 'message': a.get('message', ''), 'visibleToStudent': a.get('visible_to_student', True), 'anchor': {'artifactId': anchor.get('artifact_id', ''), 'path': anchor.get('path', ''), 'start': str(anchor.get('start', '')), 'end': str(anchor.get('end', '')), 'quote': anchor.get('quote', '')}})
    minutes = round((r.active_seconds or 0) / 60, 1)
    integrity = r.integrity or {'status': 'unavailable', 'decision': 'deferred', 'level': None, 'message': 'Анализ не выполнялся.', 'signals': [], 'highlights': []}
    return {'id': r.id, 'submissionId': r.submission_id, 'reviewerId': r.reviewer_id, 'status': r.status, 'configVersion': config.version if config else None, 'rubric': rubric_json(db.get(Rubric, r.rubric_id)), 'results': results, 'annotations': annotations, 'feedback': r.feedback, 'feedbackStale': r.feedback_revision != r.revision, 'finalScore': r.final_score, 'draftScore': None if student else r.draft_score, 'confirmedAt': iso(r.confirmed_at), 'activeMinutes': minutes, 'integrity': integrity_json(integrity), 'revision': r.revision, 'latePenalty': late_penalty(db,r), 'scoreBeforePenalty': sum(c.get('final_score') or 0 for c in r.criterion_results)}

def model_json(m, admin=False):
    d, c = m.default_params, m.capabilities
    return {'id': m.id, 'name': m.name, 'provider': m.provider, 'group': m.group, 'baseUrl': m.base_url if admin else '', 'modelName': m.model_name, 'apiKeyEnv': m.api_key_env if admin else '', 'enabled': m.enabled, 'secretPresent': bool(os.getenv(m.api_key_env)) if admin else False, 'health': m.health, 'defaultParams': {'temperature': d.get('temperature', .2), 'maxOutputTokens': d.get('max_output_tokens', 4000), 'timeoutSeconds': d.get('timeout_seconds', 90), 'maxRetries': d.get('max_retries', 2)}, 'capabilities': {'jsonSchema': c.get('json_schema', False), 'jsonMode': c.get('json_mode', not (m.provider == 'gemini' or m.model_name.lower().startswith('gemma'))), 'maxContextTokens': c.get('max_context_tokens', 32000), 'zeroRetention': c.get('zero_retention', False)}}

def model_python(m):
    return {key: getattr(m, key) for key in ['id', 'name', 'provider', 'group', 'base_url', 'model_name', 'api_key_env', 'enabled', 'default_params', 'capabilities']}

def config_json(c):
    return {'id': c.id, 'assignmentId': c.assignment_id, 'version': c.version, 'status': c.status, 'createdAt': iso(c.created_at), 'publishedAt': iso(c.published_at), 'tasks': {key: {'modelId': value['model_id'], 'prompt': value.get('prompt_template', ''), 'temperature': value.get('params', {}).get('temperature', .2), 'topP': value.get('params', {}).get('top_p', .9), 'maxOutputTokens': value.get('params', {}).get('max_output_tokens', 4000)} for key, value in c.tasks.items()}, 'thresholds': {'abstain': c.thresholds.get('abstain', .6), 'critic': c.thresholds.get('critic_confidence', .6)}}

def eval_json(db, e):
    c = db.get(AgentConfig, e.agent_config_version_id)
    m = e.metrics
    stability=m.get('stability',{})
    values=[v.get('stddev') for v in stability.values() if v.get('stddev') is not None] if isinstance(stability,dict) else []
    metrics={'orderingAccuracy':m.get('ordering_accuracy'),'stability':sum(values)/len(values) if values else None,'anchorValidity':m.get('anchor_validity'),'abstainRate':m.get('abstain_rate'),'latencySeconds':m.get('latency_ms',0)/1000 if 'latency_ms' in m else None,'totalTokens':(m.get('input_tokens') or 0)+(m.get('output_tokens') or 0) if m.get('input_tokens') is not None or m.get('output_tokens') is not None else None}
    outputs=[]
    for o in e.outputs:
        calls=o.get('model_calls',[])
        model_ids=list(dict.fromkeys(call.get('model_id','') for call in calls))
        outputs.append({'example':o.get('example',o.get('level','')),'repetition':o.get('repetition',1),'score':o.get('draft_total',o.get('score')),'modelId':', '.join(model_ids),'error':o.get('error')})
    return {'id':e.id,'assignmentId':e.assignment_id,'configVersion':c.version,'exampleCount':m.get('example_count',len(e.outputs)//max(1,e.repetitions) if e.outputs else 3),'repetitions':e.repetitions,'status':e.status,'createdAt':iso(e.created_at),'error':e.error,'metrics':{k:v for k,v in metrics.items() if v is not None},'outputs':outputs,'rawMetrics':m,'logs':m.get('progress_log',[])}
