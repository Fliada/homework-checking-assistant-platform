def lower_bound(values, target):
    for index, value in enumerate(values):
        if value >= target:
            return index
    return len(values)
