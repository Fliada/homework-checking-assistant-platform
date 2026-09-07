import pytest
from app.jobs import auto_confirm_criteria

@pytest.mark.parametrize('confidence,abstained,evidence,expected', [(.8,False,[{}],True),(.79,False,[{}],False),(.99,True,[{}],False),(.99,False,[],False)])
def test_auto_confirmation_boundary(confidence,abstained,evidence,expected):
    original={'suggested_score':2,'final_score':None,'confirmed':False,'confidence':confidence,'abstained':abstained,'evidence':evidence}
    result=auto_confirm_criteria([original],.8)[0]
    assert result['confirmed'] is expected
    assert result['final_score']==(2 if expected else None)
    assert original['confirmed'] is False
