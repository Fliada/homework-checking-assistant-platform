def redact(data):
    if isinstance(data, dict):
        return {key: "[REDACTED]" if isinstance(key,str) and key.lower() in {"password","token","api_key"} else redact(value) for key,value in data.items()}
    if isinstance(data, list):
        return [redact(value) for value in data]
    return data
