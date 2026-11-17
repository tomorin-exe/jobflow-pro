import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function startNode(args, options = {}) {
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: 'inherit', ...options });
  const done = new Promise((resolve, reject) => { child.once('error', () => reject(new Error('Could not start test process.'))); child.once('close', (code, signal) => resolve({ code, signal })); });
  // Readiness may fail before the caller awaits done; avoid unhandled rejection.
  void done.catch(() => {});
  return { child, done };
}
export async function stopNode(process) {
  if (process.child.exitCode !== null || process.child.signalCode !== null) { await process.done; return; }
  process.child.kill('SIGTERM');
  const exited = await Promise.race([process.done.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)]);
  if (!exited) { process.child.kill('SIGKILL'); await process.done; }
}
export async function runNode(args, env, signal) {
  signal?.throwIfAborted();
  const process = startNode(args, { env });
  const abort = () => { void stopNode(process); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await process.done;
    signal?.throwIfAborted();
    if (result.code !== 0) throw new Error(`Test subprocess failed (exit ${result.code ?? result.signal}).`);
  } finally { signal?.removeEventListener('abort', abort); await stopNode(process); }
}
