from collections import deque

def shortest_path(graph, start, end):
    queue = deque([start])
    parents = {start: None}
    while queue:
        node = queue.popleft()
        if node == end:
            result = []
            while node is not None:
                result.append(node)
                node = parents[node]
            return result[::-1]
        for neighbour in graph.get(node, []):
            if neighbour not in parents:
                parents[neighbour] = node
                queue.append(neighbour)
    return []
