"""User-facing messages for known pipeline codes; never expose provider error bodies."""

MESSAGES = {
    'invalid_github_pr_url': 'Укажите ссылку вида https://github.com/owner/repository/pull/123.',
    'github_allowlist_required': 'Администратору нужно заполнить GITHUB_ALLOWED_REPOSITORIES на сервере.',
    'github_repository_not_allowed': 'Репозиторий не входит в GITHUB_ALLOWED_REPOSITORIES. Обратитесь к администратору.',
    'github_tree_truncated': 'GitHub вернул неполный список файлов. Уменьшите объём работы или повторите импорт файлов PR.',
    'github_snapshot_limit': 'Файлы работы превышают лимиты импорта. Проверьте размер и число файлов в PR.',
    'github_changed_files_limit': 'В PR больше изменённых файлов, чем разрешено лимитами платформы. Разделите работу на меньшие PR.',
    'github_snapshot_empty': 'В выбранном снимке нет доступных файлов для проверки.',
    'github_pr_changed_during_ingest': 'PR изменился во время загрузки. Повторите запуск для новой версии.',
    'github_blob_encoding': 'GitHub вернул файл в неподдерживаемом формате. Повторите загрузку.',
    'github_invalid_head': 'Не удалось определить коммит PR. Проверьте ссылку и повторите загрузку.',
    'github_tree_traversal_limit': 'Структура изменённых файлов слишком велика для одного импорта. Разделите работу на меньшие PR.',
    'github_invalid_tree': 'GitHub вернул некорректный список файлов. Повторите загрузку.',
    'github_invalid_tree_sha': 'Не удалось определить версию каталога GitHub. Повторите загрузку.',
    'configuration_error:credential_missing': 'Не задан API-ключ модели. Заполните указанную в каталоге переменную в .env и перезапустите backend.',
    'configuration_error:model_disabled': 'Выбранная модель отключена. Включите её в каталоге или выберите другую в настройках задания.',
    'configuration_error:model_not_found': 'Модель из конфигурации задания не найдена. Проверьте настройки агента.',
    'configuration_error:public_llm_disabled': 'Вызовы публичных моделей отключены. Проверьте ALLOW_PUBLIC_LLM и режим обработки.',
    'configuration_error:sensitive_endpoint_blocked': 'Для этого режима нужна разрешённая приватная модель. Обратитесь к администратору.',
    'configuration_error:private_data_public_endpoint_blocked': 'Эту работу нельзя отправить публичной модели. Выберите разрешённую приватную модель.',
    'model_invalid_json': 'Модель вернула некорректный JSON. Повторите анализ или проверьте работу вручную.',
    'model_incomplete_output': 'Ответ модели обрезан или не завершён. Проверьте лимит выходных токенов и повторите анализ.',
    'model_empty_output': 'Модель не вернула текст ответа. Повторите анализ или проверьте работу вручную.',
    'model_response_blocked': 'Провайдер заблокировал ответ модели. Работа доступна для ручной проверки.',
    'model_invalid_response': 'Провайдер вернул ответ неожиданного формата. Проверьте настройки модели.',
    'model_unexpected_tool_output': 'Модель вернула вызов инструмента вместо оценки. Работа доступна для ручной проверки.',
    'invalid_criterion_schema': 'Ответ модели не соответствует формату оценки. Повторите анализ или проверьте критерий вручную.',
    'invalid_triage_schema': 'Модель вернула некорректный список фрагментов для проверки. Повторите анализ.',
    'invalid_triage_anchor': 'Модель выбрала фрагмент, которого нет в работе. Оценка требует ручной проверки.',
    'invalid_source_anchor': 'Не удалось подтвердить ссылку модели на исходный файл. Проверьте критерий вручную.',
    'source_quote_mismatch': 'Цитата модели не совпадает с исходным кодом. Проверьте критерий вручную.',
    'score_without_evidence': 'Модель предложила оценку без подтверждения в исходных файлах. Проверьте критерий вручную.',
}


def pipeline_error_message(code: str, *, source: str = 'model') -> str:
    message = MESSAGES.get(code)
    if message:
        return f'{message} [{code}]'
    provider = 'GitHub API' if source == 'github' else 'API модели'
    upstream = {
        'upstream_response_too_large': f'Ответ {provider} превышает лимит загрузки. Уменьшите объём работы.',
        'upstream_unavailable': f'Не удалось соединиться с {provider}. Проверьте сеть и повторите запуск.',
        'upstream_invalid_json': f'{provider} вернул некорректный ответ. Повторите запуск позже.',
        'upstream_http_400': f'{provider} отклонил запрос. Проверьте ключ, имя модели и параметры подключения.' if source != 'github' else 'GitHub отклонил запрос. Проверьте ссылку на PR.',
        'upstream_http_401': 'GitHub не принял GITHUB_TOKEN. Проверьте токен в .env.' if source == 'github' else 'Провайдер не принял API-ключ. Проверьте ключ в .env и перезапустите backend.',
        'upstream_http_403': 'GitHub отказал в доступе: проверьте GITHUB_TOKEN, права на репозиторий и лимит запросов.' if source == 'github' else 'Провайдер отказал в доступе. Проверьте права ключа и доступность модели в вашем проекте.',
        'upstream_http_404': 'PR или репозиторий не найден либо недоступен вашему GITHUB_TOKEN.' if source == 'github' else 'Модель не найдена. Проверьте её имя и Base URL в каталоге моделей.',
        'upstream_http_429': f'Исчерпан лимит запросов {provider}. Дождитесь восстановления квоты и повторите запуск.',
        'upstream_channel_error': 'LM Studio не может связаться с моделью. Убедитесь, что сервер запущен, модель загружена, и повторите отправку работы.',
    }
    message = upstream.get(code)
    if message:
        return f'{message} [{code}]'
    if code in {'upstream_http_500', 'upstream_http_502', 'upstream_http_503', 'upstream_http_504'}:
        return f'{provider} временно недоступен. Повторите запуск позже. [{code}]'
    return 'Не удалось обработать работу. Проверьте настройки подключения и повторите запуск.'
