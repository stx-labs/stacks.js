export { makeUnsignedContractCallA } from './approach-a';
export { makeUnsignedContractCallB } from './approach-b';
export { contractA } from './contract-a';
export { contractB } from './contract-b';

export type {
  ArgInputsFromBundleA,
  PublicFunctionNames,
  ReadOnlyFunctionNames,
  TypedOptionsA,
  TypegenContractInterface,
} from './approach-a';
export type { TypedOptionsB } from './approach-b';
export type {
  ContractBindingsA,
  ContractClientForBundleA,
  PerCallOptions,
  PerCallReadOnlyOptions,
} from './contract-a';
export type { ContractBindingsB, ContractClientB } from './contract-b';
export type { ContractBundle, ExtractContractInterface } from './brand';
export type {
  AbiToContractInterface,
  AbiTypeToCv,
  Args,
  FunctionNames,
  Return,
} from './abi-types';
export type {
  AbiTypeToPrimitive,
  ArgInputs,
  ArgInputsFromAbi,
  CvToPrimitive,
} from './primitive-types';

export { kebabToCamel, findClarityFunctionName } from './common';
export type { KebabToCamel } from './common';
export { toClarityValue, coerceArgs, isClarityValue } from './coerce';

// Approach D — branded Principal<T> on top of the existing @stacks/transactions API
export {
  principal,
  getBundle,
  splitPrincipal,
  typedCall,
  typedReadOnlyCall,
  makeUnsignedContractCall as makeUnsignedContractCallD,
  fetchCallReadOnlyFunction as fetchCallReadOnlyFunctionD,
} from './approach-d';
export type {
  Principal,
  TypedCallDescriptor,
  TypedCallOptionsD,
  TypedReadOnlyOptionsD,
} from './approach-d';

// Approach E: branded principal, standalone (named-record args, no bundle import at call site)
export {
  principal as principalE,
  definePrincipal,
  call as callE,
  read as readE,
  bind as bindE,
} from './approach-e';
export type {
  Principal as PrincipalE,
  CallOptions as ECallOptions,
  ReadOptions as EReadOptions,
  BoundClient as EBoundClient,
} from './approach-e';

// Approach F: openapi-fetch-style createClient<Contracts>
export { createClient } from './approach-f';
export type {
  Client,
  ContractHandle,
  ContractKeys,
  ContractShape,
  ContractsShape,
  CreateClientOptions,
  DeployedContract,
  FetchCallReadOnlyArgs,
  FunctionArgs,
  FunctionKeys,
  FunctionKeysByAccess,
  FunctionReturn,
  MakeUnsignedContractCallArgs,
} from './approach-f';
