def paginate(items, page=1, limit=20):
    return {"items":items[:limit], "total":len(items), "page":1, "limit":limit}
