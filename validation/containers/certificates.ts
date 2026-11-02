import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "./host.ts";

/** A certificate authority of one run and a certificate that it signed for some names, as PEM text. */
export interface Certificates {
  /** The authority's certificate, which a client of the names trusts. */
  readonly authority: string;
  /** The certificate of the names, signed by the authority. */
  readonly certificate: string;
  /** The private key of the certificate. */
  readonly key: string;
}

/** The days that the certificates are valid: the run takes minutes, and a leftover copy must not outlive the week. */
const VALID_DAYS = "2";
const CURVE = "ec_paramgen_curve:prime256v1";

/** Runs `openssl` and throws when it fails. */
async function openssl(...args: readonly string[]): Promise<void> {
  const { code, output } = await execute("openssl", args);
  if (code !== 0) throw new Error(`openssl ${args.join(" ")} exited with ${code}:\n${output}`);
}

/**
 * Makes a certificate authority and a certificate for `names` with the `openssl` command, which Node.js has no API to replace.
 * The files exist only in a folder that this function removes before it returns.
 *
 * @param names - The DNS names of the certificate; the first is its common name.
 */
export async function createCertificates(names: readonly string[]): Promise<Certificates> {
  const folder = await mkdtemp(join(tmpdir(), "interopkit-certificates-"));
  const file = (name: string) => join(folder, name);
  try {
    await openssl(
      ...["req", "-x509", "-newkey", "ec", "-pkeyopt", CURVE, "-nodes", "-days", VALID_DAYS],
      ...["-keyout", file("authority.key"), "-out", file("authority.pem"), "-subj", "/CN=interopkit test authority"],
      ...["-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign"],
      // Python 3.13 verifies strictly (X509_STRICT): the authority needs a key identifier, and so does what it signs.
      ...["-addext", "subjectKeyIdentifier=hash"],
    );
    await openssl(
      ...["req", "-new", "-newkey", "ec", "-pkeyopt", CURVE, "-nodes"],
      ...["-keyout", file("server.key"), "-out", file("server.csr"), "-subj", `/CN=${names[0]}`],
    );
    await writeFile(
      file("server.ext"),
      [
        `subjectAltName=${names.map((name) => `DNS:${name}`).join(",")}`,
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature",
        "extendedKeyUsage=serverAuth",
        "subjectKeyIdentifier=hash",
        "authorityKeyIdentifier=keyid:always",
      ].join("\n"),
    );
    await openssl(
      ...["x509", "-req", "-in", file("server.csr"), "-CA", file("authority.pem"), "-CAkey", file("authority.key")],
      ...["-CAcreateserial", "-out", file("server.pem"), "-days", VALID_DAYS, "-extfile", file("server.ext")],
    );
    return {
      authority: await readFile(file("authority.pem"), "utf8"),
      certificate: await readFile(file("server.pem"), "utf8"),
      key: await readFile(file("server.key"), "utf8"),
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
