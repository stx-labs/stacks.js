import {
  FungiblePostCondition,
  NonFungiblePostCondition,
  Pc,
  StxPostCondition,
  uintCV,
} from '../src';

const STANDARD_ADDRESS = 'ST1WT20920NVRQ892MS535R7XEMV6KD6M6X2HQPK3';

const CONTRACT_ADDRESS = 'ST13F481SBR0R7Z6NMMH8YV2FJJYXA5JPA0AD3HP9';
const CONTRACT_NAME = 'subnet-v1';

const FT_CONTRACT_ADDRESS = 'ST13F481SBR0R7Z6NMMH8YV2FJJYXA5JPA0AD3HP9';
const FT_CONTRACT_NAME = 'super-token';
const FT_ASSET_NAME = 'SUP';

const NFT_CONTRACT_ADDRESS = 'ST13F481SBR0R7Z6NMMH8YV2FJJYXA5JPA0AD3HP9';
const NFT_CONTRACT_NAME = 'super-nft';
const NFT_TOKEN_NAME = 'super';
const NFT_ASSET_ID = uintCV(21);

describe('pc -- post condition builder', () => {
  test('fully-qualified token name', () => {
    const pcA = Pc.principal(STANDARD_ADDRESS)
      .willSendAsset()
      .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`, NFT_ASSET_ID);
    const pcB = Pc.principal(STANDARD_ADDRESS)
      .willSendAsset()
      .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
    expect(pcA).toEqual(pcB);
  });

  describe('invalid input', () => {
    test('invalid addresses', () => {
      expect(() => Pc.principal(STANDARD_ADDRESS).willSendEq(100).ustx()).not.toThrow();
      expect(() => Pc.principal('invalid address').willSendEq(100).ustx()).toThrow();
      expect(() => Pc.principal('invalid.address').willSendEq(100).ustx()).toThrow();

      expect(() =>
        Pc.principal(STANDARD_ADDRESS)
          .willSendEq(100)
          .ft('invalid' as any, FT_ASSET_NAME)
      ).toThrow();
      expect(() =>
        Pc.principal(STANDARD_ADDRESS).willSendEq(100).ft('inv.alid', FT_ASSET_NAME)
      ).toThrow();

      expect(() =>
        Pc.principal(STANDARD_ADDRESS)
          .willSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID)
      ).not.toThrow();
      expect(() =>
        Pc.principal(STANDARD_ADDRESS)
          .willSendAsset()
          .nft('invalid' as any, NFT_TOKEN_NAME, NFT_ASSET_ID)
      ).toThrow();
      expect(() =>
        Pc.principal(STANDARD_ADDRESS).willSendAsset().nft('inv.alid', NFT_TOKEN_NAME, NFT_ASSET_ID)
      ).toThrow();
    });

    test('invalid fully-qualified token name', () => {
      expect(() =>
        Pc.principal(STANDARD_ADDRESS)
          .willSendAsset()
          .nft(
            // e.g. using ;; instead of ::
            `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME};;${NFT_TOKEN_NAME}` as any,
            NFT_ASSET_ID
          )
      ).toThrow();

      expect(() =>
        Pc.principal(CONTRACT_ADDRESS)
          .willSendAsset()
          .nft(
            // e.g. using , instead of .
            `${NFT_CONTRACT_ADDRESS},${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}` as any,
            NFT_ASSET_ID
          )
      ).toThrow();
    });
  });

  describe('standard principal', () => {
    describe('stx post condition', () => {
      test('100 ustx', () => {
        const pc = Pc.principal(STANDARD_ADDRESS).willSendEq(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'eq',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('lte 100 ustx', () => {
        const pc = Pc.principal(STANDARD_ADDRESS).willSendLte(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'lte',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('lt 100 ustx', () => {
        const pc = Pc.principal(STANDARD_ADDRESS).willSendLt(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'lt',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('gte 100 ustx', () => {
        const pc = Pc.principal(STANDARD_ADDRESS).willSendGte(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'gte',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('gt 100 ustx', () => {
        const pc = Pc.principal(STANDARD_ADDRESS).willSendGt(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'gt',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });
    });

    describe('ft post condition', () => {
      test('100 ft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendEq(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'eq',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('lte 100 ft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendLt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'lt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('lt 100 ft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendLt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'lt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('gte 100 ft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendGte(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'gte',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('gt 100 ft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendGt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'gt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });
    });

    describe('nft post condition', () => {
      test('will send nft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('will not send nft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willNotSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'not-sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('will maybe send nft', () => {
        const pc = Pc.principal(STANDARD_ADDRESS)
          .willMaybeSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: STANDARD_ADDRESS,
          condition: 'maybe-sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });
    });
  });

  describe('contract principal', () => {
    describe('stx post condition', () => {
      test('100 ustx', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`).willSendEq(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'eq',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('lte 100 ustx', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`).willSendLt(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'lt',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('lt 100 ustx', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`).willSendLt(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'lt',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('gte 100 ustx', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`).willSendGte(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'gte',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });

      test('gt 100 ustx', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`).willSendGt(100).ustx();
        const postCondition: StxPostCondition = {
          type: 'stx-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'gt',
          amount: '100',
        };
        expect(pc).toEqual(postCondition);
      });
    });

    describe('ft post condition', () => {
      test('100 ft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendEq(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'eq',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('lte 100 ft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendLt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'lt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('lt 100 ft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendLt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'lt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('gte 100 ft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendGte(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'gte',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('gt 100 ft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendGt(100)
          .ft(`${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}`, FT_ASSET_NAME);
        const postCondition = {
          type: 'ft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'gt',
          amount: '100',
          asset: `${FT_CONTRACT_ADDRESS}.${FT_CONTRACT_NAME}::${FT_ASSET_NAME}`,
        } as FungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });
    });

    describe('nft post condition', () => {
      test('will send nft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('will not send nft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willNotSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'not-sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });

      test('will maybe send nft', () => {
        const pc = Pc.principal(`${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
          .willMaybeSendAsset()
          .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
        const postCondition = {
          type: 'nft-postcondition',
          address: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          condition: 'maybe-sent',
          asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
          assetId: NFT_ASSET_ID,
        } as NonFungiblePostCondition;
        expect(pc).toEqual(postCondition);
      });
    });
  });

  describe('origin principal', () => {
    test('origin string representation', () => {
      const pc = Pc.origin().willSendEq(12_345).ustx();
      expect(pc).toEqual({
        type: 'stx-postcondition',
        address: 'origin',
        condition: 'eq',
        amount: '12345',
      });
    });

    test('origin will maybe send nft', () => {
      const pc = Pc.origin()
        .willMaybeSendAsset()
        .nft(`${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}`, NFT_TOKEN_NAME, NFT_ASSET_ID);
      expect(pc).toEqual({
        type: 'nft-postcondition',
        address: 'origin',
        condition: 'maybe-sent',
        asset: `${NFT_CONTRACT_ADDRESS}.${NFT_CONTRACT_NAME}::${NFT_TOKEN_NAME}`,
        assetId: NFT_ASSET_ID,
      });
    });
  });

  describe('fromHex function', () => {
    test('deserializes hex string to post condition object', () => {
      const hex = '00021600000000000000000000000000000000000000000200000000000003e8';
      const postCondition = Pc.fromHex(hex);

      const expectedPostCondition: StxPostCondition = {
        type: 'stx-postcondition',
        address: 'SP000000000000000000002Q6VF78',
        condition: 'gt',
        amount: '1000',
      };

      expect(postCondition).toEqual(expectedPostCondition);
    });
  });
});
