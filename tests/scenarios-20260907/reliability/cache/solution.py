class Cache:
    def __init__(self, ttl, clock):
        self.values = {}
    def put(self, key, value):
        self.values[key] = value
    def get(self, key):
        return self.values.get(key)
