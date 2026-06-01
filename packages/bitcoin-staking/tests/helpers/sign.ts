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
