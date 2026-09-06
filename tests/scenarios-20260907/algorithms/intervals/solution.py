def merge(intervals):
    return [[min(start for start, end in intervals), max(end for start, end in intervals)]]
