from pathlib import Path
from types import SimpleNamespace
import pytest
from app.services.similarity import compare, runtime, source_files, SimilarityError


def test_source_paths_cannot_escape_workspace():
    submission = SimpleNamespace(artifacts=[{'path': p, 'content': 'package main'} for p in ['/tmp/escape.go', '../escape.go', 'foo/../../escape.go', 'foo\\escape.go', 'safe/main.go', 'README.md']])
    assert source_files(submission, 'go') == {'safe/main.go': 'package main'}


def test_real_jplag_renamed_variables_produce_matching_lines(monkeypatch, tmp_path):
    try: runtime()
    except SimilarityError: pytest.skip('Optional JPlag runtime not installed; npm run setup:jplag')
    monkeypatch.setenv('JPLAG_DATA_ROOT', str(tmp_path))
    source = '''package main
import "fmt"
func sum(values []int) int {
 total := 0
 for _, value := range values { total += value }
 return total
}
func main() { fmt.Println(sum([]int{1,2,3})) }
'''
    submissions = [SimpleNamespace(id=sid, student_id=sid, artifacts=[{'path': 'cmd/main.go', 'content': code}], git_metadata={'snapshot_complete': True})
                   for sid, code in [('a', source), ('b', source.replace('total', 'result'))]]
    result = compare(submissions, 'go')
    pair = result['pairs'][0]
    assert pair['averagePercent'] == 100
    assert pair['matches'][0]['left']['path'] == 'cmd/main.go'
    assert pair['matches'][0]['left']['start'] == 1
    assert pair['matches'][0]['left']['end'] == 8
    assert 'total' in pair['matches'][0]['left']['code'] or 'total' in pair['matches'][0]['right']['code']
    assert not list(tmp_path.iterdir())
