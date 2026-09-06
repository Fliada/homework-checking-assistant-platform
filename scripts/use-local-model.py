"""Apply the LM Studio profile to .env and the existing default model registry entry."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from dotenv import dotenv_values, set_key
profile = dotenv_values(ROOT / '.env')
values = {
    'LLM_PROVIDER': 'lm_studio',
    'LM_STUDIO_BASE_URL': profile.get('LM_STUDIO_BASE_URL') or 'http://127.0.0.1:8002/v1',
    'LM_STUDIO_MODEL': profile.get('LM_STUDIO_MODEL') or 'openai/gpt-oss-20b',
}
for key, value in values.items():
    set_key(ROOT / '.env', key, value)
from app.db import SessionLocal
from app.models import ModelEndpoint, AuditEvent
with SessionLocal() as db:
    model = db.get(ModelEndpoint, 'openai-default')
    if model:
        model.name = 'GPT OSS 20B · LM Studio'
        model.provider = 'lm_studio'
        model.base_url = values['LM_STUDIO_BASE_URL']
        model.model_name = values['LM_STUDIO_MODEL']
        model.api_key_env = 'LM_STUDIO_API_KEY'
        model.default_params = {**model.default_params, 'timeout_seconds': 180, 'max_retries': 1}
        model.capabilities = {**model.capabilities, 'json_schema': False, 'json_mode': False}
        model.health = 'unknown'
        db.add(AuditEvent(action='model.local_profile', entity_type='model', entity_id=model.id,
                          payload_safe={'provider': model.provider, 'model': model.model_name}))
        db.commit()
print('LM Studio:', values['LM_STUDIO_BASE_URL'], '·', values['LM_STUDIO_MODEL'])
