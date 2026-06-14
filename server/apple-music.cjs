/**
 * Apple Music developer token (JWT) generation for the web server.
 */

const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

let appleMusicToken = null;
let appleMusicTokenExpiry = 0;

function generateAppleMusicToken() {
  if (appleMusicToken && Date.now() < appleMusicTokenExpiry) {
    return appleMusicToken;
  }

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  if (!teamId || !keyId) return null;

  const projectRoot = path.join(__dirname, '..');
  const keyFiles = fs.readdirSync(projectRoot).filter((f) => f.endsWith('.p8'));
  if (keyFiles.length === 0) return null;

  const privateKey = fs.readFileSync(path.join(projectRoot, keyFiles[0]), 'utf8');

  appleMusicToken = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '180d',
    issuer: teamId,
    header: { alg: 'ES256', kid: keyId },
  });

  appleMusicTokenExpiry = Date.now() + 179 * 24 * 60 * 60 * 1000;
  return appleMusicToken;
}

module.exports = { generateAppleMusicToken };
