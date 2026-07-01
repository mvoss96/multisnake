FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

RUN useradd --create-home --uid 1000 snake
WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend/ ./
COPY frontend/ /app/frontend/

RUN chown -R snake:snake /app
USER snake

ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/', timeout=3)" || exit 1

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
