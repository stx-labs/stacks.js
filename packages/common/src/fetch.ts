// Define default request options and allow modification using getters, setters
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Request/Request
const defaultFetchOpts: RequestInit = {
  // By default referrer value will be client:origin: above reference link
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
  referrerPolicy: 'origin', // Use origin value for referrer policy
  headers: {
    'x-hiro-product': 'stacksjs',
  },
};

/**
 * Get fetch options
 * @category Network
 */
export const getFetchOptions = () => {
  return defaultFetchOpts;
};

/**
 * Sets global fetch options for stacks.js network calls.
 *
 * @example
 * Users can change the default referrer as well as other options when fetch is used internally by stacks.js:
 * ```
 * setFetchOptions({ referrer: 'no-referrer', referrerPolicy: 'no-referrer', ...otherRequestOptions });
 * ```
 * After calling {@link setFetchOptions} all subsequent network calls will use the specified options above.
 *
 * @see MDN Request: https://developer.mozilla.org/en-US/docs/Web/API/Request/Request
 * @returns global fetch options after merging with previous options (or defaults)
 * @category Network
 * @related {@link getFetchOptions}
 */
export const setFetchOptions = (ops: RequestInit): RequestInit => {
  return Object.assign(defaultFetchOpts, ops);
};

/** @ignore */
export async function fetchWrapper(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const fetchOpts = {};
  // Use the provided options in request options along with default or user provided values
  Object.assign(fetchOpts, defaultFetchOpts, init);

  const fetchResult = await fetch(input, fetchOpts);
  return fetchResult;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * @ignore Internally used for letting networking functions specify "API" options.
 * Should be compatible with the `client`s created by the API and RPC packages.
 */
export interface ClientOpts {
  baseUrl?: string;
  fetch?: FetchFn;
}

/** @ignore Internally used for letting networking functions specify "API" options */
export interface ClientParam {
  /** Optional API object (for `.baseUrl` and `.fetch`) used for API/Node, defaults to use mainnet */
  client?: ClientOpts;
}

export interface RequestContext {
  fetch: FetchFn;
  url: string;
  init: RequestInit;
}

export interface ResponseContext {
  fetch: FetchFn;
  url: string;
  init: RequestInit;
  response: Response;
}

export interface FetchParams {
  url: string;
  init: RequestInit;
}

export interface FetchMiddleware {
  pre?: (context: RequestContext) => PromiseLike<FetchParams | void> | FetchParams | void;
  post?: (context: ResponseContext) => Promise<Response | void> | Response | void;
}
export interface ApiKeyMiddlewareOpts {
  /** The middleware / API key header will only be added to requests matching this host. */
  host?: RegExp | string;
  /** The http header name used for specifying the API key value. */
  httpHeader?: string;
  /** The API key string to specify as an http header value. */
  apiKey: string;
}

/** @ignore */
export function hostMatches(host: string, pattern: string | RegExp) {
  if (typeof pattern === 'string') return pattern === host;
  return pattern.exec(host);
}

/**
 * Creates a new middleware from an API key.
 * @example
 * ```
 * const apiMiddleware = createApiKeyMiddleware("example_e8e044a3_41d8b0fe_3dd3988ef302");
 * const fetchFn = createFetchFn(apiMiddleware);
 * const network = new StacksMainnet({ fetchFn });
 * ```
 * @category Network
 * @related {@link createFetchFn}, {@link StacksNetwork}
 */
export function createApiKeyMiddleware({
  apiKey,
  host = /(.*)api(.*)(\.stacks\.co|\.hiro\.so)$/i,
  httpHeader = 'x-api-key',
}: ApiKeyMiddlewareOpts): FetchMiddleware {
  return {
    pre: context => {
      const reqUrl = new URL(context.url);
      if (!hostMatches(reqUrl.host, host)) return; // Skip middleware if host does not match pattern

      const headers =
        context.init.headers instanceof Headers
          ? context.init.headers
          : (context.init.headers = new Headers(context.init.headers));
      headers.set(httpHeader, apiKey);
    },
  };
}

function argsForCreateFetchFn(args: any[]): { fetchLib: FetchFn; middlewares: FetchMiddleware[] } {
  let fetchLib: FetchFn = fetchWrapper;
  let middlewares: FetchMiddleware[] = [];
  if (args.length > 0 && typeof args[0] === 'function') {
    fetchLib = args.shift();
  }
  if (args.length > 0) {
    middlewares = args; // remaining args
  }
  return { fetchLib, middlewares };
}

/**
 * Creates a new network fetching function, which combines an optional fetch-compatible library with optional middleware.
 * @example
 * ```
 * const customFetch = createFetchFn(someMiddleware)
 * const customFetch = createFetchFn(fetch, someMiddleware)
 * const customFetch = createFetchFn(fetch, middlewareA, middlewareB)
 * ```
 * @category Network
 */
export function createFetchFn(fetchLib: FetchFn, ...middleware: FetchMiddleware[]): FetchFn;
export function createFetchFn(...middleware: FetchMiddleware[]): FetchFn;
export function createFetchFn(...args: any[]): FetchFn {
  const { fetchLib, middlewares } = argsForCreateFetchFn(args);

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    let fetchParams = { url, init: init ?? {} };

    for (const middleware of middlewares) {
      if (typeof middleware.pre === 'function') {
        const result = await Promise.resolve(
          middleware.pre({
            fetch: fetchLib,
            ...fetchParams,
          })
        );
        fetchParams = result ?? fetchParams;
      }
    }

    let response = await fetchLib(fetchParams.url, fetchParams.init);

    for (const middleware of middlewares) {
      if (typeof middleware.post === 'function') {
        const result = await Promise.resolve(
          middleware.post({
            fetch: fetchLib,
            url: fetchParams.url,
            init: fetchParams.init,
            response: response?.clone() ?? response,
          })
        );
        response = result ?? response;
      }
    }
    return response;
  };
  return fetchFn;
}

// /** @ignore Creates a client-like object, which can be used without circular dependencies */
// export function defaultClientOpts(opts?: { baseUrl?: string; fetch?: FetchFn }) {
//   return {
//     baseUrl: opts?.baseUrl ?? HIRO_MAINNET_URL,
//     fetch: opts?.fetch ?? createFetchFn(),
//   };
// }
