import {
  type ClarityValue,
  type ContractCallPayload,
  ClarityType,
  cvToString,
} from '@stacks/transactions';
import {
  buildAnnounceL1EarlyExit,
  buildClaimStakerRewardsForSigner,
  buildGrantSignerKey,
  buildRegisterForBond,
  buildRevokeSignerGrant,
  buildSetupBond,
  buildStakeUpdate,
  buildUnstake,
  buildUnstakeSbtc,
  buildUpdateBondRegistration,
} from '../src/build';
import * as pkg from '../src';

const TEST_PUBKEY = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const STAKER = 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE';
const SIGNER_MANAGER = 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.my-signer';

const COMMON_TX = {
  publicKey: TEST_PUBKEY,
  fee: 1000n,
  nonce: 0n,
  network: 'mainnet' as const,
};

/** Grab the contract-call payload from a built tx. */
function payloadOf(tx: { payload: unknown }): ContractCallPayload {
  return tx.payload as ContractCallPayload;
}

/** Return the tuple's value object (or fail loudly). */
function asTuple(cv: ClarityValue): Record<string, ClarityValue> {
  if (cv.type !== ClarityType.Tuple) throw new Error(`expected Tuple, got ${cv.type}`);
  return (cv as { value: Record<string, ClarityValue> }).value;
}

describe('buildSetupBond', () => {
  it('emits an allowlist where each entry has staker / max-sats and includes early-unlock-admin', async () => {
    const tx = await buildSetupBond({
      bondIndex: 1,
      targetRateBps: 400,
      stxValueRatio: 1000n,
      minUstxRatioBps: 500,
      earlyUnlockBytes: new Uint8Array([0x00]),
      earlyUnlockAdmin: STAKER,
      allowlist: [
        { staker: STAKER, maxSats: 100000n },
        { staker: STAKER, maxSats: 200000n },
      ],
      ...COMMON_TX,
    });

    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('setup-bond');
    expect(payload.functionArgs).toHaveLength(7);

    // early-unlock-admin is the 6th arg (index 5).
    const earlyUnlockAdmin = payload.functionArgs[5];
    expect(earlyUnlockAdmin.type).toBe(ClarityType.PrincipalStandard);

    // The 7th arg (index 6) is the allowlist list-CV.
    const allowlist = payload.functionArgs[6];
    expect(allowlist.type).toBe(ClarityType.List);

    const entries = (allowlist as { value: ClarityValue[] }).value;
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const fields = asTuple(entry);
      expect(fields['staker']).toBeDefined();
      expect(fields['max-sats']).toBeDefined();
      expect(fields['max-sats'].type).toBe(ClarityType.UInt);
      expect(fields['max-ustx']).toBeUndefined();
    }
  });
});

describe('buildRegisterForBond', () => {
  it('encodes a BTC lockup as (ok ...) with kebab-case output tuples carrying all 8 fields', async () => {
    const tx = await buildRegisterForBond({
      bondIndex: 1,
      signerManager: SIGNER_MANAGER,
      amountUstx: 1_000_000n,
      lockup: {
        kind: 'btc',
        outputs: [
          {
            height: 12345,
            tx: new Uint8Array([0xaa, 0xbb]),
            outputIndex: 0,
            header: new Uint8Array(80),
            leafHashes: [new Uint8Array(32), new Uint8Array(32).fill(0xff)],
            txCount: 100,
            txIndex: 7,
            amount: 50000n,
          },
        ],
        unlockBytes: new Uint8Array([0xde, 0xad]),
      },
      ...COMMON_TX,
    });

    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('register-for-bond');
    expect(payload.functionArgs).toHaveLength(5);

    // 4th arg is the lockup response.
    const lockup = payload.functionArgs[3];
    expect(lockup.type).toBe(ClarityType.ResponseOk);

    const okInner = (lockup as { value: ClarityValue }).value;
    const okTuple = asTuple(okInner);
    expect(okTuple['outputs']).toBeDefined();
    expect(okTuple['unlock-bytes']).toBeDefined();

    const outputs = (okTuple['outputs'] as { value: ClarityValue[] }).value;
    expect(outputs).toHaveLength(1);
    const first = asTuple(outputs[0]);
    for (const key of [
      'height',
      'tx',
      'output-index',
      'header',
      'leaf-hashes',
      'tx-count',
      'tx-index',
      'amount',
    ]) {
      expect(first[key]).toBeDefined();
    }
  });

  it('encodes an sBTC lockup as (err uint sbtcSats)', async () => {
    const tx = await buildRegisterForBond({
      bondIndex: 1,
      signerManager: SIGNER_MANAGER,
      amountUstx: 1_000_000n,
      lockup: { kind: 'sbtc', sbtcSats: 42_000n },
      ...COMMON_TX,
    });

    const payload = payloadOf(tx);
    const lockup = payload.functionArgs[3];
    expect(lockup.type).toBe(ClarityType.ResponseErr);
    expect(cvToString(lockup)).toBe('(err u42000)');
  });
});

describe('buildStakeUpdate', () => {
  it('has 5 args and oldSignerManager is the 2nd', async () => {
    const tx = await buildStakeUpdate({
      signerManager: SIGNER_MANAGER,
      oldSignerManager: SIGNER_MANAGER,
      cyclesToExtend: 1,
      amountIncrease: 0n,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('stake-update');
    expect(payload.functionArgs).toHaveLength(5);
    expect(payload.functionArgs[1].type).toBe(ClarityType.PrincipalContract);
  });
});

describe('buildUnstake', () => {
  it('takes the old signer manager as its single arg', async () => {
    const tx = await buildUnstake({ oldSignerManager: SIGNER_MANAGER, ...COMMON_TX });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('unstake');
    expect(payload.functionArgs).toHaveLength(1);
    expect(payload.functionArgs[0].type).toBe(ClarityType.PrincipalContract);
  });
});

describe('buildUpdateBondRegistration', () => {
  it('emits update-bond-registration with 3 args', async () => {
    const tx = await buildUpdateBondRegistration({
      signerManager: SIGNER_MANAGER,
      oldSignerManager: SIGNER_MANAGER,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('update-bond-registration');
    expect(payload.functionArgs).toHaveLength(3);
  });
});

describe('buildAnnounceL1EarlyExit', () => {
  it('emits announce-l1-early-exit with 2 args', async () => {
    const tx = await buildAnnounceL1EarlyExit({
      staker: STAKER,
      oldSignerManager: SIGNER_MANAGER,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('announce-l1-early-exit');
    expect(payload.functionArgs).toHaveLength(2);
  });
});

describe('buildUnstakeSbtc', () => {
  it('emits unstake-sbtc with 2 args', async () => {
    const tx = await buildUnstakeSbtc({
      signerManager: SIGNER_MANAGER,
      amountToWithdrawSats: 12345n,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('unstake-sbtc');
    expect(payload.functionArgs).toHaveLength(2);
    expect(payload.functionArgs[1].type).toBe(ClarityType.UInt);
  });
});

describe('buildGrantSignerKey', () => {
  it('emits grant-signer-key with 4 args in (signer-key, signer-manager, auth-id, signer-sig) order', async () => {
    const signerKey = new Uint8Array(33).fill(0xaa);
    const signerSignature = new Uint8Array(65).fill(0xbb);
    const tx = await buildGrantSignerKey({
      signerKey,
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      signerSignature,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('grant-signer-key');
    expect(payload.functionArgs).toHaveLength(4);
    expect(payload.functionArgs[0].type).toBe(ClarityType.Buffer);
    expect(payload.functionArgs[1].type).toBe(ClarityType.PrincipalContract);
    expect(payload.functionArgs[2].type).toBe(ClarityType.UInt);
    expect(payload.functionArgs[3].type).toBe(ClarityType.Buffer);
  });
});

describe('buildRevokeSignerGrant', () => {
  it('emits revoke-signer-grant with 2 args (signer-manager, signer-key)', async () => {
    const signerKey = new Uint8Array(33).fill(0xaa);
    const tx = await buildRevokeSignerGrant({
      signerKey,
      signerManager: SIGNER_MANAGER,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('revoke-signer-grant');
    expect(payload.functionArgs).toHaveLength(2);
    expect(payload.functionArgs[0].type).toBe(ClarityType.PrincipalContract);
    expect(payload.functionArgs[1].type).toBe(ClarityType.Buffer);
  });
});

describe('buildClaimStakerRewardsForSigner', () => {
  it('emits claim-staker-rewards-for-signer with 3 args (staker, is-bond, index)', async () => {
    const tx = await buildClaimStakerRewardsForSigner({
      staker: STAKER,
      isBond: true,
      index: 2,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionName.content).toBe('claim-staker-rewards-for-signer');
    expect(payload.functionArgs).toHaveLength(3);
    expect(payload.functionArgs[0].type).toBe(ClarityType.PrincipalStandard);
    expect(payload.functionArgs[1].type).toBe(ClarityType.BoolTrue);
    expect(payload.functionArgs[2].type).toBe(ClarityType.UInt);
  });

  it('encodes isBond false as BoolFalse', async () => {
    const tx = await buildClaimStakerRewardsForSigner({
      staker: STAKER,
      isBond: false,
      index: 0,
      ...COMMON_TX,
    });
    const payload = payloadOf(tx);
    expect(payload.functionArgs[1].type).toBe(ClarityType.BoolFalse);
  });
});

describe('package exports', () => {
  it('re-exports buildGrantSignerKey and buildRevokeSignerGrant', () => {
    expect((pkg as Record<string, unknown>).buildGrantSignerKey).toBe(buildGrantSignerKey);
    expect((pkg as Record<string, unknown>).buildRevokeSignerGrant).toBe(buildRevokeSignerGrant);
  });

  it('re-exports buildClaimStakerRewardsForSigner', () => {
    expect((pkg as Record<string, unknown>).buildClaimStakerRewardsForSigner).toBe(
      buildClaimStakerRewardsForSigner
    );
  });
});
