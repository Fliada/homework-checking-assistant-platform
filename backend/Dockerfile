FROM eclipse-temurin:25-jre AS java
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JPLAG_JAVA=/opt/java/openjdk/bin/java JPLAG_JAR=/app/vendor/jplag.jar
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN mkdir -p /app/vendor && python -c "import urllib.request,hashlib; p='/app/vendor/jplag.jar'; urllib.request.urlretrieve('https://github.com/jplag/JPlag/releases/download/v6.3.0/jplag-6.3.0-jar-with-dependencies.jar',p); assert hashlib.sha256(open(p,'rb').read()).hexdigest() == '5f2c21e8b88ed77134effcb3a5a3ab13d188f6a3e16d401387f7479e92db9aa2'"
COPY app ./app
COPY fixtures ./fixtures
COPY alembic ./alembic
COPY alembic.ini .
RUN useradd --create-home reviewer && mkdir -p /data/artifacts && chown -R reviewer:reviewer /app /data
USER reviewer
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
