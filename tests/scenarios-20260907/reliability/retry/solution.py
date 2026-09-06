def retry(operation, attempts, sleep):
    if type(attempts) is not int or attempts <= 0:
        raise ValueError("invalid attempts")
    for index in range(attempts):
        try:
            return operation()
        except TimeoutError:
            if index == attempts - 1:
                raise
            sleep(2 ** index)
