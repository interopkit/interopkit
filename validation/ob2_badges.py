"""Writes Open Badges 2.0 badges for the tests of `achievement-credentials`: hosted and signed assertions with their
BadgeClasses, issuer profiles, keys and revocation lists, each with the outcome that its construction gives it.

jwcrypto and cryptography share no code with the package. The script writes every document as a server would host it,
hashes the recipients with `hashlib`, and signs the signed assertions with jwcrypto in RS256, the algorithm that Open
Badges 2.0 recommends, with the public key in PEM in a CryptographicKey that the issuer lists. The cases cover what a
verifier must tell apart: a valid badge, a revoked and an expired one, an assertion outside the verification policy of
its issuer, a changed payload and a key that the issuer does not list. They use the aliases of the context (`verify`,
`hosted`, `signed`) and the hashes `sha256$` and `md5$`. The keys are generated at each run: the signatures differ
between runs, and the documents and the outcomes do not. Run it from the repository root with the packages of
`validation/requirements.txt` installed:

    python3 -m venv validation/.venv
    validation/.venv/bin/pip install -r validation/requirements.txt
    validation/.venv/bin/python validation/ob2_badges.py
"""

import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwcrypto import jwk, jws
from jwcrypto.common import json_encode

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "achievement-credentials" / "test" / "fixtures" / "open-badges-2" / "badges.json"
CONTEXT = "https://w3id.org/openbadges/v2"
# The instant that a verifier of the cases reads as now: every badge was issued before it, and the expired one expired before it.
NOW = "2026-01-15T10:30:00Z"
LEARNER = "learner@example.org"
SALT = "deadsea"

HOST = "https://badges.example.org"
ISSUER = f"{HOST}/issuer"
KEY = f"{HOST}/keys/1"
REVOCATIONS = f"{HOST}/revocations"
PLATFORM = "https://platform.example.com"
PLATFORM_ISSUER = f"{PLATFORM}/issuers/acme"


def rsa_key():
    """A 2,048-bit RSA key."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def public_pem(key):
    """The public key in PEM, as a CryptographicKey holds it."""
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def jwk_of(key):
    """The key as a JWK that jwcrypto signs with."""
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return jwk.JWK.from_pem(pem)


def text(value):
    """The JSON of a value as the bytes of a payload."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def encode_base64url(data):
    """Base64url without padding, as JWS writes it."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(assertion, key):
    """A compact JWS of the assertion in RS256, whose payload is the JSON of the assertion (OB 2.0, SignedBadge)."""
    token = jws.JWS(text(assertion))
    token.add_signature(jwk_of(key), alg="RS256", protected=json_encode({"alg": "RS256"}))
    return token.serialize(compact=True)


def with_payload(token, assertion):
    """The JWS whose payload is another assertion, under the signature of the first."""
    header, _, signature = token.split(".")
    return ".".join([header, encode_base64url(text(assertion)), signature])


def hashed(algorithm, value, salt):
    """The identity hash of a value with a salt: the algorithm, `$`, and the hexadecimal digest of the value and the salt."""
    return f"{algorithm}${hashlib.new(algorithm, (value + salt).encode()).hexdigest()}"


def issuer_profile(**extra):
    """The profile of the issuer that hosts its badges, keys and revocation list at its own origin."""
    return {
        "@context": CONTEXT,
        "id": ISSUER,
        "type": "Issuer",
        "name": "Example Maker Society",
        "url": "https://example.org",
        "email": "badges@example.org",
        "publicKey": KEY,
        "revocationList": REVOCATIONS,
        **extra,
    }


def badge_class(identifier, issuer=ISSUER):
    """A BadgeClass with embedded criteria and an alignment."""
    return {
        "@context": CONTEXT,
        "id": identifier,
        "type": "BadgeClass",
        "name": "3-D Printmaster",
        "description": "Awarded for passing the 3-D printing knowledge and safety test.",
        "image": f"{identifier}/image",
        "criteria": {"narrative": "Pass a paper test and a supervised evaluation on live equipment."},
        "alignment": [{"targetName": "Additive manufacturing", "targetUrl": "https://standards.example.org/am/1"}],
        "tags": ["making", "safety"],
        "issuer": issuer,
    }


def assertion(identifier, badge, verification, **extra):
    """An assertion of the badge to the learner, whose email is hashed with SHA-256 and a salt."""
    return {
        "@context": CONTEXT,
        "id": identifier,
        "type": "Assertion",
        "recipient": {"type": "email", "hashed": True, "salt": SALT, "identity": hashed("sha256", LEARNER, SALT)},
        "badge": badge,
        "verification": verification,
        "issuedOn": "2025-11-02T09:00:00+00:00",
        **extra,
    }


def served(body, status=200):
    """A resource as the fixture server answers it."""
    return {"status": status, "body": body}


def case(name, outcome, verification, input_value, payload=None):
    """A case: the input that a verifier is given, the outcome that the construction gives, and what a JWS signs."""
    return {
        "name": name,
        "verification": verification,
        "outcome": outcome,
        "input": input_value,
        **({"payload": payload} if payload is not None else {}),
    }


def main():
    key, stranger = rsa_key(), rsa_key()
    badge_url = f"{HOST}/badges/printmaster"
    platform_badge_url = f"{PLATFORM}/badges/acme/welder"
    documents = {
        ISSUER: served(issuer_profile()),
        badge_url: served(badge_class(badge_url)),
        KEY: served({"@context": CONTEXT, "id": KEY, "type": "CryptographicKey", "owner": ISSUER, "publicKeyPem": public_pem(key)}),
        PLATFORM_ISSUER: served(
            {
                "@context": CONTEXT,
                "id": PLATFORM_ISSUER,
                "type": "Profile",
                "name": "Acme Welding Guild",
                "url": "https://acme.example.com",
                "email": "guild@acme.example.com",
                "verification": {"type": "VerificationObject", "startsWith": f"{PLATFORM}/assertions/acme/"},
            }
        ),
        platform_badge_url: served(badge_class(platform_badge_url, PLATFORM_ISSUER)),
    }
    hosted = {"type": "hosted"}
    valid = assertion(f"{HOST}/assertions/1", badge_url, hosted, expires="2027-11-02T09:00:00Z")
    embedded = assertion(
        f"{HOST}/assertions/2",
        {**badge_class(badge_url), "issuer": {name: value for name, value in issuer_profile().items() if name != "@context"}},
        {"type": "HostedBadge"},
        evidence=[{"id": f"{HOST}/evidence/2", "narrative": "Printed a calibration cube."}],
    )
    embedded["badge"].pop("@context")
    md5_recipient = {
        **assertion(f"{HOST}/assertions/3", badge_url, hosted),
        "recipient": {"type": "email", "hashed": True, "salt": SALT, "identity": hashed("md5", LEARNER, SALT)},
    }
    plain_recipient = {
        **assertion(f"{HOST}/assertions/4", badge_url, hosted),
        "recipient": {"type": "email", "hashed": False, "identity": LEARNER},
    }
    revoked_body = {"@context": CONTEXT, "id": f"{HOST}/assertions/5", "revoked": True, "revocationReason": "Awarded in error"}
    gone = assertion(f"{HOST}/assertions/6", badge_url, hosted)
    expired = assertion(f"{HOST}/assertions/7", badge_url, hosted, expires="2025-12-01T00:00:00Z")
    outside = assertion("https://elsewhere.example.net/assertions/8", badge_url, hosted)
    in_scope = assertion(f"{PLATFORM}/assertions/acme/9", platform_badge_url, hosted)
    out_of_scope = assertion(f"{PLATFORM}/assertions/other/10", platform_badge_url, hosted)
    for value in [valid, embedded, md5_recipient, plain_recipient, gone, expired, outside, in_scope, out_of_scope]:
        documents[value["id"]] = served(value)
    documents[f"{HOST}/assertions/5"] = served(revoked_body)
    documents[f"{HOST}/assertions/6"] = served(None, 410)

    signed_valid = assertion(
        "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a01", badge_url, {"type": "SignedBadge", "creator": KEY}
    )
    signed_alias = {
        name: value
        for name, value in assertion("urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a02", badge_url, {}).items()
        if name != "verification"
    }
    signed_alias["verify"] = {"type": "signed", "creator": KEY}
    signed_revoked = assertion(
        "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a03", badge_url, {"type": "SignedBadge", "creator": KEY}
    )
    signed_unlisted = assertion(
        "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a04", badge_url, {"type": "SignedBadge", "creator": f"{HOST}/keys/2"}
    )
    documents[f"{HOST}/keys/2"] = served(
        {"@context": CONTEXT, "id": f"{HOST}/keys/2", "type": "CryptographicKey", "owner": ISSUER, "publicKeyPem": public_pem(stranger)}
    )
    documents[REVOCATIONS] = served(
        {
            "@context": CONTEXT,
            "id": REVOCATIONS,
            "type": "RevocationList",
            "issuer": ISSUER,
            "revokedAssertions": [
                {"id": signed_revoked["id"], "revocationReason": "Policy violation"},
                "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0aff",
                {"uid": "legacy-11"},
            ],
        }
    )
    signed_token = sign(signed_valid, key)
    tampered = {**signed_valid, "issuedOn": "2025-12-24T09:00:00+00:00"}

    cases = [
        case("a hosted assertion fetched at its id", "valid", "hosted", valid["id"]),
        case("a hosted assertion given as JSON", "valid", "hosted", valid),
        case("a hosted assertion that embeds its BadgeClass and issuer", "valid", "hosted", embedded),
        case("a hosted assertion whose recipient is hashed with MD5", "valid", "hosted", md5_recipient),
        case("a hosted assertion whose recipient is a plain email", "valid", "hosted", plain_recipient),
        case("a hosted assertion within the startsWith of its issuer", "valid", "hosted", in_scope),
        case("a hosted assertion that its host marks revoked", "revoked", "hosted", f"{HOST}/assertions/5"),
        case("a hosted assertion whose host answers 410 Gone", "revoked", "hosted", gone),
        case("a hosted assertion that expired", "expired", "hosted", expired),
        case("a hosted assertion on another origin than its issuer", "outside-policy", "hosted", outside),
        case("a hosted assertion outside the startsWith of its issuer", "outside-policy", "hosted", out_of_scope),
        case("a signed assertion", "valid", "signed", signed_token, signed_valid),
        case(
            "a signed assertion that names its verification with the aliases verify and signed",
            "valid",
            "signed",
            sign(signed_alias, key),
            signed_alias,
        ),
        case("a signed assertion in the revocation list of its issuer", "revoked", "signed", sign(signed_revoked, key), signed_revoked),
        case(
            "a signed assertion whose payload changed under the signature",
            "bad-signature",
            "signed",
            with_payload(signed_token, tampered),
            tampered,
        ),
        case(
            "a signed assertion by a key that the issuer does not list",
            "unlisted-key",
            "signed",
            sign(signed_unlisted, stranger),
            signed_unlisted,
        ),
    ]
    fixture = {
        "comment": "Written by validation/ob2_badges.py with jwcrypto and hashlib. The keys are generated at each run.",
        "now": NOW,
        "recipient": {"type": "email", "value": LEARNER},
        "documents": documents,
        "cases": cases,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
