FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY fixtures ./fixtures
COPY alembic ./alembic
COPY alembic.ini .
RUN useradd --create-home reviewer && mkdir -p /data/artifacts && chown -R reviewer:reviewer /app /data
USER reviewer
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
