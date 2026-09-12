import forge from 'node-forge';
import trustBundle from './trusted-roots.json';
import { verify as verifySignature } from 'node:crypto';
import { readLimited } from './http';
import { envelopeSchema, type Envelope, type Env } from './types';

type Entry = { publicKey: string; expiresAt: number };
/** No downloaded certificate is ever added as a trust anchor. */
export class AlexaVerifier {
  private cache = new Map<string, Entry>();
  private readonly roots: Record<string, string[]>;
  constructor(
    roots: readonly string[] | undefined = undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.roots = roots === undefined ? trustBundle.certificates : {};
    for (const pem of roots ?? []) {
      const certificate = forge.pki.certificateFromPem(pem);
      (this.roots[certificate.subject.hash!] ??= []).push(pem);
    }
  }

  async verify(headers: Headers, raw: Uint8Array, now = Date.now()): Promise<Envelope> {
    const url = certificateUrl(headers.get('SignatureCertChainUrl'));
    const signature = headers.get('Signature-256');
    if (!signature || signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
      throw new Error('signature');
    const envelope = envelopeSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    );
    const timestamp = Date.parse(envelope.request.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 150_000)
      throw new Error('timestamp');
    let entry = this.cache.get(url);
    if (!entry || now >= entry.expiresAt) {
      const response = await this.fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error('certificate_fetch');
      const pem = new TextDecoder().decode(await readLimited(response, 32_768));
      entry = this.validateChain(pem, now);
      if (this.cache.size >= 4) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(url, entry);
    }
    if (!verifySignature('RSA-SHA256', raw, entry.publicKey, Buffer.from(signature, 'base64')))
      throw new Error('signature');
    return envelope;
  }

  private validateChain(pem: string, now: number): Entry {
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks || blocks.length > 5) throw new Error('certificate_chain');
    const chain = blocks.map((block) => forge.pki.certificateFromPem(block));
    const leaf = chain[0];
    for (const cert of chain) {
      if (now < cert.validity.notBefore.getTime() || now >= cert.validity.notAfter.getTime())
        throw new Error('certificate_expiry');
    }
    const san = leaf.getExtension('subjectAltName') as {
      altNames?: { type: number; value?: string }[];
    } | null;
    if (!san?.altNames?.some((name) => name.type === 2 && name.value === 'echo-api.amazon.com'))
      throw new Error('certificate_san');
    // Select only candidate roots by distinguished-name hash. Actual trust still requires
    // full chain/signature validation; this index is not a security decision.
    const candidates = new Set(
      chain.flatMap((cert) => [
        ...(this.roots[cert.issuer.hash!] ?? []),
        ...(this.roots[cert.subject.hash!] ?? []),
      ]),
    );
    if (!candidates.size) throw new Error('untrusted_certificate');
    const store = forge.pki.createCaStore([...candidates]);
    forge.pki.verifyCertificateChain(store, chain, { validityCheckDate: new Date(now) });
    return {
      publicKey: forge.pki.publicKeyToPem(leaf.publicKey),
      expiresAt: Math.min(
        now + 3_600_000,
        ...chain.map((cert) => cert.validity.notAfter.getTime()),
      ),
    };
  }
}

export function certificateUrl(value: string | null): string {
  if (!value || value.length > 2048) throw new Error('certificate_url');
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  url.hash = '';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 's3.amazonaws.com' ||
    (url.port && url.port !== '443') ||
    !url.pathname.startsWith('/echo.api/') ||
    url.username ||
    url.password ||
    url.search ||
    /%|\\/.test(url.pathname)
  )
    throw new Error('certificate_url');
  return url.href;
}

export function authorize(e: Envelope, env: Env): void {
  const system = e.context.System;
  if (
    system.application.applicationId !== env.ALEXA_SKILL_ID ||
    system.user.userId !== env.ALLOWED_ALEXA_USER_ID ||
    (env.ALLOWED_ALEXA_DEVICE_ID && system.device.deviceId !== env.ALLOWED_ALEXA_DEVICE_ID) ||
    (e.session &&
      (e.session.application.applicationId !== system.application.applicationId ||
        e.session.user.userId !== system.user.userId))
  ) {
    throw new Error('unauthorized');
  }
}
