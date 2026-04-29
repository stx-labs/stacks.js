import type { PublicProfileBase } from '@stacks/profile';

/** Internal representation of a Gaia hub connection config. */
export interface GaiaHubConfig {
  address: string;
  url_prefix: string;
  token: string;
  max_file_upload_size_megabytes: number | undefined;
  server: string;
}

/**
 *  Returned from the [[UserSession.loadUserData]] function.
 */
export interface UserData {
  // public: the email address for the user. only available if the `email`
  // scope is requested, and if the user has entered a valid email into
  // their profile.
  //
  // **Note**: Blockstack does not require email validation
  // for users for privacy reasons and blah blah (something like this, idk)
  email?: string;
  // probably public: (a quick description of what this is, and a link to the
  // DID foundation and/or the blockstack docs related to DID, idk)
  decentralizedID?: string;
  // probably private: looks like it happens to be the btc address but idk
  // the value of establishing this as a supported field
  identityAddress?: string;
  // probably public: this is an advanced feature, I think many app devs
  // using our more advanced encryption functions (as opposed to putFile/getFile),
  // are probably using this. seems useful to explain.
  appPrivateKey: string;
  // maybe public: possibly useful for advanced devs / webapps. I see an opportunity
  // to make a small plug about "user owned data" here, idk.
  hubUrl: string;
  coreNode: string;
  // maybe private: this would be an advanced field for app devs to use.
  authResponseToken: string;
  // private: does not get sent to webapp at all.
  coreSessionToken?: string;
  // private: does not get sent to webapp at all.
  gaiaAssociationToken?: string;
  // public: this is the proper `Person` schema json for the user.
  // This is the data that gets used when the `new blockstack.Person(profile)` class is used.
  profile: PublicProfileBase;
  // private: does not get sent to webapp at all.
  gaiaHubConfig?: GaiaHubConfig;
  // Based on issue with incorrect appPrivateKey derivation see stacks-web-wallet issue #2238
  appPrivateKeyFromWalletSalt?: string;
}
