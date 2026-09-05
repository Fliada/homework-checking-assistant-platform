import os
from pathlib import Path
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(__file__).parents[1] / 'test-reviewer.db')
os.environ['JWT_SECRET'] = 'test-secret-with-more-than-thirty-two-characters'
os.environ['OWNER_EMAIL'] = 'owner@test.local'
os.environ['OWNER_PASSWORD'] = 'OwnerPassword123!'
os.environ['APP_DEBUG'] = 'true'
os.environ['SEED_DEMO'] = 'true'
os.environ['JOB_MODE'] = 'local'
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db import Base, engine, SessionLocal
from app.models import AgentConfig, AuditEvent, Review, User, Rubric, Assignment

@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)


def headers(client, role='reviewer'):
    response=client.post('/api/v1/auth/debug',json={'role':role})
    assert response.status_code==200, response.text
    return {'Authorization':'Bearer '+response.json()['accessToken']}


def test_auth_refresh_and_pending_role(client):
    response=client.post('/api/v1/auth/register/employee',json={'name':'New Expert','email':'new@test.local','password':'new-password-123'})
    assert response.status_code==201
    data=response.json(); auth={'Authorization':'Bearer '+data['accessToken']}
    assert data['user']['role']=='pending'
    assert client.get('/api/v1/admin/employees',headers=auth).status_code==403
    assert client.post('/api/v1/courses',json={'title':'hack'},headers=auth).status_code==403
    refreshed=client.post('/api/v1/auth/refresh',json={'refreshToken':data['refreshToken']})
    assert refreshed.status_code==200
    assert client.post('/api/v1/auth/refresh',json={'refreshToken':data['refreshToken']}).status_code==401


def test_owner_only_admin_and_one_role(client):
    admin=headers(client,'admin'); owner=headers(client,'owner')
    assert client.patch('/api/v1/admin/employees/demo-expert/roles',json={'role':'admin'},headers=admin).status_code==403
    assert client.patch('/api/v1/admin/employees/owner/roles',json={'role':'reviewer'},headers=owner).status_code==403
    assert client.post('/api/v1/owner/admins/demo-expert',headers=owner).status_code==200
    assert client.get('/api/v1/me',headers=headers(client,'admin')).json()['role']=='admin'
    assert client.patch('/api/v1/admin/employees/demo-expert/roles',json={'role':'reviewer'},headers=admin).status_code==403
    assert client.delete('/api/v1/owner/admins/demo-expert',headers=owner).json()['role']=='pending'


def test_student_and_reviewer_scope(client):
    student=headers(client,'student'); reviewer=headers(client,'reviewer')
    data=client.get('/api/v1/bootstrap',headers=student).json()
    assert len(data['submissions'])==1 and data['reviews']==[] and data['models']==[] and data['configs']==[]
    assert client.get('/api/v1/submissions/demo-submission-2',headers=student).status_code==403
    assert client.get('/api/v1/reviews/demo-review-4/workspace',headers=reviewer).status_code==403
    assert client.patch('/api/v1/reviews/demo-review-4/criteria/go1-c1',json={'finalScore':1,'confirmed':True},headers=reviewer).status_code==403
    assert client.get('/api/v1/reviews/demo-review-1/workspace',headers=student).status_code==403
    with SessionLocal() as db:
        db.add(User(id='other-expert',email='other@local.test',name='Other',password_hash='x',role='expert')); db.commit()
    other=client.post('/api/v1/auth/register/employee',json={'email':'another@local.test','name':'Other','password':'example-long-password'}).json()
    admin=headers(client,'admin')
    client.patch('/api/v1/admin/employees/'+other['user']['id']+'/roles',json={'role':'expert'},headers=admin)
    outsider={'Authorization':'Bearer '+other['accessToken']}
    assert client.post('/api/v1/assignments/go-task-1/rubrics',json={'criteria':[]},headers=outsider).status_code==403
    assert client.get('/api/v1/bootstrap',headers=outsider).json()['assignments']==[]


def test_immutable_config_and_pinned_review(client):
    expert=headers(client,'expert')
    initial=client.get('/api/v1/bootstrap',headers=expert).json()
    tasks=initial['configs'][0]['tasks']
    assert client.patch('/api/v1/assignments/go-task-1/agent-config/versions/1',json={'tasks':tasks},headers=expert).status_code==409
    c=client.post('/api/v1/assignments/go-task-1/agent-config/versions',json={},headers=expert).json()
    assert c['version']==2 and c['status']=='draft'
    published=client.post('/api/v1/assignments/go-task-1/agent-config/versions/2/publish',headers=expert)
    assert published.status_code==409 and published.json()['code']=='eval_required'
    with SessionLocal() as db:
        config=db.get(AgentConfig,c['id']); config.status='evaluated'; db.commit()
    assert client.post('/api/v1/assignments/go-task-1/agent-config/versions/2/publish',headers=expert).status_code==200
    with SessionLocal() as db:
        assert db.get(Review,'demo-review-1').agent_config_version_id=='go-task-1-config-1'
        assert db.get(AgentConfig,'go-task-1-config-1').status=='archived'
    assert client.patch('/api/v1/assignments/go-task-1/agent-config/versions/2',json={'tasks':tasks},headers=expert).status_code==409


def test_model_secret_ref_and_disabled_binding(client):
    admin=headers(client,'admin'); expert=headers(client,'expert')
    assert client.patch('/api/v1/admin/models/openai-default',json={'apiKey':'should-not-be-stored'},headers=admin).status_code==422
    assert client.patch('/api/v1/admin/models/openai-default',json={'baseUrl':'https://token:secret@example.org'},headers=admin).status_code==422
    assert client.post('/api/v1/admin/models/openai-default/disable',headers=admin).status_code==200
    c=client.post('/api/v1/assignments/go-task-1/agent-config/versions',json={},headers=expert).json()
    result=client.patch('/api/v1/assignments/go-task-1/agent-config/versions/'+str(c['version']),json={'tasks':c['tasks']},headers=expert)
    assert result.status_code==422 and result.json()['code']=='disabled_model'


def confirm_scores(client,auth):
    rubric=client.get('/api/v1/reviews/demo-review-1/workspace',headers=auth).json()['review']['rubric']
    for c in rubric['criteria']:
        response=client.patch('/api/v1/reviews/demo-review-1/criteria/'+c['id'],json={'finalScore':c['maxScore'],'confirmed':True},headers=auth)
        assert response.status_code==200,response.text


def test_feedback_confirmation_invariants_and_idempotency(client):
    auth=headers(client)
    confirm_auth={**auth,'Idempotency-Key':'confirm-review-1'}
    assert client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers=auth).status_code==400
    assert client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers=confirm_auth).json()['code']=='scores_unconfirmed'
    confirm_scores(client,auth)
    with SessionLocal() as db:
        r=db.get(Review,'demo-review-1')
        r.annotations=[{'id':'accepted','status':'accepted','message':'Verified fact','source':'ai','visible_to_student':True},{'id':'pending','status':'pending','message':'Unverified allegation','source':'ai','visible_to_student':True},{'id':'hidden','status':'accepted','message':'Internal note','source':'reviewer','visible_to_student':False}]
        db.commit()
    composed=client.post('/api/v1/reviews/demo-review-1/feedback/compose',json={},headers=auth)
    assert 'Verified fact' in composed.json()['feedback']
    assert 'Unverified allegation' not in composed.json()['feedback'] and 'Internal note' not in composed.json()['feedback']
    edited=client.patch('/api/v1/reviews/demo-review-1/criteria/go1-c1',json={'finalScore':1,'confirmed':True},headers=auth)
    assert edited.json()['feedbackStale'] is True
    assert client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers=confirm_auth).json()['code']=='stale_feedback'
    client.post('/api/v1/reviews/demo-review-1/feedback/compose',json={},headers=auth)
    response=client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers=confirm_auth)
    assert response.status_code==200,response.text
    assert response.json()['finalScore']==9
    again=client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers=confirm_auth)
    assert again.json()==response.json()
    assert client.patch('/api/v1/reviews/demo-review-1/criteria/go1-c1',json={'finalScore':0,'confirmed':True},headers=auth).status_code==409
    student=client.get('/api/v1/bootstrap',headers=headers(client,'student')).json()
    assert student['reviews'][0]['annotations'][0]['message']=='Verified fact'
    assert len(student['reviews'][0]['annotations'])==1
    with SessionLocal() as db:
        audits=db.scalars(select(AuditEvent).where(AuditEvent.action=='review.confirmed')).all()
        assert len(audits)==1


def test_rebalance_preview_is_read_only_and_capacity(client):
    auth=headers(client,'coordinator')
    with SessionLocal() as db:
        db.get(Review,'demo-review-1').reviewer_id=None
        db.commit()
    before=client.get('/api/v1/coordinator/workload',headers=auth).json()
    proposed=client.post('/api/v1/coordinator/assignments/rebalance',json={'preview':True},headers=auth).json()
    assert proposed['assignments']
    assert client.get('/api/v1/coordinator/workload',headers=auth).json()==before
    applied=client.post('/api/v1/coordinator/assignments/rebalance',json={'assignments':proposed['assignments']},headers=auth)
    assert applied.status_code==200 and applied.json()['assigned']==1


def test_durable_course_scope_and_empty_course(client):
    admin=headers(client,'admin'); student=headers(client,'student'); reviewer=headers(client); coordinator=headers(client,'coordinator')
    course=client.post('/api/v1/courses',json={'title':'Private course','run':'2027','expertId':'demo-expert'},headers=admin).json()
    assert course['id'] in [c['id'] for c in client.get('/api/v1/bootstrap',headers=admin).json()['courses']]
    assert course['id'] not in [c['id'] for c in client.get('/api/v1/bootstrap',headers=student).json()['courses']]
    response=client.patch('/api/v1/admin/employees/demo-student/roles',json={'role':'student','courseIds':[]},headers=admin)
    assert response.status_code==200 and response.json()['courseIds']==[]
    assert client.get('/api/v1/bootstrap',headers=student).json()['submissions']==[]
    assert client.get('/api/v1/assignments/go-task-1',headers=student).status_code==403
    assert client.get('/api/v1/submissions/demo-submission-1',headers=student).status_code==403
    client.patch('/api/v1/admin/employees/demo-reviewer/roles',json={'role':'reviewer','courseIds':[]},headers=admin)
    assert client.get('/api/v1/reviews/demo-review-1/workspace',headers=reviewer).status_code==403
    client.patch('/api/v1/admin/employees/demo-coordinator/roles',json={'role':'coordinator','courseIds':[]},headers=admin)
    assert client.get('/api/v1/coordinator/workload',headers=coordinator).json()==[]
    assert client.post('/api/v1/coordinator/submissions/demo-submission-1/assign',json={'reviewerId':'demo-reviewer-2'},headers=coordinator).status_code==403
    assert client.post('/api/v1/coordinator/assignments/rebalance',json={'preview':True},headers=coordinator).json()['assignments']==[]


def test_ingest_job_disabled_model_keeps_manual_review_available(client,monkeypatch):
    import app.main as api
    from app.jobs import run_job
    from app.models import Job, Submission
    from app.services import pipeline
    async def fake_ingest(*args,**kwargs):
        return {'public':True,'head_sha':'a'*40,'artifacts':[{'id':'ingested-file','path':'main.go','parse_status':'parsed','public':True,'media_type':'text/plain','segments':[{'id':'segment-1','path':'main.go','anchor':{'path':'main.go','start':'line:1','end':'line:1'},'text':'package main'}]}]}
    monkeypatch.setattr(api,'dispatch',lambda job_id: None)
    monkeypatch.setattr(pipeline,'ingest_github_pr',fake_ingest)
    monkeypatch.setenv('ALLOW_PUBLIC_LLM','false')
    student=headers(client,'student'); request_headers={**student,'Idempotency-Key':'new-pr-job'}
    request_body={'assignmentId':'go-task-1','prUrl':'https://github.com/ai-talent-hub-avito/homework_examples/pull/2','publicData':True}
    response=client.post('/api/v1/submissions/github',json=request_body,headers=request_headers)
    assert response.status_code==202,response.text
    assert client.post('/api/v1/submissions/github',json=request_body,headers=request_headers).json()==response.json()
    run_job(response.json()['jobId'])
    with SessionLocal() as db:
        job=db.get(Job,response.json()['jobId']); review=db.get(Review,response.json()['reviewId']); submission=db.get(Submission,response.json()['submissionId'])
        assert job.status=='completed'
        assert review.status=='configuration_error' and submission.artifacts
        assert review.draft_score is None
        assert all(c['suggested_score'] is None and not c['confirmed'] for c in review.criterion_results)
    assert client.patch('/api/v1/reviews/'+response.json()['reviewId']+'/criteria/go1-c1',json={'finalScore':1,'confirmed':True},headers=headers(client,'admin')).status_code==200


def test_late_penalty_frozen_after_confirmation(client):
    auth=headers(client); admin=headers(client,'admin')
    client.patch('/api/v1/assignments/go-task-1',json={'dueAt':'2020-01-01T00:00:00Z'},headers=admin)
    client.post('/api/v1/assignments/go-task-1/late-policy',json={'enabled':True,'type':'fixed','value':2,'intervalDays':10000},headers=admin)
    confirm_scores(client,auth)
    composed=client.post('/api/v1/reviews/demo-review-1/feedback/compose',json={},headers=auth).json()
    assert composed['latePenalty']==2 and composed['scoreBeforePenalty']==10
    confirmed=client.post('/api/v1/reviews/demo-review-1/confirm',json={},headers={**auth,'Idempotency-Key':'late-final'}).json()
    assert confirmed['finalScore']==8
    client.post('/api/v1/assignments/go-task-1/late-policy',json={'enabled':False,'type':'fixed','value':0,'intervalDays':1},headers=admin)
    snapshot=client.get('/api/v1/reviews/demo-review-1/workspace',headers=auth).json()['review']
    assert snapshot['finalScore']==8 and snapshot['latePenalty']==2


def test_failed_ingest_reports_safe_actionable_error(client,monkeypatch):
    import app.main as api
    from app.jobs import run_job
    from app.models import Job, Submission
    from app.services import pipeline
    async def failed_ingest(*args,**kwargs):
        raise pipeline.PipelineError('github_pr_changed_during_ingest')
    monkeypatch.setattr(api,'dispatch',lambda job_id: None)
    monkeypatch.setattr(pipeline,'ingest_github_pr',failed_ingest)
    auth=headers(client,'student')
    response=client.post('/api/v1/submissions/github',json={'assignmentId':'go-task-1','prUrl':'https://github.com/org/repo/pull/2'},headers={**auth,'Idempotency-Key':'failing-pr-job'})
    assert response.status_code==202,response.text
    run_job(response.json()['jobId'])
    with SessionLocal() as db:
        job=db.get(Job,response.json()['jobId'])
        submission=db.get(Submission,response.json()['submissionId'])
        assert job.status=='failed'
        assert 'PR изменился' in job.error and submission.error==job.error
        assert 'PipelineError' not in job.error


def gemini_profile(client, auth, **changes):
    profile={'name':'Gemma 4 31B · Google AI Studio','provider':'gemini','group':'balanced','baseUrl':'https://generativelanguage.googleapis.com/v1beta','modelName':'gemma-4-31b-it','apiKeyEnv':'GEMINI_API_KEY','enabled':True}
    response=client.post('/api/v1/admin/models',json={**profile,**changes},headers=auth)
    assert response.status_code==201,response.text
    return response.json()


def test_gemini_capabilities_roundtrip_preserves_policy_and_secret_reference(client,monkeypatch):
    from app.models import ModelEndpoint
    monkeypatch.setenv('GEMINI_API_KEY','test-google-key-that-must-not-leak')
    auth=headers(client,'admin')
    model=gemini_profile(client,auth,capabilities={'jsonMode':False,'jsonSchema':False,'zeroRetention':True,'maxContextTokens':128000})
    assert model['secretPresent'] is True
    assert model['apiKeyEnv']=='GEMINI_API_KEY'
    assert model['capabilities']['jsonMode'] is False
    with SessionLocal() as db:
        row=db.get(ModelEndpoint,model['id'])
        row.capabilities={**row.capabilities,'temperature':False,'auth_required':True}
        db.commit()
    patched=client.patch('/api/v1/admin/models/'+model['id'],json={'capabilities':{'maxContextTokens':64000}},headers=auth)
    assert patched.status_code==200,patched.text
    assert patched.json()['capabilities']=={'jsonMode':False,'jsonSchema':False,'zeroRetention':True,'maxContextTokens':64000}
    with SessionLocal() as db:
        row=db.get(ModelEndpoint,model['id'])
        assert row.capabilities['temperature'] is False
        assert row.capabilities['auth_required'] is True
        assert row.capabilities['json_mode'] is False
        assert row.capabilities['zero_retention'] is True
        assert 'test-google-key-that-must-not-leak' not in str(row.capabilities)
    listing=client.get('/api/v1/admin/models',headers=auth)
    assert 'test-google-key-that-must-not-leak' not in listing.text
    listed=next(item for item in listing.json() if item['id']==model['id'])
    assert listed['capabilities']['jsonMode'] is False
    assert gemini_profile(client,auth)['capabilities']['jsonMode'] is False
    compatible=gemini_profile(client,auth,provider='openai_compatible',modelName='general-model',baseUrl='http://localhost:1234/v1')
    assert compatible['capabilities']['jsonMode'] is True


def test_gemini_probe_checks_selected_model_without_generation(client,monkeypatch):
    import httpx
    from app.models import ModelEndpoint
    token='test-google-probe-secret'
    monkeypatch.setenv('GEMINI_API_KEY',token)
    monkeypatch.setenv('ALLOW_PUBLIC_LLM','true')
    requests=[]
    async def handler(request):
        requests.append(request)
        return httpx.Response(200,json={'name':'models/gemma-4-31b-it','supportedGenerationMethods':['generateContent','countTokens']})
    original_client=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original_client(transport=httpx.MockTransport(handler),**kwargs))
    auth=headers(client,'admin')
    model=gemini_profile(client,auth,modelName='models/gemma-4-31b-it')
    result=client.post('/api/v1/admin/models/'+model['id']+'/probe',headers=auth)
    assert result.status_code==200 and result.json()['health']=='ok',result.text
    assert len(requests)==1
    request=requests[0]
    assert request.method=='GET'
    assert str(request.url)=='https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it'
    assert request.headers['x-goog-api-key']==token
    assert 'Authorization' not in request.headers and not request.content
    assert token not in result.text
    with SessionLocal() as db:
        assert db.get(ModelEndpoint,model['id']).health=='ok'
        event=db.scalar(select(AuditEvent).where(AuditEvent.entity_id==model['id'],AuditEvent.action=='model_endpoint.probed'))
        assert event.payload_safe=={'health':'ok'}
        assert token not in str(event.payload_safe)


@pytest.mark.parametrize('metadata,health',[
    ({'supportedGenerationMethods':['embedContent']},'unsupported'),
    ({'supportedGenerationMethods':'generateContent'},'unsupported'),
    ({'name':'models/gemma-4-31b-it'},'ok'),
    (['not-a-model-object'],'invalid_response'),
])
def test_gemini_probe_validates_model_capabilities(client,monkeypatch,metadata,health):
    import httpx
    monkeypatch.setenv('GEMINI_API_KEY','safe-test-key')
    monkeypatch.setenv('ALLOW_PUBLIC_LLM','true')
    original_client=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original_client(transport=httpx.MockTransport(lambda request:httpx.Response(200,json=metadata)),**kwargs))
    auth=headers(client,'admin'); model=gemini_profile(client,auth)
    result=client.post('/api/v1/admin/models/'+model['id']+'/probe',headers=auth)
    assert result.status_code==200 and result.json()['health']==health


def test_gemini_probe_missing_credentials_policy_and_safe_errors(client,monkeypatch):
    import httpx
    from app.config import settings
    token='do-not-return-this-test-secret'
    monkeypatch.delenv('GEMINI_API_KEY',raising=False)
    auth=headers(client,'admin'); model=gemini_profile(client,auth)
    original_client=httpx.AsyncClient
    calls=[]
    def handler(request):
        calls.append(request)
        raise httpx.ConnectError('provider network error containing '+token,request=request)
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original_client(transport=httpx.MockTransport(handler),**kwargs))
    missing=client.post('/api/v1/admin/models/'+model['id']+'/probe',headers=auth)
    assert missing.json()['health']=='missing' and missing.json()['secretPresent'] is False
    assert calls==[]
    monkeypatch.setenv('GEMINI_API_KEY',token)
    monkeypatch.setenv('ALLOW_PUBLIC_LLM','true')
    monkeypatch.setattr(settings,'app_env','pilot_sensitive')
    blocked=client.post('/api/v1/admin/models/'+model['id']+'/probe',headers=auth)
    assert blocked.json()['health']=='blocked' and calls==[]
    monkeypatch.setattr(settings,'app_env','dev_demo')
    unavailable=client.post('/api/v1/admin/models/'+model['id']+'/probe',headers=auth)
    assert unavailable.json()['health']=='unavailable' and len(calls)==1
    assert token not in unavailable.text
    with SessionLocal() as db:
        assert all(token not in str(event.payload_safe) for event in db.scalars(select(AuditEvent)).all())


@pytest.mark.parametrize('connection_change',[
    {'provider':'openai_compatible'},
    {'baseUrl':'https://generativelanguage.googleapis.com/v1'},
    {'modelName':'gemma-other'},
    {'apiKeyEnv':'GEMINI_ALTERNATE_API_KEY'},
])
def test_model_connection_change_invalidates_previous_health(client,connection_change):
    from app.models import ModelEndpoint
    auth=headers(client,'admin'); model=gemini_profile(client,auth)
    with SessionLocal() as db:
        db.get(ModelEndpoint,model['id']).health='ok'; db.commit()
    unchanged=client.patch('/api/v1/admin/models/'+model['id'],json={'name':'Renamed model','modelName':model['modelName']},headers=auth)
    assert unchanged.status_code==200 and unchanged.json()['health']=='ok'
    changed=client.patch('/api/v1/admin/models/'+model['id'],json=connection_change,headers=auth)
    assert changed.status_code==200 and changed.json()['health']=='unknown'
    with SessionLocal() as db:
        assert db.get(ModelEndpoint,model['id']).health=='unknown'
