def total(items):
    return str(sum(int(float(price)) for price, count in items))
