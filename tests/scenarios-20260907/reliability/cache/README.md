# Кэш с TTL

Реализуйте Cache(ttl, clock) с get(key) и put(key,value). clock — переданная функция времени. TTL положительный, иначе ValueError. Запись недоступна при now >= created+ttl. Повторный put обновляет TTL. get отсутствующего ключа возвращает None.

Python 3.11, стандартная библиотека.
