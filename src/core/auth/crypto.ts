import crypto from 'node:crypto';

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, generatedSalt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({
        hash: derivedKey.toString('hex'),
        salt: generatedSalt,
      });
    });
  });
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return new Promise((resolve) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return resolve(false);
      const hashBuffer = Buffer.from(hash, 'hex');
      if (hashBuffer.length !== derivedKey.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(hashBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

export function generateToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}
