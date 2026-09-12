import { rootCertificates } from 'node:tls';
import { writeFileSync } from 'node:fs';
import forge from 'node-forge';

// Use an official, maintained Node LTS release. Only public CA certificates are saved.
const certificates = {};
let skipped = 0;
for (const pem of rootCertificates) {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    (certificates[cert.subject.hash] ??= []).push(pem);
  } catch {
    skipped++; /* RSA-only verifier cannot use ECDSA trust anchors. */
  }
}
if (!Object.keys(certificates).length) throw new Error('Empty trust store');
writeFileSync(
  new URL('../src/trusted-roots.json', import.meta.url),
  JSON.stringify(
    {
      source: `node:tls.rootCertificates from Node.js ${process.version} (Mozilla CA store)`,
      generatedAt: new Date().toISOString(),
      skippedUnsupported: skipped,
      certificates,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Saved ${Object.keys(certificates).length} subject groups; ${skipped} unsupported roots skipped.`,
);
