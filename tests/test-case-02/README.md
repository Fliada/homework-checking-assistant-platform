# Задание 1. Каркас HTTP-сервиса

Требуется Go 1.22 или новее. Внешних зависимостей нет.

Из этой папки:

```sh
go run ./cmd --port 3000
```

Порт по умолчанию — 8080. Можно задать `PORT` в окружении; флаг `--port` имеет приоритет.

Проверка маршрутов:

```sh
curl -i http://localhost:3000/ping
curl -I http://localhost:3000/healthcheck
```

`/ping` возвращает JSON `{"message":"pong"}`, `/healthcheck` — статус 204 без тела.
