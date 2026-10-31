"""Writes tokens that PyJWT signs, for the tests of the tool role: a launch that verifies, and launches that must not.

PyJWT is the library that PyLTI1p3 signs and verifies with, so these tokens come from an implementation that shares no code
with the tool. The key is generated at each run: the signatures differ between runs, and the cases and the reasons that the
tool must give do not. Run it from the repository root with the packages of `validation/requirements.txt` installed:

    python3 -m venv validation/.venv
    validation/.venv/bin/pip install -r validation/requirements.txt
    validation/.venv/bin/python validation/lti_tokens.py
"""

import base64
import json
from pathlib import Path

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "tool-integration" / "test" / "fixtures" / "lti-tokens.json"
ISSUER = "https://lms.example.edu"
CLIENT_ID = "962fa4d8-bcbf-49a0-94b2-2de05ad274af"
DEPLOYMENT_ID = "07940580-b309-415e-a37c-914d387c1150"
KEY_ID = "platform-ext"
NONCE = "nonce-from-pyjwt"
NOW = 1_700_000_000
CLAIM = "https://purl.imsglobal.org/spec/lti/claim/"


def key_pair():
    """A 2,048-bit RSA key, as Security Framework section 6.2 asks of keys."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def launch_claims():
    """The claims of a resource link launch: LTI 1.3 Core section 5.3."""
    return {
        "iss": ISSUER,
        "sub": "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
        "aud": CLIENT_ID,
        "iat": NOW,
        "exp": NOW + 300,
        "nonce": NONCE,
        CLAIM + "message_type": "LtiResourceLinkRequest",
        CLAIM + "version": "1.3.0",
        CLAIM + "deployment_id": DEPLOYMENT_ID,
        CLAIM + "target_link_uri": "https://tool.example.com/lti/launch",
        CLAIM + "roles": ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        CLAIM + "resource_link": {"id": "200d101f-2c14-434a-a0f3-57c2a42369fd", "title": "Introduction Assignment"},
    }


def sign(claims, key, headers=None):
    """A compact JWS of RS256 with the `kid` of the platform's key set."""
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": KEY_ID} if headers is None else headers)


def tampered(token):
    """The token with a claim of its payload changed after it was signed."""
    header, payload, signature = token.split(".")
    padded = payload + "=" * (-len(payload) % 4)
    body = json.loads(base64.urlsafe_b64decode(padded))
    body["sub"] = "someone-else"
    changed = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode()).rstrip(b"=").decode()
    return ".".join([header, changed, signature])


def cases(key, other):
    """Every token, with whether the tool must accept it and the reason it must give when it refuses."""
    claims = launch_claims()
    without_exp = {name: value for name, value in claims.items() if name != "exp"}
    signed = sign(claims, key)
    return [
        ("a launch signed by PyJWT", signed, None),
        ("a token that expired", sign({**claims, "exp": NOW - 3600, "iat": NOW - 3900}, key), "token-expired"),
        ("a token of another issuer", sign({**claims, "iss": "https://other.example"}, key), "issuer-mismatch"),
        ("a token for another client", sign({**claims, "aud": "another-client"}, key), "audience-mismatch"),
        ("a token for two audiences", sign({**claims, "aud": [CLIENT_ID, "another-client"]}, key), "audience-mismatch"),
        ("a token with no algorithm", jwt.encode(claims, None, algorithm="none", headers={"kid": KEY_ID}), "algorithm-unsupported"),
        ("a token signed with HMAC", jwt.encode(claims, "x" * 64, algorithm="HS256", headers={"kid": KEY_ID}), "algorithm-unsupported"),
        ("a token signed by another key", sign(claims, other), "signature-invalid"),
        ("a token whose payload changed after it was signed", tampered(signed), "signature-invalid"),
        ("a token with no kid", sign(claims, key, headers={}), "key-unknown"),
        ("a token that is not valid yet", sign({**claims, "nbf": NOW + 3600}, key), "issued-in-future"),
        ("a token issued in the future", sign({**claims, "iat": NOW + 3600, "exp": NOW + 3900}, key), "issued-in-future"),
        ("a token with no expiry", sign(without_exp, key), "claim-missing"),
    ]


def main():
    key = key_pair()
    other = key_pair()
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update({"kid": KEY_ID, "use": "sig", "alg": "RS256"})
    fixture = {
        "issuer": ISSUER,
        "clientId": CLIENT_ID,
        "deploymentId": DEPLOYMENT_ID,
        "nonce": NONCE,
        "now": NOW,
        "jwk": jwk,
        "cases": [{"name": name, "token": token, "reason": reason} for name, token, reason in cases(key, other)],
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2) + "\n")


if __name__ == "__main__":
    main()
