export const SIGNIN_CSS = `
h1 {
  font-family: monospace;
  font-size: 24px;
  font-style: normal;
  font-variant: normal;
  font-weight: 700;
  line-height: 26.4px;
}
h3 {
  font-family: monospace;
  font-size: 14px;
  font-style: normal;
  font-variant: normal;
  font-weight: 700;
  line-height: 15.4px;
}
p {
  font-family: monospace;
  font-size: 14px;
  font-style: normal;
  font-variant: normal;
  font-weight: 400;
  line-height: 20px;
}
b {
  background-color: #e8e8e8;
}
pre {
  font-family: monospace;
  font-size: 13px;
  font-style: normal;
  font-variant: normal;
  font-weight: 400;
  line-height: 18.5714px;
}`;

export const SIGNIN_HEADER = `<html><head><style>${SIGNIN_CSS}</style></head></body><h3>Blockstack CLI Sign-in</h3><br>`;
export const SIGNIN_DESC = '<p>Sign-in request for <b>"{appName}"</b></p>';
export const SIGNIN_SCOPES = '<p>Requested scopes: <b>"{appScopes}"</b></p>';
export const SIGNIN_FMT_NAME = '<p><a href="{authRedirect}">{blockstackID}</a> ({idAddress})</p>';
export const SIGNIN_FMT_ID = '<p><a href="{authRedirect}">{idAddress}</a> (anonymous)</p>';
export const SIGNIN_FOOTER = '</body></html>';

export interface NamedIdentityType {
  name: string;
  idAddress: string;
  privateKey: string;
  index: number;
  profile: object;
  profileUrl: string;
}

/*
 * Get the app private key
 */

/*
 * Send a JSON HTTP response
 */

/*
 * Update a named identity's profile with new app data, if necessary.
 * Indicates whether or not the profile was changed.
 */

/*
 * Updates a named identitie's profile's API settings, if necessary.
 * Indicates whether or not the profile data changed.
 */
