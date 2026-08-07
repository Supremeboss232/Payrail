import * as crypto from 'crypto';

/**
 * Encrypts a JSON credentials object using AES-256-GCM.
 * Returns format: "iv_hex:auth_tag_hex:encrypted_hex"
 */
export function encryptCredentials(data: object, masterKey: string): string {
  const jsonStr = JSON.stringify(data);
  const iv = crypto.randomBytes(12); // standard 12-byte IV for GCM
  
  // Create a 32-byte key from the masterKey (using SHA-256 hash)
  const key = crypto.createHash('sha256').update(masterKey).digest();

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a credentials string (iv_hex:auth_tag_hex:encrypted_hex) back into a JSON object.
 */
export function decryptCredentials(encryptedStr: string, masterKey: string): any {
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credentials format. Must have 3 parts separated by colons.');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = Buffer.from(parts[2], 'hex');

  const key = crypto.createHash('sha256').update(masterKey).digest();

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText as any, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}
