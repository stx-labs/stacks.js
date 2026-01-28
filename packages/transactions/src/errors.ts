/**
 * Base class for transaction-related errors.
 * Provides consistent error handling and stack trace capture.
 * @internal
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
 * Thrown when serializing transaction data fails.
 * This can occur due to invalid data types, malformed transaction
 * components, or attempting to serialize incomplete transactions.
 * @example
 * ```ts
 * throw new SerializationError('Invalid clarity value type');
 * ```
 */
export class SerializationError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when deserializing transaction data fails.
 * This typically indicates corrupted or invalid transaction bytes,
 * or an attempt to deserialize malformed hex strings.
 * @example
 * ```ts
 * throw new DeserializationError('Invalid transaction bytes');
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
 * and it cannot provide an estimate yet.
 * @see https://docs.hiro.so/api#tag/Fees/operation/post_fee_transaction
 */
export class NoEstimateAvailableError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a feature or functionality is not yet implemented.
 * Used to indicate planned but incomplete features in the library.
 */
export class NotImplementedError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when transaction signing fails.
 * This can occur due to invalid private keys, unsupported key formats,
 * or cryptographic operation failures.
 * @example
 * ```ts
 * throw new SigningError('Invalid private key format');
 * ```
 */
export class SigningError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when signature verification fails.
 * This indicates that a signature does not match the expected
 * public key or message digest.
 * @example
 * ```ts
 * throw new VerificationError('Signature verification failed');
 * ```
 */
export class VerificationError extends TransactionError {
  constructor(message: string) {
    super(message);
  }
}

