FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0 PORT=8000
WORKDIR /app
RUN useradd --create-home player
COPY pyproject.toml LICENSE ./
RUN mkdir ai_chess_lab && touch ai_chess_lab/__init__.py README.md \
    && pip install --no-cache-dir . \
    && pip uninstall -y ai-chess-lab \
    && rm -rf ai_chess_lab README.md build *.egg-info
COPY ai_chess_lab ./ai_chess_lab
USER player
EXPOSE 8000
ENTRYPOINT ["python", "-m", "ai_chess_lab.main"]
