import pytest

from app.jobs import safe_error
from app.services.pipeline import PipelineError


@pytest.mark.parametrize('code,expected', [
    ('github_pr_changed_during_ingest', 'PR изменился'),
    ('github_snapshot_limit', 'лимиты импорта'),
    ('configuration_error:credential_missing', 'API-ключ'),
    ('model_response_blocked', 'Провайдер заблокировал'),
])
def test_known_pipeline_errors_are_actionable(code, expected):
    message = safe_error(PipelineError(code))
    assert expected in message and code in message
    assert 'PipelineError' not in message


def test_error_source_distinguishes_github_from_model_credentials():
    assert 'GITHUB_TOKEN' in safe_error(PipelineError('upstream_http_401'), source='github')
    assert 'Провайдер' in safe_error(PipelineError('upstream_http_401'))


@pytest.mark.parametrize('exception', [ValueError('secret-value'), PipelineError('upstream_http_401 secret-value')])
def test_unknown_errors_never_expose_untrusted_exception_text(exception):
    assert 'secret-value' not in safe_error(exception)
