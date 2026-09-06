import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!existsSync('.env') || !existsSync('backend/.venv/bin/python')) {
  console.error('Сначала выполните npm run setup.');
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = code;
}
function start(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0);
  });
}
start(path.join(root, 'backend/.venv/bin/python'), [
  '-m',
  'uvicorn',
  'app.main:app',
  '--app-dir',
  'backend',
  '--host',
  '127.0.0.1',
  '--port',
  '8000',
]);
start(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1']);
console.log(
  '\nИнтерфейс: http://127.0.0.1:5173\nAPI: http://127.0.0.1:8000/docs\nОстановка обоих процессов: Ctrl+C\n',
);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
