"""Persist JPlag comparisons and human decisions independently of grades."""
from alembic import op
from app.models import SimilarityRun
revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

def upgrade():
    SimilarityRun.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    SimilarityRun.__table__.drop(op.get_bind(), checkfirst=True)
