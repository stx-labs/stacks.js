/**
 * Example: Interact with deployed Clarity contracts
 * 
 * This example demonstrates how to:
 * 1. Call read-only functions
 * 2. Call public functions (state-changing)
 * 3. Handle transaction responses
 */

import {
  callReadOnlyFunction,
  makeContractCall,
  broadcastTransaction,
  uintCV,
  stringAsciiCV,
  principalCV,
  cvToJSON,
  ClarityValue,
  AnchorMode,
} from '@stacks/transactions';
import { StacksMainnet, StacksTestnet } from '@stacks/network';

// Contract details
const CONTRACT_ADDRESS = 'SP2PEBKJ2W1ZDDF2QQ6Y4FXKZEDPT9J9R2NKD9WJB';
const CONTRACT_NAME = 'voting';

const network = new StacksMainnet();

/**
 * Read-only function call (no gas needed)
 */
async function getProposal(proposalId: number) {
  try {
    const result = await callReadOnlyFunction({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName: 'get-proposal',
      functionArgs: [uintCV(proposalId)],
      network: network,
      senderAddress: CONTRACT_ADDRESS, // Can be any valid address for read-only
    });

    const jsonResult = cvToJSON(result);
    console.log('Proposal:', jsonResult);
    return jsonResult;
  } catch (error) {
    console.error('Error reading proposal:', error);
    throw error;
  }
}

/**
 * Public function call (requires signature and gas)
 */
async function createProposal(
  title: string,
  description: string,
  duration: number,
  senderKey: string
) {
  try {
    const transaction = await makeContractCall({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName: 'create-proposal',
      functionArgs: [
        stringAsciiCV(title),
        stringAsciiCV(description),
        uintCV(duration),
      ],
      senderKey: senderKey,
      network: network,
      anchorMode: AnchorMode.Any,
      fee: 50000n,
    });

    console.log('Transaction created:', transaction.txid());

    const broadcastResponse = await broadcastTransaction({ transaction, network });

    if ('error' in broadcastResponse) {
      throw new Error(`Broadcast failed: ${broadcastResponse.error}`);
    }

    console.log('Proposal created! TX:', broadcastResponse.txid);
    return broadcastResponse.txid;
  } catch (error) {
    console.error('Error creating proposal:', error);
    throw error;
  }
}

/**
 * Vote on a proposal
 */
async function vote(
  proposalId: number,
  optionId: number, // 0 = Yes, 1 = No
  weight: number,
  senderKey: string
) {
  try {
    const transaction = await makeContractCall({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName: 'vote',
      functionArgs: [
        uintCV(proposalId),
        uintCV(optionId),
        uintCV(weight),
      ],
      senderKey: senderKey,
      network: network,
      anchorMode: AnchorMode.Any,
      fee: 30000n,
    });

    const broadcastResponse = await broadcastTransaction({ transaction, network });

    if ('error' in broadcastResponse) {
      throw new Error(`Vote failed: ${broadcastResponse.error}`);
    }

    console.log('Vote cast! TX:', broadcastResponse.txid);
    return broadcastResponse.txid;
  } catch (error) {
    console.error('Error voting:', error);
    throw error;
  }
}

// Example usage
async function main() {
  // Read proposal (no key needed)
  await getProposal(0);

  // Create proposal (requires private key)
  // const txid = await createProposal(
  //   'Increase Treasury',
  //   'Proposal to increase treasury allocation by 10%',
  //   10080, // ~7 days in blocks
  //   'YOUR_PRIVATE_KEY'
  // );

  // Vote on proposal
  // await vote(0, 0, 100, 'YOUR_PRIVATE_KEY'); // Vote Yes with weight 100
}

main().catch(console.error);


