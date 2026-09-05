"""Persist confirmed late penalties without changing existing review data."""
from alembic import op
from sqlalchemy import Column, Float, inspect

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in inspect(op.get_bind()).get_columns('reviews')}
    if 'late_penalty_value' not in columns:
        op.add_column('reviews', Column('late_penalty_value', Float, nullable=True))


def downgrade():
    with op.batch_alter_table('reviews') as table:
        table.drop_column('late_penalty_value')
