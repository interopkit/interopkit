"""A tool built on PyLTI1p3 2.0.0, for the flows of packages/tool-integration/test/pylti1p3.corpus.test.ts.

It answers the login and the launch of a platform and then runs the services that the launch offers, each through the classes
of PyLTI1p3: the login and the validation of the launch, the key set, the assignment and grade services, the names and roles
service, the groups service and Deep Linking. The library has no server, so the adapters of its request, cookies, redirect and
storage are the few lines that its Flask adapter has, over the HTTP server of the standard library. The routes are the tool's:

    GET|POST /lti/login          the third-party initiated login
    POST     /lti/launch         the launch: validates it and answers what it carried
    GET      /lti/jwks           the key set of the tool
    GET      /api/<launch>/...   the services of a launch that /lti/launch validated, read from its cache as the library does

The environment gives CA_PEM, the certificate that signs the platform's, and PORT. The platform that the tool serves is
configured at run time:

    POST     /admin/configure    the platform as JSON: iss, client_id, auth_login_url, auth_token_url, key_set_url,
                                 deployment_ids and launch_url; the tool makes a new key for it and answers its key set
"""

import json
import os
import re
import sys
import tempfile
import typing as t
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pylti1p3.cookie import CookieService
from pylti1p3.deep_link_resource import DeepLinkResource
from pylti1p3.exception import LtiException, LtiServiceException, OIDCException
from pylti1p3.grade import Grade
from pylti1p3.launch_data_storage.cache import CacheDataStorage
from pylti1p3.lineitem import LineItem
from pylti1p3.message_launch import MessageLaunch
from pylti1p3.oidc_login import OIDCLogin
from pylti1p3.redirect import Redirect
from pylti1p3.request import Request
from pylti1p3.session import SessionService
from pylti1p3.tool_config import ToolConfDict

Response = t.Dict[str, t.Any]


class Cache:
    """The cache that CacheDataStorage reads and writes: a dict, which the process keeps for its life."""

    def __init__(self) -> None:
        self._values: t.Dict[str, t.Any] = {}

    def get(self, key: str) -> t.Any:
        return self._values.get(key)

    def set(self, key: str, value: t.Any, exp: t.Optional[int] = None) -> None:
        self._values[key] = value


class DictStorage(CacheDataStorage):
    def __init__(self, cache: Cache) -> None:
        self._cache = cache
        super().__init__()


class AppRequest(Request):
    def __init__(self, method: str, query: t.Dict[str, str], form: t.Dict[str, str], cookies: t.Dict[str, str], secure: bool):
        super().__init__()
        self._method = method
        self._query = query
        self._form = form
        self._cookies = cookies
        self._secure = secure
        self._session: t.Dict[str, t.Any] = {}

    @property
    def session(self) -> t.Dict[str, t.Any]:
        return self._session

    def get_param(self, key: str) -> str:
        return (self._form if self._method == "POST" else self._query).get(key, "")

    def get_cookie(self, key: str) -> t.Optional[str]:
        return self._cookies.get(key)

    def is_secure(self) -> bool:
        return self._secure


class AppCookieService(CookieService):
    def __init__(self, request: AppRequest) -> None:
        self._request = request
        self._to_set: t.Dict[str, t.Tuple[str, t.Optional[int]]] = {}

    def _key(self, name: str) -> str:
        return self._cookie_prefix + "-" + name

    def get_cookie(self, name: str) -> t.Optional[str]:
        return self._request.get_cookie(self._key(name))

    def set_cookie(self, name: str, value: t.Union[str, int], exp: t.Optional[int] = 3600) -> None:
        self._to_set[self._key(name)] = (str(value), exp)

    def update_response(self, response: Response) -> None:
        for name, (value, exp) in self._to_set.items():
            attributes = "Path=/; HttpOnly" + ("; Secure; SameSite=None" if self._request.is_secure() else "")
            if exp is not None:
                attributes += f"; Max-Age={exp}"
            response["cookies"].append(f"{name}={value}; {attributes}")


class AppRedirect(Redirect):
    def __init__(self, location: str, cookie_service: AppCookieService) -> None:
        super().__init__()
        self._location = location
        self._cookie_service = cookie_service

    def do_redirect(self) -> Response:
        response = {"status": 302, "headers": {"location": self._location}, "cookies": [], "body": b""}
        self._cookie_service.update_response(response)
        return response

    def do_js_redirect(self) -> Response:
        raise NotImplementedError

    def set_redirect_url(self, location: str) -> None:
        self._location = location

    def get_redirect_url(self) -> str:
        return self._location


class AppOIDCLogin(OIDCLogin):
    def get_redirect(self, url: str) -> AppRedirect:
        return AppRedirect(url, self._cookie_service)


class AppMessageLaunch(MessageLaunch):
    def _get_request_param(self, key: str) -> str:
        return self._request.get_param(key)


def configure(configuration: t.Dict[str, t.Any]) -> t.Mapping[str, t.Any]:
    """Registers the platform with a new key of the tool, and returns the key set that the platform fetches."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    tool_conf = ToolConfDict({configuration["iss"]: {
        "default": True,
        "client_id": configuration["client_id"],
        "auth_login_url": configuration["auth_login_url"],
        "auth_token_url": configuration["auth_token_url"],
        "auth_audience": None,
        "key_set_url": configuration["key_set_url"],
        "key_set": None,
        "deployment_ids": configuration["deployment_ids"],
    }})
    tool_conf.set_private_key(configuration["iss"], private_pem)
    tool_conf.set_public_key(configuration["iss"], public_pem)
    STATE["configuration"] = configuration
    STATE["tool_conf"] = tool_conf
    return tool_conf.get_jwks(iss=configuration["iss"], client_id=configuration["client_id"])


STATE: t.Dict[str, t.Any] = {}
CACHE = Cache()
SERVICES = re.compile(r"^/api/(?P<launch>[^/]+)/(?P<service>[a-z-]+)(?:/(?P<operation>[a-z-]+))?$")


def storage() -> DictStorage:
    return DictStorage(CACHE)


def trust_the_platform() -> None:
    """Makes `requests` trust the certificate that signs the platform's, which the run gives in CA_PEM."""
    handle, path = tempfile.mkstemp(suffix=".pem")
    with os.fdopen(handle, "w") as file:
        file.write(os.environ["CA_PEM"])
    os.environ["REQUESTS_CA_BUNDLE"] = path


def json_response(status: int, body: t.Any) -> Response:
    return {"status": status, "headers": {"content-type": "application/json"}, "cookies": [], "body": json.dumps(body).encode()}


def login(request: AppRequest) -> Response:
    cookies = AppCookieService(request)
    oidc = AppOIDCLogin(request, STATE["tool_conf"], SessionService(request), cookies, launch_data_storage=storage())
    return oidc.redirect(STATE["configuration"]["launch_url"])


def launch(request: AppRequest) -> Response:
    cookies = AppCookieService(request)
    message = AppMessageLaunch(request, STATE["tool_conf"], SessionService(request), cookies, launch_data_storage=storage())
    data = message.get_launch_data()
    response = json_response(200, {
        "launch_id": message.get_launch_id(),
        "launch": data,
        "is_resource_launch": message.is_resource_launch(),
        "is_deep_link_launch": message.is_deep_link_launch(),
        "is_submission_review_launch": message.is_submission_review_launch(),
        "submission_review_user": message.get_submission_review_user() if message.is_submission_review_launch() else None,
        "has_ags": message.has_ags(),
        "has_nrps": message.has_nrps(),
        "has_cgs": message.has_cgs(),
    })
    cookies.update_response(response)
    return response


def restored(request: AppRequest, launch_id: str) -> AppMessageLaunch:
    cookies = AppCookieService(request)
    return t.cast(AppMessageLaunch, AppMessageLaunch.from_cache(
        launch_id, request, STATE["tool_conf"], SessionService(request), cookies, storage()
    ))


def line_item_of(body: t.Dict[str, t.Any]) -> LineItem:
    item = LineItem()
    item.set_label(body["label"]).set_score_maximum(body["scoreMaximum"])
    if "tag" in body:
        item.set_tag(body["tag"])
    if "resourceId" in body:
        item.set_resource_id(body["resourceId"])
    return item


def grade_of(body: t.Dict[str, t.Any]) -> Grade:
    grade = Grade()
    grade.set_score_given(body["scoreGiven"]).set_score_maximum(body["scoreMaximum"])
    grade.set_activity_progress(body["activityProgress"]).set_grading_progress(body["gradingProgress"])
    grade.set_user_id(body["userId"]).set_timestamp(body["timestamp"])
    if "comment" in body:
        grade.set_comment(body["comment"])
    return grade


def run_service(message: AppMessageLaunch, service: str, operation: t.Optional[str], method: str, body: t.Dict[str, t.Any]) -> t.Any:
    if service == "ags":
        ags = message.get_ags()
        if operation == "line-item":
            return json.loads(ags.get_lineitem().get_value())
        if operation == "line-items" and method == "GET":
            return ags.get_lineitems()
        if operation == "line-items":
            return json.loads(ags.find_or_create_lineitem(line_item_of(body)).get_value())
        if operation == "score":
            return {"headers": dict(ags.put_grade(grade_of(body))["headers"]), "body": None}
        if operation == "results":
            return ags.get_grades()
    if service == "nrps" and operation == "members":
        return message.get_nrps().get_members()
    if service == "nrps" and operation == "context":
        return message.get_nrps().get_context()
    if service == "groups" and operation == "groups":
        return message.get_cgs().get_groups()
    if service == "groups" and operation == "sets":
        return message.get_cgs().get_sets(include_groups=True)
    if service == "deep-linking":
        deep_link = message.get_deep_link()
        resources = []
        for item in body["items"]:
            resource = DeepLinkResource()
            resource.set_url(item["url"]).set_title(item["title"])
            if "custom" in item:
                resource.set_custom_params(item["custom"])
            resources.append(resource)
        return {"return_url": message.get_launch_data()["https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings"]["deep_link_return_url"], "jwt": deep_link.get_response_jwt(resources)}
    raise LtiException(f"No such service: {service}/{operation}")


class Handler(BaseHTTPRequestHandler):
    server_version = "pylti1p3-tool"

    def log_message(self, format: str, *args: t.Any) -> None:
        sys.stderr.write("%s\n" % (format % args))

    def _read(self) -> t.Tuple[AppRequest, bytes]:
        url = urlparse(self.path)
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b""
        form: t.Dict[str, str] = {}
        if self.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
            form = {key: values[0] for key, values in parse_qs(raw.decode()).items()}
        cookies = SimpleCookie(self.headers.get("cookie", ""))
        secure = self.headers.get("x-forwarded-proto") == "https"
        request = AppRequest(
            self.command,
            {key: values[0] for key, values in parse_qs(url.query).items()},
            form,
            {name: morsel.value for name, morsel in cookies.items()},
            secure,
        )
        return request, raw

    def _handle(self) -> None:
        path = urlparse(self.path).path
        try:
            request, raw = self._read()
            if path == "/health":
                response = json_response(200, {"status": "ok"})
            elif path == "/lti/login":
                response = login(request)
            elif path == "/lti/launch" and self.command == "POST":
                response = launch(request)
            elif path == "/admin/configure" and self.command == "POST":
                response = json_response(200, configure(json.loads(raw)))
            elif path == "/lti/jwks":
                configuration = STATE["configuration"]
                response = json_response(200, STATE["tool_conf"].get_jwks(iss=configuration["iss"], client_id=configuration["client_id"]))
            elif SERVICES.match(path):
                found = SERVICES.match(path)
                assert found is not None
                body = json.loads(raw) if raw else {}
                response = json_response(200, run_service(restored(request, found["launch"]), found["service"], found["operation"], self.command, body))
            else:
                response = json_response(404, {"error": "not found"})
        except LtiServiceException as error:
            response = json_response(502, {"error": "platform", "status": error.response.status_code, "body": error.response.text})
        except (LtiException, OIDCException) as error:
            response = json_response(400, {"error": "lti", "message": str(error)})
        except Exception as error:  # the tool answers what went wrong, so that a flow fails with its cause
            response = json_response(500, {"error": type(error).__name__, "message": str(error)})
        self.send_response(response["status"])
        for name, value in response["headers"].items():
            self.send_header(name, value)
        for cookie in response["cookies"]:
            self.send_header("set-cookie", cookie)
        self.send_header("content-length", str(len(response["body"])))
        self.end_headers()
        self.wfile.write(response["body"])

    do_GET = _handle
    do_POST = _handle


if __name__ == "__main__":
    trust_the_platform()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
