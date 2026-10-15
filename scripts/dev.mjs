/**
 * RoadPulse dev launcher — runs the API and the web client together.
 * Dependency-free and cross-platform (Windows / macOS / Linux).
 *
 *   npm run dev
 *
 * Prefix each line of output so it is obvious which service logged it.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const SERVICES = [
  { name: 'api', cwd: join(root, '..', 'backend'), script: 'start', color: '\x1b[36m' },
  { name: 'web', cwd: join(root, '..', 'frontend'), script: 'dev', color: '\x1b[35m' },
];

const RESET = '\x1b[0m';
const children = [];

for (const svc of SERVICES) {
  const child = spawn('npm', ['run', svc.script], {
    cwd: svc.cwd,
    shell: true,
    env: process.env,
  });
  children.push(child);

  const tag = `${svc.color}[${svc.name}]${RESET} `;
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) process.stdout.write(tag + line + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited with code ${code}\n`);
  });
}

const shutdown = () => {
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
