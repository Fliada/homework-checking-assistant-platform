import json

def handle(method, path):
    if path == "/ping":
        return 200, {"Content-Type":"application/json"}, json.dumps({"message":"pong"}).encode()
    if path == "/healthcheck":
        return 204, {}, b""
    return 404, {}, b""
