def moving_average(values, window):
    if type(window) is not int or window <= 0:
        raise ValueError("invalid window")
    if len(values) < window:
        return []
    total = sum(values[:window])
    result = [total / window]
    for index in range(window, len(values)):
        total += values[index] - values[index-window]
        result.append(total / window)
    return result
