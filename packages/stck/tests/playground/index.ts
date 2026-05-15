import { Cl } from '@stacks/transactions';
import { counterContract } from '../generated/typed';

const contract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter';

// approach A — function-style
import { makeUnsignedContractCallA } from '@stacks/stck';

makeUnsignedContractCallA(counterContract, {
  contract,
  functionName: 'increment',
  functionArgs: [],
  publicKey: '',
});

makeUnsignedContractCallA(counterContract, {
  contract,
  functionName: 'add',
  functionArgs: [Cl.uint(1)],
  publicKey: '',
});

// approach B — function-style
import { makeUnsignedContractCallB } from '@stacks/stck';

makeUnsignedContractCallB(counterContract, {
  contract,
  functionName: 'increment',
  functionArgs: [],
  publicKey: '...',
});

makeUnsignedContractCallB(counterContract, {
  contract,
  functionName: 'add',
  functionArgs: [Cl.uint(1)],
  publicKey: '...',
});

// contract wrapper — approach A
import { contractA } from '@stacks/stck';

const counterA = contractA(counterContract, {
  contract,
  publicKey: '',
  network: 'testnet',
});

counterA.makeUnsignedContractCall('increment', []);
counterA.makeUnsignedContractCall('add', [5]);
counterA.makeUnsignedContractCall('add', [5n]);
counterA.makeUnsignedContractCall('add', [Cl.uint(5)]);
counterA.makeUnsignedContractCall('add', [5], { fee: 1000n, nonce: 7n });

// read-only
counterA.fetchCallReadOnlyFunction('getCount', []);
counterA.fetchCallReadOnlyFunction('getCount', [], { senderAddress: 'ST2...' });

// contract wrapper — approach B
import { contractB } from '@stacks/stck';

const counterB = contractB(counterContract, {
  contract,
  publicKey: '',
  network: 'testnet',
});

counterB.makeUnsignedContractCall('increment', []);
counterB.makeUnsignedContractCall('add', [5]);
counterB.makeUnsignedContractCall('add', [5n]);
counterB.makeUnsignedContractCall('add', [Cl.uint(5)]);
counterB.makeUnsignedContractCall('add', [5], { fee: 1000n, nonce: 7n });

// read-only
counterB.fetchCallReadOnlyFunction('get-count', []);
counterB.fetchCallReadOnlyFunction('get-count', [], { senderAddress: 'ST2...' });
