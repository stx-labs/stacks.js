import {
  bytesToHex,
  bytesToUtf8,
  concatArray,
  hexToBytes,
  hexToInt,
  intToBigInt,
  intToBytes,
  intToHex,
  isInstance,
  utf8ToBytes,
  writeUInt32BE,
  writeUInt8,
} from '@stacks/common';
import { BytesReader } from '../BytesReader';
import {
  ClarityValue,
  OptionalCV,
  PrincipalCV,
  deserializeCV,
  noneCV,
  serializeCVBytes,
  someCV,
} from '../clarity';
import {
  AuthFieldType,
  COINBASE_BYTES_LENGTH,
  COMPRESSED_PUBKEY_LENGTH_BYTES,
  ClarityVersion,
  FungibleConditionCode,
  STRING_MAX_LENGTH,
  MEMO_MAX_LENGTH_BYTES,
  NonFungibleConditionCode,
  PayloadType,
  PostConditionPrincipalId,
  PostConditionType,
  PoxConditionCode,
  PubKeyEncoding,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  TenureChangeCause,
  UNCOMPRESSED_PUBKEY_LENGTH_BYTES,
  VRF_PROOF_BYTES_LENGTH,
} from '../constants';
import { DeserializationError, SerializationError } from '../errors';
import { compressPublicKey, createStacksPublicKey, uncompressPublicKey } from '../keys';
import { rightPadHexToLength } from '../utils';
import {
  createCoinbasePayload,
  createContractCallPayload,
  createLPList,
  createLPString,
  createMessageSignature,
  createNakamotoCoinbasePayload,
  createPoisonPayload,
  createSmartContractPayload,
  createTenureChangePayload,
  createTokenTransferPayload,
  createTransactionAuthField,
} from './create';
import {
  AddressWire,
  AssetWire,
  ContractPrincipalWire,
  LengthPrefixedList,
  LengthPrefixedStringWire,
  MemoStringWire,
  MessageSignatureWire,
  OriginPrincipalWire,
  PayloadInput,
  PayloadWire,
  PostConditionPrincipalWire,
  PostConditionWire,
  PublicKeyWire,
  StacksWire,
  StacksWireType,
  StandardPrincipalWire,
  TransactionAuthFieldWire,
} from './types';

export function serializeStacksWire(wire: StacksWire): string {
  return bytesToHex(serializeStacksWireBytes(wire));
}
export function serializeStacksWireBytes(wire: StacksWire): Uint8Array {
  switch (wire.type) {
    case StacksWireType.Address:
      return serializeAddressBytes(wire);
    case StacksWireType.Principal:
      return serializePrincipalBytes(wire);
    case StacksWireType.LengthPrefixedString:
      return serializeLPStringBytes(wire);
    case StacksWireType.MemoString:
      return serializeMemoStringBytes(wire);
    case StacksWireType.Asset:
      return serializeAssetBytes(wire);
    case StacksWireType.PostCondition:
      return serializePostConditionWireBytes(wire);
    case StacksWireType.PublicKey:
      return serializePublicKeyBytes(wire);
    case StacksWireType.LengthPrefixedList:
      return serializeLPListBytes(wire);
    case StacksWireType.Payload:
      return serializePayloadBytes(wire);
    case StacksWireType.TransactionAuthField:
      return serializeTransactionAuthFieldBytes(wire);
    case StacksWireType.MessageSignature:
      return serializeMessageSignatureBytes(wire);
  }
}

export function deserializeStacksWire(
  bytesReader: string | Uint8Array | BytesReader,
  type: StacksWireType,
  listType?: StacksWireType
): StacksWire {
  switch (type) {
    case StacksWireType.Address:
      return deserializeAddress(bytesReader);
    case StacksWireType.Principal:
      return deserializePrincipal(bytesReader);
    case StacksWireType.LengthPrefixedString:
      return deserializeLPString(bytesReader);
    case StacksWireType.MemoString:
      return deserializeMemoString(bytesReader);
    case StacksWireType.Asset:
      return deserializeAsset(bytesReader);
    case StacksWireType.PostCondition:
      return deserializePostConditionWire(bytesReader);
    case StacksWireType.PublicKey:
      return deserializePublicKey(bytesReader);
    case StacksWireType.Payload:
      return deserializePayload(bytesReader);
    case StacksWireType.LengthPrefixedList:
      if (!listType) {
        throw new DeserializationError('No list type specified');
      }
      return deserializeLPList(bytesReader, listType);
    case StacksWireType.MessageSignature:
      return deserializeMessageSignature(bytesReader);
    default:
      throw new Error('Could not recognize StacksWireType');
  }
}

export function serializeAddress(address: AddressWire): string {
  return bytesToHex(serializeAddressBytes(address));
}
export function serializeAddressBytes(address: AddressWire): Uint8Array {
  const bytesArray = [];
  bytesArray.push(hexToBytes(intToHex(address.version, 1)));
  bytesArray.push(hexToBytes(address.hash160));
  return concatArray(bytesArray);
}

export function deserializeAddress(serialized: string | Uint8Array | BytesReader): AddressWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const version = hexToInt(bytesToHex(bytesReader.readBytes(1)));
  const data = bytesToHex(bytesReader.readBytes(20));

  return { type: StacksWireType.Address, version, hash160: data };
}

export function serializePrincipal(principal: PostConditionPrincipalWire): string {
  return bytesToHex(serializePrincipalBytes(principal));
}
export function serializePrincipalBytes(principal: PostConditionPrincipalWire): Uint8Array {
  const bytesArray = [];
  bytesArray.push(principal.prefix);
  if (
    principal.prefix === PostConditionPrincipalId.Standard ||
    principal.prefix === PostConditionPrincipalId.Contract
  ) {
    bytesArray.push(serializeAddressBytes(principal.address));
  }
  if (principal.prefix === PostConditionPrincipalId.Contract) {
    bytesArray.push(serializeLPStringBytes(principal.contractName));
  }
  return concatArray(bytesArray);
}

export function deserializePrincipal(
  serialized: string | Uint8Array | BytesReader
): PostConditionPrincipalWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const prefix = bytesReader.readUInt8Enum(PostConditionPrincipalId, n => {
    throw new DeserializationError(`Unexpected Principal payload type: ${n}`);
  });
  if (prefix === PostConditionPrincipalId.Origin) {
    return { type: StacksWireType.Principal, prefix } as OriginPrincipalWire;
  }
  const address = deserializeAddress(bytesReader);
  if (prefix === PostConditionPrincipalId.Standard) {
    return { type: StacksWireType.Principal, prefix, address } as StandardPrincipalWire;
  }
  const contractName = deserializeLPString(bytesReader);
  return {
    type: StacksWireType.Principal,
    prefix,
    address,
    contractName,
  } as ContractPrincipalWire;
}

export function serializeLPString(lps: LengthPrefixedStringWire): string {
  return bytesToHex(serializeLPStringBytes(lps));
}
export function serializeLPStringBytes(lps: LengthPrefixedStringWire): Uint8Array {
  const bytesArray = [];
  const contentBytes = utf8ToBytes(lps.content);
  const length = contentBytes.byteLength;
  bytesArray.push(hexToBytes(intToHex(length, lps.lengthPrefixBytes)));
  bytesArray.push(contentBytes);
  return concatArray(bytesArray);
}

export function deserializeLPString(
  serialized: string | Uint8Array | BytesReader,
  prefixBytes?: number,
  maxLength?: number
): LengthPrefixedStringWire {
  prefixBytes = prefixBytes ? prefixBytes : 1;
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const length = hexToInt(bytesToHex(bytesReader.readBytes(prefixBytes)));
  const content = bytesToUtf8(bytesReader.readBytes(length));
  return createLPString(content, prefixBytes, maxLength ?? 128);
}

export function serializeMemoString(memoString: MemoStringWire): string {
  return bytesToHex(serializeMemoStringBytes(memoString));
}
export function serializeMemoStringBytes(memoString: MemoStringWire): Uint8Array {
  const bytesArray = [];
  const contentBytes = utf8ToBytes(memoString.content);
  const paddedContent = rightPadHexToLength(bytesToHex(contentBytes), MEMO_MAX_LENGTH_BYTES * 2);
  bytesArray.push(hexToBytes(paddedContent));
  return concatArray(bytesArray);
}

export function deserializeMemoString(
  serialized: string | Uint8Array | BytesReader
): MemoStringWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  let content = bytesToUtf8(bytesReader.readBytes(MEMO_MAX_LENGTH_BYTES));
  // eslint-disable-next-line no-control-regex -- intentional: strip trailing null bytes
  content = content.replace(/\u0000*$/, ''); // remove all trailing unicode null characters
  return { type: StacksWireType.MemoString, content };
}

export function serializeAsset(info: AssetWire): string {
  return bytesToHex(serializeAssetBytes(info));
}
export function serializeAssetBytes(info: AssetWire): Uint8Array {
  const bytesArray = [];
  bytesArray.push(serializeAddressBytes(info.address));
  bytesArray.push(serializeLPStringBytes(info.contractName));
  bytesArray.push(serializeLPStringBytes(info.assetName));
  return concatArray(bytesArray);
}

export function deserializeAsset(serialized: string | Uint8Array | BytesReader): AssetWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  return {
    type: StacksWireType.Asset,
    address: deserializeAddress(bytesReader),
    contractName: deserializeLPString(bytesReader),
    assetName: deserializeLPString(bytesReader),
  };
}

export function serializeLPList(lpList: LengthPrefixedList): string {
  return bytesToHex(serializeLPListBytes(lpList));
}
export function serializeLPListBytes(lpList: LengthPrefixedList): Uint8Array {
  const list = lpList.values;
  const bytesArray = [];
  bytesArray.push(hexToBytes(intToHex(list.length, lpList.lengthPrefixBytes)));
  for (const l of list) {
    bytesArray.push(serializeStacksWireBytes(l));
  }
  return concatArray(bytesArray);
}

export function deserializeLPList<
  TType extends StacksWireType = StacksWireType,
  TWire extends StacksWire = TType extends StacksWireType.Address
    ? AddressWire
    : TType extends StacksWireType.LengthPrefixedString
      ? LengthPrefixedStringWire
      : TType extends StacksWireType.MemoString
        ? MemoStringWire
        : TType extends StacksWireType.Asset
          ? AssetWire
          : TType extends StacksWireType.PostCondition
            ? PostConditionWire
            : TType extends StacksWireType.PublicKey
              ? PublicKeyWire
              : TType extends StacksWireType.TransactionAuthField
                ? TransactionAuthFieldWire
                : StacksWire,
>(
  serialized: string | Uint8Array | BytesReader,
  type: TType,
  lengthPrefixBytes?: number
  // todo: `next` refactor for inversion of control
): LengthPrefixedList<TWire> {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const length = hexToInt(bytesToHex(bytesReader.readBytes(lengthPrefixBytes || 4)));

  const l: StacksWire[] = [];
  for (let index = 0; index < length; index++) {
    switch (type) {
      case StacksWireType.Address:
        l.push(deserializeAddress(bytesReader));
        break;
      case StacksWireType.LengthPrefixedString:
        l.push(deserializeLPString(bytesReader));
        break;
      case StacksWireType.MemoString:
        l.push(deserializeMemoString(bytesReader));
        break;
      case StacksWireType.Asset:
        l.push(deserializeAsset(bytesReader));
        break;
      case StacksWireType.PostCondition:
        l.push(deserializePostConditionWire(bytesReader));
        break;
      case StacksWireType.PublicKey:
        l.push(deserializePublicKey(bytesReader));
        break;
      case StacksWireType.TransactionAuthField:
        l.push(deserializeTransactionAuthField(bytesReader));
        break;
    }
  }
  return createLPList<TWire>(l as TWire[], lengthPrefixBytes);
}

export function serializePostConditionWire(postCondition: PostConditionWire): string {
  return bytesToHex(serializePostConditionWireBytes(postCondition));
}

export function serializePostConditionWireBytes(postCondition: PostConditionWire): Uint8Array {
  const bytesArray = [];
  bytesArray.push(postCondition.conditionType);
  bytesArray.push(serializePrincipalBytes(postCondition.principal));

  if (
    postCondition.conditionType === PostConditionType.Fungible ||
    postCondition.conditionType === PostConditionType.NonFungible
  ) {
    bytesArray.push(serializeAssetBytes(postCondition.asset));
  }

  if (postCondition.conditionType === PostConditionType.NonFungible) {
    bytesArray.push(serializeCVBytes(postCondition.assetName));
  }

  bytesArray.push(postCondition.conditionCode);

  if (
    postCondition.conditionType === PostConditionType.STX ||
    postCondition.conditionType === PostConditionType.Fungible ||
    postCondition.conditionType === PostConditionType.Staking
  ) {
    // SIP-005: Maximal length of amount is 8 bytes
    if (postCondition.amount > BigInt('0xffffffffffffffff'))
      throw new SerializationError('The post-condition amount may not be larger than 8 bytes');
    bytesArray.push(intToBytes(postCondition.amount, 8));
  }

  return concatArray(bytesArray);
}

export function deserializePostConditionWire(
  serialized: string | Uint8Array | BytesReader
): PostConditionWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const postConditionType = bytesReader.readUInt8Enum(PostConditionType, n => {
    throw new DeserializationError(`Could not read ${n} as PostConditionType`);
  });

  const principal = deserializePrincipal(bytesReader);

  let conditionCode;
  let asset;
  let amount: bigint;
  switch (postConditionType) {
    case PostConditionType.STX:
      conditionCode = bytesReader.readUInt8Enum(FungibleConditionCode, n => {
        throw new DeserializationError(`Could not read ${n} as FungibleConditionCode`);
      });
      amount = BigInt(`0x${bytesToHex(bytesReader.readBytes(8))}`);
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.STX,
        principal,
        conditionCode,
        amount,
      };
    case PostConditionType.Fungible:
      asset = deserializeAsset(bytesReader);
      conditionCode = bytesReader.readUInt8Enum(FungibleConditionCode, n => {
        throw new DeserializationError(`Could not read ${n} as FungibleConditionCode`);
      });
      amount = BigInt(`0x${bytesToHex(bytesReader.readBytes(8))}`);
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.Fungible,
        principal,
        conditionCode,
        amount,
        asset: asset,
      };
    case PostConditionType.NonFungible:
      asset = deserializeAsset(bytesReader);
      const assetName = deserializeCV(bytesReader);
      conditionCode = bytesReader.readUInt8Enum(NonFungibleConditionCode, n => {
        throw new DeserializationError(`Could not read ${n} as FungibleConditionCode`);
      });
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.NonFungible,
        principal,
        conditionCode,
        asset,
        assetName,
      };
    case PostConditionType.Staking:
      conditionCode = bytesReader.readUInt8Enum(FungibleConditionCode, n => {
        throw new DeserializationError(`Could not read ${n} as FungibleConditionCode`);
      });
      amount = BigInt(`0x${bytesToHex(bytesReader.readBytes(8))}`);
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.Staking,
        principal,
        conditionCode,
        amount,
      };
    case PostConditionType.PoX: {
      const poxConditionCode = bytesReader.readUInt8Enum(PoxConditionCode, n => {
        throw new DeserializationError(`Could not read ${n} as PoxConditionCode`);
      });
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.PoX,
        principal,
        conditionCode: poxConditionCode,
      };
    }
  }
}

export function serializePayload(payload: PayloadInput): string {
  return bytesToHex(serializePayloadBytes(payload));
}
/** @ignore */
export function serializePayloadBytes(payload: PayloadInput): Uint8Array {
  const bytesArray = [];
  bytesArray.push(payload.payloadType);

  switch (payload.payloadType) {
    case PayloadType.TokenTransfer:
      bytesArray.push(serializeCVBytes(payload.recipient));
      bytesArray.push(intToBytes(payload.amount, 8));
      bytesArray.push(serializeStacksWireBytes(payload.memo));
      break;
    case PayloadType.ContractCall:
      bytesArray.push(serializeStacksWireBytes(payload.contractAddress));
      bytesArray.push(serializeStacksWireBytes(payload.contractName));
      bytesArray.push(serializeStacksWireBytes(payload.functionName));
      const numArgs = new Uint8Array(4);
      writeUInt32BE(numArgs, payload.functionArgs.length, 0);
      bytesArray.push(numArgs);
      payload.functionArgs.forEach(arg => {
        bytesArray.push(serializeCVBytes(arg));
      });
      break;
    case PayloadType.SmartContract:
      bytesArray.push(serializeStacksWireBytes(payload.contractName));
      bytesArray.push(serializeStacksWireBytes(payload.codeBody));
      break;
    case PayloadType.VersionedSmartContract:
      bytesArray.push(payload.clarityVersion);
      bytesArray.push(serializeStacksWireBytes(payload.contractName));
      bytesArray.push(serializeStacksWireBytes(payload.codeBody));
      break;
    case PayloadType.PoisonMicroblock:
      // TODO: implement
      break;
    case PayloadType.Coinbase:
      bytesArray.push(payload.coinbaseBytes);
      break;
    case PayloadType.CoinbaseToAltRecipient:
      bytesArray.push(payload.coinbaseBytes);
      bytesArray.push(serializeCVBytes(payload.recipient));
      break;
    case PayloadType.NakamotoCoinbase:
      bytesArray.push(payload.coinbaseBytes);
      bytesArray.push(serializeCVBytes(payload.recipient ? someCV(payload.recipient) : noneCV()));
      bytesArray.push(payload.vrfProof);
      break;
    case PayloadType.TenureChange:
      bytesArray.push(hexToBytes(payload.tenureHash));
      bytesArray.push(hexToBytes(payload.previousTenureHash));
      bytesArray.push(hexToBytes(payload.burnViewHash));
      bytesArray.push(hexToBytes(payload.previousTenureEnd));
      bytesArray.push(writeUInt32BE(new Uint8Array(4), payload.previousTenureBlocks));
      bytesArray.push(writeUInt8(new Uint8Array(1), payload.cause));
      bytesArray.push(hexToBytes(payload.publicKeyHash));
      break;
  }

  return concatArray(bytesArray);
}

/** @ignore */
export function deserializePayload(serialized: string | Uint8Array | BytesReader): PayloadWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const payloadType = bytesReader.readUInt8Enum(PayloadType, n => {
    throw new Error(`Cannot recognize PayloadType: ${n}`);
  });

  switch (payloadType) {
    case PayloadType.TokenTransfer:
      const recipient = deserializeCV(bytesReader) as PrincipalCV;
      const amount = intToBigInt(bytesReader.readBytes(8));
      const memo = deserializeMemoString(bytesReader);
      return createTokenTransferPayload(recipient, amount, memo);
    case PayloadType.ContractCall:
      const contractAddress = deserializeAddress(bytesReader);
      const contractCallName = deserializeLPString(bytesReader);
      const functionName = deserializeLPString(bytesReader);
      const functionArgs: ClarityValue[] = [];
      const numberOfArgs = bytesReader.readUInt32BE();
      for (let i = 0; i < numberOfArgs; i++) {
        const clarityValue = deserializeCV(bytesReader);
        functionArgs.push(clarityValue);
      }
      return createContractCallPayload(
        contractAddress,
        contractCallName,
        functionName,
        functionArgs
      );
    case PayloadType.SmartContract:
      const smartContractName = deserializeLPString(bytesReader);
      const codeBody = deserializeLPString(bytesReader, 4, 100_000);
      return createSmartContractPayload(smartContractName, codeBody);

    case PayloadType.VersionedSmartContract: {
      const clarityVersion = bytesReader.readUInt8Enum(ClarityVersion, n => {
        throw new Error(`Cannot recognize ClarityVersion: ${n}`);
      });
      const smartContractName = deserializeLPString(bytesReader);
      const codeBody = deserializeLPString(bytesReader, 4, STRING_MAX_LENGTH);
      return createSmartContractPayload(smartContractName, codeBody, clarityVersion);
    }
    case PayloadType.PoisonMicroblock:
      // TODO: implement
      return createPoisonPayload();
    case PayloadType.Coinbase: {
      const coinbaseBytes = bytesReader.readBytes(COINBASE_BYTES_LENGTH);
      return createCoinbasePayload(coinbaseBytes);
    }
    case PayloadType.CoinbaseToAltRecipient: {
      const coinbaseBytes = bytesReader.readBytes(COINBASE_BYTES_LENGTH);
      const altRecipient = deserializeCV(bytesReader) as PrincipalCV;
      return createCoinbasePayload(coinbaseBytes, altRecipient);
    }
    case PayloadType.NakamotoCoinbase: {
      const coinbaseBytes = bytesReader.readBytes(COINBASE_BYTES_LENGTH);
      const recipient = deserializeCV(bytesReader) as OptionalCV<PrincipalCV>;
      const vrfProof = bytesReader.readBytes(VRF_PROOF_BYTES_LENGTH);
      return createNakamotoCoinbasePayload(coinbaseBytes, recipient, vrfProof);
    }
    case PayloadType.TenureChange:
      const tenureHash = bytesToHex(bytesReader.readBytes(20));
      const previousTenureHash = bytesToHex(bytesReader.readBytes(20));
      const burnViewHash = bytesToHex(bytesReader.readBytes(20));
      const previousTenureEnd = bytesToHex(bytesReader.readBytes(32));
      const previousTenureBlocks = bytesReader.readUInt32BE();
      const cause = bytesReader.readUInt8Enum(TenureChangeCause, n => {
        throw new Error(`Cannot recognize TenureChangeCause: ${n}`);
      });
      const publicKeyHash = bytesToHex(bytesReader.readBytes(20));
      return createTenureChangePayload(
        tenureHash,
        previousTenureHash,
        burnViewHash,
        previousTenureEnd,
        previousTenureBlocks,
        cause,
        publicKeyHash
      );
  }
}

/** @ignore */
export function deserializeMessageSignature(
  serialized: string | Uint8Array | BytesReader
): MessageSignatureWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  return createMessageSignature(
    bytesToHex(bytesReader.readBytes(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES))
  );
}

/** @ignore */
export function deserializeTransactionAuthField(
  serialized: string | Uint8Array | BytesReader
): TransactionAuthFieldWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const authFieldType = bytesReader.readUInt8Enum(AuthFieldType, n => {
    throw new DeserializationError(`Could not read ${n} as AuthFieldType`);
  });

  switch (authFieldType) {
    case AuthFieldType.PublicKeyCompressed:
      return createTransactionAuthField(
        PubKeyEncoding.Compressed,
        deserializePublicKey(bytesReader)
      );
    case AuthFieldType.PublicKeyUncompressed:
      return createTransactionAuthField(
        PubKeyEncoding.Uncompressed,
        createStacksPublicKey(uncompressPublicKey(deserializePublicKey(bytesReader).data))
      );
    case AuthFieldType.SignatureCompressed:
      return createTransactionAuthField(
        PubKeyEncoding.Compressed,
        deserializeMessageSignature(bytesReader)
      );
    case AuthFieldType.SignatureUncompressed:
      return createTransactionAuthField(
        PubKeyEncoding.Uncompressed,
        deserializeMessageSignature(bytesReader)
      );
    default:
      throw new Error(`Unknown auth field type: ${JSON.stringify(authFieldType)}`);
  }
}

export function serializeMessageSignature(messageSignature: MessageSignatureWire): string {
  return bytesToHex(serializeMessageSignatureBytes(messageSignature));
}
/** @ignore */
export function serializeMessageSignatureBytes(messageSignature: MessageSignatureWire): Uint8Array {
  return hexToBytes(messageSignature.data);
}

export function serializeTransactionAuthField(field: TransactionAuthFieldWire): string {
  return bytesToHex(serializeTransactionAuthFieldBytes(field));
}
/** @ignore */
export function serializeTransactionAuthFieldBytes(field: TransactionAuthFieldWire): Uint8Array {
  const bytesArray = [];

  switch (field.contents.type) {
    case StacksWireType.PublicKey:
      bytesArray.push(
        field.pubKeyEncoding === PubKeyEncoding.Compressed
          ? AuthFieldType.PublicKeyCompressed
          : AuthFieldType.PublicKeyUncompressed
      );
      bytesArray.push(hexToBytes(compressPublicKey(field.contents.data)));
      break;
    case StacksWireType.MessageSignature:
      bytesArray.push(
        field.pubKeyEncoding === PubKeyEncoding.Compressed
          ? AuthFieldType.SignatureCompressed
          : AuthFieldType.SignatureUncompressed
      );
      bytesArray.push(serializeMessageSignatureBytes(field.contents));
      break;
  }

  return concatArray(bytesArray);
}

export function serializePublicKey(key: PublicKeyWire): string {
  return bytesToHex(serializePublicKeyBytes(key));
}

/** @ignore */
export function serializePublicKeyBytes(key: PublicKeyWire): Uint8Array {
  return key.data.slice();
}

/** @ignore */
export function deserializePublicKey(serialized: string | Uint8Array | BytesReader): PublicKeyWire {
  const bytesReader = isInstance(serialized, BytesReader)
    ? serialized
    : new BytesReader(serialized);
  const fieldId = bytesReader.readUInt8();
  const keyLength =
    fieldId === 4 ? UNCOMPRESSED_PUBKEY_LENGTH_BYTES : COMPRESSED_PUBKEY_LENGTH_BYTES;
  return createStacksPublicKey(concatArray([fieldId, bytesReader.readBytes(keyLength)]));
}
