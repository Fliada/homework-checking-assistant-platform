import csv
import io
from decimal import Decimal, InvalidOperation

def summarize(text):
    reader = csv.DictReader(io.StringIO(text))
    if not {"category", "amount"}.issubset(reader.fieldnames or []):
        raise ValueError("missing columns")
    result = {}
    for row in reader:
        try:
            amount = Decimal(row["amount"])
        except (InvalidOperation, TypeError):
            raise ValueError("invalid amount") from None
        if not amount.is_finite():
            raise ValueError("invalid amount")
        category = row["category"]
        result[category] = result.get(category, Decimal("0")) + amount
    return {key: str(value) for key, value in result.items()}
