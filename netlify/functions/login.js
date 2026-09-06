const { checkPassword, signSession, sessionCookieHeader, SESSION_TTL_SECONDS } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'use POST' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) };
  }

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (username.toLowerCase() !== (process.env.ADMIN_USERNAME || '').toLowerCase() || !checkPassword(password)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Invalid username or password' })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(signSession(username), SESSION_TTL_SECONDS)
    },
    body: JSON.stringify({ ok: true })
  };
};
