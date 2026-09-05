#!/usr/bin/env python3
"""Обратная совместимость → ai_check.py --type text."""

import sys

sys.argv[1:1] = ["--type", "text"]
from ai_check import main  # noqa: E402

if __name__ == "__main__":
    main()
