import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
mkdirSync('.work', { recursive: true });
const python = process.env.PYTHON || 'python3';
const venvPython = path.join(root, 'backend/.venv/bin/python');
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, PIP_CACHE_DIR: path.join(root, '.work/pip-cache') },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(venvPython)) run(python, ['-m', 'venv', 'backend/.venv']);
run(venvPython, ['-m', 'pip', 'install', '-r', 'backend/requirements.txt']);
if (!existsSync('.env')) {
  const content = readFileSync('.env.example', 'utf8')
    .replace(
      'JWT_SECRET=replace-with-at-least-32-random-characters',
      `JWT_SECRET=${randomBytes(40).toString('hex')}`,
    )
    .replace(
      'OWNER_PASSWORD=replace-with-a-strong-owner-password',
      `OWNER_PASSWORD=${randomBytes(24).toString('base64url')}`,
    )
    .replace(
      'POSTGRES_PASSWORD=replace-with-a-strong-database-password',
      `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
    )
    .replace('APP_DEBUG=false', 'APP_DEBUG=true')
    .replace('SEED_DEMO=false', 'SEED_DEMO=true');
  writeFileSync('.env', content, { mode: 0o600, flag: 'wx' });
  console.log(
    'Создан локальный .env с уникальными секретами. Debug-аккаунты включены только для разработки.',
  );
} else console.log('Используется существующий .env без изменений.');
console.log('Готово. Запуск API и интерфейса: npm run dev');
