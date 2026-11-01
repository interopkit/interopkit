"""Writes the baked-image fixtures of achievement-credentials: PNG and SVG images with a credential written into them, and
images that a reader must refuse.

The PNG files are written chunk by chunk with Python's struct and zlib (zlib.crc32 for the CRC-32), and the SVG files by string
edits of the exact start tag of the root. Both follow the text of Open Badges 3.0 section 5.3 and CLR 2.0 section 4.3 and share
no code with the package. Every SVG is parsed with ElementTree, which also finds each credential in it again, so that a fixture
that is not well-formed XML or does not hold what it should is not written.
"""

import base64
import json
import struct
import zlib
from pathlib import Path
from xml.etree import ElementTree

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "achievement-credentials" / "test" / "fixtures" / "baking" / "baked-images.json"

VC = "https://www.w3.org/ns/credentials/v2"
OB_CONTEXT = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"
CLR_CONTEXT = "https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json"
PROFILE = {"id": "https://example.edu/issuers/1", "type": ["Profile"]}
FORMATS = {
    "badge": {"keyword": "openbadgecredential", "namespace": "https://purl.imsglobal.org/ob/v3p0", "prefix": "openbadges"},
    "clr": {"keyword": "clrcredential", "namespace": "https://purl.imsglobal.org/clr/v2p0", "prefix": "clr"},
}
SVG_NAMESPACE = "http://www.w3.org/2000/svg"


def achievement_credential():
    """An OpenBadgeCredential with the properties that the schemas require, and a name that needs escaping in XML and JSON."""
    return {
        "@context": [VC, OB_CONTEXT],
        "id": "https://example.edu/credentials/1",
        "type": ["VerifiableCredential", "OpenBadgeCredential"],
        "issuer": PROFILE,
        "validFrom": "2024-06-13T10:00:00Z",
        "credentialSubject": {
            "id": "did:example:learner",
            "type": ["AchievementSubject"],
            "achievement": {
                "id": "https://example.edu/achievements/1",
                "type": ["Achievement"],
                "criteria": {"narrative": "Pass the course ]]> <b> & \"quotes\" é世\U0001f600."},
                "description": "Passed the course.",
                "name": "Course",
            },
        },
    }


def clr_credential():
    """A ClrCredential that carries the credential above."""
    return {
        "@context": [VC, CLR_CONTEXT, OB_CONTEXT],
        "id": "https://example.edu/clrs/1",
        "type": ["VerifiableCredential", "ClrCredential"],
        "name": "Transcript",
        "issuer": PROFILE,
        "validFrom": "2024-06-13T10:00:00Z",
        "credentialSubject": {
            "id": "did:example:learner",
            "type": ["ClrSubject"],
            "verifiableCredential": [achievement_credential()],
        },
    }


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def compact_json(value):
    """The text that JSON.stringify writes: no spaces, characters kept as they are."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def jws(claims):
    """A compact JWS with the claims as its payload. Baking never checks the signature, so its bytes are arbitrary."""
    header = compact_json({"alg": "RS256", "kid": "https://example.edu/keys#key-1", "typ": "JWT"})
    return f"{b64url(header.encode())}.{b64url(compact_json(claims).encode())}.{b64url(b'not a signature')}"


def chunk(kind, data):
    """A PNG chunk: length, type, data, and the CRC-32 of the type and the data (PNG 1.2, section 5.3)."""
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))


def itxt(keyword, text, compression=0, method=0, language=b"", translated=b""):
    """An iTXt chunk (PNG 1.2, section 11.3.4.5): keyword, null, flag, method, language, null, translated, null, text."""
    data = keyword.encode("latin-1") + b"\0" + bytes([compression, method]) + language + b"\0" + translated + b"\0" + text
    return chunk(b"iTXt", data)


SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
IHDR = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
IDAT = chunk(b"IDAT", zlib.compress(b"\x00\x10\x20\x30\xff"))
IEND = chunk(b"IEND", b"")
PHYS = chunk(b"pHYs", struct.pack(">IIB", 2835, 2835, 1))
TEXT = chunk(b"tEXt", b"Title\0Badge")


def png(*chunks):
    return SIGNATURE + b"".join(chunks)


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def text_of(value):
    return value if isinstance(value, str) else compact_json(value)


def png_fixtures(credentials):
    base = png(IHDR, PHYS, IDAT, TEXT, IEND)
    cases = {}
    for name, (kind, value) in credentials.items():
        chunk_bytes = itxt(FORMATS[kind]["keyword"], text_of(value).encode("utf-8"))
        # The credential goes right after IHDR; every other chunk keeps its place and its bytes.
        cases[name] = {
            "kind": kind,
            "credential": value,
            "baked": encoded(png(IHDR, chunk_bytes, PHYS, IDAT, TEXT, IEND)),
        }
    badge = text_of(credentials["badge-json"][1]).encode("utf-8")
    clr = text_of(credentials["clr-json"][1]).encode("utf-8")
    held = {
        "image": encoded(png(IHDR, PHYS, itxt(FORMATS["clr"]["keyword"], clr), IDAT, itxt(FORMATS["badge"]["keyword"], badge), IEND)),
        "baked": encoded(png(IHDR, itxt(FORMATS["badge"]["keyword"], badge), PHYS, IDAT, IEND)),
    }
    other = chunk(b"iTXt", b"Comment\0\0\0\0\0hello")
    bad_crc = bytearray(itxt(FORMATS["badge"]["keyword"], badge))
    bad_crc[-1] ^= 0xFF
    jws_text = text_of(credentials["badge-jws"][1]).encode("utf-8")
    refused = {
        "bad crc": png(IHDR, bytes(bad_crc), IEND),
        "compressed": png(IHDR, itxt(FORMATS["badge"]["keyword"], zlib.compress(badge), compression=1), IEND),
        "compression method": png(IHDR, itxt(FORMATS["badge"]["keyword"], badge, method=1), IEND),
        "no language tag": png(IHDR, chunk(b"iTXt", FORMATS["badge"]["keyword"].encode() + b"\0\0\0"), IEND),
        "text that is not UTF-8": png(IHDR, itxt(FORMATS["badge"]["keyword"], b"\xff\xfe"), IEND),
        "text that is neither JSON nor a JWS": png(IHDR, itxt(FORMATS["badge"]["keyword"], b"not a credential"), IEND),
        "json that is not valid": png(IHDR, itxt(FORMATS["badge"]["keyword"], b'{"a":'), IEND),
        "empty text": png(IHDR, itxt(FORMATS["badge"]["keyword"], b""), IEND),
        "no IEND": png(IHDR, IDAT),
        "truncated chunk": png(IHDR, IDAT)[:-5],
        "frame cut short": png(IHDR) + b"\0\0\0\0IE",
        "chunk longer than the image": png(IHDR, struct.pack(">I", 1000) + b"IDAT" + b"\0" * 10),
        "chunk longer than a chunk may be": png(IHDR, struct.pack(">I", 0x80000000) + b"IDAT" + b"\0" * 10),
        "first chunk is not IHDR": png(IDAT, IEND),
        "not a PNG": b"GIF89a",
    }
    return {
        "base": encoded(base),
        "cases": cases,
        "replaced": held,
        "refused": {name: encoded(data) for name, data in refused.items()},
        "withoutCredential": {
            "other keyword": encoded(png(IHDR, other, IDAT, IEND)),
            "keyword with other case": encoded(png(IHDR, itxt("OpenBadgeCredential", badge), IEND)),
            "tEXt chunk": encoded(png(IHDR, chunk(b"tEXt", FORMATS["badge"]["keyword"].encode() + b"\0" + badge), IEND)),
        },
        "firstWins": {
            "image": encoded(png(IHDR, itxt(FORMATS["badge"]["keyword"], badge), itxt(FORMATS["clr"]["keyword"], clr), IEND)),
            "kind": "badge",
            "credential": credentials["badge-json"][1],
        },
        "afterData": {
            "image": encoded(png(IHDR, IDAT, itxt(FORMATS["clr"]["keyword"], jws_text), IEND)),
            "kind": "clr",
            "credential": credentials["badge-jws"][1],
        },
    }


SVG_BASE = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<!-- a badge -->\n'
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n'
    '  <rect width="512" height="512" fill="#336"/>\n'
    "</svg>\n"
)
SVG_ROOT_TAG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'


def cdata(json_text):
    return "<![CDATA[" + json_text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def svg_element(kind, value, declaration=""):
    prefix = FORMATS[kind]["prefix"]
    name = f"{prefix}:credential"
    if isinstance(value, str):
        return f'<{name}{declaration} verify="{value}"></{name}>'
    return f"<{name}{declaration}>{cdata(compact_json(value))}</{name}>"


def baked_svg(kind, value, base=SVG_BASE, root_tag=SVG_ROOT_TAG):
    """The base with the namespace added to the root and the element right after its start tag."""
    prefix, namespace = FORMATS[kind]["prefix"], FORMATS[kind]["namespace"]
    declared = root_tag[:-1] + f' xmlns:{prefix}="{namespace}">'
    return base.replace(root_tag, declared + svg_element(kind, value), 1)


def check_svg(svg, kind, value):
    """Parses the SVG with ElementTree and checks that the credential in it is the one given."""
    tree = ElementTree.fromstring(svg.encode("utf-8"))
    found = tree.findall(f"{{{FORMATS[kind]['namespace']}}}credential")
    assert len(found) == 1, "one credential element"
    element = found[0]
    if isinstance(value, str):
        assert element.get("verify") == value and (element.text or "").strip() == ""
    else:
        assert json.loads(element.text) == value


def svg_fixtures(credentials):
    cases = {}
    for name, (kind, value) in credentials.items():
        svg = baked_svg(kind, value)
        check_svg(svg, kind, value)
        cases[name] = {"kind": kind, "credential": value, "baked": svg}
    # The root of Open Badges 2.0 images binds the prefix to another namespace: the declaration goes on the new element.
    old_root = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="http://openbadges.org" viewBox="0 0 1 1">'
    old_base = f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="http://openbadges.org" viewBox="0 0 1 1"><openbadges:assertion verify="https://example.edu/assertions/1"></openbadges:assertion></svg>'
    value = credentials["badge-json"][1]
    rebound = old_base.replace(
        old_root,
        old_root + svg_element("badge", value, declaration=f' xmlns:openbadges="{FORMATS["badge"]["namespace"]}"'),
        1,
    )
    ElementTree.fromstring(rebound.encode("utf-8"))
    empty_root = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    empty_baked = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"'
        + f' xmlns:openbadges="{FORMATS["badge"]["namespace"]}">'
        + svg_element("badge", value)
        + "</svg>"
    )
    check_svg(empty_baked, "badge", value)
    held_base = baked_svg("clr", credentials["clr-json"][1])
    # The element is replaced and the declaration of the first stays on the root, where the baker did not put it back.
    held_baked = held_base.replace(
        svg_element("clr", credentials["clr-json"][1]), svg_element("badge", value), 1
    ).replace(
        f'xmlns:clr="{FORMATS["clr"]["namespace"]}">', f'xmlns:clr="{FORMATS["clr"]["namespace"]}" xmlns:openbadges="{FORMATS["badge"]["namespace"]}">', 1
    )
    check_svg(held_baked, "badge", value)
    other_prefix = SVG_BASE.replace(
        SVG_ROOT_TAG, SVG_ROOT_TAG[:-1] + f' xmlns:b="{FORMATS["badge"]["namespace"]}"><b:credential verify="{credentials["badge-jws"][1]}"/>'
    )
    check_svg(other_prefix, "badge", credentials["badge-jws"][1])
    return {
        "base": SVG_BASE,
        "cases": cases,
        "rebound": {"image": old_base, "baked": rebound},
        "emptyRoot": {"image": empty_root, "baked": empty_baked},
        "replaced": {"image": held_base, "baked": held_baked},
        "otherPrefix": {"image": other_prefix, "kind": "badge", "credential": credentials["badge-jws"][1]},
    }


def main():
    badge, clr = achievement_credential(), clr_credential()
    badge_jws = jws(badge)
    credentials = {
        "badge-json": ("badge", badge),
        "badge-jws": ("badge", badge_jws),
        "clr-json": ("clr", clr),
        "clr-jws": ("clr", jws(clr)),
        # The VC-JWT of the Verifiable Credentials Data Model 1.1 carries the credential in a `vc` claim.
        "badge-jws-vc-claim": ("badge", jws({"iss": PROFILE["id"], "vc": {"type": ["VerifiableCredential", "OpenBadgeCredential"]}})),
        "clr-jws-vc-claim": ("clr", jws({"iss": PROFILE["id"], "vc": {"type": ["VerifiableCredential", "ClrCredential"]}})),
    }
    fixture = {
        "credentials": {"badge": badge, "clr": clr},
        "png": png_fixtures(credentials),
        "svg": svg_fixtures(credentials),
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
