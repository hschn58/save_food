FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

ENV FOOD_INVENTORY_DB=/data/food_inventory.db
EXPOSE 8000

CMD ["uvicorn", "food_inventory.app:app", "--host", "0.0.0.0", "--port", "8000"]
