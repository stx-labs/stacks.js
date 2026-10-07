## Adding dependencies

This repo uses [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) for package management.

To install a new dependency to a specific package, use the `-w` (workspace) flag:

```shell
# Run within the root directory
npm install lodash -w @stacks/storage
```

Add `--save-dev` to install as a development dependency:

```shell
npm install lodash -w @stacks/storage --save-dev
```
