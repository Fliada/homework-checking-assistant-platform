import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT.parent / '.env')

class Settings:
    app_env = os.getenv('APP_ENV', 'dev_demo')
    debug = os.getenv('APP_DEBUG', os.getenv('DEBUG', 'false')).lower() == 'true' and app_env == 'dev_demo'
    database_url = os.getenv('DATABASE_URL', f'sqlite:///{ROOT / "reviewer.db"}')
    jwt_secret = os.getenv('JWT_SECRET', '')
    job_mode = os.getenv('JOB_MODE', 'local')
    redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
    owner_email = os.getenv('OWNER_EMAIL', '')
    owner_password = os.getenv('OWNER_PASSWORD', '')
    seed_demo = os.getenv('SEED_DEMO', 'false').lower() == 'true' and app_env == 'dev_demo'
    cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    artifact_root = Path(os.getenv('ARTIFACT_ROOT', str(ROOT / 'artifacts')))

settings = Settings()
