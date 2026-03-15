# Stacks.js [![Test Action Badge](https://github.com/hirosystems/stacks.js/actions/workflows/tests.yml/badge.svg)](https://github.com/hirosystems/stacks.js/actions/workflows/tests.yml) [![Monorepo Version Label](https://img.shields.io/github/lerna-json/v/hirosystems/stacks.js?label=monorepo)](https://github.com/hirosystems/stacks.js/tree/main/packages)

> [!IMPORTANT]
> Looking for Nakamoto updates?
> Use version `6.16.0` or later to test the latest nakamoto changes.
> e.g., `npm install @stacks/stacking@6.16.0`

Welcome to the Stacks.js repository, your one-stop solution for working with the Stacks blockchain using JavaScript/TypeScript. This repository nests a collection of packages designed to provide you with the essential building blocks to work with the [Stacks blockchain](https://www.stacks.co/what-is-stacks) from JavaScript/TypeScript.

## Packages

For installation instructions and usage guidelines, refer to the respective `README` in each package directory.

### Connecting Wallets

- [`@stacks/connect`](https://github.com/hirosystems/connect) Connect web application to Stacks wallet browser extensions _(separate repo)_.

### Stacks Primitives

- [`@stacks/transactions`](https://github.com/hirosystems/stacks.js/tree/main/packages/transactions) Construct, decode transactions, and work with Clarity smart contracts on the Stacks blockchain.
- [`@stacks/wallet-sdk`](https://github.com/hirosystems/stacks.js/tree/main/packages/wallet-sdk) Library for building wallets, managing accounts, and handling keys for the Stacks blockchain.
- [`@stacks/storage`](https://github.com/hirosystems/stacks.js/tree/main/packages/storage) Store and fetch files with Gaia, the decentralized storage system.
- [`@stacks/encryption`](https://github.com/hirosystems/stacks.js/tree/main/packages/encryption) Encryption functions used by stacks.js packages.
- [`@stacks/auth`](https://github.com/hirosystems/stacks.js/tree/main/packages/auth) Construct and decode authentication requests for Stacks apps.
- [`@stacks/profile`](https://github.com/hirosystems/stacks.js/tree/main/packages/profile) Functions for manipulating user profiles.
- [`@stacks/network`](https://github.com/hirosystems/stacks.js/tree/main/packages/network) Network and API library for working with Stacks blockchain nodes.
- [`@stacks/common`](https://github.com/hirosystems/stacks.js/tree/main/packages/common) Common utilities used by stacks.js packages.

### Native Smart Contract Interaction

- [`@stacks/bns`](https://github.com/hirosystems/stacks.js/tree/main/packages/bns) Library for interacting with the BNS contract.
- [`@stacks/stacking`](https://github.com/hirosystems/stacks.js/tree/main/packages/stacking) Library for PoX stacking.

### Others

- [`@stacks/cli`](https://github.com/hirosystems/stacks.js/tree/main/packages/cli) Command line interface to interact with auth, storage, and Stacks transactions.
- `@stacks/keychain` _**DEPRECATED:** replaced by [`@stacks/wallet-sdk`](https://github.com/hirosystems/stacks.js/tree/main/packages/wallet-sdk)_

## Reference

Auto-generated library references for the stacks.js packages are located at [stacks.js.org](https://stacks.js.org/).

## Migrating from previous versions

To migrate your app from blockstack.js to Stacks.js follow the steps in the [migration guide](./.github/MIGRATION.md).

## Bugs and feature requests

If you encounter a bug or have a feature request, we encourage you to follow the steps below:

1.  **Search for existing issues:** Before submitting a new issue, please search [existing and closed issues](../../issues) to check if a similar problem or feature request has already been reported.
1.  **Open a new issue:** If it hasn't been addressed, please [open a new issue](../../issues/new/choose). Choose the appropriate issue template and provide as much detail as possible, including steps to reproduce the bug or a clear description of the requested feature.
1.  **Evaluation SLA:** Our team reads and evaluates all the issues and pull requests. We are available Monday to Friday and we make our best effort to respond within 7 business days.

Please **do not** use the issue tracker for personal support requests or to ask for the status of a transaction. You'll find help at the [#support Discord channel](https://discord.com/invite/stacks-621759717756370964).

## Contributing & Development

Development of Stacks.js happens in the open on GitHub, and we are grateful to the community for contributing bug fixes and improvements. Read below to learn how you can take part in improving the Stacks.js.

### Code of Conduct

Please read Stacks.js' [Code of Conduct](https://github.com/hirosystems/stacks.js/blob/main/CODE_OF_CONDUCT.md) since we expect project participants to adhere to it.

### Contributing Guide

Read our [contributing guide](https://github.com/hirosystems/stacks.js/blob/main/.github/CONTRIBUTING.md) to learn about our development process, how to propose bug fixes and improvements, and how to build and test your changes.

## Community

Join our community and stay connected with the latest updates and discussions:

- [Join our Discord community chat](https://discord.com/invite/stacks-621759717756370964) to engage with other users, ask questions, and participate in discussions.
- [Visit hiro.so](https://www.hiro.so/) for updates and subscribe to the mailing list.
- Follow [Hiro on Twitter.](https://twitter.com/hirosystems)

## License

Stacks.js is open source and released under the MIT License.


## DeFi Examples by @serayd61
Added practical DeFi examples for the Stacks ecosystem.
