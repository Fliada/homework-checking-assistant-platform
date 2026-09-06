# Контракт маршрутов API

Реализуйте handle(method,path), возвращающий (status, headers, body_bytes). GET /ping: 200, Content-Type application/json, JSON message=pong. HEAD /healthcheck: 204 без тела. Для известного пути с неверным методом 405, неизвестный путь 404.

Python 3.11, стандартная библиотека.
