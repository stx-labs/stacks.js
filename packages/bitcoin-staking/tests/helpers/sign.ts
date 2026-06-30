/**
 * Sign an unsigned `StacksTransactionWire` produced by the SDK's `build*`
 * helpers. The SDK intentionally returns *unsigned* txs (it only knows the
 * caller's public key, never the private key); actions sign them here before
 * broadcasting. Mirrors what `@stacks/transactions`' `makeContractCall` does
 * internally with `TransactionSigner.signOrigin`.
 */
import { TransactionSigner, type StacksTransactionWire } from '@stacks/transactions';

/** Sign an unsigned single-sig tx in place with `privateKey`. */
export function signTransaction(
  tx: StacksTransactionWire,
  privateKey: string
): StacksTransactionWire {
  const signer = new TransactionSigner(tx);
  signer.signOrigin(privateKey);
  return tx;
}

/**
 * Sign an unsigned **multisig** (P2SH / P2SHNonSequential) tx in place. For an
 * M-of-N, sign with the M `signerKeys`, then `appendOrigin` the remaining N-M
 * public keys so the spending condition carries every key. Order matters only
 * for the legacy sequential hashmode; the non-sequential one (this package's
 * default) is order-independent. Mirrors the `signOrigin … appendOrigin`
 * sequence in `@stacks/transactions` (see `builder.test.ts` "make a multi-sig").
 */
export function signMultiSigTransaction(
  tx: StacksTransactionWire,
  signerKeys: string[],
  appendPublicKeys: string[] = []
): StacksTransactionWire {
  const signer = new TransactionSigner(tx);
  for (const key of signerKeys) signer.signOrigin(key);
  for (const publicKey of appendPublicKeys) signer.appendOrigin(publicKey);
  return tx;
}
