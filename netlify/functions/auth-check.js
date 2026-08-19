const crypto = require('crypto');

function verifySession(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';

  const match = cookieHeader.match(/(?:^|;\s*)crm_session=([^;]+)/);

  if (!match) {
    return null;
  }

  const token = match[1];
  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );

    if (!payload.username || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  verifySession
};
