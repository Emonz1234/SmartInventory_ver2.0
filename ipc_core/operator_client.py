"""Operator UI is an authenticated Server API client, never a bypass to Serial."""
import json
import http.cookiejar
import urllib.request
import urllib.error
from urllib.parse import urlsplit


class OperatorClient:
    def __init__(self, server_url):
        self.url = server_url.rstrip('/')
        parsed = urlsplit(self.url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('SERVER_URL must be an http(s) origin without credentials')
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, path, method='GET', body=None):
        csrf = next((c.value for c in self.cookies if c.name == 'csrftoken'), '')
        request = urllib.request.Request(self.url + '/api/' + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', 'X-CSRFToken': csrf,
                     'Referer': self.url + '/', 'Origin': self.url})
        try:
            with self.opener.open(request, timeout=5) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                detail = json.load(exc).get('error', f'HTTP {exc.code}')
            except (ValueError, AttributeError):
                detail = f'HTTP {exc.code}'
            raise ValueError(detail) from None

    def login(self, username, password):
        self.request('session')
        return self.request('session', 'POST', {'username': username, 'password': password})


def read_edge(url, token):
    request = urllib.request.Request(url + '/api/device/snapshot', headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)
