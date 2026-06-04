import { describe, expect, it } from 'vitest';
import { appendCheckoutReturnParams, appendReturnUrl } from '../lib/stripe-return-url';

describe('stripe return URLs', () => {
  it('adds extension return URL to payment result pages', () => {
    expect(appendReturnUrl(
      'https://server.example/payment/success?session_id={CHECKOUT_SESSION_ID}',
      'chrome-extension://abc123/options/index.html#account',
    )).toBe(
      'https://server.example/payment/success?session_id=%7BCHECKOUT_SESSION_ID%7D&return_url=chrome-extension%3A%2F%2Fabc123%2Foptions%2Findex.html%23account',
    );
  });

  it('ignores unsupported return URL protocols', () => {
    expect(appendReturnUrl(
      'https://server.example/payment/success',
      'javascript:alert(1)',
    )).toBe('https://server.example/payment/success');
  });

  it('adds valid extension ID to payment result pages', () => {
    expect(appendCheckoutReturnParams('https://server.example/payment/success', {
      returnUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options/index.html#account',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    })).toBe(
      'https://server.example/payment/success?return_url=chrome-extension%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop%2Foptions%2Findex.html%23account&extension_id=abcdefghijklmnopabcdefghijklmnop',
    );
  });
});
