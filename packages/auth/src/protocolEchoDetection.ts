/**
 * This logic is in a separate file with no dependencies so that it can be
 * loaded and executed as soon as possible to fulfill the purpose of the protocol
 * detection technique. The effectiveness of this is obviously subject to how web
 * apps bundle/consume the blockstack.js lib.
 */

const GLOBAL_DETECTION_CACHE_KEY = '_blockstackDidCheckEchoReply';

declare global {
  interface Window {
    _blockstackDidCheckEchoReply?: boolean;
  }
}
const ECHO_REPLY_PARAM = 'echoReply';
const AUTH_CONTINUATION_PARAM = 'authContinuation';

function getQueryStringParams(query: string): Record<string, string> {
  if (!query) {
    return {};
  }
  // Trim a starting `?` character if exists
  const trimmed = /^[?#]/.test(query) ? query.slice(1) : query;
  return trimmed.split('&').reduce(
    (params, param) => {
      const [key, value] = param.split('=');
      params[key] = value ? decodeURIComponent(value.replace(/\+/g, ' ')) : '';
      return params;
    },
    {} as Record<string, string>
  );
}

/**
 * Checks if the current window location URL contains an 'echoReply' parameter
 * which indicates that this page was only opened to signal back to the originating
 * tab that the protocol handler is installed.
 * If found, then localStorage events are used to notify the other tab,
 * and this page is redirected back to the Blockstack authenticator URL.
 * This function caches its result and will not trigger multiple redirects when
 * invoked multiple times.
 * @returns True if detected and the page will be automatically redirected.
 * @hidden
 */
export function protocolEchoReplyDetection(): boolean {
  // Check that the `window` APIs exist
  let globalScope: Window;
  if (typeof self !== 'undefined') {
    globalScope = self;
  } else if (typeof window !== 'undefined') {
    globalScope = window;
  } else {
    // Exit detection function - we are not running in a browser environment.
    return false;
  }

  if (!globalScope.location || !globalScope.localStorage) {
    // Exit detection function - we are not running in a browser environment.
    return false;
  }

  // Avoid performing the check twice and triggered multiple redirect timers.
  const existingDetection = globalScope[GLOBAL_DETECTION_CACHE_KEY];
  if (typeof existingDetection === 'boolean') {
    return existingDetection;
  }

  const searchParams = getQueryStringParams(globalScope.location.search);
  const echoReplyParam = searchParams[ECHO_REPLY_PARAM];
  if (echoReplyParam) {
    globalScope[GLOBAL_DETECTION_CACHE_KEY] = true;

    // Use localStorage to notify originated tab that protocol handler is available and working.
    const echoReplyKey = `echo-reply-${echoReplyParam}`;

    // Set the echo-reply result in localStorage for the other window to see.
    globalScope.localStorage.setItem(echoReplyKey, 'success');

    // Redirect back to the localhost auth url, as opposed to another protocol launch.
    // This will re-use the same tab rather than creating another useless one.
    globalScope.setTimeout(() => {
      const authContinuationParam = searchParams[AUTH_CONTINUATION_PARAM];
      globalScope.location.href = authContinuationParam;
    }, 10);

    return true;
  }

  return false;
}
