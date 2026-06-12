// BEFORE (don't replace but add new functions that abstract/combine this flow)

// input: bondIndex, poxInfo
const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
const unlockBytes = buildUnlockScript(userA.publicKey);
const lockupArgs = {
  stxAddress: userA.address,
  unlockHeight,
  unlockBytes,
  earlyUnlockBytes: EARLY_UNLOCK_BYTES,
};
const lockupAddress = buildLockAddress({ ...lockupArgs, network: "devnet" }); // bcrt (regtest)

const btcTxid = await sendToAddress(lockupAddress, Number(MAX_SATS) / 1e8);

const proof = await waitForFulfilled(() => getBtcTxProofInputs(btcTxid));

const output = buildLockProofFromBlock({
  txHex: proof.txHex,
  header: proof.header,
  blockHeight: proof.blockHeight,
  txids: proof.txids,
  expectedScript: buildLockOutputScript(lockupArgs),
});

const regA = await buildRegisterForBond({
  bondIndex,
  signerManager,
  amountUstx,
  lockup: { kind: "btc", outputs: [output], unlockBytes },
  publicKey: userA.publicKey,
  fee: FEE,
  nonce: await getNextNonce(userA.address),
  network,
});

///////

// TARGET

// new fn input: bondIndex, poxInfo, users bitcoinPublicKey (for unlocking), users stxAddress, earlyUnlockBytes, network

const smth = buildRegisterMetadata({ ...input });
// smth {
//   lockAddress: // btc address to send to
//   lockScript: // created intermediate anyway so might as well expose, needed in output building
//   output: //
//   unlockBytes: //
//   unlockScript: // is this needed or do we always just use script as bytes?
//   unlockHeight: // even if not needed after might as well expose since we derived in between
// }

const btcTxid = await sendToAddress(smth.lockAddress, Number(MAX_SATS) / 1e8);

// todo: build mempool compatible helper to get proof, or do we have this already?

const proof = await waitForFulfilled(() => getBtcTxProofInputs(btcTxid)); // or mempool style or rpc whatever, find common shape/interface that can match both maybe

const output = buildRegisterOutput({
  ...proof,
  ...smth, // use only for { .lockScript } to compute the ""expectedScript: buildLockOutputScript(lockupArgs),""

  // expectedScript: buildLockOutputScript(lockupArgs), // skip this and do in new other fn as well
});

const regA = await buildRegisterForBond({
  bondIndex,
  signerManager,
  amountUstx,
  lockup: { kind: "btc", outputs: [output], unlockBytes },
  publicKey: userA.publicKey,
  fee: FEE,
  nonce: await getNextNonce(userA.address),
  network,
});
