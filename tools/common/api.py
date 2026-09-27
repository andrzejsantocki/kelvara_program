import json
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


class ApiError(RuntimeError):
    pass


class HttpApi:
    def __init__(self, base_url="http://127.0.0.1:7610", timeout=20):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path):
        try:
            with urlopen(f"{self.base_url}{path}", timeout=self.timeout) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                body = json.load(error)
                detail = body.get("error") or body.get("reason") or str(error)
            except Exception:
                detail = str(error)
            raise ApiError(f"HTTP {error.code}: {detail}") from error
        except (URLError, TimeoutError, OSError) as error:
            raise ApiError(str(error)) from error


class MemoryApi:
    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.paths = []

    def get(self, path):
        self.paths.append(path)
        if self.error:
            raise self.error
        if path not in self.responses:
            raise ApiError(f"missing fixture: {path}")
        return self.responses[path]
