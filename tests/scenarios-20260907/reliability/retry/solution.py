def retry(operation, attempts, sleep):
    for index in range(attempts):
        try:
            return operation()
        except Exception:
            if index == attempts-1:
                raise
            sleep(1)
