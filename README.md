# Stacks.js [![Test Action Badge](https://github.com/stx-labs/stacks.js/actions/workflows/tests.yml/badge.svg)](https://github.com/stx-labs/stacks.js/actions/workflows/tests.yml) [![Monorepo Version Label](https://img.shields.io/npm/v/%40stacks%2Fcommon?label=monorepo)](./packages)

Welcome to the Stacks.js repository, your one-stop solution for working with the Stacks blockchain using JavaScript/TypeScript. This repository nests a collection of packages designed to provide you with the essential building blocks to work with the [Stacks blockchain](https://www.stacks.co/learn/introduction) from JavaScript/TypeScript.

## Packages

For installation instructions and usage guidelines, refer to the respective `README` in each package directory.

### Connecting Wallets

- [`@stacks/connect`](https://github.com/stx-labs/connect) Connect web application to Stacks wallet browser extensions _(separate repo)_.

### Stacks Primitives

- [`@stacks/transactions`](./packages/transactions) Build, sign, and broadcast transactions. Construct and read Clarity values. Guard transfers with post conditions.
- [`@stacks/wallet-sdk`](./packages/wallet-sdk) Create a Stacks wallet from a seed phrase and manage its accounts.
- [`@stacks/encryption`](./packages/encryption) Encryption functions used by stacks.js packages.
- [`@stacks/network`](./packages/network) Network configuration for Stacks.js.
- [`@stacks/common`](./packages/common) Shared low-level primitives for Stacks.js.
- [`@stacks/api`](./packages/api) Javascript library for interacting with the Stacks Blockchain Node and API.

### Bitcoin Staking

- [`@stacks/bitcoin-staking`](./packages/bitcoin-staking) Library for Bitcoin Staking.

### Others

- [`@stacks/cli`](./packages/cli) Command line interface for the Stacks blockchain.

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

Please read Stacks.js' [Code of Conduct](./CODE_OF_CONDUCT.md) since we expect project participants to adhere to it.

### Contributing Guide

Read our [contributing guide](./.github/CONTRIBUTING.md) to learn about our development process, how to propose bug fixes and improvements, and how to build and test your changes.

## Community

Join our community and stay connected with the latest updates and discussions:

- [Join our Discord community chat](https://discord.com/invite/stacks-621759717756370964) to engage with other users, ask questions, and participate in discussions.
- [Visit hiro.so](https://www.hiro.so/) for updates and subscribe to the mailing list.
- Follow [Hiro on Twitter.](https://twitter.com/hirosystems)

## License

Stacks.js is open source and released under the MIT License.
