/**
 * Example: SIP-010 Token Operations
 * 
 * This example shows how to:
 * 1. Check token balance
 * 2. Transfer tokens
 * 3. Get token metadata
 */

import {
  callReadOnlyFunction,
  makeContractCall,
  broadcastTransaction,
  uintCV,
  principalCV,
  noneCV,
  someCV,
  stringUtf8CV,
  cvToJSON,
  AnchorMode,
  PostConditionMode,
  makeStandardFungiblePostCondition,
  FungibleConditionCode,
} from '@stacks/transactions';
import { StacksMainnet } from '@stacks/network';

const CONTRACT_ADDRESS = 'SP2PEBKJ2W1ZDDF2QQ6Y4FXKZEDPT9J9R2NKD9WJB';
const TOKEN_CONTRACT = 'sentinel-token';

const network = new StacksMainnet();

/**
 * Get token balance for an address
 */
async function getBalance(ownerAddress: string): Promise<bigint> {
  const result = await callReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: TOKEN_CONTRACT,
    functionName: 'get-balance',
    functionArgs: [principalCV(ownerAddress)],
    network: network,
    senderAddress: CONTRACT_ADDRESS,
  });

  const json = cvToJSON(result);
  
  if (json.success && json.value) {
    return BigInt(json.value.value);
  }
  
  return 0n;
}

/**
 * Get total token supply
 */
async function getTotalSupply(): Promise<bigint> {
  const result = await callReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: TOKEN_CONTRACT,
    functionName: 'get-total-supply',
    functionArgs: [],
    network: network,
    senderAddress: CONTRACT_ADDRESS,
  });

  const json = cvToJSON(result);
  return BigInt(json.value.value);
}

/**
 * Transfer tokens to another address
 */
async function transferTokens(
  amount: bigint,
  recipient: string,
  memo: string | null,
  senderKey: string
) {
  const functionArgs = [
    uintCV(amount),
    principalCV(CONTRACT_ADDRESS), // sender (derived from key)
    principalCV(recipient),
    memo ? someCV(stringUtf8CV(memo)) : noneCV(),
  ];

  const transaction = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: TOKEN_CONTRACT,
    functionName: 'transfer',
    functionArgs: functionArgs,
    senderKey: senderKey,
    network: network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Deny,
    // Add post-condition to protect user
    postConditions: [
      makeStandardFungiblePostCondition(
        CONTRACT_ADDRESS,
        FungibleConditionCode.Equal,
        amount,
        `${CONTRACT_ADDRESS}.${TOKEN_CONTRACT}::sentinel-token`
      ),
    ],
    fee: 30000n,
  });

  const broadcastResponse = await broadcastTransaction({ transaction, network });

  if ('error' in broadcastResponse) {
    throw new Error(`Transfer failed: ${broadcastResponse.error}`);
  }

  console.log('Transfer successful! TX:', broadcastResponse.txid);
  return broadcastResponse.txid;
}

/**
 * Format token amount for display (6 decimals)
 */
function formatTokenAmount(microAmount: bigint): string {
  const amount = Number(microAmount) / 1_000_000;
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

// Example usage
async function main() {
  const testAddress = 'SP2PEBKJ2W1ZDDF2QQ6Y4FXKZEDPT9J9R2NKD9WJB';

  // Get balance
  const balance = await getBalance(testAddress);
  console.log(`Balance: ${formatTokenAmount(balance)} SNTL`);

  // Get total supply
  const supply = await getTotalSupply();
  console.log(`Total Supply: ${formatTokenAmount(supply)} SNTL`);

  // Transfer example (uncomment with valid key)
  // await transferTokens(
  //   1000000n, // 1 SNTL
  //   'SP1234...recipient',
  //   'Payment for services',
  //   'YOUR_PRIVATE_KEY'
  // );
}

main().catch(console.error);


