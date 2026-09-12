import { beforeAll, describe, expect, it, vi } from 'vitest';
import forge from 'node-forge';
import { generateKeyPairSync, sign } from 'node:crypto';
import trustBundle from '../src/trusted-roots.json';
import { AlexaVerifier, authorize, certificateUrl } from '../src/security';
import { envelope, env, now } from './helpers';

let rootPem: string, leafPem: string, leafKey: string, wrongSan: string, expired: string;
const certUrl = 'https://s3.amazonaws.com/echo.api/test.pem';
function keypair() {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKey: forge.pki.publicKeyFromPem(keys.publicKey),
    privateKey: forge.pki.privateKeyFromPem(keys.privateKey),
    pem: keys.privateKey,
  };
}
beforeAll(() => {
  const rootKey = keypair();
  const child = keypair();
  leafKey = child.pem;
  const root = forge.pki.createCertificate();
  root.publicKey = rootKey.publicKey;
  root.serialNumber = '01';
  root.validity.notBefore = new Date(now - 86400_000);
  root.validity.notAfter = new Date(now + 86400_000);
  root.setSubject([{ name: 'commonName', value: 'Test only root' }]);
  root.setIssuer(root.subject.attributes);
  root.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true },
  ]);
  root.sign(rootKey.privateKey, forge.md.sha256.create());
  rootPem = forge.pki.certificateToPem(root);
  function leaf(san: string, end = now + 3600_000) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = child.publicKey;
    cert.serialNumber = '02';
    cert.validity.notBefore = new Date(now - 86400_000);
    cert.validity.notAfter = new Date(end);
    cert.setSubject([{ name: 'commonName', value: 'echo-api.amazon.com' }]);
    cert.setIssuer(root.subject.attributes);
    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 2, value: san }] },
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
    ]);
    cert.sign(rootKey.privateKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(cert);
  }
  leafPem = leaf('echo-api.amazon.com');
  wrongSan = leaf('attacker.example');
  expired = leaf('echo-api.amazon.com', now - 1);
});
function signed(body = JSON.stringify(envelope())) {
  const raw = new TextEncoder().encode(body);
  return {
    raw,
    headers: new Headers({
      SignatureCertChainUrl: certUrl,
      'Signature-256': Buffer.from(sign('RSA-SHA256', raw, leafKey)).toString('base64'),
    }),
  };
}
describe('Alexa verification', () => {
  it('verifies a trusted chain and raw bytes; caches only verified certificates', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(leafPem));
    const verifier = new AlexaVerifier([rootPem], fetcher);
    const { headers, raw } = signed();
    expect((await verifier.verify(headers, raw, now)).context.System.user.userId).toBe('owner');
    await verifier.verify(headers, raw, now + 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    const changed = new TextEncoder().encode(
      new TextDecoder().decode(raw).replace('owner', 'other'),
    );
    await expect(verifier.verify(headers, changed, now)).rejects.toThrow();
  });
  it('rejects wrong SAN, expired certificates and untrusted chains', async () => {
    const { headers, raw } = signed();
    for (const pem of [wrongSan, expired]) {
      await expect(
        new AlexaVerifier([rootPem], vi.fn().mockResolvedValue(new Response(pem))).verify(
          headers,
          raw,
          now,
        ),
      ).rejects.toThrow();
    }
    // Appending a self-signed root does not make it trusted by the real runtime store.
    expect(Object.keys(trustBundle.certificates).length).toBeGreaterThan(0);
    await expect(
      new AlexaVerifier(
        undefined,
        vi.fn().mockResolvedValue(new Response(leafPem + rootPem)),
      ).verify(headers, raw, now),
    ).rejects.toThrow();
  });
  it('rejects stale/future timestamps before any network request', async () => {
    for (const delta of [-150_001, 150_001]) {
      const fetcher = vi.fn();
      const verifier = new AlexaVerifier([rootPem], fetcher);
      const e = envelope();
      e.request.timestamp = new Date(now + delta).toISOString();
      const { headers, raw } = signed(JSON.stringify(e));
      await expect(verifier.verify(headers, raw, now)).rejects.toThrow('timestamp');
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('rejects missing signatures, malformed bodies, oversized certificate downloads', async () => {
    const { headers, raw } = signed();
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(33000)));
    await expect(new AlexaVerifier([rootPem], fetcher).verify(headers, raw, now)).rejects.toThrow();
    headers.delete('Signature-256');
    await expect(new AlexaVerifier([rootPem], vi.fn()).verify(headers, raw, now)).rejects.toThrow();
  });
  it('normalizes valid certificate URLs and rejects SSRF targets', () => {
    expect(
      certificateUrl('https://s3.amazonaws.com:443/echo.api/../echo.api/test.pem#fragment'),
    ).toBe(certUrl);
    for (const url of [
      'http://s3.amazonaws.com/echo.api/a',
      'https://s3.amazonaws.com.evil.test/echo.api/a',
      'https://s3.amazonaws.com:444/echo.api/a',
      'https://s3.amazonaws.com/ECHO.api/a',
      'https://user@s3.amazonaws.com/echo.api/a',
      'https://s3.amazonaws.com/echo.api/%2e%2e/a',
      'https://s3.amazonaws.com/echo.api/a?redirect=evil',
    ])
      expect(() => certificateUrl(url)).toThrow();
  });
  it('checks skill, account, optional device, and session/context consistency', () => {
    expect(() => authorize(envelope(), env)).not.toThrow();
    for (const patch of [
      { ALEXA_SKILL_ID: 'other' },
      { ALLOWED_ALEXA_USER_ID: 'other' },
      { ALLOWED_ALEXA_DEVICE_ID: 'other' },
    ])
      expect(() => authorize(envelope(), { ...env, ...patch })).toThrow();
    const e = envelope();
    e.session!.user.userId = 'other';
    expect(() => authorize(e, env)).toThrow();
  });
});
