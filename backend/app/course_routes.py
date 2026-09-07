from collections import Counter, defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import current_user, ADMIN
from .db import get_db
from .models import Assignment, Course, Review, Rubric, Submission, User, SimilarityRun
from .serializers import course_json, iso

router = APIRouter(prefix='/api/v1')
DONE = {'confirmed', 'feedback_sent'}


def course_scope(db, user, course):
    if user.role in ADMIN:
        return
    if (user.role not in {'student', 'reviewer', 'expert', 'coordinator'}
        or course.id not in (user.course_ids or [])
        or (user.role == 'expert' and course.owner_expert_id != user.id)):
        raise HTTPException(403, 'Курс не назначен вашему аккаунту.')


def latest_submissions(db, assignment_ids):
    latest = {}
    for s in db.scalars(select(Submission).where(Submission.assignment_id.in_(assignment_ids))
                        .order_by(Submission.attempt_no.desc(), Submission.submitted_at.desc())).all():
        latest.setdefault((s.student_id, s.assignment_id), s)
    return latest


def timestamp(value):
    if not value: return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError: return None


def progress(db, user, course):
    course_scope(db, user, course)
    assignments = db.scalars(select(Assignment).where(Assignment.course_id == course.id)
                             .order_by(Assignment.code, Assignment.title)).all()
    students = [u for u in db.scalars(select(User).where(User.role == 'student', User.active == True)).all()
                if course.id in (u.course_ids or [])]
    if user.role == 'student': students = [user]
    latest = latest_submissions(db, [a.id for a in assignments])
    sids = [s.id for s in latest.values()]
    reviews = {}
    for r in db.scalars(select(Review).where(Review.submission_id.in_(sids), Review.status != 'superseded')
                        .order_by(Review.created_at.desc())).all():
        reviews.setdefault(r.submission_id, r)
    totals = Counter(); items = []; points = []; weak = defaultdict(list)
    for a in assignments:
        counts = Counter(); rows = []
        for student in students:
            s = latest.get((student.id, a.id)); r = reviews.get(s.id) if s else None
            completed = bool(s and r and r.status in DONE)
            state = ('completed' if completed else 'attention' if s and s.status in {'failed', 'needs_human', 'configuration_error'}
                     else 'checking' if s else 'missing')
            counts[state] += 1; totals[state] += 1
            due = timestamp(a.due_at); submitted = timestamp(s.submitted_at) if s else None
            late_days = round((submitted - due).total_seconds() / 86400, 1) if submitted and due else None
            overdue = bool(due and not s and due < datetime.now(timezone.utc))
            counts['overdue'] += int(overdue); totals['overdue'] += int(overdue)
            readable = user.role != 'reviewer' or bool(r and r.reviewer_id == user.id)
            rubric = db.get(Rubric, r.rubric_id) if r else None
            maximum = sum(c.get('max_score', 0) for c in rubric.criteria) if rubric else 0
            score = r.final_score if completed else None
            row = {'studentId': student.id, 'studentName': student.name, 'state': state,
                   'status': s.status if s else 'not_submitted', 'overdue': overdue,
                   'submissionId': s.id if s and readable else None,
                   'reviewId': r.id if r and readable and (user.role != 'student' or completed) else None,
                   'submittedAt': iso(s.submitted_at) if s else None, 'attempt': s.attempt_no if s else 0,
                   'lateDays': late_days, 'score': score if readable else None,
                   'maxScore': maximum if readable else None,
                   'agentNotes': agent_notes(db, r) if r and readable and user.role != 'student' else [],
                   'similarityComments': []}
            rows.append(row)
            if completed and maximum and score is not None:
                points.append({'student': student.name if readable else 'Студент потока', 'assignmentId': a.id,
                               'code': a.code, 'scorePercent': round(score / maximum * 100, 1),
                               'lateDays': late_days, 'reviewId': row['reviewId']})
                for c in r.criterion_results:
                    criterion = next((x for x in rubric.criteria if x['id'] == c.get('criterion_id')), None)
                    if criterion and criterion.get('max_score') and c.get('final_score') is not None:
                        weak[(a.code, criterion['title'])].append(c['final_score'] / criterion['max_score'] * 100)
        if user.role == 'student':
            # Only explicit, current human decisions reach the student's course page.
            for run in db.scalars(select(SimilarityRun).where(SimilarityRun.assignment_id == a.id, SimilarityRun.status == 'completed')
                                  .order_by(SimilarityRun.created_at.desc())).all():
                for pair in run.results.get('pairs', []):
                    decision = (run.decisions or {}).get(pair['id'], {})
                    if decision.get('status') == 'confirmed' and rows and rows[0]['submissionId'] in (pair['leftId'], pair['rightId']):
                        if decision.get('comment') not in rows[0]['similarityComments']:
                            rows[0]['similarityComments'].append(decision['comment'])
        items.append({'id': a.id, 'code': a.code, 'title': a.title, 'dueAt': a.due_at,
                      'reviewDueAt': a.review_due_at, 'counts': dict(counts), 'total': len(students),
                      'waitingMinutes': (counts['checking'] + counts['attention']) * a.estimated_minutes, 'rows': rows})
    total = len(assignments) * len(students)
    return {'course': course_json(course), 'studentCount': len(students), 'assignmentCount': len(assignments),
            'total': total, 'counts': dict(totals), 'completionPercent': round(totals['completed'] / total * 100) if total else 0,
            'assignments': items, 'points': points if user.role != 'student' else [],
            'weakCriteria': sorted([{'assignment': k[0], 'title': k[1], 'averagePercent': round(sum(v) / len(v), 1), 'count': len(v)}
                                    for k, v in weak.items()], key=lambda x: x['averagePercent']) if user.role != 'student' else []}


def agent_notes(db, review):
    if not review: return []
    notes = []
    rubric = db.get(Rubric, review.rubric_id)
    titles = {c['id']: c['title'] for c in rubric.criteria} if rubric else {}
    criterion_tones = ['yellow', 'blue', 'purple', 'green']
    criterion_index = 0
    for c in review.criterion_results:
        title = titles.get(c.get('criterion_id'), 'Критерий')
        if c.get('confirmed') or review.status in DONE: continue
        if c.get('abstained'):
            notes.append({'tone': criterion_tones[criterion_index % len(criterion_tones)], 'text': f'Нужно решение человека: {title}', 'detail': c.get('reason', c.get('reasoning', ''))})
            criterion_index += 1
        elif 0 < c.get('confidence', 0) < .6:
            notes.append({'tone': criterion_tones[criterion_index % len(criterion_tones)], 'text': f'Низкая уверенность: {title}', 'detail': c.get('reason', c.get('reasoning', ''))})
            criterion_index += 1
    for a in review.annotations:
        if a.get('source', 'ai') == 'ai' and a.get('status') != 'rejected' and a.get('message'):
            notes.append({'tone': 'blue', 'text': a['message'][:180], 'detail': a['message']})
    if not notes and review.status in DONE and review.feedback:
        notes.append({'tone': 'green', 'text': review.feedback[:180], 'detail': review.feedback})
    if not notes:
        for c in review.criterion_results:
            reason = c.get('reason', c.get('reasoning', ''))
            if reason:
                notes.append({'tone': 'green' if c.get('confidence', 0) >= .8 else 'blue', 'text': reason[:180], 'detail': reason})
    return notes[:3]


@router.get('/courses/progress')
def courses_progress(user: User = Depends(current_user), db: Session = Depends(get_db)):
    courses = db.scalars(select(Course)).all()
    summaries = []
    for course in courses:
        try: course_scope(db, user, course)
        except HTTPException: continue
        data = progress(db, user, course)
        summaries.append({k: v for k, v in data.items() if k not in {'assignments', 'points', 'weakCriteria'}})
    return summaries


@router.get('/courses/{course_id}/progress')
def course_progress(course_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course: raise HTTPException(404, 'Курс не найден.')
    return progress(db, user, course)
