# Lock Handoff Packet (LHP-1)

A proposed standard for handing a funded PoX-5 Bitcoin lock from a Bitcoin-side custodian to any Stacks-side app, and a proposal for its reference implementation in `@stacks/bitcoin-staking`.

Status: request for comments. Nothing here is implemented yet. Part 2 is the proposed normative text; Part 4 is the proposed SDK surface.

## Part 1. Why

In a Bitcoin-side-only integration a Bitcoin custodian does only the Bitcoin side. It builds a P2WSH timelock committing to the customer's Stacks address, funds it, and stops. The customer then registers that funded lock against a bond, from their own Stacks address, in some Stacks-side app. Two parties, two chains, no shared session, no shared secret.

Today the join between them is a URL into the reference app: `/enroll?mode=finish&bondIndex=&staker=&btcKey=&btcTxid=`. That URL is a landing page, and a landing page is the wrong thing to freeze in a partner agreement. Freeze it and the receiving app can never move, be renamed, be replaced by a wallet, or be run by anyone but us. Retire it and every custodian that hardcoded it breaks.

Freeze the data and the handshake instead, and let the URL, the app, and the UI be free. A custodian that has implemented LHP-1 has implemented it against the PoX-5 contract, not against one website.

Today's link has six gaps, each of which the standard closes.

| Gap | Consequence |
|---|---|
| No version field, no format discriminator | A receiver cannot tell a future format from a malformed one, and an emitter cannot signal a field the receiver must understand. |
| No network field | Devnet and mocknet share one Bitcoin address prefix, so a receiver with no side channel has to guess. |
| No unlock height | A custodian that legally builds above the bond's floor produces a lock no receiver can derive. |
| Single-key only | A multisig vault's spend condition has no channel at all and must be sent by written notice. |
| A query string | The de-anonymizing triple of principal, Bitcoin key, and funding txid reaches servers, access logs, and `Referer` headers. |
| Signer choice smuggled in an undocumented parameter | The one field a receiver must honor sits outside the link's own typed contract. |

> **For business development.** When the custodian finishes locking the Bitcoin, it hands the customer one small data packet: a QR code or a file. The packet says which bond, which Stacks address, the exact Bitcoin script that will spend the lock, and each funding output with its unlock height. Nothing else, because everything else about the lock is already public on the two chains. The customer opens that packet in whatever Stacks app they use. That app asks the PoX-5 contract itself to rebuild the Bitcoin lock address from the packet, and checks it byte for byte against the coins actually sitting there, so it knows the lock is real and was built from the customer's address without trusting whoever handed the packet over. Two things it cannot check, and shows the customer to confirm against what the custodian told them: that the Bitcoin key in the lock is the custodian's, and that the bond is the one they agreed to. The custodian's screen and the customer's app both show the same six words for the packet; if they differ, stop. The six words check the packet the custodian issued. The signer manager, reward destination, and STX amount are the customer's own choices and are confirmed separately. Then the customer signs the registration from their own Stacks address, and only they can: the contract will not accept it from anyone else. If the lock does not match the packet, the check fails and nothing happens. The custodian knows the customer finished when the pinned contract's registration event shows their address, that bond, and exactly those funding outputs, not when a web page says so. Nothing in the packet points at a particular website, so the apps and the links can change without renegotiating anything.

---

## Part 2. The standard

This part is the deliverable, written to be handed to a partner engineer as-is.

### 2.1 Roles

Two roles, in the PSBT style. They never talk, share no secret, and need no prior relationship.

**Creator.** The Bitcoin-side custodian. It preflights against the PoX-5 contract, builds and funds one P2WSH lock, emits one packet, and stops. It never signs a Stacks transaction and learns the outcome only by reading the chain.

**Finisher.** Any Stacks-side app the customer chooses. It ingests the packet, verifies every field against the contract and against Bitcoin, and drives the customer's own wallet through `register-for-bond`. It trusts nothing it can re-derive.

One party may play both roles. Nothing assumes they are separate, and nothing assumes they are the same.

### 2.2 The packet

Canonical form is one UTF-8 JSON object. The **global map** carries what the contract holds once for the whole registration. **`outputs[]`** carries what the contract reads per funded lockup, one entry per output, 1 to 10 entries.

**Governing principle: identifiers travel, values are read.** A field that *selects* which thing we mean travels in the packet. A field that is a *property of* the selected thing is read back from the chain, and may appear only as a cross-check.

| Class | Rule |
|---|---|
| **MUST** | Absence is a parse error. |
| **COMMIT** | Optional. If present, the receiver re-derives it, or compares it against its own pinned configuration, and hard-fails on mismatch. Never used as an input. The chain or the receiver's configuration wins, never the packet. **A COMMIT field detects corruption and emitter error, never tampering: an adversary who can alter the packet can also delete the field. No COMMIT field is a security control, and no claim in 2.9 rests on one.** This holds for `contract` too: deleting it changes nothing, because the receiver calls its pinned deployment either way. |
| **BIND** | Optional. If present, the receiver uses it verbatim or refuses to complete. It may not substitute a default, silently drop it, or recompute it. |
| **META** | Optional, never load-bearing. A receiver may ignore it. |

#### Global map

| Field | Type | Class | What it is, and why it travels |
|---|---|---|---|
| `lhp` | integer | **MUST** | Format magic and version in one key. Value `1` here. Presence identifies the format; the value selects the parser. |
| `protocol` | string | **MUST** | Constant `"pox-5"`. A sub-protocol discriminator, so the envelope can carry a future `"pox-6"` with no version bump. |
| `crit` | array of strings | envelope control | Optional, and outside the COMMIT/BIND/META classification: it is a processing rule about other keys, not a data class. Names the keys the emitter requires the receiver to **understand**, which means implementing and enforcing that field's semantics including any scheme it selects, not merely recognising its name. A named key the receiver does not understand is a **hard reject naming that key**. Every name in `crit` MUST be present in the packet, names MUST be unique, and in v1 they address global keys only. `crit` is covered by the 2.4a checksum, so a critical marker cannot be stripped without changing the six words. See 2.7. |
| `network` | `mainnet` \| `testnet` \| `devnet` \| `mocknet` | **MUST** | Stated, never inferred. The Stacks side is redundantly derivable from the address prefix; the Bitcoin side is not, because devnet and mocknet share the `bcrt` prefix. `testnet` alone does not distinguish testnet3, testnet4, and signet, which all share the `tb` prefix. See `btcNetwork`. |
| `btcNetwork` | `mainnet` \| `testnet3` \| `testnet4` \| `signet` \| `regtest` | COMMIT | Optional. Names the Bitcoin network exactly, which `network` cannot. **If present it MUST equal the Bitcoin network of the receiver's pinned deployment, and a mismatch is a hard reject.** It never selects the data source: selecting the chain being verified is load-bearing, so it comes from receiver configuration like `contract` does. Pinning is per deployment, not per address prefix: a test deployment can pair Stacks `testnet` with Bitcoin regtest, which no address prefix reveals. |
| `bondIndex` | uint | **MUST** | The key to everything else: the bond's early-exit script bytes, both STX ratios, the staker's sats allowance, the unlock-height floor, and the registration deadline. It appears nowhere in Bitcoin data, and when bonds share one early-exit key it is not bound by the script either. What pins it is the height floor and the open registration window (step 4.3 and 4.9), plus the mandatory display of the bond and its terms at step 5.2. At any burn height at most one bond both exists and has an open registration window, so in steady state there is no second bond to swap it for. |
| `staker` | Stacks principal (c32) | **MUST** | The customer's Staker Address. Committed inside the lock script as a double SHA-256 of its consensus serialization, and the only sender `register-for-bond` accepts. P2WSH hides the link from a funded output to a principal, but the principal itself is not secret: `setup-bond` prints every allowlisted staker and its allowance (`pox-5.clar:625-628`). Prefixes are `SP` or `SM` on mainnet, `ST` or `SN` otherwise. A contract principal is a legal staker on chain and is excluded from LHP-1 by construction, because step 5.1 requires a connected wallet and a contract is not a wallet. |
| `stakerUnlockBytes` | hex, up to 683 bytes | **MUST** | The customer's own spend condition, spliced onto the end of the lock script. The one field with no independent source: not on Stacks, not on Bitcoin, not derivable. Raw opaque bytes, never a pubkey or address shorthand, because `<pubkey> OP_CHECKSIG` is only the SDK default and m-of-n is a legal lock. The packet lets a receiver rebuild the witness script, but it can never supply the vault's signature: a custodian signing exchange, PSBT export and import, is a required companion and is out of LHP-1's scope. |
| `earlyUnlockBytesHash` | 32-byte hex | COMMIT | SHA-256 of the bond's early-exit bytes as read at build time. Not the bytes, which the receiver reads from the bond record. It makes "you built against a different bond record" a nameable error instead of an undifferentiated script mismatch. It does not bind `bondIndex` when bonds share identical early-exit bytes, and like every COMMIT field it can be deleted by a tampering sender. |
| `btcPubkey` | 33-byte hex | COMMIT | Single-key locks only. MUST satisfy `stakerUnlockBytes == 0x21 ‖ btcPubkey ‖ 0xac`. Redundant, but the retention list names the public key and today's reclaim tooling is single-key. |
| `contract` | contract principal | COMMIT | Which pox-5 deployment the packet was built against. **If present it MUST equal the receiver's pinned deployment for `network`, and a mismatch is a hard reject.** Checked against receiver configuration, not against the chain. **A receiver MUST NOT use it to select which contract to call.** A sender that picks the contract picks the definition of "correct": it deploys a contract whose `construct-lockup-output-script` returns whatever makes its lock verify, and every check in step 4 passes. The pinned deployment is receiver configuration, never packet data. |
| `signerManager` | contract principal | BIND | A required, non-optional `register-for-bond` argument, orthogonal to the Bitcoin lock and not discoverable before registration. Absent means the receiver asks the customer. |
| `signerCalldata` | hex, up to 500 bytes | BIND | The optional calldata argument to `register-for-bond`. For the reference signer-manager it encodes a Bitcoin payout address and a maximum fee. Authoritative as raw bytes, because a custom signer-manager defines its own schema. Absent means the reference signer-manager accrues rewards as sBTC on Stacks. That default belongs to that manager, not to pox-5, and changing it afterwards means moving the bond to a different signer manager. The highest-risk field in the packet: it routes money. Present without `signerManager` is a structural reject, because its meaning depends on the manager. |
| `payoutHint` | `{btcAddress, maxFeeSats}` | COMMIT | So a receiver can *display* the destination. MUST decode-equal `signerCalldata`, and `btcAddress` MUST render on the **Bitcoin network of the receiver's pinned deployment**, not on whatever `network` alone suggests. The calldata tuple carries a PoX address version, not a Bitcoin network (`signer.ts:124`), so a mainnet payout address would otherwise decode-equal a testnet hint. Never used to build calldata. |
| `amountUstx` | decimal **string** | META | A **suggestion**, never an instruction. The receiver always computes the floor itself, and MUST obtain explicit customer approval for any amount above it. Never taken verbatim. It was BIND in an earlier draft, which made it the cheapest field in the packet to weaponise: an attacker needs no key, no contract, and no Bitcoin to raise it to the victim's whole balance, and `pox-5.clar:751` checks only that the balance covers it. A string because microSTX exceeds 2^53. |
| `issued` | `{by, ref, at}` | META | Operator correlation. Never affects verification. |
| `ext` | object | META | Vendor namespace, `ext.<vendor>.<key>`. Guaranteed never to collide with a future core field. |
| `attestation` | object | reserved, absent in v1 | Reserved for a SIP-018 signature over a Clarity tuple, never over the JSON. See 2.9. |

#### `outputs[]`, 1 to 10 entries, MUST

Ten is the contract's hard cap.

| Field | Type | Class | What it is, and why it travels |
|---|---|---|---|
| `unlockHeight` | uint | **MUST** | The CLTV height actually used in this output's script. The decisive field, and the one today's link has no slot for. The contract bounds it only from below, per output: at least `get-bond-l1-unlock-height(bondIndex)` and below the Bitcoin locktime threshold. A custodian may legally build above the floor, and then no receiver can derive the address without being told. It also sidesteps a silent trap: a bond's advertised cycle-end height and the script's CLTV height differ by half a reward cycle, and the wrong one derives a valid-looking wrong address with no error. |
| `txid` | 32-byte hex, display order | **MUST** | An identifier, so it travels. Recoverable in principle by scanning the derived address, but that scan is a heuristic a dust payment can pollute, and it cannot express a multi-output lock. Custodians retain it already, so emitter cost is zero. |
| `vout` | uint | **MUST** | Completes the outpoint. The contract enforces outpoint uniqueness across the list. |
| `sats` | uint | COMMIT | A value, not an identifier: the receiver reads it from the output it was handed, and the contract asserts the two are equal. Were it required, it would be a second source of truth. Present, it must equal the output value; absent, the receiver simply uses the value it read. |
| `lockScript` | hex | COMMIT | The full witness script **for this output**. Lets a receiver diff its reconstruction before touching Bitcoin, and the reclaim tooling needs it verbatim at exit. Per output, not global: the height is inside the script, so two outputs at two heights have two different scripts. Recomputed, never trusted. |
| `lockAddress` | bech32 P2WSH | COMMIT | Human-checkable and explorer-checkable, for this output. Per output for the same reason. Recomputed, never trusted. |
| `blockHeight` | uint | META | A proof-assembly hint. The receiver fetches header and merkle proof itself, and the contract verifies both. |

#### Deliberately not fields

- The bond's early-exit bytes, both STX ratios, the allowance, the minimum unlock height, the required STX, the deadline, the first reward cycle, and the unlock cycle. All derivable from `bondIndex` (plus `staker` for the allowance). Carrying any of them invites a receiver to trust a stale copy of a safety-critical number. The deadline in particular must be recomputed, because registration reverts once the bond has started and during the prepare phase.
- UI state such as `step`, `edit`, `mode`, or a signer preselection. Emitters MUST NOT emit them; receivers MUST ignore them. A packet carrying no navigation state needs no deep-link clamp.
- A landing URL, host, or path. Permanently outside the spec. This is the point of the exercise.
- A signature, in v1. See 2.9.

### 2.3 Required set, in one line

`lhp`, `protocol`, `network`, `bondIndex`, `staker`, `stakerUnlockBytes`, and `outputs[]` with `unlockHeight`, `txid`, and `vout` per entry. Six global scalar fields, one required `outputs` array, and three required fields per output. Seven required top-level keys.

### 2.4 Encoding and carriers

The canonical string is `base64url(utf8(JSON))`, unpadded. Nothing in v1 signs the JSON, and the 2.4a checksum hashes a derived field string rather than the document, so no canonical-JSON form is required and none is specified.

All carriers are equal, and none is part of the frozen standard.

| Carrier | Form | Notes |
|---|---|---|
| URL fragment | `https://<any-app>/enroll#lhp=<b64url>` | A fragment, **never** a query string. Fragments are not sent to the server, never land in access or proxy logs, and never leak through `Referer`. A mechanism, not an exhortation. |
| QR code | The same base64url string | Base64url is not in QR alphanumeric mode's charset, so it always encodes in byte mode. See the capacity table below. |
| File | `.lhp.json`, `application/json`, raw JSON | Also what the receiver hands back to the customer to keep. |
| API body | Raw JSON | For custodian-to-app integrations. |
| Paste | Raw JSON or the base64url string | Every conformant receiver **MUST** offer a manual ingest form, pre-filled from whatever parsed. It is the fallback when every other carrier fails. |

Receivers **MUST** accept padded base64url as well as unpadded. Emitters emit unpadded; many encoders pad, and rejecting padding turns a cosmetic difference into a failed handoff.

**QR capacity.** All figures below assume **one byte-mode segment**. Byte mode at error-correction level L tops out at 2,953 characters at version 40, which is the physical ceiling on this carrier; at level M it is 2,331.

| Payload | JSON bytes | base64url chars | QR at ECC L |
|---|---|---|---|
| Minimal packet | 327 | 436 | version 14, 73x73 |
| Populated example without `lockScript` | 735 | 980 | version 22, 105x105 |
| Populated example as in 2.8 | 987 | 1,316 | version 26, 121x121 |
| Required fields only, one output, 683-byte subscript | 1,623 | 2,164 | fits at L, and at M |
| Required fields only, ten outputs, 35-byte subscript | 1,290 | 1,720 | fits at L, and at M |
| Required fields only, ten outputs and a 683-byte subscript | 2,586 | 3,448 | exceeds the ceiling at any level |

`ext` and future optional fields are unbounded, so there is **no finite maximum packet size**; the last row is a measured fixture, not a maximum. Use error-correction level M, not L, and above roughly 1,200 characters use the file or paste carrier instead. That is a legibility recommendation and is separate from physical capacity. Camera comfort does not follow from character count alone, so publish tested QR vectors rather than asserting a limit.

Never a query string, never a server log, never an analytics pipeline, never cleartext email.

**What fragment-only buys, stated narrowly.** A fragment is not sent in the HTTP request, so it does not land in access, proxy, or `Referer` logs. That is a transport property and nothing more. Page scripts on the receiving origin can read the fragment. Online verification discloses the staker and the spend bytes to whichever Stacks and Bitcoin providers the receiver uses. A conformant receiver **MUST** keep packet fields out of analytics, error reporting, and session-replay telemetry.

### 2.4a Packet checksum, six words

The v1 packet is unsigned, so the only control against a substituted field is that a human compares the packet against the custodian's own record. Asking that human to compare a 33-byte hex public key, or a SHA-256 fingerprint, against a different company's screen is asking for a check nobody performs. Six words is a check people do perform.

**Definition.**

```
words = bip39_english[ chunks of 11 bits from the first 66 bits of sha256(canonical) ]
```

`canonical` is the UTF-8 encoding of an ASCII string, the following values joined with `|`:

1. `lhp`, in decimal, so `1` for this version.
2. `protocol`.
3. `network`.
4. `bondIndex`, in decimal.
5. `staker`, the c32 string normalised to uppercase. Some decoders accept lowercase, and two receivers that disagree here show different words for one packet.
6. `sha256(stakerUnlockBytes)`, lowercase hex, over the raw bytes and not over the hex text.
7. Then, for each entry of `outputs[]` sorted **ascending** by `(txid, vout)`, bytewise on the lowercase hex `txid` and then numerically on `vout`: `txid` in lowercase hex, `vout` in decimal, `unlockHeight` in decimal. Duplicate outpoints are rejected before hashing, so no tie rule is needed.
8. Then `signerManager`, **literally as written in the packet**, or the empty string when absent. Only `staker` is normalised.
9. Then `sha256(signerCalldata)`, lowercase hex over the raw bytes, or the empty string when absent. Present-but-empty calldata hashes the empty byte sequence and therefore differs from absence.
10. Then `crit`, its entries sorted bytewise ascending and joined with `,`, or the empty string when absent or empty. Duplicate names are rejected before hashing. This is what stops a critical marker being stripped without changing the words.

Six words carry 66 bits.

**Parsing rules the derivation depends on.** Take the digest bits MSB-first, read six consecutive unsigned 11-bit values, and index the wordlist zero-based. There is no BIP-39 mnemonic checksum step. Hex fields carry no `0x` prefix, no whitespace, and no mixed case beyond what the rules above fix; malformed hex is rejected before decoding. Integers are parsed losslessly and rendered as decimal digits with no sign, no exponent, and no redundant leading zeros. `null` is rejected wherever a value is expected, and duplicate JSON keys are rejected. The derived string carries no byte-order mark, no inserted spaces, and no trailing newline. No value that can legally contribute today contains `|` or `,`, so no escaping is defined; any future contributing identifier MUST exclude both separators and all control characters, or the format MUST move to length prefixing first.

**Obligations.** The creator **MUST** display the six words next to the lock record in its own authenticated interface, the one the customer already logs into. The receiver **MUST** display them at step 5.2 and **MUST** instruct the customer to compare them against that record. **A mismatch is a stop, not a warning.**

The receiver computes the words over **the packet as received**, before any election it makes with the customer. A a Bitcoin-side-only integration packet carries no `signerManager`, no `signerCalldata`, and no `crit`, so all three elements are empty in its canonical string, and they stay empty even after the customer picks a manager in the app. Receiver-side elections are not packet substitutions and the checksum does not cover them: what covers them is the display at 5.2.

**What it is and is not.** The checksum covers every substitution in 2.9 at once, rather than one field at a time: change the staker, the spend condition, any outpoint, any height, the signer manager, the calldata, or the set of critical keys, and the words change. It is display, not authentication. An attacker who controls the packet also controls the words in it; what the attacker cannot control is the custodian's own authenticated screen. That is the whole of the control, and it is worth having because it is the difference between a comparison that happens and one that does not.

### 2.5 The handshake

**Step 0. Preflight (creator, before broadcasting).** Recompute the expected output script by calling the contract's own `construct-lockup-output-script` against a Stacks node. Confirm the early-exit bytes were read from the target bond after its setup. Confirm each chosen unlock height is at least `get-bond-l1-unlock-height(bondIndex)` and below `u500000000`. **Decode `stakerUnlockBytes` as Bitcoin script and refuse to fund if it does not decode.** The creator MUST reject an empty subscript, MUST reject unbalanced `OP_IF`, `OP_NOTIF`, `OP_ELSE`, and `OP_ENDIF`, and SHOULD reject a subscript that does not end in a signature-checking opcode. This is the one control that exists, because the contract only hashes these bytes: an undecodable subscript derives a valid address, funds normally, and registers successfully, and the Bitcoin is then unspendable in both branches. No attacker is needed. A custodian bug produces it. Confirm with `get-bond-allowance` that the staker is allowlisted and the sats fit: allowlists are immutable once a bond is set up, and this is the one unrecoverable failure. Confirm the STX minimum with `min-ustx-for-sats-amount`. Confirm at most 10 outputs and 100,000 serialized transaction bytes. The 14-sibling merkle cap cannot be preflighted, because the including block does not exist yet; it moves to step 4.10. Confirm there is time to register before the **effective close height**, which is the bond start height minus the prepare-cycle length, not the bond start height itself. Every one of these is an individual read-only call: the creator does **not** need to know which signer-manager the customer will choose, and MUST NOT be required to pick one in order to preflight.

**Step 1. Emit (creator).** After broadcasting, emit one packet with one `outputs[]` entry per funded lock output, **each carrying the height actually used, never the bond minimum by assumption**. Omit `signerManager` and `signerCalldata` unless genuinely electing them, and omit `amountUstx` unless there is a reason to suggest a number the receiver will not compute; a custodian that operates no signer-manager and routes no rewards omits all three. Persist the packet alongside the lock record, and display its six words (2.4a) next to it. **The creator's enrollment role ends here. Its custody signing obligations continue**, because only the custodian can sign the Bitcoin spend at maturity or at early exit.

**Step 2. Transport.** Per 2.4. The creator chooses a carrier; the standard does not.

**Step 3. Structural validation (finisher, no network).** In this order, hard-failing at each:

1. Decode. Require a JSON object with an integer `lhp`.
2. `lhp != 1` is a **hard reject**: "this packet needs a newer app", naming the version. Never partial-parse.
3. `protocol != "pox-5"` is a reject as a different sub-protocol, a distinct message from a version rejection.
4. `network` MUST equal the receiver's active network: for a fixed-network app its build-time network, for a wallet or multi-network app the network selected at the moment of validation. Never coerce, never offer to switch. A multi-network receiver MUST re-assert this equality at step 5.1 together with the connected-wallet check, and MUST abort if the active network changed after step 3.
5. Shapes. `bondIndex` is a non-negative integer. `network` is one of the registered values. `staker` passes the c32 checksum **and** its prefix matches `network`. `stakerUnlockBytes` is non-empty, even-length hex of at most 683 bytes, **and decodes as Bitcoin script with balanced `OP_IF`, `OP_NOTIF`, `OP_ELSE`, and `OP_ENDIF`**. The receiver cannot rescue the Bitcoin at this point, but it MUST refuse to lock the customer's STX against a lock nothing can ever spend. If present, `signerCalldata` is even-length hex of at most 500 bytes and `signerManager` is a syntactically valid contract principal whose address prefix matches `network`. **`signerCalldata` present without `signerManager` is a structural reject**, because nothing defines its schema. `outputs` has 1 to 10 entries, each with a 32-byte hex `txid`, a non-negative integer `vout`, and `unlockHeight > 0`. The zero bound is not a routine sanity check: height 0 encodes as `OP_0`, whose empty push the shared `OP_VERIFY` reads as false, so the timelock branch would never be spendable (`script.ts:315-322`). The contract would accept it.
6. `crit`, if present, is an array of strings, each naming a key that is actually present in the packet, with no duplicates and no per-output or `ext.` paths in v1. A malformed `crit` is a structural reject. Every key it names that the receiver does not **understand**, meaning implement and enforce that field's semantics including whichever scheme it selects, is a **hard reject naming that key**. Recognising the name is not understanding it.
7. Unknown global or per-output keys not named in `crit`: **ignore, and preserve verbatim on any re-emit.**

**Step 4. Chain verification (finisher, zero trust in the sender).** Every check below MUST pass before any signature is offered. Running the cheap reads first is an implementation note, not a rule.

1. `get-protocol-bond(bondIndex)`. A `none` is a reject. Take the early-exit bytes and both ratios **from this record**.
2. If `earlyUnlockBytesHash` is present, it MUST equal the SHA-256 of the chain's early-exit bytes for `bondIndex`; a mismatch is reported as **bond mismatch**, "built against a different bond record", and is a hard fail. Chain wins. This binds `bondIndex` only when bonds carry distinct early-exit bytes. Where one co-signer key is reused across bonds the bytes are identical, and `bondIndex` is then pinned only by the height floor at 4.3, the open window at 4.9, and the display at 5.2. Bond records are written once by `map-insert` and have no update path, so the only reachable cause of a mismatch is a different bond, or an emitter bug.
3. Let `minH = get-bond-l1-unlock-height(bondIndex)`. For **every** output require `unlockHeight >= minH` and `unlockHeight < 500000000`. **The height bounds are an independent gate. A matching scriptPubKey does not imply the lockup can be registered, and both MUST pass before any signature is offered.** Skipping the height check is the subtle disaster: a scriptPubKey can match perfectly while `register-for-bond` reverts on an invalid unlock height, stranding real Bitcoin in a P2WSH that can never be registered. Which check runs first is an implementation note, not a rule: run the cheap ones first if you like.
4. For each distinct `unlockHeight`, compute the expected scriptPubKey by calling **the contract's own read-only function**, `construct-lockup-output-script(staker, unlockHeight, stakerUnlockBytes, earlyUnlockBytes-from-chain)`. *That call is the normative definition of "correct."* A local SDK reimplementation is a permitted pre-check, never the definition. Delegating to the pinned contract is what makes an arbitrary receiver correct **for its supported deployments**, and structurally immune to the push-encoding and half-reward-cycle traps. It updates one derived value and nothing else, so it is not automatic correctness across a fork: see 2.7.
5. For each output, fetch the raw funding transaction, take `vout`, and require its `scriptPubKey` to equal the expected value. If `sats` was supplied, require the output value to equal it.
6. Recompute every other COMMIT field present (`outputs[].lockScript`, `outputs[].lockAddress`, `btcPubkey`, `payoutHint`) and hard-fail on any mismatch. `payoutHint.btcAddress` MUST also render on the packet's `network`. If `contract` is present it MUST equal the receiver's pinned deployment for `network`, and the receiver calls its own pinned deployment either way.
7. `get-bond-allowance(bondIndex, staker)` MUST exist, and the sum of verified output values MUST fit within it. These are two failures with opposite recoverability and MUST be reported as two categories. **Not allowlisted** (`ERR_NOT_ALLOWLISTED`, `pox-5.clar:698`) is final: allowlists are immutable once the bond is set up, so the enrollment was never possible, and no retry helps. **Over allowance** (`ERR_TOO_MUCH_SATS`, `pox-5.clar:744`) is recoverable: name the allowance in sats, and offer a subset of the outputs that fits, or a different lock. A subset is a **derived registration plan**, never a quiet edit of the creator's packet. The receiver MUST retain and keep displaying the original packet and its six words, MUST name the omitted outputs and say that they cannot be topped up into this membership later, MUST obtain the customer's separate approval of the plan, and MUST bind the completion check at 2.6 to the plan's outputs rather than the packet's.
8. `floor = min-ustx-for-sats-amount(sum of values, stxValueRatio, minUstxRatio)`, computed once over the **summed** sats. The nested integer truncation runs downward at each step (`pox-5.clar:3094`), so summing per-output minima can *underestimate* the required STX: with a value ratio of 1 and a minimum ratio of 10000, two 50-sat outputs each floor to 0 while their 100-sat total floors to 1. Use `floor`. `amountUstx`, if present, is a suggestion and is never used verbatim: any amount above `floor` requires explicit customer approval at 5.2. Check the staker's locked plus unlocked balance covers whatever amount is used.
9. The registration window is open, which is four separate conditions.
   - Burn height is **below the effective close height**, which is the bond start height minus the prepare-cycle length. The final prepare phase closes registration for that bond for good and it never reopens (`pox-5.clar:2945-2960`, blocked at `:711`). An earlier prepare phase is a temporary pause; this one is terminal.
   - Not currently in a prepare phase.
   - **No overlapping** membership or stake. A rollover from a non-overlapping bond is allowed (`pox-5.clar:764-778`), so an existing membership is not by itself a failure.
   - If the staker holds an existing bond membership, `burn-block-height` MUST be at or above `get-bond-l1-unlock-height` for **that** bond. This is the rollover window (`pox-5.clar:3009-3021`, called at `:780`). It runs from the old bond's L1 unlock height up to the new bond's effective close height, so for an immediate rollover it is ordinarily about half a reward cycle minus the prepare-cycle length. The helper itself sets no upper bound; the close height does.
10. Each funding transaction is confirmed, and the merkle proof for its including block needs at most 14 siblings. The receiver assembles the header and merkle proof itself. Neither cap can be preflighted, because the including block does not exist at step 0.
11. **Signer gates.** `get-signer-info(signerManager)` MUST return `some`, and `verify-signer-key-grant` MUST succeed for that key (`pox-5.clar:754-762`). The receiver SHOULD also simulate the manager's `validate-stake!` read-only where the manager exposes one. **Where the manager was the receiver's own election with the customer, these failures are recoverable by choosing a different manager and MUST be reported that way**, never as a dead enrollment. Where the packet supplied `signerManager`, honor-or-refuse applies: the receiver refuses and the custodian issues a new packet. It MUST NOT substitute a manager of its own. A receiver **MUST** maintain a curated list of recognised signer managers per network; any manager not on that list goes through the unrecognised-manager warning path at 5.2. Signer registration is permissionless, so the manager principal carries no protocol-level trust of its own.
12. **Each outpoint is unspent.** Neither this handshake nor `validate-l1-lockup` gets this from the contract: the contract checks construction, amount, uniqueness within the call, header, and inclusion, and never whether the output still exists (`pox-5.clar:2057-2105`). A spent output passes every other check. The receiver MUST verify each outpoint unspent immediately before signing. This is inherently racy, an off-chain read cannot bind the future, and a receiver MUST state its policy for an outpoint spent only in the mempool.

*Mismatch reporting.* Report the *category*: **unlock height out of range**, **script mismatch**, **amount mismatch**, **not allowlisted**, **over allowance**, **window closed**, **bond mismatch**, **signer not eligible**, or **output spent**. Every category except script mismatch may be named, because each rests on a public read and naming it leaks nothing a prober could not fetch directly.

A **script mismatch** stays undifferentiated: never report which of `staker` or `stakerUnlockBytes` is wrong. The reason is that the spend condition has no public source, so a differentiated verdict would let a partially known packet be probed field by field. It is not that P2WSH hides the principal, which it does not: the allowlist print at setup publishes every staker on the bond. Note also what the rule does not deliver. Reaching any category *after* the script check tells a prober that the script matched, so the guessed triple was right. The rule hides which field is wrong, not that everything before it was correct. That residue is unexploitable in practice, because guessing a 33-byte key is infeasible, but it is not the property a reader would assume.

*Honor-or-refuse.* If `signerManager` or `signerCalldata` is present, the receiver uses it exactly or refuses to complete. `amountUstx` is not in this set: it is a suggestion, and the receiver computes the floor itself. If `signerManager` is absent, the receiver asks the customer. **A receiver MUST offer the payout election even when `signerCalldata` is absent.** Under the reference signer-manager, a receiver that silently omits the calldata registers every L1 lock to accrue sBTC on Stacks, which is precisely what a Bitcoin-only custodian does not want. Correcting it afterwards means one `update-bond-registration` call to a different signer manager, and the rewards already paid out are gone.

**Step 5. Complete (finisher).**

1. **The connected wallet's principal MUST equal `staker` before any signature is offered.** Not at parse time, because a customer may legitimately open a packet before connecting, but this gate MUST close before the wallet is asked to sign anything. This is where "an attacker registers in a third party's name" dies. It does not cover the inverse case, where the customer is induced to register a lock someone else controls; see 2.9 and the display rule below.
2. **Display before signing, with no pre-selection:** the **six words of 2.4a, first, with an instruction to compare them against the custodian's own screen and to stop on any difference**; the full `staker`; the `bondIndex` with the bond's start cycle, unlock cycle, and STX ratios; **the spend condition, as `btcPubkey` for a single-key lock or the SHA-256 fingerprint of `stakerUnlockBytes` for any other form**; every verified outpoint with its own unlock height and its distance above the bond floor; the derived lock address per output; the verified sats total; the staker's **sats allowance** on this bond; the STX that will lock, with a separate explicit approval whenever it exceeds the computed floor; the effective registration close height; the `signerManager` contract principal in full, labeled as the contract that controls reward routing; and, whenever a payout is elected, the **full decoded Bitcoin payout address and maximum fee**. Never auto-submit from a packet.

   The mandated wording for the payout is: **"this destination applies from now on. One `update-bond-registration` call moves the bond to a different signer manager with fresh calldata, and is blocked during prepare phases. Moving back is a second call. Rewards already paid to the old destination are not recoverable."** Do not tell the customer the destination is permanent. It is not (`pox-5.clar:850-853`, prepare-phase block at `:873`, different-signer assert at `:881`; the SDK builds the move as one transaction, `build.ts:331`). Whether the destination can also be edited **in place**, without changing manager, depends on the manager: the reference manager stores the election per staker and replaces it on the next validation (`signer-manager.clar:74`, `:147`, `:152`), so a later same-manager registration overwrites it. If the receiver does not recognise the `signerManager`, it cannot know that the calldata follows the reference schema, so it MUST NOT proceed on a decoded-looking display. The bytes may well decode; that is not the point, because a custom manager is free to reuse the same shape for something else. It MUST either refuse to complete, or display the `signerManager` principal and the raw calldata hex under an unambiguous warning ("this app cannot read where your Bitcoin rewards will be sent; do not continue unless you obtained this packet directly from your custodian") and require a separately confirmed acknowledgement. `payoutHint` MUST NOT be shown as the destination when the calldata could not be decoded and the hint could not be checked against it.
3. Immediately before building the transaction, re-run the height check (4.3), the floor computation (4.8), the registration-window check (4.9), the signer gates (4.11), and the unspent check (4.12) against fresh chain state. Abort if the window has closed, a prepare phase has opened, the signer grant has lapsed, an outpoint has been spent, or the fresh floor now exceeds the amount the customer approved. Timing, balances, grants, and funding status all move between page load and signature. Bond ratios and early-exit bytes do not: they are inserted once and have no update path, so a changed bond term means a different chain snapshot or a different deployment, not repricing.
4. Submit from the staker's own wallet: `register-for-bond(bondIndex, signerManager, <the approved amount>, (ok {outputs, staker-unlock-bytes}), signerCalldata)`. Each entry expands to the contract's lockup tuple, with the amount set to the value read from the output and the unlock burn height set to the packet's `unlockHeight`.
5. **Hand the customer their packet back as a `.lhp.json` file, enriched with what the receiver resolved, and persist at minimum `staker`, `bondIndex`, `stakerUnlockBytes`, every outpoint with its `unlockHeight`, and the resolved `lockScript` for each output.** The enriched recovery artifact is not the creator's original packet, and a receiver MUST NOT present it as one. The reclaim tooling needs the witness script verbatim at exit, and for a lock that is funded but not registered there is no chain source for `stakerUnlockBytes` at all.

**Step 6. Read back.** There is no callback, webhook, or return URL anywhere in the stack, and the standard deliberately defines none. Every done-state is a chain read any party can perform independently and repeatedly. See 2.6.

### 2.6 Done-states

| State | Read | Condition |
|---|---|---|
| Enrolled (primary) | `get-bond-membership(staker)` | Returns `some`, the bond index equals the packet's, the lock is flagged as an L1 lock, and the sats total equals the sum of verified output values. **A current-position read, not proof this packet was enrolled**: a different output set with the same total gives an indistinguishable row. |
| Enrolled (push) | The `register-for-bond` print event, topic `"register-for-bond"` | The authoritative per-packet read, with three traps. The per-output entries carry `txid` in **internal byte order**, the reverse of the packet's display-order txid (`get-reversed-txid`, `pox-5.clar:3676`), and `output-index`, and nothing else: no per-output amount, no per-output CLTV height. The event's top-level `unlock-burn-height` is the **STX cycle-end height**, which is not a function of the packet's actual CLTV height and **MUST NOT** be compared with `outputs[].unlockHeight`. The two coincide only by accident: the gap is half a reward cycle *minus* however far the lock was built above the floor, and can be zero or negative. Match instead on the **emitting contract equalling the receiver's pinned deployment**, a **successful transaction in a canonical block**, its transaction and event identity, `staker`, `bond-index`, and the exact set of `(reverse(txid), output-index)` pairs. The event also carries `signer` and `amount-ustx` (`pox-5.clar:817-822`), so check the accepted elections too; read anything the event omits from the transaction's own arguments. |
| Ever enrolled (durable audit) | The registration transaction id, with its event and canonical block | `protocol-bond-memberships` is **not** an enrollment history. It is overwritten by `map-set` on re-registration (`pox-5.clar:786`), mutated on a signer change (`:920`), and has `amount-sats` zeroed on early exit (`:1235`), so the raw row is a **current-position** read like the getter. Durable evidence is the successful registration transaction id, its print event, and the canonical Stacks block that holds it. `get-bond-membership` additionally collapses to `none` once the bond's unlock cycle passes, and is keyed by **staker principal alone**, so a staker enrolled in a *different* bond returns a membership that does not answer this packet. |
| Early exit announced | `has-announced-l1-early-exit(bondIndex, staker)` | `true`. A distinct state; it does not by itself mean the Bitcoin was spent. |
| Terminally dead, never possible | `get-bond-allowance(bondIndex, staker)` returns `none` | Not allowlisted, and allowlists are immutable once the bond is set up. Report as final; do not offer retry. |
| Recoverable, lock too large | `get-bond-allowance(bondIndex, staker)` returns less than the verified sats total | Over allowance, `ERR_TOO_MUCH_SATS`. Not terminal: a subset of the outputs, or a different lock, may still register. |
| Terminally dead, too late | Burn height at or past the **effective close height**, the bond start height minus the prepare-cycle length | Registration closed for good when the final prepare phase opened, and it never reopens. An earlier prepare phase is a temporary pause, not this. |
| Not a done-signal | `get-bond-allowance` returning `some`; a broadcast txid; any receiver's UI | Pre-registration, unconfirmed, or unverifiable by anyone else. |

A custodian recording "the client enrolled" must key on the registration transaction and its print event, and record the canonical Stacks block it read. The raw memberships map is no better than the getter for this: both are current-position reads. The getter alone will contradict itself once the bond matures.

### 2.7 Versioning

**One integer for format breaks, one must-understand array for everything else.** Prior art does not converge: BIP-21 uses per-field required prefixes with no version number; LNURL and BIP-329 have no version at all; BIP-174 tells a parser that meets an unrecognized version to exit immediately. For a packet that moves custodied Bitcoin and locks STX for a full bond term, the PSBT rule is right for a genuine format break. A rejection is visible; a silently ignored load-bearing field is not.

But that premise argues for a must-understand list, not against one, and PSBT's real evolvability comes from its key-type namespace rather than its version integer. `crit` is that list: a receiver that meets an unknown key named in `crit` rejects loudly, naming the key, and a receiver that meets an unknown key not in `crit` ignores it safely. This is JWT `crit` and COSE critical headers, with one difference worth naming: those specifications integrity-protect their critical lists under a signature, and v1 has no signature. LHP-1 substitutes the 2.4a checksum, which covers `crit` and so makes stripping a critical marker change the six words. That is display protection, not cryptographic protection. It costs one array, and it means a future load-bearing field ships without a flag day.

**The rule, stated once.** An additive field whose omission does not change authorised behaviour never bumps `lhp`. A new field whose omission *would* change authorised behaviour is announced through `crit`, or bumps `lhp` where the change is to the format itself.

**Wire format. Frozen, and a change here means `lhp: 2`.**

1. `lhp` and its hard-reject semantics; `protocol`, with `"pox-5"` meaning this field set; `crit` and its reject-naming-the-key semantics.
2. The global and per-output split, and which side each required field lives on.
3. The required set in 2.3.
4. That `stakerUnlockBytes` and `signerCalldata` are raw opaque bytes, never shorthands, and **never rewritten** by the packet layer. Structural decoding is a different thing and is required: step 0 and step 3.5 decode `stakerUnlockBytes` as script to check it, and hand the same bytes on unchanged.
5. The three optional-field classes: COMMIT re-derives and the chain or the receiver's own configuration wins, BIND is verbatim or refuse, META is ignorable.
6. That the expected scriptPubKey is **defined as the output of the pinned contract's `construct-lockup-output-script`**, not as a client-side algorithm.
7. **The pinned deployment is receiver configuration, never packet data.** `contract` is a checked assertion against that configuration and MUST NOT select which contract is called.
8. The canonical encoding `base64url(utf8(JSON))`.
9. **Adding any field whose omission would change authorised behaviour**, unless it is announced through `crit`.
10. **The URL carrier is fragment-only.** A packet in a URL MUST travel in the fragment. Changing this is a version bump, because it changes the confidentiality property the packet was designed around, not the UI. The 2.10 downgrade link is an explicit, dated sunset exception.
11. The checksum definition in 2.4a. Change the canonical string and two conformant implementations show different words for the same packet, which is worse than showing none.

**Receiver conformance profile: LHP-1 Receiver Profile v1. Versioned separately, and a change here does NOT bump `lhp`.**

These are receiver policy, not wire format. Freezing them under the integer would mean that improving an error message requires hard-rejecting every custodian's packets, which will not happen, so the freeze would be quietly violated instead. The profile carries its own version, `LHP-1 Receiver Profile v1`. A receiver declares which profile version it implements in its own documentation and, where it has one, its capability endpoint; a packet never names a profile, and a later profile version stays wire-compatible with `lhp: 1`.

- The validation gates in 2.5 and the requirement that all of them pass before any signature is offered.
- The display rules at 5.2, including the six words, the payout wording, and the unrecognised-manager warning path.
- The error categories and the undifferentiated script-mismatch rule.
- The done-conditions in 2.6. **Note:** the print topic `"register-for-bond"` is contract-defined. It tracks the contract, not the packet, and a pox-5 upgrade could change it with no packet change at all.

**Evolvable. No version bump, no partner conversation.**

- Adding optional **COMMIT or META** fields. A v1 receiver that ignores a new COMMIT field loses a cross-check it never had; ignoring a new META field loses nothing. This is the normal growth path.
- Adding a load-bearing field, provided the emitter names it in `crit`. An old receiver rejects loudly rather than silently ignoring it, which is the property the version integer was reached for in the first place.
- Every transport and every UI: URL shapes other than the fragment-only rule frozen in item 10, hostnames, routes, QR framing, file extensions, API endpoints, screen counts, wording, the signer picker, the payout form, the receiving app's identity, and whether Stacks Labs runs one receiver, three, or none.
- The `network` and `protocol` value registries, and `ext.<vendor>` prefixes.
- The contents of `signerCalldata` as signer-managers evolve, which is exactly why the packet must not know its shape.
- The contract's script bytes across a hard fork, as long as receivers call `construct-lockup-output-script` rather than reimplementing it. This buys one derived value and no more: a fork can still move the proof ABI, the byte limits, the payout decoder, the witness finalizer, and the event shape, none of which a constructor read updates. Pin a deployment compatibility profile rather than claiming automatic correctness.
- `attestation`, **while it stays advisory.** Verify-or-ignore lowers the trust a receiver assigns and never changes what it registers, so adding it, or adding a scheme to it, does not bump `lhp`. A profile that *requires* a valid attestation is a different thing: rejecting an unattested packet changes authorised behaviour. **The requirement MUST come from the receiver's own configured policy, never from the packet**, because a packet-borne requirement is removable by whoever tampered with the packet. Such a policy rejects missing, invalid, and unsupported attestations alike. `crit` is the complement, not the substitute: it tells a receiver that this packet's attestation matters, and the checksum keeps that marker from being stripped silently.

**What the two mechanisms cost, in one sentence.** Almost nothing: `lhp` handles the genuine format break where nothing else can, `crit` handles the load-bearing addition that would otherwise force one, and between them a load-bearing field is not silently ignored, provided the emitter marks it critical and the receiver's own policy supplies any authentication requirement.

**Receiver rules for the unexpected.**

| Situation | Required behavior |
|---|---|
| `lhp` absent or not an integer | Reject: not an LHP packet. |
| `lhp == 1` | Parse. Unknown keys: ignore, preserve verbatim on re-emit. |
| `lhp` unknown (`2`, `7`, ...) | **Hard reject**, naming the version, telling the user to update. Never partial-parse. |
| A key named in `crit` that the receiver does not implement | **Hard reject, naming that key.** Never partial-parse, and never ignore it because it is otherwise unknown. |
| `protocol` unknown | Reject as a different sub-protocol, with a distinct message from a version rejection. |
| `network` mismatch | Reject. Never coerce, never offer to switch. |
| Packet arrives in a URL query string | Ingest and validate normally, then warn the customer that the packet's principal, key, and txid linkage has been written to server, proxy, and `Referer` logs and should be treated as public. MUST NOT re-emit it as a query string. MUST replace the history entry with the fragment form. |
| COMMIT field disagrees with the chain, with re-derivation, or with the receiver's pinned deployment configuration | **Hard fail.** Never prefer the packet. |
| BIND field present (`signerManager`, `signerCalldata`) | Verbatim, or refuse to complete. |
| `amountUstx` present or absent | Compute the floor either way. Use the floor unless the customer explicitly approves a higher amount. Never take the packet's number verbatim. |
| `signerCalldata` present, `signerManager` absent | Structural reject. Nothing defines the calldata's schema. |
| `contract` present and not the receiver's pinned deployment for `network` | Hard reject. Never call the packet's contract. |
| `signerCalldata` absent | No creator instruction. Obtain the customer's election and build the calldata from it. Omit the argument only when the customer elects the manager's default. |
| `signerManager` absent | Ask the customer. |
| Unknown `attestation` scheme, once v2 or later adds them | **Only when the attestation is advisory:** ignore it and degrade the trust label, since rejecting would make adding a scheme breaking. Where the receiver's own policy requires a valid attestation, an unsupported scheme is a reject like a missing one. |

**Migration, if `lhp: 2` ever happens.** Make the break clean, branch on the integer, and run a dual-emit window: custodians emit v1 and v2 side by side as two separate artifacts (two fragments, two QR codes, or two files, `name.v1.lhp.json` and `name.v2.lhp.json`) for one bond cycle, then drop v1. A single artifact never carries two envelopes: the canonical form is one JSON object with one `lhp`, and a v1 receiver rejects anything else at step 3.1. Dual emission is legal only where the older artifact preserves the newer one's security requirements. If any `crit` requirement or BIND field of the v2 artifact cannot be represented and enforced in the v1 one, emit only v2. Because the transport is unversioned, that migration touches no URL and no UI.

### 2.8 Worked example: mainnet, Bitcoin-side-only custodian, single-key

**Every value below is computed, not asserted.** The staker principal is the canonical stacks.js mainnet example address. The staker public key is `02f9308a…36f9`, the point 3·G on secp256k1 (the BIP-340 test-vector key for secret key 3), chosen because it is on-curve and so survives the SDK's validation, which an arbitrary `02`-prefixed string would not. The bond's early-exit bytes, the txid, the bond index, and the sats amount are **illustrative**: no real bond's early-exit script is claimed. The bech32 encoder used was validated against both BIP-173 test vectors.

A custodian that operates no signer-manager and routes no rewards carries **no** `signerManager`, `signerCalldata`, or `amountUstx`; the receiving app elects the first two with the customer and computes the third itself.

#### Minimal packet, required fields only, 327 bytes of JSON

```json
{"lhp":1,"protocol":"pox-5","network":"mainnet","bondIndex":1,
 "staker":"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
 "stakerUnlockBytes":"2102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
 "outputs":[{"txid":"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b","vout":0,"unlockHeight":990500}]}
```

#### The same packet as a Bitcoin-side-only custodian would emit it, with COMMIT and META added, 987 bytes when minified

`lockScript` and `lockAddress` live inside the output, not in the global map, because the unlock height is part of the script and two outputs at two heights have two different scripts and two different addresses.

```json
{
  "lhp": 1,
  "protocol": "pox-5",
  "network": "mainnet",
  "contract": "SP000000000000000000002Q6VF78.pox-5",
  "bondIndex": 1,
  "staker": "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  "stakerUnlockBytes": "2102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
  "outputs": [
    { "txid": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "vout": 0, "unlockHeight": 990500, "sats": 100000000,
      "lockScript": "6303241d0fb16782012088a8207f74bdc95f3507b1336cb9cea5ef67e6b0795a2fbc34d046653bc69c4444df87882103a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5ac68692102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
      "lockAddress": "bc1q4l0tjrfknhplz4crq6wl8n3pwyrnc7q49up8tsull54hxxe4htzszq0x0c" }
  ],
  "btcPubkey": "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "earlyUnlockBytesHash": "e5e1e2c854fc486c7f62119284167d93a92236f810b9f96c7bdc1da9a49ceafe",
  "issued": { "by": "custodian.example", "ref": "LOCK-2026-0910-0007", "at": "2026-09-10T14:02:11Z" }
}
```

#### What the receiver reconstructs

```
staker principal      SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7
to-consensus-buff?    0516a46ff88886c2ef9762d970b4d2c63678835bd39d          (0x05 ‖ ver 0x16 ‖ hash160)
H = sha256(sha256(·)) 7f74bdc95f3507b1336cb9cea5ef67e6b0795a2fbc34d046653bc69c4444df87
push-c-script-num(990500)  03 241d0f                                        (minimal LE ScriptNum)
```

```
63                                    OP_IF
  03 241d0f                             push 990500                        ← outputs[0].unlockHeight
b1 67                                 OP_CHECKLOCKTIMEVERIFY, OP_ELSE
82 0120 88 a8 20                      OP_SIZE <32> OP_EQUALVERIFY OP_SHA256 OP_PUSHBYTES_32
  7f74bdc9…4444df87                     H                                  ← derived from staker
88                                    OP_EQUALVERIFY
2103a5a5…a5ac                         <early-unlock-bytes>                 ← from the bond record, NOT the packet
68 69                                 OP_ENDIF, OP_VERIFY
2102f930…f9ac                         <staker-unlock-bytes>                ← from the packet, no other source
```

```
lockScript    6303241d0fb16782012088a8207f74bdc95f3507b1336cb9cea5ef67e6b0795a2fbc34d046653bc69c
              4444df87882103a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5ac6869
              2102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac
scriptPubKey  0020afdeb90d369dc3f15703069df3ce2171073c78152f0275c39ffd2b731b35bac5
lockAddress   bc1q4l0tjrfknhplz4crq6wl8n3pwyrnc7q49up8tsull54hxxe4htzszq0x0c
```

The early-exit preimage for this staker, needed only at exit and derived from `staker` alone, never carried:

`70fa33f065c8c274f5cf583babf0a2710681544dcf1b35704077573c638837c0`

#### The six words for this packet

The canonical string, per 2.4a. There is no `signerManager`, no `signerCalldata`, and no `crit`, so the last three elements are empty and the string ends in three bar characters:

```
1|pox-5|mainnet|1|SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7|e19dcba1a5f40b4fe87866d5c275544c26d624e3e54af613b7cb74857ca93564|4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b|0|990500|||
```

`sha256(stakerUnlockBytes)` is `e19dcba1a5f40b4fe87866d5c275544c26d624e3e54af613b7cb74857ca93564`, and `sha256(canonical)` is `7222b98c53bf2eb10a22c877c1a370a4b917ecbc785a6a0a1e637b8e44357993`. Its first 66 bits, MSB-first, give zero-based word indices 913, 174, 792, 1339, 1943, 708, which in the BIP-39 English wordlist are:

```
impulse beyond glide polar very flat
```

Both printed packets produce these same six words: the COMMIT and META fields the populated one adds are not checksum inputs.

The custodian shows those six words next to the lock record. The receiver shows them at step 5.2. If they differ, the customer stops.

#### The ordered checks against this packet

```
step 3   lhp==1 · protocol=="pox-5" · network=="mainnet"==mine
         staker c32 ok, SP prefix matches mainnet · stakerUnlockBytes 35 bytes ≤683
         outputs: 1 entry, 32-byte txid, vout 0, unlockHeight 990500 > 0
step 4.1 get-protocol-bond(1)                    → earlyUnlockBytes, stxValueRatio, minUstxRatio
step 4.2 sha256(earlyUnlockBytes) == e5e1e2c8…   → else "built against a different bond record"
step 4.3 minH = get-bond-l1-unlock-height(1);  990500 >= minH && 990500 < 500000000   ← independent gate
step 4.4 construct-lockup-output-script(staker, 990500, stakerUnlockBytes, earlyUnlockBytes_chain)
                                                 → 0020afdeb90d369dc3f15703069df3ce2171073c78152f0275c39ffd2b731b35bac5
step 4.5 esplora tx 4a5e1e4b… vout 0             → scriptPubKey == 0020afde… ✓ ; value 100000000 == sats ✓
step 4.6 btcPubkey: 0x21‖pk‖0xac == stakerUnlockBytes ✓ ; outputs[0].lockScript ✓ ; lockAddress ✓
         contract == my pinned mainnet deployment ✓  (I still call my own)
step 4.7 get-bond-allowance(1, staker)           → some, 100000000 <= allowance
step 4.8 min-ustx-for-sats-amount(100000000, …)  → floor over the SUMMED sats;  use floor
step 4.9 burn height < 966250 (effective close = bond start 966350 - prepare 100),
         not in a prepare phase, no overlapping membership, rollover window n/a
step 4.10 funding tx confirmed, merkle depth <= 14 siblings
step 4.11 get-signer-info(chosen manager) → some ; verify-signer-key-grant ✓ ; on the curated list
step 4.12 outpoint 4a5e1e4b…:0 still unspent
step 5.1 connected wallet == SP2J6Z…9EJ7         ← before any signature is offered
step 5.2 display: SIX WORDS "impulse beyond glide polar very flat" first, compare with the custodian
         screen; staker, outpoint + its height and distance above the floor, lock address,
         1.00000000 BTC, allowance, STX floor, unlock cycle, effective close height,
         and, since no signerCalldata was supplied, the receiver's own payout form with the
         "applies from now on" wording. No pre-selection, no auto-submit.
step 5.4 register-for-bond(u1, <chosen signer>, <floor>, (ok {outputs, staker-unlock-bytes}), (some <calldata>))
step 5.5 hand back an enriched packet.lhp.json; persist staker, bondIndex, stakerUnlockBytes,
         the outpoint, 990500, and that output's lockScript
step 6   registration txid + its print event, topic "register-for-bond", in a canonical block:
         staker, bond-index u1, and (reverse(4a5e1e4b…), 0)  ⇒ DONE.
         get-bond-membership is a current-position read, not proof this packet enrolled.
```

#### Transport

The minimal packet is **436** base64url characters, a version-14 QR at error-correction level L. The populated packet above is **1,316** characters, a version-26 QR, which is past the point where a file or a paste is the better carrier. See the capacity table in 2.4. A 683-byte multisig subscript reaches 2,164 characters and ten outputs reach 1,720, both still inside the physical ceiling and both well past the point where a file is the better carrier. Only the two together, at 3,448 characters, exceed what a QR code can hold.

```
https://any-stacks-app.example/enroll#lhp=eyJsaHAiOjEsInByb3RvY29sIjoicG94LTUiLCJuZXR3b3JrIjoibWFpbm5ldCIsImJvbmRJbmRleCI6MSwic3Rha2VyIjoiU1AySjZaWTQ4R1YxRVo1VjJWNVJCOU1QNjZTVzg2UFlLS05SVjlFSjciLCJzdGFrZXJVbmxvY2tCeXRlcyI6IjIxMDJmOTMwOGEwMTkyNThjMzEwNDkzNDRmODVmODlkNTIyOWI1MzFjODQ1ODM2Zjk5YjA4NjAxZjExM2JjZTAzNmY5YWMiLCJvdXRwdXRzIjpbeyJ0eGlkIjoiNGE1ZTFlNGJhYWI4OWYzYTMyNTE4YTg4YzMxYmM4N2Y2MThmNzY2NzNlMmNjNzdhYjIxMjdiN2FmZGVkYTMzYiIsInZvdXQiOjAsInVubG9ja0hlaWdodCI6OTkwNTAwfV19
```

A fragment, not a query string: it is not sent in the HTTP request, so it does not land in an access, proxy, or `Referer` log. That is a transport property. The receiving page's own scripts can still read it, and verifying the packet discloses the staker and the spend bytes to the receiver's chain providers.

#### The general case, in one line

A 2-of-3 vault emits the identical packet with `stakerUnlockBytes` set to its `OP_2 <pk1> <pk2> <pk3> OP_3 OP_CHECKMULTISIG` subscript, no `btcPubkey`, and nothing else changed. A two-output lock at two different heights emits two `outputs[]` entries, each with its own `unlockHeight`, `lockScript`, and `lockAddress`. Neither needs a new field, a new version, or a conversation, which is the test the packet was designed to pass.

### 2.9 Stated limitations

**Multisig locks are expressible; the reclaim tooling is single-key today.** `stakerUnlockBytes` is raw opaque bytes precisely so an m-of-n vault needs no format change. But the published reclaim helper rejects any lock script with more than one staker key or more than one cosigner key (`reclaim.ts:297` and `:311`), and finish-mode import and SDK finalization lack general support. The multi-key cosigner rejection is on the early-exit path; ordinary CLTV finalization returns before it. Freezing the raw-bytes field now is deliberate, so no version bump is needed when the tooling catches up. **A custodian must not ship a multisig lock until reclaim support lands.**

**Verification is online by design.** A conformant receiver needs a Stacks node, for `get-protocol-bond`, `get-bond-l1-unlock-height`, `construct-lockup-output-script`, `get-bond-allowance`, and `min-ustx-for-sats-amount`, plus a Bitcoin source. There is no "trust the packet" mode. Defining the expected script as whatever the pinned contract computes costs a round trip and makes fully static verification impossible. That is the price of making an arbitrary receiver correct for its supported deployments, including across a hard fork that changes only the script bytes, and structurally immune to the half-reward-cycle height trap. A fork that also moves the proof ABI, the byte limits, or the event shape needs a receiver change regardless. A local SDK derivation may be offered only as a pre-check, labeled as not yet verified against the pinned contract.

**No signature in v1, and what that leaves open. This is a loss-of-funds exposure, not a griefing one.** `register-for-bond` binds the transaction sender throughout, and the rule that the connected wallet must equal `staker` stops an attacker registering in a third party's name. The packet alone authorises nothing. But signing the transaction a tampered packet induces can lock the customer's STX, route their reward stream elsewhere, and expose their unlocked balance to a manager they did not choose. Six substitutions survive v1.

*(a) The composed attack: an attacker-funded lock plus attacker calldata.* Substituting the lock is not a one-field edit, since the outpoint, the spend condition, and any COMMIT fields that would contradict them all have to move together, but nothing about that is hard. The attacker funds a dust P2WSH lock committing to the **victim's** principal with the **attacker's** own `stakerUnlockBytes`, and sets `signerCalldata` to the **attacker's** Bitcoin payout address. Every check in 2.5 passes, including 5.1: the script really does pay to a lock built from the victim's address, it is just not the custodian's lock. Then the victim's STX locks for the full bond term at the floor implied by the attacker's sats. The BTC reward stream on those sats routes to the attacker for the life of the bond. The attacker sweeps the dust at its CLTV height and recovers their cost. And the victim's real funded lock can never be registered: membership is keyed by staker principal alone (`pox-5.clar:139`), the overlap check blocks the intervening bonds (`bond-overlaps-new-position?` at `:2983-3002`, applied at `:768`), and the real lock's height fails 4.3 for the bond after that, so the customer's Bitcoin sits in P2WSH until its own CLTV height. Three distinct harms, worth separating because they are not the same size:

   - **An unauthorised collateral lock.** The customer's STX locks for the bond term against a position they did not choose. This is the direct loss.
   - **Diverted rewards on the substituted position only.** The contract totals the submitted outputs and derives the bond shares from that sum (`pox-5.clar:2006`, used at `:799`), so the attacker collects the yield attributable to their dust, not the yield the customer's real Bitcoin would have earned.
   - **Opportunity cost and illiquidity on the legitimate Bitcoin.** The customer's real lock earns nothing and cannot be spent before its own CLTV height. Registering it later may still be possible if its actual height and a later bond's terms permit, so this is foregone yield rather than a transfer to the attacker.

   **Loss of funds, not griefing**, even though the attacker's own gain is bounded by their dust.

*(b) A malicious signer manager.* `register-for-bond` calls the selected manager's `validate-stake!` with the customer still acting as `tx-sender` (`pox-5.clar:404-425`, called at `:754`). A registered manager with a live signer grant can transfer some of the customer's *unlocked* STX inside that callback, return success, and leave enough balance for the collateral lock. Trait compliance and signer registration do not make the callback harmless, and signer registration is permissionless (`:2754`, `:957-961`), so the manager principal carries no protocol-level trust. **Receivers SHOULD submit in deny mode with a `Staking` post-condition for the approved lock amount, together with restrictions on unauthorised asset transfers, wherever the customer's wallet and the active epoch can express that.** An ordinary STX post-condition is not enough on its own: those cover transfers and burns, while staking is checked separately and needs its own coverage under deny mode (core `crates/stacks-transactions/src/lib.rs:179`, `:293`, `:387`). Where the wallet or epoch cannot express it, the receiver MUST say so plainly and SHOULD restrict the transaction to a manager on its curated list.

*(c) Output-set tampering.* Removing entries from `outputs[]` produces a partial registration: the customer locks STX against part of their position, and the omitted outputs are then unregistrable for the reasons in (a). Adding entries can either cause rejection or quietly alter a successful registration. The allowance and balance checks are upper bounds, not equalities (`pox-5.clar:744` and `:751`), so an added output that stays under both simply increases the registered sats and the collateral locked. Different legal heights also give different scriptPubKeys, so an addition need not pay the same address. The control is comparing the **complete authorised output set**, which is what the six words do. A receiver-derived subset plan under 4.7 is not this: it is a plan the customer approves separately, the original packet is retained and named, and the omitted outputs are called out.

*(d) `bondIndex`, which is weaker than it looks.* At any burn height at most one bond both exists and has an open registration window, so in steady state there is no second bond to swap to. Setup for index N opens at `start(N)` minus the bond gap and closes at `start(N)` (`pox-5.clar:537-556`), and consecutive starts are spaced by exactly that gap (`:2895-2901`), so the **setup** windows tile without overlapping. **Registration** for N ends earlier still, at the effective close height, and is paused during every intervening prepare phase, so it is a subset of that tile with gaps in it. Either way at most one bond qualifies at a time. `earlyUnlockBytesHash` is correspondingly near-useless as a bond pin. The one surviving case is benign and is a feature: a custodian that deliberately builds above the floor, at or above the *next* bond's floor, gives the customer a second chance if they miss the intended bond's window.

*(e) `signerCalldata` and `signerManager` on their own.* The first redirects the payout under a known manager. The second replaces the manager, and with it the calldata schema, the routing semantics, and the callback authority in (b). It is the stronger of the two.

**What is permanent and what is not.** `bondIndex` and the registered lock outputs are permanent: nothing moves them once the registration confirms. `signerManager` and `signerCalldata` are **not**. `update-bond-registration` takes fresh calldata and a different manager (`pox-5.clar:850-853`), blocked during a prepare phase (`:873`) and requiring the new signer to differ from the old (`:881`). So reward routing is changeable forward, in **one** transaction (`build.ts:331` builds it), and never retroactively: rewards already paid to the wrong destination are gone. Moving back to the original manager is a second call. Whether the destination can be edited without changing manager depends on the manager, and the reference one stores the election per staker and replaces it on the next validation (`signer-manager.clar:74`, `:147`, `:152`).

**The v1 mitigation, and its honest weight.** It is the six words of 2.4a, displayed by both parties, plus the mandatory display at step 5.2 and comparison against the custodian's own authenticated record. The six words are what make the comparison one a person actually performs, and they cover all six substitutions at once. It remains display, not authentication, and it is weaker than a signature against an inattentive user. No COMMIT field helps here, since a tampering sender deletes it. Do not describe display as equivalent to authentication, and do not describe v1 as zero-trust merely because matching fields are shown.

**Matching the template is not the same as being spendable.** `construct-lockup-output-script` concatenates opaque bytes and hashes the result. It does not check stack discipline, satisfaction conditions, or key ownership. A subscript that does not decode, that leaves a false value, or that ends in an off-curve key, matches perfectly and strands the Bitcoin permanently in both branches. The controls are the creator's decode-and-structure checks at step 0, the receiver's structural repeat at 3.5, and a tested spend of both exit paths before any customer's lock is funded. None of them is the hash oracle.

**`attestation` is reserved, not shipped.** When it lands it will sign a SIP-018 Clarity tuple, never the JSON, with the domain `{name: "LHP", version, chain-id}`. Clarity consensus serialization is key-sorted and length-prefixed, so it is canonical by construction, and the domain hash makes a version bump cryptographically invalidate old attestations for free. Serialization is the easy half. The hard half is identity: a signature is worth nothing unless the receiver already trusts the signing key independently of the packet, and the spend key inside the packet cannot be that key, because an attacker who funds their own lock supplies their own key, packet, and valid signature together.

Two options are worth working up before anything is written into an agreement.

- **A separate custodian receipt-signing key**, distinct from the asset-signing key and published to receivers through trusted configuration. This gives a portable receipt and sidesteps the asset HSM, at the cost of a key registry and an issuance policy.
- **An attestation by the bond admin**, who already publishes the allowlist at setup and could sign `sha256(stakerUnlockBytes)` per `(bondIndex, staker)` at the same moment. Receivers already trust that party for the bond record, so no new identity is needed. The cost is that it puts the admin in the loop per staker, which is the coupling this architecture otherwise removes.

**What the custodian's signing infrastructure can actually sign is an open integration question, not a settled fact.** The sources here do not establish this custodian's capabilities. Ask specifically which algorithms, message formats, and approval policies are supported, and whether a receipt-signing key can be operationally separate from the asset HSM. Note only that BIP-322's virtual transaction construction remains an arbitrary-message ceremony from the signer's point of view, whatever the answer.

**Sensitivity, and the window that closes.** The principal is not the secret. `setup-bond` prints every allowlisted staker with its exact sats allowance, topic `"add-to-allowlist"` (`pox-5.clar:625-628`), for up to 1,000 entries per bond. So the candidate staker set for any bond is public and small, and the unlock-height floor is public too. The packet's marginal disclosure is the **linkage** from that principal to a specific funding txid, and the spend condition. Fragment-only transport is a real mechanism for keeping that linkage out of logs, not an exhortation, and it is scoped as narrowly as 2.4 says. The confidentiality window then closes at registration: the unlock bytes are in the calldata, the staker is in the bond's registration list, and the outputs are on Bitcoin. The print event does not carry the unlock bytes; its per-output entries hold only a reversed txid and an output index. The goal is therefore not permanent secrecy but keeping the linkage out of logs, inboxes, and analytics pipelines that outlive the window by years. A signed leaked packet would instead be non-repudiable evidence, which is one more reason v1 ships unsigned.

**Early exit, stated the way a receiver must state it.** Early exit returns the Bitcoin principal only. The paired STX stays locked for the rest of the bond, and no further rewards accrue. The customer, not the custodian, submits `announce-l1-early-exit`, which is blocked during the prepare phase and is one-shot. The documented policy of the early-exit signing service is announce-first; as deployed today the service does not verify that the announcement happened and will sign on request. The Bitcoin spend then uses the early-exit branch, with a 32-byte preimage derived from `staker` alone. None of this needs a second **LHP** packet, but it does need a second exchange. The packet reconstructs the witness script; it cannot supply the vault's signature, and in a Bitcoin-side-only integration the customer's Stacks wallet does not hold the Bitcoin custody key. A custodian signing exchange, PSBT export and import, with its own destination and fee approval, is a required companion and is out of LHP-1's scope. Cosigner and signing-service discovery comes from the receiver's trusted configuration, never from a URL inside a packet.

### 2.10 Transitional downgrade to today's finish link (non-normative)

Until at least one conformant receiver exists, a single-key packet can be downgraded to today's link, so the standard has somewhere to land on day one. A packet whose `stakerUnlockBytes` equals `0x21 ‖ pk ‖ 0xac` maps to:

```
/enroll?mode=finish&bondIndex=1&staker=SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7&btcKey=02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9&btcTxid=4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b
```

The downgrade drops `network`, per-output data, and both BIND fields. It is legal only for a single-output packet whose unlock height equals `get-bond-l1-unlock-height(bondIndex)` exactly, on the receiver's own pinned deployment, and carrying no `signerManager` or `signerCalldata`. **A packet carrying `crit` MUST NOT be downgraded**, since the legacy link can neither represent nor enforce a critical requirement, and the same rule holds for any future field a receiver must act on. Anything else MUST refuse the downgrade rather than silently discard a binding election or a critical marker. The receiver must treat the result as an unverified legacy link. Retire it once one conformant receiver exists.

---

## Part 3. Technical basis

Tags: [proven] verified by reading the `pox-5` source or the published SDK; [decided] a call made while drafting this standard; [doc] from a specification or prior research document.

Line cites of the form `pox-5.clar:NNN` and `crates/stacks-transactions/src/lib.rs:NNN` refer to `stacks-core` branch `bs-main` at commit `ab048f9c1b`; `signer-manager.clar` is `contrib/core-contract-tests/contracts/signer-manager.clar` in the same checkout. SDK cites (`script.ts`, `reclaim.ts`, `build.ts`, `fetch.ts`) refer to `@stacks/bitcoin-staking` 7.6.0.

1. [proven] `construct-lockup-script` takes exactly four arguments (`staker`, `unlock-burn-height`, `staker-unlock-bytes (buff 683)`, `early-unlock-bytes (buff 683)`) and emits `0x63 ‖ push-c-script-num(h) ‖ 0xb167 ‖ 0x82012088a820 ‖ sha256(sha256(to-consensus-buff? staker)) ‖ 0x88 ‖ early-unlock-bytes ‖ 0x6869 ‖ staker-unlock-bytes`. `pox-5.clar:3711-3733`. `construct-lockup-output-script` is `0x0020 ‖ sha256(...)`, `:3734-3746`. This is the sufficiency proof for the packet: three inputs are in it or derivable from it, and the fourth comes from the bond record.
2. [proven] `push-c-script-num` emits `OP_0` for zero, `OP_1` to `OP_16` for 1 to 16, otherwise a minimal little-endian signed ScriptNum push. `pox-5.clar:3834-3845`, mirrored at `script.ts:100-134`.
3. [proven] The early-exit bytes are read from the bond record inside the fold, never from the caller: `pox-5.clar:2012`. Derivable from `bondIndex`; they must not travel as bytes.
4. [proven] **Heights are per output and bounded only from below.** `validate-l1-lockup` takes `unlock-burn-height` from each output tuple and asserts only that it is at least the accumulator's minimum and below the locktime threshold `u500000000`. `pox-5.clar:2074-2078`, threshold at `:88`.
5. [proven] The fold's shared state is `staker`, `minimum-unlock-height`, `staker-unlock-bytes` (one per registration), and `early-unlock-bytes`. `pox-5.clar:2005-2013`. The global-map and per-output-array split in 2.2 is the contract's own shape, not a stylistic choice.
6. [proven] The fold asserts heights (`:2074`, `:2077`), script `ERR_INVALID_LOCKUP_SCRIPT` (`:2081`), amount `ERR_INVALID_LOCKUP_AMOUNT` (`:2084`), outpoint uniqueness `ERR_DUPLICATE_LOCKUP_OUTPOINT` (`:2087`), then header and merkle (`:2091` onward). **That order is not an argument for receiver ordering**, and earlier drafts of this proposal used it as one. The `let` at `:2059-2065` parses the header, builds the expected script, and reads the output before any `asserts!` runs, so the sequence only decides which error a failing transaction reports. The load-bearing fact is that the height bounds are an independent gate: a scriptPubKey can match on a lock that can never be registered. Both checks MUST pass before a signature is offered, in either order.
7. [proven] `get-bond-l1-unlock-height(bond-index)` is `bond-period-to-burn-height(bond-index + u6)` minus half a reward-cycle length. `pox-5.clar:3342-3347`. The SDK's `computeBondUnlockHeight` produces this value and only this value (`script.ts:471-481`), so it cannot express a custodian's higher choice. The API's `schedule.unlock.bitcoin_height` differs by `floor(rewardCycleLength / 2)`, verified 10 blocks apart on bond 342.
8. [proven] `(asserts! (is-eq (get amount output) (get amount lockup)) ERR_INVALID_LOCKUP_AMOUNT)`, `pox-5.clar:2084`. The receiver reads the value from the outpoint regardless, so `sats` is redundant as a required field and is COMMIT only.
9. [proven] `register-for-bond(bond-index uint, signer-manager <signer-manager-trait>, amount-ustx uint, btc-lockup (response {outputs: (list 10 {...}), staker-unlock-bytes: (buff 683)} uint), signer-calldata (optional (buff 500)))`. `pox-5.clar:642-669`. Ten outputs is the hard cap; the unlock bytes are one per call and the unlock burn height one per output.
10. [proven] **Sender binding, stated precisely.** `verify-l1-lockups` is called with `tx-sender` as the staker, `pox-5.clar:674`. The contract reconstructs the lock from `tx-sender`; it takes no separate `staker` argument. `register-for-bond` carries no `(is-eq contract-caller tx-sender)` guard, unlike `announce-l1-early-exit` at `:1220-1223`, so a contract-mediated call preserving the sender is not prohibited and a contract principal is a legal staker on chain. LHP-1 excludes contract stakers by construction, because step 5.1 requires a connected wallet. The packet is not an authorization: only the transaction is. v1 ships without a signature envelope, and 2.9 states what that leaves open.
11. [proven] `staker-unlock-bytes` has no source on Stacks, on Bitcoin, or by derivation before registration. `<pubkey> OP_CHECKSIG` is only the SDK default (`script.ts:44-63`) and the contract treats the buffer as opaque. The frozen specification states that a custodian using another form has no channel today and must give written notice.
12. [proven] `signer-manager` is required and non-optional, orthogonal to the lock, and not discoverable before registration. Today's finish link carries neither. `signer-calldata` is `(optional (buff 500))`; a registration that omits it accrues sBTC wherever the chosen manager's default sends it. That is a manager default, not a protocol rule, and correcting it later means an `update-bond-registration`. `amount-ustx` is caller-supplied and only floor-bounded (`min-ustx-for-sats-amount` at `:3089-3095`, asserted at `:713-719`, balance at `:751`), which is why LHP-1 demotes `amountUstx` to a suggestion.
13. [decided] **The custodian's preflight uses the individual read-only calls** `get-bond-allowance`, `construct-lockup-output-script`, `min-ustx-for-sats-amount`, and `get-bond-l1-unlock-height`, **not the combined eligibility helper.** This reconciles LHP-1 with the l1-only design doc, which says a signer must be chosen at paste time because `fetchEligibleRegisterForBond` takes a `signerManager` argument. That constraint is a property of the combined helper, not of the protocol. No signer is needed on the custodian side, so `signerManager` is correctly optional in the packet and the receiver asks the customer when it is absent.
14. [proven] Allowlist: `protocol-bond-allowances` at `pox-5.clar:130-137`, inserted only inside `setup-bond` at `:617` via `map-insert`, read in `register-for-bond` at `:698`, getter `get-bond-allowance` at `:3055`. Immutable after setup, and the one unrecoverable failure. Deadline: bond start height from `bond-period-to-burn-height` at `:701` plus `(try! (verify-not-prepare-phase))` at `:711` (helper at `:2956`).
15. [proven] `get-protocol-bond` is a read-only getter over the `protocol-bonds` map (map at `pox-5.clar:110-128`, getter at `:3322`), and is what the contract's own fold uses at `:2005`. `get-bond-membership(staker)`, `pox-5.clar:3066-3078`, is keyed by staker principal alone and returns `none` once `BOND_LENGTH_CYCLES` past the start cycle, even though `protocol-bond-memberships` at `:139` still holds the row. The print event is at `pox-5.clar:838`: `(print (merge { topic: "register-for-bond" } result))`. Earlier drafts cited `793-816`; that is wrong.
16. [proven] `announce-l1-early-exit` at `pox-5.clar:1196`, prepare-phase-blocked at `:1213`, one-shot at `:1226`; `has-announced-l1-early-exit` at `:3328`. It never calls `remove-staker-from-cycles`, so the paired STX stays locked for the rest of the bond and no further rewards accrue. The early-exit witness is `[stakerSig, cosignerSig, preimage, <empty>, witnessScript]` with `preimage = sha256(to-consensus-buff? staker)`, `reclaim.ts:270-296`; `finalizeReclaim` rejects multi-key subscripts at `reclaim.ts:297` (staker) and `:311` (cosigner); the cosigner rejection is on the early-exit path only, since ordinary CLTV finalization returns first.
17. [doc] The announce-first rule for the early-exit signing service is documented service policy. As of 2026-09-08 the service does not check it and signs on request.
18. [proven] The general form is already plumbed at the read level: the contract's `construct-lockup-output-script` takes arbitrary `staker-unlock-bytes`, and the SDK's `fetchConstructLockupOutputScript` passes them through. A receiver built on today's single-key link still has to carry the general form through its own verify and build paths, so a packet parser is only the first change.
19. [proven] Today's link contract is `bondIndex`, `staker`, `btcKey` (66-hex pubkey or P2WPKH address), optional `btcTxid`, and `step`. No version, no discriminator, no network, no unlock height, no signer. Because it travels as query parameters, the principal, key, and txid triple reaches every server and browser log on the path; 2.4 moves the packet into the URL fragment for that reason.
20. [decided] The verdict for a script mismatch stays undifferentiated so a partially known packet cannot be probed field by field; height and bond failures are named because both are public reads. The packet carries no navigation state, so a receiver needs no step clamp.
21. [proven] Verified computations for `SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7`: consensus buffer `0516a46ff88886c2ef9762d970b4d2c63678835bd39d`, double SHA-256 `7f74bdc95f3507b1336cb9cea5ef67e6b0795a2fbc34d046653bc69c4444df87`, early-exit preimage `70fa33f065c8c274f5cf583babf0a2710681544dcf1b35704077573c638837c0`, `push-c-script-num(990500)` = `03241d0f`. The full script, scriptPubKey, and address are in 2.8. The bech32 encoder was validated against both BIP-173 test vectors.
22. [doc] Prior art applied. BIP-174: unrecognized version means exit immediately, unknown key-type passes through verbatim, and the `0xFC` proprietary namespace becomes `ext`. BIP-370: per-input and per-output data belongs in its own map, and a version break should be clean, giving the global and per-output split plus dual-emit migration. LNURL LUD-01: a `tag` discriminator and transport agnosticism, giving `protocol` and the rule that the data is the spec and the carrier is not. BIP-329: unknown record type is ignored. SIP-018: a `{name, version, chain-id}` domain baked into the hash with key-sorted Clarity serialization, which the reserved `attestation` will use. SLIP-0132: a registry exists so independent implementers do not collide, giving the `network`, `protocol`, and `ext.` registries.

23. [proven] **The rollover window.** `verify-bond-rollover-window` asserts that a staker holding an existing membership may only register once `burn-block-height` reaches `get-bond-l1-unlock-height` for **that** bond, `pox-5.clar:3009-3021`, called from `register-for-bond` at `:780`. An existing membership is therefore not an unconditional failure: the overlap check at `:764-770` rejects only an *overlapping* bond, and the comment at `:764-766` names rolling from bond N into N+6 as supported. Step 4.9 states all four conditions. The usable interval for an immediate rollover is `[oldFloor, newStart - prepareLength)`, ordinarily `floor(R/2) - P` blocks; the helper imposes no upper bound of its own.
24. [proven] **Registration closes before the bond start, not at it.** `register-for-bond` calls `(try! (verify-not-prepare-phase))` at `:711`, and `is-in-prepare-phase` at `:2945-2950` is true from `reward-cycle-to-burn-height(current + 1)` minus the prepare-cycle length. The prepare phase immediately preceding the bond therefore closes registration for good, and it never reopens. The effective close height is the bond start height minus the prepare-cycle length. The `< bond-start-height` assert at `:722` is necessary and not sufficient.
25. [proven] **Reward routing is changeable forward, in one transaction.** `update-bond-registration` at `pox-5.clar:850-853` takes the new signer manager, the old one, and fresh `signer-calldata` in a single call, and the SDK builds it as one transaction (`build.ts:331`). It is blocked during a prepare phase at `:873` and requires the new signer to differ from the old at `:881`, so returning to the original manager is a second call. Delegation changes take effect from the next applicable reward cycle (`:868`). `signerCalldata` is therefore not permanent, and any receiver text saying otherwise is wrong. Whether a payout can be changed **without** switching manager is manager-specific: the reference manager keys `pox-addrs` by principal (`signer-manager.clar:74-76`) and `map-set`s or `map-delete`s it during validation (`:147`, `:152`), so a later same-manager registration replaces it. Rewards already paid to the wrong destination are not recoverable.
26. [proven] **The allowlist is public.** `add-staker-to-bond` prints `{staker, max-sats}` with topic `"add-to-allowlist"` and the bond index, `pox-5.clar:625-628`, for every entry of a list of up to 1000 (`:521-524`). The candidate staker set for a bond, with each allowance, is therefore public at setup. This is why 2.9's disclosure claim is about the *linkage* to a funding txid, not about the principal.
27. [proven] **Signer registration is permissionless.** `grant-signer-key` requires the signer manager to be the caller at `pox-5.clar:2754`, rejects a reused grant at `:2757`, and verifies the grant signature at `:2766`. `register-signer` requires an existing valid grant at `:957` and the signer contract to be the caller at `:960-961`. Every one of those is a self-authorisation: no admin approves anything, so the set of `signerManager` values the contract accepts is unbounded and the principal carries no protocol-level trust. Receivers need a curated list of their own, which step 4.11 requires.
28. [proven] **The manager callback runs with the customer's authority.** `signer-manager-validate-stake` calls `validate-stake!` on the selected manager at `pox-5.clar:404-425`, invoked from `register-for-bond` at `:754-756`, while the customer is still `tx-sender`. A nested contract call preserves sender authority, so the manager can `stx-transfer?` the customer's unlocked STX inside the callback. Submitting with `postConditionMode` set to `allow` removes the only transaction-level protection against it, which is why 2.9(b) asks for deny mode.
29. [proven] **The print event's shape.** `get-l1-lockup-summary` at `pox-5.clar:2126-2129` emits only `{txid: (get-reversed-txid ...), output-index}` per output: no amount, no CLTV height. `get-reversed-txid` at `:3676` is `(sha256 (sha256 tx))`, the internal byte order, which is the reverse of the display-order txid the packet carries. The event's top-level `unlock-burn-height` at `:824` is `(reward-cycle-to-burn-height unlock-cycle)`, the STX cycle-end height. It is **not a function of the packet's CLTV height at all**: the difference is half a reward cycle minus however far the lock was built above the floor, and it can be zero or negative. It is half a cycle only for a lock built exactly at the minimum. Never compare the two.
30. [proven] **Nothing checks that the outpoint is still unspent.** The validation sequence at `pox-5.clar:2057-2105` parses the header, builds the expected script, reads the output, then asserts height bounds, script, amount, outpoint uniqueness within the call, and merkle inclusion. Inclusion in a historical block is not evidence the output survives, so an otherwise eligible spent outpoint can register. Step 4.12 puts the check on the receiver.
31. [proven] **Why `unlockHeight > 0` is a structural rule.** Height 0 encodes as `OP_0`, which pushes an empty value that `OP_CLTV` does not pop, so the shared `OP_VERIFY` reads it as false and the **timelock** branch can never validate (`script.ts:315-322`); the early-exit branch is separate and unaffected. Registration would not accept a zero anyway whenever the bond floor is positive, since the accumulator's minimum comes from `get-bond-l1-unlock-height` (`pox-5.clar:2010`) and is asserted at `:2074`. The rule stays in step 3.5 as a structural check that does not depend on the floor being positive.

---

## Part 4. Integration into `@stacks/bitcoin-staking`

This part is for the SDK maintainers. It proposes where LHP-1 lives in `@stacks/bitcoin-staking` (the stacks.js package, 7.6.0 at the time of writing) and what the package would and would not take on. Nothing here changes the standard in Part 2; it describes the reference implementation of it. It was revised after a review against the package source; the review's signatures are adopted below.

### 4.1 What the package already has

Almost every primitive the packet needs exists. The table gives the real signatures so the RFC does not invent parameter names. `Bytes` means `Uint8Array | string`; `Net` means `StacksNetworkName | StacksNetwork`.

| Need | Existing export and shape |
|---|---|
| Build and derive the lock | `buildLockScript({ stxAddress, unlockHeight, unlockBytes, earlyUnlockBytes, validateEarlyUnlockBytes? })`, `buildLockOutputScript`, `buildLockAddress` (two overloads: `unlockBytes` or `publicKey`, plus `network: Net`), `computeRegisterPreimage(stxAddress)`, `pushCScriptNum` |
| The contract's own definition of the script | `fetchConstructLockupScript`, `fetchConstructLockupOutputScript(ConstructLockupParams & NetworkClientParam)`, `fetchBondL1UnlockHeight({ bondIndex })` returning `bigint`, `fetchVerifyBlockHeader` |
| Bond and staker state | `fetchProtocolBond({ bondIndex })`, `fetchBondAllowance({ bondIndex, address })`, `fetchBondMembership({ address })`, `fetchProtocolBondMemberships({ address })`, `fetchStakerInfo`, `fetchAccountStatus`, `fetchHasAnnouncedL1EarlyExit`, `minUstxForSatsAmount` in `cycles.ts`, the signer-info and grant reads used by `fetchEligibleRegisterForBond` |
| Proof and registration | `buildLockProofFromBlock({ txHex, header, blockHeight, txids, unlockHeight, outputIndex? } & ExpectedScriptInput)` returning `BondL1LockupOutput`; `buildRegisterForBond({ bondIndex, signerManager, amountUstx, lockup: BondLockup, signerCalldata? } & TxParams)`, which accepts one to ten outputs |
| Exit | `buildReclaim(BuildReclaimOpts)`, `finalizeReclaim(FinalizeReclaimOpts)`; `signReclaim` is internal |
| Payout election | `buildSignerCalldata(SignerCalldataL1Payout)`, `parseSignerCalldata(Bytes)` for the reference signer-manager's schema only |
| Error mapping | `parsePox5Error`, `describePox5Error` for contract error codes |
| Encoding | `@scure/base` is already a direct dependency and exposes `base64url` and `base64urlnopad`; `@stacks/common` supplies UTF-8 conversion |

Three qualifications the RFC must carry.

- `buildLockScript` takes an explicit height with no bond-index input, so it already accepts a custodian's above-floor height. `computeBondUnlockHeight` and `buildRegisterMetadata` are the floor-producing helpers and must not be used to derive a packet height.
- `buildLockScript` checks that the staker subscript is non-empty and decodable but does not check balanced conditionals. The balance check in 2.5 step 3.5 is new code.
- `finalizeReclaim` operates on input zero and rejects multiple staker keys; early exit also rejects multiple co-signer keys. The multisig limitation in 2.9 carries into the delivery plan.

The package has no built-in Bitcoin RPC or indexer transport. `proof.ts` is pure and takes block data as input. The packet layer keeps that boundary.

### 4.2 One new module: `handoff.ts`

Same functional style as the rest of the package: one options object per function, `NetworkClientParam` for the Stacks client, no client object of its own, no signing, no broadcasting. Packet types go in `types.ts`. A narrowly scoped `LockHandoffError extends Error` goes in `errors.ts` with its own categories; it is not a contract error and never carries packet contents in its message. Online verification returns categorized check results, in the style of the `{ ok, reasons }` eligibility results, rather than throwing.

```ts
export type LockHandoffNetworkParams = NetworkClientParam & { network: StacksNetworkName };

export interface LockHandoffElection {
  signerManager: string;
  signerCalldata: Uint8Array | string | undefined; // undefined elects the manager default
  amountUstx: bigint;
}

export function parseLockHandoffPacket(input: string, opts: { network: StacksNetworkName }): LockHandoffPacketV1;
export function encodeLockHandoffPacket(packet: LockHandoffPacketV1): string;
export function packetChecksumWords(packet: LockHandoffPacketV1): readonly [string, string, string, string, string, string];

export function verifyLockHandoffPacket(opts: {
  packet: LockHandoffPacketV1;
  bitcoin: BitcoinSource;
  election?: LockHandoffElection;
  signerCalldataDecoder?: (o: { signerManager: string; signerCalldata: Uint8Array; network: StacksNetworkName }) => SignerCalldataL1Payout | undefined;
} & LockHandoffNetworkParams): Promise<LockHandoffVerificationReport>;

export function packetToRegisterForBondArgs(opts: {
  packet: LockHandoffPacketV1; verification: VerifiedLockHandoff; election: LockHandoffElection;
}): LockHandoffRegisterArgs;

export function packetToReclaimInputs(opts: {
  packet: LockHandoffPacketV1; resolvedOutputs: readonly ResolvedLockHandoffOutput[];
}): LockHandoffReclaimInput[];

export function fetchPacketEnrollmentStatus(opts: {
  packet: LockHandoffPacketV1;
  resolvedOutputs: readonly ResolvedLockHandoffOutput[];
  registration?: { txid: string; fetchReceipt: (txid: string) => Promise<LockHandoffRegistrationReceipt | undefined> };
} & LockHandoffNetworkParams): Promise<LockHandoffEnrollmentStatus>;

export interface BitcoinSource {
  fetchBtcTxHex(txid: string): Promise<string>;
  fetchBtcTxStatus(txid: string): Promise<{ confirmed: false } | { confirmed: true; blockHash: string; blockHeight: number }>;
  fetchBlockHeader(blockHash: string): Promise<Uint8Array | string>;
  fetchBlockTxids(blockHash: string): Promise<string[]>;
  fetchOutputSpendStatus(txid: string, vout: number): Promise<{ spent: false } | { spent: true; confirmed: boolean }>;
}
```

What each does, and the contracts the types carry.

| Export | Role | Behaviour |
|---|---|---|
| `parseLockHandoffPacket` | receiver, offline | Accepts JSON text, base64url with or without padding, or a URL fragment. Performs all of step 3: version, protocol, exact named-network equality, staker checksum and prefix, spend-bytes decodability and balance, output shapes, `crit`, unknown-key preservation. Throws `LockHandoffError` with the spec's category on the first failure. |
| `encodeLockHandoffPacket` | creator | `JSON.stringify`, UTF-8, unpadded base64url. No canonical JSON: nothing in the wire form is hashed. |
| `buildLockHandoffPacket` | creator | Assembles a packet after funding. Takes the height actually used per output and never derives it. Computes per-output `lockScript` and `lockAddress` through `buildLockScript` so no emitter hand-assembles them. |
| `packetChecksumWords` | both | The six words of 2.4a. Wordlist indexing over SHA-256 bytes, most-significant bit first, six consecutive 11-bit indices, zero-based. It is not BIP-39 mnemonic generation and must not call `entropyToMnemonic`. Declare `@scure/bip39` as a direct dependency (already in the monorepo at 1.1.0) and import only the English wordlist. This lives in the package because the check only works if every custodian and receiver renders identical words. |
| `verifyLockHandoffPacket` | receiver, online | Step 4 over the existing reads plus the caller's `BitcoinSource`. Without an `election` it returns a preview: the signer gates and the balance check against the elected amount are pending, not passed. With an `election` it runs everything and, on complete success only, includes a `VerifiedLockHandoff`. That object is a snapshot: the packet association, the checked election, resolved outputs, the `BondL1LockupOutput[]`, `Bond`, `PoxInfo`, allowance, computed minimum, effective close height, and observation height. It is not an authorization, and the app MUST re-run the mutable checks immediately before building. Beyond calling the proof builder it also: recomputes the display-order txid of the witness-stripped transaction and compares it with the packet's; takes the exact `vout` and checks amount and script from that output; validates the header at the claimed height with `fetchVerifyBlockHeader`; treats a provider failure as an error, never as "unspent"; and distinguishes confirmed from mempool spends. The `signerCalldataDecoder` is receiver configuration and is invoked only for managers the receiver recognizes; a `payoutHint` that cannot be checked is reported as unchecked, never as verified. |
| `packetToRegisterForBondArgs` | receiver | Turns a complete `VerifiedLockHandoff` plus the election into the arguments `buildRegisterForBond` takes: `lockup` of kind `btc` with all outputs, bigint microSTX, calldata bytes. Honor-or-refuse lives here: a packet BIND field the election contradicts throws. An incomplete report is rejected. |
| `packetToReclaimInputs` | recovery | Per output, the `utxo` with value, `lockScript`, `network`, `stxAddress`, `unlockHeight`, and preimage that `buildReclaim` and `finalizeReclaim` need. It requires `resolvedOutputs`, because a minimal packet carries neither the bond's early-exit bytes nor output values, and neither can be recovered from a P2WSH hash. Recovery MUST NOT require enrollment eligibility: a missed window is exactly when recovery matters. |
| `fetchPacketEnrollmentStatus` | both | The 2.6 done-states. Current membership comes from the existing reads. Exact packet enrollment needs a registration receipt, which no existing read returns: the optional `registration` callback lets the caller supply one from an indexer or the transaction itself. A known receipt is checked for success, emitting contract equal to the pinned deployment, canonical block, staker, bond, and exact outpoint set. Missing history yields `unknown`, never "never enrolled". |

Wire bytes stay hex strings and wire `amountUstx` stays a decimal string. Resolved amounts and approved microSTX are `bigint`; resolved scripts are `Uint8Array`. Reuse `BondL1LockupOutput`, `BondLockup`, `Utxo`, `PoxInfo`, `Bond`, `BondMembership`, and `StacksNetworkName` rather than introducing parallel types. The reads and builders target `network.bootAddress` plus `pox-5`; a packet's `contract` field is checked against that configured target and never used to select it.

### 4.3 Why the package and not the app

- **The SDK becomes the conformance reference.** "What does a correct receiver do" gets an answer that runs, with the vectors versioned next to the functions they exercise.
- **The reference app shrinks.** Its finish flow becomes parse, verify, elect, re-verify, build, submit. Several of today's limits close as a side effect, including the single-output limit, which is in the app's wrapper and not in `buildRegisterForBond`. Adoption is not only dropping parsers: the app submits a `ContractCallPayload` through a wallet while `buildRegisterForBond` returns a `StacksTransactionWire`, so the app needs a bridge from `LockHandoffRegisterArgs` to its wallet call, and that bridge is where the Staking post-condition for the approved lock amount is attached (the package README documents it) and where the immediate pre-sign re-checks run.

Compatibility across a contract upgrade is qualified as in 2.7: `fetchConstructLockupOutputScript` updates the expected script, but local construction, proof serialization, reclaim scaffold parsing, witness assembly, and event decoding are version-sensitive and belong to a stated supported-deployment profile.

### 4.4 What stays out of the package

Policy rather than protocol: the recognized signer-manager list and its decoder, recommendation logic, display and error copy, human acknowledgements, wallet state, the custodian's PSBT signing exchange, and Bitcoin transport. The package exposes a hook for each (`BitcoinSource`, `signerCalldataDecoder`, `registration.fetchReceipt`) and takes none of the opinions. A successful SDK result never claims that a human compared six words or approved an unknown manager. Error categories belong in results; display copy belongs in the app.

### 4.5 Delivery

1. Types, `parseLockHandoffPacket`, `encodeLockHandoffPacket`, `packetChecksumWords`, `LockHandoffError`. No network calls, fully unit-tested. Vectors: single-key, m-of-n, two outputs at two heights, present-empty calldata, and a rejection matrix: unknown `crit`, unknown-field preservation, padded and unpadded input, invalid UTF-8, unsafe integers, unbalanced conditionals, duplicate outpoints, the 1, 10, and 11 output boundaries, checksum invariance under key and output order, absent versus empty calldata, and elections not mutating the checksum.
2. `verifyLockHandoffPacket` with the preview and complete modes, over the existing reads, mocked with the repository's `jest-fetch-mock` setup and `useFixtures` replay, plus a deterministic `BitcoinSource` mock. Reuse the recorded mainnet transaction and header data in `tests/locking-btc.test.ts`, the synthetic two-output funded lock in `tests/register-flow.test.ts`, and the frozen witness-script vectors in `tests/privatenet/actions/golden-vectors.test.ts`. Cases: txid substitution in the raw transaction, non-canonical header, spent and mempool-spent outputs, provider failure, floor computed over summed sats, a valid preview followed by prepare-phase entry, grant revocation, changed funding status, and election mismatch.
3. `packetToRegisterForBondArgs`, `packetToReclaimInputs`, and `fetchPacketEnrollmentStatus` with the receipt callback. Cases: same-total membership with different outpoints, expired or overwritten membership, event txid reversal, recovery after a missed window, single-key success, and unsupported multisig finalization.
4. The `handoff` barrel export, TSDoc examples, a README section with a table-of-contents entry, and a minor changeset. The repository uses a fixed `@stacks/*` version group, so no independent package release is promised. Tests are not in the npm `files` list, so the vectors ship as a versioned repository artifact, with a decision recorded on whether to also ship them as package data.
5. The reference app adopts the module: parser replacement, the wallet bridge with the Staking post-condition, and the recovery flows.

Two things to record. The first release of `fetchPacketEnrollmentStatus` can report current position only and mark exact packet history `unknown`; exact history is a separate indexer contract. And `buildLockHandoffPacket` takes the actual per-output height as input and never derives it, because `computeBondUnlockHeight` only produces the floor and the packet exists because custodians may build above it.

---

