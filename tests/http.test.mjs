import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
test('HTTP authentication, role boundaries, bad credentials and malformed input', async () => {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: '4186',
      HOST: '127.0.0.1',
      DEMO_MODE: 'true',
      DB_PATH: ':memory:'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Server startup timeout')), 10000);
      child.stdout.on('data', b => {
        if (b.toString().includes('ready:')) {
          clearTimeout(timer);
          res();
        }
      });
      child.once('error', rej);
      child.once('exit', code => {
        clearTimeout(timer);
        rej(new Error('Server exited ' + code));
      });
    });
    const request = (path, options = {}) => fetch('http://127.0.0.1:4186/api' + path, options);
    assert.equal((await request('/orders')).status, 401);
    assert.equal((await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: '770000001',
        password: 'wrong'
      })
    })).status, 401);
    const response = await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: '770000001',
        password: 'DawaDemo2026!'
      })
    });
    assert.equal(response.status, 200);
    const {
      token
    } = await response.json();
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    assert.equal((await request('/admin/captains', {
      headers
    })).status, 403);
    assert.equal((await request('/orders', {
      method: 'POST',
      headers,
      body: '{bad'
    })).status, 400);
    assert.equal((await request('/auth/logout', {
      method: 'POST',
      headers
    })).status, 200);
    assert.equal((await request('/orders', {
      headers
    })).status, 401);
  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) resolve();else child.once('exit', resolve);
    });
  }
});
