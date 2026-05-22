/**
 * Numeric error codes returned by `pox-5.clar` (the `(err uN)` payloads).
 *
 * Each variant maps to a `(define-constant ERR_X (err uN))` in the contract.
 * Use {@link describePox5Error} to look up the on-chain name and a
 * human-readable description for a raw numeric code returned from a contract
 * call.
 */
export enum Pox5ErrorCode {
  Unauthorized = 1,
  CannotSetupBondTooSoon = 2,
  CannotSetupBondTooLate = 3,
  BondAlreadySetup = 4,
  StakerAlreadyAdded = 5,
  BondNotFound = 7,
  InsufficientStx = 8,
  AlreadyRegistered = 9,
  TooMuchSats = 10,
  NotAllowlisted = 11,
  SignerKeyGrantUsed = 12,
  InvalidSignatureRecover = 13,
  InvalidSignaturePubkey = 14,
  SignerKeyGrantNotFound = 17,
  AlreadyStaked = 19,
  InvalidNumCycles = 20,
  UnauthorizedCaller = 22,
  SignerNotFound = 23,
  InvalidStartBurnHeight = 24,
  UnauthorizedSignerRegistration = 26,
  NotStaking = 27,
  UnstakeInPreparePhase = 28,
  InvalidBondPeriodOrdering = 29,
  DistributionAlreadyComputed = 30,
  BondNotActive = 31,
  NoClaimableRewards = 32,
  ActiveBondNotIncluded = 33,
  NotBondParticipant = 34,
  CannotAnnounceL1EarlyUnlock = 35,
  InvalidOldSignerManager = 36,
  InvalidUnstakeSbtcAmount = 37,
  CannotUnstakeSbtc = 38,
  ReadTxOutOfBounds = 39,
  InvalidBtcHeader = 40,
  InvalidMerkleProof = 41,
  InvalidLockupScript = 42,
  BondAlreadyStarted = 43,
  UpdateBondSameSigner = 44,
  InvalidLockupAmount = 45,
}

/** The on-chain Clarity constant name for each error (e.g. `ERR_BOND_NOT_FOUND`). */
export const POX5_ERROR_NAMES: Record<Pox5ErrorCode, string> = {
  [Pox5ErrorCode.Unauthorized]: 'ERR_UNAUTHORIZED',
  [Pox5ErrorCode.CannotSetupBondTooSoon]: 'ERR_CANNOT_SETUP_BOND_TOO_SOON',
  [Pox5ErrorCode.CannotSetupBondTooLate]: 'ERR_CANNOT_SETUP_BOND_TOO_LATE',
  [Pox5ErrorCode.BondAlreadySetup]: 'ERR_BOND_ALREADY_SETUP',
  [Pox5ErrorCode.StakerAlreadyAdded]: 'ERR_STAKER_ALREADY_ADDED',
  [Pox5ErrorCode.BondNotFound]: 'ERR_BOND_NOT_FOUND',
  [Pox5ErrorCode.InsufficientStx]: 'ERR_INSUFFICIENT_STX',
  [Pox5ErrorCode.AlreadyRegistered]: 'ERR_ALREADY_REGISTERED',
  [Pox5ErrorCode.TooMuchSats]: 'ERR_TOO_MUCH_SATS',
  [Pox5ErrorCode.NotAllowlisted]: 'ERR_NOT_ALLOWLISTED',
  [Pox5ErrorCode.SignerKeyGrantUsed]: 'ERR_SIGNER_KEY_GRANT_USED',
  [Pox5ErrorCode.InvalidSignatureRecover]: 'ERR_INVALID_SIGNATURE_RECOVER',
  [Pox5ErrorCode.InvalidSignaturePubkey]: 'ERR_INVALID_SIGNATURE_PUBKEY',
  [Pox5ErrorCode.SignerKeyGrantNotFound]: 'ERR_SIGNER_KEY_GRANT_NOT_FOUND',
  [Pox5ErrorCode.AlreadyStaked]: 'ERR_ALREADY_STAKED',
  [Pox5ErrorCode.InvalidNumCycles]: 'ERR_INVALID_NUM_CYCLES',
  [Pox5ErrorCode.UnauthorizedCaller]: 'ERR_UNAUTHORIZED_CALLER',
  [Pox5ErrorCode.SignerNotFound]: 'ERR_SIGNER_NOT_FOUND',
  [Pox5ErrorCode.InvalidStartBurnHeight]: 'ERR_INVALID_START_BURN_HEIGHT',
  [Pox5ErrorCode.UnauthorizedSignerRegistration]: 'ERR_UNAUTHORIZED_SIGNER_REGISTRATION',
  [Pox5ErrorCode.NotStaking]: 'ERR_NOT_STAKING',
  [Pox5ErrorCode.UnstakeInPreparePhase]: 'ERR_UNSTAKE_IN_PREPARE_PHASE',
  [Pox5ErrorCode.InvalidBondPeriodOrdering]: 'ERR_INVALID_BOND_PERIOD_ORDERING',
  [Pox5ErrorCode.DistributionAlreadyComputed]: 'ERR_DISTRIBUTION_ALREADY_COMPUTED',
  [Pox5ErrorCode.BondNotActive]: 'ERR_BOND_NOT_ACTIVE',
  [Pox5ErrorCode.NoClaimableRewards]: 'ERR_NO_CLAIMABLE_REWARDS',
  [Pox5ErrorCode.ActiveBondNotIncluded]: 'ERR_ACTIVE_BOND_NOT_INCLUDED',
  [Pox5ErrorCode.NotBondParticipant]: 'ERR_NOT_BOND_PARTICIPANT',
  [Pox5ErrorCode.CannotAnnounceL1EarlyUnlock]: 'ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK',
  [Pox5ErrorCode.InvalidOldSignerManager]: 'ERR_INVALID_OLD_SIGNER_MANAGER',
  [Pox5ErrorCode.InvalidUnstakeSbtcAmount]: 'ERR_INVALID_UNSTAKE_SBTC_AMOUNT',
  [Pox5ErrorCode.CannotUnstakeSbtc]: 'ERR_CANNOT_UNSTAKE_SBTC',
  [Pox5ErrorCode.ReadTxOutOfBounds]: 'ERR_READ_TX_OUT_OF_BOUNDS',
  [Pox5ErrorCode.InvalidBtcHeader]: 'ERR_INVALID_BTC_HEADER',
  [Pox5ErrorCode.InvalidMerkleProof]: 'ERR_INVALID_MERKLE_PROOF',
  [Pox5ErrorCode.InvalidLockupScript]: 'ERR_INVALID_LOCKUP_SCRIPT',
  [Pox5ErrorCode.BondAlreadyStarted]: 'ERR_BOND_ALREADY_STARTED',
  [Pox5ErrorCode.UpdateBondSameSigner]: 'ERR_UPDATE_BOND_SAME_SIGNER',
  [Pox5ErrorCode.InvalidLockupAmount]: 'ERR_INVALID_LOCKUP_AMOUNT',
};

/** Human-readable descriptions per error code. */
export const POX5_ERROR_DESCRIPTIONS: Record<Pox5ErrorCode, string> = {
  [Pox5ErrorCode.Unauthorized]:
    'The caller is not authorized for this operation (generic authorization failure).',
  [Pox5ErrorCode.CannotSetupBondTooSoon]:
    'Bond setup attempted before the registration window opened (more than `BOND_GAP_CYCLES` reward cycles before bond start).',
  [Pox5ErrorCode.CannotSetupBondTooLate]:
    'Bond setup attempted after the registration window closed.',
  [Pox5ErrorCode.BondAlreadySetup]: 'A bond has already been set up for this bond period.',
  [Pox5ErrorCode.StakerAlreadyAdded]: 'This staker has already been added to the bond.',
  [Pox5ErrorCode.BondNotFound]: 'No bond was found for the supplied bond index.',
  [Pox5ErrorCode.InsufficientStx]: 'The caller does not have enough STX for this operation.',
  [Pox5ErrorCode.AlreadyRegistered]: 'The staker / signer is already registered.',
  [Pox5ErrorCode.TooMuchSats]: 'The supplied sats amount exceeds the allowed maximum.',
  [Pox5ErrorCode.NotAllowlisted]: 'The principal is not on the bond allowlist.',
  [Pox5ErrorCode.SignerKeyGrantUsed]: 'This signer-key grant has already been consumed.',
  [Pox5ErrorCode.InvalidSignatureRecover]:
    'Failed to recover a public key from the provided signature.',
  [Pox5ErrorCode.InvalidSignaturePubkey]:
    'The recovered public key does not match the expected signer key.',
  [Pox5ErrorCode.SignerKeyGrantNotFound]: 'No signer-key grant was found for this signer key.',
  [Pox5ErrorCode.AlreadyStaked]: 'The principal has already staked in this bond period.',
  [Pox5ErrorCode.InvalidNumCycles]: 'The requested number of cycles is outside the allowed range.',
  [Pox5ErrorCode.UnauthorizedCaller]: 'The caller is not authorized to perform this action.',
  [Pox5ErrorCode.SignerNotFound]: 'No signer was found for the supplied principal.',
  [Pox5ErrorCode.InvalidStartBurnHeight]:
    'The provided start burn height does not match the current burn block.',
  [Pox5ErrorCode.UnauthorizedSignerRegistration]:
    'The caller is not authorized to register this signer.',
  [Pox5ErrorCode.NotStaking]: 'The principal is not currently staking.',
  [Pox5ErrorCode.UnstakeInPreparePhase]: 'Unstaking is not allowed during the prepare phase.',
  [Pox5ErrorCode.InvalidBondPeriodOrdering]:
    'Bond periods were supplied in an invalid order.',
  [Pox5ErrorCode.DistributionAlreadyComputed]:
    'The reward distribution has already been computed for this period.',
  [Pox5ErrorCode.BondNotActive]: 'The bond is not currently active.',
  [Pox5ErrorCode.NoClaimableRewards]: 'There are no claimable rewards for this caller.',
  [Pox5ErrorCode.ActiveBondNotIncluded]:
    'The currently active bond was not included in the supplied list.',
  [Pox5ErrorCode.NotBondParticipant]: 'The caller is not actively in a bond.',
  [Pox5ErrorCode.CannotAnnounceL1EarlyUnlock]:
    'An early-unlock announcement was made for a bond membership that has an L2 lockup.',
  [Pox5ErrorCode.InvalidOldSignerManager]:
    "The argument provided does not match the staker's current signer.",
  [Pox5ErrorCode.InvalidUnstakeSbtcAmount]: 'The amount of sats provided to unstake is invalid.',
  [Pox5ErrorCode.CannotUnstakeSbtc]: 'The bond participant did not stake sBTC.',
  [Pox5ErrorCode.ReadTxOutOfBounds]: 'A parse error occurred when reading a Bitcoin header.',
  [Pox5ErrorCode.InvalidBtcHeader]:
    'An incorrect Bitcoin header was provided as part of a lockup proof.',
  [Pox5ErrorCode.InvalidMerkleProof]:
    'An incorrect merkle proof was provided as part of a lockup proof.',
  [Pox5ErrorCode.InvalidLockupScript]: 'The output script provided is incorrect.',
  [Pox5ErrorCode.BondAlreadyStarted]: 'A staker tried to register for a bond after it already started.',
  [Pox5ErrorCode.UpdateBondSameSigner]:
    'Cannot call `update-bond-registration` with the same signer.',
  [Pox5ErrorCode.InvalidLockupAmount]:
    'The lockup output amount does not match the specified amount of sats.',
};

/**
 * Look up a pox-5 error code.
 *
 * @param code - The raw numeric code returned in an `(err uN)` payload. Accepts
 *   either `number` or `bigint` since Clarity values often deserialize as
 *   `bigint` in the Stacks.js stack.
 * @returns The matching code/name/description triple, or `undefined` if the
 *   code is not a known pox-5 error.
 *
 * @example
 * ```ts
 * import { describePox5Error } from '@stacks/bitcoin-staking';
 *
 * const info = describePox5Error(7);
 * // => { code: 7, name: 'ERR_BOND_NOT_FOUND', description: '...' }
 * ```
 */
export function describePox5Error(
  code: number | bigint
): { code: number; name: string; description: string } | undefined {
  const n = Number(code);
  if (!(n in POX5_ERROR_DESCRIPTIONS)) return undefined;
  return {
    code: n,
    name: POX5_ERROR_NAMES[n as Pox5ErrorCode],
    description: POX5_ERROR_DESCRIPTIONS[n as Pox5ErrorCode],
  };
}
