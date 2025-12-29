import * as argon2 from 'argon2';

const ARGON2_CONFIG: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,      // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_CONFIG);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
