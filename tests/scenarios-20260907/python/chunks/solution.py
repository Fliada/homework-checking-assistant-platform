from itertools import islice

def chunks(iterable, size):
    if type(size) is not int or size <= 0:
        raise ValueError("size must be positive")
    source = iter(iterable)
    while True:
        batch = list(islice(source, size))
        if not batch:
            return
        yield batch
