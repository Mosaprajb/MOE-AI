import { pbkdf2Sync, randomBytes } from 'node:crypto';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const passcode = Buffer.concat(chunks).toString('utf8').trim();
if (!/^\d{6}$/.test(passcode)) {
  console.error('Passcode must contain exactly 6 digits.');
  process.exitCode = 1;
} else {
  const iterations = 210_000;
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(passcode, salt, iterations, 32, 'sha256');
  const base64url = (value) => Buffer.from(value).toString('base64url');
  process.stdout.write(`pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(digest)}`);
}
