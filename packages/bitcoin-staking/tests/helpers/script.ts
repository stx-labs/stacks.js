import * as btc from '@scure/btc-signer';
import { hexToBytes } from '@stacks/common';

/**
 * Validate that `unlockBytes` matches the default format (`<pubkey> OP_CHECKSIG`).
 *
 * Returns the extracted compressed public key if valid, or `undefined` if the
 * script doesn't match the default shape.
 *
 * Test-only inverse of the SDK's `buildUnlockScript` — deliberately not part
 * of the public API.
 */
export function parseUnlockScript(unlockBytes: Uint8Array | string): Uint8Array | undefined {
  const bytes = typeof unlockBytes === 'string' ? hexToBytes(unlockBytes) : unlockBytes;

  try {
    const decoded = btc.Script.decode(bytes);

    if (
      decoded.length === 2 &&
      decoded[0] instanceof Uint8Array &&
      decoded[0].length === 33 &&
      (decoded[0][0] === 0x02 || decoded[0][0] === 0x03) &&
      decoded[1] === 'CHECKSIG'
    ) {
      return decoded[0];
    }
  } catch {
    // malformed script
  }
  return undefined;
}
