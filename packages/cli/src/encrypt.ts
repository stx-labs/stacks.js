import { encryptMnemonic, decryptMnemonic } from '@stacks/encryption';
import * as triplesec from 'triplesec';

export async function encryptBackupPhrase(
  plaintextBuffer: string,
  password: string
): Promise<Buffer> {
  return Buffer.from(await encryptMnemonic(plaintextBuffer, password));
}

export async function decryptBackupPhrase(
  dataBuffer: string | Buffer,
  password: string
): Promise<string> {
  const bytes = typeof dataBuffer === 'string' ? Buffer.from(dataBuffer, 'hex') : dataBuffer;
  // TripleSec backups predate the current mnemonic encryption format.
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x1c94d7de) {
    return new Promise((resolve, reject) => {
      triplesec.decrypt({ data: bytes, key: Buffer.from(password) }, (error, plaintext) => {
        if (error || !plaintext) reject(error ?? new Error('TripleSec decryption failed'));
        else resolve(plaintext.toString());
      });
    });
  }
  return decryptMnemonic(dataBuffer, password);
}
