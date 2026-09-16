# @stacks/cli

Command line interface to interact with auth, storage and Stacks transactions.

## Installation

```
npm install @stacks/cli
```

## Usage

See [documentation](https://docs.hiro.so/references/stacks-cli)

### Examples

Open the terminal to try these basic commands

### List of commands

To see the usage and options for the command in general

```shell script
stx
```

To see a list of subcommands

```shell script
stx help
```

## Authentication

### authenticator

```shell script
Run an authentication endpoint for the set of names owned by the given backup phrase.  Send applications the given Gaia hub URL on sign-in, so the application will use it to read/write user data.

You can supply your encrypted backup phrase instead of the raw backup phrase.  If so, then you will be prompted for your password before any authentication takes place.

Example:

    export BACKUP_PHRASE="oak indicate inside poet please share dinner monitor glow hire source perfect"
    export APP_GAIA_HUB="https://1.2.3.4"
    export PROFILE_GAIA_HUB="https://hub.blockstack.org"
    stx authenticator "$APP_GAIA_HUB" "$BACKUP_PHRASE" "$PROFILE_GAIA_HUB" 8888
    Press Ctrl+C to exit
    Authentication server started on 8888

```

## Account Management

### balance

```shell script
Query the balance of an account.  Returns the balances of each kind of token that the account owns.  The balances will be in the *smallest possible units* of the token (i.e. satoshis for BTC, microStacks for Stacks, etc.).

Example:
    // -t for testnet address, for mainnet omit -t option
    stx -t balance ST3PWZ5M026785YW8YKKEH316DYPE4AC7NNTD9ADN
    {
      "balance": "499986820",
      "locked": "0",
      "unlock_height": 0,
      "nonce": 2
    }

```

### can_stack

```shell script
Check if specified account can stack a number of Stacks tokens for given number of cycles.

Example:
    // -t for testnet address, for mainnet omit -t option
    stx -t can_stack 100000000000 3 mvuYDknzDtPgGqm2GnbAbmGMLwiyW3AwFP ST3XKKN4RPV69NN1PHFDNX3TYKXT7XPC4N8KC1ARH
    {
      "eligible": true
    }

```

### call_contract_func

```shell script
Call a function in a deployed Clarity smart contract.

If the command succeeds, it prints out a transaction ID.
Example:
    // Add -t option it contract on testnet
    // Replace contract_name and contract_function with actual names
    export PAYMENT="bfeffdf57f29b0cc1fab9ea197bb1413da2561fe4b83e962c7f02fbbe2b1cd5401"
    stx call_contract_func SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X contract_name contract_function 1 0 "$PAYMENT"
     {
       txid: '0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1',
       transaction: 'https://explorer.hiro.so/txid/0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1'
     }

```

### call_read_only_contract_func

```shell script
Call a read-only function in a deployed Clarity smart contract.

If the command succeeds, it prints out a Clarity value.
Example:
    // Add -t option it contract on testnet
    // Replace contract_name and contract_function with actual names

    stx call_read_only_contract_func SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X contract_name contract_function SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X
     {
       txid: '0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1',
       transaction: 'https://explorer.hiro.so/txid/0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1'
     }

```

### convert_address

```shell script
Convert a Bitcoin address to a Stacks address and vice versa.

Example:
    stx convert_address 12qdRgXxgNBNPnDeEChy3fYTbSHQ8nfZfD
    {
      "mainnet": {
        "STACKS": "SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW",
        "BTC": "12qdRgXxgNBNPnDeEChy3fYTbSHQ8nfZfD"
      }
    }
    stx convert_address SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW
    {
      "mainnet": {
        "STACKS": "SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW",
        "BTC": "12qdRgXxgNBNPnDeEChy3fYTbSHQ8nfZfD"
      }
    }
    stx convert_address SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW -t
    {
      "mainnet": {
        "STACKS": "SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW",
        "BTC": "12qdRgXxgNBNPnDeEChy3fYTbSHQ8nfZfD"
      },
      "testnet": {
        "STACKS": "STA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7DX96QAM",
        "BTC": "mhMaijcwVPcdAthFwmgLsaknTRt72GqQYo"
      }
    }
    stx convert_address STA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7DX96QAM
    {
      "mainnet": {
        "STACKS": "SPA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7CBE6YPW",
        "BTC": "12qdRgXxgNBNPnDeEChy3fYTbSHQ8nfZfD"
      },
      "testnet": {
        "STACKS": "STA2MZWV9N67TBYVWTE0PSSKMJ2F6YXW7DX96QAM",
        "BTC": "mhMaijcwVPcdAthFwmgLsaknTRt72GqQYo"
      }
    }

```

### deploy_contract

```shell script
Deploys a Clarity smart contract on the network.

If the command succeeds, it prints out a transaction ID.
Example:
    // Specify -t for testnet. By default mainnet will be used.
    export PAYMENT="bfeffdf57f29b0cc1fab9ea197bb1413da2561fe4b83e962c7f02fbbe2b1cd5401"
    stx deploy_contract ./my_contract.clar my_contract 1 0 "$PAYMENT"
     {
       txid: '0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1',
       transaction: 'https://explorer.hiro.so/txid/0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1'
     }
```

### get_account_history

```shell script
Query the history of account debits and credits over a given block range.  Returns the history one page at a time.  An empty result indicates that the page number has exceeded the number of historic operations in the given block range.

Example:

    stx -t get_account_history ST3PWZ5M026785YW8YKKEH316DYPE4AC7NNTD9ADN 0
    [
      {
        "address": "ST3PWZ5M026785YW8YKKEH316DYPE4AC7NNTD9ADN",
        "block_id": 56789
        "credit_value": "100000000000",
        "debit_value": "0",
        "lock_transfer_block_id": 0,
        "txid": "0e5db84d94adff5b771262b9df015164703b39bb4a70bf499a1602b858a0a5a1",
        "type": "STACKS",
        "vtxindex": 0
      },
      {
        "address": "ST3PWZ5M026785YW8YKKEH316DYPE4AC7NNTD9ADN",
        "block_id": 56790,
        "credit_value": "100000000000",
        "debit_value": "64000000000",
        "lock_transfer_block_id": 0,
        "txid": "5a0c67144626f7bd4514e4de3f3bbf251383ca13887444f326bac4bc8b8060ee",
        "type": "STACKS",
        "vtxindex": 1
      }
    ]


```

### send_tokens

```shell script
Send a particular type of tokens to the given `ADDRESS`.  Right now, only supported `TOKEN-TYPE` is `STACKS`.  Optionally include a memo string (`MEMO`) up to 34 characters long.

If the command succeeds, it prints out a transaction ID.  You can track the confirmations on the transaction via the `get_confirmations` command.  Once the transaction has 7 confirmations, the Blockstack peer network will have processed it, and your payment key balance and recipient balance will be updated.

Example:

    # check balances of sender and recipient before sending.
    # address of the key below is SP2SC16ASH76GX549PT7J5WQZA4GHMFBKYMBQFF9V
    # Use -t option for testnet address
    export PAYMENT="bfeffdf57f29b0cc1fab9ea197bb1413da2561fe4b83e962c7f02fbbe2b1cd5401"
    stx balance SP2SC16ASH76GX549PT7J5WQZA4GHMFBKYMBQFF9V
    {
      "STACKS": "10000000"
    }
    stx balance SP1P10PS2T517S4SQGZT5WNX8R00G1ECTRKYCPMHY
    {
      "STACKS": "0"
    }

    # send tokens
    stx send_tokens SP1P10PS2T517S4SQGZT5WNX8R00G1ECTRKYCPMHY 12345 1 0 "$PAYMENT"
    {
       txid: '0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1',
       transaction: 'https://explorer.hiro.so/txid/0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1'
    }
    a9d387a925fb0ba7a725fb1e11f2c3f1647473699dd5a147c312e6453d233456

    # wait for transaction to be confirmed

    stx balance SP2SC16ASH76GX549PT7J5WQZA4GHMFBKYMBQFF9V
    {
      "STACKS": "9987655"
    }
    stx balance SP1P10PS2T517S4SQGZT5WNX8R00G1ECTRKYCPMHY
    {
      "STACKS": "12345"
    }

```

### stack

```shell script
Stack the specified number of Stacks tokens for given number of cycles.

Example:
    // Use -t option for testnet address
    stx stack 10000000 20 16pm276FpJYpm7Dv3GEaRqTVvGPTdceoY4 136ff26efa5db6f06b28f9c8c7a0216a1a52598045162abfe435d13036154a1b01
     {
       txid: '0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1',
       transaction: 'https://explorer.hiro.so/txid/0x2e33ad647a9cedacb718ce247967dc705bc0c878db899fdba5eae2437c6fa1e1'
     }
```

### stacking_status

```shell script
Get stacking status for specified address.

Example:
    // Use -t option for testnet adddress
    stx stacking_status SPZY1V53Z4TVRHHW9Z7SFG8CZNRAG7BD8WJ6SXD0

```

## Key Management

### decrypt_keychain

```shell script
Decrypt an encrypted backup phrase with a password.  Decrypts to a 12-word backup phrase if done correctly.  The password will be prompted if not given.

Example:

    # password is "asdf"
    stx decrypt_keychain "bfMDtOucUGcJXjZo6vkrZWgEzue9fzPsZ7A6Pl4LQuxLI1xsVF0VPgBkMsnSLCmYS5YHh7R3mNtMmX45Bq9sNGPfPsseQMR0fD9XaHi+tBg=
    Enter password:
    section amount spend resemble spray verify night immune tattoo best emotion parrot
```

### encrypt_keychain

```shell script
Encrypt a 12-word backup phrase, which can be decrypted later with the `decrypt_backup_phrase` command.  The password will be prompted if not given.

Example:

     # password is "asdf"
     stx encrypt_keychain "section amount spend resemble spray verify night immune tattoo best emotion parrot"
     Enter password:
     Enter password again:
     M+DnBHYb1fgw4N3oZ+5uTEAua5bAWkgTW/SjmmBhGGbJtjOtqVV+RrLJEJOgT35hBon4WKdGWye2vTdgqDo7+HIobwJwkQtN2YF9g3zPsKk=
```

### faucet

```shell script
Provide free Stacks Token (STX) on testnet for the specified address

Example:

      stx faucet ST3PWZ5M026785YW8YKKEH316DYPE4AC7NNTD9ADN
      {
        "txid": "0xd33672dd4dbb0b88f733bc67b938359843123ca3be550ca87d487d067bd1b3c3",
        "transaction": "https://explorer.hiro.so/txid/0xd33672dd4dbb0b88f733bc67b938359843123ca3be550ca87d487d067bd1b3c3?chain=testnet"
      }
```

### get_address

```shell script
Get the address of a private key or multisig private key bundle.  Gives the BTC and STACKS addresses

Example:

    stx get_address f5185b9ca93bdcb5753fded3b097dab8547a8b47d2be578412d0687a9a0184cb01
    {
      "BTC": "1JFhWyVPpZQjbPcXFtpGtTmU22u4fhBVmq",
      "STACKS": "SP2YM3J4KQK09V670TD6ZZ1XYNYCNGCWCVVKSDFWQ"
    }
    stx get_address 1,f5185b9ca93bdcb5753fded3b097dab8547a8b47d2be578412d0687a9a0184cb01,ff2ff4f4e7f8a1979ffad4fc869def1657fd5d48fc9cf40c1924725ead60942c01
    {
      "BTC": "363pKBhc5ipDws1k5181KFf6RSxhBZ7e3p",
      "STACKS": "SMQWZ30EXVG6XEC1K4QTDP16C1CAWSK1JSWMS0QN"
    }
```

### get_app_keys

```shell script
Get the application private key from a 12-word backup phrase and a name or ID-address.  This is the private key used to sign data in Gaia, and its address is the Gaia bucket address.  If you provide your encrypted backup phrase, you will be asked to decrypt it.  If you provide a name instead of an ID-address, its ID-address will be queried automatically (note that this means that the name must already be registered).

NOTE: This command does NOT verify whether or not the name or ID-address was created by the backup phrase. You should do this yourself via the `get_owner_keys` command if you are not sure.

There are two derivation paths emitted by this command:  a `keyInfo` path and a `legacyKeyInfo`path.  You should use the one that matches the Gaia hub read URL's address, if you have already signed in before.  If not, then you should use the `keyInfo` path when possible.

Example:
    // Specify -t for testnet
    export BACKUP_PHRASE="one race buffalo dynamic icon drip width lake extra forest fee kit"
    stx get_app_keys "$BACKUP_PHRASE" example.id.blockstack https://my.cool.dapp
    {
      "keyInfo": {
        "privateKey": "TODO",
        "address": "TODO"
      },
      "legacyKeyInfo": {
        "privateKey": "90f9ec4e13fb9a00243b4c1510075157229bda73076c7c721208c2edca28ea8b",
        "address": "1Lr8ggSgdmfcb4764woYutUfFqQMjEoKHc"
      },
      "ownerKeyIndex": 0
    }
```

### get_owner_keys

```shell script
Get the list of owner private keys and ID-addresses from a 12-word backup phrase.  Pass non-zero values for INDEX to generate the sequence of ID-addresses that can be used to own Blockstack IDs.  If you provide an encrypted 12-word backup phrase, you will be asked for your password to decrypt it.

Example:

    # get the first 3 owner keys and addresses for a backup phrase
    // Specify -t for testnet
    export BACKUP_PHRASE="soap fog wealth upon actual blossom neither timber phone exile monkey vocal"
    stx get_owner_keys "$BACKUP_PHRASE" 3
    [
      {
        "privateKey": "14b0811d5cd3486d47279d8f3a97008647c64586b121e99862c18863e2a4183501",
        "version": "v0.10-current",
        "index": 0,
        "idAddress": "ID-1ArdkA2oLaKnbNbLccBaFhEV4pYju8hJ82"
      },
      {
        "privateKey": "1b3572d8dd6866828281ac6cf135f04153210c1f9b123743eccb795fd3095e4901",
        "version": "v0.10-current",
        "index": 1,
        "idAddress": "ID-18pR3UpD1KFrnk88a3MGZmG2dLuZmbJZ25"
      },
      {
        "privateKey": "b19b6d62356db96d570fb5f08b78f0aa7f384525ba3bdcb96fbde29b8e11710d01",
        "version": "v0.10-current",
        "index": 2,
        "idAddress": "ID-1Gx4s7ggkjENw3wSY6bNd1CwoQKk857AqN"
      }
    ]


```

### get_payment_key

```shell script
Get the payment private key from a 12-word backup phrase.  If you provide an encrypted backup phrase, you will be asked for your password to decrypt it.  This command will tell you your Bitcoin and Stacks token addresses as well.

Example
    // Specify -t for testnet
    stx get_payment_key "soap fog wealth upon actual blossom neither timber phone exile monkey vocal"
    [
      {
        "privateKey": "4023435e33da4aff0775f33e7b258f257fb20ecff039c919b5782313ab73afb401",
        "address": {
          "BTC": "1ybaP1gaRwRSWRE4f8JXo2W8fiTZmA4rV",
          "STACKS": "SP5B89ZJAQHBRXVYP15YB5PAY5E24FEW9K4Q63PE"
        },
        "index": 0
      }
    ]

```

### get_stacks_wallet_key

```shell script
Get the payment private key from a 24-word backup phrase used by the Stacks wallet.  If you provide an encrypted backup phrase, you will be asked for your password to decrypt it.  This command will tell you your Bitcoin and Stacks token addresses as well.

Example
    // Specify -t for testnet
    stx get_stacks_wallet_key "toast canal educate tissue express melody produce later gospel victory meadow outdoor hollow catch liberty annual gasp hat hello april equip thank neck cruise"
    [
      {
        "privateKey": "a25cea8d310ce656c6d427068c77bad58327334f73e39c296508b06589bc4fa201",
        "address": {
          "BTC": "1ATAW6TAbTCKgU3xPgAcWQwjW9Q26Eambx",
          "STACKS": "SP1KTQR7CTQNA20SV2VNTF9YABMR6RJERSES3KC6Z"
        },
        "index": 0
      }
    ]

```

### make_keychain

```shell script
Generate the owner and payment private keys, optionally from a given 12-word backup phrase.  If no backup phrase is given, a new one will be generated.  If you provide your encrypted backup phrase, you will be asked to decrypt it.

Example:
    // Specify -t for testnet
    stx make_keychain
    {
      "mnemonic": "apart spin rich leader siren foil dish sausage fee pipe ethics bundle",
      "keyInfo": {
        "privateKey": "25899fab1b9b95cc2d1692529f00fb788e85664df3d14db1a660f33c5f96d8ab01"
        "address": "SP3RBZ4TZ3EK22SZRKGFZYBCKD7WQ5B8FFS0AYVF7"
        "btcAddress": "1Nwxfx7VoYAg2mEN35dTRw4H7gte8ajFki"
        "wif": "KxUgLbeVeFZEUUQpc3ncYn5KFB3WH5MVRv3SJ2g5yPwkrXs3QRaP"
        "index": 0,
      }
    }

```

## CLI

### docs

```shell script
Dump the documentation for all commands as JSON to standard out.
```

## Gaia

### gaia_dump_bucket

```shell script
Download the contents of a Gaia hub bucket to a given directory.  The `GAIA_HUB` argument must correspond to the *write* endpoint of the Gaia hub -- that is, you should be able to fetch `$GAIA_HUB/hub_info`.  If `DUMP_DIR` does not exist, it will be created.

Example:

    export BACKUP_PHRASE="section amount spend resemble spray verify night immune tattoo best emotion parrot
    stx gaia_dump_bucket hello.id.blockstack https://sample.app https://hub.blockstack.org "$BACKUP_PHRASE" ./backups
    Download 3 files...
    Download hello_world to ./backups/hello_world
    Download dir/format to ./backups/dir\x2fformat
    Download /.dotfile to ./backups/\x2f.dotfile
    3

```

### gaia_getfile

```shell script
Get a file from another user's Gaia hub.  Prints the file data to stdout.  If you want to read an encrypted file, and/or verify a signed file, then you must pass an app private key, and pass 1 for `DECRYPT` and/or `VERIFY`.  If the file is encrypted, and you do not pass an app private key, then this command downloads the ciphertext.  If the file is signed, and you want to download its data and its signature, then you must run this command twice -- once to get the file contents at `FILENAME`, and once to get the signature (whose name will be `FILENAME`.sig).

Gaia is a key-value store, so it does not have any built-in notion of directories.  However, most underlying storage systems do -- directory separators in the name of a file in Gaia may be internally treated as first-class directories (it depends on the Gaia hub's driver).As such, repeated directory separators will be treated as a single directory separator by this command.  For example, the file name `a/b.txt`, `/a/b.txt`, and `///a////b.txt` will be treated as identical.

Example without encryption:

    # Get an unencrypted, unsigned file
    stx gaia_getfile ryan.id http://public.ykliao.com statuses.json
    [{"id":0,"text":"Hello, Blockstack!","created_at":1515786983492}]

Example with encryption:

    # Get an encrypted file without decrypting
    stx gaia_getfile ryan.id https://app.graphitedocs.com documentscollection.json
        # Get an encrypted file, and decrypt it
    # Tip: You can obtain the app key with the get_app_keys command
    export APP_KEY="3ac770e8c3d88b1003bf4a0a148ceb920a6172bdade8e0325a1ed1480ab4fb19"
    stx gaia_getfile ryan.id https://app.graphitedocs.com documentscollection.json "$APP_KEY" 1 0

```

### gaia_putfile

```shell script
Put a file into a given Gaia hub, authenticating with the given app private key.  Optionally encrypt and/or sign the data with the given app private key.  If the file is successfully stored, this command prints out the URLs at which it can be fetched.

Gaia is a key-value store, so it does not have any built-in notion of directories.  However, most underlying storage systems do -- directory separators in the name of a file in Gaia may be internally treated as first-class directories (it depends on the Gaia hub's driver).As such, repeated directory separators will be treated as a single directory separator by this command.  For example, the file name `a/b.txt`, `/a/b.txt`, and `///a////b.txt` will be treated as identical.

Example:

    # Store 4 versions of a file: plaintext, encrypted, signed, and encrypted+signed
    # Tip: You can obtain the app key with the get_app_keys command.
    export APP_KEY="3ac770e8c3d88b1003bf4a0a148ceb920a6172bdade8e0325a1ed1480ab4fb19"
    stx gaia_putfile https://hub.blockstack.org "$APP_KEY" /path/to/file.txt file.txt
    {
       "urls": "https://gaia.blockstack.org/hub/19KAzYp4kSKozeAGMUsnuqkEGdgQQLEvwo/file.txt"
    }
    stx gaia_putfile https://hub.blockstack.org "$APP_KEY" /path/to/file.txt file-encrypted.txt 1
    {
       "urls": "https://gaia.blockstack.org/hub/19KAzYp4kSKozeAGMUsnuqkEGdgQQLEvwo/file-encrypted.txt"
    }
    stx gaia_putfile https://hub.blockstack.org "$APP_KEY" /path/to/file.txt file-signed.txt 0 1
    {
       "urls": "https://gaia.blockstack.org/hub/19KAzYp4kSKozeAGMUsnuqkEGdgQQLEvwo/file-signed.txt"
    }
    stx gaia_putfile https://hub.blockstack.org "$APP_KEY" /path/to/file.txt file-encrypted-signed.txt 1 1
    {
       "urls": "https://gaia.blockstack.org/hub/19KAzYp4kSKozeAGMUsnuqkEGdgQQLEvwo/file-encrypted-signed.txt"
    }

```

### gaia_deletefile

```shell script
Delete a file in a Gaia hub, as well as its signature metadata (which is stored in a separate file).
Example:

    # Tip: You can obtain the app key with the get_app_keys command.
    export APP_KEY="3ac770e8c3d88b1003bf4a0a148ceb920a6172bdade8e0325a1ed1480ab4fb19"
    stx gaia_deletefile https://hub.blockstack.org "$APP_KEY" file.txt false
    ok
```

### gaia_listfiles

```shell script
List all the files in a Gaia hub bucket.  You must have the private key for the bucket in order to list its contents.  The command prints each file name on its own line, and when finished, it prints the number of files listed.

Example:

    # Tip: You can obtain the app key with the get_app_keys command.
    export APP_KEY="3ac770e8c3d88b1003bf4a0a148ceb920a6172bdade8e0325a1ed1480ab4fb19"
    stx gaia_listfiles "https://hub.blockstack.org" "$APP_KEY"
    hello_world
    dir/format
    /.dotfile
    3

```

### gaia_restore_bucket

```shell script
Upload the contents of a previously-dumped Gaia bucket to a new Gaia hub.  The `GAIA_HUB` argument must correspond to the *write* endpoint of the Gaia hub -- that is, you should be able to fetch `$GAIA_HUB/hub_info`.  `DUMP_DIR` must contain the file contents created by a previous successful run of the gaia_dump_bucket command, and both `NAME_OR_ID_ADDRESS` and `APP_ORIGIN` must be the same as they were when it was run.

Example:

    export BACKUP_PHRASE="section amount spend resemble spray verify night immune tattoo best emotion parrot"
    stx gaia_restore_bucket hello.id.blockstack https://sample.app https://new.gaia.hub "$BACKUP_PHRASE" ./backups
    Uploaded ./backups/hello_world to https://new.gaia.hub/hub/1Lr8ggSgdmfcb4764woYutUfFqQMjEoKHc/hello_world
    Uploaded ./backups/dir\x2fformat to https://new.gaia.hub/hub/1Lr8ggSgdmfcb4764woYutUfFqQMjEoKHc/dir/format
    Uploaded ./backups/\x2f.dotfile to https://new.gaia.hub/hub/1Lr8ggSgdmfcb4764woYutUfFqQMjEoKHc//.dotfile
    3

```

### gaia_sethub

```shell script
Set the Gaia hub for a particular application for a Blockstack ID.  If the command succeeds, the URLs to your updated profile will be printed and your profile will contain an entry in its "apps" key that links the given `APP_ORIGIN` to the given `APP_GAIA_HUB`.

NOTE: Both `OWNER_GAIA_HUB` and `APP_GAIA_HUB` must be the *write* endpoints of their respective Gaia hubs.

Your 12-word phrase (in either raw or encrypted form) is required to re-sign and store your profile and to generate an app-specific key and Gaia bucket.  If you give the encrypted backup phrase, you will be prompted for a password.

Example:

    export BACKUP_PHRASE="soap fog wealth upon actual blossom neither timber phone exile monkey vocal"
    stx gaia_sethub hello_world.id https://hub.blockstack.org https://my.cool.app https://my.app.gaia.hub "$BACKUP_PHRASE"
    {
      "profileUrls": {
        "error": null,
        "dataUrls": [
          "https://gaia.blockstack.org/hub/1ArdkA2oLaKnbNbLccBaFhEV4pYju8hJ82/profile.json"
        ]
      }
    }

    # You can check the new apps entry with curl and jq as follows:
    curl -sL https://gaia.blockstack.org/hub/1ArdkA2oLaKnbNbLccBaFhEV4pYju8hJ82/profile.json | jq ".[0].decodedToken.payload.claim.apps"
    {
      "https://my.cool.app": "https://my.app.gaia.hub/hub/1EqzyQLJ15KG1WQmi5cf1HtmSeqS1Wb8tY/"
    }


```

## Profiles

### profile_sign

```shell script
Sign a profile on disk with a given owner private key.  Print out the signed profile JWT.

Example:

    # Tip: you can get the owner key from your 12-word backup phrase using the get_owner_keys command
    stx profile_sign /path/to/profile.json 0ffd299af9c257173be8486ef54a4dd1373407d0629ca25ca68ff24a76be09fb01


```

### profile_store

```shell script
Store a profile on disk to a Gaia hub.  `USER_ID` can be either a Blockstack ID or an ID-address.  The `GAIA_HUB` argument must be the *write* endpoint for the user's Gaia hub (e.g. https://hub.blockstack.org).  You can verify this by ensuring that you can run `curl "$GAIA_HUB/hub_info"` successfully.
```

### profile_verify

```shell script
Verify a JWT encoding a profile on disk using an ID-address.  Prints out the contained profile on success.

Example:

    # get the raw profile JWT
    curl -sL https://raw.githubusercontent.com/jcnelson/profile/master/judecn.id > /tmp/judecn.id.jwt
    # Tip: you can get the ID-address for a name with the "whois" command
    stx profile_verify /tmp/judecn.id.jwt ID-16EMaNw3pkn3v6f2BgnSSs53zAKH4Q8YJg

```
