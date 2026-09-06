import csv, io

def summarize(text):
    result = {}
    for row in csv.DictReader(io.StringIO(text)):
        category = row["category"]
        result[category] = result.get(category, 0.0) + float(row["amount"])
    return {key: str(value) for key,value in result.items()}
