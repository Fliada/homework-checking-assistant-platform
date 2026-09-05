#!/usr/bin/env python3
"""Обратная совместимость → ai_check.py --type code."""

import sys
from pathlib import Path

sys.argv[1:1] = ["--type", "code"]
from ai_check import main  # noqa: E402

if __name__ == "__main__":
    main()
