import { encryptMnemonic, decryptMnemonic } from '@stacks/encryption';

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
  // Legacy triplesec encrypted payloads are also supported.
  const TRIPLESEC_MAGIC = 0x1c94d7de; // first 4 bytes of every TripleSec ciphertext header
  if (bytes.readUInt32BE(0) === TRIPLESEC_MAGIC) {
    return new Promise<string>((resolve, reject) => {
      require('triplesec').decrypt(
        { key: Buffer.from(password), data: bytes },
        (err: Error | null, plaintextBytes: Buffer | null) => {
          if (!err && plaintextBytes) return resolve(plaintextBytes.toString());
          reject(err ?? new Error('TripleSec decryption failed'));
        }
      );
    });
  }
  return decryptMnemonic(bytes, password);
}
