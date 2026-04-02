"""Global test fixtures for BABEL backend tests."""

from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def mock_generate_chapter():
    """Prevent real LLM calls for chapter generation across all tests."""
    with patch(
        "babel.llm.generate_chapter",
        new_callable=AsyncMock,
        return_value="[Test chapter]",
    ):
        yield
