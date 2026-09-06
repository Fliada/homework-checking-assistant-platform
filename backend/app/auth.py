import hashlib
import hmac
import secrets
from datetime import timedelta
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from .models import RefreshSession, User, now

ROLES = {'student', 'reviewer', 'coordinator', 'expert', 'moderator', 'admin', 'owner', 'pending'}
ADMIN = {'admin', 'owner'}
bearer = HTTPBearer(auto_error=False)

def fail(status, code, message):
    raise HTTPException(status, detail={'code': code, 'message': message})

def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return f'scrypt${salt.hex()}${digest.hex()}'

def check_password(password, encoded):
    try:
        _, salt, expected = encoded.split('$')
        return hmac.compare_digest(hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex(), expected)
    except (ValueError, TypeError):
        return False

def issue_tokens(db, user):
    stamp = now()
    session_id = secrets.token_hex(32)
    db.add(RefreshSession(id=hashlib.sha256(session_id.encode()).hexdigest(), user_id=user.id, expires_at=stamp + timedelta(days=14)))
    claims = {'sub': user.id, 'iat': stamp, 'iss': 'avito-reviewer'}
    return {'accessToken': jwt.encode({**claims, 'type': 'access', 'exp': stamp + timedelta(minutes=30)}, settings.jwt_secret, algorithm='HS256'),
            'refreshToken': jwt.encode({**claims, 'type': 'refresh', 'jti': session_id, 'exp': stamp + timedelta(days=14)}, settings.jwt_secret, algorithm='HS256')}

def decode_token(token, kind):
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=['HS256'], issuer='avito-reviewer')
        if claims.get('type') != kind:
            raise ValueError()
        return claims
    except (jwt.PyJWTError, ValueError):
        fail(401, 'invalid_token', 'Сессия истекла. Войдите снова.')

def current_user(auth: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if auth is None:
        fail(401, 'unauthorized', 'Необходим вход в аккаунт.')
    claims = decode_token(auth.credentials, 'access')
    user = db.get(User, claims['sub'])
    if not user or not user.active:
        fail(401, 'unauthorized', 'Аккаунт недоступен.')
    return user

def require(user, roles):
    if user.role not in roles:
        fail(403, 'forbidden', 'У вашей роли нет доступа к этому действию.')
