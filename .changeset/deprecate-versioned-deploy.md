---
"@stacks/transactions": minor
---

`makeContractDeploy` and `makeUnsignedContractDeploy` now build an unversioned contract deploy by default. The contract uses the default Clarity version of the current epoch (previously set to Clarity 4). The `clarityVersion` option is deprecated: from Epoch 4.1, nodes reject deploys that set a Clarity version. To keep the old behaviour before Epoch 4.1, set `clarityVersion` explicitly.
