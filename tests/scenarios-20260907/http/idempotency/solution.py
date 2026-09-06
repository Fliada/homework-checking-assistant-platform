from copy import deepcopy

class Orders:
    def __init__(self):
        self.orders = {}
    def create(self, key, payload):
        if not isinstance(key, str) or not key:
            raise ValueError("key required")
        if key in self.orders:
            identifier, saved = self.orders[key]
            if saved != payload:
                raise ValueError("conflicting payload")
            return identifier
        identifier = len(self.orders) + 1
        self.orders[key] = (identifier, deepcopy(payload))
        return identifier
