/**
 * Verifies that an incoming webhook actually came from Follow Up Boss.
 *
 * Per FUB's documented method:
 *   1. Base64-encode the raw (non-prettified) JSON payload.
 *   2. HMAC-SHA256 that base64 string using your FUB "System Key".
 *   3. Compare the result to the `FUB-Signature` header.
 *
 * IMPORTANT: The "System Key" is NOT the personal API key you use for
 * normal API calls (the one starting with fka_...). It's a separate value
 * tied to registering as a "system" with Follow Up Boss - ask your FUB
 * contact (or FUB support) whether your account needs this for webhooks,
 * and if so, get that key and set it as FUB_SYSTEM_KEY in your environment.
 *
 * If FUB_SYSTEM_KEY isn't set, this module logs a warning and skips
 * verification rather than blocking everything - better to know sync is
 * running unverified than to silently drop every lead. Fix this before
 * relying on the system for real leads.
 */

const crypto = require('crypto');

function verifyFubSignature(rawBody, signatureHeader) {
  const systemKey = process.env.FUB_SYSTEM_KEY;

  if (!systemKey) {
    console.warn(
      '[SECURITY WARNING] FUB_SYSTEM_KEY is not set - webhook signature is NOT being verified. ' +
      'Anyone who discovers this URL could send fake events. Set FUB_SYSTEM_KEY as soon as you have it.'
    );
    return true; // allow through, but loudly
  }

  if (!signatureHeader) {
    return false;
  }

  const base64Payload = Buffer.from(rawBody, 'utf8').toString('base64');
  const expected = crypto
    .createHmac('sha256', systemKey)
    .update(base64Payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch {
    // Length mismatch or invalid hex - definitely not a match
    return false;
  }
}

module.exports = { verifyFubSignature };
