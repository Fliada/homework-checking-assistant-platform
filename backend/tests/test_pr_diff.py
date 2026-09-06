from app.services.pr_diff import attach_pr_diff
from app.services.pipeline import _segments


def test_only_added_lines_reach_model_with_original_numbers():
    artifact={'id':'a','path':'main.go'}
    attach_pr_diff(artifact,{'patch':'@@ -10,3 +10,3 @@\n same\n-old\n+new\n end','additions':1,'deletions':1})
    assert [s['diff_kind'] for s in artifact['segments']]==['context','removed','added','context']
    assert [s['text'] for s in _segments([artifact])]==['new']
    assert _segments([artifact])[0]['anchor']['start']=='line:11'
    assert artifact['segments'][1]['old_line']==11


def test_missing_or_truncated_diff_never_falls_back_to_full_file():
    for patch in [None,'@@ -1,2 +1,2 @@\n-old\n+new']:
        artifact={'id':'a','path':'x.go','segments':[{'text':'whole file'}]}
        attach_pr_diff(artifact,{'patch':patch,'additions':1,'deletions':1})
        assert artifact['parse_status']=='needs_human'
        assert _segments([artifact])==[]


def test_added_and_deleted_files():
    for patch,adds,dels,kind in [('@@ -0,0 +1 @@\n+new',1,0,'added'),('@@ -1 +0,0 @@\n-old',0,1,'removed')]:
        artifact={'id':'a','path':'x.go'}
        attach_pr_diff(artifact,{'patch':patch,'additions':adds,'deletions':dels})
        assert artifact['parse_status']=='parsed'
        assert artifact['segments'][0]['diff_kind']==kind
