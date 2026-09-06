"""Validated PR patches with independent old/new line coordinates."""
import re


def attach_pr_diff(artifact, changed):
    artifact['review_scope'] = 'added_lines'
    artifact['segments'] = []
    if artifact.get('parse_status', 'parsed') != 'parsed':
        return
    patch = changed.get('patch')
    if not isinstance(patch, str):
        artifact.update(parse_status='needs_human', warning='pr_diff_unavailable')
        return
    rows = []
    old = new = None
    old_left = new_left = 0
    added = removed = 0
    valid = True
    for text in patch.splitlines():
        match = re.match(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', text)
        if match:
            if old_left or new_left:
                valid = False
            old, old_count, new, new_count = match.groups()
            old, new = int(old), int(new)
            old_left, new_left = int(old_count or 1), int(new_count or 1)
            continue
        if text.startswith('\\ No newline'):
            continue
        if old is None or not text or text[0] not in ' +-':
            valid = False
            break
        prefix, content = text[0], text[1:]
        kind = {'+':'added', '-':'removed', ' ':'context'}[prefix]
        old_line = old if prefix != '+' else None
        new_line = new if prefix != '-' else None
        start = f'line:{new_line}' if new_line is not None else f'old-line:{old_line}'
        rows.append({'id': f"{artifact['id']}:diff:{len(rows)}", 'artifact_id': artifact['id'], 'path': artifact['path'], 'anchor_type':'line', 'anchor':{'artifact_id':artifact['id'], 'path':artifact['path'], 'start':start, 'end':start, 'anchor_type':'line', 'quote':content}, 'text':content, 'diff_kind':kind, 'old_line':old_line, 'new_line':new_line})
        if prefix != '+':
            old += 1
            old_left -= 1
        if prefix != '-':
            new += 1
            new_left -= 1
        added += prefix == '+'
        removed += prefix == '-'
        if old_left < 0 or new_left < 0:
            valid = False
    if not valid or old_left or new_left or added != changed.get('additions') or removed != changed.get('deletions'):
        artifact.update(parse_status='needs_human', warning='pr_diff_incomplete')
        return
    artifact.update(segments=rows, parse_status='parsed')
