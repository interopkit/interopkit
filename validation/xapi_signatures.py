"""Writes signed Statements that jwcrypto signs, for the tests of `verifyStatementSignature`: signatures that must verify and
signatures that must be refused, each with the verdict.

jwcrypto and cryptography share no code with the package. The script makes an X.509 chain of a root and a leaf, signs the
Statement with the leaf in the RSA series of JWS (RS256, RS384 and RS512) with the chain in the `x5c` header (xAPI 2.0 LRSs
4.2.6), and changes what the Statement, the signature and the header say for the cases that must fail. The keys are
generated at each run: the signatures differ between runs, and the cases and the verdicts do not. Run it from the repository
root with the packages of `validation/requirements.txt` installed:

    python3 -m venv validation/.venv
    validation/.venv/bin/pip install -r validation/requirements.txt
    validation/.venv/bin/python validation/xapi_signatures.py
"""

import base64
import datetime
import json
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from jwcrypto import jwk, jws
from jwcrypto.common import json_encode

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "learning-records" / "test" / "fixtures" / "xapi-signatures.json"
NOW = datetime.datetime(2026, 1, 15, 10, 30, tzinfo=datetime.timezone.utc)
SIGNATURE_ALGORITHMS = ["RS256", "RS384", "RS512"]

STATEMENT = {
    "id": "6690e6c9-3ef0-4ed3-8b37-7f3964730bee",
    "actor": {"objectType": "Agent", "name": "Example Learner", "mbox": "mailto:learner@example.org"},
    "verb": {"id": "http://adlnet.gov/expapi/verbs/completed", "display": {"en-US": "completed"}},
    "object": {"objectType": "Activity", "id": "https://example.org/activities/course-1"},
    "result": {"completion": True, "score": {"scaled": 0.9}},
    "timestamp": "2026-01-15T10:30:00.000Z",
}


def rsa_key():
    """A 2,048-bit RSA key."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def certificate(subject, key, issuer=None, issuer_key=None, authority=False):
    """An X.509 certificate for the key, signed by the issuer; a root signs itself."""
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject)])
    issuer_name = name if issuer is None else issuer.subject
    builder = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOW - datetime.timedelta(days=1))
        .not_valid_after(NOW + datetime.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=authority, path_length=None), critical=True)
    )
    return builder.sign(issuer_key or key, hashes.SHA256())


def der_base64(cert):
    """The `x5c` form of a certificate: the base64 of its DER encoding, with the standard alphabet and padding."""
    return base64.b64encode(cert.public_bytes(serialization.Encoding.DER)).decode()


def jwk_of(key):
    """The key as a JWK that jwcrypto signs with."""
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return jwk.JWK.from_pem(pem)


def text(value):
    """The JSON of a value as the bytes of a payload."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def sign(statement, key, algorithm, chain=None):
    """A compact JWS of the Statement with the algorithm; the chain goes in the `x5c` header when there is one."""
    header = {"alg": algorithm, **({"x5c": chain} if chain else {})}
    token = jws.JWS(text(statement))
    token.add_signature(jwk_of(key), alg=algorithm, protected=json_encode(header))
    return token.serialize(compact=True)


def encode_base64url(data):
    """Base64url without padding, as JWS writes it."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decode_base64url(value):
    """The bytes of base64url text without padding."""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def with_signature_flipped(token):
    """The token with one bit of its signature changed."""
    header, payload, signature = token.split(".")
    raw = bytearray(decode_base64url(signature))
    raw[0] ^= 1
    return ".".join([header, payload, encode_base64url(bytes(raw))])


def with_payload(token, statement):
    """The token whose payload is another Statement, under the signature of the first."""
    header, _, signature = token.split(".")
    return ".".join([header, encode_base64url(text(statement)), signature])


def with_header(token, header):
    """The token whose protected header is another, under the signature of the first."""
    _, payload, signature = token.split(".")
    return ".".join([encode_base64url(text(header)), payload, signature])


def changed(statement, **properties):
    """A copy of the Statement with other properties."""
    return {**statement, **properties}


def case(title, signature, expected, statement=None, key=None, trust=None):
    """A case: the Statement that is given, the signature, the key that is passed if any, and the verdict."""
    return {
        "title": title,
        "statement": STATEMENT if statement is None else statement,
        "signature": signature,
        **({"key": key} if key else {}),
        **({"trust": trust} if trust is not None else {}),
        "expected": expected,
    }


def cases(root, leaf, other):
    """Every case. `root` and `leaf` are (key, certificate) pairs; `other` is a leaf of an unrelated key."""
    chain = [der_base64(leaf[1]), der_base64(root[1])]
    other_chain = [der_base64(other[1])]
    valid = {"valid": True, "certified": True}
    uncertified = {"valid": True, "certified": False}
    rejected = lambda reason: {"valid": False, "reason": reason}
    out = []
    for algorithm in SIGNATURE_ALGORITHMS:
        signed = sign(STATEMENT, leaf[0], algorithm, chain)
        out.append(case(f"a statement signed with {algorithm} and a chain that the host trusts", signed, valid, trust="root"))
        out.append(case(f"a statement signed with {algorithm} and a chain that the host does not trust", signed, uncertified, trust="nobody"))
        out.append(case(f"a statement signed with {algorithm} and a chain, with no function that trusts it", signed, uncertified))
        out.append(case(f"a statement signed with {algorithm} and no chain, verified with the key", sign(STATEMENT, leaf[0], algorithm), uncertified, key=algorithm))
    signed = sign(STATEMENT, leaf[0], "RS256", chain)
    stored = changed(
        STATEMENT,
        stored="2026-01-15T10:31:00.000Z",
        authority={"objectType": "Agent", "account": {"homePage": "https://lrs.example.org", "name": "client-1"}},
        version="2.0.0",
    )
    out.append(case("a statement that the LRS stored, with what the LRS sets", signed, valid, statement=stored, trust="root"))
    without_id = {name: value for name, value in STATEMENT.items() if name != "id"}
    out.append(case("a statement signed before the LRS gave it an id", sign(without_id, leaf[0], "RS256", chain), valid, statement=STATEMENT, trust="root"))
    out.append(case("a statement of another actor than the one signed", signed, rejected("not-equivalent"), statement=changed(STATEMENT, actor={"objectType": "Agent", "mbox": "mailto:other@example.org"})))
    out.append(case("a statement of another verb than the one signed", signed, rejected("not-equivalent"), statement=changed(STATEMENT, verb={"id": "http://adlnet.gov/expapi/verbs/failed"})))
    out.append(case("a payload changed under the signature", with_payload(signed, changed(STATEMENT, result={"completion": False})), rejected("signature"), statement=changed(STATEMENT, result={"completion": False})))
    out.append(case("a signature with a bit changed", with_signature_flipped(signed), rejected("signature")))
    out.append(case("a chain whose leaf is not the key that signed", sign(STATEMENT, leaf[0], "RS256", other_chain), rejected("signature")))
    out.append(case("a key that did not sign, passed by the caller", sign(STATEMENT, leaf[0], "RS256"), rejected("signature"), key="other"))
    out.append(case("a signature with no chain and no key", sign(STATEMENT, leaf[0], "RS256"), rejected("no-key")))
    out.append(case("a header changed from RS256 to RS384 under the signature", with_header(signed, {"alg": "RS384", "x5c": chain}), rejected("signature")))
    out.append(case("a header that names no algorithm", with_header(signed, {"x5c": chain}), rejected("algorithm")))
    out.append(case("an x5c that is no list", with_header(signed, {"alg": "RS256", "x5c": "AAAA"}), rejected("malformed")))
    out.append(case("an x5c with text that is not base64", with_header(signed, {"alg": "RS256", "x5c": ["not base64!"]}), rejected("malformed")))
    out.append(case("an x5c with base64 that is no certificate", with_header(signed, {"alg": "RS256", "x5c": ["AAAA"]}), rejected("malformed")))
    for title, algorithm in [("PS256", "PS256"), ("ES256", "ES256"), ("HS256", "HS256")]:
        header = encode_base64url(text({"alg": algorithm}))
        out.append(case(f"a JWS signed with {title}", f"{header}.{signed.split('.')[1]}.{signed.split('.')[2]}", rejected("algorithm")))
    none = f"{encode_base64url(text({'alg': 'none'}))}.{signed.split('.')[1]}."
    out.append(case("a JWS with the algorithm none", none, rejected("algorithm")))
    token = jws.JWS(text(STATEMENT))
    token.add_signature(jwk_of(leaf[0]), alg="RS256", protected=json_encode({"alg": "RS256"}))
    out.append(case("a JWS in the JSON serialization", token.serialize(compact=False), rejected("malformed")))
    out.append(case("text that is no JWS", "not a jws", rejected("malformed")))
    out.append(case("an empty signature", "", rejected("malformed")))
    out.append(case("a JWS of two parts", ".".join(signed.split(".")[:2]), rejected("malformed")))
    out.append(case("a payload that is no Statement", sign({"hello": "world"}, leaf[0], "RS256", chain), rejected("malformed")))
    return out


def main():
    root_key, leaf_key, other_key, stranger_key = rsa_key(), rsa_key(), rsa_key(), rsa_key()
    root = (root_key, certificate("Example Root CA", root_key, authority=True))
    leaf = (leaf_key, certificate("Example Signer", leaf_key, root[1], root_key))
    other = (other_key, certificate("Example Other Signer", other_key, root[1], root_key))
    spki = serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    fixture = {
        "comment": "Written by validation/xapi_signatures.py with jwcrypto. The keys are generated at each run.",
        "root": der_base64(root[1]),
        "keys": {
            "leaf": base64.b64encode(leaf_key.public_key().public_bytes(*spki)).decode(),
            "other": base64.b64encode(stranger_key.public_key().public_bytes(*spki)).decode(),
        },
        "cases": cases(root, leaf, other),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(fixture['cases'])} cases to {OUTPUT}")


if __name__ == "__main__":
    main()
