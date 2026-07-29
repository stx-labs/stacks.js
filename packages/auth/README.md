# @stacks/auth

Construct and decode authentication requests for Stacks apps.

This package provides the auth logic used by the [Stacks Connect](https://github.com/hirosystems/connect) library. If you're looking to integrate Stacks authentication into your web app, Stacks Connect provides a simple API and built-in user interface. See the [authentication tutorial](https://docs.stacks.co/build-apps/references/authentication).

## Installation

```
npm install @stacks/auth
```

## Usage

### Generating an authentication request

```typescript
import { UserSession, makeAuthRequest, AppConfig } from '@stacks/auth';
```

The app domain is the URL to your website/app. This is how the Stacks authentication system identifies apps and determines what credentials to provide. Changing the app domain is equivalent to changing the app. Note that you also need to have a valid manifest.json file at the domain.

```typescript
const appDomain = 'https://www.myapp.com';
```

Next we set the basic permissions for your app to read and store user data. If your app will allow users to share data with other users, you will need an additional `publish_data` permission. We will also initiate a `UserSession` object using the configuration.

```typescript
const appConfig = new AppConfig(['store_write'], appDomain);
const userSession = new UserSession({ appConfig });
```

The authentication payloads are encrypted during transit, the encryption key generated below provides this

```typescript
const transitKey = userSession.generateAndStoreTransitKey();
```

The Stacks auth process will open a compatible Stacks authenticator or browser extension to perform the authentication. So you will need to provide a redirect URL which the authenticator or extension can redirect to with the authentication payload. This page should process the authentication payload.

```typescript
const redirectUri = 'https://www.myapp.com/auth';
```

Set the location of your app manifest file. This file contains information about your app that is shown to the user during authentication.

```typescript
const manifestUri = 'https://www.myapp.com/manifest.json';
```

Finally generate the authentication request payload:

```typescript
const authRequest = userSession.makeAuthRequest(transitKey, redirectUri, manifestUri);
```

The resulting payload can now be passed to a compatible Stacks authenticator or browser extension. If you are using Stacks connect, this is performed automatically.

If you would like to implement a Stacks authenticator, check out the reference implementation of the [Stacks browser extension, Hiro Wallet](https://github.com/hirosystems/stacks-wallet-web).

### Handling an authentication response payload

After an authenticator has processed your app's request, and the user has granted permission, the resulting response will be passed back to your app via the URL set in your `redirectUri`.

Below, we use `userSession.isSignInPending` to determine if there is an incoming authentication response. If detected, the `userSession.handlePendingSignIn` method will process the response and provide a `userData` object containing the user's identity, BNS username and profile information.

```typescript
if (userSession.isSignInPending()) {
  userSession.handlePendingSignIn().then(userData => {
    // Do something with userData
  });
}
```

### Checking if the user is signed in

Use the `userSession.isUserSignedIn` method to check if the user is already authenticated. If so, we can retrieve the user's profile data using `userSession.loadUserData`.

```typescript
if (userSession.isUserSignedIn()) {
  const userData = userSession.loadUserData();
}
```

### Sign out

To sign the user out simply call the `userSession.signUserOut` method.

```typescript
userSession.signUserOut();
```

### Data encryption

Stacks authentication also provides an easy way to encrypt the user's data. If you are using the [`@stacks/storage`](https://github.com/hirosystems/stacks.js/tree/main/packages/storage) package, encryption is automatically enabled. If you would like to perform encryption outside of storage you can use the `userSession.encryptContent` and `userSession.decryptContent` methods.

```typescript
const message = 'My secret message';
const cipherText = await userSession.encryptContent(message);
const plainText = await userSession.decryptContent(cipherText);
```

Note that encryption here uses the user's private key associated with your app only. If you need to share this data with another app or other users, you should use the equivalent methods from `@stacks/encryption` and provide a custom private key.
