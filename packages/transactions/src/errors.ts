/**
 * Base error class for all transaction-related errors.
 * Provides proper stack trace capture and consistent error naming
 * across the Stacks transaction library.
 */
class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a transaction or Clarity value fails to serialize
 * into its wire format (bytes/hex representation).
 *
 * @example
 * ```ts
 * try {
 *   serializeCV(invalidValue);
 * } catch (e) {
 *   if (e instanceof SerializationError) {
 *     console.error('Failed to serialize:', e.message);
 *   }
 * }
 * ```
 */
export class SerializationError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when raw bytes or hex data cannot be deserialized into a
 * valid transaction or Clarity value. This typically indicates
 * corrupted data or an unsupported format version.
 *
 * @example
 * ```ts
 * try {
 *   deserializeCV(hexString);
 * } catch (e) {
 *   if (e instanceof DeserializationError) {
 *     console.error('Invalid data format:', e.message);
 *   }
 * }
 * ```
 */
export class DeserializationError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when `NoEstimateAvailable` is received as an error reason from a
 * Stacks node. The Stacks node has not seen this kind of contract-call before,
 * and it cannot provide an estimate yet. This is common for newly deployed
 * contracts that haven't been called before.
 * @see https://docs.hiro.so/api#tag/Fees/operation/post_fee_transaction
 */
export class NoEstimateAvailableError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when attempting to use a feature or code path that has not
 * been implemented yet. This serves as a placeholder for future
 * functionality in the transaction library.
 */
export class NotImplementedError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a transaction signing operation fails. This can occur
 * due to invalid private keys, mismatched key types, or when the
 * signer does not have authority to sign the transaction.
 */
export class SigningError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when signature verification fails. This indicates that
 * the provided signature does not match the expected signer for
 * the given transaction data.
 */
export class VerificationError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}
