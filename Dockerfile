FROM python:3.14-slim
LABEL org.opencontainers.image.source=https://github.com/dperezcabrera/ai-chess-lab
LABEL org.opencontainers.image.description="LLMs, System One models and you at chess, with the 72-game tournament of September 2026 ready to review"
LABEL org.opencontainers.image.licenses=GPL-3.0-or-later
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0 PORT=8000
WORKDIR /app
RUN useradd --create-home player && mkdir tournaments && chown player tournaments
COPY pyproject.toml LICENSE ./
RUN mkdir ai_chess_lab && touch ai_chess_lab/__init__.py README.md \
    && pip install --no-cache-dir . \
    && pip uninstall -y ai-chess-lab \
    && rm -rf ai_chess_lab README.md build *.egg-info
COPY ai_chess_lab ./ai_chess_lab
COPY --chown=player results/ ./tournaments/
USER player
EXPOSE 8000
ENTRYPOINT ["python", "-m", "ai_chess_lab.main"]
