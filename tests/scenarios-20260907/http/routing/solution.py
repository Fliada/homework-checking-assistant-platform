import json

def handle(method, path):
    if path not in {"/ping", "/healthcheck"}:
        return 404, {}, b""
    expected = "GET" if path == "/ping" else "HEAD"
    if method != expected:
        return 405, {"Allow": expected}, b""
    if path == "/healthcheck":
        return 204, {}, b""
    return 200, {"Content-Type": "application/json"}, json.dumps({"message": "pong"}).encode()
