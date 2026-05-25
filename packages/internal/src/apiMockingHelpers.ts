import { Configuration, TransactionsApi } from '@stacks/blockchain-api-client';
import { STACKS_TESTNET } from '@stacks/network';
import { MockResponseInitFunction } from 'jest-fetch-mock';
import { StackingClient } from '@stacks/stacking';

// NOTES
// Capture traffic via the fetchWrapper
// ```ts
// const body = await fetchResult.clone().text();
// const path = new URL(typeof input === 'string' ? input : input?.url).pathname;
// fs.appendFileSync('./network.txt', `'${path}': \`${body}\`,\n`);
// ```
// Disable mocking for individual tests locally
// ```ts
// fetchMock.disableMocks();
// ```

// Helpers for creating tests with unmocked environments =======================

const MATCHER = {
  ALL: /.*/,
};

// todo: maybe something similar could be generalized to work in all package tests
export function setApiMocks(responseMap: { [key: string]: any }, mockTxBroadcast = true) {
  // we want to be able to call setApiMocks and it do nothing if mocking is currently disabled
  // (maybe move this to inside the mockIf handler, for better enabling/disabling mocking during a run)
  if (!isMocking()) return;

  if (mockTxBroadcast)
    responseMap = {
      '/v2/transactions': V2_TXS,
      '/v2/fees/transaction': V2_FEES,
      ...responseMap,
    };

  fetchMock.mockIf(MATCHER.ALL, (async (request: Request) => {
    const { path } = (request as any)[Object.getOwnPropertySymbols(request)[1]].parsedURL; // may depend on js runtime

    if (!responseMap.hasOwnProperty(path)) {
      return console.log(`☐ Not mocking '${path}'`);
    }

    if (process.env.NODE_DEBUG) {
      console.log(`☑︎ Mocking '${path}'`);
    }

    const response = responseMap[path as string];
    if (typeof response === 'string') return response;
    return JSON.stringify(response);
  }) as MockResponseInitFunction);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMocking(): boolean {
  const result = fetchMock.isMocking(''); // be careful using .isMocking, it will consume .mockOnce's
  if (typeof result === 'boolean') return result;
  return result[0];
}

const MAX_ITERATIONS = 120;
const ITERATION_INTERVAL = 1000;

export async function waitForTx(txId: string, apiUrl = 'http://localhost:3999') {
  if (isMocking()) return;

  const txApi = new TransactionsApi(new Configuration({ basePath: apiUrl }));

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    try {
      const txInfo = (await txApi.getTransactionById({ txId })) as any;
      console.log('txInfo', txInfo);
      if (txInfo?.tx_status === 'success') {
        console.log(`✓ ${JSON.stringify(txInfo?.tx_result)}`);
        return txInfo;
      } else if (txInfo?.tx_result) {
        return console.log(`✕ ${JSON.stringify(txInfo.tx_result)}`);
      }
    } catch (e: any) {
      if (e?.ok === false) throw Error(`✕ ${e?.status}: ${txId}`);
      throw e;
    }
    console.log(`waiting (${i}x)`);
    await sleep(ITERATION_INTERVAL);
  }
}

export async function waitForBlock(burnBlockId: number, client?: StackingClient) {
  if (isMocking()) return;

  client =
    client ??
    new StackingClient({
      address: '',
      network: STACKS_TESTNET,
      client: { baseUrl: 'http://localhost:3999' },
    });

  let current: number;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const poxInfo = await client.getPoxInfo();
    current = poxInfo?.current_burnchain_block_height as number;
    if (current && current >= burnBlockId) {
      console.log(`→ block ${current} reached`);
      return;
    }
    console.log(`waiting (${i}x) for block ${burnBlockId} (current block: ${current})`);
    await sleep(ITERATION_INTERVAL);
  }
}

// todo: add more generic method (ie merge with previous method)
export async function waitForCycle(cycleId: number, client?: StackingClient) {
  if (isMocking()) return;

  client =
    client ??
    new StackingClient({
      address: '',
      network: STACKS_TESTNET,
      client: { baseUrl: 'http://localhost:3999' },
    });

  let current: number;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const poxInfo = await client.getPoxInfo();
    current = poxInfo?.reward_cycle_id;
    if (current && current >= cycleId) {
      console.log(`→ cycle ${current} reached`);
      return;
    }
    console.log(`waiting (${i}x) for cycle ${cycleId} (current cycle: ${current})`);
    await sleep(ITERATION_INTERVAL);
  }
}

// === PATHS ===================================================================
export const V2_TXS = `"0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a"`;
export const V2_FEES = `{"estimated_cost":{"write_length":1138,"write_count":10,"read_length":60638,"read_count":34,"runtime":645443},"estimated_cost_scalar":12,"estimations":[{"fee_rate":1083.4556141387698,"fee":13001},{"fee_rate":1083.4556141387698,"fee":13001},{"fee_rate":1083.4556141387698,"fee":13001}],"cost_scalar_change_by_byte":0.00476837158203125}`;
export const V2_POX_MAINNET_POX_2 = `{"contract_id":"SP000000000000000000002Q6VF78.pox-2","pox_activation_threshold_ustx":68809653919448,"first_burnchain_block_height":666050,"current_burnchain_block_height":788791,"prepare_phase_block_length":100,"reward_phase_block_length":2000,"reward_slots":4000,"rejection_fraction":25,"total_liquid_supply_ustx":1376193078388960,"current_cycle":{"id":58,"min_threshold_ustx":90000000000,"stacked_ustx":225878587321503,"is_pox_active":false},"next_cycle":{"id":59,"min_threshold_ustx":90000000000,"min_increment_ustx":68809653919,"stacked_ustx":195129336384433,"prepare_phase_start_block_height":789850,"blocks_until_prepare_phase":1059,"reward_phase_start_block_height":789950,"blocks_until_reward_phase":1159,"ustx_until_pox_rejection":344048269597225},"min_amount_ustx":90000000000,"prepare_cycle_length":100,"reward_cycle_id":58,"reward_cycle_length":2100,"rejection_votes_left_required":344048269597225,"next_reward_cycle_in":1159,"contract_versions":[{"contract_id":"SP000000000000000000002Q6VF78.pox","activation_burnchain_block_height":666050,"first_reward_cycle_id":0},{"contract_id":"SP000000000000000000002Q6VF78.pox-2","activation_burnchain_block_height":781552,"first_reward_cycle_id":56}]}`;
export const V2_POX_REGTEST_POX_3 = `{"contract_id":"ST000000000000000000002AMW42H.pox-3","pox_activation_threshold_ustx":600059459544055,"first_burnchain_block_height":0,"current_burnchain_block_height":408,"prepare_phase_block_length":1,"reward_phase_block_length":4,"reward_slots":8,"rejection_fraction":3333333333333333,"total_liquid_supply_ustx":60005945954405576,"current_cycle":{"id":81,"min_threshold_ustx":1875190000000000,"stacked_ustx":1875190000000000,"is_pox_active":false},"next_cycle":{"id":82,"min_threshold_ustx":1875190000000000,"min_increment_ustx":7500743244300,"stacked_ustx":1875190000000000,"prepare_phase_start_block_height":409,"blocks_until_prepare_phase":1,"reward_phase_start_block_height":410,"blocks_until_reward_phase":2,"ustx_until_pox_rejection":12734475822413576000},"min_amount_ustx":1875190000000000,"prepare_cycle_length":1,"reward_cycle_id":81,"reward_cycle_length":5,"rejection_votes_left_required":12734475822413576000,"next_reward_cycle_in":2,"contract_versions":[{"contract_id":"ST000000000000000000002AMW42H.pox","activation_burnchain_block_height":0,"first_reward_cycle_id":0},{"contract_id":"ST000000000000000000002AMW42H.pox-2","activation_burnchain_block_height":107,"first_reward_cycle_id":22},{"contract_id":"ST000000000000000000002AMW42H.pox-3","activation_burnchain_block_height":111,"first_reward_cycle_id":23}]}`;
export const V2_POX_INTERFACE_POX_3 = `{"functions":[{"name":"add-pox-addr-to-ith-reward-cycle","access":"private","args":[{"name":"cycle-index","type":"uint128"},{"name":"params","type":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"first-reward-cycle","type":"uint128"},{"name":"i","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-set-indexes","type":{"list":{"type":"uint128","length":12}}},{"name":"stacker","type":{"optional":"principal"}}]}}],"outputs":{"type":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"first-reward-cycle","type":"uint128"},{"name":"i","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-set-indexes","type":{"list":{"type":"uint128","length":12}}},{"name":"stacker","type":{"optional":"principal"}}]}}},{"name":"add-pox-addr-to-reward-cycles","access":"private","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"first-reward-cycle","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"amount-ustx","type":"uint128"},{"name":"stacker","type":"principal"}],"outputs":{"type":{"response":{"ok":{"list":{"type":"uint128","length":12}},"error":"int128"}}}},{"name":"add-pox-partial-stacked","access":"private","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"first-reward-cycle","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"amount-ustx","type":"uint128"}],"outputs":{"type":"bool"}},{"name":"add-pox-partial-stacked-to-ith-cycle","access":"private","args":[{"name":"cycle-index","type":"uint128"},{"name":"params","type":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"}]}}],"outputs":{"type":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"num-cycles","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"}]}}},{"name":"append-reward-cycle-pox-addr","access":"private","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"},{"name":"amount-ustx","type":"uint128"},{"name":"stacker","type":{"optional":"principal"}}],"outputs":{"type":"uint128"}},{"name":"fold-unlock-reward-cycle","access":"private","args":[{"name":"set-index","type":"uint128"},{"name":"data-res","type":{"response":{"ok":{"tuple":[{"name":"cycle","type":"uint128"},{"name":"first-unlocked-cycle","type":"uint128"},{"name":"stacker","type":"principal"}]},"error":"int128"}}}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"cycle","type":"uint128"},{"name":"first-unlocked-cycle","type":"uint128"},{"name":"stacker","type":"principal"}]},"error":"int128"}}}},{"name":"handle-unlock","access":"private","args":[{"name":"user","type":"principal"},{"name":"amount-locked","type":"uint128"},{"name":"cycle-to-unlock","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"increase-reward-cycle-entry","access":"private","args":[{"name":"reward-cycle-index","type":"uint128"},{"name":"updates","type":{"optional":{"tuple":[{"name":"add-amount","type":"uint128"},{"name":"first-cycle","type":"uint128"},{"name":"reward-cycle","type":"uint128"},{"name":"stacker","type":"principal"}]}}}],"outputs":{"type":{"optional":{"tuple":[{"name":"add-amount","type":"uint128"},{"name":"first-cycle","type":"uint128"},{"name":"reward-cycle","type":"uint128"},{"name":"stacker","type":"principal"}]}}}},{"name":"inner-stack-aggregation-commit","access":"private","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":{"response":{"ok":"uint128","error":"int128"}}}},{"name":"allow-contract-caller","access":"public","args":[{"name":"caller","type":"principal"},{"name":"until-burn-ht","type":{"optional":"uint128"}}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"delegate-stack-extend","access":"public","args":[{"name":"stacker","type":"principal"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"extend-count","type":"uint128"}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"stacker","type":"principal"},{"name":"unlock-burn-height","type":"uint128"}]},"error":"int128"}}}},{"name":"delegate-stack-increase","access":"public","args":[{"name":"stacker","type":"principal"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"increase-by","type":"uint128"}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"stacker","type":"principal"},{"name":"total-locked","type":"uint128"}]},"error":"int128"}}}},{"name":"delegate-stack-stx","access":"public","args":[{"name":"stacker","type":"principal"},{"name":"amount-ustx","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"start-burn-ht","type":"uint128"},{"name":"lock-period","type":"uint128"}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"lock-amount","type":"uint128"},{"name":"stacker","type":"principal"},{"name":"unlock-burn-height","type":"uint128"}]},"error":"int128"}}}},{"name":"delegate-stx","access":"public","args":[{"name":"amount-ustx","type":"uint128"},{"name":"delegate-to","type":"principal"},{"name":"until-burn-ht","type":{"optional":"uint128"}},{"name":"pox-addr","type":{"optional":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}}}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"disallow-contract-caller","access":"public","args":[{"name":"caller","type":"principal"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"reject-pox","access":"public","args":[],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"revoke-delegate-stx","access":"public","args":[],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"set-burnchain-parameters","access":"public","args":[{"name":"first-burn-height","type":"uint128"},{"name":"prepare-cycle-length","type":"uint128"},{"name":"reward-cycle-length","type":"uint128"},{"name":"rejection-fraction","type":"uint128"},{"name":"begin-2-1-reward-cycle","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"stack-aggregation-commit","access":"public","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"stack-aggregation-commit-indexed","access":"public","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":{"response":{"ok":"uint128","error":"int128"}}}},{"name":"stack-aggregation-increase","access":"public","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"},{"name":"reward-cycle-index","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"stack-extend","access":"public","args":[{"name":"extend-count","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"stacker","type":"principal"},{"name":"unlock-burn-height","type":"uint128"}]},"error":"int128"}}}},{"name":"stack-increase","access":"public","args":[{"name":"increase-by","type":"uint128"}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"stacker","type":"principal"},{"name":"total-locked","type":"uint128"}]},"error":"int128"}}}},{"name":"stack-stx","access":"public","args":[{"name":"amount-ustx","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"start-burn-ht","type":"uint128"},{"name":"lock-period","type":"uint128"}],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"lock-amount","type":"uint128"},{"name":"stacker","type":"principal"},{"name":"unlock-burn-height","type":"uint128"}]},"error":"int128"}}}},{"name":"burn-height-to-reward-cycle","access":"read_only","args":[{"name":"height","type":"uint128"}],"outputs":{"type":"uint128"}},{"name":"can-stack-stx","access":"read_only","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"amount-ustx","type":"uint128"},{"name":"first-reward-cycle","type":"uint128"},{"name":"num-cycles","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"check-caller-allowed","access":"read_only","args":[],"outputs":{"type":"bool"}},{"name":"check-pox-addr-hashbytes","access":"read_only","args":[{"name":"version","type":{"buffer":{"length":1}}},{"name":"hashbytes","type":{"buffer":{"length":32}}}],"outputs":{"type":"bool"}},{"name":"check-pox-addr-version","access":"read_only","args":[{"name":"version","type":{"buffer":{"length":1}}}],"outputs":{"type":"bool"}},{"name":"check-pox-lock-period","access":"read_only","args":[{"name":"lock-period","type":"uint128"}],"outputs":{"type":"bool"}},{"name":"current-pox-reward-cycle","access":"read_only","args":[],"outputs":{"type":"uint128"}},{"name":"get-allowance-contract-callers","access":"read_only","args":[{"name":"sender","type":"principal"},{"name":"calling-contract","type":"principal"}],"outputs":{"type":{"optional":{"tuple":[{"name":"until-burn-ht","type":{"optional":"uint128"}}]}}}},{"name":"get-check-delegation","access":"read_only","args":[{"name":"stacker","type":"principal"}],"outputs":{"type":{"optional":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"delegated-to","type":"principal"},{"name":"pox-addr","type":{"optional":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}}},{"name":"until-burn-ht","type":{"optional":"uint128"}}]}}}},{"name":"get-delegation-info","access":"read_only","args":[{"name":"stacker","type":"principal"}],"outputs":{"type":{"optional":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"delegated-to","type":"principal"},{"name":"pox-addr","type":{"optional":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}}},{"name":"until-burn-ht","type":{"optional":"uint128"}}]}}}},{"name":"get-num-reward-set-pox-addresses","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":"uint128"}},{"name":"get-partial-stacked-by-cycle","access":"read_only","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"},{"name":"sender","type":"principal"}],"outputs":{"type":{"optional":{"tuple":[{"name":"stacked-amount","type":"uint128"}]}}}},{"name":"get-pox-info","access":"read_only","args":[],"outputs":{"type":{"response":{"ok":{"tuple":[{"name":"current-rejection-votes","type":"uint128"},{"name":"first-burnchain-block-height","type":"uint128"},{"name":"min-amount-ustx","type":"uint128"},{"name":"prepare-cycle-length","type":"uint128"},{"name":"rejection-fraction","type":"uint128"},{"name":"reward-cycle-id","type":"uint128"},{"name":"reward-cycle-length","type":"uint128"},{"name":"total-liquid-supply-ustx","type":"uint128"}]},"error":"none"}}}},{"name":"get-pox-rejection","access":"read_only","args":[{"name":"stacker","type":"principal"},{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":{"optional":{"tuple":[{"name":"amount","type":"uint128"}]}}}},{"name":"get-reward-set-pox-address","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"},{"name":"index","type":"uint128"}],"outputs":{"type":{"optional":{"tuple":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"stacker","type":{"optional":"principal"}},{"name":"total-ustx","type":"uint128"}]}}}},{"name":"get-reward-set-size","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":"uint128"}},{"name":"get-stacker-info","access":"read_only","args":[{"name":"stacker","type":"principal"}],"outputs":{"type":{"optional":{"tuple":[{"name":"delegated-to","type":{"optional":"principal"}},{"name":"first-reward-cycle","type":"uint128"},{"name":"lock-period","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-set-indexes","type":{"list":{"type":"uint128","length":12}}}]}}}},{"name":"get-stacking-minimum","access":"read_only","args":[],"outputs":{"type":"uint128"}},{"name":"get-total-pox-rejection","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":"uint128"}},{"name":"get-total-ustx-stacked","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":"uint128"}},{"name":"is-pox-active","access":"read_only","args":[{"name":"reward-cycle","type":"uint128"}],"outputs":{"type":"bool"}},{"name":"minimal-can-stack-stx","access":"read_only","args":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"amount-ustx","type":"uint128"},{"name":"first-reward-cycle","type":"uint128"},{"name":"num-cycles","type":"uint128"}],"outputs":{"type":{"response":{"ok":"bool","error":"int128"}}}},{"name":"next-cycle-rejection-votes","access":"read_only","args":[],"outputs":{"type":"uint128"}},{"name":"reward-cycle-to-burn-height","access":"read_only","args":[{"name":"cycle","type":"uint128"}],"outputs":{"type":"uint128"}}],"variables":[{"name":"ADDRESS_VERSION_NATIVE_P2TR","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_NATIVE_P2WPKH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_NATIVE_P2WSH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_P2PKH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_P2SH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_P2WPKH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ADDRESS_VERSION_P2WSH","type":{"buffer":{"length":1}},"access":"constant"},{"name":"ERR_DELEGATION_EXPIRES_DURING_LOCK","type":"int128","access":"constant"},{"name":"ERR_DELEGATION_NO_REWARD_SLOT","type":"int128","access":"constant"},{"name":"ERR_DELEGATION_POX_ADDR_REQUIRED","type":"int128","access":"constant"},{"name":"ERR_DELEGATION_TOO_MUCH_LOCKED","type":"int128","access":"constant"},{"name":"ERR_DELEGATION_WRONG_REWARD_SLOT","type":"int128","access":"constant"},{"name":"ERR_INVALID_START_BURN_HEIGHT","type":"int128","access":"constant"},{"name":"ERR_NOT_ALLOWED","type":"int128","access":"constant"},{"name":"ERR_NOT_CURRENT_STACKER","type":"int128","access":"constant"},{"name":"ERR_STACKING_ALREADY_DELEGATED","type":"int128","access":"constant"},{"name":"ERR_STACKING_ALREADY_REJECTED","type":"int128","access":"constant"},{"name":"ERR_STACKING_ALREADY_STACKED","type":"int128","access":"constant"},{"name":"ERR_STACKING_CORRUPTED_STATE","type":"int128","access":"constant"},{"name":"ERR_STACKING_EXPIRED","type":"int128","access":"constant"},{"name":"ERR_STACKING_INSUFFICIENT_FUNDS","type":"int128","access":"constant"},{"name":"ERR_STACKING_INVALID_AMOUNT","type":"int128","access":"constant"},{"name":"ERR_STACKING_INVALID_LOCK_PERIOD","type":"int128","access":"constant"},{"name":"ERR_STACKING_INVALID_POX_ADDRESS","type":"int128","access":"constant"},{"name":"ERR_STACKING_IS_DELEGATED","type":"int128","access":"constant"},{"name":"ERR_STACKING_NOT_DELEGATED","type":"int128","access":"constant"},{"name":"ERR_STACKING_NO_SUCH_PRINCIPAL","type":"int128","access":"constant"},{"name":"ERR_STACKING_PERMISSION_DENIED","type":"int128","access":"constant"},{"name":"ERR_STACKING_POX_ADDRESS_IN_USE","type":"int128","access":"constant"},{"name":"ERR_STACKING_STX_LOCKED","type":"int128","access":"constant"},{"name":"ERR_STACKING_THRESHOLD_NOT_MET","type":"int128","access":"constant"},{"name":"ERR_STACKING_UNREACHABLE","type":"int128","access":"constant"},{"name":"ERR_STACK_EXTEND_NOT_LOCKED","type":"int128","access":"constant"},{"name":"ERR_STACK_INCREASE_NOT_LOCKED","type":"int128","access":"constant"},{"name":"MAX_ADDRESS_VERSION","type":"uint128","access":"constant"},{"name":"MAX_ADDRESS_VERSION_BUFF_20","type":"uint128","access":"constant"},{"name":"MAX_ADDRESS_VERSION_BUFF_32","type":"uint128","access":"constant"},{"name":"MAX_POX_REWARD_CYCLES","type":"uint128","access":"constant"},{"name":"MIN_POX_REWARD_CYCLES","type":"uint128","access":"constant"},{"name":"POX_REJECTION_FRACTION","type":"uint128","access":"constant"},{"name":"PREPARE_CYCLE_LENGTH","type":"uint128","access":"constant"},{"name":"REWARD_CYCLE_LENGTH","type":"uint128","access":"constant"},{"name":"STACKING_THRESHOLD_100","type":"uint128","access":"constant"},{"name":"STACKING_THRESHOLD_25","type":"uint128","access":"constant"},{"name":"configured","type":"bool","access":"variable"},{"name":"first-2-1-reward-cycle","type":"uint128","access":"variable"},{"name":"first-burnchain-block-height","type":"uint128","access":"variable"},{"name":"pox-prepare-cycle-length","type":"uint128","access":"variable"},{"name":"pox-rejection-fraction","type":"uint128","access":"variable"},{"name":"pox-reward-cycle-length","type":"uint128","access":"variable"}],"maps":[{"name":"allowance-contract-callers","key":{"tuple":[{"name":"contract-caller","type":"principal"},{"name":"sender","type":"principal"}]},"value":{"tuple":[{"name":"until-burn-ht","type":{"optional":"uint128"}}]}},{"name":"delegation-state","key":{"tuple":[{"name":"stacker","type":"principal"}]},"value":{"tuple":[{"name":"amount-ustx","type":"uint128"},{"name":"delegated-to","type":"principal"},{"name":"pox-addr","type":{"optional":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}}},{"name":"until-burn-ht","type":{"optional":"uint128"}}]}},{"name":"logged-partial-stacked-by-cycle","key":{"tuple":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"},{"name":"sender","type":"principal"}]},"value":{"tuple":[{"name":"stacked-amount","type":"uint128"}]}},{"name":"partial-stacked-by-cycle","key":{"tuple":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-cycle","type":"uint128"},{"name":"sender","type":"principal"}]},"value":{"tuple":[{"name":"stacked-amount","type":"uint128"}]}},{"name":"reward-cycle-pox-address-list","key":{"tuple":[{"name":"index","type":"uint128"},{"name":"reward-cycle","type":"uint128"}]},"value":{"tuple":[{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"stacker","type":{"optional":"principal"}},{"name":"total-ustx","type":"uint128"}]}},{"name":"reward-cycle-pox-address-list-len","key":{"tuple":[{"name":"reward-cycle","type":"uint128"}]},"value":{"tuple":[{"name":"len","type":"uint128"}]}},{"name":"reward-cycle-total-stacked","key":{"tuple":[{"name":"reward-cycle","type":"uint128"}]},"value":{"tuple":[{"name":"total-ustx","type":"uint128"}]}},{"name":"stacking-rejection","key":{"tuple":[{"name":"reward-cycle","type":"uint128"}]},"value":{"tuple":[{"name":"amount","type":"uint128"}]}},{"name":"stacking-rejectors","key":{"tuple":[{"name":"reward-cycle","type":"uint128"},{"name":"stacker","type":"principal"}]},"value":{"tuple":[{"name":"amount","type":"uint128"}]}},{"name":"stacking-state","key":{"tuple":[{"name":"stacker","type":"principal"}]},"value":{"tuple":[{"name":"delegated-to","type":{"optional":"principal"}},{"name":"first-reward-cycle","type":"uint128"},{"name":"lock-period","type":"uint128"},{"name":"pox-addr","type":{"tuple":[{"name":"hashbytes","type":{"buffer":{"length":32}}},{"name":"version","type":{"buffer":{"length":1}}}]}},{"name":"reward-set-indexes","type":{"list":{"type":"uint128","length":12}}}]}}],"fungible_tokens":[],"non_fungible_tokens":[],"epoch":"Epoch24","clarity_version":"Clarity2"}`;
export const V2_POX_REGTEST_POX_4 = `{"contract_id":"ST000000000000000000002AMW42H.pox-4","pox_activation_threshold_ustx":1000057600592055,"first_burnchain_block_height":0,"current_burnchain_block_height":227,"prepare_phase_block_length":5,"reward_phase_block_length":15,"reward_slots":30,"rejection_fraction":null,"total_liquid_supply_ustx":100005760059205579,"current_cycle":{"id":11,"min_threshold_ustx":833390000000000,"stacked_ustx":3750255000000000,"is_pox_active":true},"next_cycle":{"id":12,"min_threshold_ustx":833390000000000,"min_increment_ustx":12500720007400,"stacked_ustx":3750255000000000,"prepare_phase_start_block_height":235,"blocks_until_prepare_phase":8,"reward_phase_start_block_height":240,"blocks_until_reward_phase":13,"ustx_until_pox_rejection":null},"epochs":[{"epoch_id":"Epoch10","start_height":0,"end_height":0,"block_limit":{"write_length":0,"write_count":0,"read_length":0,"read_count":0,"runtime":0},"network_epoch":0},{"epoch_id":"Epoch20","start_height":0,"end_height":102,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":0},{"epoch_id":"Epoch2_05","start_height":102,"end_height":103,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":5},{"epoch_id":"Epoch21","start_height":103,"end_height":105,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":6},{"epoch_id":"Epoch22","start_height":105,"end_height":106,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":7},{"epoch_id":"Epoch23","start_height":106,"end_height":107,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":8},{"epoch_id":"Epoch24","start_height":107,"end_height":132,"block_limit":{"write_length":150000000,"write_count":50000,"read_length":1000000000,"read_count":50000,"runtime":100000000000},"network_epoch":9},{"epoch_id":"Epoch25","start_height":132,"end_height":152,"block_limit":{"write_length":15000000,"write_count":15000,"read_length":100000000,"read_count":15000,"runtime":5000000000},"network_epoch":10},{"epoch_id":"Epoch30","start_height":152,"end_height":9223372036854775807,"block_limit":{"write_length":15000000,"write_count":15000,"read_length":100000000,"read_count":15000,"runtime":5000000000},"network_epoch":11}],"min_amount_ustx":833390000000000,"prepare_cycle_length":5,"reward_cycle_id":11,"reward_cycle_length":20,"rejection_votes_left_required":null,"next_reward_cycle_in":13,"contract_versions":[{"contract_id":"ST000000000000000000002AMW42H.pox","activation_burnchain_block_height":0,"first_reward_cycle_id":0},{"contract_id":"ST000000000000000000002AMW42H.pox-2","activation_burnchain_block_height":104,"first_reward_cycle_id":6},{"contract_id":"ST000000000000000000002AMW42H.pox-3","activation_burnchain_block_height":107,"first_reward_cycle_id":6},{"contract_id":"ST000000000000000000002AMW42H.pox-4","activation_burnchain_block_height":132,"first_reward_cycle_id":7}]}`;

// === MOCK MAPS ===============================================================
export const MOCK_POX_3_REGTEST = {
  '/v2/fees/transaction': V2_FEES,
  '/v2/pox': V2_POX_REGTEST_POX_3,
  '/v2/contracts/interface/ST000000000000000000002AMW42H/pox-3': V2_POX_INTERFACE_POX_3,
};

export const MOCK_EMPTY_ACCOUNT = {
  '/v2/pox': V2_POX_REGTEST_POX_3,
  '/v2/accounts/ST162GBCTD9ESBF09XC2T63NCX6ZKS42ZPWGXZ6VH?proof=0': `{"balance":"0x00000000000000000000000000000000","locked":"0x00000000000000000000000000000000","unlock_height":0,"nonce":0}`,
  '/v2/contracts/call-read/ST000000000000000000002AMW42H/pox-3/can-stack-stx': `{"okay":true,"result":"0x08000000000000000000000000000000000b"}`,
};

export const MOCK_FULL_ACCOUNT = {
  '/v2/pox': V2_POX_REGTEST_POX_3,
  '/v2/accounts/STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6?proof=0': `{"balance":"0x0000000000000000001cdd78bdeadfe8","locked":"0x00000000000000000006a979b1d61c00","unlock_height":435,"nonce":4}`,
  '/v2/contracts/call-read/ST000000000000000000002AMW42H/pox-3/can-stack-stx': `{"okay":true,"result":"0x0703"}`,
};

// === FETCHMOCK TESTING HELPERS ===============================================

/**
 * Gets latest fetchMock broadcast to /transactions
 * @ignore
 */
export function getFetchMockBroadcast() {
  const broadcast = (Array.from(fetchMock.mock.calls) as any)
    .reverse()
    .find((m: any) => m[0].endsWith('/transactions'));
  return JSON.parse(broadcast[1].body);
}
