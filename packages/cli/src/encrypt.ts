// @ts-ignore
import { Buffer } from '@stacks/common';
import * as blockstack from 'blockstack';

export function encryptBackupPhrase(plaintextBuffer: string, password: string): Promise<Buffer> {
  return blockstack.encryptMnemonic(plaintextBuffer, password);
}

export function decryptBackupPhrase(
  dataBuffer: string | Buffer,
  password: string
): Promise<string> {
  return blockstack.decryptMnemonic(dataBuffer, password);
}
