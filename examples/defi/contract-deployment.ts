/**
 * Example: Deploy a Clarity smart contract programmatically
 * 
 * This example shows how to deploy a contract to Stacks blockchain
 * using stacks.js libraries.
 */

import {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
} from '@stacks/transactions';
import { StacksMainnet, StacksTestnet } from '@stacks/network';

// Contract source code (simple counter example)
const contractSource = `
;; Simple Counter Contract
(define-data-var counter uint u0)

(define-public (increment)
  (begin
    (var-set counter (+ (var-get counter) u1))
    (ok (var-get counter))
  )
)

(define-public (decrement)
  (begin
    (var-set counter (- (var-get counter) u1))
    (ok (var-get counter))
  )
)

(define-read-only (get-counter)
  (var-get counter)
)
`;

async function deployContract() {
  // Configuration
  const network = new StacksTestnet(); // Use StacksMainnet() for mainnet
  const senderKey = 'YOUR_PRIVATE_KEY_HERE'; // Never commit real keys!
  const contractName = 'my-counter';

  try {
    // Create the contract deploy transaction
    const transaction = await makeContractDeploy({
      codeBody: contractSource,
      contractName: contractName,
      senderKey: senderKey,
      network: network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: 50000n, // 0.05 STX
    });

    console.log('Transaction created:', transaction.txid());

    // Broadcast to the network
    const broadcastResponse = await broadcastTransaction({ transaction, network });

    if ('error' in broadcastResponse) {
      console.error('Broadcast failed:', broadcastResponse.error);
      return;
    }

    console.log('Transaction broadcast successfully!');
    console.log('TX ID:', broadcastResponse.txid);
    console.log(`Explorer: https://explorer.stacks.co/txid/${broadcastResponse.txid}`);

    return broadcastResponse.txid;
  } catch (error) {
    console.error('Deployment error:', error);
    throw error;
  }
}

// Run the deployment
deployContract()
  .then((txid) => console.log('Deployment initiated:', txid))
  .catch((err) => console.error('Failed:', err));


