import fetchMock from 'jest-fetch-mock';
import { fetchWrapper, getFetchOptions, setFetchOptions } from '../src/fetch';

test('Verify fetch private options', async () => {
  const defaultOptions = getFetchOptions();

  expect(defaultOptions).toEqual({
    referrerPolicy: 'origin',
    headers: {
      'x-hiro-product': 'stacksjs',
    },
  });

  // Override default options when fetchPrivate is called internally by other stacks.js libraries like transactions or from server side
  // This is for developers as they cannot directly pass options directly in fetchPrivate
  const modifiedOptions: RequestInit = {
    referrer: 'http://test.com',
    referrerPolicy: 'same-origin',
    headers: {
      'x-hiro-product': 'stacksjs',
    },
  };

  // Developers can set fetch options globally one time specifically when fetchPrivate is used internally by stacks.js libraries
  setFetchOptions(modifiedOptions);

  expect(getFetchOptions()).toEqual(modifiedOptions);

  // Browser will replace about:client with actual url but it will not be visible in test case
  fetchMock.mockOnce(`{ status: 'success'}`, { headers: modifiedOptions as any });

  const result = await fetchWrapper('https://example.com');

  // Verify the request options
  expect(result.status).toEqual(200);
  expect(result.headers.get('referrer')).toEqual(modifiedOptions.referrer);
  expect(result.headers.get('referrerPolicy')).toEqual(modifiedOptions.referrerPolicy);
});
