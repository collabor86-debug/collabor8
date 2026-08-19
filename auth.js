const crypto = require('crypto');

function createToken(username) {
  const payload = {
    username,
    role: 'admin',
    exp: Date.now() + (8 * 60 * 60 * 1000) // 8 hours
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://colabor8.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const username = String(body.username || '');
    const password = String(body.password || '');

    if (!username || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Username and password are required'
        })
      };
    }

    if (
      username !== process.env.CRM_USERNAME ||
      password !== process.env.CRM_PASSWORD
    ) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'Invalid username or password'
        })
      };
    }

    const token = createToken(username);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Set-Cookie': [
          `crm_session=${token}`,
          'HttpOnly',
          'Secure',
          'SameSite=Strict',
          'Path=/',
          'Max-Age=28800'
        ].join('; ')
      },
      body: JSON.stringify({
        ok: true,
        username,
        role: 'admin'
      })
    };

  } catch (error) {
    console.error('Authentication error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error'
      })
    };
  }
};
