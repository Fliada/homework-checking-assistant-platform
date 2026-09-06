import re
import unicodedata

def slug(text):
    if not isinstance(text, str):
        raise TypeError("text must be a string")
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[^\w]+|_+", "-", text, flags=re.UNICODE).strip("-")
